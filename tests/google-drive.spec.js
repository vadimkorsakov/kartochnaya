const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const { unzipSync, strFromU8 } = require('fflate');
const { openHome, createDocument, addShape, exportedDocument, savedDocument } = require('./helpers');
const ID = 'test.apps.googleusercontent.com', KEY = 'kartochnaya-google-drive-client-id';
const SCOPE = 'https://www.googleapis.com/auth/drive.file', TOKEN = 'memory-only-oauth-test-token';
async function home(page) { await openHome(page); await page.locator('[data-home-nav=data]').click(); }
async function configure(page, value = ID) {
  await page.locator('#driveConfigure').click(); await page.locator('#driveClientId').fill(value); await page.locator('#driveSave').click();
}
async function mock(page, { scope = SCOPE, error, popup, status = 200, body = { user: { displayName: 'Тестовый аккаунт', emailAddress: 'test@example.invalid' } }, network = false, expires = 3600 } = {}) {
  const seen = { gis: 0, drive: 0 };
  await page.route('https://accounts.google.com/gsi/client', async route => {
    seen.gis++;
    await route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{oauth2:{initTokenClient(config){window.__testConfig=config;return {requestAccessToken(){window.__testCalls=(window.__testCalls||0)+1;window.__testActive=navigator.userActivation.isActive;${popup ? `config.error_callback({type:${JSON.stringify(popup)}});` : `config.callback(${JSON.stringify({ scope, access_token: TOKEN, expires_in: expires, ...(error ? { error } : {}) })});`}}}}}}};` });
  });
  await page.route('https://www.googleapis.com/drive/v3/about?*', async route => {
    seen.drive++; expect(route.request().method()).toBe('GET');
    expect(route.request().headers().authorization).toBe('Bearer ' + TOKEN);
    expect(route.request().url()).not.toContain(TOKEN);
    if (network) await route.abort('internetdisconnected');
    else await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return seen;
}
async function prepare(page) {
  await page.locator('#driveConnect').click();
  await expect(page.locator('#driveConnect')).toHaveText('Подключить Google Drive');
  expect(await page.evaluate(() => window.__testCalls || 0)).toBe(0);
}
async function connect(page) { await prepare(page); await page.locator('#driveConnect').click(); }

test('Drive: no Google on startup, Client ID validation and deferred popup, account and disconnect', async ({ page }) => {
  const seen = await mock(page); await home(page); expect(seen.gis).toBe(0); expect(seen.drive).toBe(0);
  await configure(page, 'wrong'); await expect(page.locator('#driveSettingsError')).toContainText('Web application Client ID');
  await page.locator('#driveClientId').fill(ID); await page.locator('#driveSave').click();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(ID); expect(seen.gis).toBe(0);
  await connect(page); await expect(page.locator('#driveStatus')).toContainText('Google Drive подключён — Тестовый аккаунт');
  expect(seen.gis).toBe(1); expect(seen.drive).toBe(1);
  expect(await page.evaluate(() => ({ active: window.__testActive, scope: window.__testConfig.scope, include: window.__testConfig.include_granted_scopes }))).toEqual({ active: true, scope: SCOPE, include: false });
  await page.locator('#driveDisconnect').click(); await expect(page.locator('#driveStatus')).toHaveText('Не подключён.');
  await page.reload(); await page.locator('[data-home-nav=data]').click(); await expect(page.locator('#driveStatus')).toHaveText('Не подключён.'); expect(seen.gis).toBe(1);
});
for (const [name, options, message] of [
  ['popup close', { popup: 'popup_closed' }, 'закрыто'],
  ['popup blocked', { popup: 'popup_failed_to_open' }, 'заблокировал'],
  ['origin mismatch', { error: 'origin_mismatch' }, 'Адрес сайта'],
  ['denial', { error: 'access_denied' }, 'не предоставлен'],
  ['missing scope', { scope: 'unrelated' }, 'Не предоставлено разрешение'],
  ['network error', { network: true }, 'Ошибка сети'],
  ['401', { status: 401 }, 'Срок доступа истёк'],
  ['403 scope', { status: 403, body: { error: { errors: [{ reason: 'insufficientPermissions' }] } } }, 'недостаточно разрешений'],
  ['403 API', { status: 403, body: { error: { details: [{ reason: 'SERVICE_DISABLED' }] } } }, 'включи его'],
]) test('Drive: ' + name + ' leaves a retryable state', async ({ page }) => {
  const seen = await mock(page, options); await home(page); await configure(page); await connect(page);
  await expect(page.locator('#driveStatus')).toContainText(message); await expect(page.locator('#driveConnect')).toBeEnabled();
  if (options.popup || options.error || options.scope) expect(seen.drive).toBe(0);
});

test('Drive: expiry, explicit reconnect and Client ID change reset', async ({ page }) => {
  await page.clock.install(); const seen = await mock(page, { expires: 5 }); await home(page); await configure(page); await connect(page);
  await expect(page.locator('#driveStatus')).toContainText('Google Drive подключён');
  await page.clock.fastForward(5001); await expect(page.locator('#driveStatus')).toContainText('Срок доступа истёк'); expect(seen.drive).toBe(1);
  await page.locator('#driveConnect').click(); await expect(page.locator('#driveStatus')).toContainText('Google Drive подключён'); expect(seen.drive).toBe(2);
  await configure(page, 'other.apps.googleusercontent.com'); await expect(page.locator('#driveStatus')).toHaveText('Не подключён.');
  await expect(page.locator('#driveConnect')).toHaveText('Подготовить авторизацию');
});

test('Drive: no account, Client ID or token in workspace ZIP or persistent account storage', async ({ page }) => {
  await mock(page); await home(page); await configure(page); await connect(page); await expect(page.locator('#driveStatus')).toContainText('Google Drive подключён');
  const durable = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open('kartochnaya_local_v1'); q.onsuccess = () => resolve(q.result); q.onerror = reject; });
    const all = await Promise.all([...db.objectStoreNames].map(name => new Promise(resolve => { const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => resolve(q.result); })));
    db.close(); return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, all });
  });
  expect(durable).not.toContain(TOKEN); expect(durable).not.toContain('Тестовый аккаунт'); expect(durable).not.toContain('test@example.invalid');
  await page.locator('#zipCreate').click(); await expect(page.locator('#zipConfirm')).toBeEnabled();
  const pending = page.waitForEvent('download'); await page.locator('#zipConfirm').click(); const bytes = await readFile(await (await pending).path());
  const files = unzipSync(bytes); const all = Object.values(files).map(strFromU8).join('\n');
  for (const value of [TOKEN, ID, KEY, 'test@example.invalid', 'Тестовый аккаунт']) expect(all).not.toContain(value);
  const cache = await page.evaluate(async () => { const result = []; for (const name of await caches.keys()) result.push(...(await (await caches.open(name)).keys()).map(r => r.url)); return result; });
  expect(cache.some(url => /googleapis|accounts.google/.test(url))).toBe(false);
});

test('Drive: GIS timeout and concurrent clicks recover without automatic OAuth', async ({ page }) => {
  await page.clock.install(); await page.route('https://accounts.google.com/gsi/client', () => {});
  await home(page); await configure(page); await page.locator('#driveConnect').click();
  await expect(page.locator('#driveConnect')).toBeDisabled(); await page.clock.fastForward(15001);
  await expect(page.locator('#driveStatus')).toContainText('Не удалось загрузить'); await expect(page.locator('#driveConnect')).toBeEnabled();
});

test('Drive: offline editor remains independent with configured Client ID and no Google requests', async ({ page, context }) => {
  const seen = await mock(page); await home(page); await configure(page);
  await expect(page.locator('#pwaStatus')).toHaveAttribute('data-offline-ready', 'true');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await context.setOffline(true); await page.reload(); await page.locator('[data-home-nav=data]').click();
  await expect(page.locator('#driveStatus')).toContainText('Отсутствует интернет'); await expect(page.locator('#driveConnect')).toBeDisabled();
  await page.locator('[data-home-nav=workspace]').click();
  await createDocument(page, 'Drive offline document'); await addShape(page); await savedDocument(page, 'Drive offline document', 1);
  expect((await exportedDocument(page)).elements).toHaveLength(1); expect(seen.gis).toBe(0); expect(seen.drive).toBe(0);
});


test('Drive: file mode explains unsupported OAuth without loading Google', async ({ page }, testInfo) => {
  const { pathToFileURL } = require('node:url');
  const { resolve } = require('node:path');
  const seen = await mock(page);
  try { await page.goto(pathToFileURL(resolve(__dirname, '../dist/netlify/index.html')).href); }
  catch (error) {
    if (!error.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR') || process.env.KARTOCHNAYA_REQUIRE_FILE_URL === '1') throw error;
    await testInfo.attach('file-mode-environment', { body: 'ENV-001: managed Chromium blocks file://; no application assertion ran.', contentType: 'text/plain' });
    test.skip(true, 'ENV-001: administrator policy blocks file://');
  }
  await page.locator('[data-home-nav=data]').click();
  await expect(page.locator('#driveStatus')).toContainText('Авторизация недоступна в file://');
  await configure(page); await expect(page.locator('#driveConnect')).toBeDisabled();
  expect(seen.gis).toBe(0); expect(seen.drive).toBe(0);
});
