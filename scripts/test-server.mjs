// Test-only static server. Does not rewrite or inject anything into the application.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve actual distributions, never the historical release directory.
const archive = await readFile(fileURLToPath(new URL('../dist/kartochnaya-pwa.zip', import.meta.url)));
const assets = new Map();
let offset = 0;
while (archive.readUInt32LE(offset) === 0x04034b50) {
  if (archive.readUInt16LE(offset + 8) !== 0) throw new Error('Expected STORE ZIP');
  const size = archive.readUInt32LE(offset + 18);
  const length = archive.readUInt16LE(offset + 26);
  const extra = archive.readUInt16LE(offset + 28);
  const name = archive.subarray(offset + 30, offset + 30 + length).toString('utf8');
  const start = offset + 30 + length + extra;
  assets.set('/' + name, archive.subarray(start, start + size));
  offset = start + size;
}
assets.set('/standalone/kartochnaya.html', await readFile(fileURLToPath(new URL('../dist/kartochnaya.html', import.meta.url))));
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
    const path = pathname === '/' ? '/index.html' : pathname;
    const data = assets.get(path);
    if (!data) { response.writeHead(404).end(); return; }
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
