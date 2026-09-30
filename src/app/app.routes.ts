import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tabs/home' },
  {
    path: 'tabs',
    loadComponent: () => import('./features/tabs/pages/tabs.page').then((m) => m.TabsPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        loadComponent: () => import('./features/home/pages/home.page').then((m) => m.HomePage),
      },
      {
        path: 'scanner',
        loadComponent: () =>
          import('./features/scanner/pages/scanner.page').then((m) => m.ScannerPage),
      },
      {
        path: 'cart',
        loadComponent: () => import('./features/shopping/pages/cart.page').then((m) => m.CartPage),
      },
      {
        path: 'history',
        loadComponent: () =>
          import('./features/history/pages/history.page').then((m) => m.HistoryPage),
      },
    ],
  },
  { path: '**', redirectTo: 'tabs/home' },
];
