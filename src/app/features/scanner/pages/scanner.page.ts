import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { barcodeOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';

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
  ],
  templateUrl: './scanner.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerPage {
  readonly emptyIcon = barcodeOutline;
}
