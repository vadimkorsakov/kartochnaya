const { test, expect } = require('@playwright/test');
const { readFile, writeFile, cp, rm, mkdir } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { openHome, createDocument, addShape, exportedDocument, records, savedDocument } = require('./helpers');
const root = resolve(__dirname, '..');
const site = join(root, 'work/netlify-site'), backup = join(root, 'work/netlify-original');
const sha = data => createHash('sha256').update(data).digest('hex');
async function ready(page) {
  await openHome(page);
  await expect(page.locator('#pwaStatus')).toHaveAttribute('data-offline-ready', 'true');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  return page.locator('#pwaStatus').getAttribute('data-version');
}
async function update(page, expected = 'installed') {
  return page.evaluate(async expected => {
    const registration = await navigator.serviceWorker.ready;
    const changed = new Promise(resolve => registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker.addEventListener('statechange', () => { if (worker.state === expected) resolve(worker.state); });
    }, { once: true }));
    await registration.update();
    return changed;
  }, expected);
}
async function deploy(name) {
  const source = join(root, 'work/netlify-source');
  await rm(source, { recursive: true, force: true }); await cp(join(root, 'src'), source, { recursive: true });
  const file = join(source, 'index.template.html');
  await writeFile(file, (await readFile(file, 'utf8')).replace('</head>', `<meta name="test-deploy" content="${name}"></head>`));
  execFileSync(process.execPath, ['--input-type=module', '-e', `import {buildNetlify} from './scripts/netlify.mjs'; await buildNetlify({sourceDirectory:${JSON.stringify(source)},outputDirectory:${JSON.stringify(site)}});`], { cwd: root });
}
test.beforeAll(async () => { await mkdir(join(root, 'work'), { recursive: true }); await rm(backup, { recursive: true, force: true }); await cp(site, backup, { recursive: true }); });
test.beforeEach(async () => { await rm(site, { recursive: true, force: true }); await cp(backup, site, { recursive: true }); });
test.afterAll(async () => { await rm(site, { recursive: true, force: true }); await cp(backup, site, { recursive: true }); });

