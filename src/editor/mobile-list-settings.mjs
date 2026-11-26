import {html} from '../core/primitives.mjs';
import {paragraphListDefaults, paragraphListLimits, paragraphListMinimums} from '../model/paragraph-style.mjs';
import {listCounterStyles, listMarkerGroups, listMarkerPercent, validateListMarker} from '../model/list-presets.mjs';

const fieldSelector = '[data-mp-list-field]';
const markerInputSelector = '[data-mp-list-custom]';
const kinds = [['bullet', 'Маркеры'], ['ordered', 'Нумерация']];
const spacing = [
  ['listIndent', 'Отступ слева', 'Отступ слева'],
  ['listGap', 'Расстояние между маркером и текстом', 'Маркер — текст'],
  ['listItemSpacing', 'Интервал между пунктами', 'Между пунктами'],
];
const paintKeys = ['listMarkerColor', 'listMarkerOpacity'];
const colors = ['#000000', '#ffffff', '#7857de', '#d4fc15'];
const viewSelector = '[data-mp-list-open]';
const navSelector = `${viewSelector},[data-mp-list-tab],[data-mp-list-mode],[data-mp-action=back]`;
const mixedLabel = 'Разные';
const inheritLabel = 'Как у текста';
const autoLabel = 'Авто';
const linkIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m10 13 4-4m-5 6-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m0 10a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1 1"/></svg>';

function choice(key, value, label, content = html(label), className = '') {
  return `<button type="button" class="${className}" data-mp-list-key="${key}" data-mp-list-value="${html(value)}" aria-label="${html(label)}" title="${html(label)}" aria-pressed="false">${content}</button>`;
}

function stateNote(key) {
  return `<small id="mp-list-state-${key}" data-mp-list-state="${key}"></small>`;
}

function numeric(key, label, {shortLabel = label, unit = '', sliderMax, shortcut, kind} = {}) {
  const min = paragraphListMinimums[key] ?? 0;
  const max = paragraphListLimits[key];
  const field = `data-mp-list-field="${key}" min="${min}" aria-describedby="mp-list-state-${key}${key === 'listMarkerOpacity' ? ' mp-list-color-hint' : ''}"`;
  const name = label + (unit ? ', ' + unit : '');
  return `<div class="mp-list-row ${sliderMax ? 'mp-list-range-row' : ''}" data-mp-list-property="${key}" ${kind ? `data-mp-list-kind="${kind}"` : ''}>
    <label for="mp-list-field-${key}">${shortLabel}${unit ? `<span class="mp-list-unit"> ${unit}</span>` : ''}${stateNote(key)}</label>
    ${sliderMax ? `<input type="range" ${field} max="${sliderMax}" step="1" aria-label="${name}, ползунок">` : ''}
    <input id="mp-list-field-${key}" type="number" ${field} aria-label="${name}" max="${max}" step="${unit === 'px' ? 'any' : 1}" inputmode="${unit === 'px' ? 'decimal' : 'numeric'}" enterkeyhint="done">
    ${shortcut ?? ''}
  </div>`;
}

function tabs(group, label, options) {
  return `<div class="mp-list-segmented" role="tablist" aria-label="${label}">
    ${options.map(([key, title]) => `<button type="button" id="mp-list-tab-${key}" role="tab" data-mp-list-tab="${key}" data-group="${group}" aria-controls="mp-list-tabpanel-${key}" aria-selected="false" tabindex="-1">${title}</button>`).join('')}
  </div>`;
}

function tabPanel(key) {
  return `id="mp-list-tabpanel-${key}" role="tabpanel" aria-labelledby="mp-list-tab-${key}" data-mp-list-tabpanel="${key}" hidden`;
}

function autoChoice(key, label) {
  return choice(key, 'auto', label + ' · ' + autoLabel, autoLabel, 'mp-list-shortcut');
}

function inheritChoice(key, label) {
  return choice(key, 'inherit', label + ' · ' + inheritLabel, linkIcon, 'mp-list-shortcut');
}

