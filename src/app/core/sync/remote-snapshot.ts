import type { capSQLiteSet } from '@capacitor-community/sqlite';

export class RemoteImportConflict extends Error {
  constructor() {
    super('Conflito ao receber dados. Suas compras locais foram preservadas.');
  }
}

export interface RemoteSnapshot {
  aggregateType: 'PRODUCT' | 'SUPERMARKET' | 'SHOPPING_SESSION';
  aggregateId: string;
  snapshot: Record<string, unknown> & { id: string; version: number };
}

export function snapshotStatements(change: RemoteSnapshot, now: number): capSQLiteSet[] {
  try {
    return buildSnapshot(change, now);
  } catch {
    throw new RemoteImportConflict();
  }
}
function buildSnapshot(change: RemoteSnapshot, now: number): capSQLiteSet[] {
  const s = change.snapshot;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !s ||
    s.id !== change.aggregateId ||
    !uuid.test(s.id) ||
    !Number.isSafeInteger(s.version) ||
    s.version < 0
  )
    throw new Error('Estado remoto inválido.');
  const validName = (value: unknown) =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
  const integer = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
  if (
    (change.aggregateType === 'PRODUCT' || change.aggregateType === 'SUPERMARKET') &&
    !validName(s['name'])
  )
    throw new Error();
  const metadata: capSQLiteSet[] = [
    {
      statement:
        'INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      values: [`remote_version:${change.aggregateType}:${s.id}`, String(s.version)],
    },
    {
      statement:
        'INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      values: [`remote_snapshot:${change.aggregateType}:${s.id}`, JSON.stringify(s)],
    },
  ];
  if (change.aggregateType === 'PRODUCT') {
    // Barcode-less remote products have no local catalog representation; retain their snapshot.
    if (s['barcode'] == null) return metadata;
    return [
      {
        statement: `INSERT INTO products(id,barcode,name,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET barcode=excluded.barcode,name=excluded.name,updated_at_ms=excluded.updated_at_ms`,
        values: [s.id, String(s['barcode']), String(s['name']), now, now],
      },
      ...metadata,
    ];
  }
  if (change.aggregateType === 'SUPERMARKET')
    return [
      {
        statement: `INSERT INTO supermarkets(id,name,created_at_ms,updated_at_ms) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at_ms=excluded.updated_at_ms`,
        values: [s.id, String(s['name']), now, now],
      },
      ...metadata,
    ];
  if (
    change.aggregateType !== 'SHOPPING_SESSION' ||
    !Array.isArray(s['items']) ||
    !['ACTIVE', 'COMPLETED', 'CANCELED'].includes(String(s['status']))
  )
    throw new Error('Estado remoto inválido.');
  const started = Date.parse(String(s['startedAt'])),
    finished = s['finishedAt'] == null ? null : Date.parse(String(s['finishedAt']));
  if (!Number.isSafeInteger(started) || (finished !== null && !Number.isSafeInteger(finished)))
    throw new Error('Data remota inválida.');
  if (
    !uuid.test(String(s['supermarketId'])) ||
    (s['status'] === 'ACTIVE') !== (finished === null) ||
    (finished !== null && finished < started) ||
    (s['budgetCents'] != null && !integer(s['budgetCents'], 1, 100000000)) ||
    (s['checkoutTotalCents'] != null && !integer(s['checkoutTotalCents'], 0, 100000000))
  )
    throw new Error();
  const statements: capSQLiteSet[] = [
    {
      statement: `INSERT INTO shopping_sessions(id,supermarket_id,budget_cents,status,started_at_ms)
      VALUES (?,?,?,'ACTIVE',?) ON CONFLICT(id) DO NOTHING`,
      values: [s.id, String(s['supermarketId']), s['budgetCents'] as number | null, started],
    },
    {
      statement: `UPDATE shopping_sessions SET budget_cents=? WHERE id=? AND status='ACTIVE'`,
      values: [s['budgetCents'] as number | null, s.id],
    },
    {
      statement: `DELETE FROM shopping_items WHERE session_id=? AND EXISTS
      (SELECT 1 FROM shopping_sessions WHERE id=? AND status='ACTIVE')`,
      values: [s.id, s.id],
    },
  ];
  const ids = new Set<string>();
  for (const item of s['items'] as Record<string, unknown>[]) {
    if (
      !item ||
      !uuid.test(String(item['id'])) ||
      ids.has(String(item['id'])) ||
      !validName(item['productNameSnapshot']) ||
      (item['productId'] != null && !uuid.test(String(item['productId']))) ||
      !['UNIT', 'WEIGHT'].includes(String(item['measurementType'])) ||
      !['REGULAR', 'BUNDLE'].includes(String(item['pricingType']))
    )
      throw new Error();
    ids.add(String(item['id']));
    const price = item['unitPriceCents'] ?? item['pricePerKgCents'] ?? item['bundlePriceCents'];
    if (!integer(price, 1, 100000000)) throw new Error();
    if (item['measurementType'] === 'WEIGHT') {
      if (
        item['pricingType'] !== 'REGULAR' ||
        !integer(item['weightGrams'], 1, 9999999) ||
        item['quantityUnits'] != null
      )
        throw new Error();
    } else if (!integer(item['quantityUnits'], 1, 9999)) throw new Error();
    if (
      item['pricingType'] === 'BUNDLE' &&
      (!integer(item['bundleQuantity'], 2, 9999) ||
        (item['quantityUnits'] as number) % (item['bundleQuantity'] as number) !== 0)
    )
      throw new Error();
    const productId = item['productId'] == null ? null : String(item['productId']);
    statements.push({
      statement: `INSERT INTO shopping_items(id,session_id,name,unit_price_cents,quantity,
      created_at_ms,updated_at_ms,barcode,measurement_type,weight_grams,pricing_type,bundle_quantity)
      SELECT ?,?,?,?,?,?,?,(SELECT barcode FROM products WHERE id=?),?,?,?,?
      WHERE EXISTS(SELECT 1 FROM shopping_sessions WHERE id=? AND status='ACTIVE')`,
      values: [
        String(item['id']),
        s.id,
        String(item['productNameSnapshot']),
        (item['unitPriceCents'] ?? item['pricePerKgCents'] ?? item['bundlePriceCents']) as number,
        (item['quantityUnits'] ?? 1) as number,
        started,
        now,
        productId,
        String(item['measurementType']),
        (item['weightGrams'] ?? null) as number | null,
        String(item['pricingType']),
        (item['bundleQuantity'] ?? null) as number | null,
        s.id,
      ],
    });
  }
  if (s['status'] === 'COMPLETED')
    statements.push({
      statement: `INSERT INTO price_history(id,session_id,item_id,supermarket_id,product_name,unit_price_cents,quantity,
      recorded_at_ms,barcode,measurement_type,weight_grams,pricing_type,bundle_quantity)
      SELECT i.id,i.session_id,i.id,?,i.name,i.unit_price_cents,i.quantity,?,i.barcode,i.measurement_type,
      i.weight_grams,i.pricing_type,i.bundle_quantity FROM shopping_items i JOIN shopping_sessions s ON s.id=i.session_id
      WHERE s.id=? AND s.status='ACTIVE' ON CONFLICT(id) DO NOTHING`,
      values: [String(s['supermarketId']), finished, s.id],
    });
  statements.push(
    {
      statement: `UPDATE shopping_sessions SET status=?,finished_at_ms=?,checkout_total_cents=?
    WHERE id=? AND status='ACTIVE'`,
      values: [
        String(s['status']),
        finished,
        (s['checkoutTotalCents'] ?? null) as number | null,
        s.id,
      ],
    },
    ...metadata,
  );
  return statements;
}
