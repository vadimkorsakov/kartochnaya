import { storageRow, modal, tabs, pager } from '../../backup/dialog.mjs';
import { CLIENT_ID_KEY, validClientId } from './session.mjs';
import { createDriveAccounts, ACCOUNTS_KEY } from './accounts.mjs';
import { MAX_CLOUD_BYTES } from './client.mjs';
import { readPreferences } from '../../backup/archive.mjs';

export function installGoogleDriveUI({ snapshot, download }) {
  const grid = document.querySelector('#homeDataPane .home-data-grid');
  if (!grid) return;
  const card = storageRow({ id: 'googleDriveCard', title: 'Google Drive', description: 'Облачные ZIP-копии в нескольких аккаунтах', icon: '☁', status: 'Не настроен' });
  const mainDialog = document.createElement('dialog'); mainDialog.id = 'googleDriveDialog'; mainDialog.setAttribute('aria-labelledby', 'driveTitle');
  mainDialog.innerHTML = `
    <header class="backup-header"><h2 id="driveTitle">Google Drive</h2><button type="button" class="backup-close" data-backup-close aria-label="Закрыть">×</button></header>
    <div class="backup-tabs" role="tablist" aria-label="Google Drive">
      <button type="button" id="driveAccountsTab" data-backup-tab="accounts">Аккаунты</button>
      <button type="button" id="driveCreateTab" data-backup-tab="create">Создать копию</button>
      <button type="button" id="driveCopiesTab" data-backup-tab="copies">Облачные копии</button>
    </div>
    <div class="backup-content">
      <section id="driveAccountsPanel" data-backup-panel="accounts">
        <div class="backup-toolbar"><button type="button" class="btn btn-primary" id="driveAdd">Добавить Google-аккаунт</button><button type="button" class="btn btn-outline" id="driveConfigure">Настроить Client ID</button></div>
        <button type="button" class="btn btn-outline" id="driveConnect" hidden></button>
        <div id="driveAccountHost"><div id="driveAccounts"></div></div>
        <p class="home-data-footnote">После перезагрузки подключи аккаунты повторно. Удаление из списка не удаляет файлы на Drive. Автоматической синхронизации нет.</p>
      </section>
      <section id="driveCreatePanel" data-backup-panel="create" hidden>
        <p>Выбери подключённые аккаунты. Один ZIP-снимок всего рабочего пространства будет загружен каждому из них.</p>
        <div id="driveSelectionHost"></div>
        <p class="home-data-footnote">ZIP содержит исходные данные без дополнительного шифрования. Результат загрузки показан отдельно для каждого аккаунта.</p>
      </section>
      <section id="driveCopiesPanel" data-backup-panel="copies" hidden>
        <label for="driveActiveAccount">Аккаунт</label><select id="driveActiveAccount" aria-label="Аккаунт облачных копий"></select>
        <section id="driveBackups" hidden><h3 id="driveAccountTitle"></h3>
          <div class="backup-toolbar"><button type="button" class="btn btn-primary" id="driveCreate">Создать облачную копию</button><button type="button" class="btn btn-outline" id="driveRefresh">Просмотр копий</button><button type="button" class="btn btn-outline" id="driveDisconnect">Отключить</button></div>
          <button type="button" class="btn btn-outline" id="driveNewFolder" hidden>Создать новую папку при следующей загрузке</button>
          <p id="driveProgress" role="status" aria-live="polite"></p><div id="driveList"></div>
          <p class="home-data-footnote">Скачанный ZIP проверяется до сохранения. Для восстановления открой «Локальные ZIP-копии → Восстановить копию».</p>
        </section>
      </section>
      <section id="driveSettings" hidden>
        <form><h3 id="driveSettingsTitle">Google OAuth Client ID</h3><p>Один публичный Web application Client ID для всех аккаунтов. Хранится в этом браузере и не включается в ZIP. Изменение отключит текущие сеансы.</p><label for="driveClientId">Client ID</label><input id="driveClientId" autocomplete="off" spellcheck="false" maxlength="512" placeholder="….apps.googleusercontent.com"><p id="driveSettingsError" role="alert"></p><div class="backup-toolbar"><button class="btn btn-outline" id="driveCancel" type="button">Отмена</button><button class="btn btn-primary" id="driveSave" type="submit">Сохранить</button></div></form>
      </section>
    </div>
    <footer class="backup-actions"><button type="button" class="btn btn-outline" id="driveAbort" hidden>Отменить операцию</button><button type="button" class="btn btn-primary" id="driveCreateSelected" hidden>Создать ZIP в выбранных аккаунтах</button><button type="button" class="btn btn-primary" id="driveSaveZip" hidden>Сохранить ZIP на устройстве</button></footer>
    <p id="driveStatus" class="backup-status" role="status" aria-live="polite"></p>`;
  document.body.append(mainDialog);
  const shell = modal(mainDialog, { opener: card }); card.onclick = () => shell.open(card);
  const dialog = mainDialog.querySelector('#driveSettings');
  const shortScreen = matchMedia('(max-width:760px) and (max-height:700px)').matches;
  const accountPages = pager(mainDialog.querySelector('#driveAccounts'), { size: shortScreen ? 1 : 2, label: 'Google-аккаунты' });
  const filePages = pager(mainDialog.querySelector('#driveList'), { size: shortScreen ? 1 : 3, label: 'Облачные ZIP-копии' });
  let tab = 'accounts';
  const navigation = tabs(mainDialog, value => {
    tab = value; dialog.hidden = true;
    mainDialog.querySelector(value === 'create' ? '#driveSelectionHost' : '#driveAccountHost').append(mainDialog.querySelector('#driveAccounts'), accountPages.nav);
    mainDialog.querySelector('#driveAccounts').dataset.mode = value;
  });
  const find = id => document.getElementById(id), selected = new Set(), lists = new Map();
  let active = null, authTarget = null, notice = '', manager;
  const size = value => (value / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ';
  for (const button of mainDialog.querySelectorAll('[data-backup-tab]')) button.addEventListener('click', () => render());
  mainDialog.querySelector('.backup-tabs').addEventListener('keydown', () => render());
  const showTab = value => { navigation.select(value); render(); };
  const run = action => Promise.resolve().then(action).catch(error => { notice = error.message; render(); });
  function button(text, action, disabled = false) {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'btn btn-outline'; node.textContent = text; node.disabled = disabled; node.onclick = action; return node;
  }
  function authorize(id) {
    authTarget = id; notice = '';
    // Preserve synchronous user activation for GIS requestAccessToken.
    try { const result = manager.authorize(id); result?.catch(error => { notice = error.message; render(); }); }
    catch (error) { notice = error.message; }
    render();
  }
  async function create(ids) {
    notice = '';
    const results = await manager.createCopies(ids, { snapshot, preferences: () => readPreferences(localStorage) });
    notice = results.every(r => r.saved) ? 'Выбранные загрузки подтверждены.' : 'Есть неподтверждённые загрузки. Проверь результат каждого аккаунта.';
    render();
  }
  async function refresh(id) {
    if (active !== id) { const previous = manager.get(active); if (previous) previous.verified = null; }
    active = id; notice = ''; showTab('copies');
    await manager.task(id, async (op, a) => {
      const files = await a.client.list(op); op.check(); lists.set(id, files);
      a.result = files.length ? `Найдено копий: ${files.length}.` : 'Облачных копий пока нет. Папка создаётся при первой загрузке.';
    });
  }
  function render() {
    if (!manager) return;
    const view = manager.view(), accounts = manager.list(), auth = view.authorization;
    const supported = location.protocol === 'https:' || (location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
    const online = navigator.onLine;
    find('driveStatus').textContent = notice || view.message || (!supported ? 'Авторизация недоступна в file://. Открой КАРТОЧНУЮ на HTTPS-сайте.' : !online ? 'Отсутствует интернет. Локальные проекты и ZIP доступны.' : auth?.message || (!view.clientId ? 'Не настроен Client ID.' : !accounts.length ? 'Требуется повторное подключение. Нажми «Добавить Google-аккаунт».' : 'Аккаунтов: ' + accounts.length + '.'));
    card.querySelector('.storage-status').textContent = view.batch || auth?.busy || accounts.some(a => a.operation) ? 'Выполняется операция' : !view.clientId ? 'Не настроен' : accounts.some(a => a.session.view().status === 'connected') ? 'Подключён' : 'Требуется подключение';
    find('driveStatus').dataset.state = auth?.status || (accounts.some(a => a.session.view().status === 'connected') ? 'connected' : 'disconnected');
    find('driveAdd').disabled = !view.clientId || !online || !supported || !!auth?.busy;
    const connect = find('driveConnect'); connect.hidden = !auth;
    connect.disabled = !online || !supported || !!auth?.busy;
    connect.textContent = auth?.busy ? 'Подключение…' : auth?.ready ? 'Подключить Google Drive' : 'Подготовить авторизацию';
    // Reuse row nodes while progress changes, preserving focus and Android selection.
    const rows = find('driveAccounts');
    for (const row of [...rows.children]) if (!manager.get(row.dataset.accountId)) row.remove();
    for (const a of accounts) {
      let row = [...rows.children].find(r => r.dataset.accountId === a.id);
      if (!row) {
        row = document.createElement('article'); row.dataset.accountId = a.id;
        const label = document.createElement('label'), check = document.createElement('input'), name = document.createElement('span'); check.type = 'checkbox'; check.onchange = () => { if (check.checked) selected.add(a.id); else selected.delete(a.id); render(); }; label.append(check, name);
        const state = document.createElement('p'), result = document.createElement('p'); result.setAttribute('role', 'status');
        const actions = document.createElement('div'); actions.className = 'backup-account-actions';
        row.append(label, state, result, actions);
        actions.append(
          button('Подключить', () => authorize(a.id)),
          button('Просмотр копий', () => run(() => refresh(a.id))),
          button('Создать копию', () => { showTab('create'); run(() => create([a.id])); }),
          button('Отключить', () => manager.disconnect(a.id)),
          button('Удалить из списка', () => run(() => { manager.remove(a.id); selected.delete(a.id); lists.delete(a.id); if (active === a.id) active = null; render(); })),
          button('Отменить операцию', () => a.operation?.abort()));
        for (const b of [...actions.children].slice(0, 5)) b.dataset.accountManage = '';
        rows.append(row);
      }
      const connected = a.session.view().status === 'connected', state = a.session.view();
      row.querySelector('span').textContent = a.name || 'Google-аккаунт'; row.querySelector('input').checked = selected.has(a.id);
      row.querySelector('input').disabled = !connected || view.batch;
      const paragraphs = row.querySelectorAll('p'); paragraphs[0].textContent = connected ? 'Подключён' : state.status === 'error' ? 'Ошибка: ' + state.message : 'Требуется подключение. ' + state.message; paragraphs[1].textContent = a.result;
      const buttons = row.querySelectorAll('button'); buttons[0].hidden = connected; buttons[0].disabled = !online || !supported || !!a.operation || !!auth?.busy;
      buttons[0].textContent = auth && view.targetId === a.id && auth.ready ? 'Подключить Google Drive' : 'Подключить';
      buttons[1].disabled = !connected || !!a.operation; buttons[2].disabled = !connected || !!a.operation || view.batch;
      buttons[3].disabled = !connected && !a.operation; buttons[5].hidden = !a.operation;
      if (!connected) lists.delete(a.id);
    }
    accountPages.update();
    find('driveCreateSelected').hidden = tab !== 'create' || !dialog.hidden;
    find('driveCreateSelected').disabled = view.batch || !accounts.some(a => selected.has(a.id)) || accounts.some(a => selected.has(a.id) && (a.operation || a.session.view().status !== 'connected'));
    if (!active && accounts.length) active = accounts[0].id;
    const a = manager.get(active), connected = a?.session.view().status === 'connected';
    const picker = find('driveActiveAccount');
    for (const option of [...picker.options]) if (!manager.get(option.value)) option.remove();
    for (const account of accounts) {
      let option = [...picker.options].find(item => item.value === account.id);
      if (!option) { option = document.createElement('option'); option.value = account.id; picker.append(option); }
      option.textContent = account.name + (account.session.view().status === 'connected' ? '' : ' · требуется подключение');
    }
    picker.value = active || '';
    find('driveAbort').hidden = !accounts.some(account => account.operation);
    find('driveSaveZip').hidden = tab !== 'copies' || !dialog.hidden || !a?.verified;
    find('driveBackups').hidden = !connected;
    if (!a) { find('driveList').replaceChildren(); filePages.update(true); return; }
    find('driveAccountTitle').textContent = 'Копии: ' + a.name;
    find('driveProgress').textContent = a.result;
    for (const id of ['driveCreate', 'driveRefresh', 'driveNewFolder', 'driveSaveZip']) find(id).disabled = !connected || !!a.operation || (id === 'driveCreate' && view.batch);
    find('driveNewFolder').hidden = !a.folderUnavailable;
    const list = find('driveList');
    const files = connected ? lists.get(a.id) : null;
    if (list._files === files && list._account === a.id) { for (const b of list.querySelectorAll('button')) b.disabled = !!a.operation; return; }
    list._files = files; list._account = a.id; list.replaceChildren();
    for (const file of files || []) {
      const row = document.createElement('div'), name = document.createElement('p'), details = document.createElement('p'); name.textContent = file.name;
      details.textContent = `${Number.isFinite(Date.parse(file.createdTime)) ? new Date(file.createdTime).toLocaleString('ru-RU') : 'Дата неизвестна'} · ${size(Number(file.size))} · Всё рабочее пространство`;
      row.append(name, details, button('Скачать', () => run(() => manager.task(a.id, async (op, account) => {
        account.result = 'Скачиваем ZIP и проверяем SHA-256…'; render();
        const result = await account.client.download(op, file.id, /Android/i.test(navigator.userAgent) ? 128 * 1024 * 1024 : MAX_CLOUD_BYTES); op.check(); account.verified = result;
        account.result = `ZIP проверен: ${size(result.bytes.length)} · проектов: ${result.projects}. ` + result.warnings.join('; ') + ' Можно сохранить файл.';
      })), !!a.operation)); list.append(row);
    }
    filePages.update(true);
  }
  manager = createDriveAccounts({ storage: localStorage, changed: render });
  try { manager.reload(); } catch { notice = 'Не удалось прочитать настройки Google Drive. Локальные проекты и ZIP доступны.'; render(); }
  find('driveAdd').onclick = () => { manager.cancelAuthorization(); authorize(null); };
  find('driveConnect').onclick = () => authorize(authTarget);
  find('driveCreateSelected').onclick = () => run(() => create([...selected]));
  find('driveCreate').onclick = () => run(() => create([active]));
  find('driveRefresh').onclick = () => run(() => refresh(active));
  find('driveDisconnect').onclick = () => manager.disconnect(active);
  find('driveAbort').onclick = () => { for (const a of manager.list()) a.operation?.abort(); };
  find('driveActiveAccount').onchange = event => { const previous = manager.get(active); if (previous) previous.verified = null; active = event.target.value; render(); };
  find('driveNewFolder').onclick = () => { const a = manager.get(active); a.client.newFolder(); a.folderUnavailable = false; lists.delete(active); a.result = 'При следующей загрузке папка будет найдена или создана. Старые файлы не переносятся.'; render(); };
  find('driveSaveZip').onclick = () => {
    const a = manager.get(active); if (!a?.verified || a.operation || a.session.view().status !== 'connected') return;
    try { download(new Blob([a.verified.bytes], { type: 'application/zip' }), a.verified.filename); a.verified = null; a.result = 'Проверенный ZIP передан браузеру. Проверь загрузки: браузер может отменить сохранение.'; }
    catch { a.result = 'Не удалось передать ZIP браузеру. Возможно, недостаточно памяти.'; } render();
  };
  find('driveConfigure').onclick = () => { find('driveClientId').value = manager.view().clientId; find('driveSettingsError').textContent = ''; for (const panel of mainDialog.querySelectorAll('[data-backup-panel]')) panel.hidden = true; dialog.hidden = false; render(); find('driveClientId').focus(); };
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault(); const value = find('driveClientId').value.trim();
    if (value && !validClientId(value)) { find('driveSettingsError').textContent = 'Введи Web application Client ID вида ….apps.googleusercontent.com или очисти поле для сброса.'; return; }
    try { if (value !== manager.view().clientId) manager.configure(value); showTab('accounts'); find('driveConfigure').focus(); }
    catch { find('driveSettingsError').textContent = 'Не удалось сохранить настройки браузера.'; }
  };
  find('driveCancel').onclick = () => { showTab('accounts'); find('driveConfigure').focus(); };
  window.addEventListener('storage', event => { if ([CLIENT_ID_KEY, ACCOUNTS_KEY, null].includes(event.key)) { try { manager.reload(); } catch { notice = 'Не удалось обновить список аккаунтов.'; render(); } } });
  window.addEventListener('online', () => manager.networkChanged()); window.addEventListener('offline', () => manager.networkChanged());
  document.addEventListener('visibilitychange', () => manager.checkExpiry()); window.addEventListener('pagehide', () => manager.close());
}
