import { createDriveSession, CLIENT_ID_KEY, validClientId } from './session.mjs';

export function installGoogleDriveUI() {
  const grid = document.querySelector('#homeDataPane .home-data-grid');
  if (!grid) return;
  const card = document.createElement('article'); card.className = 'home-data-card'; card.id = 'googleDriveCard';
  card.innerHTML = '<div class="home-data-icon" aria-hidden="true">☁</div><h2>Google Drive</h2><p>Резервные копии КАРТОЧНОЙ в вашем Google Drive. Проекты продолжат храниться на устройстве</p><p id="driveStatus" role="status" aria-live="polite"></p><button type="button" class="btn btn-primary" id="driveConnect"></button><button type="button" class="btn btn-outline" id="driveDisconnect">Отключить</button><button type="button" class="btn btn-outline" id="driveConfigure">Настроить Client ID</button><span class="home-data-footnote">На этом этапе доступна проверка подключения. Загрузка копий в Drive пока не выполняется.</span>';
  grid.append(card);
  const dialog = document.createElement('dialog'); dialog.id = 'driveSettings'; dialog.setAttribute('aria-labelledby', 'driveSettingsTitle');
  dialog.innerHTML = '<form method="dialog"><h2 id="driveSettingsTitle">Google OAuth Client ID</h2><p>Публичный Web application Client ID из Google Cloud. Хранится только в этом браузере и не включается в ZIP. При изменении текущий сеанс будет сброшен.</p><label for="driveClientId">Client ID</label><input id="driveClientId" autocomplete="off" spellcheck="false" maxlength="512" placeholder="….apps.googleusercontent.com"><p id="driveSettingsError" role="alert"></p><button class="btn btn-outline" id="driveCancel" type="button">Отмена</button><button class="btn btn-primary" id="driveSave" type="submit">Сохранить</button></form>';
  document.body.append(dialog);
  const style = document.createElement('style'); style.textContent = '#googleDriveCard button{margin-top:10px}#driveStatus{overflow-wrap:anywhere}#driveSettings{background:#261e30;color:#f4effb;border:1px solid #574661;border-radius:18px;padding:24px;width:min(540px,calc(100% - 24px));box-sizing:border-box;max-height:calc(100dvh - 32px);overflow:auto}#driveSettings::backdrop{background:#100b18bb}#driveSettings input{display:block;width:100%;box-sizing:border-box;margin:12px 0;padding:10px}#driveSettings p{line-height:1.55}#driveSettingsError{color:#ffb8a0}'; document.head.append(style);
  const find = id => document.getElementById(id);
  const connect = find('driveConnect'), disconnect = find('driveDisconnect'), status = find('driveStatus');
  function render(view) {
    status.textContent = !view.supported ? 'Авторизация недоступна в file://. Открой КАРТОЧНУЮ на HTTPS-сайте.' : !view.online ? 'Отсутствует интернет. Локальные проекты, JSON и ZIP доступны.' : view.message;
    status.dataset.state = view.status;
    connect.hidden = view.status === 'connected';
    connect.disabled = !view.clientId || view.busy || !view.online || !view.supported;
    connect.textContent = view.busy ? 'Подключение…' : !view.ready ? 'Подготовить авторизацию' : ['error', 'expired', 'offline'].includes(view.status) ? 'Подключить повторно' : 'Подключить Google Drive';
    disconnect.hidden = !['connected', 'authorizing', 'checking'].includes(view.status);
    card.setAttribute('aria-busy', String(view.busy));
  }
  const session = createDriveSession({ changed: render });
  function readSetting() {
    try { const id = localStorage.getItem(CLIENT_ID_KEY) || ''; session.configure(validClientId(id) ? id : ''); }
    catch { session.configure(''); status.textContent = 'Настройки браузера недоступны. Разреши локальное хранилище для сохранения Client ID.'; }
  }
  readSetting();
  connect.onclick = () => { if (session.view().ready) session.connect(); else void session.prepare(); };
  disconnect.onclick = () => session.disconnect();
  find('driveConfigure').onclick = () => { find('driveClientId').value = session.view().clientId; find('driveSettingsError').textContent = ''; dialog.showModal(); find('driveClientId').focus(); };
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    const value = find('driveClientId').value.trim();
    if (value && !validClientId(value)) { find('driveSettingsError').textContent = 'Введи Web application Client ID вида ….apps.googleusercontent.com или очисти поле для сброса.'; return; }
    try { if (value) localStorage.setItem(CLIENT_ID_KEY, value); else localStorage.removeItem(CLIENT_ID_KEY); }
    catch { find('driveSettingsError').textContent = 'Не удалось сохранить Client ID в настройках браузера.'; return; }
    if (value !== session.view().clientId) session.configure(value);
    dialog.close();
  };
  find('driveCancel').onclick = () => dialog.close();
  window.addEventListener('storage', event => { if (event.key === CLIENT_ID_KEY || event.key === null) readSetting(); });
  window.addEventListener('online', () => session.networkChanged());
  window.addEventListener('offline', () => session.networkChanged());
  document.addEventListener('visibilitychange', () => session.checkExpiry());
  window.addEventListener('pagehide', () => session.disconnect());
}
