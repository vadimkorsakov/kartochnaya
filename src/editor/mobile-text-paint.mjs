import {html} from '../core/primitives.mjs';
import {underlineLimits} from '../model/rich-text.mjs';

export const mobileTextPaintTitles = {
  underlineSettings: 'Подчёркивание',
  strokeSettings: 'Обводка текста',
  fillSettings: 'Прозрачность заливки',
};

const colorKeys = {underlineSettings:'underlineColor', strokeSettings:'stroke'};
const labels = {
  underlineThickness:'Толщина, px', underlineOffset:'Смещение, px',
  underlineOpacity:'Прозрачность, %', strokeWidth:'Толщина, px',
  strokeOpacity:'Прозрачность, %', fillOpacity:'Прозрачность, %',
};
const limits = {
  underlineThickness:underlineLimits.thickness, underlineOffset:underlineLimits.offset,
  underlineOpacity:underlineLimits.opacity, strokeWidth:{min:0,max:500,step:1},
  strokeOpacity:underlineLimits.opacity, fillOpacity:underlineLimits.opacity,
};
const fieldSelector = '[data-mp-paint-field]';
const mixed = 'Разные';

export function mobileColorFields({plane, hue, hex, preview}, hsv, color, placeholder = '#RRGGBB', extra = '') {
  const [h,s,v] = hsv;
  return `<div class="mp-color-plane" ${plane} style="background:hsl(${h} 100% 50%)"><div class="mp-color-cursor" style="left:${s*100}%;top:${(1-v)*100}%"></div></div>
    <div class="mp-color-gap"></div><input type="range" class="mp-hue" ${hue} min="0" max="359" value="${Math.min(359,Math.round(h))}" aria-label="Оттенок">
    <div class="mp-color-gap-small"></div><div class="mp-line mp-hex-row"><span class="mp-color-preview" ${preview} style="background:${color}"></span><input type="text" ${hex} placeholder="${placeholder}" value="${color}" maxlength="7" inputmode="text" aria-label="HEX цвет" autocapitalize="off" autocomplete="off" spellcheck="false" enterkeyhint="done">${extra}</div>`;
}

function choice(key, value, label, content = html(label), className = '') {
  return `<button type="button" class="${className}" data-mp-paint-key="${key}" data-mp-paint-value="${value}" aria-label="${label}" title="${label}" aria-pressed="false">${content}</button>`;
}

function numeric(key, shortcut = '') {
  const {min,max,step} = limits[key];
  const label = labels[key];
  const field = `data-mp-paint-field="${key}" min="${min}" max="${max}" aria-describedby="mp-paint-state-${key}"`;
  return `<div class="mp-list-row mp-list-range-row" data-mp-paint-row="${key}">
    <label for="mp-paint-${key}">${label}<small id="mp-paint-state-${key}"></small></label>
    <input type="range" ${field} step="${step}" aria-label="${label}, ползунок">
    <input id="mp-paint-${key}" type="number" ${field} step="any" inputmode="${label.endsWith('px')?'decimal':'numeric'}" enterkeyhint="done">
    ${shortcut}</div>`;
}

function segments(key, label, options, lines = false) {
  return `<div class="mp-list-row mp-list-range-row" data-mp-paint-row="${key}">
    <span>${label}<small data-mp-paint-note="${key}"></small></span>
    <div class="mp-paint-segments" role="group" aria-label="${label}">
    ${options.map(([value,name]) => choice(key,value,name,lines ? line(value) : html(name))).join('')}</div></div>`;
}

function line(style) {
  const path = style === 'wavy' ? 'M1 8Q5 1 9 8T17 8T25 8T33 8' : 'M1 8H33';
  const dash = {dotted:'1 4',dashed:'7 4'}[style];
  return `<svg viewBox="0 0 34 16" width="30" height="16" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`;
}

