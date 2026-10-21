import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { vi } from 'vitest';
import { CartPage } from './cart.page';
import { ShoppingSessionStore } from '../services/shopping-session.store';
import { ProductCatalogService } from '../../scanner/services/product-catalog.service';
import { ProductPhotoService } from '../../../core/photos/product-photo.service';

beforeEach(() =>
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ProductPhotoService,
        useValue: {
          save: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
          restoreCatalog: vi.fn().mockResolvedValue(undefined),
          cacheCatalog: vi.fn().mockResolvedValue(undefined),
        },
      },
    ],
  }),
);

describe('photo target identity', () => {
  it('uses the returned saved item id instead of looking in a new purchase after navigation', async () => {
    const active = signal({ id: 'original-session' });
    let resolve!: (id: string) => void;
    const saveItem = vi.fn(() => new Promise<string>((done) => (resolve = done)));
    TestBed.configureTestingModule({
      providers: [
        CartPage,
        { provide: ShoppingSessionStore, useValue: { active, saveItem, items: signal([]) } },
      ],
    });
    const page = TestBed.inject(CartPage);
    page.openItem();
    page.name = 'Foto manual';
    page.price = '1,99';
    const photo = {
      imageBase64: '/9j/2Q==',
      contentType: 'image/jpeg' as const,
      width: 1,
      height: 1,
    };
    page.photoEdit.set({ kind: 'SET', photo });
    const pending = page.save();
    page.ionViewWillLeave();
    active.set({ id: 'new-session' });
    page.name = 'Outro';
    resolve('a0000000-0000-4000-8000-000000000001');
    await pending;
    expect(TestBed.inject(ProductPhotoService).save).toHaveBeenCalledWith(photo, {
      barcode: null,
      itemId: 'a0000000-0000-4000-8000-000000000001',
      name: 'Foto manual',
    });
  });
});

