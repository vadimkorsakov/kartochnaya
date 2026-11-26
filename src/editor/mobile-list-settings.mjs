import {html} from '../core/primitives.mjs';
import {paragraphListDefaults, paragraphListLimits, paragraphListMinimums} from '../model/paragraph-style.mjs';
import {listCounterStyles, listMarkerGroups, listMarkerPercent, validateListMarker} from '../model/list-presets.mjs';

const fieldSelector = '[data-mp-list-field]';
const markerInputSelector = '[data-mp-list-custom]';
const kinds = [['bullet', 'Маркеры'], ['ordered', 'Нумерация']];
const spacing = [
  ['listIndent', 'Отступ слева'],
  ['listGap', 'Между маркером и текстом'],
  ['listItemSpacing', 'Между пунктами'],
];
const paintKeys = ['listMarkerColor', 'listMarkerOpacity'];
const colors = ['#000000', '#ffffff', '#7857de', '#d4fc15'];

function choice(key, value, label, content = html(label)) {
  return `<button type="button" data-mp-list-key="${key}" data-mp-list-value="${html(value)}" aria-label="${html(label)}" aria-pressed="false">${content}</button>`;
}

function numeric(key, label, {unit = '', sliderMax, shortcut} = {}) {
  const min = paragraphListMinimums[key] ?? 0;
  const max = paragraphListLimits[key];
  const field = `data-mp-list-field="${key}" min="${min}"`;
  return `<div class="mp-list-property">
    <div class="mp-list-property-label">${label}${unit ? ', ' + unit : ''}<small data-mp-list-state="${key}"></small></div>
    ${sliderMax ? `<input type="range" ${field} max="${sliderMax}" step="1" aria-label="${label}, ползунок">` : ''}
    <div class="mp-list-fields">
      <input type="number" ${field} aria-label="${label}${unit ? ', ' + unit : ''}" max="${max}" step="${unit === 'px' ? 'any' : 1}" inputmode="${unit === 'px' ? 'decimal' : 'numeric'}" enterkeyhint="done">
      ${shortcut ?? ''}
    </div>
  </div>`;
}

