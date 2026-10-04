import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DatabaseService } from '../../../core/database/database.service';
import { ProductCatalogService } from './product-catalog.service';

describe('local catalog search', () => {
  it('bounds searches and matches literal text without treating wildcards as patterns', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ id: 'p', name: 'Coffee', barcode: '0789600112233' }]);
    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: { query } }],
    });
    const catalog = TestBed.inject(ProductCatalogService);
    expect(await catalog.search('a')).toEqual([]);
    expect(await catalog.search('x'.repeat(121))).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    expect(await catalog.search(' Coffee% ')).toEqual([]);
    expect(await catalog.search(' COFFEE ')).toHaveLength(1);
    expect(await catalog.search('0789')).toHaveLength(1);
  });

  it('matches Unicode case and canonical accents before limiting results', async () => {
    const products = Array.from({ length: 25 }, (_, index) => ({
      id: String(index),
      name: 'CAFÉ Açúcar',
      barcode: String(index),
    }));
    const query = vi.fn().mockResolvedValue(products);
    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: { query } }],
    });
    const catalog = TestBed.inject(ProductCatalogService);
    expect(await catalog.search('café')).toHaveLength(20);
    expect(await catalog.search('cafe\u0301')).toHaveLength(20);
    expect(await catalog.search('AÇÚCAR')).toHaveLength(20);
  });
});
