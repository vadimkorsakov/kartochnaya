const { createServer } = require('node:http');
const { readFile, mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test: base, expect } = require('@playwright/test');
const { openHome, createDocument, addShape, exportPNG } = require('./helpers');
const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const errors = [], expectedWarnings = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (message.location().url.endsWith('/favicon.ico') && message.text().includes('404')) return;
      // Unchanged HTML attempts ./sw.js under HTTP. A standalone directory has
      // no worker; this exact browser diagnostic is recorded, not an editor failure.
      if (testInfo.title.startsWith('built standalone HTTP:') && message.text() === 'A bad HTTP response code (404) was received when fetching the script.') {
        expectedWarnings.push(message.text()); return;
      }
      errors.push(message.text());
    });
    await use(page);
    if (expectedWarnings.length) await testInfo.attach('standalone-worker-warning', { body: expectedWarnings.join('\n'), contentType: 'text/plain' });
    expect(errors).toEqual([]);
  },
});
let server, origin, directory;
test.beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'kartochnaya-build-'));
  const archive = await readFile(path.join(__dirname, '../dist/kartochnaya-pwa.zip'));
  // Independently read the stored ZIP local entries for serving the actual output.
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    expect(archive.readUInt16LE(offset + 8)).toBe(0);
    const size = archive.readUInt32LE(offset + 18);
    const length = archive.readUInt16LE(offset + 26);
    const extra = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + length).toString('utf8');
    expect(name).not.toMatch(/(^\/|\.\.|\\)/);
    const start = offset + 30 + length + extra;
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, archive.subarray(start, start + size));
    offset = start + size;
  }
  server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const relative = url.startsWith('/nested/editor/') ? url.slice('/nested/editor/'.length) : url.slice(1);
      const file = url === '/standalone/kartochnaya.html'
        ? path.join(__dirname, '../dist/kartochnaya.html')
        : path.join(directory, relative || 'index.html');
      const data = await readFile(file);
      const mime = { '.html':'text/html', '.js':'text/javascript', '.webmanifest':'application/manifest+json', '.png':'image/png', '.svg':'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('built standalone HTTP: no external dependencies, document, shape, PNG', async ({ page }) => {
  const external = [];
  page.on('request', r => { if (new URL(r.url()).origin !== origin) external.push(r.url()); });
  await openHome(page, origin + '/standalone/kartochnaya.html');
  await createDocument(page); await addShape(page); await exportPNG(page);
  expect(external).toEqual([]);
});
for (const prefix of ['/', '/nested/editor/']) {
  test(`ZIP served at ${prefix}: original resources, KF-003, offline reload and editing`, async ({ page, context, request }) => {
    const baseline = require('../docs/baseline-v045.json');
    const { createHash } = require('node:crypto');
    for (const [name, expected] of Object.entries(baseline.files).filter(([n]) => n !== 'README.md')) {
      const response = await request.get(origin + prefix + name.split('/').map(encodeURIComponent).join('/'));
      expect(response.status()).toBe(200);
      if (name === 'index.html') {
        expect(await response.body()).toEqual(await readFile(path.join(__dirname, '../dist/kartochnaya.html')));
      } else {
        expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(expected.sha256);
      }
    }
    await openHome(page, origin + prefix);
    expect(await page.locator('link[rel="manifest"]').count(), 'KF-003 remains; installability is not claimed').toBe(0);
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated');
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).toBe(origin + prefix + 'sw.js');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#createTemplateBtn')).toBeVisible();
    await createDocument(page); await addShape(page); await exportPNG(page);
  });
}
test('built HTML file:// offline', async ({ page, context }, testInfo) => {
  await context.setOffline(true);
  try { await openHome(page, pathToFileURL(path.join(__dirname, '../dist/kartochnaya.html')).href); }
  catch (error) {
    if (!error.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR') || process.env.KARTOCHNAYA_REQUIRE_FILE_URL === '1') throw error;
    await testInfo.attach('ENV-001', { body: error.message, contentType: 'text/plain' });
    test.skip(true, 'ENV-001: administrator policy blocks file://');
  }
  await createDocument(page); await addShape(page); await exportPNG(page);
});
