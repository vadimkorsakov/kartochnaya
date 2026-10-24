import { storageRow, modal, tabs, pager } from '../../backup/dialog.mjs';
import { createOAuth, CLIENT_ID_KEY, validClientId } from './oauth.mjs';
import { readPreferences } from '../../backup/archive.mjs';
import { createYandexClient, MAX_CLOUD_BYTES, ANDROID_CLOUD_BYTES } from './client.mjs';
import { createDiagnostics, STEPS } from './diagnostics.mjs';
export function installYandexUI({ snapshot } = {}) {
  const grid = document.querySelector('#homeDataPane .home-data-grid');
  if (!grid) return;
  const card = storageRow({ id: 'yandexCard', title: 'Яндекс Диск', description: 'Резервные ZIP-копии в папке приложения', icon: 'Я', status: 'Требуется подключение' });
  const mainDialog = document.createElement('dialog'); mainDialog.id = 'yandexDialog'; mainDialog.setAttribute('aria-labelledby', 'yandexTitle');
  mainDialog.innerHTML = `
    <header class="backup-header"><h2 id="yandexTitle">Яндекс Диск</h2><button type="button" class="backup-close" data-backup-close aria-label="Закрыть">×</button></header>
    <div class="backup-tabs" role="tablist" aria-label="Яндекс Диск"><button type="button" id="yandexConnectionTab" data-backup-tab="connection">Подключение</button><button type="button" id="yandexCreateTab" data-backup-tab="create">Создать копию</button><button type="button" id="yandexCopiesTab" data-backup-tab="copies">Облачные копии</button><button type="button" id="yandexDiagnosticsTab" data-backup-tab="diagnostics">Диагностика</button></div>
    <div class="backup-content">
      <section id="yandexConnectionPanel" data-backup-panel="connection"><p id="yandexConnectionStatus" role="status"></p>
        <p>Доступ ограничен папкой приложения app:/. Токен хранится только в памяти до перезагрузки. Закрытие окна не отключает аккаунт.</p>
        <div class="backup-toolbar"><button type="button" class="btn btn-outline" id="yandexConfigure">Настроить Client ID</button><button type="button" class="btn btn-primary" id="yandexConnect">Подключить Яндекс</button></div>
      </section>
      <section id="yandexCreatePanel" data-backup-panel="create" hidden><p>Полный ZIP рабочего пространства: проекты, документы, ресурсы, шрифты, settings и настройки приложения. Сначала подтверждаются сохранения IndexedDB.</p><p>Предел ZIP: 256 МиБ на компьютере, 128 МиБ на Android.</p><div class="backup-toolbar"><button type="button" class="btn btn-primary" id="yandexCreate">Создать ZIP на Яндекс Диске</button><button type="button" class="btn btn-outline" id="yandexAbort" disabled>Отменить</button></div></section>
      <section id="yandexCopiesPanel" data-backup-panel="copies" hidden><button type="button" class="btn btn-outline" id="yandexRefresh">Обновить список копий</button><p id="yandexListStatus" role="status"></p><div id="yandexCopies"></div><p>Скачивание и восстановление появятся в следующем обновлении.</p></section>
      <section id="yandexDiagnosticsPanel" data-backup-panel="diagnostics" hidden><h3>Результаты проверок</h3><div id="yandexResults"></div><p id="yandexPath"></p></section>
      <section id="yandexSettings" hidden><form><h3>Яндекс OAuth: публичный Client ID</h3><p>Сохраняется только Client ID, отдельно от Google Drive. Разрешение: cloud_api:disk.app_folder. Укажи в Яндекс OAuth точный Redirect URI:</p><p id="yandexRedirect"></p><label for="yandexClientId">Client ID</label><input id="yandexClientId" autocomplete="off" spellcheck="false" maxlength="32"><p id="yandexSettingsError" role="alert"></p><div class="backup-toolbar"><button type="button" class="btn btn-outline" id="yandexCancel">Отмена</button><button type="submit" class="btn btn-primary">Сохранить</button></div></form></section>
    </div>
    <footer class="backup-actions"><button type="button" class="btn btn-outline" id="yandexDisconnect">Отключить / отменить</button><button type="button" class="btn btn-outline" id="yandexApi" hidden>Проверить API</button><button type="button" class="btn btn-primary" id="yandexTransfer" hidden>Тест загрузки и скачивания</button><button type="button" class="btn btn-outline" id="yandexRemove" hidden>Удалить только созданный тестовый файл</button></footer>
    <p id="yandexStatus" class="backup-status" role="status" aria-live="polite"></p>`;
  // Four tabs wrap as a pair of rows on narrow screens, including wider fallback fonts.
  mainDialog.querySelector('.backup-tabs').style.flexWrap = 'wrap';
  for (const button of mainDialog.querySelectorAll('[data-backup-tab]')) button.style.flexBasis = '120px';
  document.body.append(mainDialog);
  const find = id => document.getElementById(id), dialog = find('yandexSettings');
  const shell = modal(mainDialog, { opener: card }); card.onclick = () => shell.open(card);
  const results = ['oauth', ...Object.keys(STEPS)].map(() => { const row = document.createElement('p'); find('yandexResults').append(row); return row; });
  pager(find('yandexResults'), { size: 4, label: 'Шаги диагностики Яндекса' });
  let tab = 'connection';
  const navigation = tabs(mainDialog, value => { tab = value; dialog.hidden = true; });
  const showTab = value => { navigation.select(value); render(); };
  for (const button of mainDialog.querySelectorAll('[data-backup-tab]')) button.addEventListener('click', () => render());
  mainDialog.querySelector('.backup-tabs').addEventListener('keydown', () => render());
  let oauth, diagnostics, client, notice = '', operation = null, operationStatus = '', listStatus = '';
  const copiesPager = pager(find('yandexCopies'), { size: 4, label: 'Резервные копии Яндекса' });
  function clearSession() {
    operation?.abort(); operation = null; operationStatus = ''; listStatus = '';
    find('yandexCopies').replaceChildren(); copiesPager.update(true); client?.reset();
  }
  function showFiles(files) {
    find('yandexCopies').replaceChildren(...files.map(file => {
      const row = document.createElement('article'); row.className = 'backup-project';
      const name = document.createElement('p'), detail = document.createElement('p');
      name.textContent = file.name; name.style.overflowWrap = 'anywhere';
      detail.textContent = new Date(file.created).toLocaleString('ru-RU') + ' · ' + (file.size / 1024 / 1024).toFixed(2) + ' МиБ · файл · доступен';
      row.append(name, detail); return row;
    })); copiesPager.update(true);
  }
  async function runBackup(list = false) {
    if (operation || !oauth.view().connected || diagnostics.view().busy) return;
    const controller = new AbortController(); operation = controller;
    const generation = oauth.view().generation;
    const active = () => operation === controller && oauth.view().connected && oauth.view().generation === generation;
    operationStatus = list ? 'Получаем список копий…' : 'Подготовка ZIP…'; render();
    try {
      if (list) {
        const result = await client.list({ signal: controller.signal });
        if (!active()) return;
        showFiles(result.files); listStatus = result.truncated ? 'Список усечён: просмотрено 1000 элементов папки.' : result.files.length ? 'Список обновлён.' : 'Резервных копий пока нет';
        operationStatus = listStatus;
      } else {
        const result = await client.create({ snapshot, preferences: () => readPreferences(localStorage), signal: controller.signal, maxBytes: /Android/i.test(navigator.userAgent) ? ANDROID_CLOUD_BYTES : MAX_CLOUD_BYTES, progress: value => { if (active()) { operationStatus = value; render(); } } });
        if (!active()) return;
        operationStatus = 'Копия создана: ' + result.file.name + '. ' + (result.verification === 'sha256' ? 'Размер и SHA-256 подтверждены сервером.' : 'Размер подтверждён сервером. Побайтовая проверка не выполнялась.');
      }
    } catch (error) {
      if (active()) { operationStatus = error.message; if (list) { listStatus = error.message; showFiles([]); } }
    } finally { if (operation === controller) operation = null; render(); }
  }
  function render() {
    if (!oauth || !diagnostics) return;
    const v = oauth.view(), d = diagnostics.view();
    find('yandexStatus').textContent = notice || operationStatus || v.message;
    find('yandexConnectionStatus').textContent = v.message;
    find('yandexListStatus').textContent = listStatus;
    find('yandexCreate').disabled = !v.connected || !!operation || d.busy || !snapshot;
    find('yandexRefresh').disabled = !v.connected || !!operation || d.busy;
    find('yandexAbort').disabled = !operation;
    find('yandexConfigure').disabled = !!operation;
    card.querySelector('.storage-status').textContent = (v.busy || d.busy || operation ? 'выполняется операция' : v.connected ? 'подключён' : 'Требуется подключение');
    find('yandexApi').hidden = find('yandexTransfer').hidden = tab !== 'diagnostics' || !dialog.hidden;
    find('yandexConnect').disabled = !v.clientId || v.busy || d.busy || !!operation;
    find('yandexApi').disabled = !v.connected || d.busy || !!operation;
    find('yandexTransfer').disabled = !v.connected || d.busy || !!operation || !!d.path;
    find('yandexRemove').hidden = tab !== 'diagnostics' || !dialog.hidden || !d.path || !d.removable;
    find('yandexRemove').disabled = !v.connected || d.busy || !!operation;
    find('yandexPath').textContent = d.path ? 'Создан или мог быть создан тестовый файл: ' + d.path + '. Если удаление не подтверждено, удали его вручную в этом аккаунте. Остальные файлы не затрагиваются.' : '';
    const lines = ['OAuth POST /token: ' + (v.results.oauth || 'Не проверено'), ...Object.entries(STEPS).map(([k, label]) => label + ': ' + (d.results[k] || 'Не проверено'))];
    results.forEach((row, index) => { row.textContent = lines[index]; });
  }
  oauth = createOAuth({ changed: () => { if (oauth && !oauth.view().connected) { clearSession(); diagnostics?.disconnected(); } render(); } });
  diagnostics = createDiagnostics(oauth, render);
  client = createYandexClient(oauth);
  find('yandexCreate').onclick = () => { void runBackup(); };
  find('yandexRefresh').onclick = () => { void runBackup(true); };
  find('yandexAbort').onclick = () => { operation?.abort(); };
  try { const value = localStorage.getItem(CLIENT_ID_KEY); if (validClientId(value)) oauth.configure(value); } catch { notice = 'Публичную конфигурацию не удалось прочитать. Настрой Client ID повторно.'; }
  find('yandexConfigure').onclick = () => { find('yandexClientId').value = oauth.view().clientId; find('yandexRedirect').textContent = oauth.view().redirectUri; find('yandexSettingsError').textContent = ''; for (const panel of mainDialog.querySelectorAll('[data-backup-panel]')) panel.hidden = true; dialog.hidden = false; render(); find('yandexClientId').focus(); };
  find('yandexCancel').onclick = () => { showTab('connection'); find('yandexConfigure').focus(); };
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault(); const value = find('yandexClientId').value.trim();
    try {
      if (!validClientId(value)) throw Error('Client ID должен содержать 32 шестнадцатеричных символа.');
      localStorage.setItem(CLIENT_ID_KEY, value); oauth.configure(value); notice = ''; showTab('connection'); find('yandexConfigure').focus();
    } catch (error) { find('yandexSettingsError').textContent = error.message; }
  };
  find('yandexConnect').onclick = () => { notice = ''; oauth.connect(); }; // No await before popup.
  find('yandexDisconnect').onclick = () => { notice = ''; oauth.disconnect(); };
  find('yandexApi').onclick = () => { void diagnostics.api(); };
  find('yandexTransfer').onclick = () => { void diagnostics.transfer(); };
  find('yandexRemove').onclick = () => { void diagnostics.remove(); };
  window.addEventListener('pagehide', () => oauth.disconnect());
  window.addEventListener('offline', () => oauth.disconnect('Нет сети. Подключи Яндекс повторно после восстановления связи.'));
  render();
}
