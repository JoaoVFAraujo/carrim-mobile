import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';
import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonModal,
  IonInput,
  IonIcon,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { barcodeOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { BarcodeScannerService } from '../services/barcode-scanner.service';
import { ProductCatalogService } from '../services/product-catalog.service';
import { LastProductPrice, parseBarcode } from '../models/catalog-product';
import { parseItemPrice, parseItemQuantity } from '../../shopping/models/shopping-item';

@Component({
  selector: 'app-scanner',
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    RouterLink,
    EmptyStateComponent,
    IonButtons,
    IonModal,
    IonInput,
    IonIcon,
    FormsModule,
    CurrencyPipe,
    DatePipe,
  ],
  templateUrl: './scanner.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerPage {
  readonly emptyIcon = barcodeOutline;
  readonly store = inject(ShoppingSessionStore);
  readonly scanner = inject(BarcodeScannerService);
  private readonly catalog = inject(ProductCatalogService);
  private readonly toasts = inject(ToastController);
  readonly loadingProduct = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly known = signal(false);
  readonly error = signal('');
  readonly formError = signal('');
  readonly lastPrice = signal<LastProductPrice | null>(null);
  code = '';
  productCode = '';
  name = '';
  price = '';
  quantity = '1';
  private request = 0;
  private sessionId = '';
  private resumeCamera = false;

  constructor() {
    addIcons({ barcodeOutline });
  }

  ionViewWillEnter(): void {
    void this.store.load();
  }

  ionViewWillLeave(): void {
    ++this.request;
    this.resumeCamera = false;
    this.scanner.cancel();
    this.modalOpen.set(false);
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.hidden) this.scanner.cancel();
  }

  @HostListener('document:ionBackButton', ['$event'])
  onBack(event: Event): void {
    const detail = (
      event as CustomEvent<{ register: (priority: number, handler: () => void) => void }>
    ).detail;
    if (this.scanner.busy()) detail.register(100, () => this.scanner.cancel());
  }

  async scan(): Promise<void> {
    if (!this.store.active() || this.scanner.busy() || this.loadingProduct() || this.modalOpen())
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
    if (!session || this.loadingProduct() || this.modalOpen() || this.scanner.busy()) return;
    const request = ++this.request;
    this.error.set('');
    this.loadingProduct.set(true);
    try {
      const code = parseBarcode(value);
      const product = await this.catalog.find(code);
      const lastPrice = product ? await this.catalog.lastPrice(code, session.supermarketId) : null;
      if (request !== this.request || this.store.active()?.id !== session.id) return;
      this.sessionId = session.id;
      this.productCode = code;
      this.name = product?.name ?? '';
      this.price = '';
      this.quantity = '1';
      this.known.set(product !== null);
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
      this.loadingProduct.set(false);
    }
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.formError.set('');
    try {
      if (this.store.active()?.id !== this.sessionId)
        throw new Error('Comece uma compra antes de adicionar produtos.');
      await this.store.saveItem(
        this.name,
        parseItemPrice(this.price),
        parseItemQuantity(this.quantity),
        undefined,
        this.productCode,
      );
      this.modalOpen.set(false);
      this.code = '';
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
