import { normalizeParagraphRuns, projectParagraphLists } from '../model/paragraph-style.mjs';
import { textDecorationRects } from './text-decorations.mjs';
import { baselineOffset, glyphFontSize } from './text-baseline-shift.mjs';
import { isBaselineShift, normalizeRuns, resolveUnderlineDetails } from '../model/rich-text.mjs';
import { projectTextCase, resolveTextCase, sourceToDisplay, textGraphemes } from '../model/text-case.mjs';

// Ordinary horizontal text always uses one renderer, whether or not styled
// ranges exist. A formatting operation must not switch the rendering engine.
export const supportsHorizontalTextLayout = e =>
  (!e.textMode || e.textMode === 'horizontal') && !e.mobileArcRadius;
// Keep the sparse-range predicate separate for session/model migrations.
export const usesRichTextLayout = e => supportsHorizontalTextLayout(e) &&
  Array.isArray(e.textRuns) && e.textRuns.length > 0;

const positive = (n, fallback) => Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : fallback;
const spacing = n => Number.isFinite(Number(n)) ? Number(n) : 0;
const genericFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
// Gecko Canvas quantizes font sizes to seven significant binary bits while
// CSS retains finer sizes (28.3125 -> 28.25, 39.75 -> 40, 129 -> 128).
// Use representable font declarations in every painter. Source/run sizes and
// their scale remain exact; declaration rounding is bounded by size/128.
export const fontDeclarationSize = size => {
  const step=2**(Math.floor(Math.log2(size))-6),units=size/step,low=Math.floor(units);
  // IEEE round-to-nearest, ties-to-even, as used by the Canvas font backend.
  return (units-low===.5?(low%2?low+1:low):Math.round(units))*step;
};
let quantizedFonts = false;
export const richTextFont = s => {
  const family = genericFamilies.has(s.fontFamily.toLowerCase()) ? s.fontFamily.toLowerCase() : `"${s.fontFamily.replaceAll('"', '')}"`;
  const size = glyphFontSize(s);
  return `${s.fontStyle} ${s.fontWeight} ${quantizedFonts?fontDeclarationSize(size):size}px ${family}`;
};

// Explicit weight/style wins over its boolean alias within the same scope.
// A run's boolean alias overrides the inherited layer weight/style.
export function resolveRichTextStyle(base, override = {}) {
  const weight = s => s.fontWeight || (s.bold === undefined ? undefined : s.bold ? '700' : '400');
  const italic = s => s.fontStyle || (s.italic === undefined ? undefined : s.italic ? 'italic' : 'normal');
  const size = positive(base.fontSize, 24);
  const scale = size / positive(base.textRunsBaseFontSize, size);
  const underlineDetails = (base.fillType || 'solid') === 'solid' ?
    resolveUnderlineDetails(base.underlineDetails, override.underlineDetails) : {};
  return {
    fontFamily: String(override.fontFamily || base.fontFamily || 'Arial'),
    fontWeight: String(weight(override) || weight(base) || '400'),
    fontStyle: italic(override) || italic(base) || 'normal',
    fontSize: override.fontSize === undefined ? size : positive(override.fontSize, size / scale) * scale,
    baselineShift: isBaselineShift(override.baselineShift) ? override.baselineShift : isBaselineShift(base.baselineShift) ? base.baselineShift : 'normal',
    fillOpacity: override.fillOpacity ?? base.fillOpacity ?? 100,
    strokeStyle: override.strokeStyle ?? base.strokeStyle ?? 'solid',
    strokeOpacity: override.strokeOpacity ?? base.strokeOpacity ?? 100,
    textColor: override.textColor || base.textColor || base.fill || '#000000',
    letterSpacing: spacing(override.letterSpacing ?? base.letterSpacing),
    lineHeight: positive(override.lineHeight, positive(base.lineHeight, 1.15)),
    underline: override.underline ?? base.underline ?? base.mobileUnderline ?? false,
    ...(Object.keys(underlineDetails).length ? {underlineDetails} : {}),
    strikethrough: override.strikethrough ?? base.strikethrough ?? base.mobileStrike ?? false,
    strokeWidth: Math.max(0, spacing(override.strokeWidth ?? base.strokeWidth)),
    stroke: String(override.stroke || base.stroke || '#000000').toLowerCase().replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#$1$1$2$2$3$3'),
  };
}

