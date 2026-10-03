export const checkoutTotalSchema = [
  `ALTER TABLE shopping_sessions ADD COLUMN checkout_total_cents INTEGER
    CHECK (checkout_total_cents IS NULL OR
      (typeof(checkout_total_cents) = 'integer' AND checkout_total_cents BETWEEN 0 AND 100000000))`,
  `INSERT INTO schema_migrations(version) VALUES (8)`,
];
