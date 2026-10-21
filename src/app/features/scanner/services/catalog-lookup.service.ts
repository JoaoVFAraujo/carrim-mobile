import { HttpBackend, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { API_BASE_URL, apiEndpoint } from '../../../core/api/api-endpoint';
import { SyncIdentityService } from '../../../core/api/sync-identity.service';
import { parseBarcode } from '../models/catalog-product';

export interface CatalogSuggestion {
  status: 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'DISABLED';
  source: 'PERSONAL' | 'OPEN_FOOD_FACTS' | null;
  barcode: string;
  name: string | null;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  licenseUrl: string | null;
  measurementType: 'UNIT' | 'WEIGHT' | null;
}

const sourceBase = 'https://world.openfoodfacts.org/product/';
const license = 'https://opendatacommons.org/licenses/odbl/1-0/';

/** Read-only suggestions. Confirmation uses the existing SQLite/outbox transaction. */
@Injectable({ providedIn: 'root' })
export class CatalogLookupService {
  private readonly base = inject(API_BASE_URL);
  private readonly identity = inject(SyncIdentityService);
  private readonly http = new HttpClient(inject(HttpBackend));

  async lookup(barcode: string, signal: AbortSignal): Promise<CatalogSuggestion> {
    const code = parseBarcode(barcode);
    const empty = (status: CatalogSuggestion['status']): CatalogSuggestion => ({
      status,
      source: null,
      barcode: code,
      name: null,
      brand: null,
      quantity: null,
      imageUrl: null,
      sourceUrl: null,
      licenseUrl: null,
      measurementType: null,
    });
    if (!this.base) return empty('DISABLED');
    if (signal.aborted || !navigator.onLine) return empty('UNAVAILABLE');
    try {
      const url = apiEndpoint(this.base, '/products/lookup/' + code);
      let token = await this.identity.accessToken();
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) return empty('UNAVAILABLE');
        try {
          const value = await firstValueFrom(
            this.http
              .get<unknown>(url, {
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'omit',
                redirect: 'error',
                cache: 'no-store',
                timeout: 8000,
              })
              .pipe(takeUntil(fromEvent(signal, 'abort'))),
          );
          return validatedSuggestion(value, code);
        } catch (error) {
          if (
            !signal.aborted &&
            error instanceof HttpErrorResponse &&
            error.status === 401 &&
            attempt === 0
          ) {
            token = await this.identity.accessToken(token);
            continue;
          }
          return empty(
            error instanceof HttpErrorResponse && error.status === 429
              ? 'RATE_LIMITED'
              : 'UNAVAILABLE',
          );
        }
      }
    } catch {
      // Identity errors never bypass the owner boundary or block manual registration.
    }
    return empty('UNAVAILABLE');
  }
}

function validatedSuggestion(value: unknown, barcode: string): CatalogSuggestion {
  if (!value || typeof value !== 'object') throw new Error('Invalid catalog response');
  const data = value as Record<string, unknown>;
  if (
    data['barcode'] !== barcode ||
    !['FOUND', 'NOT_FOUND', 'UNAVAILABLE', 'RATE_LIMITED', 'DISABLED'].includes(
      String(data['status']),
    )
  )
    throw new Error('Invalid catalog response');
  const status = data['status'] as CatalogSuggestion['status'];
  if (status !== 'FOUND')
    return {
      status,
      barcode,
      source: null,
      name: null,
      brand: null,
      quantity: null,
      imageUrl: null,
      sourceUrl: null,
      licenseUrl: null,
      measurementType: null,
    };
  const source = data['source'];
  if (source !== 'PERSONAL' && source !== 'OPEN_FOOD_FACTS') throw new Error('Invalid source');
  const text = (key: string, max: number): string | null => {
    const item = data[key];
    if (item === null || item === undefined || item === '') return null;
    if (
      typeof item !== 'string' ||
      item.length > max ||
      [...item].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new Error('Invalid field');
    return item.trim() || null;
  };
  const name = text('name', 120);
  if (!name) throw new Error('Missing product name');
  const measurementType = data['measurementType'];
  if (measurementType !== null && measurementType !== 'UNIT' && measurementType !== 'WEIGHT')
    throw new Error('Invalid measurement');
  const imageUrl = source === 'OPEN_FOOD_FACTS' ? safeCatalogImage(text('imageUrl', 1024)) : null;
  return {
    status,
    source,
    barcode,
    name,
    brand: source === 'OPEN_FOOD_FACTS' ? text('brand', 120) : null,
    quantity: source === 'OPEN_FOOD_FACTS' ? text('quantity', 80) : null,
    imageUrl,
    sourceUrl: source === 'OPEN_FOOD_FACTS' ? sourceBase + barcode : null,
    licenseUrl: source === 'OPEN_FOOD_FACTS' ? license : null,
    measurementType,
  };
}

function safeCatalogImage(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'images.openfoodfacts.org' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/images\/products\/[0-9/]+\/[a-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
