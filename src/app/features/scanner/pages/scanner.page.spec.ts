import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { vi } from 'vitest';
import { ScannerPage } from './scanner.page';
import { BarcodeScannerService } from '../services/barcode-scanner.service';
import { ProductCatalogService } from '../services/product-catalog.service';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';

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
    TestBed.configureTestingModule({
      providers: [
        ScannerPage,
        { provide: ShoppingSessionStore, useValue: { active, saveItem } },
        { provide: ProductCatalogService, useValue: { find, lastPrice } },
        { provide: BarcodeScannerService, useValue: scanner },
        {
          provide: ToastController,
          useValue: { create: vi.fn().mockResolvedValue({ present: vi.fn() }) },
        },
      ],
    });
    return { page: TestBed.inject(ScannerPage), active, saveItem, find, lastPrice, scanner };
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
