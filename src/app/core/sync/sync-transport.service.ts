import { HttpBackend, HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, apiEndpoint } from '../api/api-endpoint';
import type { RemoteSnapshot } from './remote-snapshot';
import { SyncIdentityService } from '../api/sync-identity.service';

export interface SyncRequest {
  operationId: string;
  aggregateType: string;
  aggregateId: string;
  operation: string;
  baseVersion: number | null;
  payload: object;
}
export interface SyncOutcome {
  operationId: string;
  status: 'APPLIED' | 'ALREADY_APPLIED' | 'CONFLICT' | 'REJECTED';
  code: string | null;
  state: {
    aggregateType: string;
    aggregateId: string;
    snapshot: { id: string; version: number };
  } | null;
}
export class SyncTransportError extends Error {
  constructor(readonly transient: boolean) {
    super('Não foi possível sincronizar agora.');
  }
}

@Injectable({ providedIn: 'root' })
export class SyncTransportService {
  private readonly base = inject(API_BASE_URL);
  private readonly identity = inject(SyncIdentityService);
  private readonly http = new HttpClient(inject(HttpBackend));

  async current(
    type: 'PRODUCT' | 'SUPERMARKET' | 'SHOPPING_SESSION',
    id: string,
  ): Promise<RemoteSnapshot> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new SyncTransportError(false);
    const route = {
      PRODUCT: '/products/',
      SUPERMARKET: '/supermarkets/',
      SHOPPING_SESSION: '/shopping-sessions/',
    }[type];
    const url = apiEndpoint(this.base, route + id);
    // Uses the ownership boundary on every fresh review, including token renewal.
    let token = await this.identity.accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const snapshot = await firstValueFrom(
          this.http.get<RemoteSnapshot['snapshot']>(url, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            timeout: 15000,
          }),
        );
        return { aggregateType: type, aggregateId: id, snapshot };
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 401 && attempt === 0) {
          token = await this.identity.accessToken(token);
          continue;
        }
        throw new SyncTransportError(false);
      }
    }
    throw new SyncTransportError(false);
  }
  async pull(
    cursor?: string,
  ): Promise<{ changes: RemoteSnapshot[]; cursor: string; hasMore: boolean }> {
    const url = apiEndpoint(this.base, '/sync/pull');
    let token = await this.identity.accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const page = await firstValueFrom(
          this.http.get<{ changes: RemoteSnapshot[]; cursor: string; hasMore: boolean }>(url, {
            params: cursor ? new HttpParams().set('cursor', cursor) : undefined,
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            timeout: 15000,
          }),
        );
        if (
          !page ||
          !Array.isArray(page.changes) ||
          page.changes.length > 100 ||
          typeof page.cursor !== 'string' ||
          page.cursor.length > 128 ||
          typeof page.hasMore !== 'boolean'
        )
          throw new SyncTransportError(true);
        return page;
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 401 && attempt === 0) {
          token = await this.identity.accessToken(token);
          continue;
        }
        throw new SyncTransportError(true);
      }
    }
    throw new SyncTransportError(true);
  }
  async push(request: SyncRequest): Promise<SyncOutcome> {
    const url = apiEndpoint(this.base, '/sync/push');
    let token = await this.identity.accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const values = await firstValueFrom(
          this.http.post<SyncOutcome[]>(
            url,
            { operations: [request] },
            {
              headers: { Authorization: `Bearer ${token}` },
              credentials: 'omit',
              redirect: 'error',
              cache: 'no-store',
              timeout: 15000,
            },
          ),
        );
        const result = values?.[0];
        if (
          values.length !== 1 ||
          !result ||
          result.operationId !== request.operationId ||
          !['APPLIED', 'ALREADY_APPLIED', 'CONFLICT', 'REJECTED'].includes(result.status)
        )
          throw new SyncTransportError(true);
        if (['APPLIED', 'ALREADY_APPLIED'].includes(result.status)) {
          const state = result.state;
          if (
            !state ||
            state.aggregateType !== request.aggregateType ||
            state.aggregateId !== request.aggregateId ||
            !state.snapshot ||
            typeof state.snapshot.id !== 'string' ||
            !Number.isSafeInteger(state.snapshot.version) ||
            state.snapshot.version < 0
          )
            throw new SyncTransportError(true);
        }
        return result;
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 401 && attempt === 0) {
          token = await this.identity.accessToken(token);
          continue;
        }
        if (error instanceof SyncTransportError) throw error;
        throw new SyncTransportError(
          error instanceof HttpErrorResponse &&
            (error.status === 0 ||
              error.status === 408 ||
              error.status === 429 ||
              error.status >= 500),
        );
      }
    }
    throw new SyncTransportError(false);
  }
}
