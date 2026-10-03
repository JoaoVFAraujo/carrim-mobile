export const initialSchema = [
  `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)`,
  `CREATE TABLE supermarkets (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)`,
  `CREATE TABLE shopping_sessions (
    id TEXT PRIMARY KEY NOT NULL, supermarket_id TEXT NOT NULL REFERENCES supermarkets(id),
    budget_cents INTEGER CHECK(budget_cents IS NULL OR budget_cents > 0),
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','COMPLETED','CANCELED')),
    started_at_ms INTEGER NOT NULL, finished_at_ms INTEGER,
    CHECK((status = 'ACTIVE' AND finished_at_ms IS NULL) OR
      (status != 'ACTIVE' AND finished_at_ms IS NOT NULL)))`,
  `CREATE UNIQUE INDEX one_active_session ON shopping_sessions(status) WHERE status = 'ACTIVE'`,
  `CREATE INDEX shopping_market_date ON shopping_sessions(supermarket_id, started_at_ms)`,
  `CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY NOT NULL, sequence_number INTEGER NOT NULL UNIQUE,
    aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, operation TEXT NOT NULL,
    payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING'
      CHECK(status IN ('PENDING','SYNCING','SYNCED','FAILED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)`,
  `CREATE TABLE app_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
  `INSERT INTO schema_migrations(version) VALUES (1)`,
];
