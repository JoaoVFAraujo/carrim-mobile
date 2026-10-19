import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { IonBadge, IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { barcodeOutline, cartOutline, homeOutline, timeOutline } from 'ionicons/icons';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';

@Component({
  selector: 'app-tabs',
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge],
  templateUrl: './tabs.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabsPage {
  readonly activeTabIndex = signal(0);
  selectTab(tab: string): void {
    const index = ['home', 'scanner', 'cart', 'history'].indexOf(tab);
    if (index !== -1) this.activeTabIndex.set(index);
  }
  readonly store = inject(ShoppingSessionStore);
  constructor() {
    addIcons({ homeOutline, barcodeOutline, cartOutline, timeOutline });
  }
}
