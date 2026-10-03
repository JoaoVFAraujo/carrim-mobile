import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { vi } from 'vitest';
import { CartPage } from './cart.page';
import { ShoppingSessionStore } from '../services/shopping-session.store';

describe('cart completion confirmation', () => {
  function setup() {
    const complete = vi.fn().mockResolvedValue(undefined);
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const toast = { present: vi.fn().mockResolvedValue(undefined) };
    const alert = {
      present: vi.fn().mockResolvedValue(undefined),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' }),
    };
    const create = vi.fn().mockResolvedValue(alert);
    TestBed.configureTestingModule({
      providers: [
        CartPage,
        { provide: ShoppingSessionStore, useValue: { items: signal([{}]), complete } },
        { provide: AlertController, useValue: { create } },
        { provide: ToastController, useValue: { create: vi.fn().mockResolvedValue(toast) } },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    return { page: TestBed.inject(CartPage), complete, navigateByUrl, alert, create, toast };
  }

  it('opens one confirmation for repeated taps and preserves the cart on cancel', async () => {
    const { page, complete, alert, create } = setup();
    let dismiss!: (result: { role: string }) => void;
    alert.onDidDismiss.mockImplementation(() => new Promise((resolve) => (dismiss = resolve)));
    const first = page.confirmComplete();
    await page.confirmComplete();
    await Promise.resolve();
    expect(create).toHaveBeenCalledTimes(1);
    dismiss({ role: 'cancel' });
    await first;
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps the cart visible and reports persistence failures', async () => {
    const { page, complete, navigateByUrl, toast } = setup();
    complete.mockRejectedValue(new Error('disk full'));
    await page.confirmComplete();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(toast.present).not.toHaveBeenCalled();
    expect(page.actionError()).toContain('Não foi possível finalizar');
    expect(page.saving()).toBe(false);
  });

  it('reports a saved purchase correctly if navigation fails', async () => {
    const { page, complete, navigateByUrl } = setup();
    navigateByUrl.mockRejectedValue(new Error('navigation failed'));
    await page.confirmComplete();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(page.actionError()).toContain('Compra salva');
    expect(page.saving()).toBe(false);
  });
});
