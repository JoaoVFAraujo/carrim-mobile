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
} from '@ionic/angular';
import { basketOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';
import { parseBudget } from '../../shopping/models/shopping-session';

@Component({
  selector: 'app-home',
  imports: [
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
    RouterLink,
    CurrencyPipe,
    DatePipe,
    FormsModule,
    EmptyStateComponent,
  ],
  templateUrl: './home.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  readonly store = inject(ShoppingSessionStore);
  readonly basketIcon = basketOutline;
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
