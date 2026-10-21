// Normalized JPEG is base64 text because the shared native/web driver binds text,
// numbers and null consistently. Decoded bytes are bounded at 500 KiB per image.
export const productPhotosSchema = [
  `CREATE TABLE product_photos (
    id TEXT PRIMARY KEY NOT NULL,
    image_base64 TEXT CHECK(image_base64 IS NULL OR length(image_base64) <= 682668),
    metadata_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE photo_preferences (
    target_key TEXT PRIMARY KEY NOT NULL,
    barcode TEXT,
    item_id TEXT,
    photo_id TEXT REFERENCES product_photos(id),
    hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
    remote_version INTEGER,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE photo_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('UPLOAD','IMPORT','PREFERENCE','DELETE')),
    target_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    request_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','FAILED','SUPERSEDED'))
  )`,
  `CREATE INDEX photo_outbox_status_sequence ON photo_outbox(status,sequence)`,
  `CREATE TRIGGER photo_file_insert_quota BEFORE INSERT ON product_photos
    WHEN NEW.image_base64 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_photos WHERE id=NEW.id)
    AND (SELECT COUNT(*) FROM product_photos WHERE image_base64 IS NOT NULL)>=100
    BEGIN SELECT RAISE(ABORT,'Photo storage quota'); END`,
  `CREATE TRIGGER photo_file_update_quota BEFORE UPDATE OF image_base64 ON product_photos
    WHEN OLD.image_base64 IS NULL AND NEW.image_base64 IS NOT NULL
    AND (SELECT COUNT(*) FROM product_photos WHERE image_base64 IS NOT NULL)>=100
    BEGIN SELECT RAISE(ABORT,'Photo storage quota'); END`,
  `CREATE TRIGGER photo_queue_quota BEFORE INSERT ON photo_outbox
    WHEN (SELECT COUNT(*) FROM photo_outbox WHERE status!='SUPERSEDED')>=200
    BEGIN SELECT RAISE(ABORT,'Photo queue quota'); END`,
  `INSERT INTO schema_migrations(version) VALUES (11)`,
];
