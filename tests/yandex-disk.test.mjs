import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { challenge, createOAuth, authorizedEndpoint, signedEndpoint, SCOPE } from '../src/cloud/yandex-disk/oauth.mjs';
import { createDiagnostics } from '../src/cloud/yandex-disk/diagnostics.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const sessions = [];
afterEach(() => { for (const s of sessions.splice(0)) s.disconnect(); });
const tick = () => new Promise(r => setTimeout(r, 5));
const token = 'memory-only-test-token';
const response = body => Response.json(body);
function downloaded(body, url = 'https://storage.yandex.net/test') {
  const res = new Response(body);
  Object.defineProperty(res, 'url', { value: url });
  return res;
}
function harness(request = async () => response({ access_token: token, token_type: 'bearer', expires_in: 3600 }), options = {}) {
  let listener, url, popup, navigation, navigated, opens = 0; const calls = [];
  const win = { location: new URL('https://test.example/'), open() { opens++; navigation = new Promise(resolve => { navigated = resolve; }); popup = { closed: false, close() { this.closed = true; }, location: { replace(value) { url = new URL(value); navigated(); } } }; return popup; }, addEventListener(_, fn) { listener = fn; }, removeEventListener(_, fn) { if (listener === fn) listener = null; } };
  const session = createOAuth({ win, request: (...args) => { calls.push(args); return request(...args); }, ...options });
  sessions.push(session);
  session.configure('a'.repeat(32));
  const send = (data = {}, meta = {}) => listener?.({ origin: win.location.origin, source: popup, data: { type: 'kartochnaya-yandex-callback', state: url?.searchParams.get('state'), code: 'test-code', ...data }, ...meta });
  return { session, send, win, calls, get popup() { return popup; }, get url() { return url; }, get ready() { return navigation; }, get opens() { return opens; } };
}
async function connected(request) { const h = harness(request); h.session.connect(); await h.ready; h.send(); await tick(); assert.equal(h.session.view().connected, true); return h; }
test('RFC 7636 S256 vector; independent verifier/state; synchronous popup; exact minimal OAuth parameters', async () => {
  assert.equal(await challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const h = harness(); h.session.connect(); assert.equal(h.opens, 1); await h.ready;
  const p = h.url.searchParams;
  assert.equal(p.get('scope'), SCOPE); assert.equal(p.get('response_type'), 'code'); assert.equal(p.get('force_confirm'), 'yes'); assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('redirect_uri'), 'https://test.example/oauth/yandex-callback.html');
  h.send(); await tick();
  const [url, opts] = h.calls[0]; assert.equal(url, 'https://oauth.yandex.ru/token');
  const body = opts.body;
  assert.equal(body.get('grant_type'), 'authorization_code'); assert.equal(body.get('code'), 'test-code'); assert.equal(body.get('client_id'), 'a'.repeat(32));
  assert.match(body.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/); assert.notEqual(body.get('code_verifier'), p.get('state'));
  assert.equal(await challenge(body.get('code_verifier')), p.get('code_challenge')); assert.equal(body.has('client_secret'), false);
  for (const [k, v] of Object.entries({ cache: 'no-store', credentials: 'omit', redirect: 'error', mode: 'cors' })) assert.equal(opts[k], v);
  assert.equal(h.session.view().connected, true); assert.doesNotMatch(JSON.stringify(h.session.view()), /memory-only-test-token|test-code|code_verifier/);
  h.session.disconnect();
});
test('origin and source rejected, exact state checked, callback consumed only once', async () => {
  const h = harness(); h.session.connect(); await h.ready;
  h.send({}, { origin: 'https://evil.example' }); h.send({}, { source: {} }); assert.equal(h.calls.length, 0);
  h.send({ state: 'wrong' }); assert.equal(h.session.view().connected, false); assert.match(h.session.view().message, /state/); assert.equal(h.calls.length, 0);
  h.session.connect(); await h.ready; const state = h.url.searchParams.get('state'); h.send(); h.send(); await tick();
  assert.equal(h.calls.length, 1); h.send({ state }); assert.equal(h.calls.length, 1); h.session.disconnect();
});
test('unknown callback, user rejection and invalid callback cannot exchange', async () => {
  const h = harness();
  for (const data of [{ type: 'unknown' }, { error: 'access_denied', code: null }, { code: null }]) {
    h.session.connect(); await h.ready; h.send(data); assert.equal(h.session.view().status, 'error');
  }
  assert.equal(h.calls.length, 0); h.session.disconnect();
});
test('blocked popup, cancellation, closed popup and timeout release attempts', async () => {
  const h = harness(undefined, { timeoutMs: 25, closePollMs: 5 });
  h.win.open = () => null; h.session.connect(); assert.match(h.session.view().message, /Popup заблокирован/);
  const c = harness(undefined, { closePollMs: 5 }); c.session.connect(); c.session.disconnect(); await tick(); assert.equal(c.url, undefined); assert.equal(c.session.view().busy, false);
  c.session.connect(); await c.ready; c.popup.closed = true; await new Promise(r => setTimeout(r, 15)); assert.match(c.session.view().message, /закрыто/);
  const t = harness(undefined, { timeoutMs: 10 }); t.session.connect(); await new Promise(r => setTimeout(r, 20)); assert.match(t.session.view().message, /таймаут/);
  c.session.disconnect(); t.session.disconnect(); h.session.disconnect();
});
test('late token after disconnect cannot resurrect session; aborts request and clears verifier attempt', async () => {
  let resolve; const h = harness(() => new Promise(r => { resolve = r; })); h.session.connect(); await h.ready; h.send();
  h.session.disconnect(); assert.equal(h.calls[0][1].signal.aborted, true);
  resolve(response({ access_token: token, token_type: 'bearer', expires_in: 3600 })); await tick(); assert.equal(h.session.view().connected, false);
  await assert.rejects(h.session.operation(() => assert.fail()), /сессии/);
});
for (const [error, match] of [['invalid_client', /Client ID/], ['invalid_grant', /просроченный/], ['redirect_uri_mismatch', /Redirect URI/], ['invalid_scope', /разрешения/]]) test('OAuth safe error ' + error, async () => {
  const h = harness(async () => Response.json({ error, error_description: token }, { status: 400 }));
  h.session.connect(); await h.ready; h.send(); await tick(); assert.match(h.session.view().message, match); assert.doesNotMatch(JSON.stringify(h.session.view()), /memory-only/); h.session.disconnect();
});
test('CORS/network failure is not invalid code proof; endpoints reject untrusted hosts and paths', async () => {
  const h = harness(async () => { throw TypeError(token); }); h.session.connect(); await h.ready; h.send(); await tick();
  assert.match(h.session.view().message, /CORS/); assert.doesNotMatch(h.session.view().message, /memory-only/); h.session.disconnect();
  for (const url of ['http://login.yandex.ru/info', 'https://evil.example/v1/disk/resources?path=app:/', 'https://cloud-api.yandex.net/v1/disk', 'https://cloud-api.yandex.net/v1/disk/resources?path=disk:/', 'https://cloud-api.yandex.net/v1/disk/resources?path=app:/&access_token=secret']) assert.throws(() => authorizedEndpoint(url));
  for (const url of ['https://evil.example/x', 'http://storage.yandex.net/x', 'https://storage.yandex.net.evil.example/x', 'https://user@storage.yandex.net/x']) assert.throws(() => signedEndpoint(url));
});
const goodToken = () => response({ access_token: token, token_type: 'bearer', expires_in: 3600 });
test('independent identification permission failure does not prevent app folder check', async () => {
  const h = await connected(async url => url.includes('/token') ? goodToken() : url.includes('/info') ? Response.json({}, { status: 403 }) : response({}));
  const d = createDiagnostics(h.session); await d.api(); assert.match(d.view().results.identity, /403/); assert.match(d.view().results.folder, /Подтверждено/); h.session.disconnect();
});
test('transfer reads actual bytes, no bearer on signed URLs; explicit delete only tracked file', async () => {
  let content; const h = await connected(async (url, opts) => {
    if (url.includes('/token')) return goodToken();
    if (url.includes('/resources/upload')) return response({ href: 'https://uploader.storage.yandex.net/test?signature=hidden', method: 'PUT' });
    if (url.includes('/resources/download')) return response({ href: 'https://downloader.disk.yandex.ru/test?signature=hidden', method: 'GET' });
    if (opts.method === 'PUT') { content = opts.body; assert.equal(opts.headers.Authorization, undefined); return new Response('', { status: 201 }); }
    if (url.includes('downloader')) { assert.equal(opts.headers, undefined); return downloaded(content); }
    if (opts.method === 'DELETE') return new Response(null, { status: 204 });
    throw Error('unexpected');
  });
  const d = createDiagnostics(h.session); assert.equal(h.calls.length, 1); await d.transfer();
  assert.match(d.view().results.get, /совпадает/); assert.match(d.view().path, /^app:\/kartochnaya-probe-/); assert.equal(h.calls.filter(([, o]) => o.method === 'DELETE').length, 0);
  assert.doesNotMatch(JSON.stringify(d.view()), /signature|hidden|memory-only/);
  await d.transfer(); assert.equal(h.calls.length, 5); await d.remove(); assert.equal(d.view().path, '');
  assert.equal(h.calls.at(-1)[1].headers.Authorization, 'OAuth ' + token); h.session.disconnect();
});

