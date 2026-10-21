import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { vi } from 'vitest';
import { ScannerPage } from './scanner.page';
import { BarcodeScannerService } from '../services/barcode-scanner.service';
import { ProductCatalogService } from '../services/product-catalog.service';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';
import { CatalogLookupService, CatalogSuggestion } from '../services/catalog-lookup.service';

describe('scanner product confirmation', () => {
  function setup() {
    const active = signal({ id: 's', supermarketId: 'm' });
    const saveItem = vi.fn().mockResolvedValue(undefined);
    const find = vi.fn().mockResolvedValue({ id: 'p', barcode: '0789600112233', name: 'Coffee' });
    const lastPrice = vi.fn().mockResolvedValue({ unitPriceCents: 1899, recordedAt: 1 });
    const scanner = {
      busy: signal(false),
      cancel: vi.fn(),
      read: vi.fn().mockResolvedValue('0789600112233'),
    };
    const onlineLookup = vi.fn().mockResolvedValue({ status: 'DISABLED' });
    TestBed.configureTestingModule({
      providers: [
        ScannerPage,
        { provide: ShoppingSessionStore, useValue: { active, saveItem } },
        { provide: ProductCatalogService, useValue: { find, lastPrice } },
        { provide: BarcodeScannerService, useValue: scanner },
        { provide: CatalogLookupService, useValue: { lookup: onlineLookup } },
        {
          provide: ToastController,
          useValue: { create: vi.fn().mockResolvedValue({ present: vi.fn() }) },
        },
      ],
    });
    return {
      page: TestBed.inject(ScannerPage),
      active,
      saveItem,
      find,
      lastPrice,
      scanner,
      onlineLookup,
    };
  }

  it('shows a known product and dated market price without using the old price automatically', async () => {
    const { page, saveItem, lastPrice } = setup();
    await page.lookup('0789600112233');
    expect(page.known()).toBe(true);
    expect(page.name).toBe('Coffee');
    expect(page.lastPrice()?.recordedAt).toBe(1);
    expect(lastPrice).toHaveBeenCalledWith('0789600112233', 'm');
    expect(page.price).toBe('');
    await page.save();
    expect(saveItem).not.toHaveBeenCalled();
    expect(page.modalOpen()).toBe(true);
    page.price = '17,49';
    page.quantity = '2';
    await page.save();
    expect(saveItem).toHaveBeenCalledWith('Coffee', 1749, 2, undefined, '0789600112233');
    expect(page.modalOpen()).toBe(false);
  });

  it('opens quick registration for unknown codes and keeps the form on persistence failure', async () => {
    const { page, saveItem, find } = setup();
    find.mockResolvedValue(null);
    await page.lookup('0789600112233');
    expect(page.known()).toBe(false);
    expect(page.productCode).toBe('0789600112233');
    expect(page.name).toBe('');
    page.name = 'Coffee';
    page.price = '12,99';
    saveItem.mockRejectedValue(new Error('disk full'));
    await page.save();
    expect(page.modalOpen()).toBe(true);
    expect(page.formError()).toContain('Não foi possível salvar');
  });

  it('keeps quantity controls within the supported range and preserves invalid input for correction', () => {
    const { page } = setup();
    page.changeQuantity(-1);
    expect(page.quantity).toBe('1');
    page.changeQuantity(1);
    expect(page.quantity).toBe('2');
    page.quantity = '9999';
    page.changeQuantity(1);
    expect(page.quantity).toBe('9999');
    page.quantity = '1.5';
    page.changeQuantity(1);
    expect(page.quantity).toBe('1.5');
    expect(page.formError()).toContain('quantidade');
    page.quantity = '2';
    page.saving.set(true);
    page.changeQuantity(1);
    expect(page.quantity).toBe('2');
  });

  it('does not open a late lookup after navigating away', async () => {
    const { page, find } = setup();
    let resolve!: (product: null) => void;
    find.mockImplementation(() => new Promise((done) => (resolve = done)));
    const lookup = page.lookup('0789600112233');
    page.ionViewWillLeave();
    resolve(null);
    await lookup;
    expect(page.modalOpen()).toBe(false);
  });

  it('rejects nonnumeric or oversized codes before querying local data', async () => {
    const { page, find } = setup();
    await page.lookup('https://example.com');
    expect(find).not.toHaveBeenCalled();
    expect(page.error()).toContain('Informe um código');
  });

  it('keeps known local scans independent of the online catalog', async () => {
    const { page, onlineLookup } = setup();
    await page.lookup('0789600112233');
    expect(onlineLookup).not.toHaveBeenCalled();
    expect(page.suggestion()).toBeNull();
  });

  it('prefills external suggestions without saving, applying a price or using package size as quantity', async () => {
    const { page, find, onlineLookup, saveItem } = setup();
    find.mockResolvedValue(null);
    onlineLookup.mockResolvedValue({
      status: 'FOUND',
      source: 'OPEN_FOOD_FACTS',
      name: 'Leite Moça',
      quantity: '395 g',
    });
    await page.lookup('7891000100103');
    expect(page.name).toBe('Leite Moça');
    expect(page.quantity).toBe('1');
    expect(page.price).toBe('');
    expect(saveItem).not.toHaveBeenCalled();
    page.name = 'Leite condensado';
    page.price = '8,99';
    await page.save();
    expect(saveItem).toHaveBeenCalledWith('Leite condensado', 899, 1, undefined, '7891000100103');
  });

  it.each(['UNAVAILABLE', 'RATE_LIMITED', 'NOT_FOUND', 'DISABLED'] as const)(
    'offers manual registration when lookup returns %s',
    async (status) => {
      const { page, find, onlineLookup, saveItem } = setup();
      find.mockResolvedValue(null);
      onlineLookup.mockResolvedValue({ status });
      await page.lookup('7891000100103');
      expect(page.modalOpen()).toBe(true);
      expect(page.known()).toBe(false);
      expect(page.name).toBe('');
      expect(page.lookupNotice()).not.toBe('');
      expect(saveItem).not.toHaveBeenCalled();
    },
  );

  it('ignores an online suggestion after manual entry is chosen', async () => {
    const { page, find, onlineLookup } = setup();
    find.mockResolvedValue(null);
    let resolve!: (value: Partial<CatalogSuggestion>) => void;
    onlineLookup.mockImplementation(() => new Promise((done) => (resolve = done)));
    const lookup = page.lookup('7891000100103');
    await vi.waitFor(() => expect(onlineLookup).toHaveBeenCalled());
    page.useManualEntry();
    page.name = 'Meu nome';
    resolve({ status: 'FOUND', name: 'Late' });
    await lookup;
    expect(page.name).toBe('Meu nome');
    expect(page.modalOpen()).toBe(true);
    expect(page.productCode).toBe('7891000100103');
    expect(onlineLookup.mock.calls[0][1].aborted).toBe(true);
  });

  it('ignores online results after navigation or a session change', async () => {
    const { page, find, onlineLookup, active } = setup();
    find.mockResolvedValue(null);
    let resolve!: (value: object) => void;
    onlineLookup.mockImplementation(() => new Promise((done) => (resolve = done)));
    const lookup = page.lookup('7891000100103');
    await vi.waitFor(() => expect(onlineLookup).toHaveBeenCalled());
    active.set({ id: 'other', supermarketId: 'm' });
    resolve({ status: 'FOUND', name: 'Late' });
    await lookup;
    expect(page.modalOpen()).toBe(false);
  });

  it('does not turn a remote weighted product into a unit item', async () => {
    const { page, find, onlineLookup } = setup();
    find.mockResolvedValue(null);
    onlineLookup.mockResolvedValue({
      status: 'FOUND',
      source: 'PERSONAL',
      name: 'Banana',
      measurementType: 'WEIGHT',
    });
    await page.lookup('7891000100103');
    expect(page.modalOpen()).toBe(false);
    expect(page.error()).toContain('peso');
  });

  it('keeps the weight guard if the same product reaches SQLite during the lookup', async () => {
    const { page, find, onlineLookup } = setup();
    find
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'p', barcode: '7891000100103', name: 'Banana' });
    onlineLookup.mockResolvedValue({
      status: 'FOUND',
      source: 'PERSONAL',
      name: 'Banana',
      measurementType: 'WEIGHT',
    });
    await page.lookup('7891000100103');
    expect(page.modalOpen()).toBe(false);
    expect(page.error()).toContain('peso');
  });

  it('waits for the existing personal product to reach SQLite instead of creating a conflicting id', async () => {
    const { page, find, onlineLookup, saveItem } = setup();
    find.mockResolvedValue(null);
    onlineLookup.mockResolvedValue({
      status: 'FOUND',
      source: 'PERSONAL',
      name: 'Coffee',
      measurementType: 'UNIT',
    });
    await page.lookup('7891000100103');
    page.price = '8,99';
    await page.save();
    expect(saveItem).not.toHaveBeenCalled();
    expect(page.formError()).toContain('sincronização');
    expect(page.modalOpen()).toBe(true);
    find.mockResolvedValue({ id: 'server-id', name: 'Coffee', barcode: '7891000100103' });
    await page.save();
    expect(saveItem).toHaveBeenCalledTimes(1);
  });

  it('rechecks the purchase after awaiting the personal catalog during save', async () => {
    const { page, find, onlineLookup, saveItem, active } = setup();
    find.mockResolvedValue(null);
    onlineLookup.mockResolvedValue({
      status: 'FOUND',
      source: 'PERSONAL',
      name: 'Coffee',
      measurementType: 'UNIT',
    });
    await page.lookup('7891000100103');
    page.price = '8,99';
    let resolve!: (value: object) => void;
    find.mockImplementation(() => new Promise((done) => (resolve = done)));
    const save = page.save();
    active.set({ id: 'new-session', supermarketId: 'm' });
    resolve({ id: 'server-id', barcode: '7891000100103', name: 'Coffee' });
    await save;
    expect(saveItem).not.toHaveBeenCalled();
    expect(page.formError()).toContain('Comece');
  });

  it('prefers a personal correction received while the external lookup was in flight', async () => {
    const { page, find, onlineLookup } = setup();
    find
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'p', barcode: '7891000100103', name: 'Correção pessoal' });
    onlineLookup.mockResolvedValue({
      status: 'FOUND',
      source: 'OPEN_FOOD_FACTS',
      name: 'External',
    });
    await page.lookup('7891000100103');
    expect(page.name).toBe('Correção pessoal');
    expect(page.suggestion()).toBeNull();
  });

  it('resumes camera after product dismissal but stops after leaving the page', async () => {
    const { page, scanner } = setup();
    await page.scan();
    expect(scanner.read).toHaveBeenCalledTimes(1);
    await page.onProductDismiss();
    expect(scanner.read).toHaveBeenCalledTimes(2);
    page.ionViewWillLeave();
    await page.onProductDismiss();
    expect(scanner.read).toHaveBeenCalledTimes(2);
    expect(scanner.cancel).toHaveBeenCalled();
  });
});
