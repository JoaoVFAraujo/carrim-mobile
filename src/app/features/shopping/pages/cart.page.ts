import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrencyPipe } from '@angular/common';
import { IonButton, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { cartOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ShoppingSessionStore } from '../services/shopping-session.store';

@Component({
  selector: 'app-cart',
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
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

  ionViewWillEnter(): void {
    void this.store.load();
  }
}
