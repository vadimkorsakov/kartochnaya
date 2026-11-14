# Mobile Text M1.1: безопасная цель форматирования

База: `d94f86d226a7d5b98547a1ad8f59938b4bf88c3b`, #151, родитель #149,
исследование #150 / `mobile-wysiwyg-m0.md`. M1.1 сохраняет native textarea.

## Воспроизведение до исправления

Новая регрессия `tests/mobile-text-routing.spec.js` сначала запущена на обычной
сборке main, без M0 harness. Viewport 360×640 и 390×844, touch emulation:

1. Импортировать горизонтальный текст с `textAlign: 'justify'`.
2. Открыть native textarea, выделить «Привет», UTF-16 `[0,6)`, backward.
3. Открыть штатную мобильную панель «Формат», нажать Bold либо Italic.

Все четыре проверки неизменности модели упали: Bold менял `fontWeight` всего
слоя `400 → 700`, Italic — `fontStyle: normal → italic`; `textRuns` не менялись.
Причина: `inlineSession=null` превращал `inlineStyleRange()=null` в прямую запись
свойства слоя в `mobileV36Format()`.

## Правила и маршруты

`mobileTextTarget()` возвращает `layer | range | unsupported`. Владение связано
с объектами документа, элемента и текущей native-сессии; revision меняется при
подтверждённом изменении текста и Undo/Redo. Панель помнит владельца и revision.
Проверки происходят до записи модели; отказ показывает toast и не вызывает
commit. Цель не входит в app.doc, JSON, ZIP или IndexedDB.

| Команда / состояние | Цель | Результат |
| --- | --- | --- |
| Шрифт, вариант, B/I, размер, solid color, U/S, tracking, leading, stroke width/color; horizontal left/center/right, непустой диапазон | range | Существующие applyTextStyle, textRuns, inlineSession |
| Те же команды без редактирования или с collapsed caret | layer | Существующий путь свойств слоя |
| Диапазон при legacy Justify, vertical/path/boundary/arc или отсутствии inlineSession | unsupported | Toast, неизменные текст, runs, слой и история |
| Диапазон для strokeOpacity/strokeStyle в native textarea | unsupported | Без новых мобильных контролов и fallback на слой |
| Смена документа, элемента, native-сессии или revision при открытой панели | unsupported | Требуется заново открыть панель/подтвердить выделение |
| Заблокированный слой, активная composition, неизвестное выделение | unsupported | Без форматирования |
| Граница внутри surrogate pair, ZWJ или combining sequence; нет Intl.Segmenter | unsupported | Выделить графему целиком; исходный текст не нормализуется |
| Alignment, vertical align, auto-fit, case/list, gradients/effects, geometry, text mode, layer opacity | layer | Осознанная семантика всего слоя сохраняется |

Общие пути: `mobileV36Format`, `mobileV36Property → changeProperty`,
`mobileV36ApplyColor`, `applyFontFamily`, `toggleTextDecoration`,
`styleInlineSelection`; обработчики панели проверяют владельца также перед
прямыми layer-only изменениями. Общий picker доходит до того же range dispatcher.
Legacy «Контур» в панели эффектов остаётся layer-only эффектом; его параметры
не выдаются за диапазонную обводку. Штатная stroke sheet и generic stroke
property handlers используют range dispatcher.

`rememberInlineCaret()` сохраняет native start/end/direction перед передачей
фокуса; события после blur не перезаписывают подтверждённый диапазон.
`restoreInlineCaret(false)` не отнимает фокус у числового поля или ползунка.
После Enter/кнопки возобновляется тот же диапазон, включая backward.
Панель старой revision после нового ввода отклоняет команду, даже если caret
уже collapsed. Повторное открытие панели устанавливает нового владельца. Синхронизация textarea
после преобразования текста не подтверждает старые offsets: требуется
переоткрыть редактирование. Повторные case/list сохраняют layer-only семантику,
но не подтверждают старый диапазон; обычные native input подтверждаются явно.

История остаётся существующей session/document history. Отказ не записывает
состояние. No-op не включает formatted и не добавляет состояние; завершение уже
изменённого preview по-прежнему записывает подтверждённый результат. M1.1 не
перерабатывает атомарность всех slider/pointer gestures и их save pipeline.

## Проверки и ограничения

Новые мобильные E2E проверяют штатные панели, оба viewport, отрицательный
Justify, цепочку family/size/B/color/U для left/center/right, точные соседние runs,
вариант, italic/strike, интервалы, backward selection, delayed selectionchange,
фокус numeric/slider, Cyrillic/LF/emoji/ZWJ/combining, session и document Undo/Redo,
no-op, Done, IndexedDB save/reload и PNG. Дополнительные stroke-контракты используют
существующий inspector/shared picker при mobile viewport; скрытый inspector
вызывается DOM-событием, без доступа к app или изменения production-кода.
Смена слоя/документа проверяет также безвредный replay старого DOM-контрола.
Unit отдельно вызывает настоящий resolver с изменёнными владельцами и generic
changeProperty: отказ происходит до любой мутации или commit.

Существующие mobile-inline/selected-text-touch и panel/interactions regressions
проверяют Back, viewport/keyboard-area surrogate, zoom, locked layers и сохранение.
Результаты запусков и GitHub Actions приведены в PR.

Физические Android selection handles, long-press, IME/autocorrect/composition,
Chrome/Brave и реальные экранные клавиатуры не квалифицированы touch emulation.
M1.2: атомарность preview/finish/cancel всех жестов и их истории/сохранения,
полный Mixed UI и физическая приёмка Android. Live mobile WYSIWYG остаётся
отдельным этапом. Desktop eligibility/history, painter, JSON/ZIP, IndexedDB v3,
PNG-эталоны и pixel thresholds не изменены.
