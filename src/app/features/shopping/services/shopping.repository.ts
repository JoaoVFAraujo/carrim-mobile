import { Injectable, inject } from '@angular/core';
import { DatabaseService } from '../../../core/database/database.service';
import { ActiveShoppingSession, Supermarket } from '../models/shopping-session';
import { ShoppingItem } from '../models/shopping-item';
import { CompletedShopping } from '../models/completed-shopping';
import { CatalogProduct } from '../../scanner/models/catalog-product';

export interface ShoppingSnapshot {
  supermarkets: Supermarket[];
  active: ActiveShoppingSession | null;
  items: ShoppingItem[];
  history: CompletedShopping[];
}

export interface ShoppingItemWrite {
  sessionId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  itemId?: string;
  barcode: string | null;
  updateCatalog: boolean;
  weightGrams?: number;
  bundleQuantity?: number;
}

/** SQL and atomic data/outbox writes. UI state and action ordering belong to the Store. */
@Injectable({ providedIn: 'root' })
export class ShoppingRepository {
  private readonly database = inject(DatabaseService);

  async changeBudget(sessionId: string, budgetCents: number | null): Promise<void> {
    const now = Date.now();
    const entry = this.outbox('SHOPPING_SESSION', sessionId, { budgetCents }, now, 'UPDATE');
    await this.database.transaction([
      {
        statement:
          "UPDATE shopping_sessions SET budget_cents = ? WHERE id = ? AND status = 'ACTIVE'",
        values: [budgetCents, sessionId],
      },
      this.changedOutbox(entry.values),
    ]);
  }

  async cancel(sessionId: string): Promise<void> {
    const now = Date.now();
    const entry = this.outbox(
      'SHOPPING_SESSION',
      sessionId,
      { canceledAt: new Date(now).toISOString() },
      now,
      'CANCEL',
    );
    await this.database.transaction([
      {
        statement:
          "UPDATE shopping_sessions SET status = 'CANCELED', finished_at_ms = ? WHERE id = ? AND status = 'ACTIVE'",
        values: [now, sessionId],
      },
      this.changedOutbox(entry.values),
    ]);
  }

  async complete(sessionId: string, checkoutTotalCents: number | null): Promise<void> {
    const now = Date.now();
    const completion = this.outbox(
      'SHOPPING_SESSION',
      sessionId,
      { finishedAt: new Date(now).toISOString(), checkoutTotalCents },
      now,
      'COMPLETE',
    );
    await this.database.transaction([
      {
        statement: `INSERT INTO price_history(id, session_id, item_id, supermarket_id, product_name, unit_price_cents, quantity, recorded_at_ms, barcode, measurement_type, weight_grams, pricing_type, bundle_quantity)
          SELECT i.id, i.session_id, i.id, s.supermarket_id, i.name, i.unit_price_cents, i.quantity, ?, i.barcode, i.measurement_type, i.weight_grams, i.pricing_type, i.bundle_quantity
          FROM shopping_items i JOIN shopping_sessions s ON s.id = i.session_id
          WHERE s.id = ? AND s.status = 'ACTIVE'`,
        values: [now, sessionId],
      },
      {
        statement: `UPDATE shopping_sessions SET status = 'COMPLETED', finished_at_ms = ?, checkout_total_cents = ?
           WHERE id = ? AND status = 'ACTIVE'
           AND EXISTS (SELECT 1 FROM shopping_items WHERE session_id = shopping_sessions.id)`,
        values: [now, checkoutTotalCents, sessionId],
      },
      {
        // Only enqueue when the preceding update actually completed this session.
        statement: `INSERT INTO sync_queue(id, sequence_number, aggregate_type, aggregate_id,
          operation, payload_json, created_at_ms, updated_at_ms)
          SELECT ?, (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM sync_queue), ?, ?, ?, ?, ?, ?
          WHERE changes() = 1`,
        values: completion.values,
      },
    ]);
  }

