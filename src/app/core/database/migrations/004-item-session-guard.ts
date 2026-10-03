export const itemSessionGuardSchema = [
  `CREATE TRIGGER items_update_target_active BEFORE UPDATE OF session_id ON shopping_items
    WHEN NOT EXISTS (SELECT 1 FROM shopping_sessions WHERE id = NEW.session_id AND status = 'ACTIVE')
    BEGIN SELECT RAISE(ABORT, 'Shopping session is not active'); END`,
  `INSERT INTO schema_migrations(version) VALUES (4)`,
];
