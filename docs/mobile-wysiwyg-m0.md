# Mobile WYSIWYG M0: архитектура и проверка реализуемости

Исследование для [#149](https://github.com/vadimkorsakov/kartochnaya/issues/149).
База: актуальный `origin/main` от 13 ноября 2026,
`7a2c864bf26bc02319983b0cfc5a57dfa59d1dea` (merge #147).
Ветка: `research/mobile-text-wysiwyg-m0`.

**Решение M0: оба варианта пока закрыты для включения.** A не сохраняет
нативную геометрию при mixed typography и Justify; B даёт точную проекцию
начала фрагментов, но текущая сессия не принимает IME composition и при открытии
мобильной панели возвращается в textarea. Самый безопасный следующий шаг — M1
на существующем textarea: строгая адресация команд и история; оформленный текст
показывать после выхода либо в отдельном, явно обозначенном preview. Такой
preview не называть WYSIWYG. Допуск M2 требует нового доказательства IME/touch.

В M0 нет изменений `src/`, формата JSON/ZIP, IndexedDB v3, production-контракта,
PNG-эталонов и порогов. `eligibleWysiwyg()` сохранён. Merge и production deploy
не выполняются. Физического Android и iOS в этой проверке нет.

## 1. Текущая архитектура мобильного редактирования

Карта аудита (ссылки на функции устойчивее номеров строк):

| Участок | Реальное поведение |
| --- | --- |
| `src/editor.js`, `openInlineText()` | `eligibleWysiwyg()` исключает narrow/coarse/Android/iOS. Открывается нативный `#inlineText`, копируется `element.text`. Горизонтальному обычному тексту назначается `createInlineHistory`; для legacy Justify сессия не создаётся. |
| `positionInlineText()` | Один CSS font/size/lineHeight/letterSpacing/color/textAlign на весь textarea. Рамка в единицах документа, transform с zoom/rotation. `textRuns` в CSS не проецируются. |
| `paintDocument()` | При редактировании исключает активный слой из Canvas selection-pass; обычный textarea является единственным видимым текстом. Export рисует полный документ. |
| `beforeinput` / `input` textarea | Сохраняют заменяемый UTF-16 интервал; `updateText`/`editTextWithHistory` переносят sparse runs. До форматирования действует нативная история ввода; после — session history. |
| `inlineStyleRange()` | Возвращает только непустой сохранённый диапазон при наличии inlineSession. `null` означает несколько разных причин, включая неподдерживаемый режим, а не только отсутствие выделения. |
| `styleInlineSelection()` | Применяет `applyTextStyle`, сохраняет runs, reference size, пересчитывает fit/position; preview не записывает отдельную history state, `final` записывает. Для legacy Justify есть ранний отказ по реальному `inlineCaret`. |
| `mobileV36Property()` / `changeProperty()` | Пробуют range, затем layer. Если range-маршрут возвращает false, generic layer write остаётся возможным. |
| `mobileV36ApplyColor()` | Solid textColor сначала пробует range; gradient/effect routes меняют слой. |
| `mobileV36Format()` | Bold/italic используют range только при truthy `inlineStyleRange`; alignment, case, lists идут напрямую в слой/текст. U/S идут через `toggleTextDecoration`. |
| `mobileV36Render()` | Большинство полей читают слой; размер читает первый стиль диапазона. Только U/S имеют явный mobile Mixed. Существование кнопки не подтверждает адресацию и history. |

Канон — `element.text` + sparse `textRuns` с UTF-16 offsets;
`textRunsBaseFontSize` сохраняет масштаб run sizes при auto-fit.
`src/model/rich-text.mjs` нормализует runs, расширяет границы surrogate pair,
предоставляет `applyTextStyle`, замену и перенос стилей. Полной нормализации
границ grapheme/ZWJ там нет.

`src/render/rich-text-layout.mjs` строит строки, baseline, фрагменты и decoration
rects через Canvas metrics и `Intl.Segmenter`. `layoutJustified()` расширяет
внутренние U+0020 только на soft-wrapped строках, оставляет LF исходными
символами; выдаёт source carets. `mixedTextLayout()` выбирает общий layout.
`paintHorizontalTextPass()` из `src/render/text-stroke.mjs` используется Canvas,
экспортом и Canvas ink contenteditable. Создавать второй mobile layout не нужно.

## 2. Матрица возможностей и ограничений

Обозначения: **Т** — выполненный browser test; **К** — вывод из кода, без
подтверждения конкретного mobile control в этой работе; **—** — отсутствует или
неприменимо; **?** — не проверено. «Живое» означает видимый текст **во время
textarea-ввода**, а не скрытый Canvas/корректный PNG после Done. Range-колонка
относится к обычному горизонтальному тексту, кроме явно указанных исключений.
Whole-layer значения являются defaults; существующие run overrides могут их
перекрывать. Это не всегда команда «одинаково переформатировать каждый символ».

| Функция | Весь слой | Выделенный диапазон | Живое отображение | Mixed | Undo/Redo |
| --- | --- | --- | --- | --- | --- |
| Шрифт и начертание | К: defaults; bold/italic напрямую | Т: family/bold/italic; К: variant; Justify: bold меняет слой (Т), italic — тот же путь (К) | К: базовый font; range — после Done (Т) | К: mobile chips и B/I читают слой; общего Mixed нет | Т: базовая session history; К: не все controls доказаны |
| Размер | К: reference size + auto-fit off | Т: numeric, повтор, slider keyboard; Justify отклоняется (К) | К: base size; range не отображается | К: первый span, не Mixed | Т: несколько изменений и Ctrl+Z/Y; pointer drag атомарность отдельно не доказана |
| Цвет и непрозрачность | Т: цвет в общей регрессии; К: `opacity` — композитинг слоя | Т: solid textColor; К: fillOpacity есть в dispatcher, отдельного mobile range alpha control нет; `opacity` не range | Т: textarea остаётся базового цвета; range после Done/PNG | К: swatch/alpha читают слой | К: цвет final пишет session; отдельный alpha gesture ? |
| Underline / Strikethrough | Т: layer toggle + legacy aliases; К: очистка overrides | Т: range через applyTextStyle; К: Justify отказ | К: textarea decorations не проецирует | Т: true/false; К: U/S также умеют mixed | Т: ranges/whole-layer; К: history через session formatted |
| Letter spacing / Line height | К: общие свойства + fit | Т: tracking; К: lineHeight для horizontal range; Justify отказ | К: базовые интервалы; range после Done; разные row heights расходятся с textarea | К: mobile spacing panel читает слой | К: final записывает state; drag и смена поля требуют M1 |
| Stroke / Width / Opacity / Style | К: слой; основной mobile sheet даёт width/color | К: width/color через dispatcher; legacy strokeOpacity/strokeStyle возвращают false и уходят на слой; отдельных кнопок этих двух в mobile stroke sheet нет | К: textarea stroke не рисует | К: mobile sheet читает слой | К: generic/session commit; конкретные mobile жесты ? |
| Left / Center / Right / Justify | К: прямое изменение textAlign | —: сознательно слой; К: переход left→justify внутри существующей session требует проверки lifecycle | К: CSS alignment; Т: Justify painter/native hit geometry расходится | —: одна геометрия слоя | К: commit; точная атомарность перехода и возврата ? |
| Вертикальное выравнивание | К: свойство verticalAlign | —: слой | К: `positionInlineText` не проецирует verticalAlign padding; painter применяет его после выхода | — | К: generic commit; отдельный mobile undo ? |
| Auto-fit | К: setTextAutoFont, меняет базовый размер | —: слой; ручной range size отключает fit (К) | К: базовый fontSize обновляется; mixed row heights остаются невидимыми | — | К: commit; отдельный жест ? |

Дополнительные операции из #149: case и списки преобразуют весь текст с
переносом runs (`transformText`/`replaceText`); градиенты, effects, маски, opacity,
геометрия, rotation, text mode, arc/path/boundary — операции над слоем. Их следует
помечать «Весь слой» и не предлагать как range formatting. Горизонтальное и
вертикальное выравнивание, auto-fit также должны остаться layer-only. Line height
**не** переводить в layer-only: текущая модель уже поддерживает range leading.

Существующий дефект, подтверждённый обычной сборкой: selected word + legacy
Justify + mobile Bold меняет `fontWeight` слоя без изменения runs. Причина:
`inlineSession=null` → `inlineStyleRange()=null` → прямой write в
`mobileV36Format()`. Цвет того же выделения корректно отклоняется с toast.
Аналогичный риск italic следует из той же ветви кода. M0 фиксирует отрицательный
результат, не нормализует его как допустимый fallback. Это первый блокер M1.

## 3. Проблемы выделения и сохранения фокуса

`rememberInlineCaret()` читает selectionStart/End/Direction **только** пока
textarea владеет фокусом. Поэтому поздние select/selectionchange от поля свойств
не перетирают range. На blur активным элементом обычно уже стал другой узел:
сохранение должно произойти раньше, в capture pointerdown/mousedown панели.
Для touch handles слушается также document selectionchange.

`restoreInlineCaret(false)` восстанавливает диапазон без отъёма numeric/HEX focus;
`true` возвращает textarea focus с preventScroll. Ограничение offsets длиной
текста предотвращает выход за конец, но не проверяет revision, новый слой и
grapheme boundaries. Для contenteditable направление выводится из anchor/focus;
для collapsed selection это не тот же трёхзначный direction, что у textarea.

Фактически выполнено:

- Исходный touch suite: два последовательных native touchscreen tap выбирают
  «Привет»; family → bold → color удерживают диапазон; Done/Canvas/PNG подтверждены.
  Это Chromium touch emulation, без системных handles и long-press телефона.
- Numeric input получает собственный focus. Replay поздних collapse/select events
  не меняет сохранённый word range; Enter возвращает фокус и selection.
- M0: обратный диапазон с русским текстом, целым emoji/ZWJ, повторный numeric size,
  slider ArrowRight, Ctrl+Z/Y сохраняют text и direction. Для slider это native
  keyboard input/change, **не физический drag**. Сравниваются точные model snapshots до/после Undo и Redo;
  один `insertText` после форматирования также отменяется до прежнего snapshot.
- Исходные 360/390 tests проверяют resize/VisualViewport mock, zoom, pinch через
  CDP, закрытие/повторное открытие, Done, Back, сохранение и Undo. Они не открывают
  системную IME. Историческая физическая проверка Brave в
  [mobile-ime-diagnostics.md](mobile-ime-diagnostics.md) касается viewport gap,
  не квалифицирует новый WYSIWYG.

Пока не подтверждены реальные touch handles, long-press, drag через несколько
строк, Android composition/autocorrect после панели, split grapheme formatting.
Искусственный setSelectionRange проверяет snapshot/restore, не распознавание
жеста ОС. Точность выбранного UTF-16 интервала и визуальные координаты — разные
контракты. Модель защищает surrogate pairs, но может разрезать ZWJ/combining
sequence между валидными UTF-16 offsets; M1 нужен grapheme policy без миграции.

## 4. Результаты эксперимента textarea + live preview

Изолированный harness компилирует реальное приложение через `compileHTML()` и
добавляет только в перехваченную Playwright HTML response узкий `mobileM0` bridge.
Доступ к production functions нужен для измерений, не поставляется пользователям.
Ни flags, ни eligibility в production не меняются. Исходный/negative test без
harness отдельно подтверждает обычный mobile gate.

A рисует `mixedTextLayout()` + `paintHorizontalTextPass()` в Canvas перед
textarea, копирует его position/transform и делает glyph color textarea
прозрачным; textarea остаётся pointer/focus/selection/IME surface с native caret.
Фикстура в harness: 320×480 документ, рамка 288×400, длинный русский текст,
несколько абзацев, LF/пустая строка/двойные пробелы, emoji и семейный ZWJ,
красное подчёркнутое слово, зачёркнутое слово, размеры 18/22/34, left и Justify.
Viewport: 360×640 и 390×844 CSS px.

Из painter fragments выбираются 16 видимых позиций начала grapheme. Native
single tap в эти позиции проверяет настоящий textarea selectionStart. Между
тапами 550 ms, чтобы не измерять double/triple-tap. Контроль — та же рамка и текст
без runs, left: 8 проб, нулевые расхождения в обоих viewport. Контроль нужен,
чтобы не принять ошибку измерителя/transform за проблему mixed layout.

Измерения и JSON приложены в [mobile-wysiwyg-m0-results.json](mobile-wysiwyg-m0-results.json).
| Viewport | A left: ошибочные taps | A Justify: ошибочные taps | Контроль без runs | B max fragment-start error |
| --- | --- | --- | --- | --- |
| 360×640 | 16/16 | 16/16 | 0/8 | 0.080085 px |
| 390×844 | 16/16 | 16/16 | 0/8 | 0.080077 px |

Исследовательские снимки (эмуляция, без системной клавиатуры):

| Viewport | A left | A Justify | B после synthetic IME stop |
| --- | --- | --- | --- |
| 360×640 | [PNG](screenshots/mobile-wysiwyg-m0/A-360-left.png) | [PNG](screenshots/mobile-wysiwyg-m0/A-360-justify.png) | [PNG](screenshots/mobile-wysiwyg-m0/B-360.png) |
| 390×844 | [PNG](screenshots/mobile-wysiwyg-m0/A-390-left.png) | [PNG](screenshots/mobile-wysiwyg-m0/A-390-justify.png) | [PNG](screenshots/mobile-wysiwyg-m0/B-390.png) |

Для mixed размеров и Justify положительный допуск не получен. Даже если совпал
один цветовой run, font/size/spacing меняют переносы, baseline и hit geometry;
Justify растягивает пробелы иначе, чем native textarea. Прозрачность glyphs не
меняет нативную каретку, selection highlight и маркеры.

После открытия size panel выполнен layout resize на −220 CSS px и повторное
позиционирование preview; редактор/Done остаются видимы. Это surrogate viewport,
не клавиатура, не доказательство отсутствия occlusion на Android. В эксперименте
нет постоянного production overlay и компенсационных смещений. **A отклонён как
универсальный live WYSIWYG.** Отдельный preview без наложенной нативной каретки
остаётся безопасной возможностью, с честной маркировкой.

## 5. Результаты эксперимента contenteditable

B явно вызывает существующий `startInlineWysiwyg()` из test bridge на той же
реальной модели, создавая штатную inline history. Gate не удаляется, эксперимент
не является mobile opt-in feature. Проверяется существующая desktop-сессия,
а не новая mobile модель.

Проекция берёт общие строки и fragment advances, использует реальные LF,
абсолютные строки, inline spans и wordSpacing для expanded spaces. Измерены
45 непустых фрагментов, 14 строк: DOM Range в начале фрагмента сравнивается с
Canvas x в единицах документа; максимум около 0.08 px. Это проверка **начала
фрагментов по X**, не полная точность каждого caret, baseline, soft-wrap affinity,
пиксельная Canvas/PNG parity или доступность нативных handles.

При открытии мобильной панели size возникает fallback: capture
`routeWysiwygPanelAction()` не распознаёт `data-mobile`/`data-mp-key` как desktop
safe controls. Сессия отдаёт range в textarea. Такой переход нельзя принять за
успешное continuous live editing. После resize кандидат явно монтируется заново
только для независимого исследования ввода; это не предлагаемый UX.

Обычный `insertText` подтверждается. Затем synthetic compositionstart /
noncancelable insertCompositionText / compositionend приводит к видимому
`#wysiwygRecovery`, `clean()=false`, canonical element не меняется. Код явно
откладывает reconciliation при composition и требует восстановления после
compositionend. Это сохранность подтверждённых данных, но непригодный контракт
для непрерывного Android typing. Порядок реальных Android IME событий этим replay
не устанавливается. `insertReplacementText`/прочие неизвестные inputType также
не входят в whitelist; cancelable intent вызывает fallback, noncancelable — stop.
Paste поддержан как plain text для подтверждённых intents; Android keyboard
paste, autocorrect, native DOM mutations после composition не квалифицированы.

Justify pointer correction в session ограничен `isTrusted && pointerType==='mouse'`.
Touch long-press/handles/expanded-space affinity нельзя считать исправленными
desktop mouse logic. **B не готов к мобильному включению.**

| Среда | Статус |
| --- | --- |
| Linux Chromium 154.0.8037.57, touch emulation | Измерены геометрия/selection/dispatch; synthetic IME выявляет stop |
| Android Chrome | Физическая проверка отсутствует; composition, handles, viewport, autocorrect открыты |
| Android Brave | Для прежнего textarea есть историческое подтверждение viewport policy; B и новый overlay не проверены |
| iOS Safari / WebKit | Отдельный закрытый gate; окружение и физический iPhone отсутствуют, поддержка не заявлена |

## 6. Сравнение вариантов

| Критерий | A: textarea + наложенный Canvas | B: существующий contenteditable | Безопасный текущий путь |
| --- | --- | --- | --- |
| Геометрия | Native caret/handles расходятся при mixed metrics/Justify | Общие строки дают близкие начала фрагментов; touch hit/affinity открыты | Native textarea для ввода, результат после Done/отдельный preview |
| Сложность | Painter прост; синхронизировать неподконтрольную геометрию textarea нельзя CSS-цветом | Переиспользование велико; composition transaction и mobile dispatch требуют работы | Небольшой единый dispatcher, range snapshots, history |
| Производительность | Дополнительный Canvas paint/raster при каждом preview/resize | DOM rows/fragments + projection/metrics + иногда Canvas ink | Существующие caches; preview по явному запросу |
| IME | Нативная textarea сохраняет ввод, но визуальные handles не соответствуют ink | Recovery вместо принятия composition; блокер | Существующая textarea, без новых IME interception |
| Панели/viewport | Нужны scroll/selection/paint sync; resize surrogate недостаточен | Сейчас panel fallback; focusout/Back также требуют Android контракта | Сохранить resizes-content и текущие anchors |
| Совместимость | Full parity не подтверждена уже в эмуляции | Android Chrome/Brave и iOS не квалифицированы | Текущий fallback + физическая приёмка новых команд |
| Вердикт | Stop для универсального overlay | Research-only, gate закрыт | Рекомендовано для M1 |

Время кадра, память на длинных документах и battery не измерялись на телефоне.
Число DOM fragments и дополнительные passes — оценка стоимости по коду,
не performance benchmark. До допуска M2 измерить p50/p95 input-to-paint, long
frames и память на реальном Android с согласованным бюджетом.

## 7. Рекомендуемая архитектура

Общий document/run/layout/painter/history остаётся каноном. Выделение — временное
состояние editing session, не часть сохранённого документа. Мобильные панели
получают состояние и посылают команды через один adapter. Предлагаемый API:

```ts
type Target =
  | {kind: 'layer'; elementId: string; revision: number}
  | {kind: 'range'; elementId: string; revision: number;
     start: number; end: number; direction: 'forward'|'backward'|'none'}
  | {kind: 'unsupported'; reason: string};

captureTarget(): Target; // на pointerdown/focus transfer, пока текст владеет range
queryStyle(target, keys): Record<string, {kind:'value', value:unknown}|{kind:'mixed'}>;
beginGesture(target, key): GestureToken;
preview(token, value): {ok:true}|{ok:false, reason:string};
finishGesture(token): void;
cancelGesture(token): void;
resumeTyping(target): void;
```

Это контракт для M1, не API, реализованный в M0. Panel не получает element для
прямой записи. Adapter проверяет session/element/revision/composition/locked и
capabilities **до** layer fallback. Непустой native range в неподдерживаемом
режиме даёт `unsupported`, никогда `layer`. Отсутствие редактирования и collapsed
range дают явно layer semantics; layer-only команда требует видимой подписи
«Весь слой». При смене документа/слоя token инвалидируется.

Range patch → существующий `applyTextStyle` с reference size normalization;
layer command → существующий path с явно определённой политикой overrides.
Mixed вычисляется по всем intersecting `richTextSpans`, включая gaps с defaults,
а не только первой позиции. Mixed не является значением для записи. Пустое
числовое поле — no-op; B/I при Mixed приводят диапазон к явно выбранному состоянию.

Gesture хранит исходный element snapshot и immutable Target; preview всегда
считает от начала жеста. Partial preview не создаёт Undo state, не публикует
неподтверждённую композицию и не должен сохраняться в документ как отдельный шаг.
`finishGesture` валидирует и записывает один результат через общую history;
повторный finish/no-op ничего не добавляет. Если previews временно меняют canonical
model, save pipeline должен видеть только подтверждённое состояние; это нужно
явно согласовать с текущим saveSoon/recordInlineSession, не добавлять вторую
модель. Cancel восстанавливает snapshot без отдельного Undo. Pointercancel policy
должна быть выбрана явно (текущий mobile interaction сохраняет последний preview).
Не менять её скрытно: M1 тестирует принятую политику и смену панели/слоя.

Для composition панельные команды откладываются либо явно отклоняются до
завершения native ввода, сохраняя snapshot; нельзя перепроецировать DOM активной
композиции. Для будущего B нужен общий session input transaction: стабильный
pre-composition range, чтение подтверждённого результата, применение через
`replaceText`, один history step, восстановление selection. Непроверенные DOM
остаются recovery-only. Это отдельная исследовательская задача, не обещание
минимальной правки gate.

## 8. План M1, M2, M3

**M1 — точное следующее задание, один небольшой Draft PR:**

1. Сохранить textarea, gates, формат документов и viewport policy. Добавить
   transient selection target adapter без рефакторинга монолита.
2. Первым regression воспроизвести selected word + legacy Justify + Bold/Italic:
   команда должна дать отказ с объяснением, `element` и history не меняются.
   Так же закрыть range→layer fallthrough для stroke alpha/style и specialized
   modes; alignment/verticalAlign/auto-fit/effects обозначить как «Весь слой».
3. Провести family/variant/B/I/size/solidColor/U/S/tracking/lineHeight/stroke
   width/color через один range dispatcher, не менять renderer. Недоступные
   range controls отключать с причиной. Не обещать alpha/style без mobile UI.
4. Сохранить start/end/direction перед focus transfer; проверить element/revision;
   нормализовать user range по grapheme без изменения persisted offsets/schema.
   Выделение не превращается в «весь слой» при неизвестной capability.
5. Для одного scalar control (size) довести общий gesture begin/preview/finish:
   slider pointer drag + numeric change/Enter + stepper. Один законченный жест —
   один Undo; несколько gestures — несколько Undo; Redo восстанавливает точные runs,
   direction и reference size. Затем использовать тот же adapter для остальных.
6. Выводить Mixed выбранного диапазона в mobile controls; pending numeric/HEX
   input не перезаписывать при capture selectionchange. Без selection — явно layer.
7. Адресные тесты 360/390: tap word, forward/backward multiline selection, delayed
   selectionchange после blur, повторное форматирование, drag/cancel, numeric Enter,
   Cyrillic/emoji/ZWJ/UTF-16, input→style→input→Undo/Redo, Done/save/reload/PNG,
   Justify refusal без изменения слоя. Не обновлять PNG-эталоны.
8. Физическая приёмка Android Chrome/Brave. WYSIWYG остаётся выключенным.

M1 готов, когда отрицательные scope tests не меняют весь слой, snapshot переживает
панели, exact history assertions проходят, старые документы и exports сохраняются.
Наличие кнопок и зелёная эмуляция сами по себе не критерий готовности.

**M2 — gated feasibility, затем opt-in только при положительном результате:**
сначала отдельная проверяемая composition reconciliation общей сессии B, затем
mobile dispatch без принудительного fallback, native handles/long-press/Justify
space affinity и VisualViewport. Повторить caret **внутри** фрагментов, baseline,
soft-wrap/LF/empty-row affinity и Canvas↔PNG/overlay parity с существующими
порогами; измерить реальный Android input-to-paint. A не продолжать компенсирующими
координатами. Если B не проходит IME gate — оставить отдельный preview и остановить
live surface. Ни default-on, ни автоматического удаления coarse-pointer guard.

**M3 — polish/rollout после приёмки:** доступность и размер touch controls,
Mixed/unsupported feedback, safe areas/PWA/orientation/Back, document switching,
undo/auto-fit и выключение по capability. Отдельный iOS gate. Default-on только
после явной пользовательской приёмки поддерживаемых устройств и регрессий.

## 9. Риски и критерии остановки

- Native hit/selection geometry расходится с видимыми glyphs — stop overlay.
- Composition теряет текст, runs, selection или требует регулярного recovery —
  stop B; текущий эксперимент уже выявил recovery на boundary replay.
- Range-команда меняет layer из-за отсутствия session/capability — блокер M1.
- Неизвестный input/DOM, stale target, смена слоя, split grapheme — явный отказ,
  сохранение подтверждённого текста; никаких best-effort whole-layer writes.
- Один жест даёт несколько Undo, preview попадает в save, canceled gesture
  неожиданно подтверждается — остановить rollout до строгого контракта.
- Изменяется формат документа, IndexedDB v3 или интерпретация сохранённых runs —
  вне M0–M1, нужна отдельная задача.
- Проблемы viewport не скрывать константой высоты клавиатуры, offset под конкретный
  телефон или polling. Сохранить `interactive-widget=resizes-content`.

## 10. Что обязательно проверить на физическом Android

Для **Chrome и Brave отдельно** записать модель телефона, Android/browser/keyboard
versions, Gboard или используемую IME, viewport, zoom, PWA/browser mode:

1. Tap, double-tap, long-press, оба handles; прямое/обратное выделение слова,
   нескольких строк, LF и emoji/ZWJ. Сопоставить offsets и видимые границы.
2. Панель открывается с word range; swatch, slider drag, stepper, numeric/HEX и
   Enter не теряют range. Проверить повторный стиль и возврат к вводу.
3. Русская composition, подсказки/autocorrect, replacement, вставка через
   long-press и keyboard clipboard, emoji keyboard, удаление ZWJ, voice input.
4. Открыть/скрыть/снова открыть IME; Android Back и Done; смена IME на numeric,
   адресная строка сверху/снизу, поворот, PWA, safe area, pinch/manual zoom.
   Снять debugIme до/после, убедиться в отсутствии gap и occlusion handles.
5. Justify expanded spaces и границы soft-wrap/LF; caret tap, drag через строку,
   начало/конец пустого абзаца; mixed sizes и verticalAlign/auto-fit.
6. Input→style→input; Undo/Redo во время и после Done; смена документа/слоя,
   save/reload/JSON/ZIP/PNG; один gesture — один Undo, никаких изменений вне range.
7. Для B отдельно сравнить canonical model с итогом composition и убедиться,
   что не требуется recovery при обычном вводе. При неуспехе gate остаётся закрыт.

### Воспроизведение и проверки M0

```sh
npm ci
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --project=chromium tests/mobile-inline-text.spec.js tests/selected-text-touch.spec.js
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --config=playwright.mobile-m0.config.js
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --project=chromium tests/selected-text-formatting.spec.js tests/text-decorations.spec.js --grep mobile
npm run test:source
npm run test:unit
npm run build:verify
```

Путь к Chromium задаётся окружением; `/usr/bin/chromium` использован в этой Cloud
сессии. Первые попытки до npm ci/build и выбора установленного браузера были
инфраструктурными отказами (нет dist/esbuild/Playwright executable), а не дефектами
приложения. Harness также исправлен до финального прогона: import переназначает
ID, bridge должен быть внутри editor closure, mobile panel намеренно вызывает
fallback B. Эталонный контроль single tap добавлен против ложного диагноза.

Исходные адресные тесты: **34 passed**. Source: **17 passed**. Unit и данные:
**615 passed**. Build и build:verify прошли; исторические
файлы сохранены. Дополнительные mobile formatting/U/S tests: **2 passed**. Изолированный
эксперимент: **14 passed** (включая отрицательные feasibility gates). GitHub CI
учтён отдельно в сопровождающем PR. Снимки/JSON прикладываются экспериментом в `work/mobile-m0/results.json`;
они не удаляются стандартным прогоном в `test-results/`. Коммитятся компактные
измерения и шесть исследовательских снимков, не новая PNG-база. Исследовательские
`*.experiment.js` запускаются только отдельным config, штатная матрица не растёт.
