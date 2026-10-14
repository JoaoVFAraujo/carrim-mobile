export const syncRequestSchema = [
  `ALTER TABLE sync_queue ADD COLUMN request_json TEXT`,
  `INSERT INTO schema_migrations(version) VALUES (10)`,
];
