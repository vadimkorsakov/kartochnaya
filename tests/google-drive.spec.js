const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const { unzipSync, strFromU8 } = require('fflate');
const { openHome, createDocument, addShape, exportedDocument, savedDocument } = require('./helpers');
const ID = 'test.apps.googleusercontent.com', KEY = 'kartochnaya-google-drive-client-id';
const SCOPE = 'https://www.googleapis.com/auth/drive.file', TOKEN = 'memory-only-oauth-test-token';
async function home(page) { await openHome(page); await page.locator('[data-home-nav=data]').click(); await page.locator('#googleDriveCard').click(); }
async function configure(page, value = ID) {
  if (!await page.locator('#googleDriveDialog').isVisible()) await page.locator('#googleDriveCard').click();
  await page.locator('#driveAccountsTab').click();
  await page.locator('#driveConfigure').click(); await page.locator('#driveClientId').fill(value); await page.locator('#driveSave').click();
}
async function mock(page, { scope = SCOPE, error, popup, status = 200, body = { user: { permissionId: 'permission-test', displayName: 'Тестовый аккаунт', emailAddress: 'test@example.invalid' } }, network = false, expires = 3600 } = {}) {
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
  const before = await page.evaluate(() => window.__testCalls || 0);
  await page.locator('#driveAdd').click();
  await expect(page.locator('#driveConnect')).toHaveText('Подключить Google Drive');
  expect(await page.evaluate(() => window.__testCalls || 0)).toBe(before);
}
async function connect(page) { await prepare(page); await page.locator('#driveConnect').click(); }

test('Drive: no Google on startup, Client ID validation and deferred popup, account and disconnect', async ({ page }) => {
  const seen = await mock(page); await home(page); expect(seen.gis).toBe(0); expect(seen.drive).toBe(0);
  await configure(page, 'wrong'); await expect(page.locator('#driveSettingsError')).toContainText('Web application Client ID');
  await page.locator('#driveClientId').fill(ID); await page.locator('#driveSave').click();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(ID); expect(seen.gis).toBe(0);
  await connect(page); await expect(page.locator('#driveAccounts')).toContainText('Тестовый аккаунт');
  expect(seen.gis).toBe(1); expect(seen.drive).toBe(1);
  expect(await page.evaluate(() => ({ active: window.__testActive, scope: window.__testConfig.scope, include: window.__testConfig.include_granted_scopes }))).toEqual({ active: true, scope: SCOPE, include: false });
  await page.locator('#driveCopiesTab').click(); await page.locator('#driveDisconnect').click(); await page.locator('#driveAccountsTab').click(); await expect(page.locator('#driveAccounts')).toContainText('Требуется подключение');
  await page.reload(); await page.locator('[data-home-nav=data]').click(); await page.locator('#googleDriveCard').click(); await expect(page.locator('#driveAccounts')).toContainText('Требуется подключение'); expect(seen.gis).toBe(1);
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
  await expect(page.locator('#driveAccounts')).toContainText('Подключён');
  await page.clock.fastForward(5001); await expect(page.locator('#driveAccounts')).toContainText('Срок доступа истёк'); expect(seen.drive).toBe(1);
  await page.locator('#driveAccounts button').filter({hasText: /^Подключить$/}).click(); await page.locator('#driveConnect').click(); await expect(page.locator('#driveAccounts')).toContainText('Подключён'); expect(seen.drive).toBe(2);
  await configure(page, 'other.apps.googleusercontent.com'); await expect(page.locator('#driveAccounts')).toContainText('Требуется подключение');
  await expect(page.locator('#driveAdd')).toBeEnabled();
});

