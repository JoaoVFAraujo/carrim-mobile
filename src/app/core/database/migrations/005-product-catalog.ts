export const productCatalogSchema = [
  `CREATE TABLE products (
    id TEXT PRIMARY KEY NOT NULL,
    barcode TEXT NOT NULL UNIQUE CHECK(length(barcode) IN (8, 12, 13) AND barcode NOT GLOB '*[^0-9]*'),
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)`,
  `ALTER TABLE shopping_items ADD COLUMN barcode TEXT REFERENCES products(barcode)`,
  `ALTER TABLE price_history ADD COLUMN barcode TEXT REFERENCES products(barcode)`,
  `CREATE INDEX price_history_product_market_date ON price_history(barcode, supermarket_id, recorded_at_ms)`,
  `INSERT INTO schema_migrations(version) VALUES (5)`,
];
