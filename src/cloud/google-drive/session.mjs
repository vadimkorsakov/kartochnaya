import { loadGoogleIdentity } from './gis.mjs';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const CLIENT_ID_KEY = 'kartochnaya-google-drive-client-id';
export const validClientId = value => value.length <= 512 && /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(value);
const messages = {
  access_denied: 'Доступ не предоставлен. Можно подключить повторно.',
  popup_closed: 'Окно авторизации закрыто. Можно подключить повторно.',
  popup_failed_to_open: 'Браузер заблокировал окно Google. Разреши popup для этого сайта и нажми подключение повторно.',
  origin_mismatch: 'Адрес сайта не разрешён в Google Cloud. Проверь Authorized JavaScript origins для этого Client ID.',
};

// Tokens and account data live only in this closure. No background OAuth/refresh.
export function createDriveSession({ load = loadGoogleIdentity, request = globalThis.fetch.bind(globalThis), online = () => navigator.onLine, supported = () => location.protocol === 'https:' || (location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)), changed = () => {} } = {}) {
  let clientId = '', oauth = null, token = null, expiresAt = 0;
  let state = { status: 'unconfigured', message: 'Не настроен Client ID.', account: '' };
  let generation = 0, deadline, expiry, abort;
  const busy = () => ['preparing', 'authorizing', 'checking'].includes(state.status);
  const emit = (status, message, account = '') => { state = { status, message, account }; changed(view()); };
  function clear() {
    generation++; clearTimeout(deadline); clearTimeout(expiry); abort?.abort(); abort = null;
    token = null; expiresAt = 0;
  }
  function fail(message, status = 'error') { clear(); emit(status, message); }
  function available() {
    if (!supported()) { fail('Авторизация недоступна в file://. Открой КАРТОЧНУЮ на HTTPS-сайте.'); return false; }
    if (!online()) { fail('Отсутствует интернет. Локальные проекты, JSON и ZIP доступны.', 'offline'); return false; }
    return true;
  }
  function view() { return { ...state, clientId, ready: !!oauth, busy: busy(), supported: supported(), online: online() }; }
  function configure(value) {
    clear(); clientId = value; oauth = null;
    emit(value ? 'disconnected' : 'unconfigured', value ? 'Не подключён.' : 'Не настроен Client ID.');
  }
  async function prepare() {
    if (busy() || !clientId || !available()) return;
    clear(); const run = generation; emit('preparing', 'Подготовка авторизации…');
    try {
      const result = await load();
      if (run !== generation) return;
      oauth = result; emit('disconnected', 'Авторизация подготовлена. Нажми «Подключить Google Drive», чтобы открыть окно Google.');
    } catch { if (run === generation) fail('Не удалось загрузить Google Identity Services. Проверь интернет и блокировщики, затем повтори подготовку.'); }
  }
  function connect() {
    if (busy() || !clientId || !oauth || !available()) return;
    clear(); const run = generation;
    emit('authorizing', 'Ожидаем разрешение в окне Google…');
    deadline = setTimeout(() => { if (run === generation) fail('Время ожидания Google истекло. Подключи повторно.'); }, 120000);
    const onError = error => { if (run === generation) fail(messages[error?.type || error?.error] || 'Ошибка подключения к Google. Проверь Client ID, интернет и настройки OAuth.'); };
    try {
      const client = oauth.initTokenClient({
        client_id: clientId, scope: DRIVE_SCOPE, include_granted_scopes: false,
        error_callback: onError,
        callback: response => { void verify(response, run); },
      });
      // Synchronous call from the click handler; no await or promise before popup.
      client.requestAccessToken({ prompt: 'select_account' });
    } catch (error) { onError(error); }
  }
  async function verify(response, run) {
    if (run !== generation || state.status !== 'authorizing') return;
    clearTimeout(deadline);
    if (response?.error) { fail(messages[response.error] || 'Google отклонил авторизацию. Проверь Client ID и настройки OAuth.'); return; }
    if (typeof response?.scope !== 'string' || !response.scope.split(/\s+/).includes(DRIVE_SCOPE)) { fail('Не предоставлено разрешение drive.file. Подключи повторно и разреши доступ к файлам приложения.'); return; }
    const seconds = Number(response.expires_in);
    if (typeof response.access_token !== 'string' || !response.access_token || !Number.isFinite(seconds) || seconds <= 0) { fail('Google вернул неполный ответ авторизации. Подключи повторно.'); return; }
    token = response.access_token; expiresAt = Date.now() + Math.min(seconds * 1000, 2147483647);
    expiry = setTimeout(expire, Math.min(seconds * 1000, 2147483647));
    abort = new AbortController();
    deadline = setTimeout(() => { if (run === generation) fail('Drive API не ответил вовремя. Проверь интернет и подключи повторно.'); }, 15000);
    emit('checking', 'Проверяем доступ к Google Drive API…');
    try {
      const res = await request('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', {
        method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: abort.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (run !== generation) return;
      if (res.status === 401) { fail('Срок доступа истёк. Подключи Google Drive повторно.', 'expired'); return; }
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (run !== generation) return;
        const reasons = [...(body.error?.errors || []).map(e => e.reason), ...(body.error?.details || []).map(e => e.reason)];
        const disabled = reasons.some(r => ['accessNotConfigured', 'serviceDisabled', 'SERVICE_DISABLED'].includes(r));
        const permission = reasons.some(r => ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(r));
        fail(disabled ? 'Google Drive API недоступен: включи его в Google Cloud проекте этого Client ID.' : permission ? 'Drive API: недостаточно разрешений. Подключи повторно и предоставь drive.file.' : 'Google Drive API запретил доступ (403). Проверь ограничения аккаунта, квоты и настройки API в Google Cloud.'); return;
      }
      if (!res.ok) { fail('Google Drive API временно недоступен. Подключи повторно позже.'); return; }
      const body = await res.json();
      if (run !== generation) return;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('invalid_response');
      clearTimeout(deadline); abort = null;
      const user = body.user || {};
      const account = typeof user.displayName === 'string' && user.displayName || typeof user.emailAddress === 'string' && user.emailAddress || '';
      emit('connected', 'Google Drive подключён' + (account ? ' — ' + account : '') + '.', account);
    } catch { if (run === generation) fail(online() ? 'Ошибка сети при проверке Google Drive. Подключи повторно.' : 'Отсутствует интернет. Локальные проекты, JSON и ZIP доступны.', online() ? 'error' : 'offline'); }
  }
  function expire() { if (token) fail('Срок доступа истёк. Подключи Google Drive повторно.', 'expired'); }
  function networkChanged() {
    if (!online()) { fail('Отсутствует интернет. Локальные проекты, JSON и ZIP доступны.', 'offline'); }
    else if (token && Date.now() >= expiresAt) expire();
    else if (state.status === 'offline') emit(clientId ? 'disconnected' : 'unconfigured', clientId ? 'Не подключён. Интернет доступен, можно подключиться.' : 'Не настроен Client ID.');
  }
  return { view, configure, prepare, connect, networkChanged, checkExpiry() { if (token && Date.now() >= expiresAt) expire(); }, disconnect() { clear(); emit(clientId ? 'disconnected' : 'unconfigured', clientId ? 'Не подключён.' : 'Не настроен Client ID.'); } };
}
