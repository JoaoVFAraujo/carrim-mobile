import { Injectable, computed, inject, signal } from '@angular/core';
import { DatabaseService } from '../../../core/database/database.service';
import { ActiveShoppingSession, Supermarket } from '../models/shopping-session';
import { ShoppingItem } from '../models/shopping-item';

@Injectable({ providedIn: 'root' })
export class ShoppingSessionStore {
  private readonly database = inject(DatabaseService);
  readonly active = signal<ActiveShoppingSession | null>(null);
  readonly supermarkets = signal<Supermarket[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  private loadingPromise?: Promise<void>;
  readonly items = signal<ShoppingItem[]>([]);
  readonly totalCents = computed(() =>
    this.items().reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
  );
  readonly remainingCents = computed(() => {
    const budget = this.active()?.budgetCents;
    return budget == null ? null : budget - this.totalCents();
  });

  async saveItem(
    name: string,
    unitPriceCents: number,
    quantity: number,
    itemId?: string,
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
    const id = itemId ?? crypto.randomUUID();
    const now = Date.now();
    const statement = itemId
      ? {
          statement:
            'UPDATE shopping_items SET name = ?, unit_price_cents = ?, quantity = ?, updated_at_ms = ? WHERE id = ? AND session_id = ?',
          values: [trimmed, unitPriceCents, quantity, now, id, session.id],
        }
      : {
          statement:
            'INSERT INTO shopping_items(id, session_id, name, unit_price_cents, quantity, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
          values: [id, session.id, trimmed, unitPriceCents, quantity, now, now],
        };
    await this.database.transaction([
      statement,
      this.outbox(
        'SHOPPING_ITEM',
        id,
        { sessionId: session.id, name: trimmed, unitPriceCents, quantity },
        now,
        itemId ? 'UPDATE' : 'CREATE',
      ),
    ]);
    await this.refresh();
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
          'SELECT id, session_id AS sessionId, name, unit_price_cents AS unitPriceCents, quantity FROM shopping_items WHERE session_id = ? ORDER BY created_at_ms, id',
          [active[0].id],
        )
      : [];
    this.supermarkets.set(markets);
    this.active.set(active[0] ?? null);
    this.items.set(items);
  }
}
