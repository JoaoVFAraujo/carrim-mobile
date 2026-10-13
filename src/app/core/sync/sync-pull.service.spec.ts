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
});
