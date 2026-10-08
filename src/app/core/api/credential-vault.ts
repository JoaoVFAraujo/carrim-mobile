import { Injectable, InjectionToken, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

export const NATIVE_CREDENTIAL_STORAGE = new InjectionToken<
  Pick<typeof SecureStorage, 'get' | 'set'>
>('NATIVE_CREDENTIAL_STORAGE', {
  providedIn: 'root',
  factory: () => ({
    get: SecureStorage.get.bind(SecureStorage),
    set: SecureStorage.set.bind(SecureStorage),
  }),
});

/** Never invoke the plugin's plaintext web implementation. */
@Injectable({ providedIn: 'root' })
export class CredentialVault {
  private readonly native = inject(NATIVE_CREDENTIAL_STORAGE);
  private memory: string | null = null;
  private readonly key = 'br.com.carrim.identity.v1';

  async read(): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) return this.memory;
    try {
      const value = await this.native.get(this.key, false, false);
      if (value !== null && typeof value !== 'string') throw new Error();
      return value;
    } catch {
      throw new Error('Não foi possível acessar a identidade protegida.');
    }
  }

  async write(value: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      this.memory = value;
      return;
    }
    try {
      await this.native.set(
        this.key,
        value,
        false,
        false,
        KeychainAccess.whenUnlockedThisDeviceOnly,
      );
    } catch {
      throw new Error('Não foi possível salvar a identidade protegida.');
    }
  }
}