const switches = [['true','Вкл.'],['false','Выкл.']];
const shortcut = (key,value,label,text) => choice(key,value,label,text,'mp-list-shortcut');
const inherit = key => shortcut(key,'inherit',`${key === 'underlineColor' ? 'Цвет' : 'Прозрачность'} · Как у текста`,'↳');
const colorRow = (key, linked = false) => `<div class="mp-list-row mp-list-range-row" data-mp-paint-row="${key}">
  <span>Цвет<small data-mp-paint-note="${key}"></small></span>
  <button type="button" class="mp-list-opener" data-mp-paint-color aria-label="Выбрать цвет"><span class="mp-list-swatch"></span> <span aria-hidden="true">›</span></button>
  ${linked ? inherit(key) : ''}</div>`;

export function mobileTextPaintContent(tool) {
  const colorKey = colorKeys[tool];
  const underline = tool === 'underlineSettings';
  const form = underline ? [
    segments('underline','Подчёркивание',switches),
    segments('underlineStyle','Вид',[['solid','Сплошное'],['dotted','Точечное'],['wavy','Волнистое']],true),
    numeric('underlineThickness',shortcut('underlineThickness','auto','Толщина · Авто','Авто')),
    numeric('underlineOffset',shortcut('underlineOffset','auto','Смещение · Авто','Авто')),
    colorRow(colorKey,true),
    numeric('underlineOpacity',inherit('underlineOpacity')),
  ] : tool === 'strokeSettings' ? [
    segments('strokeEnabled','Обводка',switches),
    segments('strokeStyle','Вид',[['solid','Сплошная'],['dashed','Пунктирная'],['dotted','Точечная']],true),
    numeric('strokeWidth'),colorRow(colorKey),numeric('strokeOpacity'),
  ] : [numeric('fillOpacity')];
  return `<div class="mp-list-meta"><p data-mp-paint-target role="status"></p></div>
    <p class="mp-paint-hint" data-mp-paint-hint hidden></p>
    <fieldset class="mp-list-controls" data-mp-paint-settings>${form.join('')}</fieldset>
    ${colorKey ? `<fieldset class="mp-list-controls mp-paint-picker" data-mp-paint-picker hidden>${mobileColorFields({
      plane:'data-mp-paint-plane', hue:`data-mp-paint-field="${colorKey}"`, hex:`data-mp-paint-field="${colorKey}"`, preview:'data-mp-paint-preview',
    },[0,0,0],'')}</fieldset>` : ''}`;
}

const sameTarget = (a,b) => !!a && !!b && a.owner === b.owner && a.element === b.element &&
  a.range?.start === b.range?.start && a.range?.end === b.range?.end && a.range?.direction === b.range?.direction &&
  a.revision === b.revision;

