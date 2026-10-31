# Gate 0C/1: первая production-интеграция WYSIWYG

1 ноября 2026, Москва. База: проверенный удалённый main
`ba4d28e7481c4a865bef5066b7659df083fc198a` (merge PR #73);
`06f6b90ed79ed4cee3c0686f44f0550b42880846` — проверенный предок.

Эксперимент включается только `?experimentalTextWysiwyg=1`, без хранения флага
и без переключателя. Это первая интеграция, не замена textarea и не изменение
verdict строгих Gate 0A/0B. Их критерии и PNG-эталоны не изменены.

## Допустимые слои

Desktop Chromium/Firefox, горизонтальный незаблокированный текст с непустыми
textRuns и usesRichTextLayout, выключенным autoFontSize, LF, левым/верхним
выравниванием. Сплошной непрозрачный цвет, без вращения, дуги/контура, отражений,
масок/обтравки, активных эффектов, обводки и нестандартного blend mode.
Все семейства должны присутствовать в доступном списке редактора, проходить
FontFaceSet.check и давать конечные Canvas fontBoundingBox-метрики.
Это консервативный runtime-фильтр, не ограничение формата документа.

Без флага, на mobile/coarse pointer/Safari и для остальных конфигураций остаётся
старый textarea. Заблокированный слой по-прежнему вообще не открывается для ввода.
Eligibility не преобразует слой. Исчезновение textRuns при полном удалении
не прекращает уже открытую WYSIWYG-сессию.

## Связь с редактором

`src/editor/wysiwyg-session.mjs` содержит только проекцию span/Text/BR, UTF-16
Selection, break-spaces, метрический line-height, структурный terminal BR,
управляемый Enter, проверку native insertText/paste/Backspace/Delete и историю.
Production не импортирует spike, не собирает диагностические JSON и не меняет Canvas.

Поверхность находится рядом с #inlineText в #canvasHost. Геометрия копируется
из positionInlineText в документных единицах с тем же transform/zoom. Канонические
text/textRuns меняются только через replaceText после подтверждённой операции.
paintDocument продолжает исключать editingId; после закрытия Canvas снова рисует
слой. Старое textarea.value не переносится поверх WYSIWYG-модели.

История использует существующие inline-text-history снимки целого слоя и caret
в формате start/end/direction. Capture Ctrl+Z/Y направляется в сессию и отменяет
браузерное действие даже на границе истории. После закрытия вся экспериментальная
сессия публикует одно изменение в document history. Ctrl+Enter подтверждает;
Escape восстанавливает исходный слой. Blur/смена документа/выделения/история/закрытие
вкладки используют существующий финализатор, beforeunload завершает сессию перед flushSave.

До операции инспектора clean-сессия переходит в textarea с направленным Selection
и общей историей, затем работает прежняя операция. Неподдерживаемый beforeinput
отменяется, выполняется clean handoff и показывается просьба повторить действие,
если оно не выполнено. Неподтверждённое действие автоматически не воспроизводится.

Неотменяемый/неизвестный ввод, изменение вне контекста beforeinput, несовместимый DOM,
суррогатный разрыв или композиция останавливают подтверждение. Модель не получает
сырой DOM. Видимая кнопка явно восстанавливает подтверждённый текст; во время
композиции она ничего не перестраивает. При завершении проблемной сессии фактический
DOM остаётся отдельно для копирования, а документ получает только подтверждённое
состояние. Новый сеанс использует новый host; старый не может менять модель.
Неподтверждённый DOM живёт только в памяти страницы и не переживает reload/закрытие браузера.

## CR/CRLF: воспроизводитель прежнего дефекта

На базе main closeInlineText безусловно вызывал setTextValue(e, editor.value).
Для слоя `A\r\nБ` с run [0,4) bold присваивание textarea.value возвращает
`A\nБ` (установлено PR #73). Закрытие без ввода передавало этот текст в updateText:
результат `A\nБ`, run [0,3). Этот конкретный вызов существующего updateText также
проверен локально. Пользовательский воспроизводитель: импортировать такой слой,
открыть legacy textarea, нажать Ctrl+Enter, экспортировать JSON.

Добавлен узкий guard: если textarea.value равен модели после нативной нормализации
CR/CRLF, закрытие не переписывает модель. Browser-регрессия проверяет точный слой и
runs после открытия/закрытия при включённом экспериментальном флаге; WYSIWYG скрыт,
textarea остаётся редактируемым. Это **не lossless CRLF editing**: реальный ввод
в legacy textarea по-прежнему нормализует CR/CRLF. Отдельная задача — полноценный
CRLF ↔ LF UTF-16 offset-адаптер для текста, Selection и диапазонов; здесь его нет.

## Проверки

Финальный Chromium: **27 passed, 0 skipped, 0 unexpected** —
14 новых проверок реального приложения и 13 существующих inline-text/rich-text.
Использованы helpers импорта/IndexedDB/экспорта настоящего документа, не spike fixture.
Проверены:

- default textarea, подходящий opt-in rich text, mobile textarea;
- X → Enter → Z = AX\nZ, точные LF, runs, три Undo/Redo и Selection;
- форматированный emoji, удаление всего текста и продолжение ввода, Escape;
- Ctrl+Enter, один document action, Undo/Redo кнопками, IndexedDB/reload/reopen;
- native clipboard paste P\nQ, Backspace/Delete, blur, смена и закрытие вкладки;
- отсутствие красных пикселей Canvas редактируемого слоя при видимом DOM и их
  возвращение после завершения (без записи/обновления PNG-эталонов);
- точные координаты и ширина при 50/100/200% через существующий wheel zoom handler;
- auto-fit, center, недоступный шрифт, mask, CRLF → textarea, неизменный слой;
- backward Selection при handoff, реальное форматирование диапазона инспектором;
- неподтверждённый DOM, синтетические composition guards, явное восстановление,
  сохранение сырого DOM при завершении и последующее открытие новой сессии.

Firefox: **4 passed** — ввод/LF, история, document commit/persistence,
UTF-16 emoji/полное удаление/Escape, backward fallback и recovery guards.
Запуск: `MOZ_DISABLE_CONTENT_SANDBOX=1 XDG_CONFIG_HOME=$PWD/work/config
XDG_CACHE_HOME=$PWD/work/cache npx playwright test --config=playwright.wysiwyg.config.js`.
Chromium: `/usr/bin/chromium` 154.0.8037.57; Playwright Firefox 157.0.
Для обычного ввода тесты используют реальные клавиши keyboard.type; неотменяемый
программный ввод не объявлен поддерживаемым и не обходит confirmation guards.

`npm run test:source`: PASS (1 test program).
`npm run test:unit`: PASS (16 test programs).
`npm run build`: PASS. `git diff --check`: PASS.
Полный test:all не запускался. Схема IndexedDB, документный формат, cloud backups,
PNG export, mobile UI, исторический HTML и baseline PNG не менялись.

## Оставшиеся ограничения

Реальная IME не проверена и не заявлена поддерживаемой. Строгие визуальные/caret
расхождения Gate 0A/0B остаются, включая Firefox affinity пустых строк; этот PR
не закрывает эти gates. Диапазонное форматирование выполняет textarea после handoff.
CRLF-адаптер остаётся отдельной задачей. Общая надёжность асинхронного beforeunload
сохранения не расширяется этим PR. Нужен CI test:all; локального полного прогона нет.

Merge и Production Deploy не выполняются. После создания PR запуск Actions
проверяется один раз: CI pending, без ожидания и повторного опроса.
