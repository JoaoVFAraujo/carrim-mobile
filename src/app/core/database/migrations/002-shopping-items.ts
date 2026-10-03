export const shoppingItemsSchema = [
  `CREATE TABLE shopping_items (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES shopping_sessions(id),
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents > 0 AND unit_price_cents <= 100000000),
    quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)`,
  `CREATE INDEX shopping_items_session ON shopping_items(session_id, created_at_ms)`,
  `INSERT INTO schema_migrations(version) VALUES (2)`,
];
