export const syncRetrySchema = [
  `ALTER TABLE sync_queue ADD COLUMN next_attempt_at_ms INTEGER`,
  `ALTER TABLE sync_queue ADD COLUMN processing_started_at_ms INTEGER`,
  `ALTER TABLE sync_queue ADD COLUMN lease_token TEXT`,
  `ALTER TABLE sync_queue ADD COLUMN last_error TEXT`,
  `CREATE INDEX sync_retry ON sync_queue(status, next_attempt_at_ms)`,
  `INSERT INTO schema_migrations(version) VALUES (9)`,
];
