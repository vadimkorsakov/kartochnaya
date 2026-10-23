import { createOAuth, CLIENT_ID_KEY, validClientId } from './oauth.mjs';
import { createDiagnostics, STEPS } from './diagnostics.mjs';
export function installYandexUI() {
  const grid = document.querySelector('#homeDataPane .home-data-grid');
  if (!grid) return;
  const card = document.createElement('article'); card.className = 'home-data-card'; card.id = 'yandexCard';
  card.innerHTML = '<h2>Яндекс Диск · проверка подключения</h2><p>Экспериментальная интеграция. Пока не создаёт резервные копии КАРТОЧНОЙ. Только папка приложения; токен живёт в памяти до reload.</p><button type="button" class="btn btn-outline" id="yandexConfigure">Настроить Client ID</button><button type="button" class="btn btn-primary" id="yandexConnect">Подключить Яндекс</button><button type="button" class="btn btn-outline" id="yandexApi">Проверить доступ к API</button><button type="button" class="btn btn-outline" id="yandexTransfer">Проверить тестовую загрузку/скачивание</button><button type="button" class="btn btn-outline" id="yandexDisconnect">Отключить / отменить</button><p id="yandexStatus" role="status" aria-live="polite"></p><details><summary>Результаты проверок</summary><pre id="yandexResults" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></details><p id="yandexPath"></p><button type="button" class="btn btn-outline" id="yandexRemove" hidden>Удалить только созданный тестовый файл</button>';
  grid.append(card);
  const dialog = document.createElement('dialog'); dialog.id = 'yandexSettings';
  dialog.innerHTML = '<form method="dialog"><h2>Яндекс OAuth: публичный Client ID</h2><p>Сохраняется только Client ID, отдельно от Google Drive. Разрешение: cloud_api:disk.app_folder. Укажи в Яндекс OAuth точный Redirect URI:</p><p id="yandexRedirect" style="overflow-wrap:anywhere"></p><label>Client ID <input id="yandexClientId" autocomplete="off" spellcheck="false" maxlength="32"></label><p id="yandexSettingsError" role="alert"></p><button type="button" id="yandexCancel">Отмена</button><button type="submit">Сохранить</button></form>';
  document.body.append(dialog);
  const find = id => document.getElementById(id);
  let oauth, diagnostics, notice = '';
  function render() {
    if (!oauth || !diagnostics) return;
    const v = oauth.view(), d = diagnostics.view();
    find('yandexStatus').textContent = notice || v.message;
    find('yandexConnect').disabled = !v.clientId || v.busy || d.busy;
    find('yandexApi').disabled = !v.connected || d.busy;
    find('yandexTransfer').disabled = !v.connected || d.busy || !!d.path;
    find('yandexRemove').hidden = !d.path || !d.removable;
    find('yandexRemove').disabled = !v.connected || d.busy;
    find('yandexPath').textContent = d.path ? 'Создан или мог быть создан тестовый файл: ' + d.path + '. Если удаление не подтверждено, удали его вручную в этом аккаунте. Остальные файлы не затрагиваются.' : '';
    find('yandexResults').textContent = ['OAuth POST /token: ' + (v.results.oauth || 'Не проверено'), ...Object.entries(STEPS).map(([k, label]) => label + ': ' + (d.results[k] || 'Не проверено'))].join('\n');
  }
  oauth = createOAuth({ changed: () => { if (oauth && !oauth.view().connected) diagnostics?.disconnected(); render(); } });
  diagnostics = createDiagnostics(oauth, render);
  try { const value = localStorage.getItem(CLIENT_ID_KEY); if (validClientId(value)) oauth.configure(value); } catch { notice = 'Публичную конфигурацию не удалось прочитать. Настрой Client ID повторно.'; }
  find('yandexConfigure').onclick = () => { find('yandexClientId').value = oauth.view().clientId; find('yandexRedirect').textContent = oauth.view().redirectUri; find('yandexSettingsError').textContent = ''; dialog.showModal(); };
  find('yandexCancel').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault(); const value = find('yandexClientId').value.trim();
    try {
      if (!validClientId(value)) throw Error('Client ID должен содержать 32 шестнадцатеричных символа.');
      localStorage.setItem(CLIENT_ID_KEY, value); oauth.configure(value); notice = ''; dialog.close(); render();
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
