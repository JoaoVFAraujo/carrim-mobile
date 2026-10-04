import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CurrencyPipe, DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonModal,
  IonInput,
  AlertController,
  ToastController,
  IonProgressBar,
  IonFooter,
  IonSelect,
  IonSelectOption,
  IonList,
  IonItem,
  IonLabel,
} from '@ionic/angular';
import { cartOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ShoppingSessionStore } from '../services/shopping-session.store';
import { parseCheckoutTotal } from '../models/shopping-session';
import { ProductCatalogService } from '../../scanner/services/product-catalog.service';
import { CatalogProduct, LastProductPrice } from '../../scanner/models/catalog-product';
import {
  ShoppingItem,
  parseItemPrice,
  parseItemQuantity,
  parseWeightGrams,
  itemSubtotalCents,
} from '../models/shopping-item';

@Component({
  selector: 'app-cart',
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    IonProgressBar,
    IonFooter,
    IonModal,
    IonInput,
    FormsModule,
    RouterLink,
    CurrencyPipe,
    DecimalPipe,
    IonSelect,
    IonSelectOption,
    IonList,
    IonItem,
    IonLabel,
    DatePipe,
    EmptyStateComponent,
  ],
  templateUrl: './cart.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CartPage {
  readonly emptyIcon = cartOutline;
  readonly store = inject(ShoppingSessionStore);
  private readonly alerts = inject(AlertController);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastController);
  private readonly catalog = inject(ProductCatalogService);
  readonly catalogResults = signal<CatalogProduct[]>([]);
  readonly catalogLoading = signal(false);
  readonly catalogError = signal('');
  readonly previousPrice = signal<LastProductPrice | null>(null);
  catalogBarcode?: string;
  private catalogRequest = 0;
  private confirming = false;
  readonly modalOpen = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly actionError = signal('');
  editingId?: string;
  name = '';
  price = '';
  quantity = '1';
  measurementType: 'UNIT' | 'WEIGHT' = 'UNIT';
  weight = '';
  pricingType: 'REGULAR' | 'BUNDLE' = 'REGULAR';
  bundleQuantity = '3';
  readonly subtotal = itemSubtotalCents;

  ionViewWillEnter(): void {
    void this.store.load();
  }

  openItem(item?: ShoppingItem): void {
    ++this.catalogRequest;
    this.catalogResults.set([]);
    this.catalogLoading.set(false);
    this.catalogError.set('');
    this.previousPrice.set(null);
    this.catalogBarcode = undefined;
    this.editingId = item?.id;
    this.name = item?.name ?? '';
    this.price = item ? (item.unitPriceCents / 100).toFixed(2).replace('.', ',') : '';
    this.quantity = String(item?.quantity ?? 1);
    this.measurementType = item?.measurementType ?? 'UNIT';
    this.pricingType = item?.pricingType ?? 'REGULAR';
    this.bundleQuantity = String(item?.bundleQuantity ?? 3);
    this.weight = item?.weightGrams ? (item.weightGrams / 1000).toFixed(3).replace('.', ',') : '';
    this.formError.set('');
    this.modalOpen.set(true);
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.formError.set('');
    try {
      if (this.measurementType === 'WEIGHT') {
        await this.store.saveWeightItem(
          this.name,
          parseItemPrice(this.price),
          parseWeightGrams(this.weight),
          this.editingId,
          this.catalogBarcode,
        );
      } else if (this.pricingType === 'BUNDLE') {
        await this.store.saveBundleItem(
          this.name,
          parseItemQuantity(this.bundleQuantity),
          parseItemPrice(this.price),
          parseItemQuantity(this.quantity),
          this.editingId,
          this.catalogBarcode,
        );
      } else {
        await this.store.saveItem(
          this.name,
          parseItemPrice(this.price),
          parseItemQuantity(this.quantity),
          this.editingId,
          this.catalogBarcode,
        );
      }
      this.modalOpen.set(false);
    } catch (error) {
      this.formError.set(
        error instanceof Error && /Informe|Comece|Produto não/.test(error.message)
          ? error.message
          : 'Não foi possível salvar o produto. Tente novamente.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  quantityStep(item: ShoppingItem): number {
    return item.pricingType === 'BUNDLE' ? item.bundleQuantity! : 1;
  }

  async searchCatalog(value: string): Promise<void> {
    const request = ++this.catalogRequest;
    this.catalogResults.set([]);
    this.catalogError.set('');
    this.catalogLoading.set(value.trim().length >= 2);
    try {
      const products = await this.catalog.search(value);
      if (request === this.catalogRequest && this.modalOpen()) this.catalogResults.set(products);
    } catch {
      if (request === this.catalogRequest)
        this.catalogError.set(
          'Não foi possível consultar o catálogo. Você pode preencher o produto manualmente.',
        );
    } finally {
      if (request === this.catalogRequest) this.catalogLoading.set(false);
    }
  }

  async selectCatalogProduct(product: CatalogProduct): Promise<void> {
    const request = ++this.catalogRequest;
    const session = this.store.active();
    this.catalogResults.set([]);
    this.catalogLoading.set(false);
    this.catalogError.set('');
    this.previousPrice.set(null);
    this.catalogBarcode = product.barcode;
    this.name = product.name;
    this.price = '';
    this.quantity = '1';
    this.measurementType = 'UNIT';
    this.pricingType = 'REGULAR';
    try {
      const previous = session
        ? await this.catalog.lastPrice(product.barcode, session.supermarketId)
        : null;
      if (
        request === this.catalogRequest &&
        this.modalOpen() &&
        this.store.active()?.id === session?.id
      )
        this.previousPrice.set(previous);
    } catch {
      if (request === this.catalogRequest)
        this.catalogError.set(
          'Não foi possível consultar o preço anterior. Informe o preço de hoje.',
        );
    }
  }

  clearCatalogProduct(): void {
    ++this.catalogRequest;
    this.catalogBarcode = undefined;
    this.previousPrice.set(null);
    this.catalogResults.set([]);
    this.catalogLoading.set(false);
    this.catalogError.set('');
  }

  async changeQuantity(item: ShoppingItem, direction: -1 | 1): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      await this.store.changeQuantity(item.id, direction);
    } catch {
      this.actionError.set('Não foi possível alterar a quantidade. Tente novamente.');
    } finally {
      this.saving.set(false);
    }
  }

  async confirmComplete(): Promise<void> {
    if (this.saving() || this.confirming || !this.store.items().length) return;
    this.confirming = true;
    try {
      let checkoutTotalCents: number | null = null;
      const alert: HTMLIonAlertElement = await this.alerts.create({
        header: 'Finalizar compra?',
        message:
          'A compra será salva neste aparelho e ficará disponível no Histórico. Seus itens não poderão mais ser alterados. O total do caixa é opcional e serve apenas para comparação.',
        inputs: [
          {
            name: 'checkoutTotal',
            type: 'text',
            placeholder: 'Total do caixa (opcional)',
            attributes: { inputmode: 'decimal', 'aria-label': 'Total do caixa (opcional)' },
          },
        ],
        buttons: [
          { text: 'Continuar comprando', role: 'cancel' },
          {
            text: 'Finalizar',
            role: 'confirm',
            handler: (data: { checkoutTotal?: string }) => {
              try {
                checkoutTotalCents = parseCheckoutTotal(data.checkoutTotal ?? '');
                return true;
              } catch (error) {
                alert.message =
                  error instanceof Error ? error.message : 'Informe um total do caixa válido.';
                return false;
              }
            },
          },
        ],
      });
      await alert.present();
      const result = await alert.onDidDismiss();
      if (result.role !== 'confirm' || this.saving()) return;
      this.saving.set(true);
      this.actionError.set('');
      try {
        await this.store.complete(checkoutTotalCents);
      } catch {
        this.actionError.set('Não foi possível finalizar a compra. Tente novamente.');
        return;
      } finally {
        this.saving.set(false);
      }
      try {
        await this.router.navigateByUrl('/tabs/history');
        const toast = await this.toasts.create({
          message: 'Compra finalizada e salva neste aparelho.',
          duration: 3000,
          position: 'top',
        });
        await toast.present();
      } catch {
        this.actionError.set('Compra salva. Abra o Histórico para consultar os itens.');
      }
    } finally {
      this.confirming = false;
    }
  }

  async confirmRemove(item: ShoppingItem): Promise<void> {
    if (this.saving()) return;
    const alert = await this.alerts.create({
      header: 'Remover produto?',
      message: 'O item será retirado desta compra.',
      buttons: [
        { text: 'Manter', role: 'cancel' },
        { text: 'Remover', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm' || this.saving()) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      await this.store.removeItem(item.id);
    } catch {
      this.actionError.set('Não foi possível remover o produto. Tente novamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
