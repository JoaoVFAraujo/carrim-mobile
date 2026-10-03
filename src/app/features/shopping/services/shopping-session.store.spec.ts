import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DatabaseService } from '../../../core/database/database.service';
import { ShoppingSessionStore } from './shopping-session.store';
import { ShoppingItem } from '../models/shopping-item';

describe('repeated products', () => {
  function setup() {
    const session = {
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    };
    let saved: ShoppingItem[] = [];
    const transaction = vi.fn().mockImplementation(async (statements) => {
      const item = statements.find((entry: { statement: string }) =>
        /^(INSERT INTO|UPDATE) shopping_items/.test(entry.statement),
      );
      const values = item.values;
      if (item.statement.startsWith('UPDATE')) {
        saved = saved.map((previous) =>
          previous.id === values[8]
            ? {
                ...previous,
                name: values[0],
                unitPriceCents: values[1],
                quantity: values[2],
                measurementType: values[4],
                weightGrams: values[5],
                pricingType: values[6],
                bundleQuantity: values[7],
              }
            : previous,
        );
      } else {
        saved.push({
          id: values[0],
          sessionId: values[1],
          name: values[2],
          unitPriceCents: values[3],
          quantity: values[4],
          barcode: values[7],
          measurementType: values[8],
          weightGrams: values[9],
          pricingType: values[10],
          bundleQuantity: values[11],
        });
      }
    });
    const query = vi.fn().mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('WHERE session_id = ? AND name = ?'))
        return saved
          .filter(
            (item) =>
              item.sessionId === values[0] &&
              item.name === values[1] &&
              item.unitPriceCents === values[2] &&
              item.barcode === values[3] &&
              item.measurementType === values[4] &&
              item.pricingType === values[5] &&
              item.bundleQuantity === values[6],
          )
          .slice(0, 1);
      if (sql.includes("WHERE s.status = 'ACTIVE'")) return [session];
      if (sql.includes('FROM shopping_items WHERE session_id')) return saved;
      return [];
    });
    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: { transaction, query } }],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set(session);
    return { store, transaction };
  }

  it('combines concurrent additions and queues an update with the final quantity', async () => {
    const { store, transaction } = setup();
    await Promise.all([store.saveItem(' Coffee ', 1749, 2), store.saveItem('Coffee', 1749, 3)]);
    expect(store.items()).toHaveLength(1);
    expect(store.items()[0].quantity).toBe(5);
    expect(store.totalCents()).toBe(8745);
    const operation = transaction.mock.calls[1][0].at(-1);
    expect(operation.values[2]).toBe(store.items()[0].id);
    expect(operation.values[3]).toBe('UPDATE');
    expect(JSON.parse(operation.values[4]).quantity).toBe(5);
  });

  it('combines compatible bundles while keeping regular units and other offers separate', async () => {
    const { store, transaction } = setup();
    await store.saveBundleItem('Milk', 3, 1000, 6);
    await store.saveItem('Milk', 400, 1);
    expect(store.totalCents()).toBe(2400);
    await store.saveBundleItem('Milk', 3, 1000, 3);
    expect(store.items()).toHaveLength(2);
    expect(store.items()[0].quantity).toBe(9);
    expect(store.totalCents()).toBe(3400);
    expect(JSON.parse(transaction.mock.calls[2][0].at(-1).values[4])).toMatchObject({
      pricingType: 'BUNDLE',
      bundleQuantity: 3,
      bundlePriceCents: 1000,
      quantity: 9,
    });
    await store.saveBundleItem('Milk', 2, 1000, 2);
    expect(store.items()).toHaveLength(3);
    await store.saveBundleItem('Milk', 3, 1000, 3, store.items()[0].id);
    expect(store.items()[0].quantity).toBe(3);
  });
  it('rejects incomplete bundles and invalid group sizes without writing', async () => {
    const { store, transaction } = setup();
    for (const group of [1, 0, 1.5, 10000])
      await expect(store.saveBundleItem('Milk', group, 1000, 6)).rejects.toThrow('promoção');
    await expect(store.saveBundleItem('Milk', 3, 1000, 4)).rejects.toThrow('múltipla');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('adds grams for compatible weights, isolates unit items and replaces weight on edit', async () => {
    const { store, transaction } = setup();
    await store.saveItem('Banana', 699, 1);
    await store.saveWeightItem('Banana', 699, 824);
    expect(store.totalCents()).toBe(1275);
    await store.saveWeightItem('Banana', 699, 176);
    expect(store.items()).toHaveLength(2);
    expect(store.items()[1].weightGrams).toBe(1000);
    expect(store.totalCents()).toBe(1398);
    const payload = JSON.parse(transaction.mock.calls[2][0].at(-1).values[4]);
    expect(payload).toMatchObject({
      measurementType: 'WEIGHT',
      pricePerKgCents: 699,
      weightGrams: 1000,
    });
    expect(payload.quantity).toBeUndefined();
    await store.saveWeightItem('Banana', 699, 500, store.items()[1].id);
    expect(store.items()[1].weightGrams).toBe(500);
    expect(store.totalCents()).toBe(1049);
  });

  it('rejects invalid or accumulated excess weight before writing', async () => {
    const { store, transaction } = setup();
    for (const grams of [0, -1, 1.5, NaN, 10000000])
      await expect(store.saveWeightItem('Banana', 699, grams)).rejects.toThrow('peso');
    expect(transaction).not.toHaveBeenCalled();
    await store.saveWeightItem('Banana', 699, 9999999);
    await expect(store.saveWeightItem('Banana', 699, 1)).rejects.toThrow('peso total');
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps different prices, names and barcode identities on separate lines', async () => {
    const { store } = setup();
    await store.saveItem('Coffee', 1749, 1);
    await store.saveItem('Coffee', 1800, 1);
    await store.saveItem('Tea', 1749, 1);
    await store.saveItem('Coffee', 1749, 1, undefined, '0789600112233');
    await store.saveItem('Coffee', 1749, 2, undefined, '0789600112233');
    expect(store.items()).toHaveLength(4);
    expect(store.items()[3].quantity).toBe(3);
  });

  it('editing replaces quantity instead of incrementing it', async () => {
    const { store } = setup();
    await store.saveItem('Coffee', 1749, 3);
    await store.saveItem('Coffee', 1749, 2, store.items()[0].id);
    expect(store.items()[0].quantity).toBe(2);
  });

  it('rejects overflow without writing and allows later additions after a failure', async () => {
    const { store, transaction } = setup();
    await store.saveItem('Coffee', 1749, 9999);
    await expect(store.saveItem('Coffee', 1749, 1)).rejects.toThrow('quantidade total');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(store.items()[0].quantity).toBe(9999);
    await store.saveItem('Tea', 999, 1);
    expect(store.items()).toHaveLength(2);
  });
});

