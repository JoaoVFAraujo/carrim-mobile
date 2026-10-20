import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, InjectionToken, inject } from '@angular/core';
import { App, type AppPlugin } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { DatabaseService } from '../database/database.service';
import { SyncStatusService } from './sync-status.service';

export type SyncState = 'DISABLED' | 'OFFLINE' | 'PAUSED' | 'SYNCING' | 'READY' | 'ATTENTION';
export const SYNC_APP = new InjectionToken<Pick<AppPlugin, 'addListener' | 'getState'>>(
  'sync app lifecycle',
  {
    providedIn: 'root',
    factory: () => ({
      addListener: App.addListener.bind(App),
      getState: App.getState.bind(App),
    }),
  },
);

const idleDelays = [15_000, 30_000, 60_000];
const failureDelays = [2_000, 5_000, 15_000, 60_000];

/** One foreground timer; the persistent outbox remains authoritative for retry deadlines. */
@Injectable({ providedIn: 'root' })
export class SyncSchedulerService {
  private readonly db = inject(DatabaseService);
  private readonly status = inject(SyncStatusService);
  private readonly document = inject(DOCUMENT);
  private readonly app = inject(SYNC_APP);
  private readonly destroy = inject(DestroyRef);
  private readonly native = Capacitor.isNativePlatform();
  private appActive = !this.native;
  private appEvents = 0;
  private appHandle?: PluginListenerHandle;
  private timer?: ReturnType<typeof setTimeout>;
  private cycle?: () => Promise<void>;
  private state?: () => SyncState;
  private busy = false;
  private wakeAgain = false;
  private disposed = false;
  private idleIndex = 0;
  private failureIndex = 0;

  foreground(): boolean {
    return !this.disposed && this.appActive && this.document.visibilityState !== 'hidden';
  }

  start(cycle: () => Promise<void>, state: () => SyncState): void {
    if (this.cycle || this.disposed) return;
    this.cycle = cycle;
    this.state = state;
    const resume = () => {
      this.idleIndex = 0;
      this.failureIndex = 0;
      this.wake();
    };
    const unsubscribe = this.db.onLocalWrite(() => {
      this.status.lastSyncedAt.set(null);
      this.idleIndex = 0;
      this.wake();
    });
    this.document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    this.destroy.onDestroy(() => {
      this.disposed = true;
      this.clearTimer();
      unsubscribe();
      this.document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      void this.appHandle?.remove().catch(() => undefined);
    });
    if (this.native) void this.initializeNative(resume);
    else this.wake();
  }

  private async initializeNative(resume: () => void): Promise<void> {
    try {
      const handle = await this.app.addListener('appStateChange', (state) => {
        this.appEvents++;
        this.appActive = state.isActive;
        resume();
      });
      if (this.disposed) {
        await handle.remove();
        return;
      }
      this.appHandle = handle;
      const events = this.appEvents;
      const state = await this.app.getState();
      if (this.disposed) return;
      if (this.appEvents === events) this.appActive = state.isActive;
      resume();
    } catch {
      if (this.disposed) return;
      if (!this.appEvents) {
        this.appActive = false;
        this.clearTimer();
        this.status.message.set(
          'Não foi possível confirmar o estado do app para sincronizar. Suas compras estão preservadas.',
        );
      } else resume();
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private wake(): void {
    this.clearTimer();
    if (!this.foreground() || !this.cycle) return;
    if (this.busy) {
      this.wakeAgain = true;
      return;
    }
    void this.tick();
  }

  private arm(delay: number): void {
    this.clearTimer();
    if (this.foreground())
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.tick();
      }, delay);
  }

  private backoff(): number {
    const delay = failureDelays[this.failureIndex];
    this.failureIndex = Math.min(this.failureIndex + 1, failureDelays.length - 1);
    return delay;
  }

  private async tick(): Promise<void> {
    if (this.busy || !this.foreground() || !this.cycle) return;
    this.busy = true;
    this.wakeAgain = false;
    const revision = this.status.activityRevision();
    let delay: number | null = null;
    try {
      await this.cycle();
      if (this.foreground())
        delay = await this.nextDelay(this.status.activityRevision() !== revision);
    } catch {
      this.status.lastSyncedAt.set(null);
      this.status.message.set(
        'Não foi possível sincronizar agora. Suas compras locais foram preservadas.',
      );
      delay = this.backoff();
    } finally {
      this.busy = false;
      if (this.foreground()) {
        if (this.wakeAgain) this.arm(0);
        else if (delay !== null) this.arm(delay);
      }
    }
  }

  private async nextDelay(changed: boolean): Promise<number | null> {
    if (!navigator.onLine) return null;
    const [head] = await this.db.query<{
      status: string;
      next_attempt_at_ms: number | null;
      processing_started_at_ms: number | null;
      updated_at_ms: number;
    }>(
      "SELECT status,next_attempt_at_ms,processing_started_at_ms,updated_at_ms FROM sync_queue WHERE status!='SYNCED' ORDER BY sequence_number LIMIT 1",
    );
    if (head?.status === 'FAILED') return null;
    if (head?.status === 'PENDING')
      return Math.max(1000, (head.next_attempt_at_ms ?? Date.now()) - Date.now());
    if (head?.status === 'SYNCING')
      return Math.max(
        1000,
        (head.processing_started_at_ms ?? head.updated_at_ms) + 120_000 - Date.now(),
      );
    if (this.state!() === 'ATTENTION') {
      const paused = await this.db.query<{ value: string }>(
        'SELECT value FROM app_metadata WHERE key=?',
        ['sync_pull_paused'],
      );
      return paused[0]?.value === '1' ? null : this.backoff();
    }
    if (this.state!() === 'SYNCING') return 1000;
    if (this.state!() !== 'READY') return null;
    this.failureIndex = 0;
    if (changed) this.idleIndex = 0;
    const delay = idleDelays[this.idleIndex];
    this.idleIndex = Math.min(this.idleIndex + 1, idleDelays.length - 1);
    return delay;
  }
}
