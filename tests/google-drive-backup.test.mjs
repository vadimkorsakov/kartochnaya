import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveSession, DRIVE_SCOPE, driveEndpoint } from '../src/cloud/google-drive/session.mjs';
import { createDriveClient, APP, FOLDER_NAME, CHUNK_BYTES, safeFilename } from '../src/cloud/google-drive/client.mjs';
import { createBackup, readBackup, sha256, FORMAT } from '../src/backup/archive.mjs';
const tick = () => new Promise(r => setTimeout(r, 0));
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const incomplete = n => new Response(null, { status: 308, headers: n ? { Range: 'bytes=0-' + (n - 1) } : {} });
const folder = { id: 'folder-1', name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', trashed: false, appProperties: { application: APP, kind: 'backup-folder' } };
const snapshot = () => ({ projects: [], docs: [], fonts: [], settings: [{ key: 'fixture', value: 'data' }] });
async function harness(options = {}) {
  const state = { folders: options.existing ? [folder] : [], files: [], calls: [], received: [], folderCreates: 0, uploads: 0, accepted: 0 };
  let config;
  const session = createDriveSession({ supported: () => true, online: () => true,
    load: async () => ({ initTokenClient(c) { config = c; return { requestAccessToken() {} }; } }),
    request: async (address, init) => {
      const url = new URL(address), method = init.method;
      const headers = new Headers(init.headers);
      assert.equal(headers.get('Authorization'), 'Bearer private-test-token');
      assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
      assert.ok(!address.includes('private-test-token'));
      state.calls.push({ url, method, headers, body: init.body, signal: init.signal });
      if (url.pathname.endsWith('/about')) return json({ user: { displayName: 'Test' } });
      if (options.intercept) { const response = await options.intercept({ url, method, init, state }); if (response !== undefined) return response; }
      if (url.pathname === '/drive/v3/files' && method === 'GET') {
        if (url.searchParams.get('q').includes("mimeType = 'application/vnd.google-apps.folder'")) return json({ files: [...state.folders, { ...folder, id: 'foreign-folder', appProperties: {} }] });
        return json({ files: state.files });
      }
      if (url.pathname === '/drive/v3/files' && method === 'POST') {
        const data = JSON.parse(init.body); assert.equal(data.mimeType, folder.mimeType); assert.deepEqual(data.appProperties, folder.appProperties);
        state.folderCreates++; state.folders.push(folder); return json(folder);
      }
      if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
        state.uploads++; state.metadata = JSON.parse(init.body);
        state.size = Number(headers.get('X-Upload-Content-Length')); state.accepted = 0; state.received = [];
        return new Response(null, { status: 200, headers: { Location: options.location || 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test-session' } });
      }
      if (url.pathname === '/upload/drive/v3/files' && method === 'PUT') {
        const range = headers.get('Content-Range');
        if (range.startsWith('bytes */')) return state.completed ? json({ id: state.completed.id }) : incomplete(state.accepted);
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range); assert.ok(match);
        const start = Number(match[1]), end = Number(match[2]); assert.equal(start, state.accepted);
        assert.equal(init.body.byteLength, end - start + 1); assert.ok(init.body.length <= CHUNK_BYTES);
        state.received.push(init.body); state.accepted = end + 1;
        if (state.accepted < state.size) return incomplete(state.accepted);
        const file = { ...state.metadata, id: 'backup-' + state.uploads, size: String(state.size), createdTime: '2026-10-22T13:00:00Z', trashed: false };
        state.files.push(file); state.completed = file; return json({ id: file.id }, 201);
      }
      const id = url.pathname.split('/').pop();
      if (id === folder.id) return json(folder);
      const file = state.files.find(f => f.id === id);
      if (file && url.searchParams.get('alt') === 'media') {
        return new Response(new Blob(state.received).stream(), { headers: { 'Content-Length': String(state.size) } });
      }
      if (file) return json(file);
      throw Error('Unexpected mock request');
    },
  });
  session.configure('test.apps.googleusercontent.com'); await session.prepare(); session.connect();
  config.callback({ scope: DRIVE_SCOPE, access_token: 'private-test-token', expires_in: options.expires || 3600 }); await tick();
  const client = createDriveClient();
  return { session, client, state, run: action => session.withDriveOperation(action), close: () => session.disconnect() };
}
const create = h => h.run(op => h.client.create(op, { snapshot: async () => snapshot(), preferences: () => ({}) }));
test('folder is created only by upload, ignores foreign same-name folder, is reused; full ZIP bytes and metadata verified', async () => {
  const h = await harness();
  try {
    assert.deepEqual(await h.run(op => h.client.list(op)), []); assert.equal(h.state.folderCreates, 0);
    const first = await create(h); const bytes = new Uint8Array(await new Blob(h.state.received).arrayBuffer());
    const verified = await readBackup(bytes); assert.equal(verified.manifest.scope, 'workspace'); assert.deepEqual(verified.data.settings, snapshot().settings);
    assert.equal(first.appProperties.sha256, await sha256(bytes)); assert.equal(first.appProperties.backupId, verified.manifest.backupId);
    const second = await create(h); assert.notEqual(first.id, second.id); assert.notEqual(first.name, second.name);
    assert.equal(h.state.folderCreates, 1); assert.equal(h.state.uploads, 2);
    assert.ok(h.state.calls.every(c => !['PATCH', 'DELETE'].includes(c.method)));
  } finally { h.close(); }
});
test('existing marked folder is reused; deleted known folder requires explicit new-folder action', async () => {
  let missing = false;
  const h = await harness({ existing: true, intercept: ({ url }) => missing && url.pathname.endsWith('/folder-1') ? json({}, 404) : undefined });
  try {
    await create(h); assert.equal(h.state.folderCreates, 0); missing = true;
    await assert.rejects(create(h), { code: 'folder_unavailable' }); assert.equal(h.state.uploads, 1);
    h.client.newFolder(); h.state.folders = []; missing = false; await create(h); assert.equal(h.state.folderCreates, 1);
  } finally { h.close(); }
});
test('unsafe resumable Location is rejected before any authorized chunk', async () => {
  for (const location of ['https://evil.invalid/upload?upload_id=x', 'http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x', 'https://www.googleapis.com/drive/v3/files/foreign', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable']) {
    const h = await harness({ location }); try { await assert.rejects(create(h), /недопустимый адрес/); assert.ok(!h.state.calls.some(c => c.method === 'PUT')); } finally { h.close(); }
  }
  assert.throws(() => driveEndpoint('https://www.googleapis.com.evil.invalid/drive/v3/files'));
});
test('one large 40 MiB ZIP: chunk views share original buffer; 308, interrupted partial chunk, probe-confirmed offset and 200 completion', async () => {
  let interrupted = false, probes = 0;
  const h = await harness({ intercept: ({ url, method, init, state }) => {
    if (method !== 'PUT') return;
    const range = new Headers(init.headers).get('Content-Range');
    if (range.startsWith('bytes */')) probes++;
    else if (!interrupted && state.accepted === CHUNK_BYTES) {
      interrupted = true; state.accepted += 256 * 1024; throw Error('network lost after partial server acceptance');
    }
  } });
  try {
    const data = snapshot(); data.settings[0].value = 'x'.repeat(40 * 1024 * 1024);
    const backup = await createBackup(data); const progress = [];
    const file = await h.run(op => h.client.upload(op, backup, p => progress.push(p)));
    const chunks = h.state.calls.filter(c => c.method === 'PUT' && c.body.byteLength);
    assert.ok(chunks.length >= 6); for (const chunk of chunks) assert.equal(chunk.body.buffer, backup.bytes.buffer);
    assert.equal(probes, 1); assert.ok(chunks.some(c => c.headers.get('Content-Range').startsWith('bytes ' + (CHUNK_BYTES + 256 * 1024) + '-')));
    assert.equal(progress.at(-1).confirmed, backup.bytes.length); assert.equal(Number(file.size), backup.bytes.length);
  } finally { h.close(); }
});
test('uncertain final network response is resolved by status query without a second upload', async () => {
  let once = true;
  const h = await harness({ intercept: ({ method, init, state }) => {
    if (method === 'PUT' && init.body.length && once) {
      once = false; state.size = init.body.length; state.accepted = state.size;
      state.completed = { ...state.metadata, id: 'backup-1', size: String(state.size), createdTime: '2026-10-22T13:00:00Z' }; state.files.push(state.completed); throw Error('lost final response');
    }
  } });
  try { assert.equal((await create(h)).id, 'backup-1'); assert.equal(h.state.uploads, 1); assert.equal(h.state.calls.filter(c => c.method === 'PUT').length, 2); } finally { h.close(); }
});
test('unreadable completion JSON triggers status check, metadata mismatch never succeeds', async () => {
  let unreadable = true, corruptMetadata = false;
  const h = await harness({ intercept: ({ url, method, init, state }) => {
    if (method === 'PUT' && init.body.length && unreadable) {
      unreadable = false; state.completed = { ...state.metadata, id: 'backup-1', size: String(state.size) }; state.files.push(state.completed);
      return new Response('{broken', { status: 200 });
    }
    if (corruptMetadata && url.pathname.endsWith('/backup-2')) return json({ ...state.files.at(-1), size: '1' });
  } });
  try { await create(h); corruptMetadata = true; await assert.rejects(create(h), /не подтверждён/); assert.equal(h.state.uploads, 2); } finally { h.close(); }
});
test('network loss with failed status checks has bounded failure; no false success or full retry', async () => {
  const h = await harness({ intercept: ({ method }) => { if (method === 'PUT') throw Error('offline'); } });
  try {
    await assert.rejects(create(h), /не подтверждён/); assert.equal(h.state.uploads, 1); assert.equal(h.state.calls.filter(c => c.method === 'PUT').length, 4);
  } finally { h.close(); }
});
test('429/503 trigger status query; 403 fails; invalid confirmed range is rejected', async () => {
  for (const status of [429, 503, 403, 308]) {
    let once = true;
    const h = await harness({ intercept: ({ method }) => {
      if (method === 'PUT' && once) { once = false; return status === 308 ? new Response(null, { status, headers: { Range: 'bytes=10-20' } }) : json({}, status); }
    } });
    try {
      if ([429, 503].includes(status)) { await create(h); assert.ok(h.state.calls.some(c => c.headers.get('Content-Range')?.startsWith('bytes */'))); }
      else await assert.rejects(create(h), status === 403 ? /403/ : /не подтверждён/);
    } finally { h.close(); }
  }
});
test('list filters hostile metadata, traverses pages, sorts newest first and uses narrow fields/q', async () => {
  let listed = 0;
  const h = await harness({ existing: true, intercept: ({ url }) => {
    if (url.pathname === '/drive/v3/files' && url.searchParams.get('q')?.includes('in parents')) {
      assert.equal(url.searchParams.get('pageSize'), '100'); assert.ok(!url.searchParams.get('fields').includes('*')); assert.ok(url.searchParams.get('q').includes('trashed = false'));
      const base = { id: 'good-1', name: '<img src=x onerror=alert(1)>.zip', mimeType: 'application/zip', parents: [folder.id], size: '100', appProperties: { application: APP, kind: 'backup', format: FORMAT, scope: 'workspace' }, createdTime: '2026-01-01' };
      listed++;
      return json(listed === 1 ? { files: [base, { ...base, id: 'foreign', appProperties: {} }, { ...base, id: 'trash', trashed: true }, { ...base, id: 'wrong-parent', parents: ['other'] }], nextPageToken: 'second' } : { files: [{ ...base, id: 'good-2', createdTime: '2026-10-22' }] });
    }
  } });
  try { assert.deepEqual((await h.run(op => h.client.list(op))).map(f => f.id), ['good-2', 'good-1']); assert.equal(listed, 2); } finally { h.close(); }
});
test('download yields exact validated ZIP; hash corruption, invalid ZIP, size limit and foreign parent rejected before saving', async () => {
  let media = null;
  const h = await harness({ intercept: ({ url, state }) => url.searchParams.get('alt') === 'media' && media ? new Response(media, { headers: { 'Content-Length': String(state.size) } }) : undefined });
  try {
    const file = await create(h); const expected = new Uint8Array(await new Blob(h.state.received).arrayBuffer());
    const result = await h.run(op => h.client.download(op, file.id)); assert.deepEqual(result.bytes, expected); assert.equal(result.projects, 0);
    await assert.rejects(h.run(op => h.client.download(op, file.id, 1)), /бюджет памяти/);
    media = expected.slice(); media[0] ^= 255; await assert.rejects(h.run(op => h.client.download(op, file.id)), /SHA-256/);
    delete h.state.files[0].appProperties.sha256; await assert.rejects(h.run(op => h.client.download(op, file.id)), /ZIP/);
    h.state.files[0].parents = ['foreign']; const before = h.state.calls.length; await assert.rejects(h.run(op => h.client.download(op, file.id)), /допустимой копией/);
    assert.ok(!h.state.calls.slice(before).some(c => c.url.searchParams.get('alt') === 'media'));
    assert.ok(!/[<>/\\\u202e]/.test(safeFilename('../evil\u202e<img>.zip')));
  } finally { h.close(); }
});
test('disconnect, user cancellation, token expiry and 401 abort in-flight operations with no automatic OAuth', async () => {
  for (const kind of ['disconnect', 'cancel', 'expiry', '401']) {
    let signal;
    const h = await harness({ expires: kind === 'expiry' ? 0.05 : 3600, intercept: ({ url, init }) => {
      if (url.pathname === '/drive/v3/files') { signal = init.signal; return kind === '401' ? json({}, 401) : new Promise(() => {}); }
    } });
    try {
      const controller = new AbortController();
      const pending = assert.rejects(h.session.withDriveOperation(op => h.client.list(op), { signal: controller.signal }), /прервана|истёк/);
      await tick(); if (kind === 'disconnect') h.session.disconnect(); if (kind === 'cancel') controller.abort();
      await pending; assert.ok(signal.aborted); assert.ok(!JSON.stringify(h.session.view()).includes('private-test-token'));
    } finally { h.close(); }
  }
});
test('stream is bounded without Content-Length; truncated, excess and failed reads cannot yield a verified ZIP', async () => {
  let mode = '';
  const h = await harness({ intercept: ({ url, state }) => {
    if (url.searchParams.get('alt') !== 'media' || !mode) return;
    const bytes = state.received[0];
    if (mode === 'truncated') return new Response(bytes.subarray(0, 10));
    if (mode === 'excess') return new Response(new Uint8Array(state.size + 1));
    return new Response(new ReadableStream({ start(controller) { controller.error(Error('read failed')); } }));
  } });
  try {
    const file = await create(h);
    for (const [value, message] of [['truncated', /не полностью/], ['excess', /превышает/], ['failed', /read failed/]]) {
      mode = value; await assert.rejects(h.run(op => h.client.download(op, file.id)), message);
    }
  } finally { h.close(); }
});
