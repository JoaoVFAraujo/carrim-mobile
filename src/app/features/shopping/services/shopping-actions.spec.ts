import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DatabaseService } from '../../../core/database/database.service';
import { sqliteHarness } from '../../../core/database/sqlite-test-harness';
import { ShoppingSessionStore } from './shopping-session.store';

describe('purchase actions in real SQLite', () => {
  async function setup() {
    const h = await sqliteHarness();
    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: h.database }],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    await store.create('', 'Mercado', 10000);
    await store.saveItem('Arroz', 799, 2);
    return { ...h, store };
  }
  it('edits and removes budget with exact cents and ordered outbox, without touching items', async () => {
    const { store, query, sql } = await setup();
    await store.changeBudget(1598);
    expect(store.remainingCents()).toBe(0);
    await store.changeBudget(null);
    expect(store.remainingCents()).toBeNull();
    expect(store.totalCents()).toBe(1598);
    const entries = query(
      "SELECT payload_json FROM sync_queue WHERE operation='UPDATE' ORDER BY sequence_number",
    ).values;
    expect(entries.map((e) => JSON.parse(String(e['payload_json'])))).toEqual([
      { budgetCents: 1598 },
      { budgetCents: null },
    ]);
    sql.close();
  });
  it('cancels without generating prices and preserves canceled items; a new purchase can start', async () => {
    const { store, query, sql } = await setup();
    await store.cancel();
    expect(store.active()).toBeNull();
    expect(store.history()).toEqual([]);
    expect(query('SELECT * FROM shopping_items').values).toHaveLength(1);
    expect(query('SELECT * FROM price_history').values).toHaveLength(0);
    expect(query("SELECT * FROM sync_queue WHERE operation='CANCEL'").values).toHaveLength(1);
    await expect(store.changeBudget(100)).rejects.toThrow();
    await store.create('', 'Outro mercado', null);
    expect(store.active()?.supermarketName).toBe('Outro mercado');
    sql.close();
  });
  it('rolls back cancellation and budget when the outbox write fails', async () => {
    const { store, sql } = await setup();
    sql.run(
      "CREATE TRIGGER reject_actions BEFORE INSERT ON sync_queue WHEN NEW.operation IN ('CANCEL','UPDATE') BEGIN SELECT RAISE(ABORT,'test failure'); END",
    );
    await expect(store.cancel()).rejects.toThrow();
    await expect(store.changeBudget(null)).rejects.toThrow();
    await store.load();
    expect(store.active()?.budgetCents).toBe(10000);
    expect(store.items()).toHaveLength(1);
    sql.close();
  });
  it('serializes item writes before cancellation and refuses late completion', async () => {
    const { store, sql } = await setup();
    const item = store.saveItem('Leite', 500, 1);
    const cancel = store.cancel();
    const complete = expect(store.complete()).rejects.toThrow('andamento');
    await Promise.all([item, cancel, complete]);
    expect(store.active()).toBeNull();
    sql.close();
  });
  it('rejects invalid budgets without changing persistence', async () => {
    const { store, database, sql } = await setup();
    const tx = vi.spyOn(database, 'transaction');
    for (const value of [0, -1, 1.5, Infinity, NaN, 100000001])
      await expect(store.changeBudget(value)).rejects.toThrow();
    expect(tx).not.toHaveBeenCalled();
    sql.close();
  });
});
