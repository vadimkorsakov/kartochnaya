import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOAuth, authorizedEndpoint, validBackupName } from '../src/cloud/yandex-disk/oauth.mjs';
import { createYandexClient, UNCERTAIN, MAX_CLOUD_BYTES, ANDROID_CLOUD_BYTES } from '../src/cloud/yandex-disk/client.mjs';
import { createBackup, readBackup, sha256, FORMAT } from '../src/backup/archive.mjs';
import { prepareWorkspaceBackup } from '../src/backup/prepared.mjs';
const sessions = [];
afterEach(() => sessions.splice(0).forEach(s => s.disconnect()));
const tick = () => new Promise(r => setTimeout(r, 5));
const API = 'https://cloud-api.yandex.net/v1/disk/resources';
const filename = 'kartochnaya-2026-10-24T10-00-00-000Z-12345678-1234-4234-8234-123456789abc.zip';
const row = (name = filename) => ({ name, path: 'app:/' + name, type: 'file', size: 200, created: '2026-10-24T10:00:00Z' });
const snapshot = () => ({ projects: [{ id: 'p', name: 'Full', resources: [{ id: 'r', name: 'resource', src: 'data:image/png;base64,AA==' }], resourceFolders: [] }], docs: [{ id: 'd', projectId: 'p', name: 'Document', width: 320, height: 240, elements: [], groups: [] }], fonts: [{ id: 'f', data: 'data:font/ttf;base64,AA==' }], settings: [{ key: 'fixture', value: 'settings' }] });
async function harness(options = {}) {
  let listener, popup, url;
  const state = { calls: [], files: [], puts: 0, id: 'account-a' };
  const win = { location: new URL('https://test.example'), addEventListener(_, fn) { listener = fn; }, removeEventListener() {}, open() { popup = { closed: false, close() { this.closed = true; }, location: { replace(v) { url = new URL(v); } } }; return popup; } };
  const oauth = createOAuth({ win, request: async (address, init) => {
    const u = new URL(address); state.calls.push({ u, ...init });
    if (u.pathname === '/token') return Response.json({ access_token: 'private-token', token_type: 'bearer', expires_in: options.expires || 3600 });
    if (options.intercept) { const result = await options.intercept(u, init, state); if (result) return result; }
    if (u.pathname === '/info') return Response.json({ id: state.id });
    if (u.pathname.endsWith('/upload')) {
      state.name = u.searchParams.get('path').slice(5); assert.equal(u.searchParams.get('overwrite'), 'false');
      return Response.json(options.link || { method: 'PUT', href: 'https://uploader1d.dst.yandex.net/test' });
    }
    if (init.method === 'PUT') {
      state.puts++; state.bytes = init.body;
      const file = { ...row(state.name), size: init.body.byteLength, sha256: await sha256(init.body) }; state.files.push(file);
      return new Response(null, { status: 201 });
    }
    if (u.searchParams.get('path') === 'app:/') {
      const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 100);
      return Response.json({ type: 'dir', path: 'app:/', _embedded: { items: state.files.slice(offset, offset + limit), offset, limit, total: state.files.length } });
    }
    return Response.json(state.files.find(f => 'app:/' + f.name === u.searchParams.get('path')) || {}, { status: state.files.length ? 200 : 404 });
  } });
  sessions.push(oauth); oauth.configure('a'.repeat(32));
  async function connect() {
    url = null; oauth.connect();
    for (let i = 0; !url && i < 200; i++) await tick();
    assert.ok(url, 'PKCE navigation completed'); listener({ origin: win.location.origin, source: popup, data: { type: 'kartochnaya-yandex-callback', state: url.searchParams.get('state'), code: 'code' } });
    for (let i = 0; !oauth.view().connected && i < 200; i++) await tick();
    assert.equal(oauth.view().connected, true);
  }
  await connect(); const client = createYandexClient(oauth);
  const create = args => client.create({ snapshot: async () => snapshot(), preferences: () => ({ 'kartochnaya-ink-v1': 'ink' }), ...args });
  return { oauth, client, state, create, connect };
}
test('strict ZIP endpoint grammar, duplicate/encoded/traversal paths, methods and pagination', () => {
  assert.ok(validBackupName(filename));
  for (const url of [API + '?path=app:/', API + '?path=app:/&limit=100&offset=1000', API + '?path=app:/' + filename, API + '/upload?path=app:/' + filename + '&overwrite=false']) assert.ok(authorizedEndpoint(url));
  for (const path of ['disk:/' + filename, 'app:/../' + filename, 'app:/x/' + filename, 'app:/%252e%252e/' + filename, 'app:/%2e%2e/' + filename, 'app:/other.zip', 'app:/' + filename + '.txt', 'app:/a%2f' + filename]) assert.throws(() => authorizedEndpoint(API + '?path=' + path));
  for (const query of ['path=app:/&limit=0', 'path=app:/&limit=101', 'path=app:/&offset=-1', 'path=app:/&offset=10001', 'path=app:/&offset=1.5', 'path=app:/&path=app:/', 'path=app:/&overwrite=false']) assert.throws(() => authorizedEndpoint(API + '?' + query));
  for (const suffix of ['', '&overwrite=true', '&overwrite=false&overwrite=false']) assert.throws(() => authorizedEndpoint(API + '/upload?path=app:/' + filename + suffix));
  for (const method of ['PUT', 'POST', 'PATCH', 'DELETE', 'HEAD']) assert.throws(() => authorizedEndpoint(API + '?path=app:/' + filename, method));
  assert.ok(authorizedEndpoint(API + '/download?path=app:/' + filename));
});
test('real complete workspace ZIP, unique names, no bearer/cookies/redirect on PUT; server SHA-256 confirmation', async () => {
  const h = await harness(); const result = await h.create();
  assert.equal(result.verification, 'sha256');
  const backup = await readBackup(h.state.bytes);
  assert.equal(backup.manifest.format, FORMAT); assert.equal(backup.manifest.scope, 'workspace');
  for (const key of ['projects', 'docs', 'fonts', 'settings']) assert.deepEqual(backup.data[key], snapshot()[key]);
  assert.deepEqual(backup.data.preferences, { 'kartochnaya-ink-v1': 'ink' });
  assert.equal(result.file.sha256, await sha256(h.state.bytes)); assert.ok(result.file.name.includes(backup.manifest.backupId));
  const second = await h.create(); assert.notEqual(second.file.name, result.file.name);
  const put = h.state.calls.find(c => c.method === 'PUT');
  assert.equal(put.headers.Authorization, undefined); assert.equal(put.headers['Content-Type'], 'application/zip');
  for (const [key, value] of Object.entries({ redirect: 'error', credentials: 'omit', cache: 'no-store', mode: 'cors', referrerPolicy: 'no-referrer' })) assert.equal(put[key], value);
  assert.equal(h.state.calls.some(c => ['DELETE', 'PATCH', 'POST'].includes(c.method) && c.u.pathname !== '/token'), false);
});
test('save failure and cloud memory budget stop before upload-link and PUT', async () => {
  const h = await harness();
  await assert.rejects(h.create({ snapshot: async () => { throw Error('Сохранение не подтверждено'); } }), /Сохранение/);
  await assert.rejects(h.create({ maxBytes: 1 }), /предел/);
  assert.equal(h.state.puts, 0); assert.equal(h.state.calls.some(c => c.u.pathname.endsWith('/upload')), false);
  assert.equal(MAX_CLOUD_BYTES, 256 * 1024 * 1024); assert.equal(ANDROID_CLOUD_BYTES, 128 * 1024 * 1024);
});
test('upload link rejects wrong method, templating, untrusted hosts and bad HTTP', async () => {
  for (const link of [{ method: 'GET', href: 'https://storage.yandex.net/a' }, { method: 'PUT', href: 'https://storage.yandex.net/a', templated: true }, { method: 'PUT', href: 'https://evil.example/a' }, { method: 'PUT' }]) {
    const h = await harness({ link }); await assert.rejects(h.create()); assert.equal(h.state.puts, 0);
  }
  const h = await harness({ intercept: u => u.pathname.endsWith('/upload') ? Response.json({}, { status: 409 }) : null });
  await assert.rejects(h.create(), /409/); assert.equal(h.state.puts, 0);
});
test('metadata size/SHA/name/type mismatch cannot confirm; size-only result is explicit', async () => {
  for (const patch of [{ size: 1 }, { sha256: 'a'.repeat(64) }, { type: 'dir' }, { name: filename }, { path: 'disk:/elsewhere/' + filename }]) {
    const h = await harness({ intercept: (u, _, state) => state.files.length && u.searchParams.get('path') !== 'app:/' && !u.pathname.endsWith('/upload') ? Response.json({ ...state.files[0], ...patch }) : null });
    await assert.rejects(h.create(), /Загрузка не подтверждена/); assert.equal(h.state.puts, 1);
  }
  const h = await harness({ intercept: (u, _, state) => { if (state.files.length && u.searchParams.get('path') !== 'app:/' && !u.pathname.endsWith('/upload') && u.pathname !== '/info') { const { sha256: hash, ...file } = state.files[0]; return Response.json(file); } } });
  assert.equal((await h.create()).verification, 'size');
});
test('unknown or partial PUT never retries or deletes; only new explicit create uploads a new filename', async () => {
  for (const outcome of ['network', 500, 200, 302]) {
    let puts = 0; const names = [];
    const h = await harness({ intercept: (u, init) => {
      if (u.pathname.endsWith('/upload')) names.push(u.searchParams.get('path'));
      if (init.method === 'PUT') { puts++; if (outcome === 'network') throw TypeError('private URL'); return new Response(null, { status: outcome }); }
    } });
    await assert.rejects(h.create(), { message: UNCERTAIN }); await tick(); assert.equal(puts, 1);
    assert.equal(h.state.calls.some(c => c.method === 'DELETE'), false);
    await h.create().catch(() => {}); assert.equal(puts, 2); assert.notEqual(names[0], names[1]);
  }
});
test('metadata eventually available; bounded retries only GET, not PUT', async () => {
  let reads = 0;
  const h = await harness({ intercept: (u, _, state) => state.files.length && u.searchParams.get('path') !== 'app:/' && u.pathname === '/v1/disk/resources' && ++reads < 2 ? Response.json({}, { status: 404 }) : null });
  assert.equal((await h.create()).verification, 'sha256'); assert.equal(h.state.puts, 1); assert.equal(reads, 2);
});
test('empty list, API failures, multiple pages, foreign files and sort order', async () => {
  const h = await harness(); assert.deepEqual(await h.client.list(), { files: [], truncated: false });
  h.state.files = Array.from({ length: 101 }, (_, i) => row(filename.replace('12345678-', String(i).padStart(8, '0') + '-')));
  h.state.files.push({ ...row(), type: 'dir' }, { ...row(), name: 'kartochnaya-probe-x.txt' }, { ...row(), name: 'foreign.zip' });
  h.state.files[100].created = '2026-10-25T10:00:00Z';
  const result = await h.client.list(); assert.equal(result.files.length, 101); assert.equal(result.files[0].created, '2026-10-25T10:00:00Z'); assert.equal(result.truncated, false);
  assert.ok(h.state.calls.some(c => c.u.searchParams.get('offset') === '100'));
  const bad = await harness({ intercept: u => u.searchParams.get('path') === 'app:/' ? Response.json({}, { status: 403 }) : null });
  await assert.rejects(bad.client.list(), /403/);
});
test('bounded list reports truncation and malformed pagination fails', async () => {
  const h = await harness(); h.state.files = Array.from({ length: 1100 }, () => row());
  assert.equal((await h.client.list()).truncated, true);
  assert.equal(h.state.calls.filter(c => c.u.searchParams.has('offset')).length, 10);
  const bad = await harness({ intercept: u => u.searchParams.get('path') === 'app:/' ? Response.json({ type: 'dir', path: 'app:/', _embedded: { items: [], total: 5, offset: 0, limit: 100 } }) : null });
  await assert.rejects(bad.client.list(), /Неполный/);
});
test('cancellation of PUT yields uncertain result without retry', async () => {
  const controller = new AbortController(); let signal, puts = 0;
  const h = await harness({ intercept: (_, init) => { if (init.method === 'PUT') { puts++; signal = init.signal; controller.abort(); return new Promise((_, reject) => { init.signal.addEventListener('abort', reject, { once: true }); if (init.signal.aborted) reject(Error()); }); } } });
  await assert.rejects(h.create({ signal: controller.signal }), { message: UNCERTAIN }); assert.equal(signal.aborted, true); assert.equal(puts, 1);
});
test('separate bounded transfer timeout keeps normal API at 30s', async () => {
  const original = AbortSignal.timeout, durations = [];
  AbortSignal.timeout = function(ms) { durations.push(ms); return original.call(this, ms); };
  try { const h = await harness(); await h.create(); assert.ok(durations.includes(900000)); assert.ok(durations.includes(600000)); assert.ok(durations.includes(30000)); }
  finally { AbortSignal.timeout = original; }
});
test('operation deadline aborts request; expired session stops ZIP preparation', async () => {
  const h = await harness();
  await assert.rejects(h.oauth.operation(async op => { await new Promise(resolve => { op.signal.addEventListener('abort', resolve, { once: true }); }); op.check(); }, { timeoutMs: 10 }), /отменена/);
  const expired = await harness({ expires: 0.05 });
  await assert.rejects(expired.create({ snapshot: async () => { await new Promise(r => setTimeout(r, 65)); return snapshot(); } }), /отменена/);
  assert.equal(expired.state.puts, 0);
});
test('account switch disconnects; unavailable known identity rejects without erasing session', async () => {
  for (const id of ['account-b', null]) {
    const h = await harness();
    await assert.rejects(h.create({ snapshot: async () => { h.state.id = id; return snapshot(); } }), /Аккаунт/);
    assert.equal(h.state.puts, 0); assert.equal(h.oauth.view().connected, id === null);
  }
});
test('new authorization during snapshot cannot upload to the new account; unknown identity has no old cache', async () => {
  const h = await harness();
  await assert.rejects(h.create({ snapshot: async () => { h.oauth.disconnect(); await h.connect(); return snapshot(); } }), /отменена/); assert.equal(h.state.puts, 0);
  h.state.files = [row()]; await h.client.list();
  h.oauth.disconnect(); await h.connect(); h.state.files = []; h.state.id = null;
  assert.deepEqual(await h.client.list(), { files: [], truncated: false });
});
test('canonical server folder path is accepted only for a direct child of app folder', async () => {
  const h = await harness({ intercept: (u, _, state) => {
    if (u.searchParams.get('path') === 'app:/') return Response.json({ type: 'dir', path: 'disk:/Приложения/КАРТОЧНАЯ' });
    if (state.files.length && u.pathname === '/v1/disk/resources') return Response.json({ ...state.files[0], path: 'disk:/Приложения/КАРТОЧНАЯ/' + state.files[0].name });
  } });
  assert.equal((await h.create()).verification, 'sha256');
  assert.equal(h.state.calls.some(c => c.u.searchParams.get('path')?.startsWith('disk:/')), false);
});
test('ZIP PUT deadline actually aborts a stalled transfer and never retries it', async () => {
  const original = AbortSignal.timeout; let puts = 0, transferSignal;
  AbortSignal.timeout = function(ms) { return original.call(this, ms === 600000 ? 15 : ms); };
  try {
    const h = await harness({ intercept: (_, init) => {
      if (init.method === 'PUT') {
        puts++; transferSignal = init.signal;
        return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }));
      }
    } });
    // Keep Node alive while its unref'ed AbortSignal timer expires.
    const keepAlive = setTimeout(() => {}, 1000);
    try { await assert.rejects(h.create(), { message: UNCERTAIN }); }
    finally { clearTimeout(keepAlive); }
    assert.equal(transferSignal.aborted, true); assert.equal(puts, 1);
  } finally { AbortSignal.timeout = original; }
});
test('unavailable /info uses only current session; malformed server hashes and exhausted confirmation fail', async () => {
  const unknown = await harness({ intercept: u => u.pathname === '/info' ? Response.json({}, { status: 403 }) : null });
  assert.equal((await unknown.create()).verification, 'sha256');
  const bad = await harness({ intercept: (u, _, state) => state.files.length && u.pathname === '/v1/disk/resources' && u.searchParams.get('path') !== 'app:/' ? Response.json({ ...state.files[0], sha256: 'bad' }) : null });
  await assert.rejects(bad.create(), /Загрузка не подтверждена/);
  const absent = await harness({ intercept: (u, _, state) => state.files.length && u.pathname === '/v1/disk/resources' && u.searchParams.get('path') !== 'app:/' ? Response.json({}, { status: 404 }) : null });
  await assert.rejects(absent.create(), /Загрузка не подтверждена/); assert.equal(absent.state.puts, 1);
});

