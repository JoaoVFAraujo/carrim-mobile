export const bundleItemsSchema = [
  `ALTER TABLE shopping_items ADD COLUMN pricing_type TEXT NOT NULL DEFAULT 'REGULAR' CHECK(pricing_type IN ('REGULAR', 'BUNDLE'))`,
  `ALTER TABLE shopping_items ADD COLUMN bundle_quantity INTEGER CHECK(bundle_quantity IS NULL OR (typeof(bundle_quantity) = 'integer' AND bundle_quantity BETWEEN 2 AND 9999))`,
  `ALTER TABLE price_history ADD COLUMN pricing_type TEXT NOT NULL DEFAULT 'REGULAR' CHECK(pricing_type IN ('REGULAR', 'BUNDLE'))`,
  `ALTER TABLE price_history ADD COLUMN bundle_quantity INTEGER CHECK(bundle_quantity IS NULL OR (typeof(bundle_quantity) = 'integer' AND bundle_quantity BETWEEN 2 AND 9999))`,
  `CREATE TRIGGER items_pricing_insert BEFORE INSERT ON shopping_items
    WHEN NOT ((NEW.pricing_type = 'REGULAR' AND NEW.bundle_quantity IS NULL)
      OR (NEW.pricing_type = 'BUNDLE' AND NEW.measurement_type = 'UNIT'
        AND NEW.bundle_quantity IS NOT NULL AND typeof(NEW.quantity) = 'integer'
        AND NEW.quantity % NEW.bundle_quantity = 0))
    BEGIN SELECT RAISE(ABORT, 'Invalid item pricing'); END`,
  `CREATE TRIGGER items_pricing_update BEFORE UPDATE ON shopping_items
    WHEN NOT ((NEW.pricing_type = 'REGULAR' AND NEW.bundle_quantity IS NULL)
      OR (NEW.pricing_type = 'BUNDLE' AND NEW.measurement_type = 'UNIT'
        AND NEW.bundle_quantity IS NOT NULL AND typeof(NEW.quantity) = 'integer'
        AND NEW.quantity % NEW.bundle_quantity = 0))
    BEGIN SELECT RAISE(ABORT, 'Invalid item pricing'); END`,
  `INSERT INTO schema_migrations(version) VALUES (7)`,
];