describe('cart completion confirmation', () => {
  function setup() {
    const complete = vi.fn().mockResolvedValue(undefined);
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const toast = { present: vi.fn().mockResolvedValue(undefined) };
    const alert = {
      querySelector: vi.fn().mockReturnValue(null),
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
    expect(handler({ checkoutTotal: 'R$ 24,09' })).toBe(true);
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

describe('purchase controls', () => {
  function setup() {
    const active = signal({ id: 's', budgetCents: 10000 });
    const changeBudget = vi.fn().mockResolvedValue(undefined),
      cancel = vi.fn().mockResolvedValue(undefined);
    const alert = {
      querySelector: vi.fn().mockReturnValue(null),
      present: vi.fn(),
      onDidDismiss: vi.fn().mockResolvedValue({ role: 'confirm' }),
      message: '',
    };
    const create = vi.fn().mockResolvedValue(alert);
    TestBed.configureTestingModule({
      providers: [
        CartPage,
        { provide: ShoppingSessionStore, useValue: { active, changeBudget, cancel } },
        { provide: AlertController, useValue: { create } },
        { provide: ToastController, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });
    return { page: TestBed.inject(CartPage), active, changeBudget, cancel, alert, create };
  }
  it('keeps invalid money in the dialog and accepts blank to remove the limit', async () => {
    const { page, changeBudget, alert, create } = setup();
    alert.onDidDismiss.mockImplementation(async () => {
      const handler = create.mock.calls[0][0].buttons[1].handler;
      expect(handler({ budget: '-1' })).toBe(false);
      expect(handler({ budget: '12,34' })).toBe(true);
      expect(handler({ budget: '' })).toBe(true);
      return { role: 'confirm' };
    });
    await page.editBudget();
    expect(changeBudget).toHaveBeenCalledWith(null);
  });
  it('cancels only after confirmation and shares no duplicate dialogs', async () => {
    const { page, cancel, alert, create } = setup();
    alert.onDidDismiss.mockResolvedValue({ role: 'cancel' });
    await Promise.all([page.confirmCancel(), page.confirmCancel()]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });
  it('reports cancellation failure without claiming success', async () => {
    const { page, cancel } = setup();
    cancel.mockRejectedValue(new Error('disk'));
    await page.confirmCancel();
    expect(page.actionError()).toContain('Não foi possível cancelar');
    expect(page.saving()).toBe(false);
  });
});

describe('cart contextual menus', () => {
  function setup() {
    const active = signal({ id: 's', budgetCents: null });
    const items = signal([
      { id: 'i', sessionId: 's', name: 'Arroz', unitPriceCents: 100, quantity: 1 },
    ]);
    const sheet = { present: vi.fn(), onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' }) };
    const create = vi.fn().mockResolvedValue(sheet);
    TestBed.configureTestingModule({
      providers: [
        CartPage,
        { provide: ShoppingSessionStore, useValue: { active, items } },
        { provide: ActionSheetController, useValue: { create } },
        { provide: AlertController, useValue: {} },
        { provide: ToastController, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });
    return { page: TestBed.inject(CartPage), active, items, sheet, create };
  }
  it('opens one purchase menu and dismisses without changing the purchase', async () => {
    const { page, create } = setup();
    const cancel = vi.spyOn(page, 'confirmCancel');
    await Promise.all([page.shoppingOptions(), page.shoppingOptions()]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });
  it('keeps destructive item actions behind their existing confirmation', async () => {
    const { page, items, sheet } = setup();
    sheet.onDidDismiss.mockResolvedValue({ role: 'destructive' });
    const confirmation = vi.spyOn(page, 'confirmRemove').mockResolvedValue();
    await page.itemOptions(items()[0]);
    expect(confirmation).toHaveBeenCalledWith(items()[0]);
  });
  it('refuses a menu action when its purchase was replaced while open', async () => {
    const { page, active, sheet } = setup();
    sheet.onDidDismiss.mockImplementation(async () => {
      active.set({ id: 'other', budgetCents: null });
      return { role: 'budget' };
    });
    const edit = vi.spyOn(page, 'editBudget').mockResolvedValue();
    await page.shoppingOptions();
    expect(edit).not.toHaveBeenCalled();
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
        {
          provide: ShoppingSessionStore,
          useValue: { active: signal({ id: 's' }), saveWeightItem, saveItem, saveBundleItem },
        },
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
    expect(saveWeightItem).toHaveBeenCalledWith('Banana', 699, 500, 'banana', undefined);
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
    expect(saveBundleItem).toHaveBeenCalledWith('Milk', 3, 1000, 9, 'milk', undefined);
    expect(saveItem).not.toHaveBeenCalled();
  });
});

describe('cart catalog reuse', () => {
  function setup() {
    const search = vi.fn();
    const lastPrice = vi.fn().mockResolvedValue({ unitPriceCents: 1749, recordedAt: 1 });
    const saveItem = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        CartPage,
        { provide: ProductCatalogService, useValue: { search, lastPrice } },
        {
          provide: ShoppingSessionStore,
          useValue: { active: signal({ id: 's', supermarketId: 'm' }), saveItem },
        },
        { provide: AlertController, useValue: {} },
        { provide: ToastController, useValue: {} },
        { provide: Router, useValue: {} },
      ],
    });
    return { page: TestBed.inject(CartPage), search, lastPrice, saveItem };
  }
  it('ignores an older search after another query or form reopening', async () => {
    const { page, search } = setup();
    page.openItem();
    let resolve!: (products: unknown[]) => void;
    search
      .mockImplementationOnce(() => new Promise((done) => (resolve = done)))
      .mockResolvedValueOnce([]);
    const old = page.searchCatalog('Coffee');
    await page.searchCatalog('Milk');
    resolve([{ id: 'p' }]);
    await old;
    expect(page.catalogResults()).toEqual([]);
    expect(page.catalogLoading()).toBe(false);
  });
  it('requires today price and saves the selected barcode while previous price stays a reference', async () => {
    const { page, lastPrice, saveItem } = setup();
    page.openItem();
    page.price = '9,99';
    await page.selectCatalogProduct({ id: 'p', name: 'Coffee', barcode: '0789600112233' });
    expect(lastPrice).toHaveBeenCalledWith('0789600112233', 'm');
    expect(page.price).toBe('');
    expect(page.previousPrice()?.unitPriceCents).toBe(1749);
    await page.save();
    expect(saveItem).not.toHaveBeenCalled();
    page.price = '18,00';
    await page.save();
    expect(saveItem).toHaveBeenCalledWith('Coffee', 1800, 1, undefined, '0789600112233');
  });
});
