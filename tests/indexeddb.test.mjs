import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, runStoreRequest } from '../src/storage/indexeddb.mjs';

// Event doubles deliberately separate request success from transaction completion.
// Real data persistence/rollback is covered by indexeddb-contracts.spec.js in Chromium.
function harness() {
  const tr = { error: null, aborts: 0, abort() { this.aborts++; this.onabort?.(); } };
  const request = new EventTarget();
  Object.assign(request, { result: undefined, error: null, transaction: tr });
  const store = { request };
  tr.objectStore = name => { if (name !== 'docs') throw new DOMException('Missing store', 'NotFoundError'); return store; };
  const db = { transaction(name, mode) { assert.ok(['readonly', 'readwrite'].includes(mode)); return tr; } };
  return { tr, request, store, db, success(value) { request.result = value; request.dispatchEvent(new Event('success')); },
    error(value) { request.error = value; request.dispatchEvent(new Event('error', { cancelable: true })); } };
}
function run(h, mode = 'readwrite', op = s => s.request) { return runStoreRequest(h.db, 'docs', mode, op); }

for (const [name, value] of [['get', { id: 'x' }], ['get missing', undefined], ['getAll', [{ id: 'x' }]], ['put new', 'new-id'], ['put update', 'x'], ['delete', undefined]]) {
  test(`${name}: preserve exact request result, wait for complete`, async () => {
    const h = harness(); let settled = false;
    const promise = run(h, name.startsWith('get') ? 'readonly' : 'readwrite');
    promise.then(() => { settled = true; });
    h.success(value); await Promise.resolve(); assert.equal(settled, false);
    h.tr.oncomplete(); assert.equal(await promise, value);
  });
}
test('success followed by abort rejects rather than returning provisional put key', async () => {
  const h = harness(), promise = run(h);
  h.success('x'); h.tr.abort(); await assert.rejects(promise, { name: 'AbortError' });
});
test('abort before request success rejects', async () => {
  const h = harness(), promise = run(h); h.tr.abort(); await assert.rejects(promise, { name: 'AbortError' });
});
test('request error is not prevented and retains original cause through bubbling/abort', async () => {
  const h = harness(), cause = new DOMException('Full disk', 'QuotaExceededError'), promise = run(h);
  let prevented;
  h.request.addEventListener('error', event => { prevented = event.defaultPrevented; });
  h.error(cause); h.tr.onerror(); h.tr.onabort();
  await assert.rejects(promise, error => error === cause); assert.equal(prevented, false);
});
test('transaction error preserves transaction cause', async () => {
  const h = harness(), cause = new Error('transaction failure'), promise = run(h);
  h.success('x'); h.tr.error = cause; h.tr.onerror(); await assert.rejects(promise, error => error === cause);
});
test('abort retains transaction error', async () => {
  const h = harness(), cause = new DOMException('quota', 'QuotaExceededError'), promise = run(h);
  h.tr.error = cause; h.tr.abort(); await assert.rejects(promise, error => error === cause);
});
for (const name of ['DataCloneError', 'TransactionInactiveError', 'InvalidStateError', 'UnknownError']) {
  test(`callback ${name} aborts transaction and retains original error`, async () => {
    const h = harness(), cause = new DOMException('original', name);
    await assert.rejects(run(h, 'readwrite', () => { throw cause; }), error => error === cause);
    assert.equal(h.tr.aborts, 1);
  });
}
test('abort throwing cannot mask callback failure', async () => {
  const h = harness(), cause = new Error('callback'); h.tr.abort = () => { throw Error('inactive'); };
  await assert.rejects(run(h, 'readwrite', () => { throw cause; }), error => error === cause);
});
test('transaction creation failure/closed database rejects unchanged', async () => {
  const cause = new DOMException('Closed', 'InvalidStateError');
  await assert.rejects(runStoreRequest({ transaction() { throw cause; } }, 'docs', 'readwrite', () => {}), error => error === cause);
});
test('missing store aborts the created transaction', async () => {
  const h = harness(); await assert.rejects(runStoreRequest(h.db, 'absent', 'readwrite', () => {}), { name: 'NotFoundError' });
  assert.equal(h.tr.aborts, 1);
});
test('unavailable read keeps null fallback; unavailable write rejects', async () => {
  assert.equal(await runStoreRequest(null, 'docs', 'readonly', () => { throw Error('not called'); }), null);
  await assert.rejects(runStoreRequest(null, 'docs', 'readwrite', () => {}), { name: 'InvalidStateError' });
});
for (const [label, value] of [['undefined', undefined], ['plain object', {}], ['thenable', { then() {} }], ['async', Promise.resolve(1)]]) {
  test(`invalid callback result (${label}) promptly rejects and aborts`, async () => {
    const h = harness(); await assert.rejects(run(h, 'readwrite', () => value), TypeError); assert.equal(h.tr.aborts, 1);
  });
}
test('a request from a different transaction is rejected', async () => {
  const h = harness(); h.request.transaction = {}; await assert.rejects(run(h), TypeError); assert.equal(h.tr.aborts, 1);
});
test('complete without request success rejects instead of hanging', async () => {
  const h = harness(), promise = run(h); h.tr.oncomplete(); await assert.rejects(promise, TypeError);
});
test('duplicate terminal events cannot change a completed outcome', async () => {
  const h = harness(), promise = run(h); h.success('x'); h.tr.oncomplete(); h.tr.abort(); h.tr.onerror();
  assert.equal(await promise, 'x');
});
test('late success/complete cannot change rejection', async () => {
  const h = harness(), promise = run(h); h.tr.abort(); h.success('x'); h.tr.oncomplete();
  await assert.rejects(promise, { name: 'AbortError' });
});
function opening() {
  const stores = new Map();
  const db = { objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name, options) { stores.set(name, options); }, closed: 0, close() { this.closed++; } };
  const request = { result: db, error: null };
  const factory = { open(name, version) { assert.equal(name, 'kartochnaya_local_v1'); assert.equal(version, 3); return request; } };
  return { db, request, factory, stores };
}
test('open creates exactly existing schema and closes connection', async () => {
  const h = opening(), promise = openDatabase({ indexedDB: h.factory });
  h.request.onupgradeneeded(); h.request.onsuccess(); assert.equal(await promise, h.db);
  assert.deepEqual([...h.stores], [['docs', { keyPath: 'id' }], ['fonts', { keyPath: 'id' }], ['projects', { keyPath: 'id' }], ['settings', { keyPath: 'key' }]]);
  h.db.close(); assert.equal(h.db.closed, 1);
});
test('existing stores are not recreated', async () => {
  const h = opening(); for (const name of ['docs', 'fonts', 'projects', 'settings']) h.stores.set(name, { existing: true });
  const promise = openDatabase({ indexedDB: h.factory }); h.request.onupgradeneeded(); h.request.onsuccess(); await promise;
  assert.ok([...h.stores.values()].every(v => v.existing));
});
test('opening error retains exact cause', async () => {
  const h = opening(), cause = new Error('open'), promise = openDatabase({ indexedDB: h.factory });
  h.request.error = cause; h.request.onerror(); await assert.rejects(promise, error => error === cause);
});
test('absent IndexedDB rejects, synchronous API exceptions reject', async () => {
  await assert.rejects(openDatabase({ indexedDB: null }), { name: 'InvalidStateError' });
  const cause = new DOMException('Denied', 'SecurityError');
  await assert.rejects(openDatabase({ indexedDB: { open() { throw cause; } } }), error => error === cause);
});
test('blocked rejects immediately without a timer and closes a late connection', async () => {
  const h = opening(); let blocked;
  const promise = openDatabase({ indexedDB: h.factory, onBlocked: error => { blocked = error; } });
  h.request.onblocked(); await assert.rejects(promise, error => error === blocked);
  h.request.onsuccess(); assert.equal(h.db.closed, 1);
});
test('versionchange closes database and notifies editor; abnormal close notifies', async () => {
  const h = opening(); let version, closed;
  const promise = openDatabase({ indexedDB: h.factory, onVersionChange: event => { version = event; }, onClose: event => { closed = event; } });
  h.request.onsuccess(); await promise;
  const event = {}; h.db.onversionchange(event); assert.equal(version, event); assert.equal(h.db.closed, 1);
  h.db.onclose(event); assert.equal(closed, event);
});
test('upgrade failure aborts and preserves the cause', async () => {
  const h = opening(), cause = new Error('upgrade'); let aborted = false;
  h.db.createObjectStore = () => { throw cause; }; h.request.transaction = { abort() { aborted = true; } };
  const promise = openDatabase({ indexedDB: h.factory }); h.request.onupgradeneeded();
  await assert.rejects(promise, error => error === cause); assert.equal(aborted, true);
});
