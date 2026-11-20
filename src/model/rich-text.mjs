// Sparse UTF-16 overrides. The only text is element.text; textAlign remains
// a layer property. lineHeight is a positive, dimensionless character override.
const blocked = new Set(['__proto__', 'constructor', 'prototype', 'textAlign']);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function jsonValue(v, depth = 0) {
  if (depth > 16) return undefined;
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
  if (Array.isArray(v)) {
    const out = v.map(x => jsonValue(x, depth + 1));
    return out.some(x => x === undefined) ? undefined : out;
  }
  if (record(v)) {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (blocked.has(k)) continue;
      const value = jsonValue(v[k], depth + 1);
      if (value !== undefined) out[k] = value;
    }
    return out;
  }
}
export const underlineLimits = {
  thickness: {min: .5, max: 32, step: .5},
  offset: {min: -32, max: 64, step: .5},
  opacity: {min: 0, max: 100, step: 1},
};
export const underlineDefaults = {style: 'solid', thickness: 'auto', offset: 'auto', color: 'inherit', opacity: 'inherit'};
const underlineFields = Object.keys(underlineDefaults);

export const isBaselineShift = value => value === 'normal' || value === 'sub' || value === 'super';

export function sanitizeUnderlineDetails(value) {
  if (!record(value)) return {};
  const details = jsonValue(value);
  for (const key of underlineFields) {
    const field = details[key];
    if (key === 'style') {
      if (!['solid', 'dotted', 'wavy'].includes(field)) delete details[key];
    } else if (key === 'color') {
      if (field === 'inherit') continue;
      if (typeof field !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(field)) delete details[key];
      else details[key] = field.toLowerCase().replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3');
    } else if (field !== underlineDefaults[key]) {
      const {min,max} = underlineLimits[key];
      if (!Number.isFinite(field) || field < min || field > max) delete details[key];
    }
  }
  return details;
}
function mergeTextStyle(target, source) {
  if (!source) return target;
  const {underlineDetails, ...other} = source;
  Object.assign(target, other);
  if (underlineDetails) target.underlineDetails = {...target.underlineDetails, ...underlineDetails};
  return target;
}
function patchUnderlineDetails(target, patch) {
  const details = {...sanitizeUnderlineDetails(target.underlineDetails), ...sanitizeUnderlineDetails(patch)};
  for (const key of underlineFields) if (patch?.[key] === null) delete details[key];
  if (Object.keys(details).length) target.underlineDetails = details;
  else delete target.underlineDetails;
}
export function resolveUnderlineDetails(base, override) {
  const merged = {...sanitizeUnderlineDetails(base), ...sanitizeUnderlineDetails(override)};
  return Object.fromEntries(underlineFields.filter(key => Object.hasOwn(merged,key)).map(key => [key,merged[key]]));
}

