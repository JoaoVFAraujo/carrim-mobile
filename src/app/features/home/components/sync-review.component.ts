import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  AlertController,
  IonButton,
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/angular';
import { SyncReviewService } from '../../../core/sync/sync-review.service';
import { SyncStatusService } from '../../../core/sync/sync-status.service';

@Component({
  selector: 'app-sync-review',
  templateUrl: './sync-review.component.html',
  imports: [DatePipe, IonButton, IonModal, IonHeader, IonToolbar, IonTitle, IonContent],
})
export class SyncReviewComponent {
  readonly review = inject(SyncReviewService);
  readonly status = inject(SyncStatusService);
  private readonly alerts = inject(AlertController);
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  async show(): Promise<void> {
    if (this.busy()) return;
    this.open.set(true);
    this.busy.set(true);
    this.error.set('');
    try {
      await this.review.load();
    } catch {
      this.error.set(
        'Não foi possível comparar as alterações agora. Suas compras continuam preservadas.',
      );
    } finally {
      this.busy.set(false);
    }
  }
  async confirm(): Promise<void> {
    if (this.busy() || !this.review.view()?.allowed) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const alert = await this.alerts.create({
        header: 'Reaplicar sua alteração?',
        message:
          'A alteração mostrada será enviada sobre a versão consultada. A revisão ficará guardada neste aparelho. As demais alterações do servidor serão mantidas.',
        buttons: [
          { text: 'Voltar', role: 'cancel' },
          { text: 'Reaplicar', role: 'confirm' },
        ],
      });
      await alert.present();
      if ((await alert.onDidDismiss()).role !== 'confirm') return;
      await this.review.confirm();
      this.open.set(false);
    } catch {
      this.error.set(
        'Os dados podem ter mudado. Feche e abra a revisão novamente antes de decidir.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
