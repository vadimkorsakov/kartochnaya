export const textCaseValues = Object.freeze(['original', 'upper', 'lower', 'title', 'sentence']);
export const isTextCase = value => textCaseValues.includes(value);
export const resolveTextCase = (base, override) => isTextCase(override) ? override : isTextCase(base) ? base : 'original';
export const textGraphemes = new Intl.Segmenter('ru-RU', {granularity:'grapheme'});
const words = new Intl.Segmenter('ru-RU', {granularity:'word'});
const cased = /\p{Cased}/u;

function wordStarts(text) {
  const starts = new Set();
  for (const word of words.segment(text)) {
    if (!word.isWordLike) continue;
    const first = cased.exec(word.segment);
    if (first) starts.add(word.index + first.index);
  }
  return starts;
}

function sentencePeriods(text) {
  const periods = new Set();
  // A deliberately small RU/EN list. Punctuation other than these dots
  // retains its normal sentence-boundary behavior.
  const abbreviations = /(?<![\p{L}\p{N}])(?:т\.[ \t\u00a0]*[едпкн]\.|(?:г|ул|им|рис|стр|mr|mrs|ms|dr|prof|etc|vs)\.|e\.g\.|i\.e\.)(?=\s|[»”"'),;!?…]|$)/giu;
  const initials = /(?<!\p{L})(?:[\p{L}]\.[ \t\u00a0]*){2,}(?=\p{L})|(?<!\p{L})\p{Lu}\.[ \t\u00a0]*(?=\p{Lu}\p{Ll})/gu;
  for (const pattern of [abbreviations, initials]) {
    for (const match of text.matchAll(pattern)) {
      for (let i = match[0].indexOf('.'); i !== -1; i = match[0].indexOf('.', i + 1)) periods.add(match.index + i);
    }
  }
  return periods;
}

/** Case is resolved at the first source character of each grapheme, like
 * glyph styles. The default Unicode case mappings are locale-independent
 * and match ru-RU casing; lower the complete source to preserve final sigma.
 */
export function projectTextCase(source, spans) {
  const modes = new Set(spans.map(span => span.textCase));
  if (![...modes].some(mode => isTextCase(mode) && mode !== 'original')) return {text:source, intervals:null};
  const titleStarts = modes.has('title') ? wordStarts(source) : null;
  const periods = modes.has('sentence') ? sentencePeriods(source) : null;
  const lower = [...modes].some(mode => ['lower', 'title', 'sentence'].includes(mode)) ? source.toLowerCase() : null;
  const intervals = [];
  let span = 0, lowerOffset = 0, displayEnd = 0, sentenceStart = true;
  for (const {segment, index} of textGraphemes.segment(source)) {
    while (span + 1 < spans.length && spans[span].end <= index) span++;
    const mode = spans[span]?.textCase;
    const sourceEnd = index + segment.length;
    const firstCased = cased.exec(segment);
    const capitalize = mode === 'title' && firstCased && titleStarts.has(index + firstCased.index)
      || mode === 'sentence' && firstCased && sentenceStart;
    let projectedText = segment;
    if (lower !== null) {
      // Context changes the form of sigma but never its UTF-16 length.
      const next = lowerOffset + segment.toLowerCase().length;
      if (mode === 'lower' || mode === 'title' || mode === 'sentence') projectedText = lower.slice(lowerOffset, next);
      lowerOffset = next;
    }
    if (mode === 'upper' || capitalize) projectedText = segment.toUpperCase();
    if (periods) {
      if (firstCased) sentenceStart = false;
      if (/[\n!?…]/u.test(segment) || segment === '.' && !periods.has(index) &&
          !(/\p{Nd}$/u.test(source.slice(Math.max(0,index-2),index)) && /^\p{Nd}/u.test(source.slice(sourceEnd,sourceEnd+2)))) sentenceStart = true;
    }
    const displayStart = displayEnd;
    displayEnd += projectedText.length;
    intervals.push({sourceStart:index, sourceEnd, displayStart, displayEnd, projectedText});
  }
  const text = intervals.map(interval => interval.projectedText).join('');
  return {text, intervals:text === source ? null : intervals};
}

/** Find the grapheme to the right of a boundary, or containing an interior
 * position. At the terminal boundary the result is undefined. */
export function textCaseIntervalAt(intervals, offset, end = 'sourceEnd') {
  let low = 0, high = intervals.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (intervals[mid][end] <= offset) low = mid + 1;
    else high = mid;
  }
  return intervals[low];
}

export function sourceToDisplay(projection, offset, right = false) {
  if (!projection.intervals) return offset;
  const interval = textCaseIntervalAt(projection.intervals, offset);
  if (!interval) return projection.text.length;
  return right && offset > interval.sourceStart ? interval.displayEnd : interval.displayStart;
}

export function displayToSource(projection, offset, right = false) {
  if (!projection.intervals) return offset;
  const interval = textCaseIntervalAt(projection.intervals, offset, 'displayEnd');
  if (!interval) return projection.intervals.at(-1).sourceEnd;
  return right && offset > interval.displayStart ? interval.sourceEnd : interval.sourceStart;
}