const stable = value => JSON.stringify(value, (_, v) => record(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const equal = (a, b) => { try { return stable(a) === stable(b); } catch { return false; } };
function styleData(value, base = {}) {
  if (!record(value)) return {};
  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (blocked.has(k)) continue;
    if (k === 'baselineShift') {
      if (isBaselineShift(value[k])) out[k] = value[k];
      continue;
    }
    if (k === 'underlineDetails') {
      const details = sanitizeUnderlineDetails(value[k]);
      if (Object.keys(details).length) out[k] = details;
      continue;
    }
    const v = jsonValue(value[k]);
    if (v === undefined || v === null) continue;
    if (['fontFamily', 'fontStyle', 'textColor', 'fontWeight'].includes(k) && typeof v !== 'string') continue;
    if (['fontSize', 'lineHeight'].includes(k) && !(typeof v === 'number' && v > 0)) continue;
    if (['fillOpacity', 'strokeOpacity'].includes(k) && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)) continue;
    if (k === 'strokeStyle' && !['solid', 'dashed', 'dotted'].includes(v)) continue;
    if (k === 'strokeWidth' && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) continue;
    if (k === 'stroke' && !(typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v))) continue;
    if (['bold', 'italic', 'underline', 'strikethrough'].includes(k) && typeof v !== 'boolean') continue;
    // Run sizes stay in the original reference units after mixed-text fitting.
    let inherited = base[k];
    if (k === 'underline') inherited = base.underline ?? base.mobileUnderline;
    if (k === 'strikethrough') inherited = base.strikethrough ?? base.mobileStrike;
    if (k === 'fontSize' && Number.isFinite(base.textRunsBaseFontSize) && base.textRunsBaseFontSize > 0) inherited = base.textRunsBaseFontSize;
    if ((k === 'bold' && base.fontWeight) || (k === 'italic' && base.fontStyle)) inherited = undefined;
    // A base-equal explicit key still wins over a conflicting run alias.
    const alias = k === 'fontWeight' ? 'bold' : k === 'fontStyle' ? 'italic' : null;
    // Explicit paint overrides survive later layer edits, even when they
    // currently equal the inherited value (including opacity 0 and 100).
    if (k === 'strokeWidth' || k === 'stroke' || k === 'fillOpacity' || k === 'strokeOpacity' || k === 'strokeStyle') out[k] = k === 'stroke' ?
      (v.length === 4 ? '#'+v.slice(1).split('').map(c=>c+c).join('') : v).toLowerCase() : v;
    else if (!equal(v, inherited) || alias && typeof value[alias] === 'boolean') out[k] = v;
  }
  return out;
}
const insidePair = (text, i) => i > 0 && i < text.length && /[\uD800-\uDBFF]/.test(text[i - 1]) && /[\uDC00-\uDFFF]/.test(text[i]);
function boundary(text, i, right = false) {
  i = Math.max(0, Math.min(text.length, Number.isFinite(i) ? Math.trunc(i) : 0));
  return insidePair(text, i) ? i + (right ? 1 : -1) : i;
}
function selection(text, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [0, 0];
  const a = boundary(text, start);
  return [a, start === end ? a : boundary(text, end, true)];
}
function append(out, start, end, style) {
  if (start >= end || !Object.keys(style).length) return;
  const prev = out.at(-1);
  if (prev && prev.end === start && equal(prev.style, style)) prev.end = end;
  else out.push({ start, end, style });
}
/** Repairs saved data without mutation. Later entries override overlapping keys. */
export function normalizeRuns(text, runs, base = {}) {
  if (!Array.isArray(runs)) return [];
  const valid = [];
  for (const r of runs) {
    if (!record(r) || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start >= r.end) continue;
    const [start, end] = selection(text, r.start, r.end);
    const style = styleData(r.style); // Keep base-equal overlap until all entries are resolved.
    if (start < end && Object.keys(style).length) valid.push({ start, end, style });
  }
  const points = [...new Set(valid.flatMap(r => [r.start, r.end]))].sort((a, b) => a - b), out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i + 1], style = {};
    for (const r of valid) if (r.start <= start && r.end >= end) mergeTextStyle(style, r.style);
    append(out, start, end, styleData(style, base));
  }
  return out;
}
export function validateRuns(text, runs, base = {}) {
  return runs === undefined || (Array.isArray(runs) && equal(runs, normalizeRuns(text, runs, base)));
}
function withRuns(element, text, runs) {
  const result = { ...element, text };
  if (runs.length) result.textRuns = runs;
  else delete result.textRuns;
  return result;
}
/** null removes one override; omitted keys are unchanged. Empty selection is a no-op. */
export function applyTextStyle(element, start, end, patch, {preserveOverrides = false} = {}) {
  const base = preserveOverrides || Object.hasOwn(patch || {}, 'underlineDetails') ? {} : element;
  const text = element.text, runs = normalizeRuns(text, element.textRuns, base);
  [start, end] = selection(text, start, end);
  const points = [...new Set([0, text.length, start, end, ...runs.flatMap(r => [r.start, r.end])])].sort((a, b) => a - b), out = [];
  const clean = styleData(patch);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const style = { ...runs.find(r => r.start <= a && r.end >= b)?.style };
    if (a >= start && b <= end) {
      mergeTextStyle(style, clean);
      if (record(patch?.underlineDetails)) patchUnderlineDetails(style, patch.underlineDetails);
      for (const k of Object.keys(patch || {})) if (patch[k] === null) delete style[k];
    }
    append(out, a, b, styleData(style, base));
  }
  return withRuns(element, text, out);
}
/** Layer commands replace only the fields they edit, including run overrides. */
export function applyLayerUnderlineStyle(element, patch) {
  const reset = {};
  if (typeof patch.underline === 'boolean') reset.underline = null;
  const details = sanitizeUnderlineDetails(patch.underlineDetails);
  if (Object.keys(details).length) reset.underlineDetails = Object.fromEntries(Object.keys(details).map(key => [key,null]));
  const next = applyTextStyle(element, 0, element.text.length, reset, {preserveOverrides:true});
  if (Object.hasOwn(reset, 'underline')) {
    next.underline = patch.underline;
    next.mobileUnderline = patch.underline;
  }
  if (reset.underlineDetails) patchUnderlineDetails(next, details);
  return next;
}
/** A single baseline command preserves all unrelated explicit overrides. */
export function applyBaselineShift(element, value, range = null) {
  if (!isBaselineShift(value)) return element;
  const inherited = isBaselineShift(element.baselineShift) ? element.baselineShift : 'normal';
  if (range) {
    const [start, end] = selection(element.text, range.start, range.end);
    if (start === end || effectiveTextStyles(element, start, end).every(s => s.style.baselineShift === value)) return element;
    return applyTextStyle(element, start, end, {baselineShift: value === inherited ? null : value}, {preserveOverrides:true});
  }
  const runs = normalizeRuns(element.text, element.textRuns);
  if (inherited === value && !runs.some(r => Object.hasOwn(r.style, 'baselineShift') && r.style.baselineShift !== value)) return element;
  const next = applyTextStyle(element, 0, element.text.length, {baselineShift:null}, {preserveOverrides:true});
  if (value === 'normal') delete next.baselineShift;
  else next.baselineShift = value;
  return next;
}
export function clearTextFormatting(element) {
  const result = withRuns(element, element.text, []);
  delete result.baselineShift;
  delete result.textRunsBaseFontSize;
  delete result.textLayoutMode;
  delete result.mobileRawTextRuns; delete result.mobileListRawTextRuns;
  return result;
}
/** Includes unformatted gaps. A mixed selection returns multiple effective segments. */
export function effectiveTextStyles(element, start = 0, end = element.text.length) {
  [start, end] = selection(element.text, start, end);
  const runs = normalizeRuns(element.text, element.textRuns, element);
  const points = [...new Set([start, end, ...runs.flatMap(r => [r.start, r.end]).filter(i => i > start && i < end)])].sort((a, b) => a - b);
  const base = styleData(Object.fromEntries(Object.entries(element).filter(([k]) =>
    ['fontFamily','fontWeight','fontStyle','fontVariant','fontSize','lineHeight','textColor','fillOpacity','strokeOpacity','strokeStyle','strokeWidth','stroke','bold','italic','underline','underlineDetails','strikethrough','strikethroughDetails','mobileUnderline','mobileStrike','letterSpacing','baselineShift','fontFeatures','fontVariationSettings'].includes(k) || runs.some(r => Object.hasOwn(r.style,k)))));
  base.strokeStyle ??= 'solid';
  base.baselineShift ??= 'normal';
  return points.slice(0, -1).map((a, i) => ({ start: a, end: points[i + 1], style: mergeTextStyle({...base}, runs.find(r => r.start <= a && r.end > a)?.style) }));
}
export function effectiveTextStyleAt(element, index) {
  const start = boundary(element.text, index);
  return effectiveTextStyles(element, start, boundary(element.text, start + 1, true))[0]?.style || {};
}
/** Insert inherits the left character (right at offset zero); replacement inherits
 * the first replaced character. Deletions expand to whole surrogate pairs. */
