import { inject, Injectable } from '@angular/core';
import type { capSQLiteSet } from '@capacitor-community/sqlite';
import { DatabaseService } from '../database/database.service';
import {
  type PhotoJob,
  type PhotoPreference,
  type PhotoTarget,
  type PhotoView,
  type PreparedPhoto,
  type StoredPhoto,
  photoKey,
  validImageBase64,
  validatePhoto,
} from './photo-models';

interface PreferenceRow {
  target_key: string;
  barcode: string | null;
  item_id: string | null;
  photo_id: string | null;
  hidden: number;
  remote_version: number | null;
}
interface PhotoRow {
  id: string;
  image_base64: string | null;
  metadata_json: string;
}

@Injectable({ providedIn: 'root' })
export class PhotoRepositoryService {
  private readonly db = inject(DatabaseService);

  async preference(target: PhotoTarget): Promise<PreferenceRow | null> {
    return (
      (
        await this.db.query<PreferenceRow>('SELECT * FROM photo_preferences WHERE target_key=?', [
          photoKey(target),
        ])
      )[0] ?? null
    );
  }

  async photo(id: string): Promise<StoredPhoto | null> {
    const row = (await this.db.query<PhotoRow>('SELECT * FROM product_photos WHERE id=?', [id]))[0];
    if (!row?.image_base64 || !validImageBase64(row.image_base64)) return null;
    const metadata = validatePhoto(JSON.parse(row.metadata_json));
    return metadata.status === 'DELETED'
      ? null
      : { ...metadata, imageUrl: 'data:image/jpeg;base64,' + row.image_base64 };
  }

  async metadata(id: string): Promise<PhotoView | null> {
    const row = (await this.db.query<PhotoRow>('SELECT * FROM product_photos WHERE id=?', [id]))[0];
    return row ? validatePhoto(JSON.parse(row.metadata_json)) : null;
  }

  async targetExists(target: PhotoTarget): Promise<boolean> {
    if (target.barcode !== null) return true;
    return (
      (await this.db.query('SELECT id FROM shopping_items WHERE id=?', [target.itemId])).length > 0
    );
  }

  async discardMissingTarget(target: PhotoTarget): Promise<void> {
    const pref = await this.preference(target);
    const prior = pref?.photo_id ? await this.metadata(pref.photo_id) : null;
    const key = photoKey(target);
    await this.db.transaction([
      ...this.supersede(key),
      this.preferenceWrite(target, null, true),
      ...(prior?.own && prior.status !== 'DELETED'
        ? [this.job('DELETE', key, { id: prior.id })]
        : []),
      this.cleanup(),
    ]);
  }

  async get(target: PhotoTarget): Promise<StoredPhoto | null> {
    const pref = await this.preference(target);
    return pref?.hidden || !pref?.photo_id ? null : this.photo(pref.photo_id);
  }

  async save(photo: PhotoView, prepared: PreparedPhoto, target: PhotoTarget): Promise<void> {
    const key = photoKey(target);
    await this.db.transaction([
      ...this.supersede(key),
      this.releaseTargetBytes(target),
      this.file(photo, prepared.imageBase64),
      this.preferenceWrite(target, photo.id, false),
      this.job('UPLOAD', key, { id: photo.id, target, contentType: prepared.contentType }),
      this.job('PREFERENCE', key, {
        barcode: target.barcode,
        itemId: target.itemId,
        photoId: photo.id,
        hidden: false,
      }),
      this.cleanup(),
    ]);
  }

  async remove(target: PhotoTarget): Promise<void> {
    const pref = await this.preference(target);
    const old = pref?.photo_id ? await this.photo(pref.photo_id) : null;
    const key = photoKey(target);
    await this.db.transaction([
      ...this.supersede(key),
      this.preferenceWrite(target, null, true),
      this.job('PREFERENCE', key, {
        barcode: target.barcode,
        itemId: target.itemId,
        photoId: null,
        hidden: true,
      }),
      ...(old?.own ? [this.job('DELETE', key, { id: old.id })] : []),
      this.cleanup(),
    ]);
  }

