import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveAccounts, ACCOUNTS_KEY } from '../src/cloud/google-drive/accounts.mjs';
import { createDriveSession, CLIENT_ID_KEY, DRIVE_SCOPE } from '../src/cloud/google-drive/session.mjs';
import { prepareDriveBackup } from '../src/cloud/google-drive/client.mjs';
import { readBackup, readPreferences, sha256 } from '../src/backup/archive.mjs';
const ID = 'test.apps.googleusercontent.com';
const tick = () => new Promise(r => setTimeout(r, 0));
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const snapshot = () => ({ projects: [], docs: [], fonts: [], settings: [] });
function harness(t, options = {}) {
  const values = new Map([[CLIENT_ID_KEY, ID]]), clouds = new Map(), calls = [];
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  let picked = 'A', prepares = 0, snapshots = 0, failure = null;
  const manager = createDriveAccounts({ storage,
    prepareBackup: async opts => { prepares++; return prepareDriveBackup(opts); },
    sessionFactory: opts => createDriveSession({ ...opts, online: () => true, supported: () => true,
      load: async () => ({ initTokenClient(config) { return { requestAccessToken() { config.callback({ access_token: 'secret-' + picked, expires_in: 3600, scope: DRIVE_SCOPE }); } }; } }),
      request: async (url, init) => {
        const account = new Headers(init.headers).get('Authorization').replace('Bearer secret-', '');
        const u = new URL(url), method = init.method; calls.push({ account, path: u.pathname, method });
        if (u.pathname.endsWith('/about')) return json({ user: { permissionId: account, displayName: 'Google ' + account } });
        let cloud = clouds.get(account); if (!cloud) clouds.set(account, cloud = { folder: null, files: [], bytes: [] });
        assert.ok(!['PATCH', 'DELETE'].includes(method));
        if (u.pathname === '/drive/v3/files') {
          if (method === 'POST') { cloud.folder = { ...JSON.parse(init.body), id: 'folder-' + account }; return json(cloud.folder); }
          return json({ files: u.searchParams.get('q').includes("mimeType = 'application/vnd.google-apps.folder'") ? cloud.folder ? [cloud.folder] : [] : cloud.files });
        }
        if (u.pathname === '/upload/drive/v3/files') {
          if (method === 'POST') {
            if (failure === account) return json({}, 403);
            cloud.meta = JSON.parse(init.body); assert.deepEqual(cloud.meta.parents, ['folder-' + account]);
            return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + account } });
          }
          assert.equal(u.searchParams.get('upload_id'), account);
          cloud.bytes.push(init.body); cloud.files.push({ ...cloud.meta, id: 'file-' + account, size: String(init.body.length) });
          return json({ id: 'file-' + account }, 201);
        }
        if (u.pathname.endsWith('/folder-' + account)) return json(cloud.folder);
        assert.equal(u.pathname, '/drive/v3/files/file-' + account);
        if (u.searchParams.get('alt') === 'media') return new Response(cloud.bytes[0], { headers: { 'Content-Length': String(cloud.bytes[0].length) } });
        return json(cloud.files[0]);
      },
    }),
  });
  manager.reload(); t.after(() => manager.close());
  return { manager, storage, values, clouds, calls,
    async connect(id, target = null) { picked = id; await manager.authorize(target); manager.authorize(target); await tick(); },
    async copies(ids) { return manager.createCopies(ids, { snapshot: () => { snapshots++; return snapshot(); }, preferences: () => readPreferences(storage) }); },
    counts: () => ({ prepares, snapshots }), fail: id => { failure = id; },
  };
}
test('two accounts keep distinct live OAuth sessions; adding the same ID preserves its session', async t => {
  const h = harness(t); await h.connect('A'); const first = h.manager.get('A').session;
  await h.connect('B'); await h.connect('A');
  assert.equal(h.manager.list().length, 2); assert.equal(h.manager.get('A').session, first);
  assert.notEqual(first, h.manager.get('B').session);
  for (const a of h.manager.list()) { assert.equal(a.session.view().status, 'connected'); await h.manager.task(a.id, op => a.client.list(op)); }
  assert.deepEqual(h.calls.filter(c => c.path === '/drive/v3/files').map(c => c.account), ['A', 'B']);
  const durable = JSON.stringify([...h.values]); assert.ok(!durable.includes('secret-')); assert.ok(!JSON.stringify(first.view()).includes('secret-'));
});
test('one snapshot, ZIP verification and whole-file digest serve three sequential uploads; folders, lists and downloads stay isolated', async t => {
  const h = harness(t); for (const id of ['A', 'B', 'C']) await h.connect(id);
  assert.deepEqual(await h.copies(['A', 'B', 'C']), ['A', 'B', 'C'].map(id => ({ id, saved: true })));
  assert.deepEqual(h.counts(), { prepares: 1, snapshots: 1 });
  const bytes = h.clouds.get('A').bytes[0]; await readBackup(bytes);
  for (const id of ['A', 'B', 'C']) {
    const cloud = h.clouds.get(id); assert.equal(cloud.bytes[0].buffer, bytes.buffer); assert.deepEqual(cloud.bytes[0], bytes);
    assert.equal(cloud.meta.appProperties.sha256, await sha256(bytes));
    await h.manager.task(id, async (op, a) => { assert.deepEqual((await a.client.list(op)).map(f => f.id), ['file-' + id]); assert.deepEqual((await a.client.download(op, 'file-' + id)).bytes, bytes); });
  }
  assert.deepEqual(h.calls.filter(c => c.path === '/upload/drive/v3/files' && c.method === 'POST').map(c => c.account), ['A', 'B', 'C']);
});
test('a second-account error does not prevent the third upload or remove successful files', async t => {
  const h = harness(t); for (const id of ['A', 'B', 'C']) await h.connect(id); h.fail('B');
  assert.deepEqual((await h.copies(['A', 'B', 'C'])).map(r => r.saved), [true, false, true]);
  assert.equal(h.clouds.get('A').files.length, 1); assert.equal(h.clouds.get('C').files.length, 1);
  assert.equal(h.manager.get('A').session.view().status, 'connected'); assert.match(h.manager.get('B').result, /403/);
});
test('removing an account aborts only its operations and never deletes Drive files', async t => {
  const h = harness(t); await h.connect('A'); await h.connect('B'); await h.copies(['A', 'B']);
  let signal;
  const pending = h.manager.task('A', op => { signal = op.signal; return new Promise(() => {}); });
  const rejected = assert.rejects(pending, /прервана/); h.manager.remove('A'); await rejected;
  assert.ok(signal.aborted); assert.equal(h.clouds.get('A').files.length, 1); assert.equal(h.manager.get('B').session.view().status, 'connected');
  assert.equal(h.manager.get('A'), undefined); assert.ok(h.calls.every(c => c.method !== 'DELETE'));
});
test('reload restores allowlisted registry metadata and old Client ID, never tokens or implicit OAuth', async t => {
  const h = harness(t); await h.connect('A'); await h.connect('B'); const before = h.calls.length;
  const next = createDriveAccounts({ storage: h.storage, sessionFactory: opts => createDriveSession({ ...opts, online: () => true, supported: () => true, load: () => assert.fail('implicit OAuth') }) });
  next.reload(); t.after(() => next.close()); assert.equal(next.view().clientId, ID);
  assert.equal(h.storage.getItem(CLIENT_ID_KEY), ID); assert.equal(next.list().length, 2); assert.equal(h.calls.length, before);
  for (const a of next.list()) { assert.equal(a.session.view().status, 'disconnected'); await assert.rejects(a.session.withDriveOperation(() => assert.fail()), /повторно/); }
  for (const row of JSON.parse(h.storage.getItem(ACCOUNTS_KEY))) assert.deepEqual(Object.keys(row), ['provider', 'id', 'name', 'clientId']);
});
test('reconnecting with a foreign identity cannot rebind or replace the original live session', async t => {
  const h = harness(t); await h.connect('A'); const original = h.manager.get('A').session;
  await h.connect('B', 'A'); assert.equal(h.manager.get('A').session, original); assert.equal(original.view().status, 'connected');
  assert.equal(h.manager.get('B'), undefined); assert.match(h.manager.view().authorization.message, /другой Google-аккаунт/);
  await h.connect('A', 'A'); assert.equal(h.manager.list().length, 1); assert.equal(h.manager.get('A').session.view().status, 'connected');
  const saved = h.manager.get('A').session, write = h.storage.setItem; h.storage.setItem = () => { throw Error('quota'); };
  await h.connect('A', 'A'); h.storage.setItem = write;
  assert.equal(h.manager.get('A').session, saved); assert.equal(saved.view().status, 'connected'); assert.match(h.manager.view().message, /Не удалось сохранить список/);
});
test('removal during shared ZIP preparation cancels that recipient without affecting others', async t => {
  const h = harness(t); await h.connect('A'); await h.connect('B'); let resume;
  const pending = h.manager.createCopies(['A', 'B'], { snapshot: () => new Promise(r => { resume = r; }), preferences: () => ({}) });
  h.manager.remove('A'); resume(snapshot()); assert.deepEqual((await pending).map(r => r.saved), [false, true]);
});

