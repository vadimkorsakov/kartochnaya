import { formatListCounter, listCounterStyles, validateListMarker } from './list-presets.mjs';

export const paragraphListDefaults = {
  listKind: 'none', listMarker: '•', listCounterStyle: 'decimal-dot', listStart: null, listIndent: 0, listGap: 8,
  listItemSpacing: 0,
  listMarkerScale: null, listMarkerColor: 'inherit', listMarkerOpacity: 'inherit',
};
export const paragraphListLimits = {listStart: 999999, listIndent: 1000, listGap: 1000, listItemSpacing: 1000, listMarkerScale: 200, listMarkerOpacity: 100};
export const paragraphListMinimums = {listStart: 1, listMarkerScale: 30};

const counters = new Set(listCounterStyles.map(([style]) => style));
const kinds = new Set(['none', 'bullet', 'ordered']);
const keys = Object.keys(paragraphListDefaults);

function cleanStyle(style = {}) {
  const result = {};
  for (const key of keys) {
    const value = style?.[key];
    if (value == null || value === paragraphListDefaults[key]) continue;
    if (key === 'listKind' && kinds.has(value) || key === 'listMarker' && validateListMarker(value) ||
        key === 'listCounterStyle' && counters.has(value)) result[key] = value;
    if (key === 'listMarkerScale' && value === 'auto') result[key] = value;
    if (key === 'listMarkerColor' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) result[key] = value.toLowerCase();
    if (Object.hasOwn(paragraphListLimits, key) && Number.isFinite(value) &&
        value >= (paragraphListMinimums[key] ?? 0) && value <= paragraphListLimits[key] &&
        (key !== 'listStart' || Number.isInteger(value))) result[key] = value;
  }
  if (result.listKind !== 'ordered') delete result.listStart;
  return result;
}

export function textParagraphs(text) {
  const paragraphs = [];
  let start = 0;
  for (let lf = text.indexOf('\n'); lf !== -1; lf = text.indexOf('\n', start)) {
    paragraphs.push({start, end:lf > start && text[lf - 1] === '\r' ? lf - 1 : lf, nextStart:lf + 1});
    start = lf + 1;
  }
  paragraphs.push({start, end:text.length, nextStart:text.length});
  return paragraphs;
}

/** One sparse record per source paragraph, including an empty final paragraph. */
export function normalizeParagraphRuns(text, runs) {
  if (!Array.isArray(runs) || !runs.length) return [];
  const styles = new Map(runs.filter(run => run && Number.isInteger(run.start)).map(run => [run.start, run.style]));
  return textParagraphs(text).flatMap(({start}) => {
    const style = cleanStyle(styles.get(start));
    return Object.keys(style).length ? [{start, style}] : [];
  });
}

/** Sanitize only marker values on a newly imported document copy. */
export function cleanImportedListMarkers(document) {
  let removed = 0;
  const slides = Array.isArray(document.slides) ? document.slides : [];
  for (const canvas of [document, ...slides]) {
    if (!Array.isArray(canvas?.elements)) continue;
    for (const layer of canvas.elements) {
      if (layer?.type !== 'text' || !Array.isArray(layer.paragraphRuns)) continue;
      for (const run of layer.paragraphRuns) {
        const style = run?.style;
        if (style && Object.hasOwn(style, 'listMarker') && !validateListMarker(style.listMarker)) {
          delete style.listMarker;
          removed++;
        }
      }
    }
  }
  return removed;
}

export function paragraphRangeForSelection(text, selection) {
  const paragraphs = textParagraphs(text);
  if (!selection) return paragraphs;
  const clamp = offset => Math.max(0, Math.min(text.length, offset));
  const start = clamp(Math.min(selection.start, selection.end));
  const end = clamp(Math.max(selection.start, selection.end));
  const first = paragraphs.findLastIndex(p => p.start <= start);
  const last = start === end ? first : paragraphs.findLastIndex(p => p.start < end);
  return paragraphs.slice(first, last + 1);
}

export function effectiveParagraphStyleAt(element, offset) {
  const [paragraph] = paragraphRangeForSelection(element.text, {start:offset, end:offset});
  const runs = normalizeParagraphRuns(element.text, element.paragraphRuns);
  return {...paragraphListDefaults, ...runs.find(run => run.start === paragraph.start)?.style};
}

export function paragraphListState(element, selection, {onlyKind} = {}) {
  const runs = new Map(normalizeParagraphRuns(element.text, element.paragraphRuns).map(run => [run.start, run.style]));
  const styles = paragraphRangeForSelection(element.text, selection)
    .map(p => ({...paragraphListDefaults, ...runs.get(p.start)}))
    .filter(style => !onlyKind || style.listKind === onlyKind);
  if (!styles.length) return null;
  return Object.fromEntries(keys.map(key => {
    const first = styles[0][key];
    return [key, styles.every(style => style[key] === first) ? first : 'mixed'];
  }));
}