export function mobileListSettingsContent() {
  return `<p class="mp-text-selection" data-mp-list-target role="status"></p>
    <div class="mp-grid two" role="group" aria-label="Тип списка">
      ${kinds.map(([kind, label]) => `<button type="button" data-mp-list-mode="${kind}" aria-pressed="false">${label}</button>`).join('')}
    </div>
    <fieldset class="mp-list-controls">
      <details open>
        <summary>Вид списка <bdi data-mp-list-style></bdi></summary>
        <div data-mp-list-kind="bullet">
          ${listMarkerGroups.map(({label, markers}, index) => `<details class="mp-list-preset-group" ${index === 0 ? 'open' : ''}>
            <summary>${label}</summary>
            <div class="mp-list-presets">${markers.map(([marker, name]) => choice('listMarker', marker, name, marker)).join('')}</div>
          </details>`).join('')}
        </div>
        <div data-mp-list-kind="ordered">
          <div class="mp-grid two mp-list-counters">
            ${listCounterStyles.map(([key, label]) => choice('listCounterStyle', key, label)).join('')}
          </div>
          ${numeric('listStart', 'Начальный номер', {shortcut: choice('listStart', 'auto', 'Auto')})}
        </div>
      </details>
      <details>
        <summary>Размер и цвет</summary>
        ${numeric('listMarkerScale', 'Размер маркера', {unit: '%', sliderMax: paragraphListLimits.listMarkerScale,
          shortcut: choice('listMarkerScale', 'auto', 'Auto')})}
        <div class="mp-list-property">
          <div class="mp-list-property-label">Цвет маркера <small data-mp-list-state="listMarkerColor"></small></div>
          <div class="mp-list-fields">
            <input type="text" data-mp-list-field="listMarkerColor" aria-label="Цвет маркера HEX" placeholder="#RRGGBB" autocapitalize="off" autocomplete="off" spellcheck="false" enterkeyhint="done">
            ${choice('listMarkerColor', 'inherit', 'Как у текста')}
          </div>
          <div class="mp-grid four mp-list-swatches" role="group" aria-label="Цвета маркера">
            ${colors.map(color => choice('listMarkerColor', color, color, `<span style="background:${color}"></span>`)).join('')}
          </div>
        </div>
        ${numeric('listMarkerOpacity', 'Непрозрачность маркера', {unit: '%', sliderMax: paragraphListLimits.listMarkerOpacity,
          shortcut: choice('listMarkerOpacity', 'inherit', 'Как у текста')})}
        <p data-mp-list-color-hint hidden></p>
      </details>
      <details>
        <summary>Интервалы</summary>
        ${spacing.map(([key, label]) => numeric(key, label, {unit: 'px', sliderMax: Math.min(120, paragraphListLimits[key])})).join('')}
      </details>
      <details data-mp-list-kind="bullet">
        <summary>Мои маркеры</summary>
        <div class="mp-list-fields">
          <input type="text" data-mp-list-custom aria-label="Пользовательский маркер" placeholder="Один символ или эмодзи" autocomplete="off" spellcheck="false" enterkeyhint="done">
          <bdi class="mp-list-custom-preview" data-mp-list-custom-preview aria-label="Предпросмотр маркера"></bdi>
        </div>
        <p data-mp-list-input-note role="status" hidden></p>
        <div class="mp-grid two">
          <button type="button" data-mp-list-library="add">Добавить</button>
          <button type="button" data-mp-list-apply>Применить</button>
        </div>
        <p data-mp-list-library-note role="status" hidden></p>
        <div data-mp-list-gallery></div>
      </details>
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

export function createMobileListSettings(root, {readTarget, apply, library, validateMarkerInput, previewSliderEvents}) {
  let panel, mode, draft, composing = null;
  let galleryVersion;
  const query = selector => panel.querySelector(selector);

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
    setText(query('[data-mp-list-target]'), scope?.label || 'Цель форматирования изменилась.');
    query('.mp-list-controls').disabled = !state;
    for (const button of panel.querySelectorAll('[data-mp-list-mode]')) {
      button.disabled = !scope?.modes.includes(button.dataset.mpListMode);
      button.setAttribute('aria-pressed', String(button.dataset.mpListMode === mode));
    }
    for (const section of panel.querySelectorAll('[data-mp-list-kind]')) section.hidden = section.dataset.mpListKind !== mode;
    const style = mode === 'bullet' ? state?.listMarker : state?.listCounterStyle;
    query('[data-mp-list-style]').textContent = style === 'mixed' ? 'Mixed' :
      (mode === 'bullet' ? style : listCounterStyles.find(([key]) => key === style)?.[1]) ?? '';
    syncLibrary(state);
    for (const button of panel.querySelectorAll('[data-mp-list-key]')) {
      const {mpListKey:key, mpListValue:value} = button.dataset;
      button.disabled = !canChange(target, key);
      const selected = state?.[key];
      button.setAttribute('aria-pressed', String(selected === 'mixed' ? 'mixed' : (selected === null ? 'auto' : String(selected)) === value));
    }
    const hint = query('[data-mp-list-color-hint]');
    hint.hidden = !state || state.solid && !state.emoji;
    hint.textContent = state?.solid ? 'Цвет эмодзи задаёт системный шрифт.' : 'Цвет и непрозрачность доступны при сплошной заливке текста.';
    for (const field of panel.querySelectorAll(fieldSelector)) {
      const key = field.dataset.mpListField;
      field.disabled = !canChange(target, key);
      if (!state || draft?.key === key) continue;
      const value = state[key], mixed = value === 'mixed';
      const scale = key === 'listMarkerScale', auto = value === 'auto' || key === 'listStart' && value === null;
      const inherited = value === 'inherit';
      const effective = scale ? listMarkerPercent(state) : key === 'listMarkerOpacity' ? state.opacity : value;
      const note = mixed ? 'Mixed' : auto ? (scale ? `Auto · ${state.listMarker === 'mixed' && mode === 'bullet' ? 'Mixed' : effective + '%'}` : 'Auto') :
        inherited ? 'Inherited' : '';
      setText(query(`[data-mp-list-state="${key}"]`), note);
      if (field.type === 'range') {
        field.value = mixed ? paragraphListDefaults[key] ?? (scale ? 100 : state.opacity) : effective;
        field.setAttribute('aria-valuetext', note || String(effective));
      } else {
        field.value = mixed || auto || inherited ? '' : effective ?? '';
        field.placeholder = mixed ? 'Mixed' : auto ? 'Auto' : inherited ? 'Inherited' : field.type === 'text' ? '#RRGGBB' : '';
      }
    }
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

  function begin(field) {
    const key = field.dataset.mpListField;
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
    const value = fieldValue(field);
    draft = null;
    if (changed && value !== undefined) apply(target, mode, key, value);
    sync();
  }

  const isField = field => !!panel?.contains(field) && field.matches(fieldSelector);
  root.addEventListener('pointerdown', ev => {
    const field = ev.target;
    if (ev.button !== 0 || !isField(field) || field.type !== 'range') return;
    if (draft && draft.field !== field) draft.field.blur();
    begin(field);
  }, true);
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
    const {mpListMode:kind, mpListKey:key, mpListValue:value, mpListLibrary:action, marker} = button.dataset;
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
      sync();
      void refresh();
    },
    unmount() {
      cancel();
      panel = null;
      composing = null;
    },
    sync,
    cancel,
    escape(field) {
      if (!panel?.contains(field) || !field.matches(`${fieldSelector},${markerInputSelector}`)) return false;
      if (composing === field) return true;
      cancel();
      field.blur();
      return true;
    },
  };
}
