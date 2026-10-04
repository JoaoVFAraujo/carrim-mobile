import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { initialSchema } from '../src/app/core/database/migrations/001-initial-schema.ts';
import { shoppingItemsSchema } from '../src/app/core/database/migrations/002-shopping-items.ts';
import { completedShoppingSchema } from '../src/app/core/database/migrations/003-completed-shopping.ts';
import { itemSessionGuardSchema } from '../src/app/core/database/migrations/004-item-session-guard.ts';
import { productCatalogSchema } from '../src/app/core/database/migrations/005-product-catalog.ts';
import { weightItemsSchema } from '../src/app/core/database/migrations/006-weight-items.ts';
import { bundleItemsSchema } from '../src/app/core/database/migrations/007-bundle-items.ts';
import { checkoutTotalSchema } from '../src/app/core/database/migrations/008-checkout-total.ts';

// A fresh, in-memory database: this verification never touches the user's app data.
const SQL = await initSqlJs();
let db = new SQL.Database();
db.run('PRAGMA foreign_keys = ON');
const scalar = (sql) => db.exec(sql)[0].values[0][0];
const apply = (schema) => {
  db.run('BEGIN');
  try {
    schema.forEach((statement) => db.run(statement));
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
};

apply(initialSchema);
db.run("INSERT INTO supermarkets VALUES ('m', 'Market', 1, 1)");
db.run("INSERT INTO supermarkets VALUES ('other-market', 'Other market', 1, 1)");
db.run(
  "INSERT INTO shopping_sessions(id, supermarket_id, budget_cents, status, started_at_ms) VALUES ('old', 'm', 5000, 'ACTIVE', 1)",
);
apply(shoppingItemsSchema);
db.run("INSERT INTO shopping_items VALUES ('old-item', 'old', 'Manual coffee', 1749, 3, 1, 1)");
apply(completedShoppingSchema);
db.run(
  "INSERT INTO price_history VALUES ('old-price', 'old', 'old-item', 'm', 'Manual coffee', 1749, 3, 2)",
);
db.run("UPDATE shopping_sessions SET status = 'COMPLETED', finished_at_ms = 2 WHERE id = 'old'");
apply(itemSessionGuardSchema);
apply(productCatalogSchema);
assert.equal(scalar('SELECT MAX(version) FROM schema_migrations'), 5);
assert.equal(scalar('SELECT COUNT(*) FROM shopping_items'), 1);
assert.equal(scalar('SELECT COUNT(*) FROM price_history'), 1);
assert.equal(scalar("SELECT barcode FROM shopping_items WHERE id = 'old-item'"), null);
apply(weightItemsSchema);
assert.equal(scalar('SELECT MAX(version) FROM schema_migrations'), 6);
assert.equal(scalar("SELECT measurement_type FROM shopping_items WHERE id = 'old-item'"), 'UNIT');
apply(bundleItemsSchema);
assert.equal(scalar('SELECT MAX(version) FROM schema_migrations'), 7);
assert.equal(scalar("SELECT pricing_type FROM shopping_items WHERE id = 'old-item'"), 'REGULAR');
apply(checkoutTotalSchema);
assert.equal(scalar('SELECT MAX(version) FROM schema_migrations'), 8);
assert.equal(scalar("SELECT checkout_total_cents FROM shopping_sessions WHERE id = 'old'"), null);
for (const invalid of [-1, 0.5, 100000001]) {
  assert.throws(() =>
    db.run('UPDATE shopping_sessions SET checkout_total_cents = ? WHERE id = ?', [invalid, 'old']),
  );
}

// Execute the actual application SQL, so checks cover changes to its persistence statements.
const store = await readFile(
  new URL('../src/app/features/shopping/services/shopping-session.store.ts', import.meta.url),
  'utf8',
);
const templates = [...store.matchAll(/statement:\s*`([^`]+)`/g)].map((match) => match[1]);
const strings = [...store.matchAll(/statement:\s*'([^']+)'/g)].map((match) => match[1]);
const productSql = templates.find((sql) => sql.startsWith('INSERT INTO products'));
const itemSql = strings.find((sql) => sql.startsWith('INSERT INTO shopping_items'));
const insertRegularItem = (values) => db.run(itemSql, [...values, 'REGULAR', null]);
const pricesSql = templates.find((sql) => sql.startsWith('INSERT INTO price_history'));
const completeSql = templates.find((sql) => sql.startsWith('UPDATE shopping_sessions'));
const completeQueueSql = templates.find((sql) => sql.includes('WHERE changes() = 1'));
const queueSql = templates.find(
  (sql) => sql.startsWith('INSERT INTO sync_queue') && !sql.includes('changes()'),
);
assert.ok(productSql && itemSql && pricesSql && completeSql && completeQueueSql && queueSql);

db.run(
  "INSERT INTO shopping_sessions(id, supermarket_id, status, started_at_ms) VALUES ('s', 'm', 'ACTIVE', 3)",
);
const code = '0789600112233';
function addProduct(itemId, fail = false) {
  db.run('BEGIN');
  try {
    db.run(productSql, ['p', code, 'Coffee', 3, 3]);
    db.run(queueSql, [itemId + '-product-op', 'PRODUCT', 'p', 'CREATE', '{}', 3, 3]);
    insertRegularItem([
      itemId,
      fail ? 'missing-session' : 's',
      'Coffee',
      1749,
      2,
      3,
      3,
      code,
      'UNIT',
      null,
    ]);
    db.run(queueSql, [itemId + '-item-op', 'SHOPPING_ITEM', itemId, 'CREATE', '{}', 3, 3]);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}
assert.throws(() => addProduct('failed-item', true));
assert.equal(scalar('SELECT COUNT(*) FROM products'), 0);
assert.equal(scalar('SELECT COUNT(*) FROM sync_queue'), 0);
addProduct('i');
assert.equal(scalar('SELECT barcode FROM products'), code);
assert.equal(
  scalar("SELECT SUM(unit_price_cents * quantity) FROM shopping_items WHERE session_id = 's'"),
  3498,
);
assert.equal(scalar('SELECT COUNT(*) FROM sync_queue'), 2);
// A known barcode must retain its identity after an upsert.
db.run(productSql, ['unused-id', code, 'Coffee updated', 4, 4]);
assert.equal(scalar('SELECT COUNT(*) FROM products'), 1);
assert.equal(scalar('SELECT id FROM products'), 'p');

// Group only the same session/name/price/barcode configuration using application SQL.
const matchingSql = [...store.matchAll(/`([^`]+)`/g)]
  .map((match) => match[1])
  .find((sql) => sql.includes('WHERE session_id = ? AND name = ?'));
const updateItemSql = strings.find((sql) => sql.startsWith('UPDATE shopping_items'));
const updateRegularItem = (values) =>
  db.run(updateItemSql, [...values.slice(0, 6), 'REGULAR', null, ...values.slice(6)]);
assert.ok(matchingSql && updateItemSql);
const repeated = db.prepare(matchingSql, ['s', 'Coffee', 1749, code, 'UNIT', 'REGULAR', null]);
assert.ok(repeated.step());
assert.deepEqual(repeated.getAsObject(), { id: 'i', quantity: 2, weightGrams: null });
repeated.free();
for (const configuration of [
  ['s', 'Coffee', 1800, code, 'UNIT'],
  ['s', 'Coffee', 1749, null, 'UNIT'],
  ['s', 'Tea', 1749, code, 'UNIT'],
  ['old', 'Coffee', 1749, code, 'UNIT'],
  ['s', 'Coffee', 1749, code, 'WEIGHT'],
]) {
  const distinct = db.prepare(matchingSql, [...configuration, 'REGULAR', null]);
  assert.equal(distinct.step(), false);
  distinct.free();
}
db.run('BEGIN');
updateRegularItem(['Coffee', 1749, 5, 4, 'UNIT', null, 'i', 's']);
assert.throws(() => db.run(queueSql, ['i-item-op', 'SHOPPING_ITEM', 'i', 'UPDATE', '{}', 4, 4]));
db.run('ROLLBACK');
assert.equal(scalar("SELECT quantity FROM shopping_items WHERE id = 'i'"), 2);
db.run('BEGIN');
updateRegularItem(['Coffee', 1749, 5, 4, 'UNIT', null, 'i', 's']);
db.run(queueSql, ['repeat-item-op', 'SHOPPING_ITEM', 'i', 'UPDATE', '{"quantity":5}', 4, 4]);
db.run('COMMIT');
assert.equal(scalar("SELECT COUNT(*) FROM shopping_items WHERE session_id = 's'"), 1);
assert.equal(scalar("SELECT quantity * unit_price_cents FROM shopping_items WHERE id = 'i'"), 8745);
assert.throws(() => updateRegularItem(['Coffee', 1749, 10000, 4, 'UNIT', null, 'i', 's']));
insertRegularItem(['banana', 's', 'Banana', 699, 1, 4, 4, code, 'WEIGHT', 824]);
assert.throws(() =>
  insertRegularItem(['fractional-grams', 's', 'Bad', 699, 1, 4, 4, null, 'WEIGHT', 824.5]),
);
assert.throws(() =>
  insertRegularItem(['bad-weight', 's', 'Bad', 699, 2, 4, 4, null, 'WEIGHT', 824]),
);
assert.throws(() => insertRegularItem(['bad-unit', 's', 'Bad', 699, 1, 4, 4, null, 'UNIT', 824]));
assert.throws(() => updateRegularItem(['Banana', 699, 1, 4, 'WEIGHT', null, 'banana', 's']));

db.run(itemSql, ['milk-bundle', 's', 'Milk', 1000, 6, 4, 4, code, 'UNIT', null, 'BUNDLE', 3]);
db.run(itemSql, ['milk-unit', 's', 'Milk', 400, 1, 4, 4, null, 'UNIT', null, 'REGULAR', null]);
assert.throws(() =>
  db.run(itemSql, [
    'incomplete-bundle',
    's',
    'Milk',
    1000,
    4,
    4,
    4,
    null,
    'UNIT',
    null,
    'BUNDLE',
    3,
  ]),
);
assert.throws(() =>
  db.run(itemSql, ['bundle-weight', 's', 'Bad', 1000, 1, 4, 4, null, 'WEIGHT', 824, 'BUNDLE', 3]),
);
assert.throws(() =>
  db.run(itemSql, ['missing-group', 's', 'Bad', 1000, 6, 4, 4, null, 'UNIT', null, 'BUNDLE', null]),
);
const incompatibleOffer = db.prepare(matchingSql, ['s', 'Milk', 1000, code, 'UNIT', 'BUNDLE', 2]);
assert.equal(incompatibleOffer.step(), false);
incompatibleOffer.free();

function complete(id, operation, fail = false, checkout = null) {
  db.run('BEGIN');
  try {
    db.run(pricesSql, [5, id]);
    db.run(completeSql, [5, checkout, id]);
    if (fail) db.run('INSERT INTO missing_table VALUES (1)');
    db.run(completeQueueSql, [operation, 'SHOPPING_SESSION', id, 'COMPLETE', '{}', 5, 5]);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}
assert.throws(() => complete('s', 'failed-completion', true, 11900));
assert.equal(scalar("SELECT status FROM shopping_sessions WHERE id = 's'"), 'ACTIVE');
assert.equal(scalar('SELECT COUNT(*) FROM price_history'), 1);
assert.equal(scalar("SELECT checkout_total_cents FROM shopping_sessions WHERE id = 's'"), null);
complete('s', 'complete', false, 11900);
complete('s', 'repeat', false, 0);
assert.equal(scalar("SELECT checkout_total_cents FROM shopping_sessions WHERE id = 's'"), 11900);
assert.equal(scalar("SELECT COUNT(*) FROM sync_queue WHERE operation = 'COMPLETE'"), 1);
assert.equal(scalar('SELECT COUNT(*) FROM price_history'), 5);
assert.equal(scalar("SELECT weight_grams FROM price_history WHERE item_id = 'banana'"), 824);
db.run("UPDATE price_history SET recorded_at_ms = 6 WHERE item_id = 'banana'");
db.run("UPDATE price_history SET recorded_at_ms = 7 WHERE item_id = 'milk-bundle'");
assert.equal(scalar("SELECT bundle_quantity FROM price_history WHERE item_id = 'milk-bundle'"), 3);
const historySql = [...store.matchAll(/`([^`]+)`/g)]
  .map((match) => match[1])
  .find((sql) => sql.includes('AS totalCents'));
const shoppingHistory = db.prepare(historySql);
assert.ok(shoppingHistory.step());
assert.equal(shoppingHistory.getAsObject().totalCents, 11721);
assert.equal(shoppingHistory.getAsObject().checkoutTotalCents, 11900);
assert.equal(
  shoppingHistory.getAsObject().checkoutTotalCents - shoppingHistory.getAsObject().totalCents,
  179,
);
shoppingHistory.free();
assert.equal(scalar("SELECT barcode FROM price_history WHERE item_id = 'i'"), code);
assert.equal(scalar("SELECT product_name FROM price_history WHERE item_id = 'i'"), 'Coffee');
assert.throws(() => db.run("UPDATE shopping_items SET quantity = 4 WHERE id = 'i'"));
assert.throws(() => db.run("DELETE FROM shopping_items WHERE id = 'i'"));

const bytes = db.export();
db.close();
db = new SQL.Database(bytes);
db.run('PRAGMA foreign_keys = ON');
assert.equal(scalar("SELECT checkout_total_cents FROM shopping_sessions WHERE id = 's'"), 11900);
assert.equal(scalar('SELECT COUNT(*) FROM products'), 1);
assert.equal(scalar('SELECT COUNT(*) FROM price_history'), 5);
const catalog = await readFile(
  new URL('../src/app/features/scanner/services/product-catalog.service.ts', import.meta.url),
  'utf8',
);
const lastPriceSql = [...catalog.matchAll(/`([^`]+)`/g)]
  .map((match) => match[1])
  .find((sql) => sql.includes('FROM price_history'));
const searchSql = [...catalog.matchAll(/`([^`]+)`/g)]
  .map((match) => match[1])
  .find((sql) => sql.includes('WHERE instr'));
assert.ok(searchSql);
for (const term of ['COFFEE', '0789']) {
  const match = db.prepare(searchSql, [term, term]);
  assert.ok(match.step());
  assert.equal(match.getAsObject().barcode, code);
  match.free();
}
const literal = db.prepare(searchSql, ['%%', '%%']);
assert.equal(literal.step(), false);
literal.free();
const price = db.prepare(lastPriceSql, [code, 'm']);
assert.ok(price.step());
assert.deepEqual(price.getAsObject(), { unitPriceCents: 1749, recordedAt: 5 });
price.free();
const otherPrice = db.prepare(lastPriceSql, [code, 'other-market']);
assert.equal(otherPrice.step(), false);
otherPrice.free();
db.run(
  "INSERT INTO shopping_sessions(id, supermarket_id, status, started_at_ms) VALUES ('next', 'm', 'ACTIVE', 6)",
);
complete('next', 'empty');
assert.equal(scalar("SELECT status FROM shopping_sessions WHERE id = 'next'"), 'ACTIVE');
insertRegularItem(['next-item', 'next', 'Coffee', 1800, 1, 6, 6, code, 'UNIT', null]);
assert.throws(() => db.run("UPDATE shopping_items SET session_id = 's' WHERE id = 'next-item'"));
db.run("DELETE FROM shopping_items WHERE id = 'next-item'");
insertRegularItem(['free', 'next', 'Free item', 1, 1, 6, 6, null, 'UNIT', null]);
complete('next', 'zero-checkout', false, 0);
assert.equal(scalar("SELECT checkout_total_cents FROM shopping_sessions WHERE id = 'next'"), 0);
db.close();
console.log(
  'SQLite verified: migrations v1-v8, preservation, atomic catalog/item/outbox, repeated product grouping, weight and bundle constraints, exact mixed history, optional checkout including zero, rollback, completion replay, immutable history, leading zeros, price configuration isolation and reopen.',
);
