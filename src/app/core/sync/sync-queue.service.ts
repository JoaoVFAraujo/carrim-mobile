import { Injectable, inject } from '@angular/core';
import { DatabaseService } from '../database/database.service';

export interface QueuedOperation {
  id: string;
  sequence_number: number;
  aggregate_type: string;
  aggregate_id: string;
  operation: string;
  payload_json: string;
  attempt_count: number;
  lease_token: string;
  request_json?: string | null;
}

const delays = [2000, 5000, 15000, 60000, 300000, 900000, 1800000, 3600000];
export const retryDelay = (attempt: number): number =>
  delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)];

/** Persistent scheduling only. A transport must support operation-id replay before use. */
@Injectable({ providedIn: 'root' })
export class SyncQueueService {
  private readonly database = inject(DatabaseService);

  async claim(now = Date.now()): Promise<QueuedOperation | null> {
    const lease = crypto.randomUUID();
    // Claim only the first unsynchronized entry: dependent operations cannot pass it.
    await this.database.transaction([
      {
        statement: `UPDATE sync_queue SET status = 'SYNCING', attempt_count = attempt_count + 1,
        processing_started_at_ms = ?, updated_at_ms = ?, lease_token = ?, last_error = NULL
        WHERE id = (SELECT id FROM sync_queue WHERE status != 'SYNCED'
          ORDER BY sequence_number LIMIT 1)
        AND status = 'PENDING' AND (next_attempt_at_ms IS NULL OR next_attempt_at_ms <= ?)`,
        values: [now, now, lease, now],
      },
    ]);
    const rows = await this.database.query<QueuedOperation>(
      "SELECT * FROM sync_queue WHERE status = 'SYNCING' AND lease_token = ?",
      [lease],
    );
    return rows[0] ?? null;
  }

  async applied(
    entry: QueuedOperation,
    now = Date.now(),
    version?: { key: string; value: string },
  ): Promise<void> {
    await this.database.transaction([
      ...(version
        ? [
            {
              statement: `INSERT INTO app_metadata(key,value) SELECT ?, ? WHERE EXISTS
          (SELECT 1 FROM sync_queue WHERE id = ? AND lease_token = ? AND status = 'SYNCING')
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
              values: [version.key, version.value, entry.id, entry.lease_token],
            },
          ]
        : []),
      {
        statement: `UPDATE sync_queue SET status = 'SYNCED', updated_at_ms = ?,
        processing_started_at_ms = NULL, lease_token = NULL, next_attempt_at_ms = NULL,
        last_error = NULL WHERE id = ? AND status = 'SYNCING' AND lease_token = ?`,
        values: [now, entry.id, entry.lease_token],
      },
    ]);
  }

  async failed(entry: QueuedOperation, transient: boolean, now = Date.now()): Promise<void> {
    // Persist only a fixed safe classification, never response bodies or credentials.
    await this.database.transaction([
      {
        statement: `UPDATE sync_queue SET status = ?, updated_at_ms = ?, next_attempt_at_ms = ?,
        last_error = ?, processing_started_at_ms = NULL, lease_token = NULL
        WHERE id = ? AND status = 'SYNCING' AND lease_token = ?`,
        values: [
          transient ? 'PENDING' : 'FAILED',
          now,
          transient ? now + retryDelay(entry.attempt_count) : null,
          transient ? 'TRANSIENT' : 'PERMANENT',
          entry.id,
          entry.lease_token,
        ],
      },
    ]);
  }

  async conflict(entry: QueuedOperation, state: unknown): Promise<void> {
    await this.database.transaction([
      {
        statement: `INSERT INTO app_metadata(key,value) SELECT ?,? WHERE EXISTS
        (SELECT 1 FROM sync_queue WHERE id=? AND lease_token=? AND status='SYNCING')
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        values: [
          `sync_conflict:${entry.id}`,
          JSON.stringify(state ?? null),
          entry.id,
          entry.lease_token,
        ],
      },
      {
        statement: `UPDATE sync_queue SET status='FAILED',last_error='CONFLICT',lease_token=NULL,
        processing_started_at_ms=NULL,updated_at_ms=? WHERE id=? AND lease_token=? AND status='SYNCING'`,
        values: [Date.now(), entry.id, entry.lease_token],
      },
    ]);
  }

  async recover(now = Date.now(), staleAfterMs = 120000): Promise<void> {
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 120000)
      throw new Error('A janela de recuperação deve ser de pelo menos dois minutos.');
    await this.database.transaction([
      {
        statement: `UPDATE sync_queue SET status = 'PENDING', updated_at_ms = ?,
        next_attempt_at_ms = ?, processing_started_at_ms = NULL, lease_token = NULL,
        last_error = 'INTERRUPTED' WHERE status = 'SYNCING'
        AND COALESCE(processing_started_at_ms, updated_at_ms) <= ?`,
        values: [now, now, now - staleAfterMs],
      },
    ]);
  }
}
