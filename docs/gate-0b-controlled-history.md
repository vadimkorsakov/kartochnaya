# Gate 0B/4: единая история WYSIWYG-сессии (изолированный spike)

База: актуальный удалённый `main` `b9abce16b5699a615851e30058b60447230e2213`.
Это merge PR #71; `c664f096a90ead3e6f637079e66b910fb5ebf190` — его предок
(проверено после `git fetch origin main`). Предыдущая диагностика:
[Gate 0B/3](gate-0b-controlled-enter.md). Её проверки сохранены.

Изменены только `tests/spikes/**`, этот тестовый отчёт и `scripts/spike-summary.cjs`.
Production, `src/**`, IndexedDB, Canvas, геометрия, алгоритм Enter и DOM-sentinel
не изменены. Строгие Gate 0A/0B остаются незакрытыми; это ограниченный smoke,
не разрешение на production-интеграцию WYSIWYG.

## Контракт стенда

`mount(value,{terminalBr:true,controlledEnter:true,controlledHistory:true,
selection:{anchor,focus}})` включает историю. `controlledHistory` по умолчанию
выключен и действует только вместе с `controlledEnter`. Без явного `selection`
используется сохранённое выделение, а при его отсутствии — конец текста.
Offsets `anchor/focus` измеряются в UTF-16; обратное направление сохраняется.

Хранилище полных снимков одно: существующие `createInlineHistory`,
`recordInlineHistory`, `moveInlineHistory` из `src/model/inline-text-history.mjs`.
Начальная запись содержит весь слой и Selection. При подтверждении операции
`recordInlineHistory` обновляет caret текущего неизменившегося снимка до Selection
перед операцией (без новой записи), затем записывает результат и конечный caret.
Это позволяет Undo вернуть выделение, которым заменяли текст. Отдельно хранится
только исходный Selection сессии для Escape; исходный слой берётся из первой
записи той же истории. Второго хранилища текста/форматирования нет.

Управляемый Enter и подтверждённые native insertText, paste, Backspace/Delete
попадают в одну историю. Символы пока записываются отдельно. Проекция истории
сохраняет metric line-height, spans, terminal BR и направленный Selection.
Перемещение курсора, повторный input от отменённого Enter и неподтверждённая
операция не добавляют записей. Новый ввод после Undo обрезает старую ветку Redo
через существующий `recordInlineHistory`.

Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y перехватываются в capture keydown с preventDefault;
браузер не создаёт второй history beforeinput для этой клавиши. Отдельный
отменяемый `beforeinput.historyUndo/historyRedo` использует тот же переход.
Команды на границах истории также предотвращают native Undo/Redo.
Escape / `cancel()` явно восстанавливает полный исходный слой и исходный Selection,
сбрасывая историю сессии к одной записи.

При fallback, активной композиции, незавершённом native beforeinput или отличии
DOM от канонического текста Undo/Redo не переходит по истории и не строит DOM.
Отменяемые команды истории поглощаются и после fallback: неподтверждённый DOM
остаётся доступен до явного восстановления. Неотменяемый history beforeinput
помечает fallback. Автоматического textarea fallback и реальной IME-композиции
нет; проверки composition guard синтетические. Существующая проверка
канонического результата native-операции не заменена произвольным diff.

## Точные результаты в Chromium и Firefox

| Действие | Текст | Caret (UTF-16) |
| --- | --- | --- |
| `A`, X, Enter, Z | `AX\nZ` | 4 |
| Undo 1 | `AX\n` | 3 |
| Undo 2 | `AX` | 2 |
| Undo 3 | `A` | 1 |
| Redo 1 | `AX` | 2 |
| Redo 2 | `AX\n` | 3 |
| Redo 3 | `AX\nZ` | 4 |

Дополнительно проверены Undo/Redo Backspace/Delete через внутренний и конечный LF,
нативный многострочный paste одной операцией, замена форматированного emoji на LF
с точным восстановлением всего слоя и `textRuns`, обратное выделение 3→1,
изменённое перед следующей операцией выделение 3→0, возврат исходного Selection
при Escape, Undo → Q → запрет Redo старой ветки, отсутствие дублирующих записей,
обе команды Redo и отдельные history beforeinput. Во всех переходах проверены
канонический текст, anchor/focus, sentinel и адаптивный line-height.

Guard-проверки сохраняют модель и индекс/длину истории при неподтверждённой
операции, грязном DOM без beforeinput, unsupported input, композиции/isComposing,
несовпадающем native input и неотменяемом history beforeinput. Последующие реальные
Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y и отменяемый history beforeinput не трогают этот DOM.
Явный Escape восстанавливает исходную сессию.

## Проверки

Добавлен ровно один сгруппированный Playwright-тест на браузер;
строгий счётчик summary увеличен с 34 до 36. Новый attachment:
`controlled-history.json` (результаты переходов, полные слои, Selection, guards).
Прежние `controlled-enter.json`, `native-caret.json`, `gate.json` сохранены.
Summary требует успешный history attachment из каждого браузера и отдельно
показывает ограниченный smoke истории, сохраняя прежние строгие gates.

Целевые проверки `controlledEnter` и истории: **4 passed**.
Итоговый прогон: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:spike`.
Итоговый `test:spike`: **36 passed, 0 skipped, 0 unexpected**.
`node scripts/spike-summary.cjs`: **execution PASS**, history limited smoke PASS
в обоих браузерах; общий строгий Gate 0A FAIL, Gate 0B FAIL в обоих браузерах.
Исходный native Enter в Chromium по-прежнему FAIL. `git diff --check`: PASS.
Браузеры: Chromium 154.0.8037.57, Firefox 157.0.
Firefox 157.0 установлен в локальный `.cache/ms-playwright`; запуск браузерных
проверок выполнен вне файловой песочницы, с локальным тестовым сервером.
`test:all` не запускался. CI: pending; merge и Production Deploy не выполняются.
