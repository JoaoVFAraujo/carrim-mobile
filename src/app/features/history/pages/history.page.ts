import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { receiptOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-history',
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButton,
    RouterLink,
    EmptyStateComponent,
  ],
  templateUrl: './history.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage {
  readonly emptyIcon = receiptOutline;
}