test('manifest, installability, exact resources and complete verified precache', async ({ page, request, context, playwright }) => {
  const external = []; context.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4174/') && /^https?:/.test(req.url())) external.push(req.url()); });
  await ready(page);
  const href = await page.locator('link[rel=manifest]').getAttribute('href'); expect(href).toBe('./manifest.webmanifest');
  const response = await request.get(href); expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' }); expect(manifest.name).toContain('Карточная');
  expect(manifest.icons.map(x => x.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  const sums = JSON.parse(await readFile(join(site, 'SHA256SUMS.json')));
  for (const [name, hash] of Object.entries(sums)) {
    expect(sha(await readFile(join(site, name)))).toBe(hash);
    if (name === '_headers') continue;
    const res = await request.get('/' + name); expect(res.status(), name).toBe(200); expect(sha(await res.body())).toBe(hash);
  }
  const cached = await page.evaluate(async () => {
    const name = (await caches.keys()).find(x => x.startsWith('kartochnaya-netlify-'));
    return (await (await caches.open(name)).keys()).map(x => decodeURIComponent(new URL(x.url).pathname));
  });
  for (const name of Object.keys(sums).filter(x => !['sw.js', '_headers', 'oauth/yandex-callback.html'].includes(x))) expect(cached).toContain('/' + name);
  // Installation is unavailable in incognito contexts: use a real persistent profile.
  const installed = await playwright.chromium.launchPersistentContext(test.info().outputPath('install-profile'), {
    headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  try {
    const installPage = installed.pages()[0]; await installPage.goto('http://127.0.0.1:4174/');
    await expect(installPage.locator('#pwaStatus')).toHaveAttribute('data-offline-ready', 'true');
    const cdp = await installed.newCDPSession(installPage); await cdp.send('Page.enable');
    expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
  } finally { await installed.close(); }
  await createDocument(page, 'No external network'); await addShape(page); expect((await exportedDocument(page)).elements).toHaveLength(1);
  expect(external).toEqual([]);
});

test('offline reload, editing, IndexedDB, JSON/ZIP export/import and reopening a new window', async ({ page, context }) => {
  await ready(page); await context.setOffline(true); await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  await createDocument(page, 'Offline document'); await addShape(page);
  const doc = await savedDocument(page, 'Offline document', 1);
  expect((await exportedDocument(page)).elements).toHaveLength(1);
  const pending = page.waitForEvent('download'); await page.locator('#documentTabsHome').click(); await page.locator('[data-home-nav=data]').click();
  await page.locator('#zipStorage').click(); await expect(page.locator('#zipConfirm')).toBeEnabled();
  await page.locator('#zipConfirm').click(); const zip = await readFile(await (await pending).path());
  expect(zip.readUInt32LE()).toBe(0x04034b50);
  await page.locator('#zipCancel').click();
  const payload = { format: 'kartochnaya-v1', document: doc };
  await page.locator('#jsonInput').setInputFiles({ name: 'offline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
  await expect.poll(async () => (await records(page, 'docs')).length).toBeGreaterThan(1);
  const next = await context.newPage(); await page.close(); await ready(next);
  expect((await records(next, 'docs')).find(x => x.id === doc.id).elements).toHaveLength(1);
  await next.locator('#zipInput').setInputFiles({ name: 'offline.zip', mimeType: 'application/zip', buffer: zip });
  await expect(next.locator('#zipConfirm')).toBeEnabled(); await next.locator('#zipConfirm').click();
  await expect(next.locator('#zipStatus')).toContainText('Транзакция завершена');
  expect((await records(next, 'docs')).some(x => x.id !== doc.id && x.elements.length === 1)).toBe(true);
});

test('complete update waits for explicit click, saves pending edits and retains IndexedDB', async ({ page, context }) => {
  const old = await ready(page); await createDocument(page, 'Update document'); await addShape(page);
  const doc = await savedDocument(page, 'Update document', 1);
  const other = await context.newPage(); await ready(other);
  await createDocument(other, 'Other window'); await addShape(other);
  await savedDocument(other, 'Other window', 1);
  await deploy('next'); await update(page);
  await expect(page.locator('#pwaStatus')).toContainText('Доступна новая версия');
  expect(await page.locator('meta[name=test-deploy]').count()).toBe(0);
  await addShape(page); // Do not wait for debounce; update must confirm this save.
  await page.locator('#pwaUpdate').click();
  await expect(page.locator('meta[name=test-deploy]')).toHaveAttribute('content', 'next');
  await expect(page.locator('#pwaStatus')).toHaveAttribute('data-offline-ready', 'true');
  expect(await page.locator('#pwaStatus').getAttribute('data-version')).not.toBe(old);
  expect((await records(page, 'docs')).find(x => x.id === doc.id).elements).toHaveLength(2);
  // The other open editor must retain its view even when the controller changes.
  await expect(other.locator('#projectTitle')).toContainText('Other window');
  expect(await other.locator('meta[name=test-deploy]').count()).toBe(0);
  await other.close();
  await context.setOffline(true); await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  expect((await records(page, 'docs')).find(x => x.id === doc.id).elements).toHaveLength(2);
});

test('failed candidate integrity leaves old active worker and complete cache available offline', async ({ page, context }) => {
  const old = await ready(page); await createDocument(page, 'Survivor'); await addShape(page); const doc = await savedDocument(page, 'Survivor', 1);
  await deploy('broken'); await writeFile(join(site, 'icon-512.png'), Buffer.from('truncated deployment'));
  await update(page, 'redundant');
  expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).toContain('/sw.js');
  const keys = await page.evaluate(() => caches.keys()); expect(keys.filter(x => x.startsWith('kartochnaya-netlify-'))).toEqual(['kartochnaya-netlify-' + old]);
  await context.setOffline(true); await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  expect(await page.locator('meta[name=test-deploy]').count()).toBe(0);
  expect((await records(page, 'docs')).find(x => x.id === doc.id).elements).toHaveLength(1);
  await expect(page.locator('#pwaStatus')).toHaveAttribute('data-version', old);
});

test('save failure postpones update and keeps editing state', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (window.failUpdateSave && this.name === 'docs') throw Error('Test save failure'); return put.apply(this, args); };
  });
  await ready(page); await createDocument(page, 'Keep unsaved'); await addShape(page); await savedDocument(page, 'Keep unsaved', 1);
  await deploy('save-failure'); await update(page); await page.evaluate(() => { window.failUpdateSave = true; });
  await addShape(page); await page.locator('#pwaUpdate').click();
  await expect(page.locator('#pwaStatus')).toContainText('Обновление отложено');
  expect(await page.locator('meta[name=test-deploy]').count()).toBe(0);
  expect((await exportedDocument(page)).elements).toHaveLength(2);
});

test('modified HTTP HTML fails integrity visibly and retries safely without clearing caches', async ({ page, context }) => {
  const filename = join(site, 'index.html');
  const original = await readFile(filename);
  // Model a host changing only the response HTML after SHA256SUMS generation.
  await writeFile(filename, Buffer.concat([original, Buffer.from('\n<!-- host mutation -->')]));
  await page.goto('/');
  await expect(page.locator('#pwaStatus')).toContainText('Не удалось установить');
  await expect(page.locator('#pwaRetry')).toBeEnabled();
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(x => x.length))).toBe(0);
  await page.evaluate(async () => { await (await caches.open('unrelated-working-cache')).put('/keep', new Response('keep')); });
  await writeFile(filename, original);
  await page.locator('#pwaRetry').click();
  await expect(page.locator('#pwaStatus')).toHaveAttribute('data-offline-ready', 'true');
  expect(await page.evaluate(() => caches.has('unrelated-working-cache'))).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
});

test('stalled registration stops preparation after deadline and offers retry', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await openHome(page);
  await expect(page.locator('#pwaStatus')).toContainText('Подготовка');
  await page.clock.runFor(30001);
  await expect(page.locator('#pwaStatus')).toContainText('30 секунд');
  await expect(page.locator('#pwaRetry')).toBeEnabled();
});

