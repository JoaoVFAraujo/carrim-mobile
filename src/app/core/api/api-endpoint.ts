import { InjectionToken, isDevMode } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/** Native/release integration stays disabled until an HTTPS API is configured. */
export const API_BASE_URL = new InjectionToken<string | null>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => (isDevMode() && !Capacitor.isNativePlatform() ? '/api/v1' : null),
});

export function apiEndpoint(base: string | null, path: string): string {
  if (!base) throw new Error('Conexão com a API ainda não configurada.');
  if (!/^\/[a-zA-Z0-9/-]+$/.test(path) || path.includes('//') || path.includes('..')) {
    throw new Error('Caminho da API inválido.');
  }
  if (base !== '/api/v1') {
    const url = new URL(base);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/api/v1'
    ) {
      throw new Error('A API exige um endereço HTTPS sem credenciais.');
    }
  }
  return base + path;
}
