import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DatabaseService } from '../../../core/database/database.service';
import { ProductCatalogService } from './product-catalog.service';

describe('local catalog search', () => {
  it('bounds searches and binds literal text without treating wildcards as patterns', async () => {
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
    expect(await catalog.search(' Coffee% ')).toHaveLength(1);
    expect(query.mock.calls[0][1]).toEqual(['Coffee%', 'Coffee%']);
    expect(query.mock.calls[0][0]).toContain('LIMIT 20');
  });
});
