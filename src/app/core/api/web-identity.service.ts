import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DatabaseService } from '../database/database.service';
import { API_BASE_URL, apiEndpoint } from './api-endpoint';
import { authenticationUnavailable } from './authentication-unavailable.error';

interface WebIdentity {
  installationId: string;
  userId: string;
  accessToken: string;
  expiresAt: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Proof stays in an HttpOnly cookie; Bearer stays in this service's memory only. */
@Injectable({ providedIn: 'root' })
export class WebIdentityService {
  private readonly db = inject(DatabaseService);
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly base = inject(API_BASE_URL);
  private cached?: WebIdentity;
  private pending?: Promise<string>;

  accessToken(rejectedToken?: string): Promise<string> {
    if (this.pending)
      return this.pending.then((token) =>
        token === rejectedToken ? this.accessToken(rejectedToken) : token,
      );
    this.pending = this.obtain(rejectedToken).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async obtain(rejectedToken?: string): Promise<string> {
    if (this.base !== '/api/v1') throw new Error('A conexão web exige API na mesma origem.');
    const rows = await this.db.query<{ value: string }>(
      'SELECT value FROM app_metadata WHERE key=?',
      ['sync_owner'],
    );
    let owner: { installationId: string; userId: string } | undefined;
    if (rows.length) {
      try {
        owner = JSON.parse(rows[0].value);
        if (!owner || !uuid.test(owner.installationId) || !uuid.test(owner.userId))
          throw new Error();
      } catch {
        throw new Error('O vínculo das compras precisa ser recuperado antes de sincronizar.');
      }
    }
    if (
      this.cached &&
      this.cached.accessToken !== rejectedToken &&
      Date.parse(this.cached.expiresAt) > Date.now() + 60_000
    ) {
      await this.db.verifySyncOwner(this.cached.installationId, this.cached.userId, true);
      return this.cached.accessToken;
    }
    const options = {
      headers: { 'X-Carrim-Web': '1' },
      credentials: 'same-origin' as const,
      redirect: 'error' as const,
      cache: 'no-store' as const,
      timeout: 15_000,
    };
    try {
      const prepared = await firstValueFrom(
        this.http.post<{ installationId: string }>(
          apiEndpoint(this.base, '/auth/web/prepare'),
          { installationId: owner?.installationId ?? null },
          options,
        ),
      );
      if (
        !uuid.test(prepared?.installationId) ||
        (owner && owner.installationId !== prepared.installationId)
      )
        throw new Error();
      await this.db.verifySyncOwner(prepared.installationId, owner?.userId);
      const value = await firstValueFrom(
        this.http.post<WebIdentity & { accountType: string }>(
          apiEndpoint(this.base, '/auth/web/token'),
          { installationId: prepared.installationId },
          options,
        ),
      );
      if (
        !value ||
        value.installationId !== prepared.installationId ||
        !uuid.test(value.userId) ||
        (owner && value.userId !== owner.userId) ||
        value.accountType !== 'ANONYMOUS' ||
        !/^carrim_[A-Za-z0-9_-]{43}$/.test(value.accessToken) ||
        !(Date.parse(value.expiresAt) > Date.now() + 60_000)
      )
        throw new Error();
      await this.db.verifySyncOwner(value.installationId, value.userId, true);
      this.cached = value;
      return value.accessToken;
    } catch (error) {
      const unavailable = authenticationUnavailable(error);
      if (unavailable) throw unavailable;
      // eslint-disable-next-line preserve-caught-error -- Original HTTP errors may contain credentials and response bodies.
      throw new Error('Não foi possível confirmar a conexão. As compras locais foram preservadas.');
    }
  }
}