describe('ShoppingSessionStore', () => {
  it('saves a new market, session and both outbox operations together', async () => {
    const transaction = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatabaseService,
          useValue: {
            transaction,
            query: vi.fn().mockResolvedValue([]),
          },
        },
      ],
    });
    await TestBed.inject(ShoppingSessionStore).create('', ' São Luiz ', 20000);
    const statements = transaction.mock.calls[0][0];
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(statements).toHaveLength(4);
    expect(statements[0].values[1]).toBe('São Luiz');
    expect(statements[1].values[1]).toBe('SUPERMARKET');
    expect(statements[2].values[2]).toBe(20000);
    expect(statements[3].values[1]).toBe('SHOPPING_SESSION');
  });

  it('does not publish an active session when persistence fails', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatabaseService,
          useValue: {
            transaction: vi.fn().mockRejectedValue(new Error('disk full')),
          },
        },
      ],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    await expect(store.create('', 'Assaí', null)).rejects.toThrow('disk full');
    expect(store.active()).toBeNull();
  });
});

describe('shopping totals and item persistence', () => {
  it('does not offer a duplicate item retry when the write succeeds but reloading fails', async () => {
    const transaction = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatabaseService,
          useValue: {
            transaction,
            query: vi.fn().mockResolvedValueOnce([]).mockRejectedValue(new Error('read failed')),
          },
        },
      ],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    });
    await expect(store.saveItem('Coffee', 1749, 2)).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(store.error()).toContain('dados locais');
  });

  it('saves an unknown barcode product, item and outbox together while preserving leading zeros', async () => {
    const transaction = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatabaseService,
          useValue: {
            transaction,
            query: vi.fn().mockResolvedValue([]),
          },
        },
      ],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    });
    await store.saveItem('Coffee', 1749, 2, undefined, '0789600112233');
    const statements = transaction.mock.calls[0][0];
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(statements).toHaveLength(4);
    expect(statements[0].values[1]).toBe('0789600112233');
    expect(statements[1].values[1]).toBe('PRODUCT');
    expect(statements[2].values[7]).toBe('0789600112233');
    expect(statements[3].values[1]).toBe('SHOPPING_ITEM');
  });

  it('reuses a known catalog identity instead of creating another product', async () => {
    const transaction = vi.fn().mockResolvedValue(undefined);
    const query = vi
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([{ id: 'p', barcode: '0789600112233', name: 'Coffee' }]);
    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: { transaction, query } }],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    });
    await store.saveItem('Coffee', 1749, 2, undefined, '0789600112233');
    const statements = transaction.mock.calls[0][0];
    expect(statements[0].values[0]).toBe('p');
    expect(statements[1].values[2]).toBe('p');
    expect(statements[1].values[3]).toBe('UPDATE');
  });

  it('calculates exact totals and reports an exceeded budget', () => {
    TestBed.configureTestingModule({ providers: [{ provide: DatabaseService, useValue: {} }] });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: 1000,
      startedAt: 0,
    });
    store.items.set([
      { id: 'a', sessionId: 's', name: 'A', unitPriceCents: 199, quantity: 3 },
      { id: 'b', sessionId: 's', name: 'B', unitPriceCents: 450, quantity: 1 },
    ]);
    expect(store.totalCents()).toBe(1047);
    expect(store.remainingCents()).toBe(-47);
    store.active.set({ ...store.active()!, budgetCents: null });
    expect(store.remainingCents()).toBeNull();
  });

  it('keeps items unchanged if their database write fails', async () => {
    const transaction = vi.fn().mockRejectedValue(new Error('disk full'));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatabaseService,
          useValue: { transaction, query: vi.fn().mockResolvedValue([]) },
        },
      ],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    });
    await expect(store.saveItem('Rice', 1999, 2)).rejects.toThrow('disk full');
    expect(store.items()).toEqual([]);
    const statements = transaction.mock.calls[0][0];
    expect(statements).toHaveLength(2);
    expect(statements[1].values[3]).toBe('CREATE');
    expect(statements[0].values.slice(1, 5)).toEqual(['s', 'Rice', 1999, 2]);
  });
});

