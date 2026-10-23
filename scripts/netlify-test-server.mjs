// Read the real publish directory on every request, including during deploy tests.
import { createServer } from 'node:http';
import { readFile, cp, rm } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
// A deploy test mutates an isolated copy with exactly the publish directory layout.
const root = resolve('work/netlify-site');
await rm(root, { recursive: true, force: true });
await cp(resolve('dist/netlify'), root, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const url = new URL(request.url, 'http://localhost');
    const filename = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filename.startsWith(root + sep) || ['_headers'].includes(filename.slice(root.length + 1))) throw Error('Not public');
    const bytes = await readFile(filename);
    const headers = { 'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    // Apply exact-path production headers, including the callback CSP, in tests.
    const rules = (await readFile(resolve(root, '_headers'), 'utf8')).split('\n');
    let applies = false;
    for (const line of rules) {
      if (line.startsWith('/')) applies = line === url.pathname;
      else if (applies && line.startsWith('  ')) { const split = line.indexOf(':'); headers[line.slice(2, split)] = line.slice(split + 1).trim(); }
    }
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404).end(); }
});
server.listen(4174, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