export function withParagraphRuns(element, runs) {
  const next = {...element};
  if (runs.length) next.paragraphRuns = runs;
  else delete next.paragraphRuns;
  return next;
}

export function applyParagraphListStyle(element, patch, selection = null, {useAutoMarkerScale = false, onlyKind} = {}) {
  if (Object.hasOwn(patch, 'listMarker') && !validateListMarker(patch.listMarker)) return element;
  const current = normalizeParagraphRuns(element.text, element.paragraphRuns);
  const runs = new Map(current.map(run => [run.start, run.style]));
  let previousCounter;
  for (const {start} of paragraphRangeForSelection(element.text, selection)) {
    const before = runs.get(start) ?? {};
    if (onlyKind && (before.listKind ?? paragraphListDefaults.listKind) !== onlyKind) {
      previousCounter = undefined;
      continue;
    }
    const style = {...before, ...patch};
    if (useAutoMarkerScale && style.listMarkerScale == null &&
        (style.listKind === 'bullet' || style.listKind === 'ordered')) {
      const preset = style.listKind === 'bullet' ? 'listMarker' : 'listCounterStyle';
      if (style.listKind !== before.listKind ||
          (style[preset] ?? paragraphListDefaults[preset]) !== (before[preset] ?? paragraphListDefaults[preset])) {
        style.listMarkerScale = 'auto';
      }
    }
    const counter = style.listKind === 'ordered' ? style.listCounterStyle ?? paragraphListDefaults.listCounterStyle : undefined;
    // A single Start edit sets the head of each selected compatible sequence.
    if (Object.hasOwn(patch, 'listStart') && counter === previousCounter) delete style.listStart;
    previousCounter = counter;
    runs.set(start, style);
  }
  const next = normalizeParagraphRuns(element.text, [...runs].map(([start, style]) => ({start, style})));
  return JSON.stringify(current) === JSON.stringify(next) ? element : withParagraphRuns(element, next);
}

export const clearParagraphFormatting = (element, selection) =>
  applyParagraphListStyle(element, paragraphListDefaults, selection);

/** Called only for a confirmed replacement at source offsets. Newly split
 * paragraphs inherit preferences, but a restart stays with the original item. */
export function remapParagraphRuns(element, text, start, end, inserted) {
  if (!element.paragraphRuns?.length) return [];
  const original = textParagraphs(element.text);
  const originalStarts = new Set(original.map(p => p.start));
  const styles = new Map(normalizeParagraphRuns(element.text, element.paragraphRuns).map(run => [run.start, run.style]));
  const owner = original.findLast(p => p.start <= start).start;
  const inherited = styles.get(owner);
  const delta = inserted.length - (end - start), suffix = start + inserted.length;
  const next = textParagraphs(text).flatMap(p => {
    let style;
    if (p.start < owner) style = styles.get(p.start);
    else if (p.start >= suffix && p.start - delta > owner && originalStarts.has(p.start - delta)) {
      style = styles.get(p.start - delta);
    } else if (p.start === owner) {
      style = start === owner && !inserted && end > owner && originalStarts.has(end) ? styles.get(end) : inherited;
    }
    else if (p.start <= suffix && inherited) {
      style = {...inherited};
      delete style.listStart;
    }
    return style ? [{start:p.start, style}] : [];
  });
  return next;
}

export function projectParagraphLists(text, runs) {
  const styles = new Map(normalizeParagraphRuns(text, runs).map(run => [run.start, run.style]));
  let counterStyle, number, sequenceStart;
  const paragraphs = textParagraphs(text).map(paragraph => {
    const style = {...paragraphListDefaults, ...styles.get(paragraph.start)};
    if (style.listKind === 'ordered') {
      if (counterStyle !== style.listCounterStyle || style.listStart !== null) {
        number = style.listStart ?? 1;
        sequenceStart = paragraph.start;
      } else number++;
      counterStyle = style.listCounterStyle;
      return {...paragraph, style, number, sequenceStart, marker:formatListCounter(number, counterStyle)};
    }
    counterStyle = undefined;
    return {...paragraph, style, marker:style.listKind === 'bullet' ? style.listMarker : ''};
  });
  for (let i = 1; i < paragraphs.length; i++) {
    const previous = paragraphs[i - 1], current = paragraphs[i];
    // Spacing belongs to the preceding item, within the same list sequence.
    if (previous.marker && current.marker && previous.style.listKind === current.style.listKind &&
        previous.sequenceStart === current.sequenceStart && previous.style.listItemSpacing > 0) {
      current.spacingBefore = previous.style.listItemSpacing;
    }
  }
  return paragraphs;
}
