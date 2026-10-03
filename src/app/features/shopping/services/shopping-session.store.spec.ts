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
