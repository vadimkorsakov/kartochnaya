import {projectTextCase, textGraphemes} from './text-case.mjs';
import {typographyEdits} from './text-typography.mjs';

/** Typographic matches refer to canonical source. T3 casing is computed on
 * that same source and fills untouched intervals (including case expansions).
 * Incompatible style boundaries are source offsets, measured at a fixed size. */
export function projectText(source, spans, typography, styleBoundaries = []) {
  const casing = projectTextCase(source, spans);
  const edits = typographyEdits(source, typography);
  if (!edits.length) return casing;

  const graphemes = casing.intervals ?? Array.from(textGraphemes.segment(source), ({segment,index}) => ({
    sourceStart:index, sourceEnd:index + segment.length, projectedText:segment,
  }));
  const intervals = [];
  let displayEnd = 0, index = 0, boundary = 0, accepted = false;
  function append(sourceStart, sourceEnd, projectedText, atomic) {
    const displayStart = displayEnd;
    displayEnd += projectedText.length;
    intervals.push({sourceStart, sourceEnd, displayStart, displayEnd, projectedText, ...(atomic ? {atomic:true} : {})});
  }
  for (const {start, end, replacement, atomic} of edits) {
    while (graphemes[index]?.sourceEnd <= start) {
      const part = graphemes[index++];
      append(part.sourceStart, part.sourceEnd, part.projectedText);
    }
    while (styleBoundaries[boundary] <= start) boundary++;
    if (graphemes[index]?.sourceStart !== start || styleBoundaries[boundary] < end) continue;
    let next = index;
    while (graphemes[next]?.sourceEnd < end) next++;
    if (graphemes[next]?.sourceEnd !== end || /[\r\n]/u.test(source.slice(start,end))) continue;
    append(start, end, replacement, atomic);
    index = next + 1;
    accepted = true;
  }
  if (!accepted) return casing;
  for (; index < graphemes.length; index++) {
    const part = graphemes[index];
    append(part.sourceStart, part.sourceEnd, part.projectedText);
  }
  return {text:intervals.map(part => part.projectedText).join(''), intervals};
}
