import { signal } from '@angular/core';
import { ShoppingSessionStore } from './features/shopping/services/shopping-session.store';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { App } from './app';
import { appConfig } from './app.config';

describe('Tab navigation', () => {
  it('keeps all four tabs available through empty pages and direct URLs', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        ...appConfig.providers,
        {
          provide: ShoppingSessionStore,
          useValue: {
            active: signal(null),
            supermarkets: signal([]),
            loading: signal(false),
            error: signal(''),
            load: async () => undefined,
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
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
  });
});
