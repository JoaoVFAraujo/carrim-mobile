import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
  IonSegment,
  IonSegmentButton,
  IonLabel,
} from '@ionic/angular';
import { receiptOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';
import { CompletedShopping } from '../../shopping/models/completed-shopping';
import { ShoppingItem, itemSubtotalCents } from '../../shopping/models/shopping-item';
import { groupHistory, HistoryPeriod } from '../models/history-groups';

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
    IonSegment,
    IonSegmentButton,
    IonLabel,
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
  readonly period = signal<HistoryPeriod>('all');
  private readonly today = signal(new Date());
  readonly groups = computed(() => groupHistory(this.store.history(), this.period(), this.today()));
  readonly selected = signal<CompletedShopping | null>(null);
  readonly items = signal<ShoppingItem[]>([]);
  readonly loadingDetails = signal(false);
  readonly detailError = signal('');
  private request = 0;

  ionViewWillEnter(): void {
    this.today.set(new Date());
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