// Cloud integrations are installed only in the Netlify distribution.
for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) test(`UI-2: three compact rows, dialogs and viewport bounds ${viewport.width}x${viewport.height}`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(viewport); await openHome(page);
  await page.locator('#homeEditorBtn').click(); await page.locator('#documentTabsHome').click(); await page.locator('[data-home-nav=data]').click();
  const before = {};
  for (const store of ['projects', 'docs', 'fonts', 'settings']) before[store] = await records(page, store);
  await expect(page.locator('#homeDataPane h1')).toHaveText('Резервные копии');
  const rows = page.locator('#homeDataPane .home-data-card'); await expect(rows).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('backup-list.png') });
  const initial = await rows.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { height: r.height, top: r.top, bottom: r.bottom }; }));
  for (const row of initial) { expect(row.height).toBeGreaterThanOrEqual(88); expect(row.height).toBeLessThanOrEqual(104); }
  expect(initial[1].top).toBeGreaterThan(initial[0].bottom); expect(initial[2].top).toBeGreaterThan(initial[1].bottom);
  for (const [opener, dialog, status] of [['zipStorage', 'zipBackupDialog', 'zipStatus'], ['googleDriveCard', 'googleDriveDialog', 'driveStatus'], ['yandexCard', 'yandexDialog', 'yandexStatus']]) {
    const row = page.locator('#' + opener), modal = page.locator('#' + dialog);
    await row.focus(); await page.keyboard.press('Enter'); await expect(modal).toBeVisible();
    if (dialog === 'zipBackupDialog') await expect(page.locator('#zipConfirm')).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath(dialog + '.png') });
    if (dialog === 'googleDriveDialog') {
      await page.locator('#driveCreateTab').click(); await expect(page.locator('#driveCreateSelected')).toBeVisible();
      const bottom = await page.locator('#driveCreateSelected').evaluate(node => node.getBoundingClientRect().bottom); expect(bottom).toBeLessThanOrEqual(viewport.height);
      await page.locator('#driveCopiesTab').click(); await page.locator('#driveAccountsTab').click();
      await page.locator('#driveConfigure').click(); await page.locator('#driveClientId').fill('invalid'); await page.locator('#driveSave').click();
      await expect(page.locator('#driveSettingsError')).toBeVisible(); await page.locator('#driveCancel').click();
    }
    if (dialog === 'yandexDialog') {
      await page.locator('#yandexDiagnosticsTab').click(); await expect(page.locator('#yandexTransfer')).toBeVisible();
      const bottom = await page.locator('#yandexTransfer').evaluate(node => node.getBoundingClientRect().bottom); expect(bottom).toBeLessThanOrEqual(viewport.height);
      await page.locator('#yandexConnectionTab').click(); await page.locator('#yandexConfigure').click();
      await page.locator('#yandexClientId').fill('invalid'); await page.locator('#yandexSettings button[type=submit]').click();
      await expect(page.locator('#yandexSettingsError')).toBeVisible(); await page.locator('#yandexCancel').click();
    }
    await page.locator('#' + status).evaluate(node => { node.textContent = 'Ошибка: длинный ответ сервера '.repeat(100); });
    const geometry = await modal.evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, horizontal: node.scrollWidth > node.clientWidth, vertical: node.scrollHeight > node.clientHeight }; });
    expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(viewport.width); expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
    expect(geometry.horizontal, dialog).toBe(false); expect(geometry.vertical, dialog).toBe(false);
    await page.keyboard.press('Escape'); await expect(modal).toBeHidden(); await expect(row).toBeFocused();
    await row.click(); await expect(modal).toBeVisible();
    if (dialog === 'zipBackupDialog') await expect(page.locator('#zipConfirm')).toBeEnabled();
    await modal.locator('[data-backup-close]').click(); await expect(row).toBeFocused();
  }
  expect(await rows.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))).toEqual(initial.map(row => row.height));
  await expect(page.locator('#yandexCard')).toContainText('Резервные ZIP-копии в папке приложения');
  await expect(page.locator('button:visible').filter({ hasText: /JSON/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const store of Object.keys(before)) expect(await records(page, store)).toEqual(before[store]);
  expect(errors).toEqual([]);
});

test('Netlify keeps ZIP restore bridge module-local and the local dialog available without OAuth', async ({ page }) => {
  const cloudRequests = []; page.on('request', r => { if (/yandex|googleapis/.test(r.url())) cloudRequests.push(r.url()); });
  await openHome(page); await page.locator('[data-home-nav=data]').click();
  await page.locator('#zipStorage').click(); await expect(page.locator('#zipConfirm')).toBeEnabled();
  await page.locator('#zipRestore').click(); await expect(page.locator('#zipOpen')).toBeVisible();
  expect(await page.evaluate(() => [typeof window.backupRestore, typeof window.zipBackupUI])).toEqual(['undefined', 'undefined']);
  await page.locator('#zipCancel').click(); await page.locator('#yandexCard').click(); await page.locator('#yandexCopiesTab').click();
  await expect(page.locator('#yandexSave')).toBeDisabled(); await expect(page.locator('#yandexRestore')).toBeDisabled(); expect(cloudRequests).toEqual([]);
});
