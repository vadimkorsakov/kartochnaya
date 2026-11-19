import {richTextSpans, resolveRichTextStyle} from '../render/rich-text-layout.mjs';

// Read effective document units, including inherited gaps and LF. This is a
// mobile adapter; desktop retains its own Mixed and caret-affinity contracts.
export function mobileTextStyle(element, target, key) {
 if (!element || target.kind === 'unsupported') return {kind:'unsupported',reason:target.reason};
 const read = style => {
  if (key === 'fontVariant') return `${style.fontWeight}:${style.fontStyle}`;
  if (key === 'bold') return Number(style.fontWeight) >= 600;
  if (key === 'italic') return style.fontStyle === 'italic';
  if (key === 'textColor' || key === 'stroke') return String(style[key]).toLowerCase().replace(/^#([\da-f])([\da-f])([\da-f])$/, '#$1$1$2$2$3$3');
  return style[key];
 };
 const styles = target.kind === 'range'
  ? richTextSpans(element).filter(p=>p.start<target.end&&p.end>target.start).map(p=>p.style)
  : [resolveRichTextStyle(element)];
 if (!styles.length) return {kind:'unsupported',reason:'Выделение пусто.'};
 const values=styles.map(read);
 if (values.some(v=>v===undefined)) return {kind:'unsupported',reason:'Свойство недоступно.'};
 return values.every(v=>v===values[0])?{kind:'value',value:values[0]}:{kind:'mixed'};
}
