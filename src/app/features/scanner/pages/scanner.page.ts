import { MaskitoDirective } from '@maskito/angular';
import { brlMask, ionInputElement } from '../../../shared/brl-mask';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';
import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonCard,
  IonCardContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonModal,
  IonInput,
  IonIcon,
  ToastController,
} from '@ionic/angular';
import {
  barcodeOutline,
  cameraOutline,
  cubeOutline,
  cartOutline,
  closeOutline,
} from 'ionicons/icons';
import { BarcodeScannerService } from '../services/barcode-scanner.service';
import { ProductCatalogService } from '../services/product-catalog.service';
import { CatalogLookupService, CatalogSuggestion } from '../services/catalog-lookup.service';
import { LastProductPrice, parseBarcode } from '../models/catalog-product';
import { parseItemPrice, parseItemQuantity } from '../../shopping/models/shopping-item';
import { ProductPhotoService } from '../../../core/photos/product-photo.service';
import { ProductPhotoComponent } from '../../../shared/components/product-photo/product-photo.component';
import {
  PhotoEditorComponent,
  type PhotoEdit,
} from '../../../shared/components/photo-editor/photo-editor.component';

@Component({
  selector: 'app-scanner',
  imports: [
    ProductPhotoComponent,
    PhotoEditorComponent,
    MaskitoDirective,
    IonContent,
    IonCard,
    IonCardContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    RouterLink,
    IonButtons,
    IonModal,
    IonInput,
    IonIcon,
    FormsModule,
    CurrencyPipe,
    DatePipe,
  ],
  templateUrl: './scanner.page.html',
  styleUrl: './scanner.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerPage {
  readonly brlMask = brlMask;
  readonly ionInputElement = ionInputElement;
  readonly emptyIcon = barcodeOutline;
  readonly cameraIcon = cameraOutline;
  readonly productIcon = cubeOutline;
  readonly cartIcon = cartOutline;
  readonly closeIcon = closeOutline;
  readonly editingName = signal(false);
  readonly store = inject(ShoppingSessionStore);
  readonly scanner = inject(BarcodeScannerService);
  private readonly catalog = inject(ProductCatalogService);
  private readonly onlineCatalog = inject(CatalogLookupService);
  private readonly toasts = inject(ToastController);
  readonly loadingProduct = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly known = signal(false);
  readonly error = signal('');
  readonly formError = signal('');
  readonly lastPrice = signal<LastProductPrice | null>(null);
  readonly suggestion = signal<CatalogSuggestion | null>(null);
  readonly lookupNotice = signal('');
  readonly imageFailed = signal(false);
  readonly photoEdit = signal<PhotoEdit | null>(null);
  readonly photoPreparing = signal(false);
  private readonly photos = inject(ProductPhotoService);
  photoPreview(): string | null {
    const edit = this.photoEdit();
    return edit?.kind === 'SET' ? 'data:image/jpeg;base64,' + edit.photo.imageBase64 : null;
  }
  code = '';
  productCode = '';
  name = '';
  price = '';
  quantity = '1';
  private request = 0;
  private sessionId = '';
  private resumeCamera = false;
  private lookupAbort?: AbortController;
  private pendingCode = '';

  ionViewWillEnter(): void {
    void this.store.load();
  }

  ionViewWillLeave(): void {
    ++this.request;
    this.lookupAbort?.abort();
    this.loadingProduct.set(false);
    this.resumeCamera = false;
    this.scanner.cancel();
    this.modalOpen.set(false);
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.hidden) {
      this.scanner.cancel();
      if (this.loadingProduct()) {
        ++this.request;
        this.lookupAbort?.abort();
        this.loadingProduct.set(false);
      }
    }
  }

  @HostListener('document:ionBackButton', ['$event'])
  onBack(event: Event): void {
    const detail = (
      event as CustomEvent<{ register: (priority: number, handler: () => void) => void }>
    ).detail;
    if (this.scanner.busy()) detail.register(100, () => this.scanner.cancel());
  }

  async scan(): Promise<void> {
    if (
      !this.store.active() ||
      this.saving() ||
      this.scanner.busy() ||
      this.loadingProduct() ||
      this.modalOpen()
    )
      return;
    this.error.set('');
    const request = this.request;
    try {
      const code = await this.scanner.read();
      if (code && request === this.request) {
        this.resumeCamera = true;
        await this.lookup(code);
      }
    } catch (error) {
      if (request === this.request)
        this.error.set(error instanceof Error ? error.message : 'Não foi possível abrir a câmera.');
    }
  }

  async lookup(value = this.code): Promise<void> {
    const session = this.store.active();
    if (
      !session ||
      this.saving() ||
      this.loadingProduct() ||
      this.modalOpen() ||
      this.scanner.busy()
    )
      return;
    const request = ++this.request;
    this.lookupAbort = new AbortController();
    this.pendingCode = '';
    this.error.set('');
    this.suggestion.set(null);
    this.photoEdit.set(null);
    this.photoPreparing.set(false);
    this.lookupNotice.set('');
    this.loadingProduct.set(true);
    try {
      const code = parseBarcode(value);
      this.pendingCode = code;
      let product = await this.catalog.find(code);
      if (request !== this.request || this.store.active()?.id !== session.id) return;
      let suggestion = product
        ? null
        : await this.onlineCatalog.lookup(code, this.lookupAbort.signal);
      if (request !== this.request || this.store.active()?.id !== session.id) return;
      if (suggestion?.measurementType === 'WEIGHT') {
        this.error.set(
          'Este produto é vendido por peso. Adicione pelo Carrinho para informar o peso e o preço por kg.',
        );
        return;
      }
      if (suggestion?.status === 'FOUND') {
        const received = await this.catalog.find(code);
        if (request !== this.request || this.store.active()?.id !== session.id) return;
        if (received) {
          product = received;
          suggestion = null;
        }
      }
      const lastPrice = product ? await this.catalog.lastPrice(code, session.supermarketId) : null;
      if (request !== this.request || this.store.active()?.id !== session.id) return;
      this.sessionId = session.id;
      this.productCode = code;
      this.name = product?.name ?? suggestion?.name ?? '';
      this.price = '';
      this.quantity = '1';
      this.known.set(product !== null || suggestion?.status === 'FOUND');
      this.suggestion.set(suggestion?.status === 'FOUND' ? suggestion : null);
      this.imageFailed.set(false);
      this.lookupNotice.set(suggestion ? this.suggestionNotice(suggestion.status) : '');
      this.editingName.set(false);
      this.lastPrice.set(lastPrice);
      this.formError.set('');
      this.modalOpen.set(true);
    } catch (error) {
      if (request === this.request)
        this.error.set(
          error instanceof Error && error.message.startsWith('Informe')
            ? error.message
            : 'Não foi possível consultar seus produtos locais. Tente novamente.',
        );
    } finally {
      if (request === this.request) this.loadingProduct.set(false);
    }
  }

  useManualEntry(): void {
    const session = this.store.active();
    if (!session || !this.loadingProduct() || !this.pendingCode) return;
    ++this.request;
    this.lookupAbort?.abort();
    this.loadingProduct.set(false);
    this.sessionId = session.id;
    this.productCode = this.pendingCode;
    this.name = this.price = '';
    this.quantity = '1';
    this.known.set(false);
    this.suggestion.set(null);
    this.lastPrice.set(null);
    this.editingName.set(false);
    this.formError.set('');
    this.lookupNotice.set('Preencha os dados da embalagem para continuar.');
    this.modalOpen.set(true);
  }

  private suggestionNotice(status: CatalogSuggestion['status']): string {
    return {
      FOUND: 'Confira os dados da embalagem e informe o preço de hoje.',
      NOT_FOUND: 'Produto não encontrado no catálogo online. Cadastre os dados da embalagem.',
      UNAVAILABLE: 'O catálogo online está indisponível. Você pode cadastrar o produto agora.',
      RATE_LIMITED:
        'O catálogo online atingiu o limite de consultas. Você pode cadastrar o produto agora.',
      DISABLED:
        'Consulta online não habilitada. Cadastre o produto para reconhecer depois offline.',
    }[status];
  }

  changeQuantity(delta: -1 | 1): void {
    if (this.saving()) return;
    try {
      const next = parseItemQuantity(this.quantity) + delta;
      if (next >= 1 && next <= 9999) this.quantity = String(next);
      this.formError.set('');
    } catch {
      this.formError.set('Informe uma quantidade entre 1 e 9999.');
    }
  }

  async save(): Promise<void> {
    if (this.saving() || this.photoPreparing()) return;
    const form = {
      sessionId: this.sessionId,
      request: this.request,
      code: this.productCode,
      name: this.name,
      price: this.price,
      quantity: this.quantity,
      photo: this.photoEdit(),
      source: this.suggestion()?.source,
    };
    this.saving.set(true);
    this.formError.set('');
    try {
      const sessionId = form.sessionId;
      if (this.store.active()?.id !== sessionId)
        throw new Error('Comece uma compra antes de adicionar produtos.');
      if (form.source === 'PERSONAL' && !(await this.catalog.find(form.code))) {
        this.formError.set(
          'Este produto já está no servidor. Aguarde a sincronização do catálogo antes de adicionar para evitar um cadastro duplicado.',
        );
        return;
      }
      if (this.store.active()?.id !== sessionId)
        throw new Error('Comece uma compra antes de adicionar produtos.');
      await this.store.saveItem(
        form.name,
        parseItemPrice(form.price),
        parseItemQuantity(form.quantity),
        undefined,
        form.code,
      );
      const target = { barcode: form.code, itemId: null, name: form.name };
      try {
        const edit = form.photo;
        if (edit?.kind === 'SET') await this.photos.save(edit.photo, target);
        else if (edit?.kind === 'REMOVE') await this.photos.remove(target);
        else if (edit?.kind === 'RESTORE') await this.photos.restoreCatalog(target);
        else void this.photos.cacheCatalog(target).catch(() => undefined);
      } catch {
        this.error.set(
          'Produto salvo. Não foi possível salvar a foto; tente novamente na edição do Carrinho.',
        );
      }
      if (form.request === this.request) {
        this.modalOpen.set(false);
        this.code = '';
      }
    } catch (error) {
      this.formError.set(
        error instanceof Error && /Informe|Comece/.test(error.message)
          ? error.message
          : 'Não foi possível salvar o produto. Tente novamente.',
      );
      return;
    } finally {
      this.saving.set(false);
    }
    try {
      const toast = await this.toasts.create({
        message: 'Produto adicionado ao carrinho.',
        duration: 2000,
        position: 'top',
      });
      await toast.present();
    } catch {
      this.error.set('Produto salvo. Consulte o Carrinho para ver o total.');
    }
  }

  async onProductDismiss(): Promise<void> {
    this.modalOpen.set(false);
    if (this.resumeCamera && !document.hidden && !this.saving() && this.store.active()) {
      this.resumeCamera = false;
      await this.scan();
    }
  }

  async settings(): Promise<void> {
    try {
      await this.scanner.openSettings();
    } catch {
      this.error.set('Abra as configurações do Carrim no aparelho para permitir a câmera.');
    }
  }
}
