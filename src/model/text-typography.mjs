export const typographyDefaults = Object.freeze({
  quotes:true, nestedQuotes:true, emDash:true, minus:true,
  multiply:false, marks:false, fractions:false, nbsp:true,
});
export const nbspDefaults = Object.freeze({
  shortWords:true, particles:true, units:true, initials:true,
  dates:true, designations:true, dash:true,
});

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function flags(value, defaults) {
  if (value === undefined) return {...defaults};
  if (!record(value)) return undefined;
  const result = {...defaults};
  for (const key of Object.keys(defaults)) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== 'boolean') return undefined;
    result[key] = value[key];
  }
  return result;
}

export function normalizeTypography(value) {
  if (!record(value) || !Object.hasOwn(value, 'enabled') || typeof value.enabled !== 'boolean') return undefined;
  const rules = flags(value.rules, typographyDefaults);
  const nbspRules = flags(value.nbspRules, nbspDefaults);
  if (rules && nbspRules) return {enabled:value.enabled, rules, nbspRules};
}

/** Normalize only settings on an imported copy; the source runs stay intact. */
export function cleanImportedTypography(document) {
  let invalid = 0;
  const slides = Array.isArray(document.slides) ? document.slides : [];
  for (const canvas of [document, ...slides]) {
    if (!Array.isArray(canvas?.elements)) continue;
    for (const layer of canvas.elements) {
      if (!layer || !Object.hasOwn(layer, 'typography')) continue;
      const config = layer.type === 'text' ? normalizeTypography(layer.typography) : undefined;
      if (config) layer.typography = config;
      else { delete layer.typography; invalid++; }
    }
  }
  return invalid;
}

