import { HttpBackend, HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, apiEndpoint } from './api-endpoint';
import { AnonymousIdentityService } from './anonymous-identity.service';

/** Read-only first step. Outbox mutations require their own idempotency strategy. */
@Injectable({ providedIn: 'root' })
export class CarrimApiService {
  private readonly base = inject(API_BASE_URL);
  private readonly identity = inject(AnonymousIdentityService);
  private readonly http = new HttpClient(inject(HttpBackend));

  async get<T>(path: string, params?: HttpParams): Promise<T> {
    const url = apiEndpoint(this.base, path);
    const accessToken = await this.identity.accessToken();
    try {
      return await this.read<T>(url, accessToken, params);
    } catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401)
        // Do not retain HttpErrorResponse as cause: it contains the server body and request URL.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('Não foi possível consultar a API.');
    }
    const renewed = await this.identity.accessToken(accessToken);
    try {
      return await this.read<T>(url, renewed, params);
    } catch {
      throw new Error('Não foi possível consultar a API após renovar a conexão.');
    }
  }

  private read<T>(url: string, accessToken: string, params?: HttpParams): Promise<T> {
    return firstValueFrom(
      this.http.get<T>(url, {
        params,
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        timeout: 15_000,
      }),
    );
  }
}