  async restore(target: PhotoTarget): Promise<void> {
    await this.db.transaction([
      ...this.supersede(photoKey(target)),
      this.preferenceWrite(target, null, false),
      this.job('PREFERENCE', photoKey(target), {
        barcode: target.barcode,
        itemId: target.itemId,
        photoId: null,
        hidden: false,
      }),
      this.cleanup(),
    ]);
  }

  async enqueueImport(photo: PhotoView, target: PhotoTarget): Promise<void> {
    await this.db.transaction([
      this.file(photo, null),
      this.preferenceWrite(target, photo.id, false),
      this.job('IMPORT', photoKey(target), { id: photo.id, target }),
      this.job('PREFERENCE', photoKey(target), {
        barcode: target.barcode,
        itemId: target.itemId,
        photoId: photo.id,
        hidden: false,
      }),
    ]);
  }

  async cache(photo: PhotoView, image: string | null): Promise<void> {
    await this.db.transaction([this.file(photo, image)]);
  }

  async selectCatalog(photo: PhotoView, image: string | null, target: PhotoTarget): Promise<void> {
    // The conditional preference write cannot replace a personal decision made during download.
    await this.db.transaction([
      this.cleanup(),
      this.releaseCatalogBytes(target, photo.id),
      this.file(photo, image),
      {
        statement: `INSERT INTO photo_preferences(target_key,barcode,item_id,photo_id,hidden,remote_version,updated_at_ms)
        VALUES (?,?,?,?,0,NULL,?) ON CONFLICT(target_key) DO UPDATE SET photo_id=excluded.photo_id,updated_at_ms=excluded.updated_at_ms
        WHERE photo_preferences.hidden=0 AND NOT EXISTS (SELECT 1 FROM photo_outbox WHERE target_key=excluded.target_key AND status!='SUPERSEDED')
        AND (photo_preferences.photo_id IS NULL OR photo_preferences.photo_id IN (SELECT id FROM product_photos WHERE json_extract(metadata_json,'$.own')=0 OR json_extract(metadata_json,'$.source')='OPEN_FOOD_FACTS'))`,
        values: [photoKey(target), target.barcode, target.itemId, photo.id, Date.now()],
      },
      {
        statement: `INSERT INTO photo_outbox(id,kind,target_key,payload_json)
        SELECT ?,'PREFERENCE',?,? WHERE EXISTS (SELECT 1 FROM photo_preferences WHERE target_key=? AND photo_id=? AND hidden=0)
        AND NOT EXISTS (SELECT 1 FROM photo_outbox WHERE target_key=? AND status!='SUPERSEDED')`,
        values: [
          crypto.randomUUID(),
          photoKey(target),
          JSON.stringify({
            barcode: target.barcode,
            itemId: target.itemId,
            photoId: photo.id,
            hidden: false,
          }),
          photoKey(target),
          photo.id,
          photoKey(target),
        ],
      },
      this.cleanup(),
    ]);
  }

  async importPreference(p: PhotoPreference): Promise<void> {
    await this.db.transaction([
      {
        statement: `INSERT INTO photo_preferences(target_key,barcode,item_id,photo_id,hidden,remote_version,updated_at_ms)
        SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM photo_outbox WHERE target_key=? AND status!='SUPERSEDED')
        ON CONFLICT(target_key) DO UPDATE SET photo_id=excluded.photo_id,hidden=excluded.hidden,remote_version=excluded.remote_version,updated_at_ms=excluded.updated_at_ms
        WHERE NOT EXISTS (SELECT 1 FROM photo_outbox WHERE target_key=excluded.target_key AND status!='SUPERSEDED')`,
        values: [
          p.key,
          p.barcode,
          p.itemId,
          p.photoId,
          Number(p.hidden),
          p.version,
          Date.now(),
          p.key,
        ],
      },
    ]);
  }

