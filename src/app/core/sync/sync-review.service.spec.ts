import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DatabaseService } from '../database/database.service';
import { sqliteHarness } from '../database/sqlite-test-harness';
import { ShoppingSessionStore } from '../../features/shopping/services/shopping-session.store';
import { SyncReviewService } from './sync-review.service';
import { SyncTransportService } from './sync-transport.service';

describe('explicit conflict review in real SQLite', () => {
  async function setup() {
    const h = await sqliteHarness();
    const current = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DatabaseService, useValue: h.database },
        { provide: SyncTransportService, useValue: { current } },
      ],
    });
    const store = TestBed.inject(ShoppingSessionStore);
    await store.create('', 'Mercado', 10000);
    h.sql.run("UPDATE sync_queue SET status='SYNCED'");
    await store.changeBudget(2000);
    const row = h.query("SELECT * FROM sync_queue WHERE status='PENDING'").values[0];
    const request = {
      operationId: row['id'],
      aggregateType: 'SHOPPING_SESSION',
      aggregateId: store.active()!.id,
      operation: 'UPDATE',
      baseVersion: 0,
      payload: { budgetCents: 2000 },
    };
    h.sql.run(
      "UPDATE sync_queue SET status='FAILED',last_error='CONFLICT',request_json=? WHERE id=?",
      [JSON.stringify(request), row['id']],
    );
    const remote = {
      aggregateType: 'SHOPPING_SESSION',
      aggregateId: store.active()!.id,
      snapshot: {
        id: store.active()!.id,
        version: 3,
        status: 'ACTIVE',
        supermarketId: store.active()!.supermarketId,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        budgetCents: 15000,
        checkoutTotalCents: null,
        items: [],
      },
    };
    current.mockResolvedValue(remote);
    return {
      ...h,
      store,
      current,
      remote,
      row,
      request,
      review: TestBed.inject(SyncReviewService),
    };
  }
  it('archives original/local/remote and enqueues one new explicit command in the same sequence', async () => {
    const { review, query, row, sql } = await setup();
    await review.load();
    expect(review.view()?.allowed).toBe(true);
    expect(review.view()?.local.join(' ')).toContain('20,00');
    await review.confirm();
    const updated = query("SELECT * FROM sync_queue WHERE status='PENDING'").values[0];
    expect(updated['id']).not.toBe(row['id']);
    expect(updated['sequence_number']).toBe(row['sequence_number']);
    const replacement = JSON.parse(String(updated['request_json']));
    expect(replacement.baseVersion).toBe(3);
    expect(replacement.payload).toEqual({ budgetCents: 2000 });
    const archives = query("SELECT value FROM app_metadata WHERE key LIKE 'sync_review:%'").values;
    expect(archives).toHaveLength(1);
    const archive = JSON.parse(String(archives[0]['value']));
    expect(archive.original.request_json).toBe(
      row['request_json'] ??
        JSON.stringify({ ...replacement, operationId: row['id'], baseVersion: 0 }),
    );
    expect(archive.server.snapshot.budgetCents).toBe(15000);
    sql.close();
  });
  it('does not automatically apply, reset failed state or overwrite purchases on preview', async () => {
    const { review, query, sql } = await setup();
    await review.load();
    expect(
      query("SELECT status FROM sync_queue WHERE last_error='CONFLICT'").values[0]['status'],
    ).toBe('FAILED');
    expect(query('SELECT budget_cents FROM shopping_sessions').values[0]['budget_cents']).toBe(
      2000,
    );
    expect(
      query("SELECT value FROM app_metadata WHERE key LIKE 'sync_review:%'").values,
    ).toHaveLength(0);
    sql.close();
  });
  it('refuses a stale decision if any local write arrived during the dialog', async () => {
    const { review, store, query, sql } = await setup();
    await review.load();
    await store.changeBudget(3000);
    await expect(review.confirm()).rejects.toThrow('dados mudaram');
    expect(
      query("SELECT value FROM app_metadata WHERE key LIKE 'sync_review:%'").values,
    ).toHaveLength(0);
    expect(store.active()?.budgetCents).toBe(3000);
    sql.close();
  });
  it('rolls back the archive when replacing the command fails', async () => {
    const { review, query, sql } = await setup();
    await review.load();
    sql.run(
      "CREATE TRIGGER reject_review BEFORE UPDATE OF id ON sync_queue BEGIN SELECT RAISE(ABORT,'test failure'); END",
    );
    await expect(review.confirm()).rejects.toThrow();
    expect(
      query("SELECT value FROM app_metadata WHERE key LIKE 'sync_review:%'").values,
    ).toHaveLength(0);
    expect(query("SELECT * FROM sync_queue WHERE status='FAILED'").values).toHaveLength(1);
    sql.close();
  });
  it('does not reapply over a finalized remote purchase', async () => {
    const { review, remote, sql } = await setup();
    Object.assign(remote.snapshot, { status: 'COMPLETED', finishedAt: new Date().toISOString() });
    await review.load();
    expect(review.view()?.allowed).toBe(false);
    await expect(review.confirm()).rejects.toThrow();
    sql.close();
  });
  it('rejects a malformed or foreign fresh server snapshot', async () => {
    const { review, remote, sql } = await setup();
    remote.snapshot.id = crypto.randomUUID();
    await expect(review.load()).rejects.toThrow();
    expect(review.view()).toBeNull();
    sql.close();
  });
  it('allows only one decision when confirm is tapped twice', async () => {
    const { review, query, sql } = await setup();
    await review.load();
    const results = await Promise.allSettled([review.confirm(), review.confirm()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      query("SELECT value FROM app_metadata WHERE key LIKE 'sync_review:%'").values,
    ).toHaveLength(1);
    sql.close();
  });
  it('notifies the scheduler after a confirmed conflict replaces FAILED with a new pending command', async () => {
    const { review, database, query, row, sql } = await setup();
    const wake = vi.fn();
    const release = database.onLocalWrite(wake);
    await review.load();
    expect(wake).not.toHaveBeenCalled();
    await review.confirm();
    expect(wake).toHaveBeenCalledTimes(1);
    const [pending] = query("SELECT id,status FROM sync_queue WHERE status='PENDING'").values;
    expect(pending['id']).not.toBe(row['id']);
    release();
    sql.close();
  });
});