async function verifiedAccount(t) {
  const h = harness(t); await h.connect('A'); await h.connect('B'); await h.copies(['A', 'B']);
  await h.manager.downloadArchive('A', 'file-A'); return h;
}
test('verified ZIP belongs to its exact record/session/ID; handoff has one byte owner and makes no Drive request', async t => {
  const h = await verifiedAccount(t), a = h.manager.get('A'), bytes = a.verified.bytes;
  assert.equal(h.manager.get('B').verified, null); assert.throws(() => h.manager.takeArchive('B'), /исходного/);
  const before = h.calls.length, lease = h.manager.takeArchive('A');
  assert.equal(lease.bytes, bytes); assert.equal(a.verified, null); assert.equal(h.calls.length, before); lease.check();
  assert.throws(() => h.manager.takeArchive('A'), /исходного/);
  h.manager.disconnect('B'); lease.check();
  h.manager.disconnect('A'); assert.ok(lease.signal.aborted); assert.throws(lease.check, /исходного/);
});
for (const reason of ['reauthorize', 'duplicate', 'clientId', 'remove', 'expire', 'session', 'record', 'identity', 'archive']) test('cloud lease revoked after handoff: ' + reason, async t => {
  const h = await verifiedAccount(t), a = h.manager.get('A'), original = a.session, lease = h.manager.takeArchive('A');
  if (reason === 'reauthorize') { await h.connect('A', 'A'); assert.notEqual(a.session, original); assert.equal(a.session.view().accountId, 'A'); }
  if (reason === 'duplicate') { await h.connect('A'); assert.equal(a.session, original); }
  if (reason === 'clientId') h.manager.configure('new.apps.googleusercontent.com');
  if (reason === 'remove') h.manager.remove('A');
  if (reason === 'expire') { t.mock.timers.enable({ apis: ['Date'], now: original.view().expiresAt + 1 }); h.manager.checkExpiry(); }
  if (reason === 'session') { a.session = h.manager.get('B').session; h.manager.networkChanged(); a.session = original; }
  if (reason === 'record') { h.manager.remove('A'); await h.connect('A'); assert.notEqual(h.manager.get('A'), a); }
  if (reason === 'identity') { const view = original.view; original.view = () => ({ ...view(), accountId: 'B' }); h.manager.networkChanged(); original.view = view; }
  if (reason === 'archive') await h.manager.downloadArchive('B', 'file-B');
  assert.ok(lease.signal.aborted); assert.throws(lease.check, /исходного/); assert.equal(a.verified, null);
});
test('switching selection during an awaited download prevents a stale result from retaining bytes', async t => {
  const h = await verifiedAccount(t), a = h.manager.get('A'), original = a.client.download;
  let release, started; const gate = new Promise(r => { release = r; }), ready = new Promise(r => { started = r; });
  a.client.download = async (...args) => { const result = await original(...args); started(); await gate; return result; };
  const pending = h.manager.downloadArchive('A', 'file-A'); await ready;
  h.manager.clearArchive(); await h.manager.downloadArchive('B', 'file-B'); const b = h.manager.get('B').verified;
  release(); await assert.rejects(pending, /исходного/);
  assert.equal(a.verified, null); assert.equal(h.manager.get('B').verified, b); h.manager.checkArchive();
  h.manager.disconnect('A'); assert.equal(h.manager.get('B').verified, b);
});
test('a different download frees the previous active verified buffer and stale verified assignment fails closed', async t => {
  const h = await verifiedAccount(t), a = h.manager.get('A');
  await h.manager.downloadArchive('B', 'file-B'); assert.equal(a.verified, null);
  h.manager.get('B').verified = { bytes: new Uint8Array() }; assert.throws(() => h.manager.takeArchive('B'), /исходного/);
});
