export const listMarkerGroups = [
  { label: 'Основные', markers: [['•', 'Маркер', 100], ['∙', 'Точка', 100], ['●', 'Круг', 72], ['○', 'Контур круга', 80], ['◦', 'Малый круг', 100], ['⁃', 'Дефис', 100]] },
  { label: 'Декоративные', markers: [['◆', 'Ромб', 72], ['◇', 'Контур ромба', 76], ['★', 'Звезда', 72], ['☆', 'Контур звезды', 76], ['✦', 'Четырёхлучевая звезда', 76], ['✧', 'Контур четырёхлучевой звезды', 80]] },
  { label: 'Отметки', markers: [['■', 'Квадрат', 75], ['□', 'Контур квадрата', 80], ['☐', 'Пустой флажок', 72], ['☑', 'Флажок с отметкой', 72], ['☒', 'Флажок с крестиком', 72], ['✓', 'Галочка', 82]] },
  { label: 'Стрелки', markers: [['→', 'Стрелка вправо', 95], ['⇒', 'Двойная стрелка', 85], ['➔', 'Широкая стрелка', 78], ['➜', 'Стрелка со скруглением', 78], ['‣', 'Треугольный маркер', 100], ['▸', 'Малый треугольник', 95], ['►', 'Треугольник вправо', 72]] },
  { label: 'Эмодзи', emoji:true, markers: [['🔹', 'Синий ромб', 84], ['🔸', 'Оранжевый ромб', 84], ['🔶', 'Большой оранжевый ромб', 60], ['🔵', 'Синий круг', 60], ['🟢', 'Зелёный круг', 60], ['🟠', 'Оранжевый круг', 60], ['🔴', 'Красный круг', 60], ['✅', 'Зелёная галочка', 64]] },
];

const markerScales = new Map(listMarkerGroups.flatMap(({markers}) => markers.map(([glyph,,scale]) => [glyph, scale])));
// U+2611 can also fall back to a color-emoji font in its default presentation.
const emojiMarkers = new Set(['☑', ...listMarkerGroups.filter(group => group.emoji)
  .flatMap(({markers}) => markers.map(([glyph]) => glyph))]);
export const isEmojiListMarker = glyph => emojiMarkers.has(glyph);
export const listMarkerPercent = ({listMarkerScale, listKind, listMarker}) => listMarkerScale === 'auto'
  ? (listKind === 'bullet' ? markerScales.get(listMarker) ?? 100 : 100)
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
