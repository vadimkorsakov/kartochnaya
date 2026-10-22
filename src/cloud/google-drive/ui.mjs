import { createDriveSession, CLIENT_ID_KEY, validClientId } from './session.mjs';
import { createDriveClient, MAX_CLOUD_BYTES } from './client.mjs';
import { readPreferences } from '../../backup/archive.mjs';

export function installGoogleDriveUI({ snapshot, download }) {
  const grid = document.querySelector('#homeDataPane .home-data-grid');
  if (!grid) return;
  const card = document.createElement('article'); card.className = 'home-data-card'; card.id = 'googleDriveCard';
  card.innerHTML = '<div class="home-data-icon" aria-hidden="true">☁</div><h2>Google Drive</h2><p>Резервные копии КАРТОЧНОЙ в вашем Google Drive. Проекты продолжат храниться на устройстве</p><p id="driveStatus" role="status" aria-live="polite"></p><button type="button" class="btn btn-primary" id="driveConnect"></button><button type="button" class="btn btn-outline" id="driveDisconnect">Отключить</button><button type="button" class="btn btn-outline" id="driveConfigure">Настроить Client ID</button><span class="home-data-footnote">На этом этапе доступна проверка подключения. Загрузка копий в Drive пока не выполняется.</span>';
  card.querySelector('.home-data-footnote').textContent = 'Облачные копии содержат исходные данные проектов в ZIP без дополнительного шифрования КАРТОЧНОЙ. Автоматической синхронизации нет.';
  const cloud = document.createElement('section'); cloud.id = 'driveBackups'; cloud.hidden = true;
  cloud.innerHTML = '<button type="button" class="btn btn-primary" id="driveCreate">Создать облачную копию</button><h3>Мои облачные копии</h3><button type="button" class="btn btn-outline" id="driveRefresh">Обновить список</button><button type="button" class="btn btn-outline" id="driveAbort" hidden>Отменить операцию</button><button type="button" class="btn btn-outline" id="driveNewFolder" hidden>Создать новую папку при следующей загрузке</button><p id="driveProgress" role="status" aria-live="polite"></p><div id="driveList"></div><button type="button" class="btn btn-primary" id="driveSaveZip" hidden>Сохранить ZIP на устройстве</button><p>Для восстановления: «Локальные ZIP-копии → Восстановить из ZIP». После закрытия вкладки сеанс загрузки не сохраняется.</p>';
  card.append(cloud); grid.append(card);
  const dialog = document.createElement('dialog'); dialog.id = 'driveSettings'; dialog.setAttribute('aria-labelledby', 'driveSettingsTitle');
  dialog.innerHTML = '<form method="dialog"><h2 id="driveSettingsTitle">Google OAuth Client ID</h2><p>Публичный Web application Client ID из Google Cloud. Хранится только в этом браузере и не включается в ZIP. При изменении текущий сеанс будет сброшен.</p><label for="driveClientId">Client ID</label><input id="driveClientId" autocomplete="off" spellcheck="false" maxlength="512" placeholder="….apps.googleusercontent.com"><p id="driveSettingsError" role="alert"></p><button class="btn btn-outline" id="driveCancel" type="button">Отмена</button><button class="btn btn-primary" id="driveSave" type="submit">Сохранить</button></form>';
  document.body.append(dialog);
  const style = document.createElement('style'); style.textContent = '#googleDriveCard button{margin-top:10px}#driveStatus{overflow-wrap:anywhere}#driveSettings{background:#261e30;color:#f4effb;border:1px solid #574661;border-radius:18px;padding:24px;width:min(540px,calc(100% - 24px));box-sizing:border-box;max-height:calc(100dvh - 32px);overflow:auto}#driveSettings::backdrop{background:#100b18bb}#driveSettings input{display:block;width:100%;box-sizing:border-box;margin:12px 0;padding:10px}#driveSettings p{line-height:1.55}#driveSettingsError{color:#ffb8a0}'; document.head.append(style);
  const find = id => document.getElementById(id);
  const connect = find('driveConnect'), disconnect = find('driveDisconnect'), status = find('driveStatus');
  const client = createDriveClient();
  let operation = null, verified = null;
  const progress = find('driveProgress'), list = find('driveList'), saveZip = find('driveSaveZip');
  const size = value => (value / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ';
  function buttons() {
    const connected = session.view().status === 'connected';
    for (const node of cloud.querySelectorAll('button')) node.disabled = !connected || (!!operation && node.id !== 'driveAbort');
    find('driveAbort').hidden = !operation;
  }
  async function task(action) {
    if (operation || session.view().status !== 'connected') return;
    const controller = new AbortController(); operation = controller; verified = null; saveZip.hidden = true;
    find('driveNewFolder').hidden = true; buttons(); progress.textContent = 'Обращаемся к Google Drive…';
    try { await session.withDriveOperation(action, { signal: controller.signal }); }
    catch (error) { progress.textContent = error instanceof RangeError ? 'Недостаточно памяти для ZIP. Освободи память или используй компьютер.' : error.message || 'Не удалось завершить облачную операцию.'; find('driveNewFolder').hidden = error.code !== 'folder_unavailable'; }
    finally { operation = null; buttons(); }
  }
  find('driveAbort').onclick = () => operation?.abort();
  find('driveNewFolder').onclick = () => { client.newFolder(); find('driveNewFolder').hidden = true; list.replaceChildren(); progress.textContent = 'При нажатии «Создать облачную копию» приложение снова найдёт свою папку или создаст новую. Старые файлы не переносятся.'; };
  find('driveCreate').onclick = () => task(async op => {
    await client.create(op, { snapshot, preferences: () => readPreferences(localStorage), preparing: message => { progress.textContent = message; }, progress: ({ sent, confirmed, total }) => { progress.textContent = `Загрузка: ${size(confirmed)} / ${size(total)} · передаём до: ${size(sent)}`; } });
    op.check(); progress.textContent = 'Резервная копия сохранена в Google Drive. Нажми «Обновить список», чтобы увидеть файл.';
  });
  find('driveRefresh').onclick = () => task(async op => {
    const files = await client.list(op); op.check(); list.replaceChildren();
    for (const file of files) {
      const row = document.createElement('div'); row.style.cssText = 'overflow-wrap:anywhere;border-top:1px solid #574661;padding:12px 0';
      const name = document.createElement('p'); name.textContent = file.name;
      const details = document.createElement('p'); details.textContent = `${Number.isFinite(Date.parse(file.createdTime)) ? new Date(file.createdTime).toLocaleString('ru-RU') : 'Дата неизвестна'} · ${size(Number(file.size))} · Всё рабочее пространство`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline'; button.textContent = 'Скачать';
      button.onclick = () => task(async op => {
        progress.textContent = 'Скачиваем ZIP и проверяем размеры, манифест и SHA-256…';
        const budget = /Android/i.test(navigator.userAgent) ? 128 * 1024 * 1024 : MAX_CLOUD_BYTES;
        const result = await client.download(op, file.id, budget); op.check(); verified = result;
        progress.textContent = `ZIP проверен: ${new Date(result.createdAt).toLocaleString('ru-RU')} · ${size(result.bytes.length)} · проектов: ${result.projects}.` + (result.warnings.length ? ' Предупреждения: ' + result.warnings.join('; ') : '') + ' Можно сохранить файл. Данные в приложении не восстанавливались.';
        saveZip.hidden = false;
      });
      row.append(name, details, button); list.append(row);
    }
    progress.textContent = files.length ? `Найдено копий: ${files.length}.` : 'Облачных копий пока нет. Папка создаётся только при создании первой копии.';
  });
  saveZip.onclick = () => {
    if (!verified || operation || session.view().status !== 'connected') return;
    try { download(new Blob([verified.bytes], { type: 'application/zip' }), verified.filename); verified = null; saveZip.hidden = true; progress.textContent = 'Проверенный ZIP передан браузеру. Сохрани файл самостоятельно и проверь загрузки: браузер может отменить сохранение.'; }
    catch { progress.textContent = 'Не удалось передать ZIP браузеру. Возможно, недостаточно памяти. Используй компьютер.'; }
  };
  function render(view) {
    status.textContent = !view.supported ? 'Авторизация недоступна в file://. Открой КАРТОЧНУЮ на HTTPS-сайте.' : !view.online ? 'Отсутствует интернет. Локальные проекты, JSON и ZIP доступны.' : view.message;
    status.dataset.state = view.status;
    connect.hidden = view.status === 'connected';
    connect.disabled = !view.clientId || view.busy || !view.online || !view.supported;
    connect.textContent = view.busy ? 'Подключение…' : !view.ready ? 'Подготовить авторизацию' : ['error', 'expired', 'offline'].includes(view.status) ? 'Подключить повторно' : 'Подключить Google Drive';
    disconnect.hidden = !['connected', 'authorizing', 'checking'].includes(view.status);
    card.setAttribute('aria-busy', String(view.busy));
    cloud.hidden = view.status !== 'connected';
    if (view.status !== 'connected') { client.reset(); verified = null; saveZip.hidden = true; list.replaceChildren(); }
    // Initial configure runs after the session is assigned.
    buttons();
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
