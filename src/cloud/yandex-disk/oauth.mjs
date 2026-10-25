// Experimental, memory-only OAuth. No refresh, persistence, or provider SDK.
export const SCOPE = 'cloud_api:disk.app_folder';
export const CALLBACK = '/oauth/yandex-callback.html';
export const CLIENT_ID_KEY = 'kartochnaya-yandex-public-client-id';
export const validClientId = value => typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value);
export const randomString = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export async function challenge(verifier) {
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
const errors = {
  access_denied: 'Пользователь отказал в доступе.', invalid_client: 'Неверный Client ID или приложение заблокировано.',
  unauthorized_client: 'Приложение не разрешено Яндексом.', invalid_grant: 'Неверный или просроченный authorization code.',
  bad_verification_code: 'Неверный authorization code.', invalid_scope: 'Недостаточные OAuth-разрешения; scope не расширяется автоматически.',
  redirect_uri_mismatch: 'Redirect URI не совпадает с настройками приложения.',
};
export const oauthError = value => errors[value] || 'Яндекс отклонил OAuth-запрос. Проверь Client ID и точный Redirect URI в настройках.';
export const networkError = step => `${step}: ответ недоступен JavaScript (CORS, сеть или запрещённый редирект). Проверь Network/Console браузера; это не доказательство неверного OAuth-кода.`;
export const validBackupName = value => typeof value === 'string' && /^kartochnaya-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.zip$/.test(value);
export function authorizedEndpoint(value, method = 'GET') {
  const u = new URL(value);
  if (u.username || u.password || u.hash) throw Error('Недоверенный endpoint.');
  if (u.href === 'https://login.yandex.ru/info' && method === 'GET') return u.href;
  if (u.origin !== 'https://cloud-api.yandex.net' || !['/v1/disk/resources', '/v1/disk/resources/upload', '/v1/disk/resources/download'].includes(u.pathname)) throw Error('Недоверенный endpoint.');
  const path = u.searchParams.get('path');
  const keys = [...u.searchParams.keys()];
  if (new Set(keys).size !== keys.length) throw Error('Повторный параметр API.');
  const only = allowed => keys.every(k => allowed.includes(k));
  const resource = u.pathname === '/v1/disk/resources';
  const probe = /^app:\/kartochnaya-probe-[A-Za-z0-9_-]{43}\.txt$/.test(path || '');
  const archive = path?.startsWith('app:/') && validBackupName(path.slice(5));
  const pagination = ['limit', 'offset'].every(k => !u.searchParams.has(k) || (/^(0|[1-9]\d*)$/.test(u.searchParams.get(k)) && Number(u.searchParams.get(k)) <= (k === 'limit' ? 100 : 10000) && (k !== 'limit' || Number(u.searchParams.get(k)) > 0)));
  const permitted = method === 'GET' && resource && path === 'app:/' && only(['path', 'limit', 'offset']) && pagination
    || method === 'GET' && (resource || u.pathname.endsWith('/download')) && archive && only(['path'])
    || method === 'GET' && u.pathname.endsWith('/upload') && archive && only(['path', 'overwrite']) && u.searchParams.get('overwrite') === 'false'
    || probe && (method === 'GET' && resource && only(['path'])
      || method === 'GET' && u.pathname.endsWith('/upload') && only(['path', 'overwrite']) && u.searchParams.get('overwrite') === 'false'
      || method === 'GET' && u.pathname.endsWith('/download') && only(['path'])
      || method === 'DELETE' && resource && only(['path', 'permanently']) && u.searchParams.get('permanently') === 'true');
  if (!permitted) throw Error('Недопустимый путь или операция API.');
  return u.href;
}
export function createOAuth({ win = window, request = globalThis.fetch.bind(globalThis), changed = () => {}, timeoutMs = 120000, closePollMs = 500 } = {}) {
  let clientId = '', attempt = null, token = '', expires = 0, expiry, generation = 0;
  let status = 'disconnected', message = 'Требуется подключение.', results = {};
  const operations = new Set();
  const view = () => ({ clientId, status, message, results: { ...results }, connected: !!token && Date.now() < expires, generation, busy: !!attempt, redirectUri: win.location.origin + CALLBACK });
  const emit = () => changed(view());
  function stopAttempt() {
    const old = attempt; attempt = null;
    if (!old) return;
    clearTimeout(old.timer); clearInterval(old.poll); win.removeEventListener('message', old.listener);
    old.controller.abort(); old.verifier = ''; old.state = ''; old.popup?.close();
  }
  function disconnect(note = 'Отключено. После reload требуется новое подключение.') {
    generation++; stopAttempt(); clearTimeout(expiry); token = ''; expires = 0;
    for (const c of operations) c.abort(); operations.clear();
    status = 'disconnected'; message = note; emit();
  }
  function fail(note) { disconnect(note); status = 'error'; emit(); }
  function configure(value) {
    if (!validClientId(value)) throw Error('Неверный Client ID: требуется 32 шестнадцатеричных символа.');
    disconnect(); clientId = value; results = {}; emit();
  }
  function connect() {
    if (attempt) return;
    if (!validClientId(clientId)) { fail('Настрой публичный Client ID.'); return; }
    if (win.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(win.location.hostname)) { fail('Для OAuth нужен HTTPS-сайт.'); return; }
    disconnect(); results = {};
    // Must run synchronously inside the user's click, before SHA-256's await.
    let popup;
    try { popup = win.open('about:blank', '_blank', 'popup,width=540,height=720'); } catch { /* handled below */ }
    if (!popup) { fail('Popup заблокирован. Разреши всплывающие окна и повтори подключение; на мобильном браузере может потребоваться другой браузер.'); return; }
    const a = { popup, verifier: randomString(), state: randomString(), controller: new AbortController(), consumed: false };
    attempt = a; status = 'authorizing'; message = 'Ожидаем Яндекс. Если Redirect URI отклонён, проверь его точное совпадение в настройках приложения.';
    a.listener = event => {
      if (attempt !== a || a.consumed || event.origin !== win.location.origin || event.source !== popup) return;
      const d = event.data;
      if (!d || d.type !== 'kartochnaya-yandex-callback') { fail('Неизвестный OAuth callback.'); return; }
      if (d.state !== a.state) { fail('OAuth state не совпадает. Попытка отменена.'); return; }
      if (d.error) { fail(oauthError(d.error)); return; }
      if (typeof d.code !== 'string' || !d.code || d.code.length > 2048) { fail('Неизвестный OAuth callback: отсутствует code.'); return; }
      a.consumed = true; clearInterval(a.poll); popup.close();
      status = 'exchanging'; message = 'OAuth POST /token: проверка браузерного доступа…'; emit();
      void exchange(a, d.code);
    };
    win.addEventListener('message', a.listener);
    a.timer = setTimeout(() => { if (attempt === a) fail('OAuth: таймаут ожидания. Opener мог быть недоступен из-за ограничений браузера/COOP.'); }, timeoutMs);
    a.poll = setInterval(() => { if (attempt === a && popup.closed) fail('Окно OAuth закрыто или изолировано браузером (COOP). Подключи повторно.'); }, closePollMs);
    emit();
    void challenge(a.verifier).then(value => {
      if (attempt !== a || a.consumed) return;
      const url = new URL('https://oauth.yandex.ru/authorize');
      url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: view().redirectUri, scope: SCOPE, force_confirm: 'yes', state: a.state, code_challenge: value, code_challenge_method: 'S256' });
      popup.location.replace(url.href);
    }).catch(() => { if (attempt === a) fail('Не удалось подготовить PKCE или открыть окно Яндекса.'); });
  }
  async function exchange(a, code) {
    try {
      const res = await request('https://oauth.yandex.ru/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: a.verifier }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: a.controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', mode: 'cors' });
      a.verifier = ''; code = '';
      let body;
      try { body = await res.json(); } catch {
        if (attempt === a) { results.oauth = `Заблокировано: OAuth HTTP ${res.status}, некорректный JSON-ответ.`; fail(results.oauth); }
        return;
      }
      if (attempt !== a) return;
      if (!res.ok || body?.error) { results.oauth = `Заблокировано: HTTP ${res.status}. ${oauthError(body?.error)}`; fail(results.oauth); return; }
      if (!body || typeof body !== 'object') { fail('OAuth: некорректный ответ сервера.'); return; }
      if (typeof body.access_token !== 'string' || !body.access_token || (typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer') || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0) { fail('OAuth: неполный ответ токена. Подключи повторно.'); return; }
      if (body.scope !== undefined && (typeof body.scope !== 'string' || !body.scope.split(/\s+/).includes(SCOPE))) { fail(oauthError('invalid_scope')); return; }
      token = body.access_token; expires = Date.now() + Math.min(Number(body.expires_in) * 1000, 2147483647);
      // refresh_token is deliberately never retained.
      stopAttempt(); expiry = setTimeout(() => disconnect('Срок доступа истёк. Подключи Яндекс повторно.'), expires - Date.now());
      status = 'connected'; message = 'Подключено в памяти до reload/отключения. API ещё не проверен.'; results.oauth = 'Подтверждено: OAuth POST /token доступен JavaScript.'; emit();
    } catch {
      if (attempt === a) { results.oauth = 'Не проверено: ' + networkError('OAuth POST /token'); fail(results.oauth); }
    } finally { a.verifier = ''; code = ''; }
  }
  async function operation(action, { signal: externalSignal, timeoutMs: operationMs = 30000 } = {}) {
    if (!Number.isFinite(operationMs) || operationMs <= 0 || operationMs > 900000) throw Error('Недопустимый таймаут операции.');
    if (!token || Date.now() >= expires) { disconnect('Подключи Яндекс повторно.'); throw Error('Нет действующей сессии Яндекса.'); }
    const run = generation, c = new AbortController(); operations.add(c);
    const signal = AbortSignal.any([c.signal, AbortSignal.timeout(operationMs), ...(externalSignal ? [externalSignal] : [])]);
    const check = () => { if (run !== generation || !token || signal.aborted || Date.now() >= expires) throw Error('Операция отменена или срок доступа истёк.'); };
    try {
      return await action({ signal, check, request: async (url, options = {}, authorized = true) => {
        check(); const method = options.method || 'GET';
        if (authorized) url = authorizedEndpoint(url, method);
        else {
          if (!['GET', 'PUT'].includes(method)) throw Error('Недопустимый метод передачи.');
          url = signedEndpoint(url);
          if (new Headers(options.headers).has('Authorization')) throw Error('Авторизация на подписанном URL запрещена.');
        }
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(!authorized && ['PUT', 'GET'].includes(method) && operationMs > 30000 ? 600000 : 30000)]);
        const signedGet = !authorized && method === 'GET';
        let res;
        try { res = await request(url, { ...options, method, headers: authorized ? { Authorization: 'OAuth ' + token } : options.headers, signal: requestSignal, credentials: 'omit', cache: 'no-store', redirect: signedGet ? 'follow' : 'error', referrerPolicy: 'no-referrer', mode: 'cors' }); }
        catch { check(); throw Error(networkError('Запрос')); }
        check();
        // Fetch has already followed redirects; this validates only the final URL.
        if (signedGet) {
          try { signedEndpoint(res.url); }
          catch (error) { await res.body?.cancel().catch(() => {}); throw error; }
        }
        if (authorized && res.status === 401) { disconnect('HTTP 401: подключи Яндекс повторно.'); throw Error('HTTP 401: токен отклонён.'); }
        return res;
      } });
    } finally { operations.delete(c); c.abort(); }
  }
  return { view, configure, connect, disconnect, operation };
}
// Only transfer hosts used by Disk, never arbitrary Yandex subdomains.
export function signedEndpoint(value) {
  let u; try { u = new URL(value); } catch { throw Error('Ошибка подписанного URL.'); }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || u.hash || !(/^(?:[a-z0-9-]+\.)*storage\.yandex\.net$/.test(u.hostname) || /^uploader[a-z0-9-]*\.(?:dst|disk)\.yandex\.net$/.test(u.hostname) || /^downloader[a-z0-9-]*\.(?:dst|disk)\.yandex\.ru$/.test(u.hostname))) throw Error('Недоверенный подписанный URL. Хост не разрешён прототипом.');
  return u.href;
}
