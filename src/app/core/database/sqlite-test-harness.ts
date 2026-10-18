import initSqlJs from 'sql.js';
import { DatabaseService } from './database.service';
import { initialSchema } from './migrations/001-initial-schema';
import { shoppingItemsSchema } from './migrations/002-shopping-items';
import { completedShoppingSchema } from './migrations/003-completed-shopping';
import { itemSessionGuardSchema } from './migrations/004-item-session-guard';
import { productCatalogSchema } from './migrations/005-product-catalog';
import { weightItemsSchema } from './migrations/006-weight-items';
import { bundleItemsSchema } from './migrations/007-bundle-items';
import { checkoutTotalSchema } from './migrations/008-checkout-total';
import { syncRetrySchema } from './migrations/009-sync-retry';
import { syncRequestSchema } from './migrations/010-sync-request';

/** Isolated real SQLite, never the app database or a native connection. Tests only. */
export async function sqliteHarness() {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys=ON');
  for (const schema of [
    initialSchema,
    shoppingItemsSchema,
    completedShoppingSchema,
    itemSessionGuardSchema,
    productCatalogSchema,
    weightItemsSchema,
    bundleItemsSchema,
    checkoutTotalSchema,
    syncRetrySchema,
    syncRequestSchema,
  ])
    schema.forEach((statement) => sql.run(statement));
  const database = new DatabaseService();
  const query = (statement: string, values: unknown[] = []) => {
    const st = sql.prepare(statement);
    st.bind(values);
    const rows: Record<string, unknown>[] = [];
    try {
      while (st.step()) rows.push(st.getAsObject());
      return { values: rows };
    } finally {
      st.free();
    }
  };
  Object.assign(database, {
    opening: Promise.resolve(),
    connection: { saveToStore: async () => undefined },
    database: {
      query,
      executeSet: async (statements: { statement: string; values?: unknown[] }[]) => {
        sql.run('BEGIN');
        try {
          statements.forEach((st) => sql.run(st.statement, st.values));
          sql.run('COMMIT');
        } catch (error) {
          sql.run('ROLLBACK');
          throw error;
        }
      },
    },
  });
  return { database, sql, query };
}
