import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
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
} from '@ionic/angular';
import { cartOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ShoppingSessionStore } from '../services/shopping-session.store';
import { ShoppingItem, parseItemPrice, parseItemQuantity } from '../models/shopping-item';

@Component({
  selector: 'app-cart',
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    IonModal,
    IonInput,
    FormsModule,
    RouterLink,
    CurrencyPipe,
    EmptyStateComponent,
  ],
  templateUrl: './cart.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CartPage {
  readonly emptyIcon = cartOutline;
  readonly store = inject(ShoppingSessionStore);
  private readonly alerts = inject(AlertController);
  readonly modalOpen = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly actionError = signal('');
  editingId?: string;
  name = '';
  price = '';
  quantity = '1';

  ionViewWillEnter(): void {
    void this.store.load();
  }

  openItem(item?: ShoppingItem): void {
    this.editingId = item?.id;
    this.name = item?.name ?? '';
    this.price = item ? (item.unitPriceCents / 100).toFixed(2).replace('.', ',') : '';
    this.quantity = String(item?.quantity ?? 1);
    this.formError.set('');
    this.modalOpen.set(true);
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.formError.set('');
    try {
      await this.store.saveItem(
        this.name,
        parseItemPrice(this.price),
        parseItemQuantity(this.quantity),
        this.editingId,
      );
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