test('download-link is GET-only, exact app ZIP path, with no duplicate/additional parameters or forbidden APIs', () => {
  const url = API + '/download?path=app:/' + filename;
  assert.ok(authorizedEndpoint(url));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) assert.throws(() => authorizedEndpoint(url, method));
  for (const suffix of ['&foo=1', '&overwrite=false', '&path=app:/' + filename, '&limit=1', '&public_key=1']) assert.throws(() => authorizedEndpoint(url + suffix));
  for (const path of ['disk:/' + filename, 'app:/../' + filename, 'app:/sub/' + filename, 'app:/foreign.zip', 'app:/%2e%2e/' + filename]) assert.throws(() => authorizedEndpoint(API + '/download?path=' + path));
  for (const action of ['publish', 'unpublish', 'copy', 'move', 'permissions']) assert.throws(() => authorizedEndpoint(API + '/' + action + '?path=app:/' + filename));
});
async function downloadHarness(options = {}) {
  const backup = options.backup || await createBackup(snapshot(), { now: new Date('2026-10-01T12:00:00.000Z') });
  const state = { pulls: 0, cancelled: 0, unlocked: false, gets: 0 };
  const rootPath = options.canonical ? 'disk:/Приложения/КАРТОЧНАЯ' : 'app:/';
  const metadata = { ...row(backup.filename), path: rootPath.replace(/\/$/, '') + '/' + backup.filename, size: backup.bytes.length, created: '2026-10-24T15:00:00Z', ...(options.noHash ? {} : { sha256: await sha256(backup.bytes) }), ...options.metadata };
  let h;
  h = await harness({ expires: options.expires, intercept: async (u, init, raw) => {
    if (options.intercept) { const response = await options.intercept(u, init, raw); if (response) return response; }
    if (u.pathname.endsWith('/download')) return Response.json(options.link || { method: 'GET', href: 'https://downloader.disk.yandex.ru/zip?signature=private' }, { status: options.linkStatus || 200 });
    if (u.hostname === 'downloader.disk.yandex.ru') {
      state.gets++;
      const source = options.bytes || backup.bytes;
      let offset = 0;
      const stream = new ReadableStream({
        async pull(controller) {
          state.pulls++;
          if (options.pull) { const handled = await options.pull(controller, state, h); if (handled) return; }
          if (offset >= source.length) { controller.close(); return; }
          const end = Math.min(offset + 113, source.length); controller.enqueue(source.subarray(offset, end)); offset = end;
        },
        cancel() { state.cancelled++; },
      }, { highWaterMark: 0 });
      state.stream = stream;
      const response = new Response(stream, { status: options.status || 200, headers: options.headers || {} });
      Object.defineProperty(response, 'url', { value: options.final || 'https://mds.storage.yandex.net/zip' });
      response.arrayBuffer = () => { throw Error('unbounded arrayBuffer forbidden'); };
      return response;
    }
    if (u.searchParams.get('path') === 'app:/') {
      const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 100);
      return Response.json({ type: 'dir', path: rootPath, _embedded: { items: [metadata], offset, limit, total: 1 } });
    }
    if (u.pathname === '/v1/disk/resources') return Response.json(options.fresh ? { ...metadata, ...options.fresh } : metadata, { status: options.metadataStatus || 200 });
  } });
  const file = (await h.client.list()).files[0];
  return { ...h, transfer: state, file, backup, download: args => h.client.download({ file, maxBytes: MAX_CLOUD_BYTES, ...args }) };
}
test('bounded real chunk sequence, canonical direct-child metadata, signed GET redirect policy and actual byte progress', async () => {
  const h = await downloadHarness({ canonical: true }); const progress = [];
  const oldIDB = globalThis.indexedDB;
  globalThis.indexedDB = { open() { assert.fail('download must never access IndexedDB'); } };
  try {
    const result = await h.download({ progress: v => progress.push(v) });
    assert.deepEqual(result.bytes, h.backup.bytes); assert.equal(result.serverSha256, true);
    assert.equal(result.projects, 1); assert.equal(result.documents, 1); assert.equal(result.fonts, 1);
    assert.equal(result.createdAt, h.backup.manifest.createdAt); // upload date is deliberately different
    assert.ok(h.transfer.pulls > 10); assert.equal(h.transfer.stream.locked, false);
    const calls = h.state.calls.filter(c => c.u.hostname === 'downloader.disk.yandex.ru'); assert.equal(calls.length, 1);
    const call = calls[0]; assert.equal(new Headers(call.headers).has('Authorization'), false);
    for (const [k, v] of Object.entries({ credentials: 'omit', redirect: 'follow', cache: 'no-store', referrerPolicy: 'no-referrer', mode: 'cors' })) assert.equal(call[k], v);
    assert.equal(h.state.calls.some(c => c.u.searchParams.get('path')?.startsWith('disk:/')), false);
    assert.equal(progress[0].received, 0); assert.equal(progress.at(-1).received, h.backup.bytes.length);
    for (let n = 1; n < progress.length; n++) assert.ok(progress[n].received >= progress[n - 1].received && progress[n].received <= progress[n].total);
  } finally { globalThis.indexedDB = oldIDB; }
});
test('Content-Length absent or exact accepted; malformed/mismatched values cancel before allocation/reading', async () => {
  const h = await downloadHarness(); assert.ok((await h.download()).bytes.length);
  const valid = await downloadHarness({ headers: { 'Content-Length': String(h.backup.bytes.length) }, backup: h.backup }); assert.ok((await valid.download()).bytes.length);
  for (const value of ['0', '1', '-1', 'NaN', '12.3', '0x20', '1, 2', '9007199254740992', '']) {
    const bad = await downloadHarness({ headers: { 'Content-Length': value } });
    await assert.rejects(bad.download(), /Content-Length/); assert.equal(bad.transfer.pulls, 0); assert.equal(bad.transfer.cancelled, 1); assert.equal(bad.transfer.stream.locked, false);
  }
});
test('empty, truncated, oversized, broken streams never return partial ZIP, retry or leak the lock', async () => {
  const seed = await downloadHarness();
  for (const bytes of [new Uint8Array(), seed.backup.bytes.subarray(0, 125), new Uint8Array(seed.backup.bytes.length + 1)]) {
    const h = await downloadHarness({ backup: seed.backup, bytes });
    await assert.rejects(h.download(), /меньше|превышает/); assert.equal(h.transfer.gets, 1); assert.equal(h.transfer.stream.locked, false);
  }
  const broken = await downloadHarness({ pull(controller) { controller.error(Error('private signed URL')); return true; } });
  await assert.rejects(broken.download(), error => /Поток ZIP прерван/.test(error.message) && !/private/.test(error.message));
  assert.equal(broken.transfer.gets, 1); assert.equal(broken.transfer.stream.locked, false);
});
test('invalid link, HTTP, untrusted final host and private network failures cannot report success', async () => {
  for (const link of [{ method: 'PUT', href: 'https://storage.yandex.net/a' }, { method: 'GET', href: 'https://storage.yandex.net/a', templated: true }, { method: 'GET', href: 'https://evil.example/a' }, { method: 'GET' }]) {
    const h = await downloadHarness({ link }); await assert.rejects(h.download()); assert.equal(h.transfer.gets, 0);
  }
  for (const metadataStatus of [401, 403, 404]) { const h = await downloadHarness({ metadataStatus }); await assert.rejects(h.download(), new RegExp(String(metadataStatus))); assert.equal(h.transfer.gets, 0); }
  const bad = await downloadHarness({ final: 'https://evil.example/?signature=private' });
  await assert.rejects(bad.download(), error => /Недоверенный/.test(error.message) && !/signature/.test(error.message)); assert.equal(bad.transfer.cancelled, 1);
  const failed = await downloadHarness({ intercept: u => { if (u.hostname === 'downloader.disk.yandex.ru') throw TypeError('private token URL'); } });
  await assert.rejects(failed.download(), error => /CORS/.test(error.message) && !/private/.test(error.message));
  assert.equal(failed.state.calls.filter(c => c.u.hostname === 'downloader.disk.yandex.ru').length, 1);
});
test('fresh metadata, session provenance and strict selection reject forged/changed archives before signed link', async () => {
  for (const fresh of [{ size: 1 }, { sha256: 'invalid' }, { sha256: 'a'.repeat(64) }, { type: 'dir' }, { path: 'disk:/elsewhere/' + filename }, { name: filename }]) {
    const h = await downloadHarness({ fresh }); await assert.rejects(h.download(), /Метаданные/); assert.equal(h.transfer.gets, 0);
  }
  const h = await downloadHarness();
  await assert.rejects(h.download({ file: { ...h.file } }), /Принадлежность/);
  h.oauth.disconnect(); await h.connect(); await assert.rejects(h.download(), /Принадлежность/);
  assert.equal(h.transfer.gets, 0);
  const unknown = await downloadHarness({ intercept: u => u.pathname === '/info' ? Response.json({}, { status: 403 }) : null });
  assert.ok((await unknown.download()).bytes.length, 'same token generation still proves ownership when /info is unavailable');
  unknown.oauth.disconnect(); await unknown.connect(); await assert.rejects(unknown.download(), /Принадлежность/);
});
test('desktop/Android size budgets reject before download-link; parser reserves expanded memory', async () => {
  for (const limit of [MAX_CLOUD_BYTES, ANDROID_CLOUD_BYTES]) {
    const h = await downloadHarness({ metadata: { size: limit + 1 } });
    await assert.rejects(h.download({ maxBytes: limit }), /бюджет памяти/);
    assert.equal(h.state.calls.some(c => c.u.pathname.endsWith('/download')), false);
  }
  const h = await downloadHarness();
  await assert.rejects(h.download({ maxBytes: Infinity }), /бюджет/);
});
test('server SHA mismatch, malformed ZIP, manifest/name/scope and structural links are never accepted', async () => {
  const badHash = await downloadHarness({ metadata: { sha256: 'a'.repeat(64) } }); await assert.rejects(badHash.download(), /Серверный SHA-256/);
  const broken = await downloadHarness({ noHash: true, bytes: new Uint8Array(badHash.backup.bytes.length) }); await assert.rejects(broken.download(), /ZIP/);
  const { unzipSync, zipSync, strToU8 } = await import('fflate');
  for (const change of ['id', 'scope', 'manifest', 'links', 'hash']) {
    const files = unzipSync(badHash.backup.bytes); const m = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    if (change === 'id') m.backupId = '00000000-0000-4000-8000-000000000000';
    if (change === 'scope') m.scope = 'selected-projects';
    if (change === 'manifest') m.counts.docs = 9;
    if (change === 'hash') m.files[0].sha256 = '0'.repeat(64);
    if (change === 'links') {
      const docs = JSON.parse(new TextDecoder().decode(files['data/docs.json'])); docs[0].projectId = 'missing';
      files['data/docs.json'] = strToU8(JSON.stringify(docs));
      Object.assign(m.files.find(f => f.path === 'data/docs.json'), { bytes: files['data/docs.json'].length, sha256: await sha256(files['data/docs.json']) });
    }
    files['manifest.json'] = strToU8(JSON.stringify(m)); const bytes = zipSync(files, { level: 0 });
    const h = await downloadHarness({ backup: { ...badHash.backup, bytes }, noHash: true });
    await assert.rejects(h.download()); assert.equal(h.transfer.gets, 1);
  }
  const valid = await downloadHarness({ noHash: true }); assert.equal((await valid.download()).serverSha256, false);
});
test('cancel during pending read cancels reader, releases lock and blocks concurrent downloads', async () => {
  const controller = new AbortController(); let start;
  const started = new Promise(r => { start = r; });
  const h = await downloadHarness({ pull() { start(); return true; } });
  const pending = h.download({ signal: controller.signal }); await started;
  await assert.rejects(h.download(), /Уже скачивается/); controller.abort();
  await assert.rejects(pending, /отменена/); assert.equal(h.transfer.cancelled, 1); assert.equal(h.transfer.stream.locked, false); assert.equal(h.transfer.gets, 1);
});
test('expiry/disconnect during stream and account change at final identity discard all bytes', async () => {
  for (const action of ['disconnect', 'expire', 'account']) {
    const h = await downloadHarness({ expires: action === 'expire' ? 0.1 : 3600,
      pull(controller, state, instance) {
        if (action === 'account') { instance.state.id = 'account-b'; return false; }
        if (action === 'disconnect') instance.oauth.disconnect();
        return true;
      } });
    const keepAlive = setTimeout(() => {}, 1000);
    try { await assert.rejects(h.download(), /отменена|Аккаунт/); }
    finally { clearTimeout(keepAlive); }
    assert.equal(h.transfer.stream.locked, false); assert.equal(h.transfer.gets, 1); assert.equal(h.oauth.view().connected, false);
  }
});
test('long signed GET deadline also cancels its body; normal API still uses 30 seconds', async () => {
  const original = AbortSignal.timeout, durations = []; let signal;
  AbortSignal.timeout = function(ms) { durations.push(ms); return original.call(this, ms === 600000 ? 20 : ms); };
  try {
    const h = await downloadHarness({ intercept: (u, init) => {
      if (u.hostname !== 'downloader.disk.yandex.ru') return;
      signal = init.signal;
      const res = new Response(new ReadableStream({ start(controller) { init.signal.addEventListener('abort', () => controller.error(Error('timeout')), { once: true }); } }));
      Object.defineProperty(res, 'url', { value: 'https://mds.storage.yandex.net/zip' }); return res;
    } });
    const keepAlive = setTimeout(() => {}, 1000);
    try { await assert.rejects(h.download(), /Поток ZIP прерван/); } finally { clearTimeout(keepAlive); }
    assert.equal(signal.aborted, true); assert.ok(durations.includes(600000)); assert.ok(durations.includes(30000)); assert.ok(durations.includes(900000));
  } finally { AbortSignal.timeout = original; }
});