describe('shopping completion', () => {
  it('rejects invalid checkout cents before writing', async () => {
    const transaction = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: { transaction } }],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    for (const cents of [-1, 0.5, NaN, Infinity, 100000001]) {
      await expect(store.complete(cents)).rejects.toThrow('total do caixa');
    }
    expect(transaction).not.toHaveBeenCalled();
  });
  it('shares concurrent completion attempts instead of writing twice', async () => {
    let finish!: () => void;
    const transaction = vi
      .fn()
      .mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatabaseService,
          useValue: { transaction, query: vi.fn().mockResolvedValue([]) },
        },
      ],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    });
    store.items.set([{ id: 'i', sessionId: 's', name: 'Rice', unitPriceCents: 199, quantity: 2 }]);
    const first = store.complete(413);
    const second = store.complete(999);
    expect(second).toBe(first);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0][1].values[1]).toBe(413);
    expect(JSON.parse(transaction.mock.calls[0][0][2].values[4]).checkoutTotalCents).toBe(413);
    finish();
    await Promise.all([first, second]);
  });

  it('does not report a saved completion as failed when the subsequent read fails', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatabaseService,
          useValue: {
            transaction: vi.fn().mockResolvedValue(undefined),
            query: vi.fn().mockRejectedValue(new Error('read failed')),
          },
        },
      ],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    });
    store.items.set([{ id: 'i', sessionId: 's', name: 'Rice', unitPriceCents: 199, quantity: 2 }]);
    await expect(store.complete()).resolves.toBeUndefined();
    expect(store.active()).toBeNull();
    expect(store.items()).toEqual([]);
    expect(store.error()).toContain('dados locais');
    expect(store.loading()).toBe(false);
  });

  it('does not complete an empty shopping session', async () => {
    const transaction = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: { transaction } }],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    });
    await expect(store.complete()).rejects.toThrow('Adicione pelo menos');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('preserves the active shopping session when completion fails', async () => {
    const transaction = vi.fn().mockRejectedValue(new Error('disk full'));
    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: { transaction } }],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    });
    store.items.set([{ id: 'i', sessionId: 's', name: 'Rice', unitPriceCents: 199, quantity: 2 }]);
    await expect(store.complete(413)).rejects.toThrow('disk full');
    expect(store.active()?.id).toBe('s');
    expect(store.totalCents()).toBe(398);
    const statements = transaction.mock.calls[0][0];
    expect(statements).toHaveLength(3);
    expect(statements[0].statement).toContain('INSERT INTO price_history');
    expect(statements[2].values[3]).toBe('COMPLETE');
  });

  it('clears the cart and exposes completed shopping after persistence', async () => {
    const history = [
      {
        id: 's',
        supermarketName: 'Market',
        budgetCents: null,
        finishedAt: 1,
        totalCents: 398,
        checkoutTotalCents: null,
        itemCount: 1,
      },
    ];
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(history);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatabaseService,
          useValue: { transaction: vi.fn().mockResolvedValue(undefined), query },
        },
      ],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    store.active.set({
      id: 's',
      supermarketId: 'm',
      supermarketName: 'Market',
      budgetCents: null,
      startedAt: 0,
    });
    store.items.set([{ id: 'i', sessionId: 's', name: 'Rice', unitPriceCents: 199, quantity: 2 }]);
    await store.complete();
    expect(store.active()).toBeNull();
    expect(store.items()).toEqual([]);
    expect(store.history()).toEqual(history);
  });
});
