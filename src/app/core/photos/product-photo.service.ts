import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { SyncSchedulerService } from '../sync/sync-scheduler.service';
import { SyncStatusService } from '../sync/sync-status.service';
import { PhotoRepositoryService } from './photo-repository.service';
import { PhotoTransportError, PhotoTransportService } from './photo-transport.service';
import { PHOTO_PREPARER } from './prepare-photo';
import {
  type PhotoJob,
  type PhotoTarget,
  type PhotoView,
  type PreparedPhoto,
  type StoredPhoto,
  photoKey,
  validImageBase64,
  validatePhoto,
  validatePreference,
} from './photo-models';
export type { PhotoTarget, PreparedPhoto, StoredPhoto } from './photo-models';

/** Separate durable media queue: an unavailable photo never blocks purchase sync. */
@Injectable({ providedIn: 'root' })
export class ProductPhotoService {
  private readonly repository = inject(PhotoRepositoryService);
  private readonly transport = inject(PhotoTransportService);
  private readonly prepareImage = inject(PHOTO_PREPARER);
  private readonly scheduler = inject(SyncSchedulerService);
  private readonly sync = inject(SyncStatusService);
  private readonly document = inject(DOCUMENT);
  private readonly destroy = inject(DestroyRef);
  readonly revision = signal(0);
  readonly error = signal('');
  readonly pendingCount = signal(0);
  readonly syncing = signal(false);
  private started = false;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private processing?: Promise<void>;
  private refreshing?: Promise<void>;
  private mutations: Promise<unknown> = Promise.resolve();
  private readonly watched = new Map<string, PhotoTarget>();
  private readonly targetRefreshes = new Map<string, Promise<void>>();
  private readonly lastTargetRefresh = new Map<string, number>();
  private readonly lastCatalogRefresh = new Map<string, number>();
  private lastGlobalRefresh = 0;

