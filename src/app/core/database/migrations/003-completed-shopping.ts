export const completedShoppingSchema = [
  `CREATE TABLE price_history (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES shopping_sessions(id),
    item_id TEXT NOT NULL UNIQUE REFERENCES shopping_items(id),
    supermarket_id TEXT NOT NULL REFERENCES supermarkets(id),
    product_name TEXT NOT NULL, unit_price_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL, recorded_at_ms INTEGER NOT NULL)`,
  `CREATE INDEX price_history_market_date ON price_history(supermarket_id, recorded_at_ms)`,
  `CREATE TRIGGER items_insert_active BEFORE INSERT ON shopping_items
    WHEN NOT EXISTS (SELECT 1 FROM shopping_sessions WHERE id = NEW.session_id AND status = 'ACTIVE')
    BEGIN SELECT RAISE(ABORT, 'Shopping session is not active'); END`,
  `CREATE TRIGGER items_update_active BEFORE UPDATE ON shopping_items
    WHEN NOT EXISTS (SELECT 1 FROM shopping_sessions WHERE id = OLD.session_id AND status = 'ACTIVE')
    BEGIN SELECT RAISE(ABORT, 'Shopping session is not active'); END`,
  `CREATE TRIGGER items_delete_active BEFORE DELETE ON shopping_items
    WHEN NOT EXISTS (SELECT 1 FROM shopping_sessions WHERE id = OLD.session_id AND status = 'ACTIVE')
    BEGIN SELECT RAISE(ABORT, 'Shopping session is not active'); END`,
  `INSERT INTO schema_migrations(version) VALUES (3)`,
];
