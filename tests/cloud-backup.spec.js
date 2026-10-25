const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { unzipSync, strFromU8 } = require('fflate');
const { openHome, records } = require('./helpers');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function mock(context, options = {}) {
  const seen = { uploads: [], google: new Map(), yandex: [], current: 'A', links: 0, puts: 0 };
  await context.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{oauth2:{initTokenClient(c){return {requestAccessToken(){c.callback({access_token:'google-secret-'+(window.googlePicked||'A'),expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'})}}}}}};` }));
  await context.route('https://www.googleapis.com/**', async route => {
    const req = route.request(), u = new URL(req.url()), id = req.headers().authorization.replace('Bearer google-secret-', '');
    if (u.pathname.endsWith('/about')) return route.fulfill({ json: { user: { permissionId: id, displayName: 'Google ' + id } } });
    let cloud = seen.google.get(id); if (!cloud) seen.google.set(id, cloud = {});
    if (u.pathname === '/drive/v3/files') {
      if (req.method() === 'POST') { cloud.folder = { ...req.postDataJSON(), id: 'folder-' + id }; return route.fulfill({ json: cloud.folder }); }
      return route.fulfill({ json: { files: cloud.folder ? [cloud.folder] : [] } });
    }
    if (u.pathname === '/upload/drive/v3/files') {
      if (req.method() === 'POST') {
        if (options.failGoogle === id) return route.fulfill({ status: 403, json: {} });
        cloud.meta = req.postDataJSON(); return route.fulfill({ headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + id, 'Access-Control-Expose-Headers': 'Location, Range' }, body: '' });
      }
      const bytes = req.postDataBuffer(); seen.uploads.push({ id, bytes, filename: cloud.meta.name, properties: cloud.meta.appProperties });
      cloud.file = { ...cloud.meta, id: 'file-' + id, size: String(bytes.length) }; return route.fulfill({ status: 201, json: { id: cloud.file.id } });
    }
    if (u.pathname.endsWith('/folder-' + id)) return route.fulfill({ json: cloud.folder });
    return route.fulfill({ json: cloud.file });
  });
  await context.route('https://oauth.yandex.ru/authorize?*', route => route.fulfill({ contentType: 'text/html', body: '<p>Mock OAuth</p>' }));
  await context.route('https://oauth.yandex.ru/token', route => route.fulfill({ json: { access_token: 'yandex-secret', token_type: 'bearer', expires_in: 3600 } }));
  await context.route('https://login.yandex.ru/info', route => route.fulfill({ json: { id: seen.current } }));
  await context.route('https://cloud-api.yandex.net/v1/disk/resources**', async route => {
    const u = new URL(route.request().url()); expect(route.request().headers().authorization).toBe('OAuth yandex-secret');
    if (u.pathname.endsWith('/upload')) { seen.links++; seen.filename = u.searchParams.get('path').slice(5); expect(u.searchParams.get('overwrite')).toBe('false'); return route.fulfill({ json: { method: 'PUT', href: 'https://uploader1d.dst.yandex.net/batch' } }); }
    if (u.searchParams.get('path') === 'app:/') return route.fulfill({ json: { type: 'dir', path: 'app:/', _embedded: { items: seen.yandex, total: seen.yandex.length, offset: 0, limit: 100 } } });
    return route.fulfill({ json: seen.yandex[0] });
  });
  await context.route('https://uploader1d.dst.yandex.net/batch', async route => {
    const bytes = route.request().postDataBuffer(); expect(route.request().headers().authorization).toBeUndefined(); seen.puts++;
    seen.uploads.push({ id: 'yandex', bytes, filename: seen.filename });
    seen.yandex.push({ name: seen.filename, path: 'app:/' + seen.filename, type: 'file', size: bytes.length, created: new Date().toISOString(), sha256: hash(bytes) });
    if (options.uncertain) return route.abort('failed');
    if (options.hold) await options.hold();
    await route.fulfill({ status: 201, body: '' }).catch(() => {});
  });
  return seen;
}
async function setup(page, context, options = {}) {
  const seen = await mock(context, options); await openHome(page); await page.locator('#homeEditorBtn').click(); await page.locator('#documentTabsHome').click(); await page.locator('[data-home-nav=data]').click();
  await page.locator('#googleDriveCard').click(); await page.locator('#driveConfigure').click(); await page.locator('#driveClientId').fill('test.apps.googleusercontent.com'); await page.locator('#driveSave').click();
  for (const id of ['A', 'B']) { await page.evaluate(id => { window.googlePicked = id; }, id); await page.locator('#driveAdd').click(); await expect(page.locator('#driveConnect')).toHaveText('Подключить Google Drive'); await page.locator('#driveConnect').click(); await expect(page.locator('#driveAccounts')).toContainText('Google ' + id); }
  await page.locator('#googleDriveDialog [data-backup-close]').click();
  await page.locator('#yandexCard').click(); await page.locator('#yandexConfigure').click(); await page.locator('#yandexClientId').fill('a'.repeat(32)); await page.locator('#yandexSettings button[type=submit]').click();
  const popupPromise = page.waitForEvent('popup'); await page.locator('#yandexConnect').click(); const popup = await popupPromise; await popup.waitForURL('https://oauth.yandex.ru/authorize?*');
  const state = new URL(popup.url()).searchParams.get('state'); await popup.evaluate(url => location.replace(url), 'http://127.0.0.1:4174/oauth/yandex-callback.html?' + new URLSearchParams({ code: 'test-code', state })).catch(error => { if (!popup.isClosed()) throw error; });
  await expect(page.locator('#yandexStatus')).toContainText('Подключено в памяти'); await page.locator('#yandexDialog [data-backup-close]').click();
  // Count the existing consistent all-store snapshot transaction, never patch the editor.
  await page.evaluate(() => { window.batchSnapshots = 0; const transaction = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function(stores, mode, ...args) { if (mode === 'readonly' && Array.isArray(stores) && ['projects', 'docs', 'fonts', 'settings'].every(s => stores.includes(s))) window.batchSnapshots++; return transaction.call(this, stores, mode, ...args); }; });
  return seen;
}
for (const variant of ['all', 'google', 'yandex', 'local', 'partial-google', 'uncertain-yandex']) test('unified real clients: ' + variant, async ({ page, context }) => {
  const seen = await setup(page, context, { failGoogle: variant === 'partial-google' ? 'B' : null, uncertain: variant === 'uncertain-yandex' });
  const before = await records(page, 'docs'); await page.locator('#createBackups').click();
  if (['google', 'local'].includes(variant)) await page.locator('#cloudRecipients input[value=yandex]').uncheck();
  if (['yandex', 'local'].includes(variant)) for (const id of ['A', 'B']) await page.locator(`#cloudRecipients input[value="google:${id}"]`).uncheck();
  await page.locator('#cloudStart').click(); await expect(page.locator('#cloudFinish')).toBeEnabled(); await expect(page.locator('#cloudSave')).toBeVisible();
  const total = variant === 'local' ? 0 : variant === 'google' ? 2 : variant === 'yandex' ? 1 : 3;
  const confirmed = total - (variant.startsWith('partial') || variant.startsWith('uncertain') ? 1 : 0);
  if (total) await expect(page.locator('#cloudStatus')).toContainText(`Подтверждено ${confirmed} из ${total}`);
  const pending = page.waitForEvent('download'); await page.locator('#cloudSave').click(); const download = await pending; const bytes = await readFile(await download.path());
  const { readBackup } = await import('../src/backup/archive.mjs'); const archive = await readBackup(bytes);
  for (const upload of seen.uploads) { expect(upload.bytes.equals(bytes)).toBe(true); expect(upload.filename).toBe(download.suggestedFilename()); if (upload.properties) { expect(upload.properties.sha256).toBe(hash(bytes)); expect(upload.properties.backupId).toBe(archive.manifest.backupId); } }
  expect(await page.evaluate(() => window.batchSnapshots)).toBe(1); expect(archive.data.docs).toEqual(before);
  const all = Object.values(unzipSync(bytes)).map(strFromU8).join('\n'); for (const secret of ['google-secret', 'yandex-secret', 'apps.googleusercontent.com']) expect(all).not.toContain(secret);
  if (variant === 'uncertain-yandex') { await expect(page.locator('#cloudResultRows')).toContainText('Файл мог сохраниться'); expect(seen.puts).toBe(1); expect(seen.links).toBe(1); }
  await page.locator('#cloudFinish').click(); expect(await records(page, 'docs')).toEqual(before);
  await page.locator('#createBackups').click(); await expect(page.locator('#cloudStart')).toBeVisible(); await expect(page.locator('#cloudSave')).toBeHidden(); await page.locator('#cloudFinish').click();
  // Reservations released: existing provider dialogs remain usable.
  await page.locator('#googleDriveCard').click(); await expect(page.locator('#driveAdd')).toBeEnabled(); await page.locator('#googleDriveDialog [data-backup-close]').click();
  await page.locator('#yandexCard').click(); await page.locator('#yandexCopiesTab').click(); await expect(page.locator('#yandexRefresh')).toBeEnabled();
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) test(`unified cloud pagination and geometry ${viewport.width}x${viewport.height}`, async ({ page, context }) => {
  await page.setViewportSize(viewport); const seen = await setup(page, context); await page.locator('#createBackups').click();
  const checks = page.locator('#cloudRecipients input'); await expect(checks).toHaveCount(3); for (const check of await checks.all()) await expect(check).toBeChecked();
  if (viewport.width < 760) { await expect(page.locator('#cloudRecipients label:visible')).toHaveCount(1); await page.getByRole('navigation', { name: 'Получатели резервной копии', exact: true }).getByRole('button', { name: 'Следующая страница' }).click(); }
  await page.locator('#cloudStart').click(); await expect(page.locator('#cloudStatus')).toContainText('Подтверждено 3 из 3');
  const geometry = await page.locator('#cloudBackupDialog').evaluate(d => { const b = d.getBoundingClientRect(), a = d.querySelector('#cloudSave').getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, action: a.bottom, overflow: d.scrollWidth > d.clientWidth }; });
  expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.top).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(viewport.width); expect(geometry.bottom).toBeLessThanOrEqual(viewport.height); expect(geometry.action).toBeLessThanOrEqual(viewport.height); expect(geometry.overflow).toBe(false); expect(seen.uploads).toHaveLength(3);
  if (viewport.width < 760) await expect(page.locator('#cloudResultRows article:visible')).toHaveCount(1);
});

for (const reason of ['google', 'yandex', 'idb']) test('preparation invalidation: ' + reason, async ({ page, context }) => {
  const seen = await setup(page, context);
  await page.evaluate(reason => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(stores, mode, ...args) {
      if (mode === 'readonly' && Array.isArray(stores) && stores.length === 4) {
        if (reason === 'idb') throw Error('IndexedDB snapshot refused');
        // Save barrier intentionally blocks click events; emulate an OAuth lifecycle disconnect.
        document.getElementById(reason === 'google' ? 'driveDisconnect' : 'yandexDisconnect').onclick();
      }
      return transaction.call(this, stores, mode, ...args);
    };
  }, reason);
  await page.locator('#createBackups').click(); await page.locator('#cloudStart').click(); await expect(page.locator('#cloudFinish')).toBeEnabled();
  if (reason === 'idb') { await expect(page.locator('#cloudStatus')).toContainText('snapshot refused'); await expect(page.locator('#cloudSave')).toBeHidden(); expect(seen.uploads).toHaveLength(0); }
  else { await expect(page.locator('#cloudStatus')).toContainText('Подтверждено 2 из 3'); await expect(page.locator('#cloudResultRows')).toContainText('Требуется повторное подключение'); expect(seen.uploads.some(u => u.id === (reason === 'google' ? 'A' : 'yandex'))).toBe(false); }
});

test('cancel uncertain active Yandex PUT preserves confirmed Google copies and never retries', async ({ page, context }) => {
  let release; const gate = new Promise(r => { release = r; }); const seen = await setup(page, context, { hold: () => gate });
  await page.locator('#createBackups').click(); await page.locator('#cloudStart').click(); await expect.poll(() => seen.puts).toBe(1); await page.locator('#cloudCancel').click();
  await expect(page.locator('#cloudFinish')).toBeEnabled(); await expect(page.locator('#cloudStatus')).toContainText('Подтверждено 2 из 3'); await expect(page.locator('#cloudResultRows')).toContainText('Файл мог сохраниться');
  expect(seen.uploads.filter(u => u.id !== 'yandex')).toHaveLength(2); expect(seen.links).toBe(1); release(); await page.locator('#cloudFinish').click();
  await page.locator('#createBackups').click(); await expect(page.locator('#cloudStart')).toBeVisible(); expect(seen.puts).toBe(1);
});
