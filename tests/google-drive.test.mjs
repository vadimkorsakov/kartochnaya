import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveSession, DRIVE_SCOPE, validClientId } from '../src/cloud/google-drive/session.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(request = async () => ({ ok: true, status: 200, json: async () => ({ user: { permissionId: 'permission-test', displayName: 'Тест', emailAddress: 'test@example.invalid' } }) })) {
  let callbacks, calls = 0, online = true, requested;
  const session = createDriveSession({ supported: () => true, online: () => online,
    load: async () => ({ initTokenClient(config) { callbacks = config; return { requestAccessToken() { calls++; } }; } }),
    request: (...args) => { requested = args; return request(...args); },
  });
  session.configure('test.apps.googleusercontent.com');
  return { session, get callbacks() { return callbacks; }, get calls() { return calls; }, get requested() { return requested; }, offline() { online = false; session.networkChanged(); } };
}
const response = extra => ({ scope: DRIVE_SCOPE, access_token: 'memory-only-test-token', expires_in: 3600, ...extra });
test('public Client ID validation, prepare separate from connect; scope, Bearer header, account, disconnect', async () => {
  assert.ok(validClientId('test.apps.googleusercontent.com')); assert.ok(!validClientId('client-secret'));
  const h = harness(); await h.session.prepare(); assert.equal(h.calls, 0);
  h.session.connect(); h.session.connect(); assert.equal(h.calls, 1);
  assert.equal(h.callbacks.scope, DRIVE_SCOPE); assert.equal(h.callbacks.include_granted_scopes, false);
  h.callbacks.callback(response()); await tick();
  assert.equal(h.session.view().status, 'connected'); assert.equal(h.session.view().account, 'Тест');
  assert.equal(h.requested[0], 'https://www.googleapis.com/drive/v3/about?fields=user(permissionId,displayName,emailAddress)');
  assert.deepEqual(h.requested[1].headers, { Authorization: 'Bearer memory-only-test-token' });
  assert.equal(h.requested[1].cache, 'no-store');
  assert.ok(!JSON.stringify(h.session.view()).includes('memory-only-test-token'));
  h.session.disconnect(); assert.equal(h.session.view().account, ''); assert.equal(h.session.view().status, 'disconnected');
});
test('denied/missing/malformed scope and token never reach Drive', async () => {
  const h = harness(() => { assert.fail('unexpected Drive request'); }); await h.session.prepare();
  for (const extra of [{ error: 'access_denied' }, { scope: '' }, { scope: {} }, { access_token: '' }, { expires_in: 0 }]) {
    h.session.connect(); h.callbacks.callback(response(extra)); await tick();
    assert.equal(h.session.view().status, 'error'); assert.equal(h.session.view().busy, false);
  }
});
test('popup close/block/origin errors release lock and allow explicit retry', async () => {
  const h = harness(); await h.session.prepare();
  for (const type of ['popup_closed', 'popup_failed_to_open', 'origin_mismatch', 'unknown']) {
    h.session.connect(); h.callbacks.error_callback({ type }); assert.equal(h.session.view().busy, false);
  }
  assert.equal(h.calls, 4); h.session.disconnect();
});
for (const [status, body, match] of [
  [401, {}, /истёк/],
  [403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }, /недостаточно разрешений/],
  [403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, /включи его/],
  [403, {}, /запретил доступ/], [500, {}, /временно недоступен/],
]) test('Drive API ' + status + ' ' + match, async () => {
  const h = harness(async () => ({ ok: false, status, json: async () => body })); await h.session.prepare();
  h.session.connect(); h.callbacks.callback(response()); await tick();
  assert.match(h.session.view().message, match); assert.equal(h.session.view().busy, false);
});
test('network failure, offline reset and late callbacks cannot reconnect', async () => {
  const h = harness(async () => { throw Error('network'); }); await h.session.prepare();
  h.session.connect(); h.callbacks.callback(response()); await tick(); assert.match(h.session.view().message, /Ошибка сети/);
  h.session.connect(); const old = h.callbacks; h.offline(); old.callback(response()); await tick();
  assert.equal(h.session.view().status, 'offline'); assert.equal(h.calls, 2);
});
test('Client ID change cancels verification; stale result does not confirm account', async () => {
  let done; const h = harness(() => new Promise(resolve => { done = resolve; })); await h.session.prepare();
  h.session.connect(); h.callbacks.callback(response());
  h.session.configure('other.apps.googleusercontent.com');
  assert.ok(h.requested[1].signal.aborted);
  done({ ok: true, status: 200, json: async () => ({ user: { permissionId: 'permission-test', displayName: 'Late' } }) }); await tick();
  assert.equal(h.session.view().status, 'disconnected'); assert.equal(h.session.view().ready, false);
});
test('expiry requires user action to reconnect', async () => {
  const h = harness(); await h.session.prepare(); h.session.connect(); h.callbacks.callback(response({ expires_in: .01 }));
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(h.session.view().status, 'expired'); assert.equal(h.calls, 1);
  h.session.connect(); h.callbacks.callback(response()); await tick(); assert.equal(h.session.view().status, 'connected'); h.session.disconnect();
});
test('GIS preparation failure, unsupported file mode, popup and API deadlines', async t => {
  let calls = 0;
  const unsupported = createDriveSession({ supported: () => false, online: () => true, load: () => { calls++; } });
  unsupported.configure('test.apps.googleusercontent.com'); await unsupported.prepare(); assert.equal(calls, 0);
  const failed = createDriveSession({ supported: () => true, online: () => true, load: async () => { throw Error('load'); } });
  failed.configure('test.apps.googleusercontent.com'); await failed.prepare(); assert.equal(failed.view().busy, false);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(() => new Promise(() => {})); await h.session.prepare(); h.session.connect();
  const old = h.callbacks; t.mock.timers.tick(120001); assert.equal(h.session.view().busy, false); old.callback(response());
  assert.equal(h.session.view().status, 'error');
  h.session.connect(); h.callbacks.callback(response()); t.mock.timers.tick(15001);
  assert.equal(h.session.view().busy, false); assert.ok(h.requested[1].signal.aborted);
  h.session.disconnect();
});
