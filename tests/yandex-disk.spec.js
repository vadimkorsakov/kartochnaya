const { test, expect } = require('@playwright/test');
const { openHome, createDocument, addShape, savedDocument } = require('./helpers');
const ID = 'a'.repeat(32), TOKEN = 'yandex-memory-only-test-token', CODE = 'yandex-one-use-test-code';
const KEY = 'kartochnaya-yandex-public-client-id';
async function home(page) { await openHome(page); await page.locator('[data-home-nav=data]').click(); await page.locator('#yandexCard').click(); }
async function configure(page) {
  await page.locator('#yandexConfigure').click(); await page.locator('#yandexClientId').fill(ID);
  await page.locator('#yandexSettings button[type=submit]').click();
}
async function mock(context, { network = false, identity = 200, badDownload = false } = {}) {
  const seen = { token: 0, api: 0, put: 0, get: 0, deletes: [] }; let bytes;
  await context.route('https://oauth.yandex.ru/authorize?*', route => route.fulfill({ contentType: 'text/html', body: '<p>Mock Яндекс OAuth</p>' }));
  await context.route('https://oauth.yandex.ru/token', async route => {
    seen.token++; const req = route.request(), p = new URLSearchParams(req.postData());
    expect(p.get('grant_type')).toBe('authorization_code'); expect(p.get('code')).toBe(CODE);
    expect(p.get('client_id')).toBe(ID); expect(p.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(p.has('client_secret')).toBe(false);
    expect(req.headers()['content-type']).toContain('application/x-www-form-urlencoded');
    if (network) return route.abort('failed');
    await route.fulfill({ json: { access_token: TOKEN, refresh_token: 'yandex-refresh-test-token', token_type: 'bearer', expires_in: 3600 } });
  });
  await context.route('https://login.yandex.ru/info', async route => { seen.api++; expect(route.request().headers().authorization).toBe('OAuth ' + TOKEN); await route.fulfill({ status: identity, json: { id: 'mock-only-id' } }); });
  await context.route('https://cloud-api.yandex.net/v1/disk/resources**', async route => {
    seen.api++; const req = route.request(), u = new URL(req.url()); expect(req.headers().authorization).toBe('OAuth ' + TOKEN); expect(u.searchParams.get('path')).toMatch(/^app:\//);
    if (req.method() === 'DELETE') { seen.deletes.push(u.searchParams.get('path')); return route.fulfill({ status: 204 }); }
    if (u.pathname.endsWith('/upload')) return route.fulfill({ json: { method: 'PUT', templated: false, href: 'https://uploader1d.dst.yandex.net/upload-target/test?signature=mock-only' } });
    if (u.pathname.endsWith('/download')) return route.fulfill({ json: { method: 'GET', templated: false, href: 'https://downloader.dst.yandex.ru/disk/test?signature=mock-only' } });
    await route.fulfill({ json: { path: 'app:/' } });
  });
  await context.route('https://uploader1d.dst.yandex.net/upload-target/**', async route => { seen.put++; expect(route.request().headers().authorization).toBeUndefined(); bytes = route.request().postDataBuffer(); expect(bytes.length).toBeLessThan(1024); await route.fulfill({ status: 201 }); });
  await context.route('https://downloader.dst.yandex.ru/disk/**', async route => { seen.get++; expect(route.request().headers().authorization).toBeUndefined(); await route.fulfill({ body: badDownload ? 'different' : bytes }); });
  return seen;
}
async function popup(page) {
  const next = page.waitForEvent('popup'); await page.locator('#yandexConnect').click();
  const p = await next; await p.waitForURL('https://oauth.yandex.ru/authorize?*'); return p;
}
async function callback(p, extra = {}) {
  const state = new URL(p.url()).searchParams.get('state');
  const origin = await p.evaluate(() => new URL(document.referrer || 'http://127.0.0.1:4174').origin);
  // Actual isolated production callback document, served by the local test host.
  await p.evaluate(url => location.replace(url), origin + '/oauth/yandex-callback.html?' + new URLSearchParams({ code: CODE, state, ...extra })).catch(error => { if (!p.isClosed()) throw error; });
}
async function connect(page) { const p = await popup(page); await callback(p); await expect(page.locator('#yandexStatus')).toContainText('Подключено в памяти'); }

test('Yandex mock browser: real popup/callback, memory-only session, explicit transfer and exact cleanup', async ({ page, context }) => {
  const seen = await mock(context);
  await page.addInitScript(() => {
    const secret = value => /yandex-memory-only-test-token|yandex-refresh-test-token|yandex-one-use-test-code/.test(JSON.stringify(value));
    window.secretWrites = [];
    for (const [prototype, name] of [[Storage.prototype, 'setItem'], [IDBObjectStore.prototype, 'put'], [IDBObjectStore.prototype, 'add'], [Cache.prototype, 'put']]) {
      const original = prototype[name]; prototype[name] = function(...args) { if (secret(args)) { window.secretWrites.push(name); throw Error('Secret persistence attempted'); } return original.apply(this, args); };
    }
    const original = window.open;
    window.open = function(...args) { window.yandexActivation = navigator.userActivation.isActive; return original.apply(this, args); };
  });
  await home(page); expect(seen.token).toBe(0); expect(seen.api).toBe(0); await configure(page); await connect(page);
  expect(await page.evaluate(() => window.yandexActivation)).toBe(true);
  await page.locator('#yandexDialog [data-backup-close]').click(); await expect(page.locator('#yandexCard')).toBeFocused();
  await expect(page.locator('#yandexCard')).toContainText('подключён'); await page.locator('#yandexCard').click();
  await page.locator('#yandexDiagnosticsTab').click(); await page.locator('#yandexApi').click(); await expect(page.locator('#yandexResults')).toContainText('Папка app:/: Подтверждено'); expect(seen.put).toBe(0);
  await page.locator('#yandexTransfer').click(); await expect(page.locator('#yandexResults')).toContainText('содержимое совпадает');
  await page.locator('#yandexConnectionTab').click(); await page.locator('#yandexDiagnosticsTab').click();
  await page.getByRole('navigation', { name: 'Шаги диагностики Яндекса', exact: true }).getByRole('button', { name: 'Следующая страница' }).click();
  await expect(page.locator('#yandexResults p:visible').filter({ hasText: 'содержимое совпадает' })).toHaveCount(1);
  expect(seen.put).toBe(1); expect(seen.get).toBe(1); expect(seen.deletes).toHaveLength(0);
  const path = (await page.locator('#yandexPath').textContent()).match(/app:\/kartochnaya-probe-[\w-]+\.txt/)[0];
  await page.locator('#yandexRemove').click(); await expect(page.locator('#yandexPath')).toHaveText(''); expect(seen.deletes).toEqual([path]);
  expect(await page.evaluate(() => window.secretWrites)).toEqual([]);
  const persisted = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(persisted.local[KEY]).toBe(ID); expect(JSON.stringify(persisted)).not.toMatch(/yandex-memory|yandex-refresh|yandex-one-use/);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async k => (await (await caches.open(k)).keys()).map(r => r.url)))).flat());
  expect(cached.join('\n')).not.toMatch(/yandex-callback|code=|state=|oauth.yandex/);
  await page.locator('#yandexDisconnect').click(); await expect(page.locator('#yandexApi')).toBeDisabled();
  await expect(page.locator('#yandexResults')).toContainText('Папка app:/: Не проверено');
  await page.reload(); await page.locator('[data-home-nav=data]').click(); await page.locator('#yandexCard').click(); await expect(page.locator('#yandexApi')).toBeDisabled(); expect(seen.token).toBe(1);
});
test('Yandex mock browser: forged source ignored, wrong state cancels, unknown callback refused', async ({ page, context }) => {
  const seen = await mock(context); await home(page); await configure(page);
  let p = await popup(page); const state = new URL(p.url()).searchParams.get('state');
  await page.evaluate(state => window.postMessage({ type: 'kartochnaya-yandex-callback', state, code: 'forged' }, location.origin), state);
  expect(seen.token).toBe(0); await callback(p, { state: 'forged' }); await expect(page.locator('#yandexStatus')).toContainText('state не совпадает');
  p = await popup(page); await p.evaluate(() => opener.postMessage({ type: 'unknown' }, 'http://127.0.0.1:4174'));
  // Even our popup cannot send an accepted callback from the OAuth origin.
  await expect(page.locator('#yandexStatus')).toContainText('Ожидаем Яндекс');
  await callback(p, { unknown: 'invalid-callback' });
  await expect(page.locator('#yandexStatus')).toContainText('Неизвестный OAuth callback'); expect(seen.token).toBe(0);
});
test('Yandex mock browser: close, cancel and denied callback remain retryable', async ({ page, context }) => {
  const seen = await mock(context); await home(page); await configure(page);
  let p = await popup(page); await p.close(); await expect(page.locator('#yandexStatus')).toContainText('закрыто');
  p = await popup(page); await page.locator('#yandexDisconnect').click(); await expect(page.locator('#yandexConnect')).toBeEnabled(); expect(p.isClosed()).toBe(true);
  p = await popup(page); await callback(p, { code: '', error: 'access_denied' }); await expect(page.locator('#yandexStatus')).toContainText('отказал'); expect(seen.token).toBe(0);
});
test('Yandex mock browser: token network failure identifies OAuth step and local editor still saves', async ({ page, context }) => {
  const seen = await mock(context, { network: true }); await home(page); await configure(page);
  const p = await popup(page); await callback(p); await expect(page.locator('#yandexStatus')).toContainText('OAuth POST /token'); await expect(page.locator('#yandexStatus')).toContainText('CORS'); expect(seen.token).toBe(1);
  await page.locator('#yandexDialog [data-backup-close]').click();
  await page.locator('[data-home-nav=workspace]').click(); await createDocument(page, 'After Yandex failure'); await addShape(page); await savedDocument(page, 'After Yandex failure', 1);
});
test('Yandex mock browser: identification 403 independent, wrong downloaded content visible', async ({ page, context }) => {
  await mock(context, { identity: 403, badDownload: true }); await home(page); await configure(page); await connect(page);
  await page.locator('#yandexDiagnosticsTab').click(); await page.locator('#yandexApi').click(); await expect(page.locator('#yandexResults')).toContainText('HTTP 403'); await expect(page.locator('#yandexResults')).toContainText('Папка app:/: Подтверждено');
  await page.locator('#yandexTransfer').click(); await expect(page.locator('#yandexResults')).toContainText('не совпадает'); await expect(page.locator('#yandexRemove')).toBeEnabled();
});
test('callback alone: no editor, IndexedDB, SW or external resources; query removed; opener-null explanation', async ({ page }) => {
  const requests = [];
  await page.addInitScript(() => {
    indexedDB.open = () => { throw Error('Callback opened IndexedDB'); };
    navigator.serviceWorker.register = () => { throw Error('Callback registered SW'); };
  });
  page.on('request', r => requests.push(r.url()));
  const response = await page.goto('/oauth/yandex-callback.html?code=mock-secret&state=mock-state&error_description=private');
  expect(response.headers()['cache-control']).toBe('no-store'); expect(response.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.locator('#status')).toContainText('Исходное окно недоступно'); expect(page.url()).toBe('http://127.0.0.1:4174/oauth/yandex-callback.html');
  expect(await page.locator('#homeScreen').count()).toBe(0); expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(x => x.length))).toBe(0);
  expect(requests.filter(u => !u.includes('/oauth/yandex-callback.html'))).toEqual([]);
});