test('allocation failure and expanded JSON budget stop verification and cancel stream', async () => {
  const h = await downloadHarness(); const Original = globalThis.Uint8Array;
  globalThis.Uint8Array = new Proxy(Original, { construct(Target, args) { if (args.length === 1 && args[0] === h.backup.bytes.length) throw RangeError('allocation failed'); return Reflect.construct(Target, args); } });
  try { await assert.rejects(h.download(), /Недостаточно оперативной памяти/); }
  finally { globalThis.Uint8Array = Original; }
  assert.equal(h.transfer.cancelled, 1); assert.equal(h.transfer.pulls, 0);
  const data = snapshot(); data.settings = [{ key: 'big', value: 'x'.repeat(2 * 1024 * 1024) }];
  const backup = await createBackup(data);
  const { zipSync, unzipSync } = await import('fflate'); backup.bytes = zipSync(unzipSync(backup.bytes), { level: 6 });
  const expanded = await downloadHarness({ backup });
  await assert.rejects(expanded.download({ maxBytes: 1024 * 1024 }), /распаковки/); assert.equal(expanded.transfer.stream.locked, false);
});

for (const outage of ['network', '403', 'malformed']) test('F-07 known identity survives temporary /info failure: ' + outage, async () => {
  let unavailable = false;
  const h = await harness({ intercept: u => {
    if (u.pathname !== '/info' || !unavailable) return;
    if (outage === 'network') throw Error('offline');
    return Response.json(outage === 'malformed' ? { id: null } : {}, { status: outage === '403' ? 403 : 200 });
  } });
  const owner = await h.client.reserveUpload(); const generation = h.oauth.view().generation;
  const backup = await prepareWorkspaceBackup({ snapshot, preferences: () => ({}) });
  unavailable = true;
  await assert.rejects(h.client.reserveUpload(), /личность|Аккаунт/);
  assert.equal(h.oauth.view().connected, true); assert.equal(h.oauth.view().generation, generation);
  await assert.rejects(h.client.uploadPrepared(backup, { owner }), /личность|Аккаунт/); assert.equal(h.state.puts, 0);
  unavailable = false; h.state.id = 'account-b';
  await assert.rejects(h.client.uploadPrepared(backup, { owner }), /Аккаунт/);
  assert.equal(h.oauth.view().connected, false); assert.equal(h.state.puts, 0);
});
test('F-07 recovery of /info validates the original owner without reconnect', async () => {
  let down = false;
  const h = await harness({ intercept: u => { if (u.pathname === '/info' && down) throw Error('network'); } });
  const owner = await h.client.reserveUpload(); const generation = h.oauth.view().generation;
  down = true; await assert.rejects(h.client.reserveUpload()); down = false;
  const backup = await prepareWorkspaceBackup({ snapshot, preferences: () => ({}) });
  assert.equal((await h.client.uploadPrepared(backup, { owner })).confirmed, true);
  assert.equal(h.oauth.view().generation, generation); assert.equal(h.state.puts, 1);
});
test('F-07 new generation with unavailable /info never inherits old identity or owner', async () => {
  let down = false;
  const h = await harness({ intercept: u => u.pathname === '/info' && down ? Response.json({}, { status: 403 }) : null });
  const old = await h.client.reserveUpload(); h.oauth.disconnect(); await h.connect(); down = true;
  const owner = await h.client.reserveUpload();
  const backup = await prepareWorkspaceBackup({ snapshot, preferences: () => ({}) });
  await assert.rejects(h.client.uploadPrepared(backup, { owner: old }), /сеанс/);
  // If old account-a had been substituted for unknown, a later real account-b
  // would disconnect. Unknown capability must instead reject the changed ID.
  down = false; h.state.id = 'account-b';
  await assert.rejects(h.client.uploadPrepared(backup, { owner }), /Аккаунт/);
  assert.equal(h.oauth.view().connected, true); assert.equal(h.state.puts, 0);
});
for (const point of ['before ZIP', 'during ZIP', 'upload link']) test('real OAuth generation change blocks original prepared owner: ' + point, async () => {
  let h, change = false;
  h = await harness({ intercept: async u => {
    if (change && point === 'upload link' && u.pathname.endsWith('/upload')) { h.oauth.disconnect(); await h.connect(); }
  } });
  const owner = await h.client.reserveUpload(); change = true;
  if (point === 'before ZIP') { h.oauth.disconnect(); await h.connect(); }
  const backup = await prepareWorkspaceBackup({ snapshot: async () => { if (point === 'during ZIP') { h.oauth.disconnect(); await h.connect(); } return snapshot(); }, preferences: () => ({}) });
  await assert.rejects(h.client.uploadPrepared(backup, { owner })); assert.equal(h.state.puts, 0);
});
