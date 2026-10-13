import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { DatabaseService } from '../database/database.service';
import { AnonymousIdentityService } from './anonymous-identity.service';
import { CredentialVault } from './credential-vault';

/** Mandatory identity boundary for the future outbox worker, including token renewal. */
@Injectable({ providedIn: 'root' })
export class SyncIdentityService {
  private readonly database = inject(DatabaseService);
  private readonly vault = inject(CredentialVault);
  private readonly identity = inject(AnonymousIdentityService);

  async accessToken(rejectedToken?: string): Promise<string> {
    if (!Capacitor.isNativePlatform())
      throw new Error('A sincronização exige identidade persistente protegida neste dispositivo.');
    const previous = await this.readIdentity();
    // Check before bootstrap: missing/replaced credentials must not create a new owner
    // for a database already bound to an installation.
    await this.database.verifySyncOwner(previous?.installationId ?? '', previous?.userId);
    const token = await this.identity.accessToken(rejectedToken);
    const current = await this.readIdentity();
    if (!current?.userId || current.accessToken !== token)
      throw new Error('Não foi possível confirmar a identidade para sincronizar.');
    await this.database.verifySyncOwner(current.installationId, current.userId, true);
    return token;
  }

  private async readIdentity(): Promise<{
    installationId: string;
    userId?: string;
    accessToken?: string;
  } | null> {
    const stored = await this.vault.read();
    if (stored === null) return null;
    try {
      const value = JSON.parse(stored);
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (
        !value ||
        !uuid.test(value.installationId) ||
        (value.userId !== undefined && !uuid.test(value.userId))
      )
        throw new Error();
      return value;
    } catch {
      throw new Error('A identidade salva precisa ser recuperada antes de sincronizar.');
    }
  }
}
