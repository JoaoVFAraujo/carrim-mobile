import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonModal,
} from '@ionic/angular';
import { receiptOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';
import { CompletedShopping } from '../../shopping/models/completed-shopping';
import { ShoppingItem, itemSubtotalCents } from '../../shopping/models/shopping-item';

@Component({
  selector: 'app-history',
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    IonButtons,
    IonModal,
    RouterLink,
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    EmptyStateComponent,
  ],
  templateUrl: './history.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage {
  readonly subtotal = itemSubtotalCents;
  readonly emptyIcon = receiptOutline;
  readonly store = inject(ShoppingSessionStore);
  readonly selected = signal<CompletedShopping | null>(null);
  readonly items = signal<ShoppingItem[]>([]);
  readonly loadingDetails = signal(false);
  readonly detailError = signal('');
  private request = 0;

  ionViewWillEnter(): void {
    void this.store.load();
  }

  async open(shopping: CompletedShopping): Promise<void> {
    const request = ++this.request;
    this.selected.set(shopping);
    this.items.set([]);
    this.detailError.set('');
    this.loadingDetails.set(true);
    try {
      const items = await this.store.completedItems(shopping.id);
      if (request === this.request) this.items.set(items);
    } catch {
      if (request === this.request)
        this.detailError.set('Não foi possível abrir os itens. Tente novamente.');
    } finally {
      if (request === this.request) this.loadingDetails.set(false);
    }
  }

  close(): void {
    ++this.request;
    this.selected.set(null);
  }
}