  constructor() {
    effect(() => {
      this.sync.lastSyncedAt();
      this.sync.activityRevision();
      if (this.started)
        queueMicrotask(() => {
          void this.flush();
          void this.refresh();
        });
    });
    this.destroy.onDestroy(() => {
      this.disposed = true;
      if (this.timer) clearTimeout(this.timer);
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const wake = () => {
      if (this.ready()) {
        void this.flush();
        void this.refresh();
      }
    };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    this.document.addEventListener('visibilitychange', wake);
    this.destroy.onDestroy(() => {
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      this.document.removeEventListener('visibilitychange', wake);
    });
    wake();
  }

  async get(target: PhotoTarget): Promise<StoredPhoto | null> {
    const key = photoKey(target);
    if (this.watched.size < 100 || this.watched.has(key)) this.watched.set(key, target);
    return this.repository.get(target);
  }

  async hidden(target: PhotoTarget): Promise<boolean> {
    return !!(await this.repository.preference(target))?.hidden;
  }

  async prepare(file: File): Promise<PreparedPhoto> {
    const prepared = await this.prepareImage(file);
    if (!validImageBase64(prepared.imageBase64) || prepared.contentType !== 'image/jpeg')
      throw new Error('A foto não pôde ser preparada com segurança.');
    return prepared;
  }

  async save(prepared: PreparedPhoto, target: PhotoTarget): Promise<void> {
    photoKey(target);
    if (!validImageBase64(prepared.imageBase64) || prepared.contentType !== 'image/jpeg')
      throw new Error('A foto não pôde ser preparada com segurança.');
    const name = target.name?.trim() || 'Produto';
    if (name.length > 120) throw new Error('Informe um nome de até 120 caracteres.');
    await this.serial(async () => {
      const photo: PhotoView = {
        id: crypto.randomUUID(),
        barcode: target.barcode,
        itemId: target.itemId,
        name,
        source: 'USER',
        status: 'PENDING',
        version: 0,
        contentHash: null,
        sourceUrl: null,
        licenseUrl: null,
        updatedAt: new Date().toISOString(),
        own: true,
      };
      await this.repository.save(photo, prepared, target);
      await this.changed();
    });
    void this.flush();
  }

  async remove(target: PhotoTarget): Promise<void> {
    await this.serial(async () => {
      await this.repository.remove(target);
      await this.changed();
    });
    void this.flush();
  }

  async restoreCatalog(target: PhotoTarget): Promise<void> {
    await this.serial(async () => {
      await this.repository.restore(target);
      await this.changed();
    });
    this.lastCatalogRefresh.delete(photoKey(target));
    this.lastTargetRefresh.delete(photoKey(target));
    void this.flush();
  }

  async cacheCatalog(target: PhotoTarget): Promise<void> {
    const key = photoKey(target);
    if (!this.ready()) return;
    if (Date.now() - (this.lastCatalogRefresh.get(key) ?? 0) < 60000) return;
    const pref = await this.repository.preference(target);
    const existing = await this.repository.get(target);
    if (
      pref?.hidden ||
      (await this.repository.pending(target)) ||
      (existing?.own && existing.source === 'USER')
    )
      return;
    if (!target.barcode) return;
    this.lastCatalogRefresh.set(key, Date.now());
    try {
      const approved = validatePhoto(
        await this.transport.request(
          'GET',
          '/products/photos/approved/' + target.barcode,
          undefined,
          () => this.ready(),
        ),
      );
      if (approved.barcode !== target.barcode || approved.status !== 'APPROVED') return;
      if (existing?.id === approved.id && existing.contentHash === approved.contentHash) return;
      const image = await this.transport.image(approved.id, () => this.ready());
      await this.serial(async () => {
        await this.repository.selectCatalog(approved, image, target);
        await this.changed();
      });
      void this.flush();
      return;
    } catch (error) {
      if (!(error instanceof PhotoTransportError) || error.status !== 404) return;
    }
    if (existing) return;
    const current = await this.repository.preference(target);
    if (current?.hidden || (await this.repository.pending(target)) || current?.photo_id) return;
    try {
      const photo = validatePhoto(
        await this.transport.request(
          'POST',
          '/products/photos/' + crypto.randomUUID() + '/external',
          {
            barcode: target.barcode,
            itemId: target.itemId,
            name: target.name?.trim() || 'Produto',
          },
          () => this.ready(),
        ),
      );
      if (photo.barcode !== target.barcode || photo.source !== 'OPEN_FOOD_FACTS' || !photo.own)
        return;
      await this.serial(async () => {
        await this.repository.selectCatalog(photo, null, target);
        await this.changed();
      });
      const image = await this.transport.image(photo.id, () => this.ready());
      await this.repository.cache(photo, image);
      await this.changed();
      void this.flush();
    } catch {
      /* Missing source or network leaves manual capture available without blocking the media queue. */
    }
  }

  refresh(target?: PhotoTarget, force = false): Promise<void> {
    if (target) {
      const key = photoKey(target);
      if (this.targetRefreshes.has(key)) return this.targetRefreshes.get(key)!;
      if (!force && Date.now() - (this.lastTargetRefresh.get(key) ?? 0) < 60000)
        return Promise.resolve();
      this.lastTargetRefresh.set(key, Date.now());
      if (force) this.lastCatalogRefresh.delete(key);
      const work = this.refreshTarget(target).finally(() => this.targetRefreshes.delete(key));
      this.targetRefreshes.set(key, work);
      return work;
    }
    if (this.refreshing) return this.refreshing;
    if (!force && Date.now() - this.lastGlobalRefresh < 60000) return Promise.resolve();
    this.lastGlobalRefresh = Date.now();
    if (force) {
      this.lastTargetRefresh.clear();
      this.lastCatalogRefresh.clear();
    }
    this.refreshing = this.refreshAll().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  flush(): Promise<void> {
    if (this.processing) return this.processing;
    this.processing = this.process()
      .catch(() => {
        this.error.set(
          'Não foi possível enviar as fotos agora. As cópias locais foram preservadas.',
        );
      })
      .finally(() => {
        this.processing = undefined;
        this.syncing.set(false);
      });
    return this.processing;
  }

  private ready(): boolean {
    return (
      !this.disposed &&
      this.transport.enabled &&
      navigator.onLine &&
      this.document.visibilityState !== 'hidden' &&
      this.scheduler.foreground()
    );
  }

  private async process(): Promise<void> {
    this.pendingCount.set(await this.repository.count());
    if (!this.ready()) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.syncing.set(true);
    for (let count = 0; count < 20 && this.ready(); count++) {
      const job = await this.repository.next();
      if (!job) {
        this.error.set('');
        break;
      }
      if (job.status === 'FAILED') {
        this.error.set(
          'Uma foto precisa de revisão. Suas compras continuam preservadas e podem sincronizar.',
        );
        break;
      }
      const delay = job.next_attempt_at_ms - Date.now();
      if (delay > 0) {
        this.schedule(delay);
        break;
      }
      try {
        await this.processJob(job);
        this.pendingCount.set(await this.repository.count());
      } catch (error) {
        if (!this.ready()) break;
        const transient = error instanceof PhotoTransportError && error.transient;
        await this.repository.failed(job, transient);
        this.error.set(
          transient
            ? 'A foto está salva no aparelho e será enviada quando a conexão estiver disponível.'
            : 'Não foi possível aceitar uma foto. A cópia local foi preservada para revisão.',
        );
        if (transient) this.schedule([2000, 5000, 15000, 60000][Math.min(job.attempts, 3)]);
        break;
      }
    }
    // Long queues continue in a bounded future turn, never an unbounded synchronous loop.
    if (
      this.pendingCount() > 0 &&
      !this.timer &&
      (await this.repository.next())?.status === 'PENDING'
    )
      this.schedule(2000);
  }

  private async processJob(job: PhotoJob): Promise<void> {
    const payload = JSON.parse(job.payload_json);
    const target: PhotoTarget = payload.target ?? {
      barcode: payload.barcode,
      itemId: payload.itemId,
    };
    if (job.kind !== 'DELETE' && !(await this.repository.targetExists(target))) {
      await this.serial(() => this.repository.discardMissingTarget(target));
      await this.changed();
      return;
    }
    if (job.kind === 'UPLOAD' || job.kind === 'IMPORT') {
      const local = await this.repository.photo(payload.id);
      const input =
        job.kind === 'UPLOAD'
          ? {
              name: local?.name || target.name || 'Produto',
              barcode: target.barcode,
              itemId: target.itemId,
              contentType: 'image/jpeg',
              imageBase64: local?.imageUrl.split(',')[1],
            }
          : {
              name: target.name?.trim() || 'Produto',
              barcode: target.barcode,
              itemId: target.itemId,
            };
      if (job.kind === 'UPLOAD' && !validImageBase64(input['imageBase64' as keyof typeof input]))
        throw new PhotoTransportError(422);
      if (!job.request_json) await this.repository.request(job, input);
      if (!(await this.repository.active(job))) return;
      const body = JSON.parse(job.request_json ?? JSON.stringify(input));
      const photo = validatePhoto(
        await this.transport.request(
          job.kind === 'UPLOAD' ? 'PUT' : 'POST',
          '/products/photos/' + payload.id + (job.kind === 'IMPORT' ? '/external' : ''),
          body,
          () => this.ready(),
        ),
      );
      if (photo.id !== payload.id || !photo.own) throw new PhotoTransportError(422);
      const image =
        photo.status === 'DELETED'
          ? null
          : await this.transport.image(photo.id, () => this.ready());
      await this.repository.cache(photo, image);
      await this.repository.applied(job);
    } else if (job.kind === 'DELETE') {
      if (!(await this.repository.active(job))) return;
      let photo: PhotoView;
      try {
        photo = validatePhoto(
          await this.transport.request('DELETE', '/products/photos/' + payload.id, undefined, () =>
            this.ready(),
          ),
        );
      } catch (error) {
        if (!(error instanceof PhotoTransportError) || error.status !== 404) throw error;
        const local = await this.repository.metadata(payload.id);
        if (!local?.own) throw error;
        photo = { ...local, status: 'DELETED' };
      }
      if (photo.id !== payload.id || photo.status !== 'DELETED' || !photo.own)
        throw new PhotoTransportError(422);
      await this.repository.cache(photo, null);
      await this.repository.applied(job);
    } else {
      const pref = await this.repository.preference(target);
      const selected = payload.photoId ? await this.repository.metadata(payload.photoId) : null;
      const explicit =
        payload.hidden === true ||
        payload.photoId === null ||
        (selected?.own && selected.source === 'USER');
      const body = job.request_json
        ? JSON.parse(job.request_json)
        : {
            ...payload,
            version: explicit
              ? await this.currentPreferenceVersion(job)
              : (pref?.remote_version ?? null),
          };
      if (!job.request_json) await this.repository.request(job, body);
      if (!(await this.repository.active(job))) return;
      let result;
      try {
        result = validatePreference(
          await this.transport.request(
            'PUT',
            '/products/photos/preferences/' + job.target_key.replace(':', '-'),
            body,
            () => this.ready(),
          ),
        );
      } catch (error) {
        if (
          error instanceof PhotoTransportError &&
          error.status === 404 &&
          selected &&
          !selected.own
        ) {
          try {
            await this.transport.request('GET', '/products/photos/' + selected.id, undefined, () =>
              this.ready(),
            );
          } catch (verification) {
            if (
              verification instanceof PhotoTransportError &&
              [403, 404].includes(verification.status)
            ) {
              await this.repository.invalidatePublic(selected.id, job);
              await this.changed();
              return;
            }
          }
        }
        throw error;
      }
      if (
        result.key !== job.target_key ||
        result.photoId !== body.photoId ||
        result.hidden !== body.hidden
      )
        throw new PhotoTransportError(422);
      await this.repository.applied(job, result);
      if (!body.hidden && body.photoId === null) {
        // Restore is durable: only look up the catalogue after its explicit
        // preference is acknowledged, including an offline decision sent later.
        this.lastCatalogRefresh.delete(job.target_key);
        await this.cacheCatalog(this.watched.get(job.target_key) ?? target);
      }
    }
    await this.changed();
  }

  /** A new explicit decision may follow a lost acknowledgement. Learn only the
   * server version, without replacing the user's local photo/hidden choice. */
  private async currentPreferenceVersion(job: PhotoJob): Promise<number | null> {
    let version: number | null;
    try {
      const pref = validatePreference(
        await this.transport.request(
          'GET',
          '/products/photos/preferences/' + job.target_key.replace(':', '-'),
          undefined,
          () => this.ready(),
        ),
      );
      if (pref.key !== job.target_key) throw new PhotoTransportError(422);
      version = pref.version;
    } catch (error) {
      if (!(error instanceof PhotoTransportError) || error.status !== 404) throw error;
      version = null;
    }
    await this.repository.rememberRemoteVersion(job, version);
    return version;
  }

  private async refreshAll(): Promise<void> {
    if (!this.ready()) return;
    try {
      const seen = new Set<string>();
      // Match the API's maximum offset, stop on a short page, and reject repeats
      // so an invalid or changing server response cannot create an endless loop.
      pages: for (let offset = 0; offset <= 1000000 && this.ready(); offset += 100) {
        const raw = await this.transport.request(
          'GET',
          '/products/photos/preferences',
          undefined,
          () => this.ready(),
          { limit: 100, offset },
        );
        if (!Array.isArray(raw) || raw.length > 100) throw new Error('Invalid preferences');
        for (const item of raw) {
          if (!this.ready()) break pages;
          const p = validatePreference(item);
          if (seen.has(p.key)) break pages;
          seen.add(p.key);
          if (await this.repository.pending(p)) continue;
          const available = !p.photoId || (await this.hydrate(p.photoId));
          // A server preference can outlive public approval. Keep its version
          // without restoring the revoked image or blocking later preferences.
          await this.repository.importPreference(available ? p : { ...p, photoId: null });
        }
        if (raw.length < 100) break;
      }
      await this.changed();
      for (const target of [...this.watched.values()].slice(0, 100))
        await this.refreshTarget(target);
    } catch {
      /* Manual/offline purchases remain available. */
    }
  }

  private async refreshTarget(target: PhotoTarget): Promise<void> {
    if (!this.ready()) return;
    try {
      const pref = await this.repository.preference(target);
      if (pref?.hidden || (await this.repository.pending(target))) return;
      if (pref?.photo_id) await this.hydrate(pref.photo_id);
      await this.cacheCatalog(target);
      await this.changed();
    } catch {
      /* A missing or unavailable image uses the local copy/placeholder. */
    }
  }

  private async hydrate(id: string): Promise<boolean> {
    const local = await this.repository.photo(id);
    const metadata = await this.repository.metadata(id);
    let photo: PhotoView;
    try {
      photo = validatePhoto(
        await this.transport.request('GET', '/products/photos/' + id, undefined, () =>
          this.ready(),
        ),
      );
    } catch (error) {
      if (
        !metadata?.own &&
        error instanceof PhotoTransportError &&
        [403, 404].includes(error.status)
      ) {
        await this.repository.invalidatePublic(id);
        await this.changed();
        return false;
      }
      throw error;
    }
    if (photo.id !== id) throw new PhotoTransportError(422);
    await this.repository.cache(
      photo,
      photo.status === 'DELETED'
        ? null
        : local?.contentHash === photo.contentHash
          ? null
          : await this.transport.image(id, () => this.ready()),
    );
    return photo.status !== 'DELETED';
  }
  private async changed(): Promise<void> {
    this.pendingCount.set(await this.repository.count());
    this.revision.update((n) => n + 1);
  }
  private schedule(delay: number): void {
    if (this.disposed || this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.flush();
      },
      Math.max(250, Math.min(delay, 60000)),
    );
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(work);
    this.mutations = next.catch(() => undefined);
    return next;
  }
}