export function mobileListSettingsContent() {
  return `<div data-mp-list-view="settings">
    <div class="mp-list-meta">
      <p data-mp-list-target role="status"></p>
      <span data-mp-list-single-kind></span>
      <div class="mp-list-segmented" data-mp-list-modes role="group" aria-label="Тип списка" hidden>
        ${kinds.map(([kind, label]) => `<button type="button" data-mp-list-mode="${kind}" aria-pressed="false">${label}</button>`).join('')}
      </div>
    </div>
    ${tabs('settings', 'Параметры списка', [['appearance', 'Оформление'], ['spacing', 'Интервалы']])}
    <fieldset class="mp-list-controls">
      <div ${tabPanel('appearance')}>
        <div class="mp-list-row" data-mp-list-property="style">
          <span data-mp-list-style-label>Маркер</span>
          <button type="button" class="mp-list-opener" data-mp-list-open="gallery" aria-describedby="mp-list-style-sample" aria-haspopup="dialog">
            <bdi id="mp-list-style-sample" data-mp-list-style></bdi><span class="mp-list-chevron" aria-hidden="true">›</span>
          </button>
        </div>
        ${numeric('listMarkerScale', 'Размер маркера', {shortLabel:'Размер', unit:'%', sliderMax:paragraphListLimits.listMarkerScale,
          shortcut:autoChoice('listMarkerScale', 'Размер маркера')})}
        <div class="mp-list-row" data-mp-list-property="listMarkerColor">
          <span>Цвет ${stateNote('listMarkerColor')}</span>
          <button type="button" class="mp-list-opener" data-mp-list-open="color" aria-label="Цвет маркера" aria-describedby="mp-list-state-listMarkerColor mp-list-color-hint" aria-haspopup="dialog">
            <span class="mp-list-swatch" data-mp-list-color-sample></span><span id="mp-list-color-hint" hidden></span><span class="mp-list-chevron" aria-hidden="true">›</span>
          </button>
          ${inheritChoice('listMarkerColor', 'Цвет маркера')}
        </div>
        ${numeric('listMarkerOpacity', 'Непрозрачность маркера', {shortLabel:'Прозрачность', unit:'%', sliderMax:paragraphListLimits.listMarkerOpacity,
          shortcut:inheritChoice('listMarkerOpacity', 'Непрозрачность маркера')})}
        ${numeric('listStart', 'Начальный номер', {shortLabel:'Первый номер', kind:'ordered', shortcut:autoChoice('listStart', 'Начальный номер')})}
      </div>
      <div ${tabPanel('spacing')}>
        ${spacing.map(([key, label, shortLabel]) => numeric(key, label, {shortLabel, unit:'px', sliderMax:Math.min(120, paragraphListLimits[key])})).join('')}
      </div>
    </fieldset>
  </div>
  <fieldset class="mp-list-controls" data-mp-list-view="gallery" hidden>
    <div data-mp-list-kind="bullet">
      <div class="mp-list-gallery-bar">
        ${tabs('gallery', 'Галерея маркеров', [['presets', 'Стандартные'], ['custom', 'Мои маркеры']])}
        <bdi aria-label="Текущий маркер" data-mp-list-gallery-style></bdi>
      </div>
      <div ${tabPanel('presets')} class="mp-list-tiles">
        ${listMarkerGroups.flatMap(({markers}) => markers.map(([marker, name]) => choice('listMarker', marker, name, marker))).join('')}
      </div>
      <div ${tabPanel('custom')}>
        <div class="mp-list-custom-row">
          <input type="text" data-mp-list-custom aria-label="Пользовательский маркер" placeholder="Один символ или эмодзи" autocomplete="off" spellcheck="false" enterkeyhint="done">
          <bdi class="mp-list-custom-preview" data-mp-list-custom-preview aria-label="Предпросмотр маркера"></bdi>
        </div>
        <p data-mp-list-input-note role="status" hidden></p>
        <div class="mp-list-custom-actions">
          <button type="button" data-mp-list-library="add">Добавить</button>
          <button type="button" data-mp-list-apply>Применить</button>
        </div>
        <p data-mp-list-library-note role="status" hidden></p>
        <div data-mp-list-gallery></div>
      </div>
    </div>
    <div data-mp-list-kind="ordered">
      <p class="mp-list-current-style">Текущий формат <bdi data-mp-list-gallery-style></bdi></p>
      <div class="mp-list-tiles mp-list-counters">
        ${listCounterStyles.map(([key, label]) => choice('listCounterStyle', key, label)).join('')}
      </div>
    </div>
  </fieldset>
  <fieldset class="mp-list-controls mp-list-color-picker" data-mp-list-view="color" hidden>
    <div class="mp-color-plane" data-mp-list-plane aria-hidden="true"><div class="mp-color-cursor"></div></div>
    <label class="mp-list-hue-row"><span>Оттенок</span><input type="range" class="mp-list-hue" data-mp-list-field="listMarkerColor" min="0" max="359" step="1" data-mp-list-hue></label>
    <div class="mp-list-color-edit">
      <span class="mp-list-swatch" data-mp-list-color-preview></span>
      <label for="mp-list-hex">HEX</label>
      <input id="mp-list-hex" type="text" data-mp-list-field="listMarkerColor" aria-label="Цвет маркера HEX" placeholder="#RRGGBB" autocapitalize="off" autocomplete="off" spellcheck="false" enterkeyhint="done">
      <div class="mp-list-swatches" role="group" aria-label="Цвета маркера">
        ${colors.map(color => choice('listMarkerColor', color, color, `<span class="mp-list-swatch" style="background:${color}"></span>`)).join('')}
      </div>
    </div>
  </fieldset>`;
}

