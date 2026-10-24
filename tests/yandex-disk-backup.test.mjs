import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOAuth, authorizedEndpoint, validBackupName } from '../src/cloud/yandex-disk/oauth.mjs';
import { createYandexClient, UNCERTAIN, MAX_CLOUD_BYTES, ANDROID_CLOUD_BYTES } from '../src/cloud/yandex-disk/client.mjs';
import { readBackup, sha256, FORMAT } from '../src/backup/archive.mjs';
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
  assert.throws(() => authorizedEndpoint(API + '/download?path=app:/' + filename));
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
test('account switch or unavailable known identity after preparation disconnects before PUT', async () => {
  for (const id of ['account-b', null]) {
    const h = await harness();
    await assert.rejects(h.create({ snapshot: async () => { h.state.id = id; return snapshot(); } }), /Аккаунт/);
    assert.equal(h.state.puts, 0); assert.equal(h.oauth.view().connected, false);
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
