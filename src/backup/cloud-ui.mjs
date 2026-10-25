import { modal, pager } from './dialog.mjs';
import { createCloudCoordinator, STATES } from './cloud-coordinator.mjs';
import { readPreferences } from './archive.mjs';

export function installCloudBackupUI({ snapshot, download, assertAvailable }) {
  const providers = [];
  const button = document.createElement('button'); button.type = 'button'; button.id = 'createBackups'; button.className = 'btn btn-primary'; button.textContent = 'Создать резервные копии';
  document.querySelector('#homeDataPane .home-pane-heading').append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'cloudBackupDialog'; dialog.setAttribute('aria-labelledby', 'cloudBackupTitle');
  dialog.innerHTML = `<header class="backup-header"><h2 id="cloudBackupTitle">Создать резервные копии</h2><button type="button" class="backup-close" data-backup-close aria-label="Закрыть">×</button></header>
    <div class="backup-content"><section id="cloudSelection"><h3>Выбор получателей</h3><p>Один полный ZIP для всех выбранных хранилищ. Сними все флажки, чтобы подготовить только локальный ZIP.</p><div id="cloudRecipients"></div><p id="cloudConnectionHint"></p></section>
    <section id="cloudResults" hidden><h3>Подготовка и передача</h3><p id="cloudArchive"></p><div id="cloudResultRows"></div></section></div>
    <footer class="backup-actions"><button type="button" class="btn btn-primary" id="cloudStart">Подготовить и отправить</button><button type="button" class="btn btn-outline" id="cloudSave" hidden>Сохранить ZIP на устройство</button><button type="button" class="btn btn-outline" id="cloudCancel" hidden>Отменить передачу</button><button type="button" class="btn btn-outline" id="cloudFinish">Завершить</button></footer>
    <p class="backup-status" id="cloudStatus" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  const find = id => dialog.querySelector('#' + id);
  const pageSize = matchMedia('(max-width:760px)').matches ? 1 : 3;
  const recipientPages = pager(find('cloudRecipients'), { size: pageSize, label: 'Получатели резервной копии' });
  const resultPages = pager(find('cloudResultRows'), { size: pageSize, label: 'Результаты загрузки' });
  let closing = false, saveNotice = '';
  const coordinator = createCloudCoordinator({ snapshot, preferences: () => readPreferences(localStorage), providers, assertAvailable, changed: render });
  function render() {
    const v = coordinator.view(), started = v.busy || !!v.archive || v.results.length > 0;
    find('cloudSelection').hidden = started; find('cloudResults').hidden = !started;
    find('cloudStart').hidden = started; find('cloudStart').disabled = v.busy;
    find('cloudSave').hidden = !v.archive; find('cloudCancel').hidden = !v.busy;
    find('cloudFinish').disabled = v.busy;
    find('cloudArchive').textContent = v.archive ? `${v.archive.filename} · ${(v.archive.size / 1024 / 1024).toFixed(2)} МиБ · ZIP проверен` : '';
    const rows = find('cloudResultRows');
    if (rows.children.length !== v.results.length) rows.replaceChildren(...v.results.map(() => { const row = document.createElement('article'); row.append(document.createElement('strong'), document.createElement('p')); return row; }));
    v.results.forEach((r, index) => { rows.children[index].querySelector('strong').textContent = r.name + ' — ' + STATES[r.state]; rows.children[index].querySelector('p').textContent = r.detail; });
    resultPages.update();
    const count = v.results.filter(r => r.state === 'confirmed').length;
    const summary = !v.busy && started ? (v.results.length ? `Подтверждено ${count} из ${v.results.length} облачных загрузок.` + (count < v.results.length ? ' Проверь остальные направления перед повтором.' : '') : 'ZIP подготовлен для локального сохранения.') : '';
    find('cloudStatus').textContent = [summary, v.message, saveNotice].filter(Boolean).join(' ');
    if (closing && !v.busy) finish();
  }
  function finish() {
    if (coordinator.view().busy) { closing = true; coordinator.cancel(); return; }
    closing = false; saveNotice = '';
    coordinator.finish(); dialog.close(); find('cloudRecipients').replaceChildren(); find('cloudResultRows').replaceChildren();
  }
  const shell = modal(dialog, { opener: button, close: finish });
  button.onclick = () => {
    shell.open(button); if (!dialog.open) return;
    const recipients = coordinator.recipients();
    find('cloudRecipients').replaceChildren(...recipients.map(r => {
      const row = document.createElement('label'), check = document.createElement('input'), name = document.createElement('span');
      check.type = 'checkbox'; check.value = r.id; check.checked = r.available; check.disabled = !r.available;
      name.textContent = r.name + (r.available ? '' : ' · требуется подключение или завершение операции'); row.append(check, name); return row;
    }));
    find('cloudConnectionHint').textContent = 'Подключение и настройка аккаунтов — в самостоятельных окнах Google Drive и Яндекс Диска. Локальный ZIP доступен без облаков.';
    recipientPages.update(true); render();
  };
  find('cloudStart').onclick = async () => {
    saveNotice = '';
    try { await coordinator.run([...find('cloudRecipients').querySelectorAll('input:checked')].map(c => c.value)); }
    catch (error) { find('cloudStatus').textContent = error.message; }
  };
  find('cloudSave').onclick = () => {
    try { coordinator.save(download); saveNotice = 'ZIP передан браузеру. Проверь фактическое сохранение в загрузках браузера.'; }
    catch (error) { saveNotice = error.message; } render();
  };
  find('cloudCancel').onclick = () => coordinator.cancel(); find('cloudFinish').onclick = finish;
  dialog.addEventListener('close', () => { if (coordinator.view().busy) { closing = true; coordinator.cancel(); } else if (coordinator.view().archive) finish(); });
  globalThis.addEventListener('pagehide', finish);
  return { registerProvider(provider) { providers.push(provider); } };
}
