// Test-only static server. Does not rewrite or inject anything into the application.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../kartochnaya v0.45/', import.meta.url)));
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8',
};
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end(); return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = await realpath(resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`));
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const data = await readFile(path);
    response.writeHead(200, {
      'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(4173, '127.0.0.1', () => console.log('Read-only test server listening on port 4173'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