const sameTarget = (a, b) => !!a && !!b && a.owner === b.owner && a.element === b.element &&
  a.revision === b.revision && a.range?.start === b.range?.start && a.range?.end === b.range?.end &&
  a.range?.direction === b.range?.direction;
const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };

function fieldValue(field) {
  const key = field.dataset.mpListField;
  if (key === 'listMarkerColor') return /^#[0-9a-f]{6}$/i.test(field.value.trim()) ? field.value.trim().toLowerCase() : undefined;
  if (key === 'listStart' && field.value === '' && !field.validity.badInput) return null;
  if (field.checkValidity() && Number.isFinite(field.valueAsNumber)) return field.valueAsNumber;
}

export function createMobileListSettings(root, {
  readTarget, apply, library, validateMarkerInput, previewSliderEvents, colorToHSV, hsvToColor, resizeStage,
}) {
  let panel, mode, draft, composing = null;
  let galleryVersion, view, selectedTabs, scrollPositions, pickerHSV;
  const query = selector => panel.querySelector(selector);
  const planeSelector = '[data-mp-list-plane]';
  const hueSelector = '[data-mp-list-hue]';
  const hexSelector = '#mp-list-hex';
  const sheetSize = new ResizeObserver(() => { if (panel?.isConnected) resizeStage(); });

  function feedback(selector, message, error = false) {
    const note = query(selector);
    setText(note, message || '');
    note.hidden = !message;
    note.dataset.error = String(error);
  }

  function syncLibrary(target) {
    const input = query(markerInputSelector);
    const {markers, pending} = library.state();
    const gallery = query('[data-mp-list-gallery]');
    if (markers !== galleryVersion) {
      galleryVersion = markers;
      gallery.innerHTML = markers.length ? markers.map(marker => `<div class="mp-list-library-tile">
        ${choice('listMarker', marker, 'Применить маркер ' + marker, `<bdi>${html(marker)}</bdi>`)}
        <button type="button" data-mp-list-library="remove" data-marker="${html(marker)}" aria-label="${html('Удалить маркер ' + marker)}">×</button>
      </div>`).join('') : '<p>В галерее пока нет маркеров.</p>';
    }
    const confirmed = composing !== input;
    const marker = input.value;
    const {valid, invalid, duplicate, full, message} = confirmed ? validateMarkerInput(marker) : {};
    input.setAttribute('aria-invalid', String(!!invalid));
    input.disabled = !target;
    feedback('[data-mp-list-input-note]', confirmed ? message : '', invalid);
    setText(query('[data-mp-list-custom-preview]'), valid ? marker : '');
    query('[data-mp-list-apply]').disabled = !target || !confirmed || !valid;
    query('[data-mp-list-library=add]').disabled = !target || !confirmed || !valid || duplicate || full || pending;
    for (const button of gallery.querySelectorAll('[data-mp-list-library]')) button.disabled = !target || pending;
  }

  function canChange(target, key) {
    return !!target?.state && (!paintKeys.includes(key) ||
      target.state.solid && (key !== 'listMarkerColor' || !target.state.emoji));
  }

  function renderColor(hex, [hue, saturation, brightness]) {
    const plane = query(planeSelector);
    plane.style.background = `hsl(${hue} 100% 50%)`;
    const cursor = plane.firstElementChild;
    cursor.style.left = `${saturation * 100}%`;
    cursor.style.top = `${(1 - brightness) * 100}%`;
    query(hueSelector).value = Math.min(359, Math.round(hue));
    query('[data-mp-list-color-preview]').style.background = hex;
  }

  function syncView(state) {
    const title = view === 'settings' ? 'Настройки списка' : view === 'color' ? 'Цвет маркера' :
      mode === 'bullet' ? 'Маркеры' : 'Нумерация';
    panel.setAttribute('aria-label', title);
    setText(query('.mp-head strong'), title);
    for (const node of panel.querySelectorAll('[data-mp-list-view]')) node.hidden = node.dataset.mpListView !== view;
    for (const button of panel.querySelectorAll('[data-mp-list-tab]')) {
      const selected = selectedTabs[button.dataset.group] === button.dataset.mpListTab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      query('#' + button.getAttribute('aria-controls')).hidden = !selected;
    }
    for (const fieldset of panel.querySelectorAll('fieldset')) fieldset.disabled = !state;
  }

  function sync() {
    if (!panel?.isConnected) return;
    const scope = readTarget();
    if (scope && !scope.modes.includes(mode)) mode = scope.modes[0] ?? mode;
    const target = readTarget(mode);
    const state = target?.state;
    if (draft && (!sameTarget(draft.target, target) || draft.mode !== mode || !canChange(target, draft.key))) {
      draft.cancelSlider?.();
      draft = null;
    }
    syncView(state);
    const scopeLabel = scope?.label || 'Цель форматирования изменилась.';
    const scopeNote = query('[data-mp-list-target]');
    setText(scopeNote, scopeLabel);
    scopeNote.title = scopeLabel;
    query('[data-mp-list-modes]').hidden = scope?.modes.length !== 2;
    setText(query('[data-mp-list-single-kind]'), scope?.modes.length === 1 ?
      (mode === 'bullet' ? 'Маркированный' : 'Нумерованный') : '');
    for (const button of panel.querySelectorAll('[data-mp-list-mode]')) {
      button.disabled = !scope?.modes.includes(button.dataset.mpListMode);
      button.setAttribute('aria-pressed', String(button.dataset.mpListMode === mode));
    }
    for (const section of panel.querySelectorAll('[data-mp-list-kind]')) section.hidden = section.dataset.mpListKind !== mode;
    const bullet = mode === 'bullet';
    const style = bullet ? state?.listMarker : state?.listCounterStyle;
    const sample = style === 'mixed' ? mixedLabel : (bullet ? style : listCounterStyles.find(([key]) => key === style)?.[1]) ?? '';
    const styleLabel = bullet ? 'Маркер' : 'Нумерация';
    setText(query('[data-mp-list-style-label]'), styleLabel);
    query('[data-mp-list-open=gallery]').setAttribute('aria-label', styleLabel);
    setText(query('[data-mp-list-style]'), sample);
    for (const current of panel.querySelectorAll('[data-mp-list-gallery-style]')) setText(current, sample);
    syncLibrary(state);
    for (const button of panel.querySelectorAll('[data-mp-list-key]')) {
      const {mpListKey:key, mpListValue:value} = button.dataset;
      button.disabled = !canChange(target, key);
      const selected = key === 'listStart' && state?.listStart === null ? 'auto' : state?.[key];
      button.setAttribute('aria-pressed', String(selected === 'mixed' ? 'mixed' : String(selected) === value));
    }
    syncColor(target);
    for (const row of panel.querySelectorAll('.mp-list-row:has(input)')) {
      const number = row.querySelector('input[type=number]');
      const slider = row.querySelector('input[type=range]');
      const key = number.dataset.mpListField;
      number.disabled = !canChange(target, key);
      if (slider) slider.disabled = number.disabled;
      if (!state || draft?.key === key) continue;
      const value = state[key], mixed = value === 'mixed';
      const scale = key === 'listMarkerScale', auto = value === 'auto' || key === 'listStart' && value === null;
      const inherited = value === 'inherit';
      const effective = scale ? listMarkerPercent(state) : key === 'listMarkerOpacity' ? state.opacity : value;
      const note = mixed ? mixedLabel : auto ?
        (scale ? `${autoLabel} · ${state.listMarker === 'mixed' && bullet ? mixedLabel : effective + '%'}` : autoLabel) :
        inherited ? inheritLabel : '';
      setText(query(`[data-mp-list-state="${key}"]`), note);
      number.value = mixed || auto || inherited ? '' : effective ?? '';
      number.placeholder = mixed || auto || inherited ? '—' : '';
      if (slider) {
        slider.value = mixed ? paragraphListDefaults[key] ?? (scale ? 100 : state.opacity) : effective;
        slider.setAttribute('aria-valuetext', note || String(effective));
      }
    }
  }

  function syncColor(target) {
    const state = target?.state, key = 'listMarkerColor';
    const allowed = canChange(target, key);
    const opener = query('[data-mp-list-open=color]'), hex = query(hexSelector);
    opener.disabled = hex.disabled = query(hueSelector).disabled = !allowed;
    const hint = query('#mp-list-color-hint');
    setText(hint, !state || allowed ? '' : state.solid ? 'Системный цвет эмодзи' : 'Нужна сплошная заливка');
    hint.hidden = !hint.textContent;
    const value = state?.[key], mixed = value === 'mixed', inherited = value === 'inherit';
    setText(query('[data-mp-list-state=listMarkerColor]'), mixed ? mixedLabel : inherited ? inheritLabel : '');
    query('[data-mp-list-color-sample]').style.background = allowed && !mixed ? state.color : '';
    if (draft?.key === key) return;
    const color = allowed && !mixed ? state.color : '';
    hex.value = allowed && !mixed && !inherited ? value : '';
    hex.placeholder = mixed ? mixedLabel : '#RRGGBB';
    const base = color || '#7857de';
    pickerHSV = colorToHSV(base);
    renderColor(base, pickerHSV);
  }

  async function refresh(action, marker) {
    const current = panel, target = readTarget();
    if (action) feedback('[data-mp-list-library-note]', '');
    try {
      const message = await library.change(action, marker);
      if (panel === current && sameTarget(target, readTarget())) feedback('[data-mp-list-library-note]', message);
    } catch {
      if (panel === current && sameTarget(target, readTarget())) {
        feedback('[data-mp-list-library-note]', action ? 'Изменение галереи не сохранено.' : 'Не удалось прочитать галерею маркеров.', true);
      }
    }
  }

  function cancel() {
    if (!draft) return;
    draft.cancelSlider?.();
    draft = null;
    sync();
  }

  function begin(field, key = field.dataset.mpListField) {
    const target = readTarget(mode);
    if (!canChange(target, key)) return;
    draft = {field, key, target, mode, revision: JSON.stringify(target.element), changed: false};
  }

  function currentDraft(field) {
    if (draft?.field !== field) return false;
    const target = readTarget(mode);
    if (!sameTarget(draft.target, target) || draft.mode !== mode || !canChange(target, draft.key) ||
        draft.revision !== JSON.stringify(target.element)) {
      cancel();
      return false;
    }
    return true;
  }

  function finish(field) {
    if (!currentDraft(field) || composing === field) return;
    const {target, key, changed} = draft;
    const value = draft.color ?? fieldValue(field);
    draft = null;
    if (changed && value !== undefined) apply(target, mode, key, value);
    sync();
  }

  function changeView(next, tab) {
    const body = query('.mp-body');
    const scrollKey = () => view + (selectedTabs[view] ?? '');
    scrollPositions.set(scrollKey(), body.scrollTop);
    cancel();
    view = next;
    if (tab) selectedTabs[view] = tab;
    sync();
    body.scrollTop = scrollPositions.get(scrollKey()) ?? 0;
  }

  function previewColor([hue, saturation, brightness]) {
    draft.color = hsvToColor(hue, saturation, brightness).toLowerCase();
    draft.changed = true;
    query(hexSelector).value = draft.color;
    renderColor(draft.color, [hue, saturation, brightness]);
  }

  function previewPlane(ev) {
    const {left, top, width, height} = draft.field.getBoundingClientRect();
    const fraction = value => Math.max(0, Math.min(1, value));
    previewColor([pickerHSV[0], fraction((ev.clientX - left) / width), 1 - fraction((ev.clientY - top) / height)]);
  }

  const isField = field => !!panel?.contains(field) && field.matches(fieldSelector);
  root.addEventListener('pointerdown', ev => {
    const field = ev.target;
    if (!panel?.contains(field) || ev.button !== 0) return;
    if (field.closest(navSelector)) {
      cancel();
      return;
    }
    const plane = field.closest(planeSelector);
    if (plane) {
      if (draft?.pointerId != null) return;
      if (draft) draft.field.blur();
      begin(plane, 'listMarkerColor');
      if (draft?.field !== plane) return;
      ev.preventDefault();
      draft.pointerId = ev.pointerId;
      plane.setPointerCapture(ev.pointerId);
      previewPlane(ev);
      return;
    }
    if (!isField(field) || field.type !== 'range') return;
    if (draft && draft.field !== field) draft.field.blur();
    begin(field);
  }, true);
  root.addEventListener('pointermove', ev => {
    if (draft?.pointerId === ev.pointerId && currentDraft(draft.field)) previewPlane(ev);
  });
  root.addEventListener('pointerup', ev => {
    if (draft?.pointerId === ev.pointerId) finish(draft.field);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) root.addEventListener(type, ev => {
    if (draft?.pointerId === ev.pointerId) cancel();
  });
  const sliderBlocked = previewSliderEvents(root, 'input[type=range][data-mp-list-field]', () => draft, cancel, finish);
  root.addEventListener('focusin', ev => {
    if (isField(ev.target) && ev.target.type !== 'range') begin(ev.target);
  });
  root.addEventListener('focusout', ev => {
    if (isField(ev.target) && ev.target.type !== 'range') finish(ev.target);
  });
  root.addEventListener('input', ev => {
    const field = ev.target;
    if (!panel?.contains(field)) return;
    if (field.matches(markerInputSelector)) {
      sync();
      return;
    }
    if (!isField(field) || sliderBlocked(field) || !currentDraft(field)) return;
    draft.changed = true;
    if (field.type !== 'range') return;
    const value = field.value;
    if (field.matches(hueSelector)) {
      previewColor([Number(value), pickerHSV[1] || 1, pickerHSV[2] || 1]);
      return;
    }
    field.setAttribute('aria-valuetext', value);
    query(`input[type=number][data-mp-list-field="${draft.key}"]`).value = value;
    query(`[data-mp-list-state="${draft.key}"]`).textContent = '';
  });
  root.addEventListener('change', ev => {
    if (isField(ev.target) && !sliderBlocked(ev.target, true)) finish(ev.target);
  });
  root.addEventListener('keydown', ev => {
    const field = ev.target;
    if (!panel?.contains(field) || ev.isComposing || composing === field) return;
    if (field.matches('[data-mp-list-tab]') && ['ArrowLeft','ArrowRight','Home','End'].includes(ev.key)) {
      const tabs = [...field.parentElement.querySelectorAll('[role=tab]')];
      const index = ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 :
        (tabs.indexOf(field) + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      ev.preventDefault();
      changeView(view, tabs[index].dataset.mpListTab);
      tabs[index].focus({preventScroll:true});
      return;
    }
    if (isField(field) && (!draft || draft.field !== field) && !['Enter','Escape','Tab'].includes(ev.key)) begin(field);
    if (ev.key === 'Enter' && (isField(field) || field.matches(markerInputSelector))) {
      ev.preventDefault();
      field.blur();
      ev.stopPropagation();
    }
  });
  for (const type of ['compositionstart','compositionend']) root.addEventListener(type, ev => {
    if (!panel?.contains(ev.target) || !ev.target.matches(`${fieldSelector},${markerInputSelector}`)) return;
    composing = type === 'compositionstart' ? ev.target : null;
    sync();
  });
  root.addEventListener('click', ev => {
    const button = ev.target.closest('button');
    if (!panel?.contains(button) || button.disabled) return;
    const {mpListMode:kind, mpListTab:tab, mpListOpen:next, mpListKey:key, mpListValue:value, mpListLibrary:action, marker} = button.dataset;
    if (tab || next) {
      changeView(next || view, tab);
      if (next) query('.mp-head strong').focus({preventScroll:true});
      return;
    }
    const scope = readTarget();
    if (kind && scope?.modes.includes(kind)) {
      cancel();
      mode = kind;
      sync();
      return;
    }
    const target = readTarget(mode);
    if (!target || !target.state) return;
    const markerInput = query(markerInputSelector);
    if (key && canChange(target, key)) apply(target, mode, key, key === 'listStart' ? null : value);
    if (mode === 'bullet' && button.hasAttribute('data-mp-list-apply') && composing !== markerInput &&
        validateListMarker(markerInput.value)) apply(target, mode, 'listMarker', markerInput.value);
    if (mode === 'bullet' && action) void refresh(action, marker ?? markerInput.value);
    sync();
  });
  // Abandon an unconfirmed value before a tap outside the sheet can blur it.
  document.addEventListener('pointerdown', ev => {
    if (panel && !panel.contains(ev.target)) cancel();
  }, true);
  window.addEventListener('blur', cancel);

  return {
    mount(node) {
      panel = node;
      mode = readTarget()?.modes[0] ?? 'bullet';
      composing = null;
      galleryVersion = null;
      view = 'settings';
      selectedTabs = {settings:'appearance', gallery:'presets'};
      scrollPositions = new Map();
      query('.mp-head strong').tabIndex = -1;
      sync();
      sheetSize.observe(panel);
      void refresh();
    },
    unmount() {
      cancel();
      sheetSize.disconnect();
      panel = null;
      composing = null;
    },
    sync,
    cancel,
    back() {
      if (!panel?.isConnected || view === 'settings') return false;
      const opener = query(`[data-mp-list-open="${view}"]`);
      changeView('settings');
      opener.focus({preventScroll:true});
      return true;
    },
    escape(field) {
      if (!panel?.contains(field) || !field.matches(`${fieldSelector},${markerInputSelector}`)) return false;
      if (composing === field) return true;
      cancel();
      field.blur();
      return true;
    },
  };
}
