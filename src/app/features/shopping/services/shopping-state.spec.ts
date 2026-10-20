import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShoppingRepository, ShoppingSnapshot } from './shopping.repository';
import { ShoppingSessionStore } from './shopping-session.store';

const active = {
  id: 'session',
  supermarketId: 'market',
  supermarketName: 'Mercado',
  budgetCents: 10000,
  startedAt: 1,
};
const item = {
  id: 'item',
  sessionId: 'session',
  name: 'Arroz',
  unitPriceCents: 799,
  quantity: 2,
  barcode: null,
  measurementType: 'UNIT' as const,
  weightGrams: null,
  pricingType: 'REGULAR' as const,
  bundleQuantity: null,
};

describe('shopping state without a database dependency', () => {
  let snapshot: ReturnType<typeof vi.fn>;
  let repository: {
    snapshot: ReturnType<typeof vi.fn>;
    changeBudget: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let store: ShoppingSessionStore;
  beforeEach(() => {
    snapshot = vi.fn().mockResolvedValue({
      active,
      items: [item],
      supermarkets: [{ id: 'market', name: 'Mercado' }],
      history: [],
    } satisfies ShoppingSnapshot);
    repository = {
      snapshot,
      changeBudget: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ShoppingRepository, useValue: repository }],
    });
    store = TestBed.inject(ShoppingSessionStore);
  });
  it('loads signals and calculates money using only the repository contract', async () => {
    await store.load();
    expect(store.active()).toEqual(active);
    expect(store.items()).toEqual([item]);
    expect(store.totalCents()).toBe(1598);
    expect(store.remainingCents()).toBe(8402);
    await expect(store.changeBudget(0)).rejects.toThrow();
    expect(repository.changeBudget).not.toHaveBeenCalled();
    await expect(store.create('market', '', 10000)).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('keeps a completed purchase closed even when the following snapshot fails', async () => {
    await store.load();
    snapshot.mockRejectedValueOnce(new Error('read failed'));
    await store.complete(1600);
    expect(repository.complete).toHaveBeenCalledWith('session', 1600);
    expect(store.active()).toBeNull();
    expect(store.items()).toEqual([]);
    expect(store.error()).not.toBe('');
  });
  it('preserves the editable purchase if completion was not persisted', async () => {
    await store.load();
    repository.complete.mockRejectedValueOnce(new Error('write failed'));
    await expect(store.complete()).rejects.toThrow('write failed');
    expect(store.active()).toEqual(active);
    expect(store.items()).toEqual([item]);
  });
});
