import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudCoordinator } from '../src/backup/cloud-coordinator.mjs';
import { prepareWorkspaceBackup, preparedDigest } from '../src/backup/prepared.mjs';
import { createBackup, readBackup, sha256 } from '../src/backup/archive.mjs';
import { createDriveAccounts, ACCOUNTS_KEY } from '../src/cloud/google-drive/accounts.mjs';
import { CLIENT_ID_KEY } from '../src/cloud/google-drive/session.mjs';
import { createYandexClient, UNCERTAIN, ANDROID_CLOUD_BYTES } from '../src/cloud/yandex-disk/client.mjs';
const snapshot = () => ({ projects: [{ id: 'p', name: 'Project' }], docs: [{ id: 'd', projectId: 'p', width: 320, height: 240, elements: [] }], fonts: [], settings: [] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(options = {}) {
  const calls = [], reserved = new Set(), counts = { snapshots: 0, creates: 0, reads: 0 }, generations = new Map();
  const names = ['google:A', 'google:B', 'yandex'];
  const provider = { recipients: () => names.map(id => ({ id, name: id, available: !reserved.has(id), maxBytes: options.limit?.[id] || 256 * 1024 * 1024,
    async reserve(signal) {
      if (options.reserve) await options.reserve(id, signal);
      const generation = generations.get(id); reserved.add(id); calls.push(['reserve', id]);
      const check = () => { if (generation !== generations.get(id)) throw Error('Сеанс изменился'); signal.throwIfAborted(); };
      return { check, release: () => { calls.push(['release', id]); reserved.delete(id); }, async upload(backup, progress) {
        check(); calls.push(['upload', id, backup]); progress({ phase: 'verify', message: 'metadata' });
        if (options.upload) return options.upload(id, backup, signal);
        return { confirmed: true };
      } };
    },
  })) };
  const coordinator = createCloudCoordinator({ providers: options.noClouds ? [] : [provider], preferences: () => ({ 'kartochnaya-ink-v1': 'test' }),
    snapshot: async () => { counts.snapshots++; assert.equal(reserved.size, options.expectedReserved ?? options.selected?.length ?? 0); if (options.snapshot) return options.snapshot(); return snapshot(); },
    prepare: opts => prepareWorkspaceBackup({ ...opts, create: async (...args) => { counts.creates++; const backup = await createBackup(...args); if (options.corrupt) backup.bytes[40] ^= 1; return backup; }, read: bytes => { counts.reads++; return readBackup(bytes); } }),
    assertAvailable: options.assertAvailable,
  });
  return { coordinator, calls, counts, reserved, generations };
}
for (const selected of [['google:A', 'google:B', 'yandex'], ['google:A'], ['yandex'], []]) test('one verified ZIP, identical references and digest: ' + selected, async () => {
  const h = harness({ selected }); const result = await h.coordinator.run(selected);
  assert.deepEqual(h.counts, { snapshots: 1, creates: 1, reads: 1 }); assert.equal(result.results.filter(r => r.state === 'confirmed').length, selected.length);
  const uploads = h.calls.filter(c => c[0] === 'upload');
  for (const [, , backup] of uploads) { assert.equal(backup, uploads[0][2]); assert.equal(backup.bytes, uploads[0][2].bytes); assert.equal(backup.manifest, uploads[0][2].manifest); assert.equal(backup.filename, result.archive.filename); assert.equal(backup.manifest.backupId, result.archive.backupId); assert.equal(await sha256(backup.bytes), result.archive.sha256); }
  let local; await h.coordinator.save(async blob => { local = new Uint8Array(await blob.arrayBuffer()); }); assert.equal(await sha256(local), result.archive.sha256);
  assert.deepEqual((await readBackup(local)).data.docs, snapshot().docs); assert.equal(h.reserved.size, 0);
  assert.ok(!JSON.stringify(result).includes('token')); h.coordinator.finish(); assert.equal(h.coordinator.view().archive, null);
});
test('no accounts and local only never invoke provider or network', async () => { const h = harness({ noClouds: true }); await h.coordinator.run([]); assert.equal(h.calls.length, 0); assert.ok(h.coordinator.view().archive); });
for (const failure of ['IndexedDB', 'CRC', 'size']) test('preparation failure prevents every cloud upload: ' + failure, async () => {
  const selected = ['google:A', 'yandex']; const h = harness({ selected, snapshot: failure === 'IndexedDB' ? () => { throw Error('IndexedDB отказ'); } : undefined, corrupt: failure === 'CRC', limit: failure === 'size' ? { yandex: 1 } : undefined });
  const v = await h.coordinator.run(selected); assert.equal(h.calls.filter(c => c[0] === 'upload').length, 0); assert.equal(h.reserved.size, 0);
  if (failure === 'IndexedDB') assert.equal(h.counts.creates, 0); if (failure === 'size') assert.match(v.message, /Исключи/);
});
test('Android limit blocks Google too before first transfer', async () => {
  let uploads = 0;
  const c = createCloudCoordinator({ snapshot, preferences: () => ({}), providers: [{ recipients: () => ['google', 'yandex'].map(id => ({ id, available: true, maxBytes: id === 'yandex' ? ANDROID_CLOUD_BYTES : 256 * 1024 * 1024, reserve: () => ({ release() {}, check() {}, upload() { uploads++; } }) })) }], prepare: async () => ({ bytes: { byteLength: ANDROID_CLOUD_BYTES + 1 }, manifest: {}, filename: 'large.zip' }) });
  await c.run(['google', 'yandex']); assert.equal(uploads, 0); assert.match(c.view().message, /128 МиБ/);
});
for (const failed of ['google:A', 'yandex']) test('partial failure remains independent and never retries: ' + failed, async () => {
  const selected = ['google:A', 'google:B', 'yandex']; const h = harness({ selected, upload: id => { if (id === failed) throw Error(id === 'yandex' ? UNCERTAIN : 'HTTP 403'); return { confirmed: true }; } });
  const v = await h.coordinator.run(selected); assert.equal(v.results.filter(r => r.state === 'confirmed').length, 2); assert.equal(v.results.find(r => r.id === failed).state, 'unconfirmed');
  assert.equal(h.calls.filter(c => c[0] === 'upload' && c[1] === failed).length, 1); if (failed === 'yandex') assert.match(v.results.at(-1).detail, /мог сохраниться/);
});
for (const id of ['google:A', 'yandex']) test('disconnect or replacement session during preparation cannot substitute selected recipient: ' + id, async () => {
  const selected = ['google:A', 'yandex'], gate = deferred(); const h = harness({ selected, snapshot: async () => { await gate.promise; return snapshot(); } });
  const pending = h.coordinator.run(selected); await new Promise(r => setTimeout(r, 0)); h.generations.set(id, 2); gate.resolve(); const v = await pending;
  assert.equal(v.results.find(r => r.id === id).state, 'reconnect'); assert.ok(!h.calls.some(c => c[0] === 'upload' && c[1] === id));
});
test('cancel aborts active upload, preserves confirmation and stops all unstarted destinations', async () => {
  const selected = ['google:A', 'google:B', 'yandex'], started = deferred(); const h = harness({ selected, upload: async (id, _, signal) => { if (id === 'google:A') return { confirmed: true }; started.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw Error('Передача прервана; архив мог сохраниться'); } });
  const pending = h.coordinator.run(selected); await started.promise; h.coordinator.cancel(); const v = await pending;
  assert.deepEqual(v.results.map(r => r.state), ['confirmed', 'unconfirmed', 'cancelled']); assert.equal(h.reserved.size, 0);
});
test('cancel preparation releases all leases and a new explicit run creates new backupId', async () => {
  const selected = ['google:A'], gate = deferred(); const h = harness({ selected, snapshot: async () => { await gate.promise; return snapshot(); } });
  const pending = h.coordinator.run(selected); await new Promise(r => setTimeout(r, 0)); h.coordinator.cancel(); gate.resolve(); const v = await pending; assert.equal(v.results[0].state, 'cancelled');
  const id = v.archive.backupId; h.coordinator.finish(); await h.coordinator.run(selected); assert.notEqual(h.coordinator.view().archive.backupId, id);
});
test('prepared restore guard runs before reservation and snapshot', async () => {
  const h = harness({ assertAvailable: () => { throw Error('Отмени восстановление'); } }); await assert.rejects(h.coordinator.run(['google:A']), /восстановление/); assert.equal(h.calls.length, 0); assert.equal(h.counts.snapshots, 0);
});
test('invalid destinations and competing runs cannot bypass preflight', async () => {
  const h = harness(); await assert.rejects(h.coordinator.run(['missing'])); assert.equal(h.counts.creates, 0);
  await h.coordinator.run([]); await assert.rejects(h.coordinator.run([]), /заверши/); h.coordinator.finish();
});

test('real Google manager reservation pins record, account ID, generation and expiry without invalidating restore lease', async () => {
  const data = new Map([[CLIENT_ID_KEY, 'test.apps.googleusercontent.com'], [ACCOUNTS_KEY, JSON.stringify([{ provider: 'google-drive', id: 'A', name: 'A' }])]]);
  let state = { status: 'connected', accountId: 'A', generation: 1, expiresAt: Date.now() + 100000 };
  const manager = createDriveAccounts({ storage: { getItem: k => data.get(k), setItem() {} }, sessionFactory: () => ({ configure() {}, disconnect() {}, view: () => state, withDriveOperation: action => action({ check() {} }) }), clientFactory: () => ({ reset() {}, upload: async () => ({ id: 'file' }) }) }); manager.reload();
  const c = new AbortController(), lease = manager.reserveUpload('A', c.signal); assert.ok(manager.get('A').operation);
  await assert.rejects(manager.task('A', () => assert.fail()), /дождись/); assert.throws(() => manager.reserveUpload('A', c.signal));
  state = { ...state, generation: 2 }; assert.throws(lease.check, /сеанс/); lease.release(); assert.equal(manager.get('A').operation, null);
  state = { ...state, accountId: 'B' }; assert.throws(() => manager.reserveUpload('A', c.signal)); manager.close();
});
function yandex() {
  let generation = 1, id = 'A', file, puts = 0, uncertain = false;
  const oauth = { view: () => ({ connected: true, busy: false, generation }), disconnect() { generation++; }, async operation(action, { signal } = {}) {
    const original = generation; const check = () => { signal?.throwIfAborted(); if (original !== generation) throw Error('сеанс изменился'); };
    return action({ check, signal: signal || new AbortController().signal, request: async (value, init = {}) => { check(); const u = new URL(value); if (u.pathname === '/info') return Response.json({ id });
      if (u.pathname.endsWith('/upload')) { file = { name: u.searchParams.get('path').slice(5), path: u.searchParams.get('path'), type: 'file', created: new Date().toISOString() }; return Response.json({ method: 'PUT', href: 'https://uploader1d.dst.yandex.net/test' }); }
      if (init.method === 'PUT') { puts++; if (uncertain) throw Error('network'); Object.assign(file, { size: init.body.length, sha256: await sha256(init.body) }); return new Response(null, { status: 201 }); }
      return Response.json(u.searchParams.get('path') === 'app:/' ? { type: 'dir', path: 'app:/' } : file);
    } });
  } };
  return { client: createYandexClient(oauth), changeSession() { generation++; }, changeAccount(value = 'B') { id = value; }, uncertain() { uncertain = true; }, puts: () => puts };
}
test('Yandex prepared interface confirms metadata, accepts only verified objects and never retries uncertain PUT', async () => {
  const h = yandex(), signal = new AbortController().signal, owner = await h.client.reserveUpload({ signal });
  const raw = await createBackup(snapshot()); await assert.rejects(h.client.uploadPrepared(raw, { owner, signal }), /проверенный/);
  const backup = await prepareWorkspaceBackup({ snapshot, preferences: () => ({}) }); assert.ok(preparedDigest(backup));
  assert.equal((await h.client.uploadPrepared(backup, { owner, signal })).confirmed, true); assert.equal(h.puts(), 1);
  await assert.rejects(h.client.uploadPrepared(backup, { owner, signal }), /уже отправлялся/); assert.equal(h.puts(), 1);
  const unknown = yandex(), selected = await unknown.client.reserveUpload({ signal }); unknown.uncertain();
  await assert.rejects(unknown.client.uploadPrepared(backup, { owner: selected, signal }), { message: UNCERTAIN });
  await assert.rejects(unknown.client.uploadPrepared(backup, { owner: selected, signal }), /уже отправлялся/); assert.equal(unknown.puts(), 1);
});
for (const change of ['changeSession', 'changeAccount']) test('Yandex prepared interface refuses changed owner: ' + change, async () => {
  const h = yandex(), signal = new AbortController().signal, owner = await h.client.reserveUpload({ signal }); h[change]();
  const backup = await prepareWorkspaceBackup({ snapshot, preferences: () => ({}) }); await assert.rejects(h.client.uploadPrepared(backup, { owner, signal })); assert.equal(h.puts(), 0);
});

// Preserve the existing app_folder-only authorization model: /info may be unavailable.
test('initially unknown Yandex identity is confined to the original OAuth generation', async () => {
  const h = yandex(), signal = new AbortController().signal; h.changeAccount(null);
  const owner = await h.client.reserveUpload({ signal });
  const backup = await prepareWorkspaceBackup({ snapshot, preferences: () => ({}) });
  assert.equal((await h.client.uploadPrepared(backup, { owner, signal })).confirmed, true);
  h.changeSession(); await assert.rejects(h.client.uploadPrepared(backup, { owner, signal }), /сеанс/); assert.equal(h.puts(), 1);
});

for (const failed of ['yandex', 'google:A', 'google:B', 'all']) test('reserve isolation, one ZIP and release of every acquired lease: ' + failed, async () => {
  const selected = ['google:A', 'google:B', 'yandex'];
  const failures = failed === 'all' ? selected : [failed];
  const h = harness({ selected, expectedReserved: 3 - failures.length, reserve: id => { if (failures.includes(id)) throw Error('network reserve ' + id); } });
  const v = await h.coordinator.run(selected);
  assert.deepEqual(v.results.map(r => r.state), selected.map(id => failures.includes(id) ? 'unconfirmed' : 'confirmed'));
  assert.deepEqual(h.counts, { snapshots: 1, creates: 1, reads: 1 });
  assert.deepEqual(h.calls.filter(c => c[0] === 'release').map(c => c[1]), selected.filter(id => !failures.includes(id)));
  assert.equal(h.reserved.size, 0); assert.equal(v.busy, false);
  const uploads = h.calls.filter(c => c[0] === 'upload');
  assert.deepEqual(uploads.map(c => c[1]), selected.filter(id => !failures.includes(id)));
  let local; await h.coordinator.save(async blob => { local = new Uint8Array(await blob.arrayBuffer()); });
  for (const [, , backup] of uploads) { assert.deepEqual(backup.bytes, local); assert.equal(preparedDigest(backup), await sha256(local)); }
  h.coordinator.finish(); assert.deepEqual(h.coordinator.view().results, []);
});
test('lease invalidated while reserving next recipient fails independently before ZIP', async () => {
  const selected = ['google:A', 'google:B', 'yandex']; let h;
  h = harness({ selected, reserve: id => { if (id === 'yandex') h.generations.set('google:A', 2); } });
  const v = await h.coordinator.run(selected);
  assert.deepEqual(v.results.map(r => r.state), ['reconnect', 'confirmed', 'confirmed']);
  assert.deepEqual(h.counts, { snapshots: 1, creates: 1, reads: 1 }); assert.equal(h.reserved.size, 0);
});
test('cancel during reserve releases previous and late returned leases, no snapshot or uploads', async () => {
  const gate = deferred(), entered = deferred(), selected = ['google:A', 'google:B', 'yandex'];
  const h = harness({ selected, reserve: async id => { if (id === 'google:B') { entered.resolve(); await gate.promise; } } });
  const run = h.coordinator.run(selected); await entered.promise; h.coordinator.cancel(); gate.resolve(); const v = await run;
  assert.deepEqual(v.results.map(r => r.state), ['cancelled', 'cancelled', 'cancelled']);
  assert.deepEqual(h.calls.filter(c => c[0] === 'release').map(c => c[1]), ['google:A', 'google:B']);
  assert.equal(h.reserved.size, 0); assert.equal(h.counts.snapshots, 0); assert.ok(!h.calls.some(c => c[0] === 'upload'));
});
test('failed recipient retains its size budget in common preflight', async () => {
  const selected = ['google:A', 'yandex'];
  const h = harness({ selected, expectedReserved: 1, limit: { yandex: 1 }, reserve: id => { if (id === 'yandex') throw Error('network'); } });
  const v = await h.coordinator.run(selected);
  assert.match(v.message, /Исключи/); assert.ok(!h.calls.some(c => c[0] === 'upload')); assert.equal(h.reserved.size, 0);
});

test('global workspace invalidation after ZIP blocks every recipient', async () => {
  const selected = ['google:A', 'google:B', 'yandex']; let available = true;
  const h = harness({ selected, assertAvailable: () => { if (!available) throw Error('workspace replacement'); }, snapshot: () => { available = false; return snapshot(); } });
  const v = await h.coordinator.run(selected);
  assert.match(v.message, /workspace replacement/); assert.ok(!h.calls.some(c => c[0] === 'upload')); assert.equal(h.reserved.size, 0);
});
test('global workspace invalidation between transfers preserves confirmed destination', async () => {
  const selected = ['google:A', 'google:B', 'yandex']; let available = true;
  const h = harness({ selected, assertAvailable: () => { if (!available) throw Error('Web Locks lost'); }, upload: () => { available = false; return { confirmed: true }; } });
  const v = await h.coordinator.run(selected);
  assert.deepEqual(v.results.map(r => r.state), ['confirmed', 'unconfirmed', 'unconfirmed']);
  assert.deepEqual(h.calls.filter(c => c[0] === 'upload').map(c => c[1]), ['google:A']); assert.equal(h.reserved.size, 0);
});
test('known recipient unavailable at start is isolated, malformed set stays global', async () => {
  const selected = ['google:A', 'google:B', 'yandex']; const h = harness({ selected, expectedReserved: 3 });
  h.reserved.add('google:A'); // Simulate a separately owned operation; never claim/release it.
  const v = await h.coordinator.run(selected);
  assert.deepEqual(v.results.map(r => r.state), ['reconnect', 'confirmed', 'confirmed']);
  assert.deepEqual([...h.reserved], ['google:A']);
  h.coordinator.finish();
  for (const ids of [null, {}, [''], [5], ['missing']]) await assert.rejects(h.coordinator.run(ids));
});
test('abort rejecting an in-flight reservation releases every earlier lease', async () => {
  const entered = deferred(), selected = ['google:A', 'google:B', 'yandex'];
  const h = harness({ selected, reserve: async (id, signal) => { if (id === 'google:B') { entered.resolve(); await new Promise(r => signal.addEventListener('abort', r, { once: true })); signal.throwIfAborted(); } } });
  const pending = h.coordinator.run(selected); await entered.promise; h.coordinator.cancel(); const v = await pending;
  assert.deepEqual(v.results.map(r => r.state), ['cancelled', 'cancelled', 'cancelled']); assert.equal(h.counts.snapshots, 0); assert.equal(h.reserved.size, 0);
});
