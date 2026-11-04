import { normalizeRuns } from '../model/rich-text.mjs';

export const usesRichTextLayout = e => Array.isArray(e.textRuns) && e.textRuns.length > 0 &&
  (!e.textMode || e.textMode === 'horizontal') && !e.mobileArcRadius && e.textAlign !== 'justify';

const positive = (n, fallback) => Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : fallback;
const spacing = n => Number.isFinite(Number(n)) ? Number(n) : 0;
const genericFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
export const richTextFont = s => {
  const family = genericFamilies.has(s.fontFamily.toLowerCase()) ? s.fontFamily.toLowerCase() : `"${s.fontFamily.replaceAll('"', '')}"`;
  return `${s.fontStyle} ${s.fontWeight} ${s.fontSize}px ${family}`;
};

// Explicit weight/style wins over its boolean alias within the same scope.
// A run's boolean alias overrides the inherited layer weight/style.
export function resolveRichTextStyle(base, override = {}) {
  const weight = s => s.fontWeight || (s.bold === undefined ? undefined : s.bold ? '700' : '400');
  const italic = s => s.fontStyle || (s.italic === undefined ? undefined : s.italic ? 'italic' : 'normal');
  const size = positive(base.fontSize, 24);
  const scale = size / positive(base.textRunsBaseFontSize, size);
  return {
    fontFamily: String(override.fontFamily || base.fontFamily || 'Arial'),
    fontWeight: String(weight(override) || weight(base) || '400'),
    fontStyle: italic(override) || italic(base) || 'normal',
    fontSize: override.fontSize === undefined ? size : positive(override.fontSize, size / scale) * scale,
    textColor: override.textColor || base.textColor || base.fill || '#000000',
    letterSpacing: spacing(override.letterSpacing ?? base.letterSpacing),
  };
}

export function richTextSpans(e) {
  const text = String(e.text ?? ''), runs = normalizeRuns(text, e.textRuns), spans = [];
  let offset = 0;
  const add = (start, end, style) => {
    if (end > start) spans.push({ start, end, text: text.slice(start, end), style: resolveRichTextStyle(e, style) });
  };
  for (const run of runs) {
    add(offset, run.start); add(run.start, run.end, run.style); offset = run.end;
  }
  add(offset, text.length);
  return spans;
}

