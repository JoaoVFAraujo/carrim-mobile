import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, apiEndpoint } from './api-endpoint';
import { CredentialVault } from './credential-vault';

interface Identity {
  installationId: string;
  installationSecret: string;
  userId?: string;
  accessToken?: string;
  expiresAt?: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secret = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const token = /^carrim_[A-Za-z0-9_-]{43}$/;

@Injectable({ providedIn: 'root' })
export class AnonymousIdentityService {
  private readonly vault = inject(CredentialVault);
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly base = inject(API_BASE_URL);
  private pending: Promise<string> | null = null;

  accessToken(rejectedToken?: string): Promise<string> {
    if (this.pending) {
      if (!rejectedToken) return this.pending;
      // A pending vault lookup may return the rejected cached token. Wait for it,
      // then join/start renewal instead of replaying that invalid credential.
      return this.pending.then((value) =>
        value === rejectedToken ? this.accessToken(rejectedToken) : value,
      );
    }
    this.pending = this.obtain(rejectedToken).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async obtain(rejectedToken?: string): Promise<string> {
    const url = apiEndpoint(this.base, '/auth/anonymous');
    const stored = await this.vault.read();
    let identity: Identity;
    if (stored !== null) {
      try {
        identity = JSON.parse(stored) as Identity;
        if (
          !identity ||
          typeof identity.installationId !== 'string' ||
          !uuid.test(identity.installationId) ||
          typeof identity.installationSecret !== 'string' ||
          !secret.test(identity.installationSecret) ||
          (identity.userId !== undefined &&
            (typeof identity.userId !== 'string' || !uuid.test(identity.userId)))
        )
          throw new Error();
      } catch {
        // Never silently replace a damaged identity and associate existing purchases with another owner.
        throw new Error('A identidade salva precisa ser recuperada antes de conectar.');
      }
    } else {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const proof = btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
      identity = { installationId: crypto.randomUUID(), installationSecret: proof };
      // Persist proof before HTTP: the same owner can be recovered after a lost response.
      await this.vault.write(JSON.stringify(identity));
    }
    if (
      identity.userId &&
      typeof identity.accessToken === 'string' &&
      token.test(identity.accessToken) &&
      typeof identity.expiresAt === 'string' &&
      Date.parse(identity.expiresAt) > Date.now() + 60_000 &&
      identity.accessToken !== rejectedToken
    ) {
      return identity.accessToken;
    }
    let response: unknown;
    try {
      response = await firstValueFrom(
        this.http.post<unknown>(
          url,
          {
            installationId: identity.installationId,
            installationSecret: identity.installationSecret,
            devicePlatform: Capacitor.getPlatform().toUpperCase(),
            appVersion: '0.0.2',
          },
          { credentials: 'omit', redirect: 'error', cache: 'no-store', timeout: 15_000 },
        ),
      );
    } catch {
      // HttpErrorResponse contains the response body; do not expose it to UI/global logging.
      throw new Error('Não foi possível conectar com segurança. Tente novamente.');
    }
    const value = response as Partial<Identity> & { accountType?: string };
    if (
      !value ||
      value.installationId !== identity.installationId ||
      typeof value.userId !== 'string' ||
      !uuid.test(value.userId) ||
      (identity.userId && value.userId !== identity.userId) ||
      value.accountType !== 'ANONYMOUS' ||
      typeof value.accessToken !== 'string' ||
      !token.test(value.accessToken) ||
      typeof value.expiresAt !== 'string' ||
      !(Date.parse(value.expiresAt) > Date.now() + 60_000)
    ) {
      throw new Error('A resposta de identidade da API é inválida.');
    }
    identity = {
      ...identity,
      userId: value.userId,
      accessToken: value.accessToken,
      expiresAt: value.expiresAt,
    };
    await this.vault.write(JSON.stringify(identity));
    return value.accessToken;
  }
}
