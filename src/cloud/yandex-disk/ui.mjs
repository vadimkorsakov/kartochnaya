import { storageRow, modal, tabs, pager } from '../../backup/dialog.mjs';
import { createOAuth, CLIENT_ID_KEY, validClientId } from './oauth.mjs';
import { createDiagnostics, STEPS } from './diagnostics.mjs';
export function installYandexUI() {
  const grid = document.querySelector('#homeDataPane .home-data-grid');
  if (!grid) return;
  const card = storageRow({ id: 'yandexCard', title: 'Яндекс Диск', description: 'Подключение и диагностика облачного хранилища', icon: 'Я', status: 'Экспериментально · ZIP-копий пока нет' });
  const mainDialog = document.createElement('dialog'); mainDialog.id = 'yandexDialog'; mainDialog.setAttribute('aria-labelledby', 'yandexTitle');
  mainDialog.innerHTML = `
    <header class="backup-header"><h2 id="yandexTitle">Яндекс Диск · эксперимент</h2><button type="button" class="backup-close" data-backup-close aria-label="Закрыть">×</button></header>
    <div class="backup-tabs" role="tablist" aria-label="Яндекс Диск"><button type="button" id="yandexConnectionTab" data-backup-tab="connection">Подключение</button><button type="button" id="yandexDiagnosticsTab" data-backup-tab="diagnostics">Диагностика</button></div>
    <div class="backup-content">
      <section id="yandexConnectionPanel" data-backup-panel="connection">
        <p class="backup-warning">Экспериментальная интеграция. Пока не создаёт резервные ZIP-копии КАРТОЧНОЙ.</p><p>Доступ ограничен папкой приложения app:/. Токен хранится только в памяти до перезагрузки. Закрытие окна не отключает аккаунт.</p>
        <div class="backup-toolbar"><button type="button" class="btn btn-outline" id="yandexConfigure">Настроить Client ID</button><button type="button" class="btn btn-primary" id="yandexConnect">Подключить Яндекс</button></div>
      </section>
      <section id="yandexDiagnosticsPanel" data-backup-panel="diagnostics" hidden><h3>Результаты проверок</h3><div id="yandexResults"></div><p id="yandexPath"></p></section>
      <section id="yandexSettings" hidden><form><h3>Яндекс OAuth: публичный Client ID</h3><p>Сохраняется только Client ID, отдельно от Google Drive. Разрешение: cloud_api:disk.app_folder. Укажи в Яндекс OAuth точный Redirect URI:</p><p id="yandexRedirect"></p><label for="yandexClientId">Client ID</label><input id="yandexClientId" autocomplete="off" spellcheck="false" maxlength="32"><p id="yandexSettingsError" role="alert"></p><div class="backup-toolbar"><button type="button" class="btn btn-outline" id="yandexCancel">Отмена</button><button type="submit" class="btn btn-primary">Сохранить</button></div></form></section>
    </div>
    <footer class="backup-actions"><button type="button" class="btn btn-outline" id="yandexDisconnect">Отключить / отменить</button><button type="button" class="btn btn-outline" id="yandexApi" hidden>Проверить API</button><button type="button" class="btn btn-primary" id="yandexTransfer" hidden>Тест загрузки и скачивания</button><button type="button" class="btn btn-outline" id="yandexRemove" hidden>Удалить только созданный тестовый файл</button></footer>
    <p id="yandexStatus" class="backup-status" role="status" aria-live="polite"></p>`;
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
  let oauth, diagnostics, notice = '';
  function render() {
    if (!oauth || !diagnostics) return;
    const v = oauth.view(), d = diagnostics.view();
    find('yandexStatus').textContent = notice || v.message;
    card.querySelector('.storage-status').textContent = 'Экспериментально · ' + (v.busy || d.busy ? 'выполняется операция' : v.connected ? 'подключён · ZIP-копий пока нет' : 'ZIP-копий пока нет');
    find('yandexApi').hidden = find('yandexTransfer').hidden = tab !== 'diagnostics' || !dialog.hidden;
    find('yandexConnect').disabled = !v.clientId || v.busy || d.busy;
    find('yandexApi').disabled = !v.connected || d.busy;
    find('yandexTransfer').disabled = !v.connected || d.busy || !!d.path;
    find('yandexRemove').hidden = tab !== 'diagnostics' || !dialog.hidden || !d.path || !d.removable;
    find('yandexRemove').disabled = !v.connected || d.busy;
    find('yandexPath').textContent = d.path ? 'Создан или мог быть создан тестовый файл: ' + d.path + '. Если удаление не подтверждено, удали его вручную в этом аккаунте. Остальные файлы не затрагиваются.' : '';
    const lines = ['OAuth POST /token: ' + (v.results.oauth || 'Не проверено'), ...Object.entries(STEPS).map(([k, label]) => label + ': ' + (d.results[k] || 'Не проверено'))];
    results.forEach((row, index) => { row.textContent = lines[index]; });
  }
  oauth = createOAuth({ changed: () => { if (oauth && !oauth.view().connected) diagnostics?.disconnected(); render(); } });
  diagnostics = createDiagnostics(oauth, render);
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
