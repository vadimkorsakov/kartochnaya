# Mobile Text M1.2: Mixed и атомарные жесты

База: `2270ec8b6f29d30fb9361033b5402c36d00041db` (M1.1, #152).
Задача #153; родитель #149. Native textarea и desktop WYSIWYG gate сохранены.

## Чтение свойств

`mobileTextStyle(element, target, key)` — отдельный mobile query поверх
`richTextSpans()` / `resolveRichTextStyle()`. Каждый intersecting span, включая
наследующие gaps и LF, участвует в сравнении. Размер возвращается в эффективных
px с учётом `textRunsBaseFontSize`; aliases B/I разрешаются существующим renderer.
Результат — `{kind:'value', value}`, `{kind:'mixed'}` или
`{kind:'unsupported', reason}`. Последнее приходит также из M1.1 target resolver
для stale, composition, locked, unsupported mode и split grapheme.

| Свойство | Mobile UI при Mixed | Применение к range |
| --- | --- | --- |
| Font family | Нет произвольно выбранного chip/row, подпись «Смешано» в sheet | Существующий font dispatcher |
| Font variant | Нет выбранного варианта, подпись «Смешано» | Weight/style вместе |
| Bold / Italic | `aria-pressed=mixed`, без active | Mixed → включить для всего range; повтор → выключить |
| Font size | Пустое number field, placeholder «Смешано», range aria text | Атомарный gesture |
| Solid text color | Нет active swatch; HEX пуст, placeholder «Смешано» | Атомарный gesture, swatch — одно действие |
| Underline / Strikethrough | Mixed без active | Mixed → включить; повтор → выключить |
| Letter spacing / Line height | Пустые поля «Смешано» | Атомарный gesture |
| Stroke width / color | Та же query в существующей stroke sheet | Атомарный gesture / swatch |

Новых контролов для отсутствующих свойств нет. Legacy Effects → «Контур»
остаётся эффектом всего слоя. Desktop Mixed и `inlineSelectionStyle()` сохранены. Для U/S новый reader работает
только при непустом range: collapsed caret сохраняет прежний whole-layer Mixed
toggle по всем фрагментам, включая legacy mobileUnderline/mobileStrike.
Строки Mixed/«Смешано» — только UI, никогда patch модели. Selectionchange от
native textarea и Undo/Redo обновляют существующие DOM controls без пересоздания
панели; активное numeric/HEX поле и активный gesture защищены от перезаписи.

## Транзакция и публикация

`mobileTextBeginGesture → mobileTextPreviewGesture* → mobileTextFinishGesture`
и отдельный `mobileTextCancelGesture`. Используется прежняя inline/document
history, а не новая история редактора.

Gesture хранит ссылки на document, element, native owner и inline history;
замороженный target со start/end/direction/revision, key, исходный эффективный
style, полный исходный element snapshot, прежний formatted flag, DOM-control,
индекс слайда и набор полей, затронутых preview. Pointer начинает владение до
первого input; numeric/HEX начинают на первом допустимом preview.

Каждый preview рассчитывается от исходного snapshot через `applyTextStyle`.
Font-size reference units и auto-fit не накапливают погрешность от прошлых
preview. В canonical element временно публикуются только изменённые поля для
обычного Canvas. Нативная textarea остаётся однотипографической: это не live
mobile rich-text WYSIWYG и не overlay.

Пока gesture открыт, `recordInlineSession()` не создаёт состояния. Все входы
`saveDocumentSnapshot()` получают `mobileTextConfirmedDocument()` — копию, где
только поля preview заменены исходными; root и active slide обрабатываются вместе.
Очередь IDB получает уже отфильтрованные immutable bytes до первого await.
`flushSave()` сравнивает подтверждённую проекцию, а не live preview. Предыдущие
подтверждённые изменения того же документа по-прежнему можно сохранить.
JSON, project JSON и PNG snapshots используют ту же подтверждённую проекцию;
незавершённый preview не является экспортированным состоянием. Форматы, IndexedDB
v3 и механизмы FIFO/barrier не изменены.

Finish повторно валидирует владельцев и точный range. Изменение создаёт одну
запись прежней inline history и вызывает saveSoon. Затем canonical model становится
подтверждённой. Done публикует существующие inline states в document history
старым finalizer. Повторные pointerup/change/lostcapture/no-op не добавляют steps.
Каждое нажатие stepper — отдельное действие; два drag — два действия.

Cancel восстанавливает только поля preview, не отменяя, например, новый locked
flag; formatted возвращается к исходному. Отменённый control игнорирует поздние
input/change до нового явного focus/pointerdown. При ошибке вычисления preview
откатывается весь жест. Неизменный исходный style не добавляет reference metadata.

| Граница | Политика |
| --- | --- |
| Pointerup / pointercancel / lostpointercapture своего pointer | Подтвердить последнее допустимое значение (существующий mobile cancel contract) |
| Чужой pointer / повторное завершение | Ничего |
| Смена панели, Back, Done, blur/visibility, смена слоя/документа через штатный UI | Подтвердить перед передачей владения; при невалидном владельце откатить |
| Явный Escape из numeric/HEX | Отменить gesture; мобильный Back/Escape вне поля сохраняет прежнюю семантику |
| Невалидный numeric/HEX при подтверждении | Откатить pending gesture; без Undo |
| Native beforeinput/compositionstart | Отменить preview до изменения текста / composition |
| Stale revision/range/owner, lock, unsupported / split grapheme | Откатить, не переносить действие на слой |
| Debounce / beforeunload flush / export во время preview | Только подтверждённые поля; без скрытого finish |

## Точность размера

Шкала фиксирована на протяжении жеста: 1–100 px занимают примерно 80% track,
101–500 px — оставшиеся 20% (шаг coarse drag около 4 px). Обычный размер можно
изменять на 1 px через `−/+` и стрелки; numeric field принимает точное значение
1–500, включая дробные значения. Для Mixed первое нажатие stepper берёт
документированную нейтральную точку 24 px, затем ±1. Оно не берёт размер первого
слова. Thumb в coarse-части приближённый; точный размер остаётся в numeric field
и aria text. Активная панель не перестраивается и не меняет шкалу при пересечении
100 px. Чтобы не сжимать track на 360 px, «Авто · Весь слой» перенесено на вторую строку
существующей панели размера. Позиционирование textarea, zoom и VisualViewport не
менялись.

## Воспроизведение и измерения

На исходном main новые красные E2E: 4 failure — оба viewport, Mixed size показывает
24 вместо пустого поля, flush при held drag сохраняет промежуточные runs.
Baseline и исправление дополнительно измерены одним и тем же реальным
Playwright mouse pointer drag (32 moves, 31–32 delivered input events), отдельными свежими
browser contexts. До измерялся именно исходный SHA, собранный отдельно.

| Viewport | Версия | Preview input | IDB puts при незавершённом preview + flush | Undo после finish | Размер при drag 20→65% track |
| --- | --- | ---: | ---: | ---: | ---: |
| 360×640 | main | 32 | 1 (preview persisted) | 1 | 360 px |
| 360×640 | M1.2 | 31 | 0 | 1 | 84 px |
| 390×844 | main | 32 | 1 (preview persisted) | 1 | 344 px |
| 390×844 | M1.2 | 32 | 0 | 1 | 83 px |

Простой исходный drag уже давал один Undo; не приписываем ему невоспроизведённые
дубли. Новый контракт защищает также forced record/save, разные окончания,
no-op, cancel и вычисление от origin. Unit: 50 preview → 0 history writes во
время preview → 1 на finish; второй finish и то же change → 0 дополнительных.

E2E наблюдают публичный DOM, downloads и readonly IndexedDB; production app не
раскрывается. Color plane использует CDP touchStart + не менее 30 **доставленных**
pointermove + touchEnd/touchCancel. CDP ack не считается доставкой: helper ждёт
координаты и завершающее pointer event. Size использует настоящий Playwright
pointer drag с 32 moves, а не JS-назначение input.value.

Тесты покрывают Mixed/query, изменение границ, B toggle, точных соседей и Undo/Redo;
два drag, typing нескольких цифр + Enter, independent steppers; tracking/leading,
hue/HEX/touch plane; pointercancel/lostcapture, panel/Back/Done/document switch;
composition abort и поздний change; numeric bounds; forced flush во время preview;
Done, IDB reload, JSON import/export и PNG equality после завершения.
Unit вызывает настоящие функции adapter/lifecycle/save FIFO из исходников:
stale revision, lock, composition, owner/range/session replacement, failed preview,
reference units, root/slide snapshots и очередь записей.

Фактические финальные результаты локальных проверок и CI приведены в PR.
Скриншоты обычного/Mixed size и Mixed format — в `docs/mobile-text-m12/`.

## Android и M2

Playwright touch emulation не квалифицирует Android Chrome/Brave, реальные
selection handles, long-press, Gboard/autocorrect, IME и экранную клавиатуру.
Composition/keyboard-area/Back проверены в доступной браузерной эмуляции;
физическая приёмка остаётся за пользователем.

M2: gated composition reconciliation общего WYSIWYG session; native handles,
long-press и Justify caret/space affinity; измерение реального Android
input-to-paint; capability и opt-in gate. Desktop contenteditable на Android,
Canvas overlay и новая модель текста этим этапом не добавляются.