export function createMobileTextPaint(root, {readTarget, apply, previewSliderEvents, colorToHSV, hsvToColor, repaint, resizeStage}) {
  let panel, tool, draft, picker, hsv, composing;
  const query = selector => panel.querySelector(selector);
  const read = () => readTarget(tool);
  const field = node => panel?.contains(node) && node.matches(fieldSelector);
  const colorKey = () => colorKeys[tool];
  const setText = (node,value) => { if (node && node.textContent !== value) node.textContent = value; };
  const observer = new ResizeObserver(() => { if (panel?.isConnected) resizeStage(); });
  const valid = target => {
    const current = read();
    return sameTarget(target,current) && !current.reason;
  };
  const note = (state,key) => {
    const value = state[key];
    if (value === 'inherit') return state[key+'Effective'] === 'mixed' ? 'Как у текста · '+mixed : 'Как у текста';
    return value === 'auto' ? 'Авто' : value === 'mixed' ? mixed : '';
  };

  function renderColor(color) {
    const plane = query('[data-mp-paint-plane]');
    const [h,s,v] = hsv;
    plane.style.background = `hsl(${h} 100% 50%)`;
    plane.firstElementChild.style.left = s*100+'%';
    plane.firstElementChild.style.top = (1-v)*100+'%';
    query('.mp-hue').value = Math.min(359,Math.round(h));
    query('[data-mp-paint-preview]').style.background = color;
  }

  function clear() {
    if (!draft) return false;
    const {field,pointer,cancelSlider,next} = draft;
    draft = null;
    cancelSlider?.();
    if (pointer != null && field.hasPointerCapture(pointer)) field.releasePointerCapture(pointer);
    return !!next;
  }

  function sync() {
    if (!panel?.isConnected) return;
    if (draft && !valid(draft.target) && clear()) repaint();
    const {state,reason,label,hint} = read() || {};
    const available = !!state && !reason;
    setText(query('[data-mp-paint-target]'),label || 'Цель форматирования изменилась.');
    const feedback = query('[data-mp-paint-hint]');
    setText(feedback,reason || hint || '');
    feedback.hidden = !feedback.textContent;
    for (const container of panel.querySelectorAll('fieldset')) container.disabled = !available;
    if (!state) return;
    for (const button of panel.querySelectorAll('[data-mp-paint-key]')) {
      const {mpPaintKey:key,mpPaintValue:value} = button.dataset;
      button.setAttribute('aria-pressed',state[key] === 'mixed' ? 'mixed' : String(String(state[key]) === value));
    }
    for (const entry of panel.querySelectorAll('[data-mp-paint-note]')) setText(entry,note(state,entry.dataset.mpPaintNote));
    for (const row of panel.querySelectorAll('[data-mp-paint-row]:has(input)')) {
      const number = row.querySelector('input[type=number]'), slider = row.querySelector('input[type=range]');
      const key = number.dataset.mpPaintField;
      if (draft?.key === key) continue;
      const value = state[key], caption = note(state,key), effective = state[key+'Effective'];
      setText(row.querySelector('small'),caption);
      number.value = typeof value === 'number' ? value : '';
      number.placeholder = caption ? '—' : '';
      const fallback = key === 'underlineThickness' ? 1 : key === 'underlineOffset' ? 0 : (Number(slider.min)+Number(slider.max))/2;
      slider.value = typeof value === 'number' ? value : typeof effective === 'number' ? effective : fallback;
      slider.setAttribute('aria-valuetext',caption || String(value));
    }
    if (!colorKey()) return;
    const effective = state[colorKey()+'Effective'];
    const different = state[colorKey()] === 'mixed' || effective === 'mixed';
    query('[data-mp-paint-color] .mp-list-swatch').style.background = different ? '' : effective;
    if (draft?.key === colorKey()) return;
    const color = different ? '#7857de' : effective;
    const hex = query('.mp-hex-row input');
    hex.value = different ? '' : color;
    hex.placeholder = different ? mixed : '#RRGGBB';
    hsv = colorToHSV(color);
    renderColor(color);
  }

  function cancel() {
    if (clear()) repaint();
    sync();
  }

  function begin(node,key = node.dataset.mpPaintField) {
    if (draft?.field === node) return;
    cancel();
    const target = read();
    if (target?.state && !target.reason) draft = {field:node,key,target};
  }

  function update(value) {
    if (!draft || !valid(draft.target)) { cancel(); return; }
    draft.value = value;
    draft.next = value === undefined ? null : apply(draft.target,draft.key,value);
    repaint();
  }

  function finish(node) {
    if (draft?.field !== node || composing === node) return;
    const {target,key,value} = draft;
    const canCommit = valid(target) && value !== undefined;
    clear();
    if (canCommit) apply(target,key,value,true);
    sync();
    repaint();
  }

  function colorAt(next) {
    hsv = next;
    const color = hsvToColor(...hsv).toLowerCase();
    query('.mp-hex-row input').value = color;
    renderColor(color);
    update(color);
  }

  function planeAt(ev) {
    const {left,top,width,height} = draft.field.getBoundingClientRect();
    const clamp = value => Math.min(1,Math.max(0,value));
    colorAt([hsv[0],clamp((ev.clientX-left)/width),1-clamp((ev.clientY-top)/height)]);
  }

  function changeView(showColor) {
    cancel();
    picker = showColor;
    const title = picker ? (tool === 'underlineSettings' ? 'Цвет подчёркивания' : 'Цвет обводки') : mobileTextPaintTitles[tool];
    panel.setAttribute('aria-label',title);
    setText(query('.mp-head strong'),title);
    query('[data-mp-paint-settings]').hidden = picker;
    query('[data-mp-paint-picker]').hidden = !picker;
    query('.mp-body').scrollTop = 0;
    query(picker ? '.mp-head strong' : '[data-mp-paint-color]').focus({preventScroll:true});
  }

  root.addEventListener('pointerdown',ev => {
    if (!panel?.contains(ev.target) || ev.button !== 0) return;
    if (ev.target.closest('button')) { cancel(); return; }
    const plane = ev.target.closest('[data-mp-paint-plane]');
    if (plane) {
      if (draft?.pointer != null) return;
      begin(plane,colorKey());
      if (draft?.field !== plane) return;
      ev.preventDefault();
      draft.pointer = ev.pointerId;
      plane.setPointerCapture(ev.pointerId);
      planeAt(ev);
    } else if (field(ev.target) && ev.target.type === 'range') begin(ev.target);
  },true);
  root.addEventListener('pointermove',ev => { if (draft?.pointer === ev.pointerId) planeAt(ev); });
  root.addEventListener('pointerup',ev => { if (draft?.pointer === ev.pointerId) finish(draft.field); });
  for (const type of ['pointercancel','lostpointercapture']) root.addEventListener(type,ev => {
    if (draft?.pointer === ev.pointerId) cancel();
  });
  const blocked = previewSliderEvents(root,`input[type=range]${fieldSelector}`,() => draft,cancel,finish);
  root.addEventListener('focusin',ev => { if (field(ev.target) && ev.target.type !== 'range') begin(ev.target); });
  root.addEventListener('focusout',ev => { if (field(ev.target) && ev.target.type !== 'range') finish(ev.target); });
  root.addEventListener('keydown',ev => {
    const node = ev.target;
    if (!field(node) || ev.isComposing || composing === node) return;
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); finish(node); node.blur(); }
    else if (node.type === 'range' && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(ev.key)) begin(node);
  });
  root.addEventListener('input',ev => {
    const node = ev.target;
    if (!field(node) || blocked(node) || draft?.field !== node || composing === node) return;
    if (node.matches('.mp-hue')) { colorAt([node.valueAsNumber,hsv[1] || 1,hsv[2] || 1]); return; }
    if (node.type === 'text') {
      const color = node.value.toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(color)) { update(undefined); return; }
      hsv = colorToHSV(color);
      renderColor(color);
      update(color);
      return;
    }
    const value = node.validity.valid && node.value !== '' ? node.valueAsNumber : undefined;
    const row = node.closest('[data-mp-paint-row]');
    if (value !== undefined) {
      row.querySelector(node.type === 'range' ? 'input[type=number]' : 'input[type=range]').value = value;
      row.querySelector('small').textContent = '';
      row.querySelector('input[type=range]').setAttribute('aria-valuetext',String(value));
    }
    update(value);
  });
  root.addEventListener('change',ev => { if (field(ev.target) && !blocked(ev.target,true)) finish(ev.target); });
  root.addEventListener('compositionstart',ev => { if (field(ev.target)) composing = ev.target; });
  root.addEventListener('compositionend',ev => {
    if (composing !== ev.target) return;
    composing = null;
    ev.target.dispatchEvent(new Event('input',{bubbles:true}));
  });
  root.addEventListener('click',ev => {
    const button = ev.target.closest('[data-mp-paint-key],[data-mp-paint-color]');
    if (!panel?.contains(button)) return;
    const target = read();
    if (!target?.state || target.reason) return;
    if (button.hasAttribute('data-mp-paint-color')) { changeView(true); return; }
    const {mpPaintKey:key,mpPaintValue:value} = button.dataset;
    apply(target,key,value === 'true' ? true : value === 'false' ? false : value,true);
    sync();
  });
  document.addEventListener('pointerdown',ev => { if (panel && !panel.contains(ev.target)) cancel(); },true);
  window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',() => { if (document.hidden) cancel(); });

  return {
    mount(node,name) {
      panel = node; tool = name; picker = false;
      query('.mp-head strong').tabIndex = -1;
      sync();
      observer.observe(panel);
    },
    unmount() {
      const repaintNeeded = clear();
      panel = null; composing = null;
      observer.disconnect();
      if (repaintNeeded) repaint();
    },
    preview() { return draft?.next && valid(draft.target) ? draft.next : null; },
    sync,cancel,
    back() {
      cancel();
      if (!panel?.isConnected || !picker) return false;
      changeView(false);
      return true;
    },
    escape(node) {
      if (!field(node)) return false;
      if (composing !== node) { cancel(); node.blur(); }
      return true;
    },
  };
}
