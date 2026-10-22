import { Injectable, computed, inject, signal } from '@angular/core';
import { LocalDatabaseInUse } from '../../../core/database/database.service';
import { ActiveShoppingSession, Supermarket } from '../models/shopping-session';
import { ShoppingItem, itemSubtotalCents } from '../models/shopping-item';
import { CompletedShopping } from '../models/completed-shopping';
import { parseBarcode } from '../../scanner/models/catalog-product';
import { ShoppingRepository } from './shopping.repository';

@Injectable({ providedIn: 'root' })
export class ShoppingSessionStore {
  private readonly repository = inject(ShoppingRepository);
  readonly active = signal<ActiveShoppingSession | null>(null);
  readonly supermarkets = signal<Supermarket[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  private loadingPromise?: Promise<void>;
  private initialized = false;
  readonly items = signal<ShoppingItem[]>([]);
  readonly history = signal<CompletedShopping[]>([]);
  private completing?: Promise<void>;
  private itemWrites: Promise<void> = Promise.resolve();

  complete(checkoutTotalCents: number | null = null): Promise<void> {
    if (this.completing) return this.completing;
    if (
      checkoutTotalCents !== null &&
      (!Number.isSafeInteger(checkoutTotalCents) ||
        checkoutTotalCents < 0 ||
        checkoutTotalCents > 100000000)
    )
      return Promise.reject(new Error('Informe um total do caixa válido.'));
    this.completing = this.sessionWrite(() => this.persistCompletion(checkoutTotalCents)).finally(
      () => {
        this.completing = undefined;
      },
    );
    return this.completing;
  }

  private sessionWrite(work: () => Promise<void>): Promise<void> {
    const sessionId = this.active()?.id;
    const next = this.itemWrites.then(() => {
      if (!sessionId || this.active()?.id !== sessionId)
        throw new Error('A compra não está mais em andamento.');
      return work();
    });
    this.itemWrites = next.catch(() => undefined);
    return next;
  }

  changeBudget(budgetCents: number | null): Promise<void> {
    return this.sessionWrite(async () => {
      if (
        budgetCents !== null &&
        (!Number.isSafeInteger(budgetCents) || budgetCents <= 0 || budgetCents > 100000000)
      )
        throw new Error('Informe um limite válido.');
      const session = this.active()!;
      await this.repository.changeBudget(session.id, budgetCents);
      this.active.update((value) => (value?.id === session.id ? { ...value, budgetCents } : value));
      await this.reloadAfterWrite();
    });
  }

  cancel(): Promise<void> {
    return this.sessionWrite(async () => {
      const session = this.active()!;
      await this.repository.cancel(session.id);
      this.active.set(null);
      this.items.set([]);
      await this.reloadAfterWrite();
    });
  }

  private async persistCompletion(checkoutTotalCents: number | null): Promise<void> {
    if (
      checkoutTotalCents !== null &&
      (!Number.isSafeInteger(checkoutTotalCents) ||
        checkoutTotalCents < 0 ||
        checkoutTotalCents > 100000000)
    ) {
      throw new Error('Informe um total do caixa válido.');
    }
    const session = this.active();
    if (!session || !this.items().length)
      throw new Error('Adicione pelo menos um produto antes de finalizar.');
    await this.repository.complete(session.id, checkoutTotalCents);
    // The write succeeded: a subsequent read failure must not leave an editable cart.
    this.active.set(null);
    this.items.set([]);
    await this.reloadAfterWrite();
  }

  completedItems(sessionId: string): Promise<ShoppingItem[]> {
    return this.repository.completedItems(sessionId);
  }
  readonly totalCents = computed(() =>
    this.items().reduce((sum, item) => sum + itemSubtotalCents(item), 0),
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
  ): Promise<string> {
    return this.enqueueItem(name, unitPriceCents, quantity, itemId, barcode);
  }

  changeQuantity(itemId: string, direction: -1 | 1): Promise<void> {
    const sessionId = this.active()?.id;
    const operation = this.itemWrites.then(() => {
      if (!sessionId || this.active()?.id !== sessionId)
        throw new Error('Comece uma compra antes de alterar produtos.');
      const item = this.items().find((entry) => entry.id === itemId);
      if (!item) throw new Error('Produto não encontrado.');
      if (item.measurementType === 'WEIGHT')
        throw new Error('Informe o peso na edição do produto.');
      if (direction !== -1 && direction !== 1)
        throw new Error('Informe uma alteração de quantidade válida.');
      const step = item.pricingType === 'BUNDLE' ? item.bundleQuantity! : 1;
      return this.persistItem(
        item.name,
        item.unitPriceCents,
        item.quantity + direction * step,
        item.id,
        undefined,
        undefined,
        item.pricingType === 'BUNDLE' ? item.bundleQuantity! : undefined,
      );
    });
    this.itemWrites = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.then(() => undefined);
  }

  saveWeightItem(
    name: string,
    pricePerKgCents: number,
    weightGrams: number,
    itemId?: string,
    barcode?: string,
  ): Promise<string> {
    return this.enqueueItem(name, pricePerKgCents, 1, itemId, barcode, weightGrams);
  }

  saveBundleItem(
    name: string,
    bundleQuantity: number,
    bundlePriceCents: number,
    quantity: number,
    itemId?: string,
    barcode?: string,
  ): Promise<string> {
    return this.enqueueItem(
      name,
      bundlePriceCents,
      quantity,
      itemId,
      barcode,
      undefined,
      bundleQuantity,
    );
  }

  private enqueueItem(
    name: string,
    unitPriceCents: number,
    quantity: number,
    itemId?: string,
    barcode?: string,
    weightGrams?: number,
    bundleQuantity?: number,
  ): Promise<string> {
    const sessionId = this.active()?.id;
    const operation = this.itemWrites.then(() => {
      if (this.active()?.id !== sessionId)
        throw new Error('Comece uma compra antes de adicionar produtos.');
      return this.persistItem(
        name,
        unitPriceCents,
        quantity,
        itemId,
        barcode,
        weightGrams,
        bundleQuantity,
      );
    });
    // Serialize additions so two confirmations see the quantity saved by the previous one.
    this.itemWrites = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async persistItem(
    name: string,
    unitPriceCents: number,
    quantity: number,
    itemId?: string,
    barcode?: string,
    weightGrams?: number,
    bundleQuantity?: number,
  ): Promise<string> {
    const session = this.active();
    if (!session) throw new Error('Comece uma compra antes de adicionar produtos.');
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) throw new Error('Informe o nome do produto.');
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0 || unitPriceCents > 100000000)
      throw new Error('Informe um preço válido.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999)
      throw new Error('Informe uma quantidade entre 1 e 9999.');
    if (
      weightGrams !== undefined &&
      (!Number.isInteger(weightGrams) || weightGrams < 1 || weightGrams > 9999999)
    )
      throw new Error('Informe um peso entre 0,001 e 9999,999 kg.');
    if (
      bundleQuantity !== undefined &&
      (!Number.isInteger(bundleQuantity) || bundleQuantity < 2 || bundleQuantity > 9999)
    )
      throw new Error('Informe entre 2 e 9999 unidades por promoção.');
    if (
      bundleQuantity !== undefined &&
      (weightGrams !== undefined || quantity % bundleQuantity !== 0)
    )
      throw new Error(
        `Informe uma quantidade múltipla de ${bundleQuantity}. Unidades avulsas entram em outra linha.`,
      );
    if (itemId && !this.items().some((item) => item.id === itemId))
      throw new Error('Produto não encontrado.');
    const code =
      barcode === undefined
        ? (this.items().find((item) => item.id === itemId)?.barcode ?? null)
        : parseBarcode(barcode);
    const savedId = await this.repository.saveItem({
      sessionId: session.id,
      name: trimmed,
      unitPriceCents,
      quantity,
      itemId,
      barcode: code,
      updateCatalog: barcode !== undefined,
      weightGrams,
      bundleQuantity,
    });
    // A committed item must not be offered for a duplicate retry if only the read fails.
    await this.reloadAfterWrite();
    return savedId;
  }

  async removeItem(id: string): Promise<void> {
    const session = this.active();
    if (!session || !this.items().some((item) => item.id === id))
      throw new Error('Produto não encontrado.');
    await this.repository.removeItem(session.id, id);
    await this.refresh();
  }

  load(): Promise<void> {
    if (this.loadingPromise) return this.loadingPromise;
    // Keep the current view mounted during quantity edits, sync and tab refreshes.
    // The full loading state is only needed before the first successful read.
    this.loading.set(!this.initialized);
    this.error.set('');
    this.loadingPromise = this.refresh()
      .then(() => {
        this.initialized = true;
      })
      .catch((error) =>
        this.error.set(
          error instanceof LocalDatabaseInUse
            ? error.message
            : 'Não conseguimos abrir seus dados locais. Tente novamente.',
        ),
      )
      .finally(() => {
        this.loading.set(false);
        this.loadingPromise = undefined;
      });
    return this.loadingPromise;
  }

  private async reloadAfterWrite(): Promise<void> {
    // A snapshot started before the commit may already contain stale items.
    // Let it finish, then read again instead of joining that earlier snapshot.
    await this.loadingPromise;
    await this.load();
  }

  async create(supermarketId: string, newName: string, budgetCents: number | null): Promise<void> {
    if (this.active()) throw new Error('Você já possui uma compra em andamento.');
    const name = newName.trim();
    const market = this.supermarkets().find((item) => item.id === supermarketId);
    if (!market && (!name || name.length > 120)) throw new Error('Informe o nome do supermercado.');
    if (budgetCents !== null && (!Number.isSafeInteger(budgetCents) || budgetCents <= 0)) {
      throw new Error('Informe um limite válido.');
    }
    await this.repository.create(market, name, budgetCents);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const { history, supermarkets, active, items } = await this.repository.snapshot();
    this.history.set(history);
    this.supermarkets.set(supermarkets);
    this.active.set(active);
    this.items.set(items);
  }
}