test('only signed GET follows redirects; callers cannot override policy or transfer credentials', async () => {
  const h = await connected(async url => url.includes('/token') ? goodToken() : downloaded('bytes'));
  await h.session.operation(async op => {
    await op.request('https://cloud-api.yandex.net/v1/disk/resources?path=app:/', { redirect: 'follow' });
    await op.request('https://uploader.storage.yandex.net/test', { method: 'PUT', redirect: 'follow' }, false);
    await op.request('https://downloader.disk.yandex.ru/test', { redirect: 'error' }, false);
  });
  assert.deepEqual(h.calls.map(([, o]) => o.redirect), ['error', 'error', 'error', 'follow']);
  for (const [, opts] of h.calls) {
    for (const [key, value] of Object.entries({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', mode: 'cors' })) assert.equal(opts[key], value);
    assert.ok(opts.signal instanceof AbortSignal);
  }
  assert.equal(h.calls[1][1].headers.Authorization, 'OAuth ' + token);
  for (const [, opts] of h.calls.slice(2)) assert.equal(new Headers(opts.headers).has('Authorization'), false);
});
test('signed GET validates final HTTPS transfer host and does not expose signed URLs', async () => {
  for (const final of ['https://storage.yandex.net/test', 'https://s1.storage.yandex.net/test', 'https://downloader.disk.yandex.ru/test']) {
    const h = await connected(async url => url.includes('/token') ? goodToken() : downloaded('bytes', final));
    const res = await h.session.operation(op => op.request('https://downloader.disk.yandex.ru/test', {}, false));
    assert.equal(await res.text(), 'bytes');
  }
  for (const final of ['', 'http://storage.yandex.net/test', 'https://evil.example/test?signature=secret', 'https://storage.yandex.net.evil.example/test']) {
    const h = await connected(async url => url.includes('/token') ? goodToken() : downloaded('bytes', final));
    await assert.rejects(h.session.operation(op => op.request('https://downloader.disk.yandex.ru/test', {}, false)), error => {
      assert.doesNotMatch(error.message, /secret|https?:/); return true;
    });
  }
});
test('signed GET network/CORS failure cannot report successful download', async () => {
  const h = await connected(async (url, opts) => {
    if (url.includes('/token')) return goodToken();
    if (url.includes('/resources/upload')) return response({ href: 'https://uploader.storage.yandex.net/test', method: 'PUT' });
    if (url.includes('/resources/download')) return response({ href: 'https://downloader.disk.yandex.ru/test', method: 'GET' });
    if (opts.method === 'PUT') return new Response('', { status: 201 });
    throw TypeError('https://storage.yandex.net/test?signature=secret');
  });
  const d = createDiagnostics(h.session); await d.transfer();
  assert.match(d.view().results.get, /Заблокировано:.*CORS/);
  assert.doesNotMatch(d.view().results.get, /Подтверждено|совпадает|signature|secret/);
});

test('failed transfer preserves safe orphan path; failed deletion does not erase it; disconnect forbids deletion with another account', async () => {
  const h = await connected(async (url, opts) => {
    if (url.includes('/token')) return goodToken();
    if (url.includes('/resources/upload')) return response({ href: 'https://uploader.storage.yandex.net/test', method: 'PUT' });
    if (opts.method === 'DELETE') return new Response('', { status: 403 });
    throw TypeError('secret URL');
  });
  const d = createDiagnostics(h.session); await d.transfer(); assert.match(d.view().results.put, /CORS/); const path = d.view().path; assert.ok(path);
  await d.remove(); assert.match(d.view().results.remove, /403/); assert.equal(d.view().path, path);
  d.disconnected(); assert.deepEqual(d.view().results, {}); await d.remove(); assert.equal(h.calls.length, 4); h.session.disconnect();
});
test('oversized or different downloaded bytes fail comparison; 401 clears token', async () => {
  for (const content of ['wrong', 'x'.repeat(1025)]) {
    const h = await connected(async (url, opts) => {
      if (url.includes('/token')) return goodToken();
      if (url.includes('/resources/upload')) return response({ href: 'https://uploader.storage.yandex.net/test', method: 'PUT' });
      if (url.includes('/resources/download')) return response({ href: 'https://downloader.disk.yandex.ru/test', method: 'GET' });
      if (opts.method === 'PUT') return new Response('', { status: 201 });
      return downloaded(content);
    });
    const d = createDiagnostics(h.session); await d.transfer(); assert.match(d.view().results.get, /не совпадает|1024/); h.session.disconnect();
  }
  const h = await connected(async url => url.includes('/token') ? goodToken() : new Response('', { status: 401 }));
  await createDiagnostics(h.session).api(); assert.equal(h.session.view().connected, false); h.session.disconnect();
});
test('callback scrubs query before messaging; exact targetOrigin; opener-null, duplicate and unknown callbacks fail safely', async () => {
  const html = await readFile(new URL('../src/oauth/yandex-callback.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /indexedDB|serviceWorker|google-drive|editor\.js|src=/);
  for (const [query, accepted] of [
    ['?code=test&state=valid&cid=123', true],
    ['?code=test&state=valid', true],
    ['?code=test&state=valid&unexpected=123', false],
    ['?code=test&cid=123', false],
    ['?code=a&code=b&state=valid', false],
    ['?code=test&state=valid&state=other', false],
    ['?error=access_denied&error=other&state=valid', false],
    ['?code=test&error=access_denied&state=valid', false],
    ['?access_token=secret', false],
    ['', false]
  ]) {
    const events = []; const location = new URL('https://test.example/oauth/yandex-callback.html' + query);
    const context = { URLSearchParams, location, history: { replaceState(...args) { events.push(['scrub', ...args]); } }, window: { opener: { postMessage(...args) { events.push(['message', ...args]); } } } };
    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
    assert.equal(events[0][0], 'scrub'); assert.equal(events[0][3], '/oauth/yandex-callback.html'); assert.equal(events[1][2], 'https://test.example');
    assert.equal(events[1][1].type, accepted ? 'kartochnaya-yandex-callback' : 'kartochnaya-yandex-invalid-callback');
    assert.equal(Object.hasOwn(events[1][1], 'cid'), false);
    if (accepted) assert.deepEqual({ ...events[1][1] }, { type: 'kartochnaya-yandex-callback', state: 'valid', code: 'test', error: null });
  }
  let listener; const node = {};
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { URLSearchParams, location: new URL('https://test.example/oauth/yandex-callback.html?code=secret&state=x'), history: { replaceState() {} }, window: { opener: null }, document: { addEventListener(_, fn) { listener = fn; }, getElementById() { return node; } } });
  listener(); assert.match(node.textContent, /недоступно/); assert.doesNotMatch(node.textContent, /secret/);
});

test('new attempts use fresh state and challenge; expiry aborts active operations and requires reconnect', async () => {
  const h = harness(async url => url.includes('/token') ? response({ access_token: token, token_type: 'bearer', expires_in: 0.05 }) : new Promise(() => {}));
  h.session.connect(); await h.ready; const first = h.url;
  h.session.disconnect(); h.session.connect(); await h.ready;
  assert.notEqual(first.searchParams.get('state'), h.url.searchParams.get('state'));
  assert.notEqual(first.searchParams.get('code_challenge'), h.url.searchParams.get('code_challenge'));
  h.send(); await tick();
  let signal;
  void h.session.operation(async op => { signal = op.signal; await op.request('https://login.yandex.ru/info'); });
  await new Promise(r => setTimeout(r, 65));
  assert.equal(h.session.view().connected, false); assert.equal(signal.aborted, true);
  await assert.rejects(h.session.operation(() => {}), /сессии/);
});
