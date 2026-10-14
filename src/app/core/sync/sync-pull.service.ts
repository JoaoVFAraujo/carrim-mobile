import { Injectable, inject } from '@angular/core';
import { DatabaseService } from '../database/database.service';
import { SyncTransportService } from './sync-transport.service';
import { snapshotStatements } from './remote-snapshot';

@Injectable({ providedIn: 'root' })
export class SyncPullService {
  private readonly db = inject(DatabaseService);
  private readonly transport = inject(SyncTransportService);
  async run(): Promise<void> {
    // Do not apply server state over any local pending edit.
    const pending = await this.db.query("SELECT id FROM sync_queue WHERE status!='SYNCED' LIMIT 1");
    if (pending.length) return;
    const cursors = await this.db.query<{ value: string }>(
      'SELECT value FROM app_metadata WHERE key=?',
      ['sync_cursor'],
    );
    let cursor = cursors[0]?.value;
    for (let count = 0; count < 20; count++) {
      const page = await this.transport.pull(cursor);
      // Stage pages first: a session's latest snapshot may reference catalog entries
      // whose journal events occur on later pages. Import dependencies together only
      // after reaching the current head, including after an interrupted bootstrap.
      const statements = page.changes.map((change) => ({
        statement:
          'INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        values: [
          `incoming_snapshot:${change.aggregateType}:${change.aggregateId}`,
          JSON.stringify(change),
        ],
      }));
      if (page.changes.length)
        statements.push({
          statement:
            'INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          values: ['sync_import_pending', '1'],
        });
      const applied = await this.db.applyRemotePage(statements, page.cursor);
      if (!applied) return;
      cursor = page.cursor;
      if (!page.hasMore) {
        const dirty = await this.db.query<{ value: string }>(
          'SELECT value FROM app_metadata WHERE key=?',
          ['sync_import_pending'],
        );
        if (dirty[0]?.value === '1') {
          const snapshots = await this.db.query<{
            value: string;
          }>(`SELECT value FROM app_metadata WHERE key LIKE 'incoming_snapshot:%'
            ORDER BY CASE WHEN key LIKE 'incoming_snapshot:PRODUCT:%' THEN 0
              WHEN key LIKE 'incoming_snapshot:SUPERMARKET:%' THEN 1 ELSE 2 END`);
          const ordered = snapshots.map((row) => JSON.parse(row.value));
          const priority = (change: { aggregateType: string; snapshot: { status?: string } }) =>
            change.aggregateType === 'PRODUCT'
              ? 0
              : change.aggregateType === 'SUPERMARKET'
                ? 1
                : change.snapshot.status === 'ACTIVE'
                  ? 3
                  : 2;
          ordered.sort((a, b) => priority(a) - priority(b));
          const imports = ordered.flatMap((change) => snapshotStatements(change, Date.now()));
          imports.push({
            statement: 'UPDATE app_metadata SET value=? WHERE key=?',
            values: ['0', 'sync_import_pending'],
          });
          await this.db.applyRemotePage(imports, cursor);
        }
        return;
      }
    }
  }
}
