import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { createBackup, readBackup, inspectContainer, sha256, inspectData, readPreferences, FORMAT } from '../src/backup/archive.mjs';
import { readWorkspaceSnapshot, createWorkspaceBarrier } from '../src/backup/storage.mjs';
import { openDatabase, runStoreTransaction } from '../src/storage/indexeddb.mjs';
import { prepareProjectImport } from '../src/model/project-integrity.mjs';
import { zip as rawZip } from '../scripts/distribution.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/project-with-folders.json', import.meta.url)));
function snapshot() {
  const project = structuredClone(fixture.project); project.future = { secretMeaning: ['keep'] }; project.cover = project.resources[0].src;
  project.resourceFolders.push({ id: 'nested', parentId: project.resourceFolders[0].id, name: 'Nested' }); project.resources[0].folderId = 'nested';
  const doc = { id: 'doc', projectId: project.id, width: 320, height: 240, elements: [{ id: 'image', imageSrc: project.cover, layerMaskSrc: project.cover }], future: { raw: 42 } };
  return { projects: [project, { id: 'empty', name: 'Empty' }, { id: 'third', name: 'Third' }], docs: [doc], fonts: [{ id: 'font', data: 'data:font/ttf;base64,AA==' }], settings: [{ key: 'shapes-v1', sections: [] }, { key: 'future', raw: ['keep'] }] };
}
const make = (data = snapshot(), options) => createBackup(data, options);
async function change(backup, edit, rehash = false) {
  const files = unzipSync(backup.bytes); edit(files);
  if (rehash) {
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    for (const f of manifest.files) if (files[f.path]) { f.bytes = files[f.path].length; f.sha256 = await sha256(files[f.path]); }
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
  }
  return zipSync(files, { level: 0 });
}
test('workspace archive has fixed paths, ISO metadata, hashes, unique generations and lossless records', async () => {
  const data = snapshot(), a = await make(data), b = await make(data);
  assert.notEqual(a.filename, b.filename); assert.notEqual(a.manifest.backupId, b.manifest.backupId);
  const result = await readBackup(a.bytes);
  assert.deepEqual(result.data, { ...data, preferences: {} }); assert.equal(result.manifest.scope, 'workspace');
  assert.equal(result.manifest.format, FORMAT); assert.deepEqual(result.manifest.counts, { projects: 3, docs: 1, fonts: 1, settings: 2, preferences: 0 });
  assert.equal(inspectContainer(a.bytes).length, 6);
});
for (const selectedIds of [[fixture.project.id], [fixture.project.id, 'empty'], ['empty']]) test('selected projects ' + selectedIds.join(','), async () => {
  const a = await make(snapshot(), { selectedIds }); const result = await readBackup(a.bytes);
  assert.equal(result.manifest.scope, 'selected-projects'); assert.deepEqual(result.manifest.projectIds, selectedIds);
  assert.equal(result.data.docs.length, selectedIds.includes(fixture.project.id) ? 1 : 0);
  assert.equal(result.data.fonts.length, 1); assert.equal(result.manifest.globals.settings, 'included-not-restored');
});
test('only known application localStorage keys are admitted', async () => {
  const storage = { getItem: k => ({ 'kartochnaya-layer-width': '250', token: 'private', password: 'private', 'kartochnaya_current_project': 'p' })[k] ?? null };
  assert.deepEqual(readPreferences(storage), { 'kartochnaya-layer-width': '250' });
  await assert.rejects(make(snapshot(), { preferences: { token: 'private' } }), /localStorage/);
});
test('unknown fields survive import preparation; external IDs change, local IDs stay', async () => {
  const r = await readBackup((await make()).bytes); let n = 0;
  const a = prepareProjectImport(r.data.projects.map(project => ({ project, documents: r.data.docs.filter(d => d.projectId === project.id) })), { generateId: () => 'copy-' + n++, now: Date.now() });
  assert.deepEqual(a.projects[0].future, snapshot().projects[0].future); assert.deepEqual(a.documents[0].elements, snapshot().docs[0].elements); assert.deepEqual(a.documents[0].future, { raw: 42 });
  assert.equal(a.documents[0].projectId, a.projects[0].id);
});
test('SHA mismatch is a hard error even with valid ZIP CRC and JSON', async () => {
  const a = await make(); const bytes = await change(a, f => { f['data/docs.json'][20] ^= 1; });
  await assert.rejects(readBackup(bytes), /SHA-256/);
});
test('invalid JSON with correct hash fails', async () => {
  const bytes = await change(await make(), f => { f['data/docs.json'] = strToU8('{broken'); }, true);
  await assert.rejects(readBackup(bytes), /JSON/);
});
test('missing mandatory file, unsupported version, forged counts, required features fail', async () => {
  const a = await make(); await assert.rejects(readBackup(await change(a, f => { delete f['data/docs.json']; })), /ZIP/);
  for (const edit of [m => { m.formatVersion = 2; }, m => { m.counts.docs = 999; }, m => { m.requiredFeatures = ['unknown']; }, m => { m.files[1].bytes++; }, m => { m.projectIds = []; }]) {
    const bytes = await change(a, f => { const m = JSON.parse(new TextDecoder().decode(f['manifest.json'])); edit(m); f['manifest.json'] = strToU8(JSON.stringify(m)); });
    await assert.rejects(readBackup(bytes));
  }
});
test('corrupt, truncated, CRC forged ZIP fail before import', async () => {
  await assert.rejects(readBackup(strToU8('not a zip')));
  const a = await make(); await assert.rejects(readBackup(a.bytes.slice(0, -10)));
  const bytes = a.bytes.slice(); bytes[0] ^= 1; await assert.rejects(readBackup(bytes));
});
test('duplicate paths, traversal, backslashes, aliases and unknown entries are rejected', async () => {
  const files = unzipSync((await make()).bytes), entries = Object.entries(files).map(([name, data]) => ({ name, data: Buffer.from(data) }));
  for (const name of ['../manifest.json', '/manifest.json', 'data\\docs.json', 'data/../docs.json', 'data/docs.json', 'extra.json']) {
    const altered = entries.map(e => ({ ...e })); altered[0].name = name;
    await assert.rejects(readBackup(new Uint8Array(rawZip(altered))));
  }
});
test('expansion bomb is rejected before decompression allocates data', async () => {
  const bytes = (await make()).bytes.slice(); const view = new DataView(bytes.buffer); let p = 0;
  while (view.getUint32(p, true) !== 0x02014b50) p++;
  view.setUint32(p + 24, 0x7fffffff, true); await assert.rejects(readBackup(bytes), /объём/);
});
test('invalid and missing project relations fail; optional historical fields remain legal', async () => {
  const data = snapshot(); data.docs[0].projectId = 'absent'; await assert.rejects(make(data), /без проекта/);
  const good = snapshot(); delete good.projects[0].resourceFolders; delete good.projects[0].resources; assert.doesNotThrow(() => inspectData({ ...good, preferences: {} }));
});
test('one real multi-store snapshot includes records beyond any editor cache and waits for commit', async () => {
  const db = await openDatabase({ indexedDB: new IDBFactory() }), data = snapshot();
  await runStoreTransaction(db, ['projects', 'docs', 'fonts', 'settings'], 'readwrite', store => { for (const name of ['projects', 'docs', 'fonts', 'settings']) for (const row of data[name]) store(name).add(row); });
  const original = db.transaction.bind(db); let transactions = 0, complete = false;
  db.transaction = (...args) => { transactions++; assert.equal(args[1], 'readonly'); assert.equal(args[0].length, 4); const t = original(...args); t.addEventListener('complete', () => { complete = true; }); return t; };
  const read = await readWorkspaceSnapshot(db); assert.equal(complete, true); assert.equal(transactions, 1); assert.deepEqual(read.docs, data.docs);
  db.close(); await assert.rejects(readWorkspaceSnapshot(db)); await assert.rejects(readWorkspaceSnapshot(null));
});
test('barrier waits async operations and handles rejections without unhandled derivatives', async () => {
  const barrier = createWorkspaceBarrier(); let release, done = false;
  barrier.track(new Promise(resolve => { release = resolve; })); const drain = barrier.drain().then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false); release(); await drain; assert.equal(done, true);
  barrier.track(Promise.reject(new Error('disk')), { store: 'settings', write: true }); await assert.rejects(barrier.drain(), /disk/);
});
test('deflated backup containers are accepted with the same integrity checks', async () => {
  const files = unzipSync((await make()).bytes); assert.equal((await readBackup(zipSync(files, { level: 6 }))).data.docs.length, 1);
});

test('font Data URLs cannot inject an external FontFace source', async () => { const data=snapshot(); data.fonts[0].data='data:font/ttf;base64,AA=="),url("https://example.invalid/font'; await assert.rejects(make(data), /Data URL/); });
