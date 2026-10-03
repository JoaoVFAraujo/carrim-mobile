import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DatabaseService } from '../../../core/database/database.service';
import { ShoppingSessionStore } from './shopping-session.store';

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
    expect(statements[2].values.at(-1)).toBe('0789600112233');
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
    await expect(store.saveItem('Rice', 1999, 2)).rejects.toThrow('disk full');
    expect(store.items()).toEqual([]);
    const statements = transaction.mock.calls[0][0];
    expect(statements).toHaveLength(2);
    expect(statements[1].values[3]).toBe('CREATE');
    expect(statements[0].values.slice(1, 5)).toEqual(['s', 'Rice', 1999, 2]);
  });
});

describe('shopping completion', () => {
  it('shares concurrent completion attempts instead of writing twice', async () => {
    let finish!: () => void;
    const transaction = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
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
    const first = store.complete();
    const second = store.complete();
    expect(second).toBe(first);
    expect(transaction).toHaveBeenCalledTimes(1);
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
    await expect(store.complete()).rejects.toThrow('disk full');
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
