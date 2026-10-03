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