  async next(): Promise<PhotoJob | null> {
    return (
      (
        await this.db.query<PhotoJob>(
          `SELECT * FROM photo_outbox candidate WHERE status!='SUPERSEDED'
          AND NOT EXISTS (SELECT 1 FROM photo_outbox prior WHERE prior.target_key=candidate.target_key
            AND prior.sequence<candidate.sequence AND prior.status!='SUPERSEDED')
          ORDER BY CASE WHEN status='PENDING' AND next_attempt_at_ms<=? THEN 0
            WHEN status='PENDING' THEN 1 ELSE 2 END,sequence LIMIT 1`,
          [Date.now()],
        )
      )[0] ?? null
    );
  }
  async count(): Promise<number> {
    return (
      (
        await this.db.query<{ count: number }>(
          "SELECT COUNT(*) AS count FROM photo_outbox WHERE status!='SUPERSEDED'",
        )
      )[0]?.count ?? 0
    );
  }
  async pending(target: PhotoTarget): Promise<boolean> {
    return (
      (
        await this.db.query(
          "SELECT id FROM photo_outbox WHERE target_key=? AND status!='SUPERSEDED' LIMIT 1",
          [photoKey(target)],
        )
      ).length > 0
    );
  }

  async request(job: PhotoJob, request: object): Promise<void> {
    await this.db.transaction([
      {
        statement: 'UPDATE photo_outbox SET request_json=? WHERE id=? AND request_json IS NULL',
        values: [JSON.stringify(request), job.id],
      },
    ]);
  }

  async rememberRemoteVersion(job: PhotoJob, version: number | null): Promise<void> {
    await this.db.transaction([
      {
        statement: `UPDATE photo_preferences SET remote_version=? WHERE target_key=?
          AND EXISTS (SELECT 1 FROM photo_outbox WHERE id=? AND target_key=? AND status='PENDING')`,
        values: [version, job.target_key, job.id, job.target_key],
      },
    ]);
  }
  async applied(job: PhotoJob, preference?: PhotoPreference): Promise<void> {
    await this.db.transaction([
      ...(preference
        ? [
            {
              statement: 'UPDATE photo_preferences SET remote_version=? WHERE target_key=?',
              values: [preference.version, preference.key],
            },
          ]
        : []),
      {
        statement: "DELETE FROM photo_outbox WHERE id=? AND status!='SUPERSEDED'",
        values: [job.id],
      },
    ]);
  }
  async failed(job: PhotoJob, transient: boolean): Promise<void> {
    const attempts = job.attempts + 1;
    await this.db.transaction([
      {
        statement:
          "UPDATE photo_outbox SET attempts=?,next_attempt_at_ms=?,status=? WHERE id=? AND status='PENDING'",
        values: [
          attempts,
          Date.now() + [2000, 5000, 15000, 60000][Math.min(attempts - 1, 3)],
          transient ? 'PENDING' : 'FAILED',
          job.id,
        ],
      },
    ]);
  }

  async active(job: PhotoJob): Promise<boolean> {
    return (
      (await this.db.query("SELECT id FROM photo_outbox WHERE id=? AND status='PENDING'", [job.id]))
        .length > 0
    );
  }

  async invalidatePublic(id: string, job?: PhotoJob): Promise<void> {
    await this.db.transaction([
      ...(job
        ? [
            {
              statement:
                "UPDATE photo_outbox SET status='SUPERSEDED' WHERE id=? AND status='PENDING'",
              values: [job.id],
            },
          ]
        : []),
      {
        statement:
          "UPDATE product_photos SET image_base64=NULL WHERE id=? AND json_extract(metadata_json,'$.own')=0",
        values: [id],
      },
      {
        statement:
          "UPDATE photo_preferences SET photo_id=NULL WHERE photo_id=? AND NOT EXISTS (SELECT 1 FROM photo_outbox WHERE target_key=photo_preferences.target_key AND status!='SUPERSEDED') AND EXISTS (SELECT 1 FROM product_photos WHERE id=? AND json_extract(metadata_json,'$.own')=0)",
        values: [id, id],
      },
    ]);
  }

