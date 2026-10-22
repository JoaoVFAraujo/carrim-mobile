import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import initSqlJs from 'sql.js';
import { DatabaseService } from '../database/database.service';
import { SyncSchedulerService } from '../sync/sync-scheduler.service';
import { productPhotosSchema } from '../database/migrations/011-product-photos';
import { ProductPhotoService } from './product-photo.service';
import { PhotoRepositoryService } from './photo-repository.service';
import { PhotoTransportError, PhotoTransportService } from './photo-transport.service';
import { type PhotoView, type PreparedPhoto, photoKey } from './photo-models';
import { imageDimensions, preparePhoto } from './prepare-photo';

const target = { barcode: '7891000100103', itemId: null, name: 'Leite Moça' };
const prepared: PreparedPhoto = {
  contentType: 'image/jpeg',
  imageBase64: '/9j/2Q==',
  width: 1,
  height: 1,
};

describe('offline product photos and separate media queue', () => {
  async function setup(enabled = false) {
    const SQL = await initSqlJs();
    let local = new SQL.Database();
    local.run(
      'PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); CREATE TABLE sync_queue(id TEXT); CREATE TABLE shopping_items(id TEXT PRIMARY KEY)',
    );
    productPhotosSchema.forEach((statement) => local.run(statement));
    const raw = (sql: string, values: unknown[] = []) => {
      const statement = local.prepare(sql);
      statement.bind(values);
      const rows: Record<string, unknown>[] = [];
      try {
        while (statement.step()) rows.push(statement.getAsObject());
        return rows;
      } finally {
        statement.free();
      }
    };
    const db = new DatabaseService();
    Object.assign(db, {
      opening: Promise.resolve(),
      connection: { saveToStore: async () => undefined },
      database: {
        query: async (sql: string, values: unknown[] = []) => ({ values: raw(sql, values) }),
        executeSet: async (items: { statement: string; values?: unknown[] }[]) => {
          local.run('BEGIN');
          try {
            items.forEach((item) => local.run(item.statement, item.values ?? []));
            local.run('COMMIT');
          } catch (error) {
            local.run('ROLLBACK');
            throw error;
          }
        },
      },
    });
    const request = vi.fn();
    const image = vi.fn().mockResolvedValue(prepared.imageBase64);
    const transport = { enabled, request, image };
    const foreground = vi.fn().mockReturnValue(true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: DatabaseService, useValue: db },
        { provide: PhotoTransportService, useValue: transport },
        { provide: SyncSchedulerService, useValue: { foreground } },
      ],
    });
    const service = TestBed.inject(ProductPhotoService),
      repo = TestBed.inject(PhotoRepositoryService);
    const photo = (id: string, overrides: Partial<PhotoView> = {}): PhotoView => ({
      id,
      barcode: target.barcode,
      itemId: null,
      name: target.name,
      source: 'USER',
      status: 'PENDING',
      version: 0,
      contentHash: 'a'.repeat(64),
      sourceUrl: null,
      licenseUrl: null,
      updatedAt: new Date().toISOString(),
      own: true,
      ...overrides,
    });
    const success = () =>
      request.mockImplementation(
        async (method: string, path: string, body: Record<string, unknown>) => {
          if (method === 'PUT' && path.includes('/preferences/'))
            return {
              key: photoKey(target),
              barcode: target.barcode,
              itemId: null,
              photoId: body['photoId'],
              hidden: body['hidden'],
              version: Number(body['version'] ?? -1) + 1,
            };
          if (method === 'PUT') return photo(path.split('/').pop()!);
          if (method === 'DELETE') return photo(path.split('/').pop()!, { status: 'DELETED' });
          throw new PhotoTransportError(404);
        },
      );
    return {
      service,
      repo,
      transport,
      request,
      image,
      foreground,
      raw,
      photo,
      success,
      run: (sql: string) => local.run(sql),
      reopen: () => {
        const bytes = local.export();
        local.close();
        local = new SQL.Database(bytes);
        local.run('PRAGMA foreign_keys=ON');
      },
    };
  }
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('stores image, preference and durable jobs atomically without entering the purchase queue, surviving reopen', async () => {
    const { service, raw, reopen, request } = await setup();
    await service.save(prepared, target);
    await service.flush();
    expect(raw('SELECT * FROM product_photos')).toHaveLength(1);
    expect(
      raw("SELECT kind FROM photo_outbox WHERE status='PENDING'").map((r) => r['kind']),
    ).toEqual(['UPLOAD', 'PREFERENCE']);
    expect(raw('SELECT * FROM sync_queue')).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    reopen();
    expect((await service.get(target))?.imageUrl).toBe(
      'data:image/jpeg;base64,' + prepared.imageBase64,
    );
  });
  it('rolls back the image and preference if its durable intent cannot be written', async () => {
    const { service, raw, run } = await setup();
    run(
      "CREATE TRIGGER reject_photo BEFORE INSERT ON photo_outbox BEGIN SELECT RAISE(ABORT,'storage unavailable'); END",
    );
    await expect(service.save(prepared, target)).rejects.toThrow();
    expect(raw('SELECT * FROM product_photos')).toEqual([]);
    expect(raw('SELECT * FROM photo_preferences')).toEqual([]);
  });
  it('supports a manual item without inventing a barcode', async () => {
    const { service } = await setup();
    const manual = { barcode: null, itemId: crypto.randomUUID(), name: 'Banana' };
    await service.save(prepared, manual);
    expect((await service.get(manual))?.barcode).toBeNull();
  });
  it('uploads pending photos and versions the preference through the separate transport', async () => {
    const { service, success, request, raw } = await setup(true);
    success();
    await service.save(prepared, target);
    await service.flush();
    expect(request).toHaveBeenCalledWith(
      'PUT',
      expect.stringMatching(/^\/products\/photos\/[a-f0-9-]+$/),
      expect.objectContaining({ imageBase64: prepared.imageBase64 }),
      expect.any(Function),
    );
    expect(raw("SELECT * FROM photo_outbox WHERE status!='SUPERSEDED'")).toEqual([]);
    expect(raw('SELECT remote_version FROM photo_preferences')[0]['remote_version']).toBe(0);
  });
  it('persists retry deadlines and reuses the frozen upload after response loss', async () => {
    const { service, success, request, raw, run } = await setup(true);
    request.mockRejectedValueOnce(new PhotoTransportError(0));
    await service.save(prepared, target);
    await service.flush();
    const first = raw(
      'SELECT request_json,next_attempt_at_ms FROM photo_outbox ORDER BY sequence LIMIT 1',
    )[0];
    expect(first['request_json']).toContain(prepared.imageBase64);
    expect(Number(first['next_attempt_at_ms'])).toBeGreaterThan(Date.now());
    success();
    run('UPDATE photo_outbox SET next_attempt_at_ms=0');
    await service.flush();
    expect(
      request.mock.calls.filter((c) => c[0] === 'PUT' && !c[1].includes('preferences'))[1][2],
    ).toEqual(JSON.parse(String(first['request_json'])));
    expect(raw('SELECT * FROM sync_queue')).toEqual([]);
  });

  it('reconciles only the server version for a new replacement after its previous preference acknowledgement was lost', async () => {
    const { service, request, raw, photo } = await setup(true);
    let server: {
      key: string;
      barcode: string;
      itemId: null;
      photoId: string;
      hidden: boolean;
      version: number;
    } | null = null;
    let losePreference = true;
    request.mockImplementation(
      async (method: string, path: string, body: Record<string, unknown>) => {
        if (method === 'GET' && path.includes('/preferences/')) {
          if (!server) throw new PhotoTransportError(404);
          return server;
        }
        if (method === 'PUT' && !path.includes('/preferences/'))
          return photo(path.split('/').pop()!, { name: String(body['name']) });
        if (method === 'PUT') {
          if (body['version'] !== (server?.version ?? null)) throw new PhotoTransportError(409);
          server = {
            key: photoKey(target),
            barcode: target.barcode,
            itemId: null,
            photoId: String(body['photoId']),
            hidden: Boolean(body['hidden']),
            version: (server?.version ?? -1) + 1,
          };
          if (losePreference) {
            losePreference = false;
            throw new PhotoTransportError(0);
          }
          return server;
        }
        throw new PhotoTransportError(404);
      },
    );
    await service.save(prepared, target);
    await service.flush();
    const oldJob = raw(
      "SELECT id,request_json FROM photo_outbox WHERE kind='PREFERENCE' AND status='PENDING'",
    )[0];
    expect(JSON.parse(String(oldJob['request_json'])).version).toBeNull();
    expect(raw('SELECT remote_version FROM photo_preferences')[0]['remote_version']).toBeNull();
    const oldId = (await service.get(target))!.id;
    await service.save(prepared, { ...target, name: 'Explicit replacement' });
    await service.flush();
    expect((await service.get(target))?.id).not.toBe(oldId);
    expect((await service.get(target))?.name).toBe('Explicit replacement');
    expect(raw('SELECT remote_version FROM photo_preferences')[0]['remote_version']).toBe(1);
    expect(raw("SELECT * FROM photo_outbox WHERE status!='SUPERSEDED'")).toEqual([]);
    expect(
      raw('SELECT request_json FROM photo_outbox WHERE id=?', [oldJob['id']])[0]['request_json'],
    ).toBe(oldJob['request_json']);
    const preferenceCalls = request.mock.calls.filter(
      (call) => call[0] === 'PUT' && call[1].includes('/preferences/'),
    );
    expect(preferenceCalls[1][2].version).toBe(0);
  });

  it('replays a frozen preference unchanged without fetching a new version after response loss', async () => {
    const { service, request, raw, photo, run } = await setup(true);
    let losePreference = true;
    request.mockImplementation(
      async (method: string, path: string, body: Record<string, unknown>) => {
        if (method === 'GET' && path.includes('/preferences/')) throw new PhotoTransportError(404);
        if (method === 'PUT' && !path.includes('/preferences/'))
          return photo(path.split('/').pop()!);
        if (method === 'PUT') {
          if (losePreference) {
            losePreference = false;
            throw new PhotoTransportError(0);
          }
          return {
            key: photoKey(target),
            barcode: target.barcode,
            itemId: null,
            photoId: body['photoId'],
            hidden: body['hidden'],
            version: 0,
          };
        }
        throw new PhotoTransportError(404);
      },
    );
    await service.save(prepared, target);
    await service.flush();
    const frozen = String(
      raw("SELECT request_json FROM photo_outbox WHERE kind='PREFERENCE'")[0]['request_json'],
    );
    run('UPDATE photo_outbox SET next_attempt_at_ms=0');
    await service.flush();
    const preferenceCalls = request.mock.calls.filter(
      (call) => call[0] === 'PUT' && call[1].includes('/preferences/'),
    );
    expect(preferenceCalls).toHaveLength(2);
    expect(preferenceCalls[1][2]).toEqual(JSON.parse(frozen));
    expect(
      request.mock.calls.filter((call) => call[0] === 'GET' && call[1].includes('/preferences/')),
    ).toHaveLength(1);
  });
  it('keeps unresolved photo conflicts local and permits a new explicit replacement to supersede old intent', async () => {
    const { service, request, raw, success } = await setup(true);
    request.mockRejectedValue(new PhotoTransportError(409));
    await service.save(prepared, target);
    await service.flush();
    expect((await service.get(target))?.imageUrl).toBeTruthy();
    expect(raw("SELECT * FROM photo_outbox WHERE status='FAILED'")).toHaveLength(1);
    success();
    await service.save(prepared, { ...target, name: 'New photo' });
    await service.flush();
    expect(raw("SELECT * FROM photo_outbox WHERE status='SUPERSEDED'").length).toBeGreaterThan(0);
    expect(raw("SELECT * FROM photo_outbox WHERE status!='SUPERSEDED'")).toEqual([]);
    expect((await service.get(target))?.name).toBe('Leite Moça');
  });
  it('removing a never-uploaded photo hides it immediately and completes if server has no copy', async () => {
    const { service, transport, request, raw } = await setup();
    await service.save(prepared, target);
    await service.remove(target);
    expect(await service.get(target)).toBeNull();
    transport.enabled = true;
    request.mockImplementation(async (method: string) => {
      if (method === 'PUT')
        return {
          key: photoKey(target),
          barcode: target.barcode,
          itemId: null,
          photoId: null,
          hidden: true,
          version: 0,
          ...{},
        };
      throw new PhotoTransportError(404);
    });
    await service.flush();
    expect(raw("SELECT * FROM photo_outbox WHERE status!='SUPERSEDED'")).toEqual([]);
  });
  it.each([true, false])(
    'restores the catalogue after acknowledging an explicit restore (online=%s)',
    async (online) => {
      const { service, transport, request, photo, success, raw } = await setup();
      await service.save(prepared, target);
      transport.enabled = true;
      success();
      await service.flush();
      const personalId = (await service.get(target))!.id;
      const approved = photo(crypto.randomUUID(), { status: 'APPROVED', own: false });
      const accept = request.getMockImplementation()!;
      request.mockImplementation(
        async (method: string, path: string, body: Record<string, unknown>) => {
          if (method === 'GET' && path === '/products/photos/approved/' + target.barcode)
            return approved;
          return accept(method, path, body);
        },
      );
      request.mockClear();
      transport.enabled = online;
      await service.restoreCatalog(target);
      if (!online) {
        expect(request).not.toHaveBeenCalled();
        expect(await service.get(target)).toBeNull();
        transport.enabled = true;
      }
      await service.flush();
      expect((await service.get(target))?.id).toBe(approved.id);
      expect((await service.get(target))?.id).not.toBe(personalId);
      expect(
        request.mock.calls.filter(
          (call) => call[1] === '/products/photos/approved/' + target.barcode,
        ),
      ).toHaveLength(1);
      expect(raw("SELECT * FROM photo_outbox WHERE status!='SUPERSEDED'")).toEqual([]);
      await service.flush();
      expect(
        request.mock.calls.filter(
          (call) => call[1] === '/products/photos/approved/' + target.barcode,
        ),
      ).toHaveLength(1);
    },
  );

  it('does not restore a removed photo after its hidden preference is acknowledged', async () => {
    const { service, request, success } = await setup(true);
    success();
    await service.remove(target);
    await service.flush();
    expect(await service.hidden(target)).toBe(true);
    expect(request.mock.calls.some((call) => call[1].includes('/approved/'))).toBe(false);
  });

  it.each(['remove', 'replace'])(
    'preserves a newer %s decision made while a catalogue restore is in flight',
    async (decision) => {
      const { service, request, success } = await setup(true);
      success();
      const accept = request.getMockImplementation()!;
      request.mockImplementation(
        async (method: string, path: string, body: Record<string, unknown>) => {
          if (
            method === 'PUT' &&
            path.includes('/preferences/') &&
            body['photoId'] === null &&
            body['hidden'] === false
          ) {
            if (decision === 'remove') await service.remove(target);
            else await service.save(prepared, target);
          }
          return accept(method, path, body);
        },
      );
      await service.restoreCatalog(target);
      await service.flush();
      if (decision === 'remove') expect(await service.hidden(target)).toBe(true);
      else expect(await service.get(target)).toMatchObject({ own: true, source: 'USER' });
      expect(request.mock.calls.some((call) => call[1].includes('/approved/'))).toBe(false);
    },
  );
  it('does not retry or contact the server while backgrounded', async () => {
    const { service, foreground, request } = await setup(true);
    foreground.mockReturnValue(false);
    await service.save(prepared, target);
    await service.flush();
    expect(request).not.toHaveBeenCalled();
    expect(service.pendingCount()).toBe(2);
  });

  it('lets unrelated photos progress without bypassing a failed target dependency', async () => {
    const { service, transport, request, raw, success } = await setup();
    await service.save(prepared, target);
    const first = raw('SELECT id FROM photo_outbox ORDER BY sequence LIMIT 1')[0]['id'];
    const secondTarget = { ...target, barcode: '7894900011517', name: 'Another product' };
    await service.save(prepared, secondTarget);
    transport.enabled = true;
    success();
    const accepted = request.getMockImplementation()!;
    request.mockImplementation(
      async (method: string, path: string, body: Record<string, unknown>) => {
        if (
          method === 'PUT' &&
          !path.includes('/preferences/') &&
          body['barcode'] === target.barcode
        )
          throw new PhotoTransportError(409);
        if (method === 'PUT' && path.includes('/preferences/'))
          return {
            key: photoKey(secondTarget),
            barcode: secondTarget.barcode,
            itemId: null,
            photoId: body['photoId'],
            hidden: body['hidden'],
            version: 0,
          };
        const value = await accepted(method, path, body);
        return { ...value, barcode: secondTarget.barcode };
      },
    );
    await service.flush();
    await service.flush();
    expect(raw('SELECT status FROM photo_outbox WHERE id=?', [first])[0]['status']).toBe('FAILED');
    expect(
      raw("SELECT * FROM photo_outbox WHERE target_key=? AND status!='SUPERSEDED'", [
        photoKey(secondTarget),
      ]),
    ).toEqual([]);
    expect(
      raw("SELECT * FROM photo_outbox WHERE target_key=? AND kind='PREFERENCE'", [
        photoKey(target),
      ]),
    ).toHaveLength(1);
  });

  it('discards the intent for an item removed before upload instead of retrying its missing parent forever', async () => {
    const { service, transport, request, raw, run } = await setup();
    const manual = { barcode: null, itemId: crypto.randomUUID(), name: 'Removed item' };
    run("INSERT INTO shopping_items(id) VALUES ('" + manual.itemId + "')");
    await service.save(prepared, manual);
    run('DELETE FROM shopping_items');
    transport.enabled = true;
    request.mockRejectedValue(new PhotoTransportError(404));
    await service.flush();
    expect(await service.get(manual)).toBeNull();
    expect(await service.hidden(manual)).toBe(true);
    expect(request.mock.calls.every((call) => call[0] === 'DELETE')).toBe(true);
    expect(raw("SELECT * FROM photo_outbox WHERE status!='SUPERSEDED'")).toEqual([]);
  });
  it('does not hide the private photo when an administrator rejects its public candidacy', async () => {
    const { service, success, request, photo } = await setup(true);
    success();
    await service.save(prepared, target);
    await service.flush();
    const stored = (await service.get(target))!;
    request.mockResolvedValue(photo(stored.id, { status: 'REJECTED', version: 1 }));
    await service.refresh(target, true);
    expect((await service.get(target))?.status).toBe('REJECTED');
  });
  it('refreshing the same public image is bounded and does not upload another preference', async () => {
    const { service, repo, photo, request, image } = await setup(true);
    const approved = photo(crypto.randomUUID(), { status: 'APPROVED', own: false });
    await repo.selectCatalog(approved, prepared.imageBase64, target);
    await repo.applied((await repo.next())!);
    request.mockResolvedValue(approved);
    await service.refresh(target, true);
    const before = request.mock.calls.length;
    await service.refresh(target);
    await service.cacheCatalog(target);
    expect(request).toHaveBeenCalledTimes(before);
    expect(image).not.toHaveBeenCalled();
    expect(service.pendingCount()).toBe(0);
  });
  it('reclaims obsolete images across repeated catalog replacements', async () => {
    const { repo, photo, raw } = await setup();
    let latest = '';
    for (let index = 0; index < 105; index++) {
      latest = crypto.randomUUID();
      await repo.selectCatalog(
        photo(latest, { own: false, status: 'APPROVED' }),
        prepared.imageBase64,
        target,
      );
      await repo.applied((await repo.next())!);
    }
    expect((await repo.get(target))?.id).toBe(latest);
    expect(raw('SELECT id FROM product_photos WHERE image_base64 IS NOT NULL')).toHaveLength(1);
  });

  it('replaces a catalog photo at the image quota while preserving other products', async () => {
    const { repo, photo, raw } = await setup();
    const entries = Array.from({ length: 100 }, (_, index) => ({
      target: { barcode: String(10000000 + index), itemId: null },
      id: crypto.randomUUID(),
    }));
    for (const entry of entries) {
      await repo.selectCatalog(
        photo(entry.id, { barcode: entry.target.barcode, own: false, status: 'APPROVED' }),
        prepared.imageBase64,
        entry.target,
      );
      await repo.applied((await repo.next())!);
    }
    const replacement = photo(crypto.randomUUID(), {
      barcode: entries[0].target.barcode,
      own: false,
      status: 'APPROVED',
    });
    await repo.selectCatalog(replacement, prepared.imageBase64, entries[0].target);
    expect((await repo.get(entries[0].target))?.id).toBe(replacement.id);
    expect(await repo.photo(entries[0].id)).toBeNull();
    expect((await repo.get(entries[99].target))?.id).toBe(entries[99].id);
    expect(raw('SELECT id FROM product_photos WHERE image_base64 IS NOT NULL')).toHaveLength(100);
  });

  it.each(['UPLOAD', 'PREFERENCE'])(
    'preserves shared images and bytes needed by an active %s job',
    async (kind) => {
      const { repo, photo, run } = await setup();
      const prior = photo(crypto.randomUUID(), { own: false, status: 'APPROVED' });
      await repo.selectCatalog(prior, prepared.imageBase64, target);
      await repo.applied((await repo.next())!);
      const other = { barcode: '10000000', itemId: null };
      await repo.importPreference({
        key: photoKey(other),
        barcode: other.barcode,
        itemId: null,
        photoId: prior.id,
        hidden: false,
        version: 0,
      });
      await repo.selectCatalog(
        photo(crypto.randomUUID(), { own: false, status: 'APPROVED' }),
        prepared.imageBase64,
        target,
      );
      await repo.applied((await repo.next())!);
      expect((await repo.get(other))?.id).toBe(prior.id);
      run("DELETE FROM photo_preferences WHERE target_key='" + photoKey(other) + "'");
      const payload = JSON.stringify(kind === 'UPLOAD' ? { id: prior.id } : { photoId: prior.id });
      run(
        "INSERT INTO photo_outbox(id,kind,target_key,payload_json) VALUES ('" +
          crypto.randomUUID() +
          "','" +
          kind +
          "','" +
          photoKey(other) +
          "','" +
          payload +
          "')",
      );
      await repo.selectCatalog(
        photo(crypto.randomUUID(), { own: false, status: 'APPROVED' }),
        prepared.imageBase64,
        target,
      );
      expect((await repo.photo(prior.id))?.imageUrl).toContain(prepared.imageBase64);
    },
  );

  it('keeps a personal choice and discards an automatic image downloaded before that choice', async () => {
    const { service, repo, photo, raw } = await setup();
    await service.save(prepared, target);
    const personal = (await repo.get(target))!;
    const incoming = photo(crypto.randomUUID(), { own: false, status: 'APPROVED' });
    await repo.selectCatalog(incoming, prepared.imageBase64, target);
    expect((await repo.get(target))?.id).toBe(personal.id);
    expect(await repo.photo(incoming.id)).toBeNull();
    expect(raw("SELECT kind FROM photo_outbox WHERE status!='SUPERSEDED'")).toHaveLength(2);
  });

  it('invalidates a previously approved public image after online access is revoked', async () => {
    const { service, repo, photo, request } = await setup(true);
    const approved = photo(crypto.randomUUID(), { status: 'APPROVED', own: false });
    await repo.selectCatalog(approved, prepared.imageBase64, target);
    await repo.applied((await repo.next())!);
    request.mockRejectedValue(new PhotoTransportError(403));
    await service.refresh(target, true);
    expect(await service.get(target)).toBeNull();
  });

  it.each([true, false])(
    'continues importing preferences after public revocation on repeated refreshes (cached=%s)',
    async (cached) => {
      const { service, repo, photo, request, raw } = await setup(true);
      const revoked = photo(crypto.randomUUID(), { status: 'APPROVED', own: false });
      if (cached) {
        await repo.selectCatalog(revoked, prepared.imageBase64, target);
        await repo.applied((await repo.next())!);
      }
      const later = { barcode: '7894900011517', itemId: null };
      const preferences = [
        {
          key: photoKey(target),
          barcode: target.barcode,
          itemId: null,
          photoId: revoked.id,
          hidden: false,
          version: 2,
        },
        {
          key: photoKey(later),
          ...later,
          photoId: null,
          hidden: true,
          version: 3,
        },
      ];
      request.mockImplementation(async (method: string, path: string) => {
        if (method === 'GET' && path === '/products/photos/preferences') return preferences;
        throw new PhotoTransportError(404);
      });
      for (let pass = 0; pass < 2; pass++) {
        await service.refresh(undefined, true);
        expect(await repo.preference(target)).toMatchObject({ photo_id: null, remote_version: 2 });
        expect(await repo.preference(later)).toMatchObject({ hidden: 1, remote_version: 3 });
        expect(await service.get(target)).toBeNull();
        expect(raw("SELECT * FROM photo_outbox WHERE status!='SUPERSEDED'")).toEqual([]);
      }
    },
  );

  it('withdraws a cached public selection if approval is revoked before its preference is acknowledged', async () => {
    const { service, repo, photo, request, raw } = await setup(true);
    const approved = photo(crypto.randomUUID(), { status: 'APPROVED', own: false });
    await repo.selectCatalog(approved, prepared.imageBase64, target);
    request.mockRejectedValue(new PhotoTransportError(404));
    await service.flush();
    expect(await service.get(target)).toBeNull();
    expect(raw("SELECT * FROM photo_outbox WHERE status!='SUPERSEDED'")).toEqual([]);
    expect(raw('SELECT request_json FROM photo_outbox')[0]['request_json']).toBeTruthy();
    expect(request).toHaveBeenCalledWith(
      'GET',
      '/products/photos/' + approved.id,
      undefined,
      expect.any(Function),
    );
  });

  it('keeps retrying a missing product parent if the selected public photo is still approved', async () => {
    const { service, repo, photo, request, raw } = await setup(true);
    const approved = photo(crypto.randomUUID(), { status: 'APPROVED', own: false });
    await repo.selectCatalog(approved, prepared.imageBase64, target);
    request.mockImplementation(async (method: string) => {
      if (method === 'GET') return approved;
      throw new PhotoTransportError(404);
    });
    await service.flush();
    expect((await service.get(target))?.id).toBe(approved.id);
    expect(raw("SELECT * FROM photo_outbox WHERE status='PENDING'")).toHaveLength(1);
  });

  it('receives hidden preferences beyond the first page without replacing pending local intent', async () => {
    const { service, request, raw } = await setup(true);
    const preferences = Array.from({ length: 201 }, (_, index) => {
      const barcode = String(10000000 + index);
      return {
        key: 'barcode:' + barcode,
        barcode,
        itemId: null,
        photoId: null,
        hidden: true,
        version: 0,
      };
    });
    request.mockImplementation(
      async (
        method: string,
        path: string,
        _body: unknown,
        _continue: unknown,
        params: { offset: number },
      ) => {
        if (method === 'GET' && path === '/products/photos/preferences')
          return preferences.slice(params.offset, params.offset + 100);
        throw new PhotoTransportError(404);
      },
    );
    await service.refresh(undefined, true);
    expect(raw('SELECT target_key FROM photo_preferences')).toHaveLength(201);
    expect(await service.hidden({ barcode: preferences[200].barcode, itemId: null })).toBe(true);
    expect(request.mock.calls.map((call) => call[4]?.offset)).toEqual([0, 100, 200]);
  });

  it('stops pagination if the server repeats a full page instead of advancing', async () => {
    const { service, request, raw } = await setup(true);
    const preferences = Array.from({ length: 100 }, (_, index) => {
      const barcode = String(10000000 + index);
      return {
        key: 'barcode:' + barcode,
        barcode,
        itemId: null,
        photoId: null,
        hidden: true,
        version: 0,
      };
    });
    request.mockResolvedValue(preferences);
    await service.refresh(undefined, true);
    expect(request.mock.calls.map((call) => call[4]?.offset)).toEqual([0, 100]);
    expect(raw('SELECT target_key FROM photo_preferences')).toHaveLength(100);
  });

  it('does not start another preference page after the app leaves the foreground', async () => {
    const { service, repo, request, foreground } = await setup(true);
    const preferences = Array.from({ length: 100 }, (_, index) => {
      const barcode = String(10000000 + index);
      return {
        key: 'barcode:' + barcode,
        barcode,
        itemId: null,
        photoId: null,
        hidden: true,
        version: 0,
      };
    });
    const importPreference = repo.importPreference.bind(repo);
    vi.spyOn(repo, 'importPreference').mockImplementation(async (preference) => {
      await importPreference(preference);
      if (preference.key === preferences[99].key) foreground.mockReturnValue(false);
    });
    request.mockResolvedValue(preferences);
    await service.refresh(undefined, true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('photo file preparation before decoding', () => {
  it('rejects fake MIME content and oversized compressed image dimensions before opening an image', async () => {
    const bad = new File(['not an image'], 'photo.png', { type: 'image/png' });
    await expect(preparePhoto(bad)).rejects.toThrow();
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.set([73, 72, 68, 82], 12);
    const v = new DataView(png.buffer);
    v.setUint32(16, 100000);
    v.setUint32(20, 100000);
    expect(imageDimensions(png)).toEqual({ width: 100000, height: 100000 });
    const large = new File([png], 'large.png', { type: 'image/png' });
    Object.defineProperty(large, 'arrayBuffer', { value: async () => png.buffer });
    await expect(preparePhoto(large)).rejects.toThrow('resolução');
  });
});
