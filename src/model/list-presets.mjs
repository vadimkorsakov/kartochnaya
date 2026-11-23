import { textGraphemes } from './text-case.mjs';

export const listMarkerGroups = [
  { label: 'Основные', markers: [['•', 'Маркер', 100], ['∙', 'Точка', 100], ['●', 'Круг', 72], ['○', 'Контур круга', 80], ['◦', 'Малый круг', 100], ['⁃', 'Дефис', 100]] },
  { label: 'Декоративные', markers: [['◆', 'Ромб', 72], ['◇', 'Контур ромба', 76], ['★', 'Звезда', 72], ['☆', 'Контур звезды', 76], ['✦', 'Четырёхлучевая звезда', 76], ['✧', 'Контур четырёхлучевой звезды', 80]] },
  { label: 'Отметки', markers: [['■', 'Квадрат', 75], ['□', 'Контур квадрата', 80], ['☐', 'Пустой флажок', 72], ['☑', 'Флажок с отметкой', 72], ['☒', 'Флажок с крестиком', 72], ['✓', 'Галочка', 82]] },
  { label: 'Стрелки', markers: [['→', 'Стрелка вправо', 95], ['⇒', 'Двойная стрелка', 85], ['➔', 'Широкая стрелка', 78], ['➜', 'Стрелка со скруглением', 78], ['‣', 'Треугольный маркер', 100], ['▸', 'Малый треугольник', 95], ['►', 'Треугольник вправо', 72]] },
  { label: 'Эмодзи', emoji:true, markers: [['🔹', 'Синий ромб', 84], ['🔸', 'Оранжевый ромб', 84], ['🔶', 'Большой оранжевый ромб', 60], ['🔵', 'Синий круг', 60], ['🟢', 'Зелёный круг', 60], ['🟠', 'Оранжевый круг', 60], ['🔴', 'Красный круг', 60], ['✅', 'Зелёная галочка', 64]] },
];

const markerScales = new Map(listMarkerGroups.flatMap(({markers}) => markers.map(([glyph,,scale]) => [glyph, scale])));
export const isBuiltinListMarker = glyph => markerScales.has(glyph);
export const listMarkerMaxLength = 32; // UTF-16 units

const invalidMarkerCharacters = /[\p{White_Space}\p{Cc}\p{Cs}\p{Bidi_Control}\p{Noncharacter_Code_Point}]/u;
const otherFormatting = /(?![\u200c\u200d])\p{Cf}/u;
const emojiTagFlag = /^\u{1f3f4}[\u{e0061}-\u{e007a}]+\u{e007f}$/u;
const visibleMarkerBase = /[^\p{Default_Ignorable_Code_Point}\p{Mark}\p{Emoji_Modifier}]/u;

export function validateListMarker(glyph) {
  if (typeof glyph !== 'string' || !glyph.length || glyph.length > listMarkerMaxLength) return false;
  if (isBuiltinListMarker(glyph)) return true;
  if (invalidMarkerCharacters.test(glyph) || !visibleMarkerBase.test(glyph) ||
      (otherFormatting.test(glyph) && !emojiTagFlag.test(glyph))) return false;
  return textGraphemes.segment(glyph).containing(0).segment === glyph;
}

const emojiPresentation = /\p{Emoji_Presentation}(?!\uFE0E)|\p{Emoji}\uFE0F|[#*0-9]\u20E3/u;
const emojiJoin = /\p{Extended_Pictographic}[\p{Grapheme_Extend}\p{Emoji_Modifier}]*\u200D\p{Extended_Pictographic}/u;
// U+2611 can also fall back to a color-emoji font in its default presentation.
export const isEmojiListMarker = glyph => typeof glyph === 'string' &&
  (glyph === '☑' || emojiPresentation.test(glyph) || emojiJoin.test(glyph));
export const listMarkerPercent = ({listMarkerScale, listKind, listMarker}) => listMarkerScale === 'auto'
  ? (listKind === 'bullet' ? markerScales.get(listMarker) ?? (isEmojiListMarker(listMarker) ? 70 : 100) : 100)
  : listMarkerScale ?? 100;

export const listCounterStyles = [
  ['decimal-dot', '1. 2. 3.'], ['decimal-paren', '1) 2) 3)'],
  ['latin-lower-dot', 'a. b. c.'], ['latin-upper-dot', 'A. B. C.'],
  ['roman-lower-dot', 'i. ii. iii.'], ['roman-upper-dot', 'I. II. III.'],
  ['decimal-padded-dot', '01. 02. 03.'],
];

export function formatListCounter(number, style) {
  if (style === 'decimal-paren') return number + ')';
  if (style === 'decimal-padded-dot') return String(number).padStart(2, '0') + '.';
  if (style === 'latin-lower-dot' || style === 'latin-upper-dot') {
    const origin = style === 'latin-lower-dot' ? 97 : 65;
    let label = '';
    for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) {
      label = String.fromCharCode(origin + (n - 1) % 26) + label;
    }
    return label + '.';
  }
  if ((style === 'roman-lower-dot' || style === 'roman-upper-dot') && number <= 3999) {
    let n = number, label = '';
    for (const [value, glyph] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],
      [50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]) {
      label += glyph.repeat(Math.floor(n / value));
      n %= value;
    }
    return (style === 'roman-lower-dot' ? label.toLowerCase() : label) + '.';
  }
  return number + '.';
}
