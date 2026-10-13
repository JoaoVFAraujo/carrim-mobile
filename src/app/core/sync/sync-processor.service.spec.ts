import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { vi } from 'vitest';
import { RemoteImportConflict } from '../database/remote-import-conflict';
import { DatabaseService } from '../database/database.service';
import { API_BASE_URL } from '../api/api-endpoint';
import { SyncProcessorService } from './sync-processor.service';
import { SyncPullService } from './sync-pull.service';
import { ShoppingSessionStore } from '../../features/shopping/services/shopping-session.store';
import { SyncQueueService } from './sync-queue.service';
import { SyncTransportService, SyncTransportError } from './sync-transport.service';

describe('sync processor', () => {
  let entry: {
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    operation: string;
    payload_json: string;
    request_json?: string;
    lease_token: string;
    attempt_count: number;
  };
  let claim: ReturnType<typeof vi.fn>;
  let applied: ReturnType<typeof vi.fn>;
  let failed: ReturnType<typeof vi.fn>;
  let push: ReturnType<typeof vi.fn>;
  let version: number;
  let service: SyncProcessorService;
  beforeEach(() => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    version = 3;
    entry = {
      id: 'op',
      aggregate_type: 'SHOPPING_ITEM',
      aggregate_id: 'item',
      operation: 'UPDATE',
      payload_json: JSON.stringify({
        sessionId: 'session',
        name: 'Rice',
        measurementType: 'UNIT',
        pricingType: 'REGULAR',
        quantity: 2,
        unitPriceCents: 799,
      }),
      lease_token: 'lease',
      attempt_count: 1,
    };
    claim = vi.fn().mockResolvedValueOnce(entry).mockResolvedValue(null);
    applied = vi.fn().mockResolvedValue(undefined);
    failed = vi.fn().mockResolvedValue(undefined);
    push = vi.fn().mockResolvedValue({
      operationId: 'op',
      status: 'APPLIED',
      state: {
        aggregateType: 'SHOPPING_ITEM',
        aggregateId: 'item',
        snapshot: { id: 'session', version: 4 },
      },
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: SyncPullService, useValue: { run: vi.fn() } },
        { provide: ShoppingSessionStore, useValue: { load: vi.fn() } },
        { provide: API_BASE_URL, useValue: 'https://api.example.com/api/v1' },
        {
          provide: SyncQueueService,
          useValue: { claim, applied, failed, conflict: failed, recover: vi.fn() },
        },
        { provide: SyncTransportService, useValue: { push } },
        {
          provide: DatabaseService,
          useValue: {
            query: vi.fn(async (sql: string) =>
              sql.includes('app_metadata') ? [{ value: String(version) }] : [],
            ),
            transaction: vi.fn(async (statements) => {
              entry.request_json = statements[0].values[0];
            }),
          },
        },
      ],
    });
    service = TestBed.inject(SyncProcessorService);
  });
  afterEach(() => vi.restoreAllMocks());
  it('translates local items and advances their session version after acknowledgment', async () => {
    await service.run();
    expect(push.mock.calls[0][0]).toMatchObject({
      operationId: 'op',
      baseVersion: 3,
      payload: {
        sessionId: 'session',
        item: { id: 'item', productNameSnapshot: 'Rice', quantityUnits: 2, unitPriceCents: 799 },
      },
    });
    expect(applied).toHaveBeenCalledWith(entry, expect.any(Number), {
      key: 'remote_version:SHOPPING_SESSION:session',
      value: '4',
    });
    expect(service.state()).toBe('READY');
  });
  it('freezes the original request across lost responses and later local/version changes', async () => {
    push.mockRejectedValueOnce(new SyncTransportError(true));
    await service.run();
    const original = push.mock.calls[0][0];
    version = 99;
    entry.payload_json = '{}';
    entry.lease_token = 'retry';
    claim.mockResolvedValueOnce(entry).mockResolvedValue(null);
    await service.run();
    expect(push.mock.calls[1][0]).toEqual(original);
    expect(failed).toHaveBeenCalledWith(entry, true);
    expect(applied).toHaveBeenCalledTimes(1);
  });
  it('stops on conflict without acknowledging the operation', async () => {
    push.mockResolvedValue({ status: 'CONFLICT', operationId: 'op' });
    await service.run();
    expect(failed).toHaveBeenCalledWith(entry, undefined);
    expect(applied).not.toHaveBeenCalled();
    expect(service.state()).toBe('ATTENTION');
  });
  it('does not reserve operations offline or without native protected identity', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await service.run();
    expect(service.state()).toBe('OFFLINE');
    expect(claim).not.toHaveBeenCalled();
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    await service.run();
    expect(service.state()).toBe('DISABLED');
    expect(push).not.toHaveBeenCalled();
  });
  it('serializes overlapping processor runs', async () => {
    const first = service.run();
    expect(service.run()).toBe(first);
    await first;
    expect(push).toHaveBeenCalledTimes(1);
  });
  it('persists and displays an import conflict instead of silently retrying it', async () => {
    claim.mockReset().mockResolvedValue(null);
    const pull = TestBed.inject(SyncPullService);
    vi.mocked(pull.run).mockRejectedValue(new RemoteImportConflict());
    await service.run();
    expect(service.state()).toBe('ATTENTION');
    expect(TestBed.inject(DatabaseService).transaction).toHaveBeenCalledWith([
      expect.objectContaining({ values: ['sync_pull_paused', '1'] }),
    ]);
  });
  it('keeps authentication and storage outages retryable without persisting a conflict pause', async () => {
    claim.mockReset().mockResolvedValue(null);
    vi.mocked(TestBed.inject(SyncPullService).run).mockRejectedValueOnce(
      new Error('authentication unavailable'),
    );
    await service.run();
    expect(TestBed.inject(DatabaseService).transaction).not.toHaveBeenCalled();
    await service.run();
    expect(service.state()).toBe('READY');
  });
});
