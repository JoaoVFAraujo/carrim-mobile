import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { barcodeOutline, cartOutline, homeOutline, receiptOutline } from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
  templateUrl: './tabs.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabsPage {
  constructor() {
    addIcons({ homeOutline, barcodeOutline, cartOutline, receiptOutline });
  }
}
