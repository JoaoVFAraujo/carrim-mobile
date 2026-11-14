import { provideHttpClient, withFetch } from '@angular/common/http';
import { Component, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { IonApp, IonRouterOutlet, IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { PhotoAdminPage } from './app/features/photo-admin/pages/photo-admin.page';
import { PHOTO_ADMIN_STANDALONE } from './app/features/photo-admin/pages/photo-admin-mode';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  template: '<ion-app><ion-router-outlet /></ion-app>',
})
class PhotoAdminApp {}

void fetch('/api/status', { cache: 'no-store', credentials: 'omit' }).catch(() => undefined);

bootstrapApplication(PhotoAdminApp, {
  providers: [
    provideHttpClient(withFetch()),
    provideZoneChangeDetection(),
    provideIonicAngular({
      animated: !globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: PHOTO_ADMIN_STANDALONE, useValue: true },
    provideRouter([
      { path: 'admin/fotos', component: PhotoAdminPage },
      { path: '', pathMatch: 'full', redirectTo: 'admin/fotos' },
    ]),
  ],
}).catch(() => console.error('Não foi possível iniciar a revisão de fotos.'));