// Source-only recognition. Collect and merge matches before matching any rule.
// The scanner protects common forms, not arbitrary executable/source text.
const protectedPatterns = [
  /```[\s\S]*?(?:```|$)|`[^`\r\n]*(?:`|(?=[\r\n]|$))/gu,
  /(?:\b[a-z][a-z\d+.-]*:\/\/|\bwww\.)[^\s<>"«»“”]+|\bmailto:[^\s<>"«»“”]+/giu,
  /[\p{L}\p{N}._%+!-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|(?<![\p{L}\p{N}@])(?:[a-z\d-]+\.)+[a-z]{2,}(?:\/[^\s<>"«»“”]*)?/giu,
  /"(?:[a-z]:[\\/]|\\\\|\.{1,2}[\\/]|~[\\/]|\/)[^"\r\n]+"/giu,
  /(?<![\p{L}\p{N}/])(?:[a-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|\\\\|\/(?=[\p{L}._]))[^\s<>"«»“”]+|[\p{L}\d_.-]+[\\/](?=[\p{L}_.]|\d+[\\/])[^\s<>"«»“”]+/giu,
  /(?<!\d)\d{1,4}([./-])\d{1,2}\1\d{1,4}(?!\d)|(?<![\p{L}\d])[-−]?\d+(?:[.,]\d+)?(?:[-–—]|[ \u00a0\u202f]+-{1,2}[ \u00a0\u202f]+)[-−]?\d+(?:[.,]\d+)?(?!\d)/gu,
  /(?<![\p{L}\p{N}])(?:(?:§|№|раздел|пункт|п\.|глава|section|chapter) +|\d+ +)\d+\/\d+(?!\d)/giu,
  /(?<![\p{L}\d])(?:\+\d{1,3} |[78] |\+\d{1,3}(?=[(-]))?(?:\(\d{2,4}\)[ -]?\d{2,4}(?:[ -]\d{2,4}){1,2}|\d{3}[ -]\d{3}[ -]\d{2,4}(?:[ -]\d{2})?)(?!\d)/gu,
  /(?<![\p{L}\p{N}_-])--?[a-z][\w-]*(?:(?:=| +)"[^"\r\n]*"|=[^\s<>"«»“”]+| +-[\d.]+)?|(?<![\p{L}\d])(?:v?\d+(?:\.\d+){2,}|v\d+\.\d+|0x[\da-f]+)(?:[-+][\w.-]+)?|[a-z\d]+(?:[_-][a-z\d]+)+(?=[^\p{L}\d]|$)/giu,
  /(?<![\p{L}\p{N}_])[\p{L}_][\w.]*(?:\([^()\r\n]*\)|\[[^\[\]\r\n]*\])|(?<![\p{L}\p{N}_])(?:SKU|ID|ISBN|ISSN|ISO)[ :#-]+[\w/-]+/gu,
];

export function protectedTypographySpans(text) {
  const matches = protectedPatterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({
    start:match.index, end:match.index + match[0].length,
  }))).sort((a,b) => a.start - b.start || a.end - b.end);
  const result = [];
  for (const match of matches) {
    const last = result.at(-1);
    if (last && match.start <= last.end) last.end = Math.max(last.end, match.end);
    else result.push(match);
  }
  return result;
}

const openingQuotes = {'«':'»','“':'”','„':'“'};
const openLeft = /[\s([{"«“„—–:]/u;
const closeRight = /[\s)\]}»”"“,.!?;:…—–]/u;
function quotePairs(text, protectedAt) {
  const result = [], stack = [];
  for (const match of text.matchAll(/["«»“”„\r\n]/gu)) {
    const {index} = match, char = match[0], top = stack.at(-1);
    if (char === '\r' || char === '\n') { stack.length = 0; continue; }
    if (protectedAt(index, index + 1)) continue;
    const before = text[index - 1], after = text[index + 1];
    const canOpen = (!before || openLeft.test(before)) && !!after && !/\s/u.test(after);
    const canClose = !!before && !/\s/u.test(before) && (!after || closeRight.test(after));
    if (top?.close === char && canClose) {
      stack.pop();
      top.end = index;
      if (stack.length) stack.at(-1).children.push(top);
      else result.push(top);
    } else if (canOpen && (char === '"' || openingQuotes[char])) {
      stack.push({start:index, open:char, close:openingQuotes[char] ?? '"', children:[]});
    }
  }
  return result;
}

const shortWord = /^(?:а|в|во|и|к|ко|на|но|о|об|от|по|с|со|у|за|из|до|для|без|над|под|при|про)$/iu;
const particle = /^(?:бы|б|же|ж|ли|ль)$/iu;
const number = /^[+\-−]?\d+(?:[.,]\d+)?$/u;
const unit = /^(?:%|‰|₽|₴|€|\$|°[CFС]|(?:мм|см|дм|м|км|мг|г|кг|т|мл|л|м²|м³|га|с|мин|ч|Вт|кВт|Гц|кГц|МГц|руб\.?|коп\.?|mm|cm|km|mg|kg|ml|px))$/u;
const month = /^(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)$/iu;
const initial = /^\p{Lu}\.$/u;
const surname = /^\p{Lu}\p{Ll}[\p{L}\p{M}-]*$/u;
const trimRight = text => text.replace(/[,:;!?»”“)"\]]+$/u,'');
const gluedSpace = '\u00a0';

function nbspEdits(text, groups, add, protectedAt, dashes) {
  let left, shortJoins = 0, previousGap = -1;
  for (const right of text.matchAll(/[^\s]+/gu)) {
    const gap = left && text.slice(left.index + left[0].length, right.index);
    if (gap === ' ' || gap === '\u00a0' || gap === '\u202f') {
      const start = right.index - 1, end = right.index;
      const a = left[0].replace(/^[«“„"([]+/u,''), b = trimRight(right[0]);
      const word = /^[«“„"([]*[А-ЯЁа-яё]/u.test(b);
      const valid = !protectedAt(left.index, right.index + right[0].length);
      if (previousGap !== left.index - 1) shortJoins = 0;
      const short = shortWord.test(a) && word;
      const enclitic = /\p{L}$/u.test(a) && particle.test(b.replace(/\.$/u,''));
      const rule = shortJoins < 2 && (groups.shortWords && short || groups.particles && enclitic) ||
        groups.units && number.test(a) && unit.test(b.replace(/\.$/u,'')) && (!/^г\.?$/u.test(b) || !/^\d{4}$/u.test(a)) ||
        groups.initials && initial.test(a) && (initial.test(b) || surname.test(b.replace(/\.$/u,''))) ||
        groups.dates && (number.test(a) && month.test(b) ||
          /^\d{4}$/u.test(a) && b === 'г.' || /^т\.$/iu.test(a) && /^[дп]\.$/iu.test(b)) ||
        groups.designations && (/^(?:№|§)$/u.test(a) && /^\d[\p{L}\p{N}.-]*$/u.test(b) ||
          /^(?:г\.|ул\.)$/iu.test(a) && surname.test(b.replace(/\.$/u,''))) ||
        groups.dash && (b === '—' || dashes.has(right.index)) && /[\p{L}\p{N}»”)"\].,!?:;]$/u.test(a);
      if (gap !== ' ' || valid && rule) {
        if (gap === ' ') add(start, end, gluedSpace);
        if (short || enclitic) shortJoins++;
        previousGap = start;
      }
    }
    left = right;
  }
}

export function typographyEdits(text, config) {
  if (!config?.enabled || !Object.values(config.rules).some(Boolean) || !text) return [];
  const {rules, nbspRules} = config, spans = protectedTypographySpans(text), edits = [];
  const protectedAt = (start, end) => {
    let low = 0, high = spans.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (spans[mid].end <= start) low = mid + 1;
      else high = mid;
    }
    return low < spans.length && spans[low].start < end;
  };
  function add(start, end, replacement) {
    if (text.slice(start,end) === replacement || protectedAt(start,end)) return false;
    edits.push({start, end, replacement});
    return true;
  }
  if (rules.quotes || rules.nestedQuotes) for (const pair of quotePairs(text, protectedAt)) {
    if (rules.quotes && pair.open !== '„') { add(pair.start, pair.start+1, '«'); add(pair.end, pair.end+1, '»'); }
    if (rules.nestedQuotes) for (const child of pair.children) {
      // Preserve deeper trees as written, including their second-level group.
      if (child.children.length) continue;
      add(child.start, child.start+1, '„'); add(child.end, child.end+1, '“');
    }
  }
  const dashes = new Set();
  if (rules.emDash) for (const match of text.matchAll(/(?<=[ \u00a0\u202f])--?(?=[ \u00a0\u202f])/gu)) {
    const {index} = match;
    if (add(index,index+match[0].length,'—')) dashes.add(index);
  }
  if (rules.minus) for (const {index} of text.matchAll(/(?<![^\s([{=+×*/:;])-(?=\d)/gu)) {
    // A spaced number on the left is subtraction or a numeric range.
    let left = index - 1;
    while (left >= 0 && /[ \t\u00a0\u202f]/u.test(text[left])) left--;
    if (!/[\d)\]]/u.test(text[left] ?? '') && !protectedAt(index,index+2)) add(index,index+1,'−');
  }
  if (rules.multiply) for (const match of text.matchAll(/(?<![\p{L}\p{N}_.])\d+(?:[.,]\d+)? +([xх*])(?=( +\d+(?:[.,]\d+)?)(?![\p{L}\p{N}_./\\]))/giu)) {
    const end = match.index + match[0].length;
    if (!protectedAt(match.index, end + match[2].length)) add(end-1,end,'×');
  }
  const marks = {c:'©',r:'®',tm:'™'}, fractions = {'1/2':'½','1/4':'¼','3/4':'¾'};
  if (rules.marks) for (const match of text.matchAll(/(?<![\p{L}\p{N}_@/\\])\((c|r|tm)\)(?![\p{L}\p{N}_@/\\])/giu)) {
    add(match.index,match.index+match[0].length,marks[match[1].toLowerCase()]);
  }
  if (rules.fractions) for (const match of text.matchAll(/(?<![\p{L}\p{N}_/\\.+-])(?:1\/[24]|3\/4)(?![\p{L}\p{N}_/\\+-]|\.\d)/gu)) {
    add(match.index,match.index+match[0].length,fractions[match[0]]);
  }
  if (rules.nbsp) nbspEdits(text, nbspRules, add, protectedAt, dashes);
  return edits.sort((a,b) => a.start - b.start);
}
