import { Injectable, inject, signal } from '@angular/core';
import { API_BASE_URL } from '../api/api-endpoint';
import { RemoteImportConflict } from '../database/remote-import-conflict';
import { DatabaseService } from '../database/database.service';
import { SyncSchedulerService, type SyncState } from './sync-scheduler.service';
import { SyncStatusService } from './sync-status.service';
import { SyncPullService } from './sync-pull.service';
import { ShoppingSessionStore } from '../../features/shopping/services/shopping-session.store';
import { QueuedOperation, SyncQueueService } from './sync-queue.service';
import {
  SyncRequest,
  SyncTransportService,
  SyncTransportError,
  SyncDispatchDeferred,
} from './sync-transport.service';

@Injectable({ providedIn: 'root' })
export class SyncProcessorService {
  private readonly queue = inject(SyncQueueService);
  private readonly db = inject(DatabaseService);
  private readonly transport = inject(SyncTransportService);
  private readonly status = inject(SyncStatusService);
  private readonly pull = inject(SyncPullService);
  private readonly store = inject(ShoppingSessionStore);
  private readonly base = inject(API_BASE_URL);
  private readonly scheduler = inject(SyncSchedulerService);
  readonly state = signal<SyncState>('DISABLED');
  private pending?: Promise<void>;
  private started = false;

  start(): void {
    if (this.started || !this.base) return;
    this.started = true;
    this.scheduler.start(
      async () => {
        try {
          await this.run();
        } catch {
          this.state.set('ATTENTION');
          this.status.message.set(
            'Não foi possível sincronizar agora. Suas compras locais foram preservadas.',
          );
        }
      },
      () => this.state(),
    );
  }

  private canContinue(): boolean {
    if (!this.started || this.scheduler.foreground()) return true;
    this.state.set('PAUSED');
    return false;
  }

  run(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.process().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async process(): Promise<void> {
    if (!this.base) {
      this.state.set('DISABLED');
      return;
    }
    if (!this.canContinue()) return;
    if (!navigator.onLine) {
      this.status.message.set('Sem conexão. Suas compras serão enviadas quando a conexão voltar.');
      this.state.set('OFFLINE');
      return;
    }
    const paused = await this.db.query<{ value: string }>(
      'SELECT value FROM app_metadata WHERE key=?',
      ['sync_pull_paused'],
    );
    if (paused[0]?.value === '1') {
      this.status.message.set(
        'O recebimento está pausado por um conflito. Suas compras foram preservadas.',
      );
      this.state.set('ATTENTION');
      return;
    }
    await this.queue.recover();
    for (let count = 0; count < 100; count++) {
      if (!this.canContinue()) return;
      const entry = await this.queue.claim();
      if (!this.canContinue()) {
        if (entry) await this.queue.releaseUnsent(entry);
        return;
      }
      if (!entry) {
        const failed = await this.db.query(
          "SELECT id FROM sync_queue WHERE status = 'FAILED' LIMIT 1",
        );
        if (!failed.length) {
          const waitingBeforePull = await this.db.query(
            "SELECT id FROM sync_queue WHERE status IN ('PENDING','SYNCING') LIMIT 1",
          );
          if (waitingBeforePull.length) {
            this.status.message.set(
              'Há alterações aguardando envio. Suas compras estão salvas neste aparelho.',
            );
            this.state.set('SYNCING');
            return;
          }
          try {
            if (!this.canContinue()) return;
            if (!(await this.pull.run(() => this.canContinue()))) {
              if (!this.canContinue()) return;
              this.status.lastSyncedAt.set(null);
              this.status.message.set(
                'Recebendo alterações do servidor. Suas compras locais estão preservadas.',
              );
              this.state.set('SYNCING');
              return;
            }
            await this.store.load();
          } catch (error) {
            if (error instanceof RemoteImportConflict) {
              await this.db.transaction([
                {
                  statement:
                    'INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                  values: ['sync_pull_paused', '1'],
                },
              ]);
              this.status.message.set(
                'O recebimento foi pausado por um conflito. Suas compras locais foram preservadas.',
              );
            } else
              this.status.message.set(
                'Não foi possível receber as alterações agora. Suas compras locais foram preservadas.',
              );
            this.state.set('ATTENTION');
            return;
          }
        }
        const waiting = await this.db.query(
          "SELECT id FROM sync_queue WHERE status IN ('PENDING','SYNCING') LIMIT 1",
        );
        if (waiting.length && !failed.length) {
          this.status.message.set(
            'Há alterações aguardando envio. Suas compras estão salvas neste aparelho.',
          );
          this.state.set('SYNCING');
          return;
        }
        if (!failed.length) this.status.lastSyncedAt.set(Date.now());
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
        if (!this.canContinue()) {
          await this.queue.releaseUnsent(entry);
          return;
        }
        const result = await this.transport.push(request, () => this.canContinue());
        if (result.status === 'APPLIED' || result.status === 'ALREADY_APPLIED') {
          await this.queue.applied(entry, Date.now(), {
            key: `remote_version:${entry.aggregate_type === 'SHOPPING_ITEM' ? 'SHOPPING_SESSION' : entry.aggregate_type}:${result.state!.snapshot.id}`,
            value: String(result.state!.snapshot.version),
          });
          this.status.activityRevision.update((value) => value + 1);
        } else {
          if (result.status === 'CONFLICT') {
            await this.queue.conflict(entry, result.state);
            this.status.message.set(
              'Há alterações diferentes no servidor. A sincronização foi pausada sem substituir suas compras.',
            );
          } else {
            await this.queue.failed(entry, false);
            this.status.message.set(
              'A sincronização está pausada. Há uma operação que precisa de revisão; suas compras locais foram preservadas.',
            );
          }
          this.state.set('ATTENTION');
          return;
        }
      } catch (error) {
        if (error instanceof SyncDispatchDeferred) {
          await this.queue.releaseUnsent(entry);
          if (this.canContinue()) this.state.set('SYNCING');
          return;
        }
        // Unknown failures (identity/storage/network) retain the operation for recovery.
        const transient = error instanceof SyncTransportError ? error.transient : true;
        await this.queue.failed(entry, transient);
        this.status.message.set(
          transient
            ? 'Envio pendente. Suas compras estão salvas e a conexão será tentada novamente.'
            : 'A sincronização está pausada. Há uma operação que precisa de revisão; suas compras locais foram preservadas.',
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
