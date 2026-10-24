import { createBackup, readBackup, projectItems, readPreferences, MAX_EXPANDED_BYTES } from './archive.mjs';

// No editor state or storage fallback lives in the UI. All durable reads/writes
// go through the editor's save barrier and the existing import transaction.
export function installBackupUI({ snapshot, restore, download, replacement }) {
  const card = document.createElement('article'); card.className = 'home-data-card';
  card.innerHTML = '<div class="home-data-icon">▣</div><h2>Локальные ZIP-копии</h2><p>Полное рабочее пространство или выбранные проекты, включая сохранённые документы, ресурсы, шрифты и настройки.</p><button type="button" class="btn btn-primary" id="zipCreate">Создать ZIP-копию</button><button type="button" class="btn btn-outline" id="zipOpen">Восстановить из ZIP</button><span class="home-data-footnote">Сохрани скачанный ZIP самостоятельно, желательно вне этого устройства. Копия в базе браузера не защищает от её очистки.</span>';
  document.querySelector('#homeDataPane .home-data-grid').append(card);
  const dialog = document.createElement('dialog'); dialog.id = 'zipBackupDialog'; dialog.setAttribute('aria-labelledby', 'zipTitle');
  dialog.innerHTML = '<h2 id="zipTitle">ZIP-копия</h2><div id="zipBody"></div><p id="zipStatus" role="status" aria-live="polite"></p><div class="zip-actions"><button type="button" class="btn btn-outline" id="zipCancel">Отмена</button><button type="button" class="btn btn-primary" id="zipConfirm" disabled>Продолжить</button></div>';
  document.body.append(dialog);
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.zip,application/zip'; input.hidden = true; input.id = 'zipInput'; document.body.append(input);
  const style = document.createElement('style');
  style.textContent = '#zipBackupDialog{background:#261e30;color:#f4effb;border:1px solid #574661;border-radius:18px;padding:24px;width:min(640px,calc(100% - 24px));max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box}#zipBackupDialog::backdrop{background:#100b18bb}#zipBackupDialog h2{margin:0 0 16px}#zipBackupDialog p{line-height:1.55}#zipBackupDialog label{display:flex;gap:12px;align-items:center;padding:10px 0}#zipBackupDialog input[type=checkbox],#zipBackupDialog input[type=radio]{width:20px;height:20px;flex-shrink:0;accent-color:#aa83ed}.zip-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}#zipStatus{white-space:pre-wrap;overflow-wrap:anywhere;color:#d7c2ee;min-height:24px}#zipBackupDialog ul{padding-left:22px;overflow-wrap:anywhere}#zipOpen{margin-top:10px}#zipBackupDialog button:disabled{opacity:.55}';
  document.head.append(style);
  const find = id => dialog.querySelector('#' + id), body = find('zipBody'), status = find('zipStatus'), confirm = find('zipConfirm'), cancel = find('zipCancel');
  let busy = false, verified = null, mode = null, restoreBytes = null, prepared = false;
  const text = (tag, value, parent = body) => { const node = document.createElement(tag); node.textContent = value; parent.append(node); return node; };
  function reset(title, action) { body.replaceChildren(); status.textContent = ''; verified = null; restoreBytes = null; prepared = false; confirm.disabled = true; confirm.textContent = action; find('zipTitle').textContent = title; if (!dialog.open) dialog.showModal(); }
  async function task(message, operation, { optional = false } = {}) {
    if (busy) return;
    busy = true; confirm.disabled = true; cancel.disabled = true; status.textContent = message; dialog.setAttribute('aria-busy', 'true');
    const long = setTimeout(() => { status.textContent = message + '\nБольшой архив требует времени и свободной памяти. Операция продолжается; данные не удаляются.'; }, 8000);
    try { await new Promise(resolve => setTimeout(resolve, 0)); await operation(); }
    catch (error) {
      if (optional) {
        status.textContent = 'Не удалось скачать копию: ' + (error.message || error) + '\nКонтрольный снимок сохранён в памяти. Можно повторить скачивание, продолжить замену или отменить её.';
        confirm.disabled = !prepared; return;
      }
      await replacement.cancel(); prepared = false; verified = restoreBytes = null;
      if (find('zipReplaceReady')) find('zipReplaceReady').hidden = true;
      if (find('zipReplacePrepare')) find('zipReplacePrepare').disabled = true;
      status.textContent = replacement.committed() ? 'Транзакция IndexedDB уже подтверждена. Старое состояние остановлено. Перезагрузи приложение вручную. ' + (error.message || error) : 'Не удалось завершить: ' + (error.message || error) + (body.querySelector('[name=zipRestoreMode]:checked')?.value === 'replace' ? '\nЗамена не выполнена. Повторно открой исходный ZIP и подготовь замену заново.' : '\nСохранение и создание копии не подтверждены. Для больших копий выбери меньше проектов или освободи память.');
    }
    finally { clearTimeout(long); busy = false; cancel.disabled = false; dialog.removeAttribute('aria-busy'); }
  }
  cancel.onclick = async () => { if (!busy) { busy = true; try { await replacement.cancel(); prepared = false; verified = restoreBytes = null; body.replaceChildren(); input.value = ''; dialog.close(); } finally { busy = false; } } };
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) void cancel.onclick(); });
  // A disabled preparation button can leave keyboard focus on the page body.
  // Handle Escape before the editor's capture guards, regardless of focus.
  window.addEventListener('keydown', event => {
    if (!dialog.open || event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!busy) void cancel.onclick();
  }, true);
  document.querySelector('#zipCreate').onclick = async () => {
    if (busy) return;
    busy = true;
    try { await replacement.cancel(); } finally { busy = false; }
    mode = 'create'; reset('Создать ZIP-копию', 'Подготовить и скачать ZIP');
    await task('Подтверждаем сохранения и читаем проекты…', async () => {
      const data = await snapshot();
      for (const [value, label] of [['workspace', 'Всё рабочее пространство'], ['selected', 'Выбранные проекты']]) {
        const row = text('label', ''); const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'zipScope'; radio.value = value; radio.checked = value === 'workspace'; row.prepend(radio); text('span', label, row);
      }
      for (const p of data.projects) {
        const row = text('label', ''); const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.zipProject = p.id; check.checked = true; row.prepend(check);
        text('span', `${p.name || 'Проект'} · ${data.docs.filter(d => d.projectId === p.id).length} документов`, row);
      }
      text('p', 'В обоих режимах глобальные шрифты, записи settings и известные настройки приложения включаются отдельно. Восстановление настроек в этом режиме не применяется.');
      status.textContent = 'Перед упаковкой сохранения и снимок базы будут проверены повторно.';
      const update = () => { const selected = find('zipBody').querySelector('[name=zipScope]:checked')?.value === 'selected'; for (const check of body.querySelectorAll('[data-zip-project]')) check.disabled = !selected; confirm.disabled = selected && !body.querySelector('[data-zip-project]:checked'); };
      body.onchange = update; update();
    });
  };
  document.querySelector('#zipOpen').onclick = () => { if (!busy) { input.value = ''; input.click(); } };
  input.onchange = async () => {
    const file = input.files[0]; input.value = ''; if (!file || busy) return;
    busy = true;
    try { await replacement.cancel(); } finally { busy = false; }
    mode = 'restore'; reset('Проверка ZIP перед восстановлением', 'Восстановить копии проектов'); body.onchange = null;
    await task('Проверяем контейнер, JSON, размеры, SHA-256 и связи…', async () => {
      if (file.size > MAX_EXPANDED_BYTES + 1024 * 1024) throw new Error('Архив превышает безопасный бюджет памяти браузера (512 МиБ данных)');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await readBackup(bytes); restoreBytes = bytes;
      verified = result;
      const { manifest: m, data } = result;
      text('p', `Дата: ${new Date(m.createdAt).toLocaleString()} · ${m.format} · приложение ${m.appVersion}`);
      text('p', `${file.size.toLocaleString()} байт ZIP · ${m.scope === 'workspace' ? 'Всё рабочее пространство' : 'Выбранные проекты'} · ${data.projects.length} проектов · ${data.docs.length} документов`);
      const list = text('ul', '');
      for (const item of projectItems(data)) text('li', `${item.project.name || 'Проект'}: ${item.documents.length} документов, ${item.project.resources?.length || 0} ресурсов, ${item.project.resourceFolders?.length || 0} папок`, list);
      text('p', `Глобальные данные: ${data.fonts.length} пользовательских шрифтов, ${data.settings.length} записей settings, ${Object.keys(data.preferences).length} настроек localStorage. Каталог фигур включён при наличии в settings или известных настройках.`);
      const copyDescription = text('p', 'Будут добавлены копии проектов и документов с новыми внешними ID и недостающие начертания шрифтов. Существующие проекты, документы, каталог фигур, settings и localStorage не заменяются. Повторное восстановление создаст ещё копии. Неподдерживаемые шрифты могут быть пропущены с предупреждением.');
      if (result.warnings.length) { text('p', 'Предупреждения:'); const warnings = text('ul', ''); for (const value of result.warnings) text('li', value, warnings); }
      for (const [value, label] of [['copies', 'Добавить копии проектов'], ['replace', 'Заменить рабочее пространство']]) {
        const row = text('label', ''); const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'zipRestoreMode'; radio.value = value; radio.checked = value === 'copies'; radio.disabled = value === 'replace' && m.scope !== 'workspace'; row.prepend(radio); text('span', label, row);
      }
      if (m.scope !== 'workspace') text('p', 'Выборочный ZIP нельзя использовать для полной замены.');
      const panel = document.createElement('div'); panel.id = 'zipReplacePanel'; panel.hidden = true; body.append(panel);
      const warning = text('p', 'ВНИМАНИЕ: текущие проекты, документы, шрифты и настройки будут заменены содержимым архива. Исходные ID сохраняются.', panel); warning.style.cssText = 'border:2px solid #f39873;padding:12px;font-weight:bold';
      text('p', 'Закрой ВСЕ остальные окна КАРТОЧНОЙ, включая старые версии. Активные окна новой версии блокируют замену. Старые версии не поддерживают блокировку и могут записать устаревшие данные. Полная безопасность нескольких окон не гарантируется.', panel);
      text('p', 'Только IndexedDB заменяется атомарно. localStorage применяется после commit; возможна частичная ошибка настроек.', panel);
      const comparison = text('table', '', panel); comparison.id = 'zipComparison';
      const compare = current => {
        comparison.replaceChildren(); const head = text('tr', '', comparison);
        for (const value of ['Количество', 'Текущие данные', 'Данные ZIP']) text('th', value, head);
        for (const [key, label] of [['projects', 'Проектов'], ['docs', 'Документов'], ['fonts', 'Шрифтов'], ['settings', 'Записей settings']]) {
          const row = text('tr', '', comparison); for (const value of [label, Array.isArray(current[key]) ? current[key].length : current[key], data[key].length]) { const cell = text('td', value, row); cell.style.padding = '6px 12px'; }
        }
      };
      const prepare = text('button', 'Подготовить замену', panel); prepare.type = 'button'; prepare.id = 'zipReplacePrepare'; prepare.className = 'btn btn-outline';
      const final = text('div', '', panel); final.id = 'zipReplaceReady'; final.hidden = true;
      text('p', 'Текущие данные защищены контрольным снимком в памяти: проверка обнаруживает конкурентные изменения, а транзакция IndexedDB защищает от частичной записи. Редактирование заблокировано до отмены или перезагрузки.', final);
      text('p', 'Снимок в памяти не является резервной копией для восстановления после успешной замены. Без скачанного страховочного ZIP прежние данные могут быть безвозвратно потеряны. Скачивание рекомендуется, но не обязательно. Проверь, что выбран нужный архив.', final);
      const safety = text('button', 'Скачать копию текущих данных (рекомендуется)', final); safety.type = 'button'; safety.id = 'zipSafetyDownload'; safety.className = 'btn btn-outline';
      const update = () => { confirm.disabled = !verified || !prepared; };
      prepare.onclick = () => task('Блокируем редактирование и подтверждаем сохранения…', async () => {
        if (!verified) throw Error('Повторно открой исходный ZIP');
        const current = await replacement.prepare(); compare(current); prepared = true; prepare.disabled = true; final.hidden = false;
        status.textContent = 'Замена подготовлена. Можно скачать копию текущих данных или перейти к финальному подтверждению.'; update();
      });
      safety.onclick = () => task('Упаковываем копию контрольного снимка…', async () => {
        await replacement.downloadSafety();
        status.textContent = 'ZIP подготовлен и передан браузеру для скачивания. Сохрани файл самостоятельно и проверь загрузки: браузер может отменить или заблокировать скачивание.'; update();
      }, { optional: true });
      body.onchange = event => {
        if (event.target.name !== 'zipRestoreMode' || busy) return;
        void task('Читаем текущее состояние для сравнения…', async () => {
          await replacement.cancel(); prepared = false; prepare.disabled = false; final.hidden = true;
          const replace = event.target.value === 'replace'; panel.hidden = !replace; copyDescription.hidden = replace;
          confirm.textContent = replace ? 'Заменить рабочее пространство' : 'Восстановить копии проектов';
          if (replace) { compare(await snapshot()); update(); status.textContent = 'Сравни данные и нажми «Подготовить замену».'; }
          else { confirm.disabled = !verified; status.textContent = 'Будут добавлены копии проектов.'; }
        });
      };
      status.textContent = 'Проверка пройдена. Восстановление начнётся только после нажатия кнопки.'; confirm.disabled = false;
    });
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
        await replacement.commit(bytes);
        status.textContent = 'Транзакция IndexedDB подтверждена. Перезагрузка…';
      });
    } else if (mode === 'restore' && verified) {
      const result = verified; verified = null;
      await task('Добавляем копии одной транзакцией. Дождись подтверждения…', async () => {
        const warnings = await restore(result);
        status.textContent = 'Транзакция завершена: копии проектов добавлены. Настройки и каталог фигур не применялись.' + (warnings?.length ? '\nПредупреждения: ' + warnings.join(', ') : '');
        body.replaceChildren();
      });
    }
  };
}
