import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const assets = join(dirname(fileURLToPath(import.meta.url)), '../dist/carrim-photo-admin/browser');
const upstream = 'https://carrim-api.onrender.com';
const photos = '/api/v1/photo-admin/photos';
const item =
  /^\/api\/v1\/photo-admin\/photos\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/(content|decision)$/i;
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css' };

let wakeRequest;
let lastReady = 0;

function wakeApi() {
  if (Date.now() - lastReady < 10000) return Promise.resolve(true);
  wakeRequest ??= fetch(new URL('/healthz', upstream), {
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
  })
    .then(async (response) => {
      const ready = response.status === 200 && (await response.json())?.status === 'UP';
      if (ready) lastReady = Date.now();
      return ready;
    })
    .catch(() => false)
    .finally(() => {
      wakeRequest = undefined;
    });
  return wakeRequest;
}
async function proxy(req, res, url) {
  const action = item.exec(url.pathname)?.[1];
  const list = url.pathname === photos;
  if ((!list && !action) || req.method !== (action === 'decision' ? 'POST' : 'GET')) {
    return res.writeHead(404).end();
  }

  const key = req.headers['x-carrim-photo-admin'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    return res.writeHead(401).end();
  }
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
    return res.writeHead(403).end();
  }

  const target = new URL(url.pathname, upstream);
  if (list) {
    for (const name of ['status', 'limit', 'offset']) {
      const value = url.searchParams.get(name);
      if (value !== null) target.searchParams.set(name, value);
    }
  }
  const headers = { 'X-Carrim-Photo-Admin': key };
  let body;
  if (action === 'decision') {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
      return res.writeHead(415).end();
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 4096) return res.writeHead(413, { Connection: 'close' }).end();
      chunks.push(chunk);
    }
    headers['Content-Type'] = 'application/json';
    body = Buffer.concat(chunks);
  }
  const response = await fetch(target, {
    method: req.method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(120000),
  });
  const type = response.headers.get('content-type')?.split(';')[0];
  if (
    (response.status >= 300 && response.status < 400) ||
    !['application/json', 'application/problem+json', 'image/jpeg', undefined].includes(type) ||
    (response.ok &&
      response.status !== 204 &&
      type !== (action === 'content' ? 'image/jpeg' : 'application/json'))
  ) {
    await response.body?.cancel();
    return res.writeHead(502).end();
  }
  if (type) res.setHeader('Content-Type', type);
  res.writeHead(response.status);
  if (response.body) await pipeline(Readable.fromWeb(response.body), res);
  else res.end();
}

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return res.writeHead((await wakeApi()) ? 200 : 503).end();
    }
    if (url.pathname.startsWith('/api/')) return await proxy(req, res, url);
    if (req.method !== 'GET') return res.writeHead(405).end();
    if (url.pathname === '/healthz') return res.end('ok');
    const file = ['/', '/admin/fotos'].includes(url.pathname)
      ? 'index.html'
      : /^\/[\w.-]+\.(?:js|css)$/.test(url.pathname) && url.pathname.slice(1);
    if (!file) return res.writeHead(404).end();
    const path = join(assets, file);
    if (!(await stat(path).catch(() => null))?.isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', types[file.split('.').at(-1)]);
    await pipeline(createReadStream(path), res);
  } catch {
    if (res.headersSent) res.destroy();
    else res.writeHead(502).end();
  }
});
server.requestTimeout = 15000;
server.listen(Number(process.env.PORT ?? 4210), '0.0.0.0');
