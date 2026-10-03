import { Injectable, computed, inject, signal } from '@angular/core';
import { DatabaseService } from '../../../core/database/database.service';
import { ActiveShoppingSession, Supermarket } from '../models/shopping-session';
import { ShoppingItem } from '../models/shopping-item';
import { CompletedShopping } from '../models/completed-shopping';
import { CatalogProduct, parseBarcode } from '../../scanner/models/catalog-product';

@Injectable({ providedIn: 'root' })
export class ShoppingSessionStore {
  private readonly database = inject(DatabaseService);
  readonly active = signal<ActiveShoppingSession | null>(null);
  readonly supermarkets = signal<Supermarket[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  private loadingPromise?: Promise<void>;
  readonly items = signal<ShoppingItem[]>([]);
  readonly history = signal<CompletedShopping[]>([]);
  private completing?: Promise<void>;
  private itemWrites: Promise<void> = Promise.resolve();

  complete(): Promise<void> {
    if (this.completing) return this.completing;
    this.completing = this.persistCompletion().finally(() => {
      this.completing = undefined;
    });
    return this.completing;
  }

  private async persistCompletion(): Promise<void> {
    const session = this.active();
    if (!session || !this.items().length)
      throw new Error('Adicione pelo menos um produto antes de finalizar.');
    const now = Date.now();
    const completion = this.outbox(
      'SHOPPING_SESSION',
      session.id,
      { finishedAt: new Date(now).toISOString() },
      now,
      'COMPLETE',
    );
    await this.database.transaction([
      {
        statement: `INSERT INTO price_history(id, session_id, item_id, supermarket_id, product_name, unit_price_cents, quantity, recorded_at_ms, barcode)
          SELECT i.id, i.session_id, i.id, s.supermarket_id, i.name, i.unit_price_cents, i.quantity, ?, i.barcode
          FROM shopping_items i JOIN shopping_sessions s ON s.id = i.session_id
          WHERE s.id = ? AND s.status = 'ACTIVE'`,
        values: [now, session.id],
      },
      {
        statement: `UPDATE shopping_sessions SET status = 'COMPLETED', finished_at_ms = ?
           WHERE id = ? AND status = 'ACTIVE'
           AND EXISTS (SELECT 1 FROM shopping_items WHERE session_id = shopping_sessions.id)`,
        values: [now, session.id],
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
    // The write succeeded: a subsequent read failure must not leave an editable cart.
    this.active.set(null);
    this.items.set([]);
    await this.load();
  }

  async completedItems(sessionId: string): Promise<ShoppingItem[]> {
    return this.database.query<ShoppingItem>(
      `SELECT i.id, i.session_id AS sessionId, i.name, i.unit_price_cents AS unitPriceCents, i.quantity, i.barcode
        FROM shopping_items i JOIN shopping_sessions s ON s.id = i.session_id
        WHERE s.id = ? AND s.status = 'COMPLETED' ORDER BY i.created_at_ms, i.id`,
      [sessionId],
    );
  }
  readonly totalCents = computed(() =>
    this.items().reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
  );
  readonly remainingCents = computed(() => {
    const budget = this.active()?.budgetCents;
    return budget == null ? null : budget - this.totalCents();
  });
  readonly budgetProgress = computed(() => {
    const budget = this.active()?.budgetCents;
    return budget ? Math.min(this.totalCents() / budget, 1) : 0;
  });
  readonly budgetPercent = computed(() => {
    const budget = this.active()?.budgetCents;
    return budget ? Math.round((this.totalCents() * 100) / budget) : 0;
  });

  saveItem(
    name: string,
    unitPriceCents: number,
    quantity: number,
    itemId?: string,
    barcode?: string,
  ): Promise<void> {
    const sessionId = this.active()?.id;
    const operation = this.itemWrites.then(() => {
      if (this.active()?.id !== sessionId)
        throw new Error('Comece uma compra antes de adicionar produtos.');
      return this.persistItem(name, unitPriceCents, quantity, itemId, barcode);
    });
    // Serialize additions so two confirmations see the quantity saved by the previous one.
    this.itemWrites = operation.catch(() => undefined);
    return operation;
  }

  private async persistItem(
    name: string,
    unitPriceCents: number,
    quantity: number,
    itemId?: string,
    barcode?: string,
  ): Promise<void> {
    const session = this.active();
    if (!session) throw new Error('Comece uma compra antes de adicionar produtos.');
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) throw new Error('Informe o nome do produto.');
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0 || unitPriceCents > 100000000)
      throw new Error('Informe um preço válido.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999)
      throw new Error('Informe uma quantidade entre 1 e 9999.');
    if (itemId && !this.items().some((item) => item.id === itemId))
      throw new Error('Produto não encontrado.');
    const now = Date.now();
    const code =
      barcode === undefined
        ? (this.items().find((item) => item.id === itemId)?.barcode ?? null)
        : parseBarcode(barcode);
    const statements = [];
    if (barcode !== undefined && code !== null) {
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
          `SELECT id, quantity FROM shopping_items
            WHERE session_id = ? AND name = ? AND unit_price_cents = ? AND barcode IS ?
            ORDER BY created_at_ms, id LIMIT 1`,
          [session.id, trimmed, unitPriceCents, code],
        );
    const existingId = itemId ?? matching[0]?.id;
    const savedQuantity = quantity + (matching[0]?.quantity ?? 0);
    if (savedQuantity > 9999) throw new Error('Informe uma quantidade total de até 9999.');
    const id = existingId ?? crypto.randomUUID();
    const statement = existingId
      ? {
          statement:
            'UPDATE shopping_items SET name = ?, unit_price_cents = ?, quantity = ?, updated_at_ms = ? WHERE id = ? AND session_id = ?',
          values: [trimmed, unitPriceCents, savedQuantity, now, id, session.id],
        }
      : {
          statement:
            'INSERT INTO shopping_items(id, session_id, name, unit_price_cents, quantity, created_at_ms, updated_at_ms, barcode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          values: [id, session.id, trimmed, unitPriceCents, quantity, now, now, code],
        };
    await this.database.transaction([
      ...statements,
      statement,
      this.outbox(
        'SHOPPING_ITEM',
        id,
        {
          sessionId: session.id,
          name: trimmed,
          unitPriceCents,
          quantity: savedQuantity,
          ...(code !== null ? { barcode: code } : {}),
        },
        now,
        existingId ? 'UPDATE' : 'CREATE',
      ),
    ]);
    // A committed item must not be offered for a duplicate retry if only the read fails.
    await this.load();
  }

  async removeItem(id: string): Promise<void> {
    const session = this.active();
    if (!session || !this.items().some((item) => item.id === id))
      throw new Error('Produto não encontrado.');
    const now = Date.now();
    await this.database.transaction([
      {
        statement: 'DELETE FROM shopping_items WHERE id = ? AND session_id = ?',
        values: [id, session.id],
      },
      this.outbox('SHOPPING_ITEM', id, { sessionId: session.id }, now, 'DELETE'),
    ]);
    await this.refresh();
  }

  load(): Promise<void> {
    if (this.loadingPromise) return this.loadingPromise;
    this.loading.set(true);
    this.error.set('');
    this.loadingPromise = this.refresh()
      .catch(() => this.error.set('Não conseguimos abrir seus dados locais. Tente novamente.'))
      .finally(() => {
        this.loading.set(false);
        this.loadingPromise = undefined;
      });
    return this.loadingPromise;
  }

  async create(supermarketId: string, newName: string, budgetCents: number | null): Promise<void> {
    if (this.active()) throw new Error('Você já possui uma compra em andamento.');
    const name = newName.trim();
    const market = this.supermarkets().find((item) => item.id === supermarketId);
    if (!market && (!name || name.length > 120)) throw new Error('Informe o nome do supermercado.');
    if (budgetCents !== null && (!Number.isSafeInteger(budgetCents) || budgetCents <= 0)) {
      throw new Error('Informe um limite válido.');
    }
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
    await this.refresh();
  }

  private outbox(type: string, id: string, payload: object, now: number, operation = 'CREATE') {
    return {
      statement: `INSERT INTO sync_queue(id, sequence_number, aggregate_type, aggregate_id,
        operation, payload_json, created_at_ms, updated_at_ms)
        VALUES (?, (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM sync_queue), ?, ?, ?, ?, ?, ?)`,
      values: [crypto.randomUUID(), type, id, operation, JSON.stringify(payload), now, now],
    };
  }

  private async refresh(): Promise<void> {
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
          'SELECT id, session_id AS sessionId, name, unit_price_cents AS unitPriceCents, quantity, barcode FROM shopping_items WHERE session_id = ? ORDER BY created_at_ms, id',
          [active[0].id],
        )
      : [];
    const history = await this.database.query<CompletedShopping>(
      `SELECT s.id, m.name AS supermarketName, s.budget_cents AS budgetCents,
        s.finished_at_ms AS finishedAt, COALESCE(SUM(i.unit_price_cents * i.quantity), 0) AS totalCents,
        COUNT(i.id) AS itemCount FROM shopping_sessions s JOIN supermarkets m ON m.id = s.supermarket_id
        LEFT JOIN shopping_items i ON i.session_id = s.id WHERE s.status = 'COMPLETED'
        GROUP BY s.id ORDER BY s.finished_at_ms DESC, s.id`,
    );
    this.history.set(history);
    this.supermarkets.set(markets);
    this.active.set(active[0] ?? null);
    this.items.set(items);
  }
}