export function richTextSpans(e) {
  const text = String(e.text ?? ''), runs = normalizeRuns(text, e.textRuns), spans = [];
  let offset = 0;
  const add = (start, end, style) => {
    if (end > start) spans.push({ start, end, text: text.slice(start, end),
      style: resolveRichTextStyle(e, style), textCase:resolveTextCase(e.textCase, style?.textCase) });
  };
  for (const run of runs) {
    add(offset, run.start); add(run.start, run.end, run.style); offset = run.end;
  }
  add(offset, text.length);
  return spans;
}

export function retainRichTextSizeBase(e) {
  if (usesRichTextLayout(e) && !positive(e.textRunsBaseFontSize, 0) &&
      e.textRuns.some(r => positive(r?.style?.fontSize, 0))) e.textRunsBaseFontSize = positive(e.fontSize, 24);
}

/** Own a document-scale measuring context. No DOM measurement or zoom input.
 * Bounded layout/metric caches are invalidated on FontFaceSet completion/error.
 * Returned rows are immutable by convention; all coordinates are layer-local.
 */
export function createRichTextLayoutEngine(context, fontSet) {
  // Detect metric precision once on the real Canvas backend, without UA
  // sniffing. Exact backends retain existing fractional document typography.
  if(context.canvas&&typeof context.save==='function'){
    context.save();
    try{
      context.fontKerning='normal';context.letterSpacing='0px';
      const width=size=>{context.font=`${size}px sans-serif`;return context.measureText('MMMMMMMM').width;};
      quantizedFonts=[[28.375,28.5,28.25],[39.75,40,39.5],[129,128,130]].every(([size,rounded,other])=>{
        const actual=width(size);return Math.abs(actual-width(rounded))<.0001&&Math.abs(actual-width(other))>.01;
      });
    }finally{context.restore();}
  }
  const layouts = new Map(), metrics = new Map(), caseProjections = new Map();
  let fontCount = fontSet?.size;
  const invalidate = () => { layouts.clear(); metrics.clear(); };
  fontSet?.addEventListener('loadingdone', invalidate);
  fontSet?.addEventListener('loadingerror', invalidate);
  const segmenter = textGraphemes;
  const boundedSet = (cache, key, value, limit) => {
    if (cache.size >= limit) cache.delete(cache.keys().next().value);
    cache.set(key, value); return value;
  };
  function caseProjectionFor(text, spans) {
    if (!spans.some(span => span.textCase !== 'original')) return null;
    const modes = [];
    for (const {end,textCase} of spans) {
      if (modes.at(-1)?.textCase === textCase) modes.at(-1).end = end;
      else modes.push({end,textCase});
    }
    // Font fitting tries several sizes for the same source and case ranges.
    // Their intervals are independent of geometry, paint and font changes.
    const key = JSON.stringify([text,modes]);
    return caseProjections.get(key) ?? boundedSet(caseProjections,key,projectTextCase(text,modes),32);
  }
  function measure(text, style) {
    const font = richTextFont(style), key = JSON.stringify([font, style.letterSpacing, text]);
    if (metrics.has(key)) return metrics.get(key);
    context.font = font; context.fontKerning = 'normal';
    context.letterSpacing = style.letterSpacing + 'px';
    const m = context.measureText(text);
    return boundedSet(metrics, key, {
      width: m.width,
      ascent: m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? glyphFontSize(style) * .8,
      descent: m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? glyphFontSize(style) * .2,
      inkLeft: m.actualBoundingBoxLeft ?? 0,
      inkRight: m.actualBoundingBoxRight ?? m.width,
      inkAscent: m.actualBoundingBoxAscent ?? m.fontBoundingBoxAscent ?? glyphFontSize(style) * .8,
      inkDescent: m.actualBoundingBoxDescent ?? m.fontBoundingBoxDescent ?? glyphFontSize(style) * .2,
    }, 4096);
  }
  function layout(e) {
    if (fontCount !== fontSet?.size) { invalidate(); fontCount = fontSet?.size; }
    const spans = richTextSpans(e), base = resolveRichTextStyle(e);
    const solid = (e.fillType || 'solid') === 'solid';
    const width = Math.max(1, Number(e.w) || 1), height = Math.max(0, Number(e.h) || 0);
    const horizontal = supportsHorizontalTextLayout(e);
    const text = String(e.text ?? '');
    const paragraphRuns = horizontal ? normalizeParagraphRuns(text,e.paragraphRuns) : [];
    const key = JSON.stringify([spans, base, solid, width, height, e.textAlign, e.verticalAlign, fontSet?.size, horizontal, paragraphRuns]);
    if (layouts.has(key)) return layouts.get(key);
    // Segment the source as a whole: run boundaries cannot split emoji/combining
    // clusters. If a run starts inside a cluster, its first character owns it.
    const clusters = []; let spanIndex = 0;
    const caseProjection = horizontal ? caseProjectionFor(text, spans) : null;
    const projected = caseProjection?.intervals;
    function addCluster(segment, index, end) {
      while (spanIndex + 1 < spans.length && spans[spanIndex].end <= index) spanIndex++;
      if (segment === '\r') return; // Same CR compatibility as legacy horizontal text.
      clusters.push({ text: segment === '\r\n' ? '\n' : segment, start: index, end, style: spans[spanIndex]?.style || base });
    }
    if (projected) for (const part of projected) addCluster(part.projectedText, part.sourceStart, part.sourceEnd);
    else for (const {segment,index} of segmenter.segment(text)) addCluster(segment,index,index+segment.length);
    // Use the same whole-grapheme ownership as glyph painting. A saved run
    // boundary inside a combining/ZWJ cluster cannot paint a partial glyph line.
    const advancedUnderline = spans.some(({style}) => style.underline && style.underlineDetails);
    function collectDecorationSpans(withDetails) {
      const result = [];
      for (const cluster of clusters) {
        if (cluster.text === '\n') continue;
        const {lineHeight, strokeWidth, stroke, strokeOpacity, strokeStyle, underlineDetails, ...style} = cluster.style;
        if (withDetails && style.underline) style.underlineDetails = underlineDetails;
        if (!solid) delete style.fillOpacity;
        const last = result.at(-1), id = JSON.stringify(style);
        if (last?.id === id && last.end === cluster.start) last.end = cluster.end;
        else result.push({...cluster, style, id});
      }
      return result;
    }
    const legacySpans = collectDecorationSpans(false);
    const underlineSpans = advancedUnderline ? collectDecorationSpans(true) : [];
    const rows = []; let fragments = [], rowWidth = 0, rowStart = 0, emptyStyle = base;
    let previousDescent = 0, edgeLeading = 0;
    const markerStyle = {...base, baselineShift:'normal', underline:false, strikethrough:false};
    const paragraphs = paragraphRuns.length ? projectParagraphLists(text, paragraphRuns) : [];
    const columns = new Map();
    for (const paragraph of paragraphs) {
      if (!paragraph.marker) continue;
      const metrics = measure(paragraph.marker, markerStyle);
      paragraph.markerWidth = Math.max(0, metrics.width, metrics.inkRight) + Math.max(0, metrics.inkLeft);
      if (paragraph.sequenceStart !== undefined) {
        columns.set(paragraph.sequenceStart, Math.max(columns.get(paragraph.sequenceStart) ?? 0, paragraph.markerWidth));
      }
    }
    for (const paragraph of paragraphs) {
      if (!paragraph.marker) continue;
      paragraph.markerColumnWidth = columns.get(paragraph.sequenceStart) ?? paragraph.markerWidth;
      paragraph.hangingIndent = paragraph.style.listIndent + paragraph.markerColumnWidth + paragraph.style.listGap;
    }
    let paragraphIndex = 0;
    const paragraphForRow = () => paragraphs[paragraphIndex];
    const availableWidth = () => Math.max(1, width - (paragraphForRow()?.hangingIndent ?? 0));
    // Decoration and leading boundaries never split glyph painting (including ligatures).
    const styleKey = ({ underline, underlineDetails, strikethrough, lineHeight, ...paint }) => {
      if (!solid) delete paint.fillOpacity;
      if (!paint.strokeWidth) { delete paint.strokeOpacity; delete paint.strokeStyle; }
      return JSON.stringify(paint);
    };
    // Paint colors must not alter shaping or move subsequent glyphs. A color
    // split preserves the advance of the full contiguous font/spacing sequence,
    // while keeping separate fragments for per-range drawing and ink bounds.
    const geometryKey = ({ textColor, fillOpacity, strokeWidth, stroke, strokeOpacity, strokeStyle, underline, underlineDetails, strikethrough, lineHeight, ...geometry }) => JSON.stringify(geometry);
    const requiredHeight = part => part.requiredHeight ?? part.style.fontSize * part.style.lineHeight;
    function append(parts, cluster) {
      const last = parts.at(-1), id = styleKey(cluster.style);
      const geometry = geometryKey(cluster.style);
      const sameGeometry = last?.geometry === geometry;
      const previousShapeWidth = sameGeometry ? last.shapeWidth : 0;
      const shapeText = sameGeometry ? last.shapeText + cluster.text : cluster.text;
      const shapeWidth = measure(shapeText, cluster.style).width;
      if (last?.id === id) {
        const next = { ...last, text: last.text + cluster.text, end: cluster.end,
          metrics: measure(last.text + cluster.text, last.style),
          requiredHeight: Math.max(requiredHeight(last), requiredHeight(cluster)), shapeText, shapeWidth };
        parts[parts.length - 1] = next;
      } else {
        parts.push({ ...cluster, id, geometry, shapeText, shapeWidth, requiredHeight: requiredHeight(cluster),
          metrics: measure(cluster.text, cluster.style) });
      }
      return shapeWidth - previousShapeWidth;
    }
    function finish(breakCluster, final = false) {
      // Empty rows historically use layer font metrics, including in mixed
      // fontSize documents. Only their LF's leading is a new range property.
      const blankStyle = {...base, baselineShift:'normal', lineHeight:(breakCluster?.style || emptyStyle).lineHeight};
      const samples = fragments.length ? [...fragments] : [{ style: blankStyle, metrics: measure('Mg', blankStyle) }];
      const paragraph = paragraphForRow();
      if (paragraph?.marker && rowStart === paragraph.start) {
        samples.push({style:markerStyle, metrics:measure(paragraph.marker, markerStyle)});
      }
      let ascent = -Infinity, descent = -Infinity;
      for (const part of samples) {
        const offset = baselineOffset(part.style);
        const nominal = offset ? measure(part.text, {...part.style, baselineShift:'normal'}) : part.metrics;
        ascent = Math.max(ascent, nominal.ascent, part.metrics.ascent - offset);
        descent = Math.max(descent, nominal.descent, part.metrics.descent + offset);
      }
      // Leading belongs to source fragments, independently of glyph coalescing.
      // Max font metrics keep one baseline safe for mixed families and sizes.
      const rowHeight = Math.max(...samples.map(requiredHeight), ascent + descent);
      const previous = rows.at(-1);
      // The first row keeps half-leading at the top and at the BLOCK's end.
      // Every later row owns the entire baseline interval BEFORE itself.
      // A large preceding descent must also clear the current ascent; leading
      // from the preceding row must never increase this interval.
      if (!previous) edgeLeading = (rowHeight - ascent - descent) / 2;
      const y = previous ? previous.y + previous.height : 0;
      const baseline = previous ? previous.baseline + Math.max(rowHeight, previousDescent + ascent) : ascent + edgeLeading;
      // Layout ignores obsolete textLayoutMode; no old-baseline branch remains.
      // Source intervals are UTF-16, independent of rendered geometry. Hard
      // breaks are excluded from end and owned by [end, nextStart). A trailing
      // empty row has start=end=text.length. Legacy ignored CRs retain offsets.
      const end = breakCluster?.start ?? (final ? text.length : fragments.at(-1)?.end ?? rowStart);
      const nextStart = breakCluster?.end ?? end;
      rows.push({ start: rowStart, end, nextStart, softWrap: !breakCluster && !final,
        fragments, emptyStyle: fragments.length ? undefined : {...blankStyle, underline:false, strikethrough:false}, width: rowWidth,
        y, height: baseline + descent - y, baseline, ...(paragraph?.marker ? {paragraph} : {}) });
      previousDescent = descent;
      if (breakCluster) { emptyStyle = breakCluster.style; paragraphIndex++; }
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
        if (last?.id === id) { last.text += ch.text; last.end = ch.end; last.requiredHeight = Math.max(requiredHeight(last), requiredHeight(ch)); } else token.push({ ...ch, id, requiredHeight: requiredHeight(ch) });
      }
      const trial = fragments.slice(); let trialWidth = rowWidth;
      for (const part of token) trialWidth += append(trial, part);
      if (!blank && fragments.length && trialWidth > availableWidth()) finish();
      const next = fragments.slice(); let nextWidth = rowWidth;
      for (const part of token) nextWidth += append(next, part);
      if (nextWidth <= availableWidth()) { fragments = next; rowWidth = nextWidth; }
      else for (let j = i; j < end; j++) {
        let candidate = fragments.slice(), candidateWidth = rowWidth + append(candidate, clusters[j]);
        if (fragments.length && candidateWidth > availableWidth()) {
          finish(); candidate = []; candidateWidth = append(candidate, clusters[j]);
        }
        fragments = candidate; rowWidth = candidateWidth;
      }
      i = end;
    }
    finish(undefined, true);
    // Contiguous row boxes end at their glyph bounds, except for the terminal
    // block padding. Uniform typography retains its old baselines/block height.
    rows.at(-1).height += edgeLeading;
    const blockHeight = rows.reduce((sum, row) => sum + row.height, 0);
    const y = e.verticalAlign === 'middle' ? Math.max(0, (height - blockHeight) / 2) :
      e.verticalAlign === 'bottom' ? Math.max(0, height - blockHeight) : 0;
    // Align the whole item (and the ordered column) as a block, so continuation
    // rows always start at exactly the same content x as the first row.
    const blockWidths = new Map();
    for (const row of rows) {
      const p = row.paragraph;
      if (!p) continue;
      const key = p.sequenceStart ?? p.start;
      blockWidths.set(key, Math.max(blockWidths.get(key) ?? 0, row.width + p.hangingIndent));
    }
    for (const [rowIndex, row] of rows.entries()) {
      const p = row.paragraph;
      const alignedWidth = p ? blockWidths.get(p.sequenceStart ?? p.start) : row.width;
      let x = e.textAlign === 'center' ? (width - alignedWidth) / 2 : e.textAlign === 'right' ? width - alignedWidth : 0;
      if (p) {
        x = Math.max(0, x) + p.hangingIndent;
        p.contentX = x;
        p.firstRow ??= rowIndex;
        p.lastRow = rowIndex;
      }
      row.x = x; // Retain the shared alignment origin even for empty rows.
      row.y += y; row.baseline += y;
      if (p && rowIndex === p.firstRow) {
        const columnX = x - p.style.listGap - p.markerColumnWidth;
        const leftBearing = Math.max(0, measure(p.marker, markerStyle).inkLeft);
        row.marker = {text:p.marker, style:markerStyle, x:columnX + p.markerColumnWidth - p.markerWidth + leftBearing,
          y:row.baseline, width:p.markerWidth, columnX};
      }
      let previousGeometry = null, previousShapeWidth = 0;
      row.fragments = row.fragments.map(({ text, style, start, end, geometry, shapeWidth }) => {
        const advance = geometry === previousGeometry ? shapeWidth - previousShapeWidth : shapeWidth;
        const part = { text, style, start, end, x, y: row.baseline + baselineOffset(style), width: advance };
        x += advance;
        previousGeometry = geometry; previousShapeWidth = shapeWidth;
        return part;
      });
      // A stroke/opacity boundary may decompose a ligature, but must not move the
      // following geometry group or lose AV's contextual kerning placement.
      // Keep legacy color-only positioning untouched. Logical advances and
      // decoration intervals retain the original full-string measurements.
      for(let i=0;i<row.fragments.length;){
        let end=i+1;
        while(end<row.fragments.length&&geometryKey(row.fragments[end].style)===geometryKey(row.fragments[i].style)&&row.fragments[end].style.textColor===row.fragments[i].style.textColor)end++;
        const group=row.fragments.slice(i,end);
        if(new Set(group.map(p=>JSON.stringify([p.style.strokeWidth,p.style.stroke,p.style.strokeWidth?p.style.strokeOpacity:100,p.style.strokeWidth?p.style.strokeStyle:'solid',solid?p.style.fillOpacity:100]))).size>1){
          const text=group.map(p=>p.text).join(''),origin=group[0].x,total=measure(text,group[0].style).width;
          let offset=0;
          for(const part of group){part.logicalX=part.x;part.x=origin+total-measure(text.slice(offset),part.style).width;offset+=part.text.length;}
        }
        i=end;
      }
      // Decorations use source intervals and the same contextual advances as
      // glyphs. They never contribute to metrics, shaping, wrapping or auto-fit.
      row.decorations = [];
      function addDecorations(part, spans, kind) {
        for (const span of spans) {
          const start = Math.max(part.start, span.start), end = Math.min(part.end, span.end);
          if (start >= end || (!span.style.underline && !span.style.strikethrough)) continue;
          const prefix = offset => {
            if (offset === part.end) return part.width;
            const value = projected ? caseProjection.text.slice(sourceToDisplay(caseProjection, part.start), sourceToDisplay(caseProjection, offset)) : text.slice(part.start, offset);
            return measure(value.replaceAll('\r', ''), part.style).width;
          };
          const left = prefix(start), right = prefix(end);
          const rects = textDecorationRects({x:(part.logicalX??part.x) + left, y:part.y, width:right-left}, span.style, kind);
          for (const rect of rects)
            row.decorations.push({...rect, start, end, fillOpacity:rect.fillOpacity ?? span.style.fillOpacity});
        }
      }
      for (const part of row.fragments) {
        addDecorations(part, legacySpans, advancedUnderline ? 'strikethrough' : null);
        if (advancedUnderline) addDecorations(part, underlineSpans, 'underline');
      }
    }
    let inkOverflow=0;
    for(const row of rows)if(row.y<=height)for(const part of row.marker ? [row.marker, ...row.fragments] : row.fragments){
      const m=measure(part.text,part.style);
      inkOverflow=Math.max(inkOverflow,m.inkLeft-part.x,m.inkAscent-part.y,part.x+m.inkRight-width,part.y+m.inkDescent-height);
    }
    return boundedSet(layouts, key, { rows, width: Math.max(...rows.map(r => r.width + (r.paragraph?.hangingIndent ?? 0))), height: blockHeight, inkOverflow,
      ...(projected ? {caseProjection} : {}), ...(paragraphs.length ? {paragraphs} : {}) }, 128);
  }
  /** Horizontal justify projection. Reuse shared rows and metrics;
   * only U+0020 spaces between words on soft-wrapped rows receive extra advance.
   * Hard-break and terminal rows (each paragraph's last row) stay natural.
   */
  function layoutJustified(e) {
    const natural = layout({...e, textAlign:'left'});
    const sourceText = String(e.text ?? '');
    const projection = natural.caseProjection;
    const containsCR = sourceText.includes('\r');
    // Shared layout omits legacy standalone CRs from glyph text, but source
    // coordinates still include them. Map rendered prefix lengths back to UTF-16.
    const sourceOffset = (part, index) => {
      if (index === part.text.length) return part.end;
      if (!containsCR) return part.start + index;
      let visible = 0;
      for (let i=part.start; i<part.end; i++) {
        if (sourceText[i] !== '\r' && visible++ === index) return i;
      }
      return part.end;
    };
    function partSegments(part) {
      if (!projection) return [...segmenter.segment(part.text)].map(p=>({...p, offset:sourceOffset(part,p.index)}));
      const result = [];
      let index = 0;
      for (const item of segmenter.segment(sourceText.slice(part.start,part.end))) {
        if (item.segment === '\r') continue;
        const offset = part.start + item.index;
        const segment = projection.text.slice(sourceToDisplay(projection,offset),sourceToDisplay(projection,offset+item.segment.length));
        result.push({segment,index,offset});
        index += segment.length;
      }
      return result;
    }
    const frameWidth = Math.max(1, Number(e.w) || 1);
    const rows = natural.rows.map(row => {
      const source = row.fragments.map(p => p.text).join('');
      // Leading/trailing whitespace and tabs/NBSP are retained, never expanded.
      const first = source.search(/\S/u), last = source.search(/\s*$/u);
      const spaces = [];
      const segments = row.fragments.map(partSegments);
      let local = 0, contentWidth = 0;
      const prefix = (part, offset) => offset === part.text.length ? part.width : measure(part.text.slice(0, offset), part.style).width;
      for (const [i,part] of row.fragments.entries()) {
        if (last > local && last <= local + part.text.length) contentWidth = (part.logicalX ?? part.x) + prefix(part, last-local);
        for (const {segment, index, offset} of segments[i]) {
          if (segment === ' ' && local + index > first && local + index < last) spaces.push(offset);
        }
        local += part.text.length;
      }
      // Preserved trailing spaces hang after the frame; the final word's
      // logical advance, rather than invisible trailing content, meets its edge.
      const extra = row.softWrap && spaces.length ? Math.max(0, frameWidth - contentWidth) / spaces.length : 0;
      const shift = offset => {
        let low=0, high=spaces.length;
        while(low<high){const mid=(low+high)>>>1;if(spaces[mid]<offset)low=mid+1;else high=mid;}
        return low*extra;
      };
      const carets = [], fragments = [];
      for (const [p,part] of row.fragments.entries()) {
        // Contextual prefix advances retain shaping inside words, including at
        // paint-only run boundaries. Never split a source grapheme for a run.
        const offsets = new Map(segments[p].map(({index,offset})=>[index,offset]));
        offsets.set(part.text.length,part.end);
        const cuts = new Set([0, part.text.length]);
        for (const {segment,index,offset} of segments[p]) {
          carets.push({offset, x:(part.logicalX ?? part.x) + prefix(part,index) + shift(offset)});
          if (/^\s+$/u.test(segment)) { cuts.add(index); cuts.add(index + segment.length); }
        }
        carets.push({offset:part.end, x:(part.logicalX ?? part.x) + part.width + shift(part.end)});
        const boundaries = [...cuts].sort((a,b) => a-b);
        for (let i=1; i<boundaries.length; i++) {
          const a=boundaries[i-1], b=boundaries[i], start=offsets.get(a), end=offsets.get(b);
          // Keep the shared painter's contextual glyph origin separate from
          // logical advances (opacity/stroke boundaries can kern inside a word).
          const logicalX=(part.logicalX ?? part.x)+prefix(part,a)+shift(start);
          const x=part.x+prefix(part,a)+shift(start);
          fragments.push({...part, text:part.text.slice(a,b), start, end, x,
            logicalX, width:prefix(part,b)-prefix(part,a)+shift(end)-shift(start)});
        }
      }
      const decorations = row.decorations.map(rect => ({...rect,
        x:rect.x+shift(rect.start), width:rect.width+shift(rect.end)-shift(rect.start)}));
      return {...row, fragments, decorations, width:row.width+spaces.length*extra,
        justification:{naturalWidth:row.width, contentWidth:contentWidth+spaces.length*extra, extraPerSpace:extra, spaces:extra ? spaces : []},
        // Duplicate offsets at paint boundaries have the same logical advance.
        // LF/soft-wrap affinity is represented by the owning row, as before.
        carets:carets.length ? [...new Map(carets.map(c => [c.offset,c])).values()] : [{offset:row.start,x:row.x}]};
    });
    let inkOverflow=0;
    const frameHeight=Math.max(0,Number(e.h)||0);
    for(const row of rows)if(row.y<=frameHeight)for(const part of row.marker ? [row.marker, ...row.fragments] : row.fragments){
      const m=measure(part.text,part.style);
      inkOverflow=Math.max(inkOverflow,m.inkLeft-part.x,m.inkAscent-part.y,part.x+m.inkRight-frameWidth,part.y+m.inkDescent-frameHeight);
    }
    return {...natural, rows, width:Math.max(...rows.map(row=>row.width + (row.paragraph?.hangingIndent ?? 0))), inkOverflow};
  }
  return { layout, layoutJustified, invalidate };
}