  private supersede(key: string): capSQLiteSet[] {
    return [
      {
        statement:
          "UPDATE photo_outbox SET status='SUPERSEDED' WHERE target_key=? AND status!='SUPERSEDED'",
        values: [key],
      },
      {
        statement:
          "DELETE FROM photo_outbox WHERE status='SUPERSEDED' AND sequence NOT IN (SELECT sequence FROM photo_outbox WHERE status='SUPERSEDED' ORDER BY sequence DESC LIMIT 32)",
        values: [],
      },
    ];
  }

  private cleanup(): capSQLiteSet {
    return {
      statement: `UPDATE product_photos SET image_base64=NULL WHERE image_base64 IS NOT NULL
      AND id NOT IN (SELECT photo_id FROM photo_preferences WHERE photo_id IS NOT NULL)
      AND id NOT IN (SELECT COALESCE(json_extract(payload_json,'$.id'),json_extract(payload_json,'$.photoId')) FROM photo_outbox WHERE status!='SUPERSEDED' AND COALESCE(json_extract(payload_json,'$.id'),json_extract(payload_json,'$.photoId')) IS NOT NULL)`,
      values: [],
    };
  }

  private releaseTargetBytes(target: PhotoTarget): capSQLiteSet {
    return {
      statement: `UPDATE product_photos SET image_base64=NULL WHERE id=(SELECT photo_id FROM photo_preferences WHERE target_key=?)
      AND (SELECT COUNT(*) FROM photo_preferences WHERE photo_id=product_photos.id)=1
      AND NOT EXISTS (SELECT 1 FROM photo_outbox WHERE status!='SUPERSEDED' AND COALESCE(json_extract(payload_json,'$.id'),json_extract(payload_json,'$.photoId'))=product_photos.id)`,
      values: [photoKey(target)],
    };
  }

  private releaseCatalogBytes(target: PhotoTarget, replacementId: string): capSQLiteSet {
    const release = this.releaseTargetBytes(target);
    return {
      statement: `${release.statement}
        AND id<>? AND (json_extract(metadata_json,'$.own')=0 OR json_extract(metadata_json,'$.source')='OPEN_FOOD_FACTS')
        AND EXISTS (SELECT 1 FROM photo_preferences WHERE target_key=? AND hidden=0)
        AND NOT EXISTS (SELECT 1 FROM photo_outbox WHERE target_key=? AND status!='SUPERSEDED')`,
      values: [...(release.values ?? []), replacementId, photoKey(target), photoKey(target)],
    };
  }

  private file(photo: PhotoView, image: string | null): capSQLiteSet {
    return {
      statement: `INSERT INTO product_photos(id,image_base64,metadata_json,updated_at_ms) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET image_base64=CASE WHEN json_extract(excluded.metadata_json,'$.status')='DELETED' THEN NULL ELSE COALESCE(excluded.image_base64,product_photos.image_base64) END,
      metadata_json=excluded.metadata_json,updated_at_ms=excluded.updated_at_ms`,
      values: [photo.id, image, JSON.stringify(photo), Date.now()],
    };
  }
  private preferenceWrite(
    target: PhotoTarget,
    photoId: string | null,
    hidden: boolean,
  ): capSQLiteSet {
    return {
      statement: `INSERT INTO photo_preferences(target_key,barcode,item_id,photo_id,hidden,remote_version,updated_at_ms) VALUES (?,?,?,?,?,NULL,?)
      ON CONFLICT(target_key) DO UPDATE SET photo_id=excluded.photo_id,hidden=excluded.hidden,updated_at_ms=excluded.updated_at_ms`,
      values: [
        photoKey(target),
        target.barcode,
        target.itemId,
        photoId,
        Number(hidden),
        Date.now(),
      ],
    };
  }
  private job(kind: PhotoJob['kind'], key: string, payload: object): capSQLiteSet {
    return {
      statement: 'INSERT INTO photo_outbox(id,kind,target_key,payload_json) VALUES (?,?,?,?)',
      values: [crypto.randomUUID(), kind, key, JSON.stringify(payload)],
    };
  }
}
