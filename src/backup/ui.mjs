import { installCloudBackupUI } from './cloud-ui.mjs';
import { storageRow, modal, pager } from './dialog.mjs';
import { createBackup, readBackup, projectItems, readPreferences, MAX_EXPANDED_BYTES } from './archive.mjs';

// No editor state or storage fallback lives in the UI. All durable reads/writes
// go through the editor's save barrier and the existing import transaction.
export function installBackupUI({ snapshot, restore, download, replacement }) {
  const card = storageRow({ id: 'zipStorage', title: 'Локальные ZIP-копии', description: 'Сохраняй и восстанавливай рабочее пространство или выбранные проекты', icon: '▣' });
  const dialog = document.createElement('dialog'); dialog.id = 'zipBackupDialog'; dialog.setAttribute('aria-labelledby', 'zipTitle');
  dialog.innerHTML = '<header class="backup-header"><h2 id="zipTitle">Локальные ZIP-копии</h2><button type="button" class="backup-close" data-backup-close aria-label="Закрыть">×</button></header><div class="backup-tabs" role="tablist" aria-label="Режим ZIP"><button type="button" role="tab" id="zipCreate" aria-controls="zipBody">Создать копию</button><button type="button" role="tab" id="zipRestore" aria-controls="zipBody">Восстановить копию</button></div><div id="zipBody" class="backup-content" role="tabpanel"></div><footer class="backup-actions"><button type="button" class="btn btn-outline" id="zipCancel">Отмена</button><button type="button" class="btn btn-primary" id="zipConfirm" disabled>Продолжить</button></footer><p id="zipStatus" class="backup-status" role="status" aria-live="polite"></p>';
  document.body.append(dialog);
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.zip,application/zip'; input.hidden = true; input.id = 'zipInput'; document.body.append(input);
  const find = id => dialog.querySelector('#' + id), body = find('zipBody'), status = find('zipStatus'), confirm = find('zipConfirm'), cancel = find('zipCancel');
  let busy = false, verified = null, mode = null, restoreBytes = null, prepared = false;
  const views = new Map();
  let archiveOwner = null;
  function checkArchive() {
    archiveOwner?.signal?.throwIfAborted();
    archiveOwner?.check?.();
  }
  function releaseArchive() {
    archiveOwner?.signal?.removeEventListener('abort', archiveOwner.abort);
    const owner = archiveOwner; archiveOwner = null; owner?.release?.(); verified = restoreBytes = null; views.delete('restore'); body.onchange = null;
    for (const extra of dialog.querySelectorAll('[data-zip-extra-action]')) extra.remove();
  }
  const text = (tag, value, parent = body) => { const node = document.createElement(tag); node.textContent = value; parent.append(node); return node; };
  const shell = modal(dialog, { opener: card, close: () => cancel.onclick() });
  card.onclick = () => { if (!busy) find('zipCreate').click(); };
  function filePicker(label, parent = body) {
    const pick = text('button', label, parent); pick.id = 'zipOpen'; pick.type = 'button'; pick.className = 'btn btn-outline';
    pick.onclick = () => { if (!busy) { input.value = ''; input.click(); } };
  }
  function reset(title, action) {
    for (const extra of dialog.querySelectorAll('[data-zip-extra-action]')) extra.remove();
    confirm.hidden = false; body.replaceChildren(); body.onchange = null; status.textContent = ''; verified = null; restoreBytes = null; prepared = false;
    confirm.disabled = true; confirm.textContent = action; find('zipTitle').textContent = title;
    for (const [id, active] of [['zipCreate', mode === 'create'], ['zipRestore', mode === 'restore']]) {
      find(id).setAttribute('aria-selected', String(active)); find(id).tabIndex = active ? 0 : -1;
    }
    body.setAttribute('aria-labelledby', mode === 'create' ? 'zipCreate' : 'zipRestore');
    shell.open();
  }
  function remember() {
    if (!dialog.open || !mode) return;
    // A prepared replacement cannot survive a mode change. Keep its verified
    // archive, but require the existing prepare path again when returning.
    if (prepared) {
      find('zipReplaceReview').hidden = false; find('zipReplaceReady').hidden = true;
      find('zipReplacePrepare').disabled = false; find('zipReplacePrepare').hidden = false; confirm.hidden = true; confirm.disabled = true;
      status.textContent = 'Для замены подготовь операцию повторно.';
    }
    views.set(mode, { nodes: [...body.childNodes], change: body.onchange, title: find('zipTitle').textContent,
      action: confirm.textContent, disabled: confirm.disabled, hidden: confirm.hidden, extras: [...dialog.querySelectorAll('[data-zip-extra-action]')], message: status.textContent, verified, restoreBytes });
  }
  function resume(next) {
    const saved = views.get(next); if (!saved) return false;
    mode = next; reset(saved.title, saved.action); body.append(...saved.nodes); body.onchange = saved.change;
    dialog.querySelector('.backup-actions').append(...saved.extras);
    verified = saved.verified; restoreBytes = saved.restoreBytes; confirm.hidden = saved.hidden; confirm.disabled = saved.disabled; status.textContent = saved.message;
    return true;
  }
  for (const id of ['zipCreate', 'zipRestore']) find(id).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return;
    event.preventDefault(); const target = find(event.key === 'Home' ? 'zipCreate' : event.key === 'End' ? 'zipRestore' : id === 'zipCreate' ? 'zipRestore' : 'zipCreate'); target.focus(); target.click();
  });
  async function task(message, operation, { optional = false, retryPreparation = null } = {}) {
    if (busy) return;
    busy = true; confirm.disabled = true; cancel.disabled = true; find('zipCreate').disabled = find('zipRestore').disabled = true; dialog.querySelector('[data-backup-close]').disabled = true; status.textContent = message; dialog.setAttribute('aria-busy', 'true');
    const long = setTimeout(() => { status.textContent = message + '\nБольшой архив требует времени и свободной памяти. Операция продолжается; данные не удаляются.'; }, 8000);
    try { await new Promise(resolve => setTimeout(resolve, 0)); await operation(); }
    catch (error) {
      // Only comparison/preparation may retain the already verified source.
      // The owner must still authorize it after every asynchronous failure.
      // Validation and writes never opt into this path.
      let archiveValid = false;
      if (verified && restoreBytes && !['SecurityError', 'NotAllowedError'].includes(error?.name)) {
        try { checkArchive(); archiveValid = true; } catch (sourceError) { error = sourceError; }
      }
      if (optional && archiveValid) {
        status.textContent = 'Не удалось скачать копию: ' + (error.message || error) + '\nКонтрольный снимок сохранён в памяти. Можно повторить скачивание, продолжить замену или отменить её.';
        confirm.disabled = !prepared; return;
      }
      const replacing = body.querySelector('[name=zipRestoreMode]:checked')?.value === 'replace';
      await replacement.cancel(); prepared = false;
      // Cancellation can await lock release: recheck the capability afterwards.
      if (archiveValid) { try { checkArchive(); } catch (sourceError) { archiveValid = false; error = sourceError; } }
      if (retryPreparation && replacing && archiveValid && !replacement.committed()) {
        retryPreparation();
        status.textContent = 'Не удалось подготовить замену: ' + (error.message || error) + '\nПроверенный ZIP сохранён в памяти. Повтори подготовку: текущие данные и все обязательные проверки будут выполнены заново.';
        return;
      }
      releaseArchive();
      if (find('zipReplaceReady')) find('zipReplaceReady').hidden = true;
      if (find('zipReplacePrepare')) find('zipReplacePrepare').disabled = true;
      status.textContent = replacement.committed() ? 'Транзакция IndexedDB уже подтверждена. Старое состояние остановлено. Перезагрузи приложение вручную. ' + (error.message || error) : 'Не удалось завершить: ' + (error.message || error) + (replacing ? '\nЗамена не выполнена. Повторно открой исходный ZIP и подготовь замену заново.' : '\nСохранение и создание копии не подтверждены. Для больших копий выбери меньше проектов или освободи память.');
      body.replaceChildren(); if (mode === 'restore') filePicker('Выбрать ZIP-файл');
    }
    finally { clearTimeout(long); busy = false; cancel.disabled = false; find('zipCreate').disabled = find('zipRestore').disabled = false; dialog.querySelector('[data-backup-close]').disabled = false; dialog.removeAttribute('aria-busy'); if (archiveOwner?.signal?.aborted) void cancel.onclick(); }
  }
  cancel.onclick = async () => { if (!busy) { busy = true; try { await replacement.cancel(); prepared = false; releaseArchive(); views.clear(); for (const extra of dialog.querySelectorAll('[data-zip-extra-action]')) extra.remove(); body.replaceChildren(); input.value = ''; dialog.close(); } finally { busy = false; } } };
  // A disabled preparation button can leave keyboard focus on the page body.
  // Handle Escape before the editor's capture guards, regardless of focus.
  window.addEventListener('keydown', event => {
    if (!dialog.open || event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!busy) void cancel.onclick();
  }, true);
  document.querySelector('#zipCreate').onclick = async () => {
    if (busy) return;
    remember();
    busy = true;
    try { await replacement.cancel(); } finally { busy = false; }
    if (resume('create')) return;
    mode = 'create'; reset('Создать ZIP-копию', 'Подготовить и скачать ZIP');
    await task('Подтверждаем сохранения и читаем проекты…', async () => {
      const data = await snapshot();
      for (const [value, label] of [['workspace', 'Всё рабочее пространство'], ['selected', 'Выбранные проекты']]) {
        const row = text('label', ''); const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'zipScope'; radio.value = value; radio.checked = value === 'workspace'; row.prepend(radio); text('span', label, row);
      }
      const projects = text('div', ''); projects.id = 'zipProjects';
      for (const p of data.projects) {
        const row = text('label', '', projects); const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.zipProject = p.id; check.checked = true; row.prepend(check);
        text('span', `${p.name || 'Проект'} · ${data.docs.filter(d => d.projectId === p.id).length} документов`, row);
      }
      const pages = pager(projects, { label: 'Проекты ZIP' });
      text('p', `${data.projects.length} проектов · ${data.docs.length} документов · ресурсы и папки проектов`);
      text('p', 'В обоих режимах глобальные шрифты, записи settings и известные настройки приложения включаются отдельно. Восстановление настроек в этом режиме не применяется.');
      text('p', 'Сохрани ZIP вне этого устройства. Копия в базе браузера не защищает от её очистки.').className = 'home-data-footnote';
      status.textContent = 'Перед упаковкой сохранения и снимок базы будут проверены повторно.';
      const update = () => { const selected = find('zipBody').querySelector('[name=zipScope]:checked')?.value === 'selected'; projects.hidden = pages.nav.hidden = !selected; if (selected) pages.update(); for (const check of body.querySelectorAll('[data-zip-project]')) check.disabled = !selected; confirm.disabled = selected && !body.querySelector('[data-zip-project]:checked'); };
      body.onchange = update; update();
    });
  };
  find('zipRestore').onclick = async () => {
    if (busy) return;
    remember();
    busy = true; try { await replacement.cancel(); } finally { busy = false; }
    if (resume('restore')) return;
    mode = 'restore'; reset('Восстановить ZIP-копию', 'Восстановить копии проектов');
    text('p', 'Выбери ZIP-копию КАРТОЧНОЙ. Перед восстановлением проверим архив, размеры, SHA-256 и связи.');
    filePicker('Выбрать ZIP-файл');
    text('p', 'После проверки можно добавить копии проектов или отдельно подготовить полную замену рабочего пространства. Данные не меняются при выборе файла.');
  };
  async function loadArchive(readBytes, size, owner = {}) {
    if (busy || document.querySelector('.backup-dialog[open]:not(#zipBackupDialog)')) throw Error('Дождись завершения текущей операции ZIP.');
    owner.signal?.throwIfAborted(); owner.check?.();
    busy = true;
    try { await replacement.cancel(); } finally { busy = false; }
    releaseArchive(); views.clear();
    owner.signal?.throwIfAborted(); owner.check?.();
    archiveOwner = { ...owner, abort: () => { if (!busy) void cancel.onclick(); } };
    owner.signal?.addEventListener('abort', archiveOwner.abort, { once: true });
    shell.open(owner.opener);
    mode = 'restore'; reset('Проверка ZIP перед восстановлением', 'Восстановить копии проектов'); body.onchange = null;
    await task('Проверяем контейнер, JSON, размеры, SHA-256 и связи…', async () => {
      if (size > MAX_EXPANDED_BYTES + 1024 * 1024) throw new Error('Архив превышает безопасный бюджет памяти браузера (512 МиБ данных)');
      const bytes = await readBytes(); readBytes = null; checkArchive();
      const result = await readBackup(bytes); checkArchive(); restoreBytes = bytes;
      verified = result;
      const { manifest: m, data } = result;
      const intro = text('div', '');
      filePicker('Выбрать другой ZIP', intro);
      text('p', `Дата: ${new Date(m.createdAt).toLocaleString()} · ${m.format} · приложение ${m.appVersion}`, intro);
      text('p', `${size.toLocaleString()} байт ZIP · ${m.scope === 'workspace' ? 'Всё рабочее пространство' : 'Выбранные проекты'} · ${data.projects.length} проектов · ${data.docs.length} документов`, intro);
      const details = text('details', '', intro); text('summary', 'Состав архива', details);
      const list = text('ul', '', details);
      for (const item of projectItems(data)) text('li', `${item.project.name || 'Проект'}: ${item.documents.length} документов, ${item.project.resources?.length || 0} ресурсов, ${item.project.resourceFolders?.length || 0} папок`, list);
      pager(list, { label: 'Проекты в архиве' });
      text('p', `Глобальные данные: ${data.fonts.length} пользовательских шрифтов, ${data.settings.length} записей settings, ${Object.keys(data.preferences).length} настроек localStorage. Каталог фигур включён при наличии в settings или известных настройках.`, details);
      const copyDescription = text('p', 'Будут добавлены копии проектов и документов с новыми внешними ID и недостающие начертания шрифтов. Существующие проекты, документы, каталог фигур, settings и localStorage не заменяются. Повторное восстановление создаст ещё копии. Неподдерживаемые шрифты могут быть пропущены с предупреждением.');
      if (result.warnings.length) { text('p', 'Предупреждения:'); const warnings = text('ul', ''); for (const value of result.warnings) text('li', value, warnings); }
      const choices = text('div', ''); choices.className = 'backup-choices';
      for (const [value, label] of [['copies', 'Добавить копии проектов'], ['replace', 'Заменить рабочее пространство']]) {
        const row = text('label', '', choices); const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'zipRestoreMode'; radio.value = value; radio.checked = value === 'copies'; radio.disabled = value === 'replace' && m.scope !== 'workspace'; row.prepend(radio); text('span', label, row);
      }
      if (m.scope !== 'workspace') text('p', 'Выборочный ZIP нельзя использовать для полной замены.');
      const panel = document.createElement('div'); panel.id = 'zipReplacePanel'; panel.hidden = true; body.append(panel);
      const review = text('div', '', panel); review.id = 'zipReplaceReview';
      const warning = text('p', 'ВНИМАНИЕ: текущие проекты, документы, шрифты и настройки будут заменены содержимым архива. Исходные ID сохраняются.', review); warning.style.cssText = 'border:2px solid #f39873;padding:12px;font-weight:bold';
      text('p', 'Закрой ВСЕ остальные окна КАРТОЧНОЙ, включая старые версии. Активные окна новой версии блокируют замену. Старые версии не поддерживают блокировку и могут записать устаревшие данные. Полная безопасность нескольких окон не гарантируется.', review);
      text('p', 'Только IndexedDB заменяется атомарно. localStorage применяется после commit; возможна частичная ошибка настроек.', review);
      const comparison = text('table', '', review); comparison.id = 'zipComparison';
      const compare = current => {
        comparison.replaceChildren(); const head = text('tr', '', comparison);
        for (const value of ['Количество', 'Текущие данные', 'Данные ZIP']) text('th', value, head);
        for (const [key, label] of [['projects', 'Проектов'], ['docs', 'Документов'], ['fonts', 'Шрифтов'], ['settings', 'Записей settings']]) {
          const row = text('tr', '', comparison); for (const value of [label, Array.isArray(current[key]) ? current[key].length : current[key], data[key].length]) { const cell = text('td', value, row); cell.style.padding = '6px 12px'; }
        }
      };
      const prepare = text('button', 'Подготовить замену', dialog.querySelector('.backup-actions')); prepare.dataset.zipExtraAction = ''; prepare.hidden = true; prepare.type = 'button'; prepare.id = 'zipReplacePrepare'; prepare.className = 'btn btn-outline';
      const final = text('div', '', panel); final.id = 'zipReplaceReady'; final.hidden = true;
      text('p', 'Текущие данные защищены контрольным снимком в памяти: проверка обнаруживает конкурентные изменения, а транзакция IndexedDB защищает от частичной записи. Редактирование заблокировано до отмены или перезагрузки.', final);
      text('p', 'Снимок в памяти не является резервной копией для восстановления после успешной замены. Без скачанного страховочного ZIP прежние данные могут быть безвозвратно потеряны. Скачивание рекомендуется, но не обязательно. Проверь, что выбран нужный архив.', final);
      const safety = text('button', 'Скачать копию текущих данных (рекомендуется)', final); safety.type = 'button'; safety.id = 'zipSafetyDownload'; safety.className = 'btn btn-outline';
      const update = () => { confirm.disabled = !verified || !prepared; };
      const retryPreparation = () => {
        // No previous comparison or preparation proof authorizes confirmation.
        comparison.replaceChildren(); review.hidden = false; final.hidden = true;
        prepare.disabled = false; prepare.hidden = false; confirm.hidden = true; confirm.disabled = true;
      };
      prepare.onclick = () => task('Блокируем редактирование и подтверждаем сохранения…', async () => {
        checkArchive(); if (!verified) throw Error('Повторно открой исходный ZIP');
        const current = await replacement.prepare(); checkArchive(); compare(current); prepared = true; prepare.disabled = true; prepare.hidden = true; confirm.hidden = false; review.hidden = true; final.hidden = false;
        status.textContent = 'Замена подготовлена. Можно скачать копию текущих данных или перейти к финальному подтверждению.'; update();
      }, { retryPreparation });
      safety.onclick = () => task('Упаковываем копию контрольного снимка…', async () => {
        checkArchive(); await replacement.downloadSafety(); checkArchive();
        status.textContent = 'ZIP подготовлен и передан браузеру для скачивания. Сохрани файл самостоятельно и проверь загрузки: браузер может отменить или заблокировать скачивание.'; update();
      }, { optional: true });
      body.onchange = event => {
        if (event.target.name !== 'zipRestoreMode' || busy) return;
        void task('Читаем текущее состояние для сравнения…', async () => {
          checkArchive();
          await replacement.cancel(); checkArchive(); prepared = false; prepare.disabled = false; review.hidden = false; final.hidden = true;
          const replace = event.target.value === 'replace'; intro.hidden = replace; panel.hidden = !replace; copyDescription.hidden = replace; prepare.hidden = !replace; confirm.hidden = replace;
          confirm.textContent = replace ? 'Заменить рабочее пространство' : 'Восстановить копии проектов';
          if (replace) { const current = await snapshot(); checkArchive(); compare(current); update(); status.textContent = 'Сравни данные и нажми «Подготовить замену».'; }
          else { confirm.disabled = !verified; status.textContent = 'Будут добавлены копии проектов.'; }
        }, { retryPreparation });
      };
      status.textContent = 'Проверка пройдена. Восстановление начнётся только после нажатия кнопки.'; confirm.disabled = false;
    });
  }
  input.onchange = async () => {
    const file = input.files[0]; input.value = ''; if (!file || busy) return;
    await loadArchive(async () => new Uint8Array(await file.arrayBuffer()), file.size);
  };
  confirm.onclick = async () => {
    if (busy) return;
    if (mode === 'create') {
      const selected = body.querySelector('[name=zipScope]:checked')?.value === 'selected';
      const ids = selected ? [...body.querySelectorAll('[data-zip-project]:checked')].map(x => x.dataset.zipProject) : null;
      await task('Подтверждаем сохранения и готовим ZIP…', async () => {
        const data = await snapshot(); const preferences = readPreferences(localStorage);
        const result = await createBackup(data, { selectedIds: ids, preferences });
        download(new Blob([result.bytes], { type: 'application/zip' }), result.filename);
        status.textContent = 'ZIP подготовлен и передан браузеру для скачивания. Сохрани файл самостоятельно и проверь загрузки: браузер может отменить или заблокировать скачивание.';
      });
    } else if (mode === 'restore' && verified && body.querySelector('[name=zipRestoreMode]:checked')?.value === 'replace') {
      if (!prepared) return;
      if (!window.confirm('Заменить рабочее пространство? Текущие документы, проекты, шрифты и настройки будут заменены содержимым ZIP. Без скачанного страховочного ZIP прежние данные могут быть безвозвратно потеряны.')) return;
      const bytes = restoreBytes; verified = null; prepared = false;
      await task('Заменяем IndexedDB одной транзакцией. Затем приложение перезагрузится…', async () => {
        checkArchive(); await replacement.commit(bytes, checkArchive);
        releaseArchive(); views.clear();
        status.textContent = 'Транзакция IndexedDB подтверждена. Перезагрузка…';
      });
    } else if (mode === 'restore' && verified) {
      const result = verified; verified = null;
      await task('Добавляем копии одной транзакцией. Дождись подтверждения…', async () => {
        checkArchive(); const warnings = await restore(result, checkArchive);
        releaseArchive(); views.clear();
        status.textContent = 'Транзакция завершена: копии проектов добавлены. Настройки и каталог фигур не применялись.' + (warnings?.length ? '\nПредупреждения: ' + warnings.join(', ') : '');
        body.replaceChildren(); filePicker('Выбрать другой ZIP');
      });
    }
  };
  // An explicit, module-local bridge. Both entry routes run loadArchive/readBackup
  // and use the same restore/prepare/commit handlers. Ownership transfers here.
  const cloud = installCloudBackupUI({ snapshot, download, assertAvailable() {
    if (busy || prepared || archiveOwner || restoreBytes || replacement.committed()) throw Error('Сначала заверши или отмени подготовленное восстановление ZIP.');
  } });
  return Object.freeze({ registerProvider: cloud.registerProvider, openArchive(bytes, metadata = {}) {
    if (!(bytes instanceof Uint8Array)) throw Error('Ожидаются байты ZIP.');
    return loadArchive(() => bytes, bytes.byteLength, metadata);
  } });
}
