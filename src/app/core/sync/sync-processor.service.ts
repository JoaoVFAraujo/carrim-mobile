import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { API_BASE_URL } from '../api/api-endpoint';
import { DatabaseService } from '../database/database.service';
import { SyncStatusService } from './sync-status.service';
import { SyncPullService } from './sync-pull.service';
import { ShoppingSessionStore } from '../../features/shopping/services/shopping-session.store';
import { QueuedOperation, SyncQueueService } from './sync-queue.service';
import { SyncRequest, SyncTransportService, SyncTransportError } from './sync-transport.service';

@Injectable({ providedIn: 'root' })
export class SyncProcessorService {
  private readonly queue = inject(SyncQueueService);
  private readonly db = inject(DatabaseService);
  private readonly transport = inject(SyncTransportService);
  private readonly status = inject(SyncStatusService);
  private readonly pull = inject(SyncPullService);
  private readonly store = inject(ShoppingSessionStore);
  private readonly base = inject(API_BASE_URL);
  private readonly destroy = inject(DestroyRef);
  readonly state = signal<'DISABLED' | 'OFFLINE' | 'SYNCING' | 'READY' | 'ATTENTION'>('DISABLED');
  private pending?: Promise<void>;
  private started = false;

  start(): void {
    if (this.started || !Capacitor.isNativePlatform() || !this.base) return;
    this.started = true;
    const run = () => {
      void this.run().catch(() => this.state.set('ATTENTION'));
    };
    const timer = setInterval(run, 2000);
    window.addEventListener('online', run);
    this.destroy.onDestroy(() => {
      clearInterval(timer);
      window.removeEventListener('online', run);
    });
    run();
  }
  run(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.process().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async process(): Promise<void> {
    if (!Capacitor.isNativePlatform() || !this.base) {
      this.state.set('DISABLED');
      return;
    }
    if (!navigator.onLine) {
      this.state.set('OFFLINE');
      return;
    }
    await this.queue.recover();
    for (let count = 0; count < 100; count++) {
      const entry = await this.queue.claim();
      if (!entry) {
        const failed = await this.db.query(
          "SELECT id FROM sync_queue WHERE status = 'FAILED' LIMIT 1",
        );
        if (!failed.length) {
          await this.pull.run();
          await this.store.load();
        }
        this.status.message.set(
          failed.length
            ? 'A sincronização está pausada. Há uma operação que precisa de revisão; suas compras locais foram preservadas.'
            : '',
        );
        this.state.set(failed.length ? 'ATTENTION' : 'READY');
        return;
      }
      this.state.set('SYNCING');
      try {
        const request = await this.request(entry);
        const result = await this.transport.push(request);
        if (result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED') {
          await this.queue.applied(entry, Date.now(), {
            key: `remote_version:${entry.aggregate_type === 'SHOPPING_ITEM' ? 'SHOPPING_SESSION' : entry.aggregate_type}:${result.state!.snapshot.id}`,
            value: String(result.state!.snapshot.version),
          });
        } else {
          if (result.status === 'CONFLICT') {
            await this.queue.conflict(entry, result.state);
            this.status.message.set(
              'Há alterações diferentes no servidor. A sincronização foi pausada sem substituir suas compras.',
            );
          } else await this.queue.failed(entry, false);
          this.state.set('ATTENTION');
          return;
        }
      } catch (error) {
        // Unknown failures (identity/storage/network) retain the operation for recovery.
        await this.queue.failed(
          entry,
          error instanceof SyncTransportError ? error.transient : true,
        );
        this.state.set('ATTENTION');
        return;
      }
    }
  }
  private async request(entry: QueuedOperation): Promise<SyncRequest> {
    if (entry.request_json) return JSON.parse(entry.request_json);
    const payload = JSON.parse(entry.payload_json);
    let translated: object = payload;
    let versionId = entry.aggregate_id;
    let versionType = entry.aggregate_type;
    if (entry.aggregate_type === 'SUPERMARKET') translated = { name: payload.name };
    if (entry.aggregate_type === 'PRODUCT')
      translated = {
        name: payload.name,
        barcode: payload.barcode ?? null,
        measurementType: payload.measurementType ?? 'UNIT',
      };
    if (entry.aggregate_type === 'SHOPPING_SESSION' && entry.operation === 'COMPLETE')
      translated = {
        completedAt: payload.finishedAt,
        checkoutTotalCents: payload.checkoutTotalCents ?? null,
      };
    if (entry.aggregate_type === 'SHOPPING_ITEM') {
      versionId = payload.sessionId;
      versionType = 'SHOPPING_SESSION';
      if (entry.operation !== 'DELETE') {
        const product = payload.barcode
          ? await this.db.query<{ id: string }>('SELECT id FROM products WHERE barcode = ?', [
              payload.barcode,
            ])
          : [];
        translated = {
          sessionId: payload.sessionId,
          item: {
            id: entry.aggregate_id,
            productId: product[0]?.id ?? null,
            productNameSnapshot: payload.name,
            measurementType: payload.measurementType,
            pricingType: payload.pricingType,
            quantityUnits: payload.measurementType === 'UNIT' ? payload.quantity : null,
            unitPriceCents: payload.unitPriceCents ?? null,
            pricePerKgCents: payload.pricePerKgCents ?? null,
            weightGrams: payload.weightGrams ?? null,
            bundleQuantity: payload.bundleQuantity ?? null,
            bundlePriceCents: payload.bundlePriceCents ?? null,
          },
        };
      }
    }
    const versions = await this.db.query<{ value: string }>(
      'SELECT value FROM app_metadata WHERE key = ?',
      [`remote_version:${versionType}:${versionId}`],
    );
    const request: SyncRequest = {
      operationId: entry.id,
      aggregateType: entry.aggregate_type,
      aggregateId: entry.aggregate_id,
      operation: entry.operation,
      baseVersion:
        entry.operation === 'CREATE' && entry.aggregate_type !== 'SHOPPING_ITEM'
          ? null
          : Number(versions[0]?.value ?? 0),
      payload: translated,
    };
    // Freeze before HTTP: replay must send exactly the same version and payload.
    await this.db.transaction([
      {
        statement: `UPDATE sync_queue SET request_json = ?
      WHERE id = ? AND lease_token = ? AND status = 'SYNCING' AND request_json IS NULL`,
        values: [JSON.stringify(request), entry.id, entry.lease_token],
      },
    ]);
    return request;
  }
}
