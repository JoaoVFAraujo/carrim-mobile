import { apiEndpoint } from './api-endpoint-validation';

let configured: string | null = null;
export function configuredApi(): string | null {
  return configured;
}
export function setApiConfiguration(value: unknown): void {
  if (value === null) {
    configured = null;
    return;
  }
  if (typeof value !== 'string') throw new Error('Configuração da API inválida.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Configuração da API inválida.');
  }
  if (url.protocol !== 'https:') throw new Error('Configuração da API inválida.');
  apiEndpoint(url.href, '/auth/me');
  configured = url.href;
}
export async function loadApiConfiguration(): Promise<void> {
  try {
    const response = await fetch(new URL('api-config.json', document.baseURI), {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const config = await response.json();
    setApiConfiguration(config.apiBaseUrl);
  } catch {
    configured = null;
  }
}
