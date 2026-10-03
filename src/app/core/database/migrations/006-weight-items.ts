export const weightItemsSchema = [
  `ALTER TABLE shopping_items ADD COLUMN measurement_type TEXT NOT NULL DEFAULT 'UNIT' CHECK(measurement_type IN ('UNIT', 'WEIGHT'))`,
  `ALTER TABLE shopping_items ADD COLUMN weight_grams INTEGER CHECK(weight_grams IS NULL OR (typeof(weight_grams) = 'integer' AND weight_grams BETWEEN 1 AND 9999999))`,
  `ALTER TABLE price_history ADD COLUMN measurement_type TEXT NOT NULL DEFAULT 'UNIT' CHECK(measurement_type IN ('UNIT', 'WEIGHT'))`,
  `ALTER TABLE price_history ADD COLUMN weight_grams INTEGER CHECK(weight_grams IS NULL OR (typeof(weight_grams) = 'integer' AND weight_grams BETWEEN 1 AND 9999999))`,
  `CREATE TRIGGER items_measurement_insert BEFORE INSERT ON shopping_items
    WHEN NOT ((NEW.measurement_type = 'UNIT' AND NEW.weight_grams IS NULL)
      OR (NEW.measurement_type = 'WEIGHT' AND NEW.weight_grams IS NOT NULL AND NEW.quantity = 1))
    BEGIN SELECT RAISE(ABORT, 'Invalid item measurement'); END`,
  `CREATE TRIGGER items_measurement_update BEFORE UPDATE ON shopping_items
    WHEN NOT ((NEW.measurement_type = 'UNIT' AND NEW.weight_grams IS NULL)
      OR (NEW.measurement_type = 'WEIGHT' AND NEW.weight_grams IS NOT NULL AND NEW.quantity = 1))
    BEGIN SELECT RAISE(ABORT, 'Invalid item measurement'); END`,
  `INSERT INTO schema_migrations(version) VALUES (6)`,
];
