export function apiEndpoint(base: string | null, path: string): string {
  if (!base) throw new Error('Conexão com a API ainda não configurada.');
  if (!/^\/[a-zA-Z0-9/-]+$/.test(path) || path.includes('//') || path.includes('..')) {
    throw new Error('Caminho da API inválido.');
  }
  let normalized = base;
  if (base !== '/api/v1') {
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new Error('Endereço da API inválido.');
    }
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
    normalized = url.href;
  }
  return normalized + path;
}
