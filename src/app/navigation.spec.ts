import { signal } from '@angular/core';
import { ShoppingSessionStore } from './features/shopping/services/shopping-session.store';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { App } from './app';
import { appConfig } from './app.config';
import { provideIonicAngular } from '@ionic/angular';
import { BARCODE_SCANNER, SCANNER_APP } from './features/scanner/services/barcode-scanner.service';
import { NATIVE_CREDENTIAL_STORAGE } from './core/api/credential-vault';

describe('Tab navigation', () => {
  it('keeps all four tabs available through empty pages and direct URLs', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        ...appConfig.providers,
        provideIonicAngular({ animated: false }),
        {
          provide: ShoppingSessionStore,
          useValue: {
            active: signal(null),
            supermarkets: signal([]),
            history: signal([]),
            loading: signal(false),
            error: signal(''),
            load: async () => undefined,
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    // Raw Capacitor proxies would synthesize ngOnDestroy and throw during Angular teardown.
    for (const adapter of [
      TestBed.inject(BARCODE_SCANNER),
      TestBed.inject(SCANNER_APP),
      TestBed.inject(NATIVE_CREDENTIAL_STORAGE),
    ]) {
      expect('ngOnDestroy' in adapter).toBe(false);
      expect((adapter as { ngOnDestroy?: unknown }).ngOnDestroy).toBeUndefined();
    }
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const page: HTMLElement = fixture.nativeElement;

    for (const [path, selector, message] of [
      ['/tabs/home', 'app-home', 'Pronto para fazer suas compras?'],
      ['/tabs/scanner', 'app-scanner', 'Nenhuma compra em andamento'],
      ['/tabs/cart', 'app-cart', 'Seu carrinho está vazio'],
      ['/tabs/history', 'app-history', 'Nenhuma compra finalizada ainda'],
    ]) {
      await router.navigateByUrl(path);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(router.url).toBe(path);
      expect(page.querySelector(selector)?.textContent).toContain(message);
      expect(page.querySelectorAll('ion-tab-button').length).toBe(4);
    }

    await router.navigateByUrl('/');
    await fixture.whenStable();
    expect(router.url).toBe('/tabs/home');
    await router.navigateByUrl('/unknown');
    await fixture.whenStable();
    expect(router.url).toBe('/tabs/home');
    // Angular stability does not cover lazy hydration of Ionic custom elements.
    await Promise.all(
      Array.from(
        page.querySelectorAll<HTMLElement & { componentOnReady?: () => Promise<unknown> }>('*'),
      ).map((element) => element.componentOnReady?.()),
    );
    await fixture.whenRenderingDone();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    router.dispose();
    fixture.destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
});
