import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DatabaseService } from '../database/database.service';
import { SyncPullService } from './sync-pull.service';
import { SyncTransportService } from './sync-transport.service';

describe('sync pull reconciliation', () => {
  let pull: ReturnType<typeof vi.fn>;
  let apply: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    pull = vi.fn().mockResolvedValue({ changes: [], cursor: 'next', hasMore: false });
    apply = vi.fn().mockResolvedValue(true);
    query = vi.fn().mockResolvedValue([]);
    TestBed.configureTestingModule({
      providers: [
        { provide: DatabaseService, useValue: { query, applyRemotePage: apply } },
        { provide: SyncTransportService, useValue: { pull } },
      ],
    });
  });
  it('does not overwrite local pending changes', async () => {
    query.mockResolvedValueOnce([{ id: 'pending' }]);
    await TestBed.inject(SyncPullService).run();
    expect(pull).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it('advances cursor only with an atomic local page and stops when a local edit races with pull', async () => {
    pull.mockResolvedValueOnce({ changes: [], cursor: 'page-one', hasMore: true });
    apply.mockResolvedValueOnce(false);
    await TestBed.inject(SyncPullService).run();
    expect(apply).toHaveBeenCalledWith([], 'page-one');
    expect(pull).toHaveBeenCalledTimes(1);
  });
  it('passes the last committed cursor into the next page', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ value: 'old' }]);
    pull.mockResolvedValueOnce({ changes: [], cursor: 'page-one', hasMore: true });
    await TestBed.inject(SyncPullService).run();
    expect(pull.mock.calls).toEqual([['old'], ['page-one']]);
    expect(apply.mock.calls).toEqual([
      [[], 'page-one'],
      [[], 'next'],
    ]);
  });
  it('imports terminal sessions before a newer active session regardless of journal order', async () => {
    const a = 'a20e47cf-a002-4b01-a001-000000000001',
      b = 'a20e47cf-a002-4b01-a001-000000000002';
    const change = (id: string, status: string) => ({
      aggregateType: 'SHOPPING_SESSION',
      aggregateId: id,
      snapshot: {
        id,
        version: 1,
        supermarketId: 'a20e47cf-a002-4b01-a001-000000000003',
        budgetCents: null,
        startedAt: '2026-10-13T10:00:00Z',
        finishedAt: status === 'ACTIVE' ? null : '2026-10-13T11:00:00Z',
        status,
        items: [],
      },
    });
    query.mockImplementation(async (sql: string, values?: string[]) => {
      if (values?.[0] === 'sync_import_pending') return [{ value: '1' }];
      if (sql.includes('incoming_snapshot:%'))
        return [
          { value: JSON.stringify(change(b, 'ACTIVE')) },
          { value: JSON.stringify(change(a, 'CANCELED')) },
        ];
      return [];
    });
    await TestBed.inject(SyncPullService).run();
    const final = apply.mock.calls.at(-1)![0] as { statement: string; values: string[] }[];
    expect(
      final
        .filter((st) => st.statement.includes('INSERT INTO shopping_sessions'))
        .map((st) => st.values[0]),
    ).toEqual([a, b]);
  });
});
