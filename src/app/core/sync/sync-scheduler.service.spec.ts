import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { vi, type Mock } from 'vitest';
import { DatabaseService } from '../database/database.service';
import { SyncStatusService } from './sync-status.service';
import { SYNC_APP, SyncSchedulerService, type SyncState } from './sync-scheduler.service';

describe('foreground adaptive sync scheduling', () => {
  let visible: DocumentVisibilityState;
  let online: boolean;
  let state: SyncState;
  let head: {
    status: string;
    next_attempt_at_ms: number | null;
    processing_started_at_ms?: number;
    updated_at_ms?: number;
  } | null;
  let paused: boolean;
  let write: () => void;
  let appEvent: (state: { isActive: boolean }) => void;
  let cycle: Mock<() => Promise<void>>;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let app: { addListener: ReturnType<typeof vi.fn>; getState: ReturnType<typeof vi.fn> };
  let service: SyncSchedulerService;
  let status: SyncStatusService;
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    visible = 'visible';
    online = true;
    state = 'READY';
    head = null;
    paused = false;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    cycle = vi.fn().mockResolvedValue(undefined);
    unsubscribe = vi.fn();
    remove = vi.fn().mockResolvedValue(undefined);
    app = {
      addListener: vi.fn(
        async (_name: string, callback: (state: { isActive: boolean }) => void) => {
          appEvent = callback;
          return { remove };
        },
      ),
      getState: vi.fn().mockResolvedValue({ isActive: true }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: SYNC_APP, useValue: app },
        {
          provide: DatabaseService,
          useValue: {
            onLocalWrite: (callback: () => void) => {
              write = callback;
              return unsubscribe;
            },
            query: vi.fn(async (_sql: string, values?: string[]) =>
              values?.[0] === 'sync_pull_paused'
                ? paused
                  ? [{ value: '1' }]
                  : []
                : head
                  ? [head]
                  : [],
            ),
          },
        },
      ],
    });
    status = TestBed.inject(SyncStatusService);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function start(native = false) {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(native);
    service = TestBed.inject(SyncSchedulerService);
    service.start(cycle, () => state);
  }

  it('spaces idle pulls at 15, 30 and then 60 seconds', async () => {
    start();
    await flush();
    expect(cycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14999);
    expect(cycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29999);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(59999);
    expect(cycle).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(4);
  });

  it('wakes immediately after a local write and invalidates the previous confirmation', async () => {
    start();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    status.lastSyncedAt.set(Date.now());
    write();
    await flush();
    expect(cycle).toHaveBeenCalledTimes(2);
    expect(status.lastSyncedAt()).toBeNull();
    await vi.advanceTimersByTimeAsync(14999);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(3);
  });

  it('resets idle spacing when a cycle receives remote changes', async () => {
    start();
    await flush();
    await vi.advanceTimersByTimeAsync(15000);
    cycle.mockImplementationOnce(async () => {
      status.activityRevision.update((v) => v + 1);
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(cycle).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15000);
    expect(cycle).toHaveBeenCalledTimes(4);
  });

  it('stops hidden-page timers, defers hidden writes and resumes immediately', async () => {
    start();
    await flush();
    visible = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    write();
    await vi.advanceTimersByTimeAsync(300000);
    expect(cycle).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    visible = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(cycle).toHaveBeenCalledTimes(2);
  });

  it('waits for connectivity instead of repeatedly polling offline', async () => {
    online = false;
    state = 'OFFLINE';
    start();
    await flush();
    await vi.advanceTimersByTimeAsync(600000);
    expect(cycle).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    online = true;
    state = 'READY';
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(cycle).toHaveBeenCalledTimes(2);
  });

  it('preserves an outbox retry deadline even when more local writes arrive', async () => {
    state = 'SYNCING';
    head = { status: 'PENDING', next_attempt_at_ms: Date.now() + 60000 };
    const deadline = head.next_attempt_at_ms;
    start();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    write();
    await flush();
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(58999);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(3);
    expect(head.next_attempt_at_ms).toBe(deadline);
  });

  it('does not automatically retry a failed command or a paused import', async () => {
    state = 'ATTENTION';
    head = { status: 'FAILED', next_attempt_at_ms: null };
    start();
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(cycle).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    head = null;
    paused = true;
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(cycle).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues an incomplete paginated import promptly', async () => {
    state = 'SYNCING';
    start();
    await flush();
    await vi.advanceTimersByTimeAsync(999);
    expect(cycle).toHaveBeenCalledTimes(1);
    state = 'READY';
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(14999);
    expect(cycle).toHaveBeenCalledTimes(2);
  });

  it('coalesces writes during an in-flight cycle without overlapping or losing a wakeup', async () => {
    let release!: () => void;
    cycle.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    start();
    await flush();
    write();
    write();
    write();
    await flush();
    expect(cycle).toHaveBeenCalledTimes(1);
    release();
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(cycle).toHaveBeenCalledTimes(2);
  });

  it('uses native app state and does not start until the app is active', async () => {
    app.getState.mockResolvedValue({ isActive: false });
    start(true);
    await flush();
    expect(cycle).not.toHaveBeenCalled();
    appEvent({ isActive: true });
    await flush();
    expect(cycle).toHaveBeenCalledTimes(1);
    appEvent({ isActive: false });
    await vi.advanceTimersByTimeAsync(60000);
    expect(cycle).toHaveBeenCalledTimes(1);
    appEvent({ isActive: true });
    await flush();
    expect(cycle).toHaveBeenCalledTimes(2);
    TestBed.resetTestingModule();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not replace a newer native lifecycle event with an older initial state', async () => {
    let resolveState!: (value: { isActive: boolean }) => void;
    app.getState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveState = resolve;
        }),
    );
    start(true);
    await flush();
    appEvent({ isActive: true });
    await flush();
    resolveState({ isActive: false });
    await flush();
    expect(service.foreground()).toBe(true);
    expect(cycle).toHaveBeenCalled();
  });

  it('fails closed if native lifecycle state is unavailable', async () => {
    app.getState.mockRejectedValueOnce(new Error('plugin unavailable'));
    start(true);
    await flush();
    expect(cycle).not.toHaveBeenCalled();
    expect(service.foreground()).toBe(false);
    expect(status.message()).not.toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up a native listener that resolves after destruction', async () => {
    let resolveHandle!: (value: { remove: typeof remove }) => void;
    app.addListener.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHandle = resolve;
        }),
    );
    start(true);
    await flush();
    TestBed.resetTestingModule();
    resolveHandle({ remove });
    await flush();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(app.getState).not.toHaveBeenCalled();
    expect(cycle).not.toHaveBeenCalled();
  });

  it('backs off failed pulls without a pending outbox command', async () => {
    state = 'ATTENTION';
    start();
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(cycle).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15000);
    expect(cycle).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60000);
    expect(cycle).toHaveBeenCalledTimes(5);
  });

  it('starts once and removes timers, subscriptions and window listeners on destruction', async () => {
    start();
    service.start(cycle, () => state);
    await flush();
    expect(cycle).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(cycle).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not spin on a pending queue when a remote import is paused', async () => {
    paused = true;
    state = 'ATTENTION';
    head = { status: 'PENDING', next_attempt_at_ms: null };
    start();
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(cycle).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('wakes a previously failed queue immediately after an approved review notification', async () => {
    head = { status: 'FAILED', next_attempt_at_ms: null };
    state = 'ATTENTION';
    start();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    head = { status: 'PENDING', next_attempt_at_ms: null };
    state = 'SYNCING';
    write();
    await flush();
    expect(cycle).toHaveBeenCalledTimes(2);
  });
});
