import { TestBed } from '@angular/core/testing';
import { sqliteHarness } from '../database/sqlite-test-harness';
import { DatabaseService } from '../database/database.service';
import { ShoppingSessionStore } from '../../features/shopping/services/shopping-session.store';
import { SyncQueueService } from './sync-queue.service';
import { retryDelay } from './sync-queue.service';

describe('persistent retry schedule', () => {
  it('backs off from two seconds to a bounded one hour', () => {
    expect(Array.from({ length: 9 }, (_, i) => retryDelay(i + 1))).toEqual([
      2000, 5000, 15000, 60000, 300000, 900000, 1800000, 3600000, 3600000,
    ]);
    expect(retryDelay(100)).toBe(3600000);
  });
});

describe('unsent reservation in real SQLite', () => {
  it('resumes immediately with the same frozen request and ignores a stale lease', async () => {
    const h = await sqliteHarness();
    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: h.database }],
    });
    await TestBed.inject(ShoppingSessionStore).create('', 'Mercado', null);
    const queue = TestBed.inject(SyncQueueService);
    const entry = (await queue.claim())!;
    const frozen = JSON.stringify({ operationId: entry.id, payload: { name: 'Mercado' } });
    await h.database.transaction([
      { statement: 'UPDATE sync_queue SET request_json=? WHERE id=?', values: [frozen, entry.id] },
    ]);
    await queue.releaseUnsent(entry);
    const row = h.query('SELECT * FROM sync_queue WHERE id=?', [entry.id]).values[0];
    expect(row['status']).toBe('PENDING');
    expect(row['attempt_count']).toBe(0);
    expect(row['lease_token']).toBeNull();
    expect(row['request_json']).toBe(frozen);
    const resumed = (await queue.claim())!;
    expect(resumed.id).toBe(entry.id);
    expect(resumed.request_json).toBe(frozen);
    await queue.releaseUnsent(entry);
    expect(
      h.query('SELECT status FROM sync_queue WHERE id=?', [entry.id]).values[0]['status'],
    ).toBe('SYNCING');
    h.sql.close();
  });
});
