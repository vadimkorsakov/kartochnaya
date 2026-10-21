import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDatabase, runStoreTransaction } from '../src/storage/indexeddb.mjs';
import { readWorkspaceSnapshot } from '../src/backup/storage.mjs';
import { createBackup, STORES } from '../src/backup/archive.mjs';
import { replaceWorkspace, createReplacementSession, applyWorkspacePreferences } from '../src/backup/replace.mjs';

const old = { projects: [{ id: 'old' }], docs: [{ id: 'old-doc', projectId: 'old', width: 320, height: 240, elements: [] }], fonts: [], settings: [] };
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
  const db = await database(), empty = { projects: [], docs: [], fonts: [], settings: [] };
  const zip = await createBackup(empty);
  await replaceWorkspace(db, zip.bytes, old); assert.deepEqual(await readWorkspaceSnapshot(db), empty);
  db.close(); await assert.rejects(replaceWorkspace(db, zip.bytes, empty));
});
function session(db) {
  let safety, stopped = false, reloaded = false, ended = 0;
  const values = new Map([['token', 'private']]);
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const operation = createReplacementSession({ db: () => db, begin: () => readWorkspaceSnapshot(db), end: () => { ended++; }, storage,
    download: blob => { safety = blob; }, stop: () => { stopped = true; }, reload: () => { reloaded = true; } });
  return { operation, storage, values, safety: async () => new Uint8Array(await safety.arrayBuffer()), stopped: () => stopped, reloaded: () => reloaded, ended: () => ended };
}
test('session refuses no safety, mismatched and corrupt files; failure invalidates proof', async () => {
  const db = await database(), x = session(db), zip = await createBackup(incoming);
  await assert.rejects(x.operation.commit(zip.bytes), /не проверен/);
  await x.operation.prepare(); await assert.rejects(x.operation.verify(zip.bytes), /не совпадает/);
  await assert.rejects(x.operation.commit(zip.bytes), /не проверен/);
  await x.operation.prepare(); await assert.rejects(x.operation.verify(new Uint8Array(4)));
  assert.deepEqual(await readWorkspaceSnapshot(db), old); assert.equal(x.ended(), 2); db.close();
});
test('verified exact safety authorizes only one commit and applies allowlisted preferences', async () => {
  const db = await database(), x = session(db);
  const prefs = { 'kartochnaya-layer-width': '345', 'kartochnaya-ink-v1': '{}', 'kartochnaya-shapes-v1': '[]' };
  const zip = await createBackup(incoming, { preferences: prefs });
  await x.operation.prepare(); await x.operation.verify(await x.safety()); await x.operation.commit(zip.bytes);
  assert.equal(x.stopped(), true); assert.equal(x.reloaded(), true);
  assert.equal(x.values.get('token'), 'private'); for (const [k, v] of Object.entries(prefs)) assert.equal(x.values.get(k), v);
  await assert.rejects(x.operation.commit(zip.bytes)); db.close();
});
test('localStorage drift requires new safety; localStorage failure after commit keeps restored IDB', async () => {
  const db = await database(), x = session(db), zip = await createBackup(incoming);
  await x.operation.prepare(); await x.operation.verify(await x.safety()); x.values.set('kartochnaya-layer-width', '300');
  await assert.rejects(x.operation.commit(zip.bytes), /изменились/); assert.deepEqual(await readWorkspaceSnapshot(db), old);
  await x.operation.prepare(); await x.operation.verify(await x.safety());
  x.storage.removeItem = () => { throw Error('denied'); };
  const failures = await x.operation.commit(zip.bytes); assert.equal(failures.length, 3);
  assert.deepEqual(await readWorkspaceSnapshot(db), incoming); db.close();
});
test('missing optional localStorage keys are removed, arbitrary keys are never applied', () => {
  const calls = []; applyWorkspacePreferences({ removeItem: k => calls.push(k), setItem: () => assert.fail() }, { token: 'bad' });
  assert.equal(calls.length, 3); assert.ok(calls.every(k => k.startsWith('kartochnaya-')));
});