  async completedItems(sessionId: string): Promise<ShoppingItem[]> {
    return this.database.query<ShoppingItem>(
      `SELECT i.id, i.session_id AS sessionId, i.name, i.unit_price_cents AS unitPriceCents, i.quantity, i.barcode,
        i.measurement_type AS measurementType, i.weight_grams AS weightGrams,
        i.pricing_type AS pricingType, i.bundle_quantity AS bundleQuantity
        FROM shopping_items i JOIN shopping_sessions s ON s.id = i.session_id
        WHERE s.id = ? AND s.status = 'COMPLETED' ORDER BY i.created_at_ms, i.id`,
      [sessionId],
    );
  }
  async saveItem(input: ShoppingItemWrite): Promise<string> {
    const {
      sessionId,
      name: trimmed,
      unitPriceCents,
      quantity,
      itemId,
      barcode: code,
      updateCatalog,
      weightGrams,
      bundleQuantity,
    } = input;
    const measurementType = weightGrams === undefined ? 'UNIT' : 'WEIGHT';
    const pricingType = bundleQuantity === undefined ? 'REGULAR' : 'BUNDLE';
    const now = Date.now();
    const statements = [];
    if (updateCatalog && code !== null) {
      const products = await this.database.query<CatalogProduct>(
        'SELECT id, barcode, name FROM products WHERE barcode = ?',
        [code],
      );
      const productId = products[0]?.id ?? crypto.randomUUID();
      statements.push({
        statement: `INSERT INTO products(id, barcode, name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(barcode) DO UPDATE SET name = excluded.name, updated_at_ms = excluded.updated_at_ms`,
        values: [productId, code, trimmed, now, now],
      });
      statements.push(
        this.outbox(
          'PRODUCT',
          productId,
          { barcode: code, name: trimmed },
          now,
          products[0] ? 'UPDATE' : 'CREATE',
        ),
      );
    }
    const matching = itemId
      ? []
      : await this.database.query<ShoppingItem>(
          `SELECT id, quantity, weight_grams AS weightGrams FROM shopping_items
            WHERE session_id = ? AND name = ? AND unit_price_cents = ? AND barcode IS ?
            AND measurement_type = ?
            AND pricing_type = ? AND bundle_quantity IS ?
            ORDER BY created_at_ms, id LIMIT 1`,
          [
            sessionId,
            trimmed,
            unitPriceCents,
            code,
            measurementType,
            pricingType,
            bundleQuantity ?? null,
          ],
        );
    const existingId = itemId ?? matching[0]?.id;
    const savedQuantity =
      measurementType === 'WEIGHT' ? 1 : quantity + (matching[0]?.quantity ?? 0);
    const savedWeight =
      weightGrams === undefined ? null : weightGrams + (matching[0]?.weightGrams ?? 0);
    if (savedQuantity > 9999) throw new Error('Informe uma quantidade total de até 9999.');
    if (savedWeight !== null && savedWeight > 9999999)
      throw new Error('Informe um peso total de até 9999,999 kg.');
    const id = existingId ?? crypto.randomUUID();
    const statement = existingId
      ? {
          statement:
            'UPDATE shopping_items SET name = ?, unit_price_cents = ?, quantity = ?, updated_at_ms = ?, measurement_type = ?, weight_grams = ?, pricing_type = ?, bundle_quantity = ? WHERE id = ? AND session_id = ?',
          values: [
            trimmed,
            unitPriceCents,
            savedQuantity,
            now,
            measurementType,
            savedWeight,
            pricingType,
            bundleQuantity ?? null,
            id,
            sessionId,
          ],
        }
      : {
          statement:
            'INSERT INTO shopping_items(id, session_id, name, unit_price_cents, quantity, created_at_ms, updated_at_ms, barcode, measurement_type, weight_grams, pricing_type, bundle_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          values: [
            id,
            sessionId,
            trimmed,
            unitPriceCents,
            quantity,
            now,
            now,
            code,
            measurementType,
            savedWeight,
            pricingType,
            bundleQuantity ?? null,
          ],
        };
    await this.database.transaction([
      ...statements,
      statement,
      this.outbox(
        'SHOPPING_ITEM',
        id,
        {
          sessionId: sessionId,
          name: trimmed,
          measurementType,
          pricingType,
          ...(pricingType === 'BUNDLE'
            ? { bundleQuantity, bundlePriceCents: unitPriceCents, quantity: savedQuantity }
            : measurementType === 'WEIGHT'
              ? { pricePerKgCents: unitPriceCents, weightGrams: savedWeight }
              : { unitPriceCents, quantity: savedQuantity }),
          ...(code !== null ? { barcode: code } : {}),
        },
        now,
        existingId ? 'UPDATE' : 'CREATE',
      ),
    ]);
    return id;
  }

  async removeItem(sessionId: string, id: string): Promise<void> {
    const now = Date.now();
    await this.database.transaction([
      {
        statement: 'DELETE FROM shopping_items WHERE id = ? AND session_id = ?',
        values: [id, sessionId],
      },
      this.outbox('SHOPPING_ITEM', id, { sessionId: sessionId }, now, 'DELETE'),
    ]);
  }

  async create(
    market: Supermarket | undefined,
    name: string,
    budgetCents: number | null,
  ): Promise<void> {
    const now = Date.now();
    const marketId = market?.id ?? crypto.randomUUID();
    const id = crypto.randomUUID();
    const statements = [];
    if (!market) {
      statements.push({
        statement:
          'INSERT INTO supermarkets(id, name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)',
        values: [marketId, name, now, now],
      });
      statements.push(
        this.outbox(
          'SUPERMARKET',
          marketId,
          { name, occurredAt: new Date(now).toISOString() },
          now,
        ),
      );
    }
    statements.push({
      statement:
        'INSERT INTO shopping_sessions(id, supermarket_id, budget_cents, status, started_at_ms) VALUES (?, ?, ?, ?, ?)',
      values: [id, marketId, budgetCents, 'ACTIVE', now],
    });
    statements.push(
      this.outbox(
        'SHOPPING_SESSION',
        id,
        {
          supermarketId: marketId,
          budgetCents,
          startedAt: new Date(now).toISOString(),
        },
        now,
      ),
    );
    await this.database.transaction(statements);
  }

  private outbox(type: string, id: string, payload: object, now: number, operation = 'CREATE') {
    return {
      statement: `INSERT INTO sync_queue(id, sequence_number, aggregate_type, aggregate_id,
        operation, payload_json, created_at_ms, updated_at_ms)
        VALUES (?, (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM sync_queue), ?, ?, ?, ?, ?, ?)`,
      values: [crypto.randomUUID(), type, id, operation, JSON.stringify(payload), now, now],
    };
  }

  private changedOutbox(values: (string | number)[]) {
    return {
      statement: `INSERT INTO sync_queue(id, sequence_number, aggregate_type, aggregate_id, operation, payload_json, created_at_ms, updated_at_ms)
        SELECT ?, (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM sync_queue), ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
      values,
    };
  }

  async snapshot(): Promise<ShoppingSnapshot> {
    const markets = await this.database.query<Supermarket>(
      `SELECT m.id, m.name FROM supermarkets m LEFT JOIN shopping_sessions s ON s.supermarket_id = m.id
       GROUP BY m.id ORDER BY MAX(s.started_at_ms) DESC, m.name COLLATE NOCASE`,
    );
    const active = await this.database.query<ActiveShoppingSession>(
      `SELECT s.id, s.supermarket_id AS supermarketId, m.name AS supermarketName,
        s.budget_cents AS budgetCents, s.started_at_ms AS startedAt
        FROM shopping_sessions s JOIN supermarkets m ON m.id = s.supermarket_id WHERE s.status = 'ACTIVE'`,
    );
    const items = active[0]
      ? await this.database.query<ShoppingItem>(
          'SELECT id, session_id AS sessionId, name, unit_price_cents AS unitPriceCents, quantity, barcode, measurement_type AS measurementType, weight_grams AS weightGrams, pricing_type AS pricingType, bundle_quantity AS bundleQuantity FROM shopping_items WHERE session_id = ? ORDER BY created_at_ms, id',
          [active[0].id],
        )
      : [];
    const history = await this.database.query<CompletedShopping>(
      `SELECT s.id, m.name AS supermarketName, s.budget_cents AS budgetCents,
        s.checkout_total_cents AS checkoutTotalCents,
        s.finished_at_ms AS finishedAt, COALESCE(SUM(CASE WHEN i.pricing_type = 'BUNDLE'
          THEN i.unit_price_cents * (i.quantity / i.bundle_quantity)
          WHEN i.measurement_type = 'WEIGHT'
          THEN (i.unit_price_cents * i.weight_grams + 500) / 1000
          ELSE i.unit_price_cents * i.quantity END), 0) AS totalCents,
        COUNT(i.id) AS itemCount FROM shopping_sessions s JOIN supermarkets m ON m.id = s.supermarket_id
        LEFT JOIN shopping_items i ON i.session_id = s.id WHERE s.status = 'COMPLETED'
        GROUP BY s.id ORDER BY s.finished_at_ms DESC, s.id`,
    );
    return { supermarkets: markets, active: active[0] ?? null, items, history };
  }
}
