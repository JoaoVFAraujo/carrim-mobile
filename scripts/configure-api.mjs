import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.CARRIM_API_URL;
if (!base) throw new Error('Informe CARRIM_API_URL com HTTPS e caminho /api/v1.');
const url = new URL(base);
if (
  url.protocol !== 'https:' ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== '/api/v1'
)
  throw new Error('A API exige HTTPS sem credenciais, query ou fragmento e caminho /api/v1.');
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../public/api-config.json', import.meta.url),
  JSON.stringify({ apiBaseUrl: base }) + '\n',
);
console.log('Configuração pública da API gerada. Execute build e cap sync antes de instalar.');