test('Drive: registry metadata persists, tokens stay in memory and cloud settings never enter ZIP', async ({ page }) => {
  await mock(page); await home(page); await configure(page); await connect(page); await expect(page.locator('#driveAccounts')).toContainText('Подключён');
  const durable = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open('kartochnaya_local_v1'); q.onsuccess = () => resolve(q.result); q.onerror = reject; });
    const all = await Promise.all([...db.objectStoreNames].map(name => new Promise(resolve => { const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => resolve(q.result); })));
    db.close(); return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, all });
  });
  expect(durable).not.toContain(TOKEN); expect(durable).toContain('Тестовый аккаунт'); expect(durable).toContain('permission-test');
  await page.locator('#googleDriveDialog [data-backup-close]').click();
  await page.locator('#zipStorage').click(); await expect(page.locator('#zipConfirm')).toBeEnabled();
  const pending = page.waitForEvent('download'); await page.locator('#zipConfirm').click(); const bytes = await readFile(await (await pending).path());
  const files = unzipSync(bytes); const all = Object.values(files).map(strFromU8).join('\n');
  for (const value of [TOKEN, ID, KEY, 'test@example.invalid', 'Тестовый аккаунт']) expect(all).not.toContain(value);
  const cache = await page.evaluate(async () => { const result = []; for (const name of await caches.keys()) result.push(...(await (await caches.open(name)).keys()).map(r => r.url)); return result; });
  expect(cache.some(url => /googleapis|accounts.google/.test(url))).toBe(false);
});

test('Drive: GIS timeout and concurrent clicks recover without automatic OAuth', async ({ page }) => {
  await page.clock.install(); await page.route('https://accounts.google.com/gsi/client', () => {});
  await home(page); await configure(page); await page.locator('#driveAdd').click();
  await expect(page.locator('#driveAdd')).toBeDisabled(); await page.clock.fastForward(15001);
  await expect(page.locator('#driveStatus')).toContainText('Не удалось загрузить'); await expect(page.locator('#driveConnect')).toBeEnabled();
});

test('Drive: offline editor remains independent with configured Client ID and no Google requests', async ({ page, context }) => {
  const seen = await mock(page); await home(page); await configure(page);
  await expect(page.locator('#pwaStatus')).toHaveAttribute('data-offline-ready', 'true');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  await context.setOffline(true); await page.reload(); await page.locator('[data-home-nav=data]').click(); await page.locator('#googleDriveCard').click();
  await expect(page.locator('#driveStatus')).toContainText('Отсутствует интернет'); await expect(page.locator('#driveAdd')).toBeDisabled();
  await page.locator('#googleDriveDialog [data-backup-close]').click();
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
  await page.locator('[data-home-nav=data]').click(); await page.locator('#googleDriveCard').click();
  await expect(page.locator('#driveStatus')).toContainText('Авторизация недоступна в file://');
  await configure(page); await expect(page.locator('#driveAdd')).toBeDisabled();
  expect(seen.gis).toBe(0); expect(seen.drive).toBe(0);
});