// Opt-in only: documents without this value retain their original rich layout.
export const LEGACY_TOP_LAYOUT = 'legacy-top';
export function legacyAlphabeticBaseline(context, text, style) {
  context.save();
  try {
    context.font = richTextFont(style); context.fontKerning = 'normal';
    context.letterSpacing = style.letterSpacing + 'px';
    context.textBaseline = 'top'; const top = context.measureText(text);
    context.textBaseline = 'alphabetic'; const alphabetic = context.measureText(text);
    const baseline = alphabetic.actualBoundingBoxAscent - top.actualBoundingBoxAscent;
    if (![top.width, alphabetic.width, top.actualBoundingBoxAscent, top.actualBoundingBoxDescent,
      alphabetic.actualBoundingBoxAscent, alphabetic.actualBoundingBoxDescent].every(Number.isFinite) ||
      Math.abs(top.width - alphabetic.width) > .000001 ||
      Math.abs(top.actualBoundingBoxDescent - alphabetic.actualBoundingBoxDescent - baseline) > .000001)
      throw Error('Legacy baseline unavailable');
    return baseline;
  } finally { context.restore(); }
}
// Color may split spans, but typography must still match the layer. Admission
// depends on measured rows, never a family name or a calibrated reference size.
// Returns session-only geometry; never writes a mode into the source layer.
export function legacyTopProjection(context, e) {
  if (e.textLayoutMode !== LEGACY_TOP_LAYOUT && (usesRichTextLayout(e) || e.textLayoutMode !== undefined)) return null;
  if (String(e.text ?? '').split('\n').some(text => !text)) return null;
  const base = resolveRichTextStyle(e);
  if (richTextSpans(e).some(p => ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing'].some(k => p.style[k] !== base[k]))) return null;
  context.save();
  try {
    context.font = richTextFont(base); context.textBaseline = 'alphabetic';
    context.fontKerning = 'normal'; context.letterSpacing = base.letterSpacing + 'px';
    const m = context.measureText('Mg'), height = base.fontSize * (e.lineHeight || 1.15);
    const fits = m => [m.width, m.fontBoundingBoxAscent, m.fontBoundingBoxDescent, height].every(Number.isFinite) &&
      m.width > 0 && m.fontBoundingBoxAscent >= 0 && m.fontBoundingBoxDescent >= 0 &&
      m.fontBoundingBoxAscent + m.fontBoundingBoxDescent <= height;
    if (!fits(m)) return null;
    const natural = m.fontBoundingBoxAscent + (height - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
    const offsets = []; let naturalMatches = true;
    for (const text of String(e.text ?? '').split('\n')) {
      const row = context.measureText(text), baseline = legacyAlphabeticBaseline(context, text, base);
      const rowNatural = row.fontBoundingBoxAscent + (height - row.fontBoundingBoxAscent - row.fontBoundingBoxDescent) / 2;
      if (!fits(row) || baseline <= 0 || baseline > height ||
        Math.abs(rowNatural - natural) > .5) return null;
      if (Math.abs(baseline - rowNatural) > .5) naturalMatches = false;
      offsets.push(baseline - natural);
    }
    if (offsets.some(offset => Math.abs(offset - offsets[0]) > .000001)) return null;
    if (e.textLayoutMode !== LEGACY_TOP_LAYOUT && naturalMatches) return null;
    return {offset: offsets[0], baseline: natural + offsets[0], height};
  } catch { return null; } finally { context.restore(); }
}

// One persisted reference size is needed to scale absolute run sizes without
// rewriting them, including after save/reopen. Never called during painting.
export function retainRichTextSizeBase(e) {
  if (usesRichTextLayout(e) && !positive(e.textRunsBaseFontSize, 0) &&
      e.textRuns.some(r => positive(r?.style?.fontSize, 0))) e.textRunsBaseFontSize = positive(e.fontSize, 24);
}

/** Own a document-scale measuring context. No DOM measurement or zoom input.
 * Bounded layout/metric caches are invalidated on FontFaceSet completion/error.
 * Returned rows are immutable by convention; all coordinates are layer-local.
 */
export function createRichTextLayoutEngine(context, fontSet) {
  const layouts = new Map(), metrics = new Map();
  let fontCount = fontSet?.size;
  const invalidate = () => { layouts.clear(); metrics.clear(); };
  fontSet?.addEventListener('loadingdone', invalidate);
  fontSet?.addEventListener('loadingerror', invalidate);
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const boundedSet = (cache, key, value, limit) => {
    if (cache.size >= limit) cache.delete(cache.keys().next().value);
    cache.set(key, value); return value;
  };
  function measure(text, style) {
    const font = richTextFont(style), key = JSON.stringify([font, style.letterSpacing, text]);
    if (metrics.has(key)) return metrics.get(key);
    context.font = font; context.fontKerning = 'normal';
    context.letterSpacing = style.letterSpacing + 'px';
    const m = context.measureText(text);
    return boundedSet(metrics, key, {
      width: m.width,
      ascent: m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? style.fontSize * .8,
      descent: m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? style.fontSize * .2,
    }, 4096);
  }
  function layout(e) {
    if (fontCount !== fontSet?.size) { invalidate(); fontCount = fontSet?.size; }
    const spans = richTextSpans(e), base = resolveRichTextStyle(e);
    const width = Math.max(1, Number(e.w) || 1), height = Math.max(0, Number(e.h) || 0);
    const lineHeight = Math.max(.5, Number(e.lineHeight) || 1.15);
    const key = JSON.stringify([spans, base, width, height, lineHeight, e.textAlign, e.verticalAlign, e.textLayoutMode, fontSet?.size]);
    if (layouts.has(key)) return layouts.get(key);
    // Segment the source as a whole: run boundaries cannot split emoji/combining
    // clusters. If a run starts inside a cluster, its first character owns it.
    const clusters = [], text = String(e.text ?? ''); let spanIndex = 0;
    for (const { segment, index } of segmenter.segment(text)) {
      while (spanIndex + 1 < spans.length && spans[spanIndex].end <= index) spanIndex++;
      if (segment === '\r') continue; // Same CR compatibility as legacy horizontal text.
      clusters.push({ text: segment === '\r\n' ? '\n' : segment, start: index, end: index + segment.length, style: spans[spanIndex]?.style || base });
    }
    const rows = []; let fragments = [], rowWidth = 0, rowStart = 0;
    const styleKey = s => JSON.stringify(s);
    function append(parts, cluster) {
      const last = parts.at(-1), id = styleKey(cluster.style);
      if (last?.id === id) {
        const next = { ...last, text: last.text + cluster.text, end: cluster.end };
        next.metrics = measure(next.text, next.style); parts[parts.length - 1] = next;
        return next.metrics.width - last.metrics.width;
      }
      const part = { ...cluster, id, metrics: measure(cluster.text, cluster.style) };
      parts.push(part); return part.metrics.width;
    }
    function finish(breakCluster, final = false) {
      const samples = fragments.length ? fragments : [{ style: base, metrics: measure('Mg', base) }];
      const ascent = Math.max(...samples.map(p => p.metrics.ascent));
      const descent = Math.max(...samples.map(p => p.metrics.descent));
      const maxSize = Math.max(...samples.map(p => p.style.fontSize));
      const legacy = e.textLayoutMode === LEGACY_TOP_LAYOUT;
      const rowHeight = legacy ? maxSize * lineHeight : Math.max(maxSize * lineHeight, ascent + descent);
      // Source intervals are UTF-16, independent of rendered geometry. Hard
      // breaks are excluded from end and owned by [end, nextStart). A trailing
      // empty row has start=end=text.length. Legacy ignored CRs retain offsets.
      const end = breakCluster?.start ?? (final ? text.length : fragments.at(-1)?.end ?? rowStart);
      const nextStart = breakCluster?.end ?? end;
      rows.push({ start: rowStart, end, nextStart, softWrap: !breakCluster && !final,
        fragments, width: rowWidth, height: rowHeight, baseline: legacy ? Math.max(...samples.map(p => legacyAlphabeticBaseline(context, text.slice(rowStart, end) || 'Mg', p.style))) : ascent + (rowHeight - ascent - descent) / 2 });
      rowStart = nextStart;
      fragments = []; rowWidth = 0;
    }
    // Words span style changes. Keep whitespace as source content, including at
    // wrap boundaries; oversized words/spaces fall back to whole graphemes.
    for (let i = 0; i < clusters.length;) {
      if (clusters[i].text === '\n') { finish(clusters[i]); i++; continue; }
      const blank = /^\s+$/u.test(clusters[i].text); let end = i + 1;
      while (end < clusters.length && clusters[end].text !== '\n' && /^\s+$/u.test(clusters[end].text) === blank) end++;
      const token = [];
      // Group first so measuring a long word is linear on the common path.
      for (let j = i; j < end; j++) {
        const ch = clusters[j], last = token.at(-1), id = styleKey(ch.style);
        if (last?.id === id) { last.text += ch.text; last.end = ch.end; } else token.push({ ...ch, id });
      }
      const trial = fragments.slice(); let trialWidth = rowWidth;
      for (const part of token) trialWidth += append(trial, part);
      if (!blank && fragments.length && trialWidth > width) finish();
      const next = fragments.slice(); let nextWidth = rowWidth;
      for (const part of token) nextWidth += append(next, part);
      if (nextWidth <= width) { fragments = next; rowWidth = nextWidth; }
      else for (let j = i; j < end; j++) {
        let candidate = fragments.slice(), candidateWidth = rowWidth + append(candidate, clusters[j]);
        if (fragments.length && candidateWidth > width) {
          finish(); candidate = []; candidateWidth = append(candidate, clusters[j]);
        }
        fragments = candidate; rowWidth = candidateWidth;
      }
      i = end;
    }
    finish(undefined, true);
    const blockHeight = rows.reduce((sum, row) => sum + row.height, 0);
    let y = e.verticalAlign === 'middle' ? Math.max(0, (height - blockHeight) / 2) :
      e.verticalAlign === 'bottom' ? Math.max(0, height - blockHeight) : 0;
    for (const row of rows) {
      let x = e.textAlign === 'center' ? (width - row.width) / 2 : e.textAlign === 'right' ? width - row.width : 0;
      row.y = y; row.baseline += y;
      row.fragments = row.fragments.map(({ text, style, metrics, start, end }) => {
        const part = { text, style, start, end, x, y: row.baseline, width: metrics.width }; x += metrics.width; return part;
      });
      y += row.height;
    }
    return boundedSet(layouts, key, { rows, width: Math.max(...rows.map(r => r.width)), height: blockHeight }, 128);
  }
  return { layout, invalidate };
}
