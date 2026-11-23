import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createBackup, readBackup } from '../src/backup/archive.mjs';
import { replaceWorkspace } from '../src/backup/replace.mjs';
import { readWorkspaceSnapshot } from '../src/backup/storage.mjs';
import { applyParagraphListStyle, projectParagraphLists } from '../src/model/paragraph-style.mjs';
import { prepareProjectImport } from '../src/model/project-integrity.mjs';
import { openDatabase, runStoreRequest } from '../src/storage/indexeddb.mjs';
import { listMarkerLibraryKey as key, listMarkerLibraryLimit, loadListMarkers, updateListMarkers } from '../src/storage/list-marker-library.mjs';

const read = (db, store, id) => runStoreRequest(db, store, 'readonly', s => s.get(id));
const write = (db, store, record) => runStoreRequest(db, store, 'readwrite', s => s.put(record));

test('personal gallery validates stored markers and deduplicates transactional adds across connections', async t => {
  const indexedDB = new IDBFactory();
  const db = await openDatabase({indexedDB}), second = await openDatabase({indexedDB});
  t.after(() => { db.close(); second.close(); });
  assert.equal(db.version, 3);
  assert.deepEqual(await loadListMarkers(db), []);
  await write(db, 'settings', {key, markers:['✔️', '✔️', '•', '', ' ', '<svg>', {}, '\u202e', '🇳🇱']});
  assert.deepEqual(await loadListMarkers(db), ['✔️', '🇳🇱']);
  const results = await Promise.all([
    updateListMarkers(db, 'add', '🧑‍💻'),
    updateListMarkers(second, 'add', '➤'),
    updateListMarkers(second, 'add', '🧑‍💻'),
  ]);
  assert.deepEqual(results.map(({status}) => status), ['added', 'added', 'duplicate']);
  assert.deepEqual(await loadListMarkers(db), ['✔️', '🇳🇱', '🧑‍💻', '➤']);
  await assert.rejects(updateListMarkers(db, 'add', '🦊🔥'), TypeError);
  await assert.rejects(updateListMarkers(db, 'remove', '•'), TypeError);
  assert.equal((await updateListMarkers(db, 'remove', '✔️')).status, 'removed');
  assert.equal((await updateListMarkers(db, 'remove', '✔️')).status, 'missing');
  assert.deepEqual((await read(second, 'settings', key)).markers, ['🇳🇱', '🧑‍💻', '➤']);

  const full = Array.from({length:listMarkerLibraryLimit}, (_, i) => String.fromCodePoint(0x3400 + i));
  await write(db, 'settings', {key, markers:[...full, '➤']});
  assert.deepEqual(await loadListMarkers(db), full);
  assert.deepEqual(await updateListMarkers(db, 'add', '🦊'), {markers:full, status:'full'});
  assert.equal((await updateListMarkers(db, 'remove', full[0])).status, 'removed');
  assert.equal((await updateListMarkers(db, 'add', '🦊')).status, 'added');
  assert.equal((await loadListMarkers(db)).length, listMarkerLibraryLimit);
});

test('gallery changes settle only at transaction completion and a late abort keeps the prior contents', async t => {
  const db = await openDatabase({indexedDB:new IDBFactory()});
  t.after(() => db.close());
  const transact = db.transaction.bind(db);
  let committed = false, provisionalWrites = 0, fail = false;
  db.transaction = (stores, mode) => {
    const transaction = transact(stores, mode);
    if (mode === 'readwrite') {
      transaction.addEventListener('complete', () => { committed = true; });
      const getStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = name => {
        const store = getStore(name);
        const put = store.put.bind(store);
        store.put = record => {
          const request = put(record);
          request.addEventListener('success', () => {
            provisionalWrites++;
            if (fail) transaction.abort();
          });
          return request;
        };
        return store;
      };
    }
    return transaction;
  };

  await updateListMarkers(db, 'add', '🦊');
  assert.equal(committed, true);
  committed = false;
  fail = true;
  await assert.rejects(updateListMarkers(db, 'add', '🇳🇱'), {name:'AbortError'});
  await assert.rejects(updateListMarkers(db, 'remove', '🦊'), {name:'AbortError'});
  assert.equal(provisionalWrites, 3);
  assert.equal(committed, false);
  assert.deepEqual(await loadListMarkers(db), ['🦊']);
});

test('workspace ZIP restores the gallery and project copies carry markers independently of it', async t => {
  const db = await openDatabase({indexedDB:new IDBFactory()});
  const target = await openDatabase({indexedDB:new IDBFactory()});
  t.after(() => { db.close(); target.close(); });
  const marker = '👨‍👩‍👧‍👦';
  const layer = applyParagraphListStyle({id:'text', type:'text', text:'One\nStraße 🦊',
    textRuns:[{start:4,end:10,style:{textCase:'upper'}}]}, {listKind:'bullet', listMarker:marker});
  const doc = {id:'doc', projectId:'project', width:300, height:200, elements:[layer]};
  await write(db, 'projects', {id:'project'});
  await write(db, 'docs', JSON.parse(JSON.stringify(doc)));
  await updateListMarkers(db, 'add', marker);
  const workspace = await createBackup(await readWorkspaceSnapshot(db));
  await replaceWorkspace(target, workspace.bytes, await readWorkspaceSnapshot(target));
  assert.deepEqual(await loadListMarkers(target), [marker]);
  assert.deepEqual(await read(target, 'docs', 'doc'), doc);

  const selected = await createBackup(await readWorkspaceSnapshot(db), {selectedIds:['project']});
  const {manifest, data} = await readBackup(selected.bytes);
  assert.equal(manifest.globals.settings, 'included-not-restored');
  assert.deepEqual(data.settings, [{key, markers:[marker]}]);
  await updateListMarkers(target, 'remove', marker);
  let nextId = 0;
  const copies = prepareProjectImport([{project:data.projects[0], documents:data.docs}], {generateId:() => 'copy-' + ++nextId, now:1});
  const copied = copies.documents[0].elements[0];
  assert.deepEqual(copied, layer);
  assert.deepEqual(projectParagraphLists(copied.text, copied.paragraphRuns).map(p => p.marker), [marker, marker]);
  assert.deepEqual(await loadListMarkers(target), []);
  assert.deepEqual(await read(target, 'docs', 'doc'), doc);
});

test('project import discards only invalid marker fields, including on inactive slides', () => {
  const layer = {id:'text', type:'text', text:'One\nTwo', paragraphRuns:[
    {start:0,style:{listKind:'bullet',listMarker:'<svg>',listIndent:7,future:'keep'}},
    {start:4,style:{listKind:'bullet',listMarker:'✔️'}},
  ]};
  const canvas = {width:300,height:200,elements:[layer]};
  const doc = {id:'doc',projectId:'project',...canvas, activeSlideIndex:0,
    slides:[{id:'slide-1',...canvas},{id:'slide-2',...canvas}]};
  let nextId = 0;
  const copies = prepareProjectImport([{project:{id:'project'}, documents:[doc]}], {
    generateId:() => 'copy-' + ++nextId, now:1,
  });
  const [copy] = copies.documents;
  for (const {elements} of [copy, ...copy.slides]) {
    assert.deepEqual(elements[0], {...layer, paragraphRuns:[
      {start:0,style:{listKind:'bullet',listIndent:7,future:'keep'}}, layer.paragraphRuns[1],
    ]});
  }
  assert.equal(layer.paragraphRuns[0].style.listMarker, '<svg>');
  assert.deepEqual(copies.diagnostics.warnings, [{code:'invalid-list-marker',path:'documents:copy-2'}]);
});