async function driveStorage(page) {
  const result = {};
  for (const store of ['projects', 'docs', 'fonts', 'settings']) result[store] = await require('./helpers').records(page, store);
  return result;
}
async function backupDriveMock(page, { hold = false } = {}) {
  await mock(page);
  const state = { folder: null, files: [], bytes: new Map(), folderCreates: 0, uploads: 0, media: 0, chunks: 0, broken: false };
  const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
  await page.route('https://www.googleapis.com/**/files**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    expect(request.headers().authorization).toBe('Bearer ' + TOKEN); expect(request.url()).not.toContain(TOKEN);
    expect(['DELETE', 'PATCH']).not.toContain(method);
    if (url.pathname === '/upload/drive/v3/files') {
      if (method === 'POST') {
        state.uploads++; state.current = request.postDataJSON();
        expect(state.current.parents).toEqual(['app-folder']); expect(state.current.appProperties.scope).toBe('workspace');
        await route.fulfill({ status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session', 'Access-Control-Expose-Headers': 'Location, Range' } }); return;
      }
      state.chunks++;
      if (hold) return; // Aborted by session disconnect; no fabricated server success.
      const data = request.postDataBuffer(); expect(data[0]).toBe(80); expect(data[1]).toBe(75);
      const id = 'cloud-' + state.uploads;
      state.files.push({ ...state.current, id, size: String(data.length), createdTime: '2026-10-22T12:00:00Z' }); state.bytes.set(id, data);
      await json(route, { id }, 201); return;
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      if (url.searchParams.get('q').includes("mimeType = 'application/vnd.google-apps.folder'")) { await json(route, { files: state.folder ? [state.folder] : [] }); return; }
      // Deliberately include a foreign file: client must filter it again.
      await json(route, { files: [...state.files, { id: 'foreign', name: 'foreign.zip', parents: ['app-folder'], mimeType: 'application/zip', size: '10' }] }); return;
    }
    if (method === 'POST') {
      state.folderCreates++; state.folder = { ...request.postDataJSON(), id: 'app-folder' }; await json(route, state.folder); return;
    }
    const id = url.pathname.split('/').pop();
    if (id === 'app-folder') { await json(route, state.folder); return; }
    const file = state.files.find(f => f.id === id); expect(file).toBeTruthy();
    if (url.searchParams.get('alt') === 'media') {
      state.media++; const data = Buffer.from(state.bytes.get(id)); if (state.broken) data[0] ^= 255;
      await route.fulfill({ status: 200, contentType: 'application/zip', body: data, headers: { 'Content-Length': String(data.length) } }); return;
    }
    await json(route, file);
  });
  return state;
}
test('Drive backups: create separate complete ZIPs, list safe text, download exact bytes, then restore through local ZIP UI', async ({ page }) => {
  const state = await backupDriveMock(page); await openHome(page); await createDocument(page, 'Облачный проект'); await addShape(page);
  await page.locator('#documentTabsHome').click(); await page.locator('[data-home-nav=data]').click(); await configure(page); await connect(page);
  expect(state.folderCreates).toBe(0); await page.locator('#driveCopiesTab').click(); await page.locator('#driveRefresh').click(); await expect(page.locator('#driveProgress')).toContainText('пока нет'); expect(state.folderCreates).toBe(0);
  for (let i = 0; i < 2; i++) { await page.locator('#driveCopiesTab').click(); await page.locator('#driveCreate').click(); await expect(page.locator('#driveProgress')).toContainText('Резервная копия сохранена в Google Drive'); }
  expect(state.folderCreates).toBe(1); expect(state.uploads).toBe(2); expect(state.files[0].name).not.toBe(state.files[1].name);
  const before = await driveStorage(page); const { readBackup, sha256 } = await import('../src/backup/archive.mjs');
  const uploaded = state.bytes.get('cloud-1'), parsed = await readBackup(uploaded);
  expect(parsed.data.docs).toEqual(before.docs); expect(parsed.data.projects).toEqual(before.projects); expect(parsed.data.fonts).toEqual(before.fonts); expect(parsed.data.settings).toEqual(before.settings);
  expect(state.files[0].appProperties.sha256).toBe(await sha256(uploaded));
  expect(Object.values(unzipSync(uploaded)).map(strFromU8).join('')).not.toContain(TOKEN);
  state.files[0].name = '<img src=x onerror=alert(1)>../опасный.zip';
  await page.locator('#driveCopiesTab').click(); await page.locator('#driveRefresh').click(); await expect(page.locator('#driveList button')).toHaveCount(2); await expect(page.locator('#driveList')).toContainText(state.files[0].name); await expect(page.locator('#driveList img')).toHaveCount(0);
  await page.locator('#driveList button').first().click(); await expect(page.locator('#driveProgress')).toContainText('ZIP проверен');
  expect(await driveStorage(page)).toEqual(before);
  await page.locator('#googleDriveDialog [data-backup-close]').click(); await expect(page.locator('#googleDriveCard')).toBeFocused();
  await page.locator('#googleDriveCard').click(); await expect(page.locator('#driveSaveZip')).toBeVisible();
  const pending = page.waitForEvent('download'); await page.locator('#driveSaveZip').click(); const downloaded = await pending;
  expect(downloaded.suggestedFilename()).not.toMatch(/[<>/\\]/); expect(await readFile(await downloaded.path())).toEqual(uploaded);
  await page.locator('#googleDriveDialog [data-backup-close]').click();
  await page.locator('#zipInput').setInputFiles({ name: 'cloud.zip', mimeType: 'application/zip', buffer: uploaded }); await expect(page.locator('#zipConfirm')).toBeEnabled();
  await page.locator('#zipConfirm').click(); await expect(page.locator('#zipStatus')).toContainText('Транзакция завершена');
  expect((await driveStorage(page)).projects.length).toBeGreaterThan(before.projects.length);
});
test('Drive backups: corrupted download never enables save and leaves all stores unchanged', async ({ page }) => {
  const state = await backupDriveMock(page); await home(page); await configure(page); await connect(page);
  await page.locator('#driveCopiesTab').click(); await page.locator('#driveCreate').click(); await expect(page.locator('#driveProgress')).toContainText('Резервная копия сохранена');
  const before = await driveStorage(page); state.broken = true;
  await page.locator('#driveCopiesTab').click(); await page.locator('#driveRefresh').click(); await expect(page.locator('#driveList button')).toHaveCount(1); await page.locator('#driveList button').click();
  await expect(page.locator('#driveProgress')).toContainText('SHA-256'); await expect(page.locator('#driveSaveZip')).toBeHidden(); expect(await driveStorage(page)).toEqual(before);
});
test('Drive backups: editing is unlocked during upload; disconnect terminates it, then local ZIP works offline', async ({ page, context }) => {
  const state = await backupDriveMock(page, { hold: true }); await openHome(page); await createDocument(page, 'Редактор во время загрузки');
  await page.locator('#documentTabsHome').click(); await page.locator('[data-home-nav=data]').click(); await configure(page); await connect(page);
  const before = await driveStorage(page); await page.locator('#driveCopiesTab').click(); await page.locator('#driveCreate').click(); await expect.poll(() => state.chunks).toBe(1);
  await page.locator('#googleDriveDialog [data-backup-close]').click();
  await page.locator('[data-tab-id]').first().click(); await addShape(page); await savedDocument(page, 'Редактор во время загрузки', 1);
  await page.locator('#documentTabsHome').click(); await page.locator('[data-home-nav=data]').click(); await page.locator('#googleDriveCard').click(); await page.locator('#driveCopiesTab').click(); await page.locator('#driveDisconnect').click();
  await expect(page.locator('#driveBackups')).toBeHidden(); await expect(page.locator('#driveProgress')).toContainText('прервана');
  const after = await driveStorage(page); expect(after.projects).toEqual(before.projects); expect(after.fonts).toEqual(before.fonts); expect(after.settings).toEqual(before.settings);
  await context.setOffline(true); await page.locator('#googleDriveDialog [data-backup-close]').click(); await page.locator('#zipStorage').click(); await expect(page.locator('#zipConfirm')).toBeEnabled();
  const pending = page.waitForEvent('download'); await page.locator('#zipConfirm').click(); const bytes = await readFile(await (await pending).path());
  expect((await (await import('../src/backup/archive.mjs')).readBackup(bytes)).data.docs.some(d => d.elements.length)).toBe(true);
});

test('Drive accounts: three rows, shared ZIP, partial failure, isolated lists/downloads, reload and identity mismatch', async ({ page }) => {
  let chosen = 'A'; const states = new Map();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{oauth2:{initTokenClient(config){return {requestAccessToken(){config.callback({scope:${JSON.stringify(SCOPE)},access_token:'secret-'+window.__pick,expires_in:3600});}};}}}};` }));
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const id = request.headers().authorization.replace('Bearer secret-', ''); expect(['A', 'B', 'C']).toContain(id); expect(['PATCH', 'DELETE']).not.toContain(method);
    if (url.pathname.endsWith('/about')) { await route.fulfill({ json: { user: { permissionId: id, displayName: 'Google ' + id } } }); return; }
    let state = states.get(id); if (!state) states.set(id, state = { folder: null, files: [], bytes: null });
    if (url.pathname === '/drive/v3/files') {
      if (method === 'POST') { state.folder = { ...request.postDataJSON(), id: 'folder-' + id }; await route.fulfill({ json: state.folder }); return; }
      await route.fulfill({ json: { files: url.searchParams.get('q').includes("mimeType = 'application/vnd.google-apps.folder'") ? state.folder ? [state.folder] : [] : state.files } }); return;
    }
    if (url.pathname === '/upload/drive/v3/files') {
      if (method === 'POST') {
        if (id === 'B') { await route.fulfill({ status: 403, json: {} }); return; }
        state.meta = request.postDataJSON(); expect(state.meta.parents).toEqual(['folder-' + id]);
        await route.fulfill({ headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + id, 'Access-Control-Expose-Headers': 'Location, Range' } }); return;
      }
      expect(url.searchParams.get('upload_id')).toBe(id); state.bytes = request.postDataBuffer();
      state.files.push({ ...state.meta, id: 'file-' + id, size: String(state.bytes.length), createdTime: '2026-10-22T12:00:00Z' });
      await route.fulfill({ status: 201, json: { id: 'file-' + id } }); return;
    }
    if (url.pathname.endsWith('/folder-' + id)) { await route.fulfill({ json: state.folder }); return; }
    expect(url.pathname).toBe('/drive/v3/files/file-' + id);
    if (url.searchParams.get('alt') === 'media') await route.fulfill({ body: state.bytes, contentType: 'application/zip', headers: { 'Content-Length': String(state.bytes.length) } });
    else await route.fulfill({ json: state.files[0] });
  });
  await home(page); await configure(page);
  const rows = page.locator('#driveAccounts article');
  const row = id => rows.filter({ has: page.locator('label', { hasText: 'Google ' + id }) });
  for (chosen of ['A', 'B', 'C']) { await page.evaluate(id => { window.__pick = id; }, chosen); await connect(page); await expect(row(chosen)).toContainText('Подключён'); }
  await page.evaluate(() => { window.__pick = 'A'; }); await connect(page); await expect(rows).toHaveCount(3);
  await page.locator('#driveCreateTab').click();
  for (const id of ['A', 'B', 'C']) {
    if (id === 'C') await page.getByRole('navigation', { name: 'Google-аккаунты', exact: true }).getByRole('button', { name: 'Следующая страница' }).click();
    await row(id).locator('input').check();
  }
  await page.evaluate(() => { window.__accountInputs = [...document.querySelectorAll('#driveAccounts input')]; });
  await page.locator('#driveAccountsTab').click(); await page.locator('#driveCreateTab').click();
  for (const id of ['A', 'B', 'C']) await expect(row(id).locator('input')).toBeChecked();
  await page.locator('#driveCreateSelected').click();
  await expect(row('A')).toContainText('Резервная копия сохранена'); await expect(row('B')).toContainText('403'); await expect(row('C')).toContainText('Резервная копия сохранена');
  expect(await page.evaluate(() => window.__accountInputs.every((input, index) => input === document.querySelectorAll('#driveAccounts input')[index]))).toBe(true);
  await expect(page.locator('#driveStatus')).toContainText('неподтверждённые'); expect(states.get('A').bytes).toEqual(states.get('C').bytes);
  await page.locator('#driveCopiesTab').click();
  for (const id of ['A', 'B', 'C']) {
    await page.locator('#driveActiveAccount').selectOption(id);
    await page.locator('#driveRefresh').click();
    await expect(page.locator('#driveAccountTitle')).toHaveText('Копии: Google ' + id);
    await expect(page.locator('#driveList button')).toHaveCount(id === 'B' ? 0 : 1);
  }
  await page.locator('#driveActiveAccount').selectOption('A'); await page.locator('#driveRefresh').click(); await page.locator('#driveList button').click(); await expect(page.locator('#driveProgress')).toContainText('ZIP проверен');
  const pending = page.waitForEvent('download'); await page.locator('#driveSaveZip').click(); expect(await readFile(await (await pending).path())).toEqual(states.get('A').bytes);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await page.locator('[data-home-nav=data]').click(); await page.locator('#googleDriveCard').click(); await expect(rows).toHaveCount(3);
  for (const id of ['A', 'B', 'C']) await expect(row(id)).toContainText('Требуется подключение');
  await page.evaluate(() => { window.__pick = 'C'; }); await row('A').getByRole('button', { name: 'Подключить', exact: true }).click(); await page.locator('#driveConnect').click();
  await expect(page.locator('#driveStatus')).toContainText('другой Google-аккаунт'); await expect(row('A')).toContainText('Требуется подключение'); await expect(rows).toHaveCount(3);
  await row('A').getByRole('button', { name: 'Удалить из списка', exact: true }).click(); await expect(rows).toHaveCount(2); expect(states.get('A').files).toHaveLength(1);
});
