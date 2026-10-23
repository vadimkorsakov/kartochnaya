import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDatabase, runStoreTransaction } from '../src/storage/indexeddb.mjs';
import { readWorkspaceSnapshot } from '../src/backup/storage.mjs';
import { createBackup, readBackup, STORES } from '../src/backup/archive.mjs';
import { replaceWorkspace, createReplacementSession, applyWorkspacePreferences } from '../src/backup/replace.mjs';

const old = { projects: [{ id: 'old' }], docs: [{ id: 'old-doc', projectId: 'old', width: 320, height: 240, elements: [] }], fonts: [{ id: 'old-font', data: 'data:font/ttf;base64,AA==' }], settings: [{ key: 'old-setting', value: 42 }] };
const incoming = {
  projects: [{ id: 'one', createdAt: 12, future: { keep: [1] } }, { id: 'two' }],
  docs: [{ id: 'a', projectId: 'one', width: 320, height: 240, elements: [], unknown: true }, { id: 'b', projectId: 'two', width: 320, height: 240, elements: [], updatedAt: 123 }],
  fonts: [{ id: 'font', data: 'data:font/ttf;base64,AA==', future: 4 }],
  settings: [{ key: 'shapes-v1', sections: [] }, { key: 'unknown', value: ['raw'] }],
};
async function database() {
  const db = await openDatabase({ indexedDB: new IDBFactory() });
  await runStoreTransaction(db, STORES, 'readwrite', s => { for (const name of STORES) for (const row of old[name]) s(name).put(row); });
  return db;
}
test('replacement preserves original IDs, dates, unknown fields, fonts and settings', async () => {
  const db = await database(); const zip = await createBackup(incoming);
  await replaceWorkspace(db, zip.bytes, old);
  assert.deepEqual(await readWorkspaceSnapshot(db), incoming); db.close();
});
test('reject selection, invalid ZIP and missing safety snapshot before any write', async () => {
  const db = await database();
  await assert.rejects(replaceWorkspace(db, (await createBackup(incoming, { selectedIds: ['one'] })).bytes, old), /workspace/);
  await assert.rejects(replaceWorkspace(db, new Uint8Array(3), old));
  await assert.rejects(replaceWorkspace(db, (await createBackup(incoming)).bytes));
  assert.deepEqual(await readWorkspaceSnapshot(db), old); db.close();
});
test('drift check aborts inside write transaction before clearing', async () => {
  const db = await database();
  await runStoreTransaction(db, ['settings'], 'readwrite', s => { s('settings').put({ key: 'changed' }); });
  const before = await readWorkspaceSnapshot(db);
  await assert.rejects(replaceWorkspace(db, (await createBackup(incoming)).bytes, old));
  assert.deepEqual(await readWorkspaceSnapshot(db), before); db.close();
});
test('abort after successful requests rolls back all four stores', async () => {
  const db = await database(), tx = db.transaction.bind(db); let successes = 0; const patched = new WeakSet();
  db.transaction = (...args) => {
    const t = tx(...args);
    if (args[1] === 'readwrite') {
      const objectStore = t.objectStore.bind(t);
      t.objectStore = name => {
        const s = objectStore(name); if (patched.has(s)) return s; patched.add(s); const put = s.put.bind(s);
        s.put = row => { const r = put(row); r.addEventListener('success', () => { if (++successes === 2) t.abort(); }); return r; }; return s;
      };
    } return t;
  };
  await assert.rejects(replaceWorkspace(db, (await createBackup(incoming)).bytes, old));
  assert.equal(successes, 2); assert.deepEqual(await readWorkspaceSnapshot(db), old); db.close();
});
test('empty workspace is committed without generated records; unavailable IDB rejects', async () => {
  const db = await database(), empty = { projects: [], docs: [], fonts: [{ id: 'old-font', data: 'data:font/ttf;base64,AA==' }], settings: [{ key: 'old-setting', value: 42 }] };
  const zip = await createBackup(empty);
  await replaceWorkspace(db, zip.bytes, old); assert.deepEqual(await readWorkspaceSnapshot(db), empty);
  db.close(); await assert.rejects(replaceWorkspace(db, zip.bytes, empty));
});
function session(db, overrides = {}) {
  let safety, stopped = false, reloaded = false, ended = 0;
  const values = new Map([['token', 'private']]);
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const operation = createReplacementSession({ db: () => db, begin: () => readWorkspaceSnapshot(db), end: () => { ended++; }, storage,
    download: blob => { safety = blob; }, stop: () => { stopped = true; }, reload: () => { reloaded = true; }, ...overrides });
  return { operation, storage, values, downloaded: () => !!safety, safety: async () => new Uint8Array(await safety.arrayBuffer()), stopped: () => stopped, reloaded: () => reloaded, ended: () => ended };
}
test('U1/U2: preparation alone authorizes one commit, with no ZIP generated or downloaded', async () => {
  const db = await database(), x = session(db);
  const prefs = { 'kartochnaya-layer-width': '345', 'kartochnaya-ink-v1': '{}', 'kartochnaya-shapes-v1': '[]' };
  const zip = await createBackup(incoming, { preferences: prefs });
  await assert.rejects(x.operation.commit(zip.bytes, { verified: true }), /не подготовлена/);
  await assert.rejects(x.operation.downloadSafety(), /подготовь/);
  // Packaging needs SHA-256; preparation must not touch it.
  const digest = crypto.subtle.digest;
  crypto.subtle.digest = () => { throw Error('Unexpected ZIP packaging'); };
  try { await x.operation.prepare(); } finally { crypto.subtle.digest = digest; }
  assert.equal(x.downloaded(), false);
  await x.operation.commit(zip.bytes);
  assert.equal(x.stopped(), true); assert.equal(x.reloaded(), true);
  assert.equal(x.values.get('token'), 'private'); for (const [k, v] of Object.entries(prefs)) assert.equal(x.values.get(k), v);
  assert.deepEqual(await readWorkspaceSnapshot(db), incoming);
  await assert.rejects(x.operation.commit(zip.bytes)); await assert.rejects(x.operation.prepare());
  await x.operation.cancel(); assert.equal(x.ended(), 0); db.close();
});
test('U3/U4: prepared proof covers all four stores and drift aborts before any clear', async () => {
  for (const name of STORES) {
    const db = await database(), x = session(db), zip = await createBackup(incoming);
    assert.deepEqual(await x.operation.prepare(), { projects: 1, docs: 1, fonts: 1, settings: 1 });
    await runStoreTransaction(db, [name], 'readwrite', s => {
      s(name).put({ ...old[name][0], external: true });
    });
    const before = await readWorkspaceSnapshot(db), original = db.transaction.bind(db); let clears = 0;
    db.transaction = (...args) => {
      const t = original(...args);
      if (args[1] === 'readwrite') {
        assert.deepEqual(args[0], STORES);
        const objectStore = t.objectStore.bind(t);
        t.objectStore = key => { const store = objectStore(key); store.clear = () => { clears++; assert.fail('clear before drift rejection'); }; return store; };
      }
      return t;
    };
    await assert.rejects(x.operation.commit(zip.bytes)); assert.equal(clears, 0);
    assert.deepEqual(await readWorkspaceSnapshot(db), before); db.close();
  }
});
test('U6: optional ZIP uses the prepared records and original allowlisted preferences without rereading IDB', async () => {
  const db = await database(), x = session(db);
  x.values.set('kartochnaya-layer-width', '271');
  await x.operation.prepare();
  await runStoreTransaction(db, ['settings'], 'readwrite', s => { s('settings').put({ key: 'later' }); });
  x.values.set('kartochnaya-layer-width', '399');
  const original = db.transaction;
  db.transaction = () => assert.fail('optional ZIP must not reread IDB');
  try { await x.operation.downloadSafety(); } finally { db.transaction = original; }
  const saved = await readBackup(await x.safety());
  assert.deepEqual(saved.data, { ...old, preferences: { 'kartochnaya-layer-width': '271' } });
  await x.operation.cancel(); db.close();
});
test('U7: packaging and download failures reject explicitly while retaining a valid prepared session', async () => {
  const db = await database(); let attempts = 0;
  const x = session(db, { download: async () => { attempts++; throw Error('Download denied'); } });
  const zip = await createBackup(incoming); await x.operation.prepare();
  const digest = crypto.subtle.digest; crypto.subtle.digest = () => { throw Error('Packaging denied'); };
  try { await assert.rejects(x.operation.downloadSafety(), /Packaging denied/); } finally { crypto.subtle.digest = digest; }
  assert.equal(attempts, 0);
  await assert.rejects(x.operation.downloadSafety(), /Download denied/); assert.equal(attempts, 1);
  assert.equal(x.downloaded(), false); assert.equal(x.ended(), 0);
  await x.operation.commit(zip.bytes); assert.deepEqual(await readWorkspaceSnapshot(db), incoming); db.close();
});
test('U8: preparation failure, cancellation, re-preparation and overlapping calls release correctly', async () => {
  const db = await database(); let fail = true;
  const x = session(db, { begin: () => { if (fail) throw Error('Snapshot denied'); return readWorkspaceSnapshot(db); } });
  const zip = await createBackup(incoming);
  await assert.rejects(x.operation.prepare(), /Snapshot denied/); assert.equal(x.ended(), 1);
  await assert.rejects(x.operation.commit(zip.bytes)); fail = false;
  const pending = x.operation.prepare(); await assert.rejects(x.operation.prepare(), /уже начата/); await pending;
  await x.operation.cancel(); await x.operation.cancel(); assert.equal(x.ended(), 2);
  await assert.rejects(x.operation.commit(zip.bytes));
  await x.operation.prepare(); await x.operation.commit(zip.bytes); db.close();
});
test('U8: cancelling an in-flight preparation cannot leave a ready session or release a newer lock', async () => {
  const db = await database(); let unblock;
  const x = session(db, { begin: async () => { await new Promise(resolve => { unblock = resolve; }); return readWorkspaceSnapshot(db); } });
  const pending = x.operation.prepare(), rejected = assert.rejects(pending, /отменена/);
  const cancelled = x.operation.cancel(); await assert.rejects(x.operation.prepare()); unblock();
  await Promise.all([rejected, cancelled]); assert.equal(x.ended(), 1);
  await assert.rejects(x.operation.commit((await createBackup(incoming)).bytes)); db.close();
});
test('U9/U10: localStorage drift requires new preparation; failure after commit keeps restored IDB', async () => {
  const db = await database(), x = session(db), zip = await createBackup(incoming);
  await x.operation.prepare(); x.values.set('kartochnaya-layer-width', '300');
  await assert.rejects(x.operation.commit(zip.bytes), /изменились/); assert.deepEqual(await readWorkspaceSnapshot(db), old);
  await x.operation.prepare(); x.storage.removeItem = () => { throw Error('denied'); };
  const failures = await x.operation.commit(zip.bytes); assert.equal(failures.length, 3);
  await x.operation.cancel(); await assert.rejects(x.operation.commit(zip.bytes));
  assert.equal(x.stopped(), true); assert.equal(x.reloaded(), true);
  assert.deepEqual(await readWorkspaceSnapshot(db), incoming); db.close();
});
test('U5: genuine ConstraintError after successful puts rolls back every store', async () => {
  const db = await database(), original = db.transaction.bind(db); let successes = 0;
  db.transaction = (...args) => {
    const t = original(...args);
    if (args[1] === 'readwrite') {
      const objectStore = t.objectStore.bind(t), patched = new WeakSet();
      t.objectStore = name => {
        const s = objectStore(name); if (patched.has(s)) return s; patched.add(s);
        const put = s.put.bind(s); s.put = row => { const r = put(row); r.addEventListener('success', () => { if (++successes === 2) t.objectStore('projects').add({ id: 'one' }); }); return r; }; return s;
      };
    } return t;
  };
  await assert.rejects(replaceWorkspace(db, (await createBackup(incoming)).bytes, old), { name: 'ConstraintError' });
  assert.ok(successes >= 2); assert.deepEqual(await readWorkspaceSnapshot(db), old); db.close();
});
test('missing optional localStorage keys are removed, arbitrary keys are never applied', () => {
  const calls = []; applyWorkspacePreferences({ removeItem: k => calls.push(k), setItem: () => assert.fail() }, { token: 'bad' });
  assert.equal(calls.length, 3); assert.ok(calls.every(k => k.startsWith('kartochnaya-')));
});

test('U9: preferences changed during async ZIP validation abort before replacement writes', async () => {
  const db = await database(), x = session(db), zip = await createBackup(incoming);
  await x.operation.prepare();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest = (...args) => { x.values.set('kartochnaya-layer-width', '399'); return digest(...args); };
  try { await assert.rejects(x.operation.commit(zip.bytes), /Настройки изменились/); } finally { crypto.subtle.digest = digest; }
  assert.deepEqual(await readWorkspaceSnapshot(db), old); db.close();
});
test('confirmed commit remains final even if navigation throws', async () => {
  const db = await database(), x = session(db, { reload: () => { throw Error('Navigation denied'); } });
  await x.operation.prepare(); await assert.rejects(x.operation.commit((await createBackup(incoming)).bytes), /Navigation denied/);
  assert.equal(x.operation.committed(), true); await x.operation.cancel();
  await assert.rejects(x.operation.prepare()); await assert.rejects(x.operation.commit((await createBackup(old)).bytes));
  assert.deepEqual(await readWorkspaceSnapshot(db), incoming); assert.equal(x.ended(), 0); db.close();
});