export function replaceText(element, start, end, inserted = '') {
  const old = element.text;
  [start, end] = selection(old, start, end);
  const runs = normalizeRuns(old, element.textRuns, element), delta = inserted.length - (end - start);
  const at = start === end && start > 0 ? start - 1 : start;
  const inherited = runs.find(r => r.start <= at && r.end > at)?.style || {};
  const text = old.slice(0, start) + inserted + old.slice(end), out = [];
  for (const r of runs) if (r.start < start) append(out, r.start, Math.min(r.end, start), r.style);
  append(out, start, start + inserted.length, inherited);
  for (const r of runs) if (r.end > end) append(out, Math.max(r.start, end) + delta, r.end + delta, r.style);
  return withRuns(element, text, normalizeRuns(text, out, element));
}
/** Reconcile textarea/IME/autocorrect values. A pre-input selection disambiguates
 * repeated text; fallback is the smallest single replacement, safe for UTF-16. */
export function updateText(element, text, hint) {
  const old = element.text;
  if (text === old) return element;
  if (!element.textRuns) return { ...element, text }; // Legacy plain text stays plain.
  let start = 0, end = old.length, newEnd = text.length;
  if (hint && Number.isInteger(hint.start) && Number.isInteger(hint.end) && hint.start >= 0 && hint.end >= hint.start && hint.end <= old.length) {
    const n = text.length - (old.length - hint.end);
    if (n >= hint.start && old.slice(0, hint.start) === text.slice(0, hint.start) && old.slice(hint.end) === text.slice(n)) {
      start = hint.start; end = hint.end; newEnd = n;
    } else hint = null;
  } else hint = null;
  if (!hint) {
    while (start < old.length && start < text.length && old[start] === text[start]) start++;
    start = Math.min(boundary(old, start), boundary(text, start));
    while (end > start && newEnd > start && old[end - 1] === text[newEnd - 1]) { end--; newEnd--; }
    while (insidePair(old, end) || insidePair(text, newEnd)) { end++; newEnd++; }
  }
  const result = replaceText(element, start, end, text.slice(start, newEnd));
  // Browser values are canonical, including unusual programmatic selections.
  return result.text === text ? result : withRuns(element, text, normalizeRuns(text, result.textRuns, element));
}
/** Mapping by code point preserves styles across length-changing case conversions. */
export function transformText(element, transform) {
  let result = element, offset = 0, sourceOffset = 0;
  for (const char of element.text) {
    const next = transform(char, sourceOffset);
    result = replaceText(result, offset, offset + char.length, next);
    offset += next.length; sourceOffset += char.length;
  }
  return result;
}

