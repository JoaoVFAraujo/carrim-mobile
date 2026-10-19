import { MaskitoDirective } from '@maskito/angular';
import { brlMask, ionInputElement } from '../../../shared/brl-mask';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardContent,
  IonModal,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonSkeletonText,
  IonProgressBar,
  IonIcon,
} from '@ionic/angular';
import { cartOutline, chevronForwardOutline, person } from 'ionicons/icons';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';
import { SyncStatusService } from '../../../core/sync/sync-status.service';
import { parseBudget } from '../../shopping/models/shopping-session';
import { SyncReviewComponent } from '../components/sync-review.component';

@Component({
  selector: 'app-home',
  imports: [
    MaskitoDirective,
    SyncReviewComponent,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    IonCard,
    IonCardContent,
    IonModal,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonSkeletonText,
    IonProgressBar,
    IonIcon,
    RouterLink,
    CurrencyPipe,
    DatePipe,
    FormsModule,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  readonly brlMask = brlMask;
  readonly ionInputElement = ionInputElement;
  readonly syncStatus = inject(SyncStatusService);
  readonly store = inject(ShoppingSessionStore);
  readonly cartIcon = cartOutline;
  readonly chevronIcon = chevronForwardOutline;
  readonly personIcon = person;
  readonly modalOpen = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  supermarketId = '';
  supermarketName = '';
  budget = '';

  ionViewWillEnter(): void {
    void this.store.load();
  }

  openNewShopping(): void {
    this.supermarketId = this.store.supermarkets()[0]?.id ?? '';
    this.supermarketName = '';
    this.budget = '';
    this.formError.set('');
    this.modalOpen.set(true);
  }

  async startShopping(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.formError.set('');
    try {
      await this.store.create(this.supermarketId, this.supermarketName, parseBudget(this.budget));
      this.modalOpen.set(false);
    } catch (error) {
      this.formError.set(
        error instanceof Error && /Informe|Você já/.test(error.message)
          ? error.message
          : 'Não foi possível salvar a compra. Tente novamente.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
