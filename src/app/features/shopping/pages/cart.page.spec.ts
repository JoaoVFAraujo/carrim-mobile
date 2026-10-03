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

  it('keeps invalid checkout input in the alert and forwards exact cents only after confirmation', async () => {
    const { page, create, complete, alert } = setup();
    let dismiss!: (value: { role: string }) => void;
    alert.onDidDismiss.mockImplementation(() => new Promise((resolve) => (dismiss = resolve)));
    const pending = page.confirmComplete();
    await vi.waitFor(() => expect(alert.onDidDismiss).toHaveBeenCalled());
    const handler = create.mock.calls[0][0].buttons[1].handler;
    expect(handler({ checkoutTotal: '-1' })).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    expect(handler({ checkoutTotal: '24,09' })).toBe(true);
    dismiss({ role: 'confirm' });
    await pending;
    expect(complete).toHaveBeenCalledWith(2409);
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

describe('cart weight form', () => {
  function setup() {
    const saveWeightItem = vi.fn().mockResolvedValue(undefined);
    const saveBundleItem = vi.fn().mockResolvedValue(undefined);
    const saveItem = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        CartPage,
        { provide: ShoppingSessionStore, useValue: { saveWeightItem, saveItem, saveBundleItem } },
        { provide: AlertController, useValue: {} },
        { provide: ToastController, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });
    return { page: TestBed.inject(CartPage), saveWeightItem, saveItem, saveBundleItem };
  }
  it('edits a weight item using kg input and saves integer grams with its identity', async () => {
    const { page, saveWeightItem, saveItem } = setup();
    page.openItem({
      id: 'banana',
      sessionId: 's',
      name: 'Banana',
      unitPriceCents: 699,
      quantity: 1,
      measurementType: 'WEIGHT',
      weightGrams: 824,
    });
    expect(page.measurementType).toBe('WEIGHT');
    expect(page.weight).toBe('0,824');
    expect(page.price).toBe('6,99');
    page.weight = '0,500';
    await page.save();
    expect(saveWeightItem).toHaveBeenCalledWith('Banana', 699, 500, 'banana');
    expect(saveItem).not.toHaveBeenCalled();
    expect(page.modalOpen()).toBe(false);
  });
  it('keeps invalid weight visible without writing', async () => {
    const { page, saveWeightItem } = setup();
    page.openItem();
    page.measurementType = 'WEIGHT';
    page.name = 'Banana';
    page.price = '6,99';
    page.weight = '0,0001';
    await page.save();
    expect(saveWeightItem).not.toHaveBeenCalled();
    expect(page.formError()).toContain('peso');
    expect(page.modalOpen()).toBe(true);
  });
  it('edits a bundle keeping group price separate from its total quantity', async () => {
    const { page, saveBundleItem, saveItem } = setup();
    page.openItem({
      id: 'milk',
      sessionId: 's',
      name: 'Milk',
      unitPriceCents: 1000,
      quantity: 6,
      pricingType: 'BUNDLE',
      bundleQuantity: 3,
    });
    expect(page.pricingType).toBe('BUNDLE');
    expect(page.bundleQuantity).toBe('3');
    expect(page.price).toBe('10,00');
    page.quantity = '9';
    await page.save();
    expect(saveBundleItem).toHaveBeenCalledWith('Milk', 3, 1000, 9, 'milk');
    expect(saveItem).not.toHaveBeenCalled();
  });
});
