export const listMarkerGroups = [
  { label: 'Основные', markers: [['•', 'Маркер'], ['∙', 'Точка'], ['●', 'Круг'], ['○', 'Контур круга'], ['◦', 'Малый круг'], ['⁃', 'Дефис']] },
  { label: 'Декоративные', markers: [['◆', 'Ромб'], ['◇', 'Контур ромба'], ['★', 'Звезда'], ['☆', 'Контур звезды'], ['✦', 'Четырёхлучевая звезда'], ['✧', 'Контур четырёхлучевой звезды']] },
  { label: 'Отметки', markers: [['■', 'Квадрат'], ['□', 'Контур квадрата'], ['☐', 'Пустой флажок'], ['☑', 'Флажок с отметкой'], ['☒', 'Флажок с крестиком'], ['✓', 'Галочка']] },
  { label: 'Стрелки', markers: [['→', 'Стрелка вправо'], ['⇒', 'Двойная стрелка'], ['➔', 'Широкая стрелка'], ['➜', 'Стрелка со скруглением'], ['‣', 'Треугольный маркер'], ['▸', 'Малый треугольник'], ['►', 'Треугольник вправо']] },
  { label: 'Эмодзи', markers: [['🔹', 'Синий ромб'], ['🔸', 'Оранжевый ромб'], ['🔶', 'Большой оранжевый ромб'], ['🔵', 'Синий круг'], ['🟢', 'Зелёный круг'], ['🟠', 'Оранжевый круг'], ['🔴', 'Красный круг'], ['✅', 'Зелёная галочка']] },
];

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