/** Split into two lists at a safe offset; indices remain relative to element.text. */
export function splitTextRuns(element, offset) {
  offset = boundary(element.text, offset);
  const runs = normalizeRuns(element.text, element.textRuns, element);
  return {
    left: runs.filter(r => r.start < offset).map(r => ({ ...r, end: Math.min(r.end, offset) })),
    right: runs.filter(r => r.end > offset).map(r => ({ ...r, start: Math.max(r.start, offset) })),
  };
}
export function removeTextStyle(element, start, end, keys) {
  return applyTextStyle(element, start, end, Object.fromEntries(keys.map(k => [k, null])));
}

// Session-only snapshots accompany the browser's native (possibly grouped) undo.
// They are never another persisted source of text and are released on editor close.
const editSnapshot = element => ({ text: element.text, textRuns: normalizeRuns(element.text, element.textRuns, element) });
export function createTextEditHistory(element) {
  return { states: [editSnapshot(element)], index: 0 };
}
export function editTextWithHistory(element, history, text, { selection: hint, inputType } = {}) {
  const direction = inputType === 'historyUndo' ? -1 : inputType === 'historyRedo' ? 1 : 0;
  if (direction) {
    for (let i = history.index + direction; i >= 0 && i < history.states.length; i += direction) {
      const state = history.states[i];
      if (state.text === text) return {
        element: withRuns(element, text, normalizeRuns(text, state.textRuns, element)),
        history: { states: history.states, index: i },
      };
    }
  }
  const next = updateText(element, text, hint);
  if (next === element) return { element, history };
  const states = [...history.states.slice(0, history.index + 1), editSnapshot(next)];
  return { element: next, history: { states, index: states.length - 1 } };
}
