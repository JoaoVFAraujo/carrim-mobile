import { HttpBackend, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, apiEndpoint } from '../api/api-endpoint';
import { SyncIdentityService } from '../api/sync-identity.service';
import { authenticationUnavailable } from '../api/authentication-unavailable.error';
import { photoByteLimit } from './photo-models';

export class PhotoTransportError extends Error {
  constructor(readonly status: number) {
    super('Não foi possível sincronizar a foto agora.');
  }
  get transient(): boolean {
    return (
      this.status === 0 ||
      this.status === 404 ||
      this.status === 408 ||
      this.status === 429 ||
      this.status >= 500
    );
  }
}

@Injectable({ providedIn: 'root' })
export class PhotoTransportService {
  private readonly base = inject(API_BASE_URL);
  private readonly identity = inject(SyncIdentityService);
  private readonly http = new HttpClient(inject(HttpBackend));
  readonly enabled = !!this.base;

  async request(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: object,
    canContinue: () => boolean = () => true,
    params?: Record<string, string | number>,
  ): Promise<unknown> {
    return this.perform(method, path, body, false, canContinue, params);
  }

  async image(id: string, canContinue: () => boolean = () => true): Promise<string> {
    const blob = (await this.perform(
      'GET',
      '/products/photos/' + encodeURIComponent(id) + '/content',
      undefined,
      true,
      canContinue,
    )) as Blob;
    if (
      !(blob instanceof Blob) ||
      blob.size > photoByteLimit ||
      blob.size < 4 ||
      blob.type.split(';')[0] !== 'image/jpeg'
    )
      throw new PhotoTransportError(422);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
      throw new PhotoTransportError(422);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }

  private async perform(
    method: string,
    path: string,
    body: object | undefined,
    image: boolean,
    canContinue: () => boolean = () => true,
    params?: Record<string, string | number>,
  ): Promise<unknown> {
    if (!this.base || !canContinue()) throw new PhotoTransportError(0);
    const url = apiEndpoint(this.base, path);
    let token: string;
    try {
      token = await this.identity.accessToken();
    } catch (error) {
      throw this.identityFailure(error);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!canContinue()) throw new PhotoTransportError(0);
      try {
        const options = {
          body,
          params,
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          timeout: 15000,
        } as const;
        return image
          ? await firstValueFrom(
              this.http.request(method, url, { ...options, responseType: 'blob' }),
            )
          : await firstValueFrom(
              this.http.request(method, url, { ...options, responseType: 'json' }),
            );
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 401 && attempt === 0) {
          try {
            token = await this.identity.accessToken(token);
          } catch (error) {
            throw this.identityFailure(error);
          }
          continue;
        }
        throw new PhotoTransportError(error instanceof HttpErrorResponse ? error.status : 0);
      }
    }
    throw new PhotoTransportError(401);
  }

  private identityFailure(error: unknown): PhotoTransportError {
    const unavailable = authenticationUnavailable(error);
    if (unavailable) return new PhotoTransportError(unavailable.status);
    // Invalid proof, ownership, configuration and unknown local failures remain
    // closed. Never pass the identity response body or diagnostic text to UI.
    return new PhotoTransportError(403);
  }
}
