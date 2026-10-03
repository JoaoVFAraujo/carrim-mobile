import { Injectable, inject } from '@angular/core';
import { DatabaseService } from '../../../core/database/database.service';
import { CatalogProduct, LastProductPrice, parseBarcode } from '../models/catalog-product';

@Injectable({ providedIn: 'root' })
export class ProductCatalogService {
  private readonly database = inject(DatabaseService);

  async find(barcode: string): Promise<CatalogProduct | null> {
    const products = await this.database.query<CatalogProduct>(
      'SELECT id, barcode, name FROM products WHERE barcode = ?',
      [parseBarcode(barcode)],
    );
    return products[0] ?? null;
  }

  async lastPrice(barcode: string, supermarketId: string): Promise<LastProductPrice | null> {
    const prices = await this.database.query<LastProductPrice>(
      `SELECT unit_price_cents AS unitPriceCents, recorded_at_ms AS recordedAt FROM price_history
       WHERE barcode = ? AND supermarket_id = ? AND measurement_type = 'UNIT' AND pricing_type = 'REGULAR'
       ORDER BY recorded_at_ms DESC, id DESC LIMIT 1`,
      [parseBarcode(barcode), supermarketId],
    );
    return prices[0] ?? null;
  }
}
