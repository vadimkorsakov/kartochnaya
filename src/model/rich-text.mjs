// Sparse UTF-16 overrides. The only text is element.text; lineHeight/textAlign
// belong to the layer (a future paragraph model), never to character runs.
const blocked = new Set(['__proto__', 'constructor', 'prototype', 'lineHeight', 'textAlign']);
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
const stable = value => JSON.stringify(value, (_, v) => record(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const equal = (a, b) => { try { return stable(a) === stable(b); } catch { return false; } };
function styleData(value, base = {}) {
  if (!record(value)) return {};
  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (blocked.has(k)) continue;
    const v = jsonValue(value[k]);
    if (v === undefined || v === null) continue;
    if (['fontFamily', 'fontStyle', 'textColor', 'fontWeight'].includes(k) && typeof v !== 'string') continue;
    if (k === 'fontSize' && !(typeof v === 'number' && v > 0)) continue;
    if (['bold', 'italic', 'underline', 'strikethrough'].includes(k) && typeof v !== 'boolean') continue;
    if (!equal(v, base[k])) out[k] = v;
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
    for (const r of valid) if (r.start <= start && r.end >= end) Object.assign(style, r.style);
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
export function applyTextStyle(element, start, end, patch) {
  const text = element.text, runs = normalizeRuns(text, element.textRuns, element);
  [start, end] = selection(text, start, end);
  const points = [...new Set([0, text.length, start, end, ...runs.flatMap(r => [r.start, r.end])])].sort((a, b) => a - b), out = [];
  const clean = styleData(patch);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const style = { ...runs.find(r => r.start <= a && r.end >= b)?.style };
    if (a >= start && b <= end) {
      Object.assign(style, clean);
      for (const k of Object.keys(patch || {})) if (patch[k] === null) delete style[k];
    }
    append(out, a, b, styleData(style, element));
  }
  return withRuns(element, text, out);
}
export function clearTextFormatting(element) {
  const result = withRuns(element, element.text, []);
  delete result.mobileRawTextRuns; delete result.mobileListRawTextRuns;
  return result;
}
/** Includes unformatted gaps. A mixed selection returns multiple effective segments. */
export function effectiveTextStyles(element, start = 0, end = element.text.length) {
  [start, end] = selection(element.text, start, end);
  const runs = normalizeRuns(element.text, element.textRuns, element);
  const points = [...new Set([start, end, ...runs.flatMap(r => [r.start, r.end]).filter(i => i > start && i < end)])].sort((a, b) => a - b);
  const base = styleData(Object.fromEntries(Object.entries(element).filter(([k]) =>
    ['fontFamily','fontWeight','fontStyle','fontVariant','fontSize','textColor','bold','italic','underline','underlineDetails','strikethrough','strikethroughDetails','mobileUnderline','mobileStrike','letterSpacing','baselineShift','fontFeatures','fontVariationSettings'].includes(k) || runs.some(r => Object.hasOwn(r.style,k)))));
  return points.slice(0, -1).map((a, i) => ({ start: a, end: points[i + 1], style: { ...base, ...runs.find(r => r.start <= a && r.end > a)?.style } }));
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
