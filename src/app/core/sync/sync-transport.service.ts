import { HttpBackend, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, apiEndpoint } from '../api/api-endpoint';
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
