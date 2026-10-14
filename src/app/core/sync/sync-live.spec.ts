import { TestBed } from '@angular/core/testing';
import {
  HttpBackend,
  HttpErrorResponse,
  HttpResponse,
  provideHttpClient,
  withFetch,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { env } from 'node:process';
import initSqlJs from 'sql.js';
import { Capacitor } from '@capacitor/core';
import { vi } from 'vitest';
import { DatabaseService } from '../database/database.service';
import { API_BASE_URL } from '../api/api-endpoint';
import { CredentialVault } from '../api/credential-vault';
import { SyncProcessorService } from './sync-processor.service';
import { ShoppingSessionStore } from '../../features/shopping/services/shopping-session.store';
import { initialSchema } from '../database/migrations/001-initial-schema';
import { shoppingItemsSchema } from '../database/migrations/002-shopping-items';
import { completedShoppingSchema } from '../database/migrations/003-completed-shopping';
import { itemSessionGuardSchema } from '../database/migrations/004-item-session-guard';
import { productCatalogSchema } from '../database/migrations/005-product-catalog';
import { weightItemsSchema } from '../database/migrations/006-weight-items';
import { bundleItemsSchema } from '../database/migrations/007-bundle-items';
import { checkoutTotalSchema } from '../database/migrations/008-checkout-total';
import { syncRetrySchema } from '../database/migrations/009-sync-retry';
import { syncRequestSchema } from '../database/migrations/010-sync-request';

// Opt in against an isolated local API; the native plugins are replaced, not the
// processor, mapping, ownership boundary, HTTP protocol or SQLite statements.
describe.skipIf(env['CARRIM_LIVE_SYNC'] !== '1')('live offline/online sync', () => {
  afterEach(() => vi.restoreAllMocks());
  it('survives restart and a lost response, then pulls server changes without echoing the outbox', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    let online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const SQL = await initSqlJs();
    let local = new SQL.Database();
    local.run('PRAGMA foreign_keys = ON');
    for (const schema of [
      initialSchema,
      shoppingItemsSchema,
      completedShoppingSchema,
      itemSessionGuardSchema,
      productCatalogSchema,
      weightItemsSchema,
      bundleItemsSchema,
      checkoutTotalSchema,
      syncRetrySchema,
      syncRequestSchema,
    ])
      schema.forEach((sql) => local.run(sql));
    const query = (sql: string, values: unknown[] = []) => {
      const st = local.prepare(sql);
      st.bind(values);
      const rows: Record<string, unknown>[] = [];
      try {
        while (st.step()) rows.push(st.getAsObject());
        return { values: rows };
      } finally {
        st.free();
      }
    };
    const db = new DatabaseService();
    Object.assign(db, {
      opening: Promise.resolve(),
      database: {
        query,
        executeSet: async (statements: { statement: string; values: unknown[] }[]) => {
          local.run('BEGIN');
          try {
            statements.forEach((st) => local.run(st.statement, st.values));
            local.run('COMMIT');
          } catch (e) {
            local.run('ROLLBACK');
            throw e;
          }
        },
      },
    });
    let vault: string | null = null;
    let loseResponse = true;
    const backend: HttpBackend = {
      handle: (req) =>
        new Observable((subscriber) => {
          const headers: Record<string, string> = {};
          req.headers.keys().forEach((k) => (headers[k] = req.headers.get(k)!));
          if (req.detectContentTypeHeader())
            headers['Content-Type'] = req.detectContentTypeHeader()!;
          fetch('http://127.0.0.1:8082' + req.urlWithParams, {
            method: req.method,
            headers,
            body: req.body == null ? undefined : JSON.stringify(req.body),
            redirect: 'error',
          })
            .then(async (response) => {
              const body = await response.json();
              if (loseResponse && req.url.endsWith('/sync/push')) {
                loseResponse = false;
                throw new HttpErrorResponse({ status: 0 });
              }
              if (!response.ok)
                throw new HttpErrorResponse({ status: response.status, error: body });
              subscriber.next(new HttpResponse({ status: response.status, body }));
              subscriber.complete();
            })
            .catch((error) => {
              subscriber.error(error);
            });
        }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        { provide: HttpBackend, useValue: backend },
        { provide: DatabaseService, useValue: db },
        { provide: API_BASE_URL, useValue: '/api/v1' },
        {
          provide: CredentialVault,
          useValue: {
            read: async () => vault,
            write: async (value: string) => {
              vault = value;
            },
          },
        },
      ],
    });
    const store = TestBed.inject(ShoppingSessionStore),
      processor = TestBed.inject(SyncProcessorService);
    await store.load();
    await store.create('', 'Offline ' + crypto.randomUUID(), 20000);
    const session = store.active()!.id;
    await store.saveItem('Rice', 799, 2, undefined, '0789600112233');
    await store.saveWeightItem('Coffee', 699, 824);
    await store.saveBundleItem('Promotion', 3, 1000, 6);
    expect(store.totalCents()).toBe(4174);
    await store.complete(4200);
    await processor.run();
    expect(processor.state()).toBe('OFFLINE');
    expect(vault).toBeNull();
    const saved = local.export();
    local.close();
    local = new SQL.Database(saved);
    local.run('PRAGMA foreign_keys = ON');
    online = true;
    await processor.run();
    expect(processor.state()).toBe('ATTENTION');
    // Advance the scheduler clock without sleeping; attempt count/request remain saved.
    local.run("UPDATE sync_queue SET next_attempt_at_ms=0 WHERE status='PENDING'");
    await processor.run();
    expect(
      query(
        "SELECT aggregate_type,operation,status,last_error FROM sync_queue WHERE status!='SYNCED'",
      ).values,
    ).toEqual([]);
    expect(processor.state()).toBe('READY');
    expect(query("SELECT id FROM sync_queue WHERE status!='SYNCED'").values).toHaveLength(0);
    const identity = JSON.parse(vault!);
    const remote = await fetch('http://127.0.0.1:8082/api/v1/shopping-sessions/' + session, {
      headers: { Authorization: 'Bearer ' + identity.accessToken },
    }).then((r) => r.json());
    expect(remote.calculatedTotalCents).toBe(4174);
    expect(remote.checkoutDifferenceCents).toBe(26);
    expect(remote.items).toHaveLength(3);
    expect(remote.status).toBe('COMPLETED');
    const extra = crypto.randomUUID();
    const create = await fetch('http://127.0.0.1:8082/api/v1/supermarkets', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + identity.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: extra, name: 'Changed on server' }),
    });
    expect(create.status).toBe(201);
    await processor.run();
    expect(query('SELECT name FROM supermarkets WHERE id=?', [extra]).values[0]?.['name']).toBe(
      'Changed on server',
    );
    expect(query("SELECT id FROM sync_queue WHERE status!='SYNCED'").values).toHaveLength(0);
    expect(
      query('SELECT attempt_count FROM sync_queue ORDER BY sequence_number LIMIT 1').values[0]?.[
        'attempt_count'
      ],
    ).toBe(2);
    local.close();
  }, 60000);
});
