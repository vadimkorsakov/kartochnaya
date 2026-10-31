# Gate 0B/3: управляемый Enter и канонический текст

База: проверенный удалённый `main` 9b4b7e0 (merge PR #70),
457b54bbf514ba7a483682b9d1fb5a77ec93b5d6 — его предок.
Изолированный opt-in spike; `src/**`, production UI, документы, IndexedDB,
Canvas и PNG-эталоны не изменены. Браузеры: Chromium 154.0.8037.57, Firefox 157.0.

## Результаты отдельно от исходной диагностики

| Режим | Chromium | Firefox |
| --- | --- | --- |
| Исходный native Enter, `A`, End, Enter, немедленное чтение | **FAIL: `A\n\n`, caret 2** | `A\n`, caret 2 |
| `controlledEnter`, точный текст / Selection / стили | **PASS ограниченного smoke** | **PASS ограниченного smoke** |
| Строгие Gate 0A / 0B | PASS / **FAIL** | **FAIL / FAIL** |
| История управляемого Enter | Не подключена | Не подключена |

Воспроизводитель native Enter и прежние диагностические случаи сохранены.
Результат прототипа не закрывает строгие gates и не разрешает интеграцию WYSIWYG.
Предыдущий отчёт: [Gate 0B/2](gate-0b-native-caret.md).

В обоих браузерах проверены следующие результаты (offsets — UTF-16):

| Исходный текст | Действие | Текст сразу после Enter | Caret | Затем Z / caret |
| --- | --- | --- | --- | --- |
| `A` | Ctrl+End, Enter | `A\n` | 2 | `A\nZ` / 3 |
| `A\n` | Ctrl+End, Enter | `A\n\n` | 3 | `A\n\nZ` / 4 |
| `AB` | caret 1, Enter | `A\nB` | 2 | — |
| `AB` | selection [0,2), Enter | `\n` | 1 | — |
| `A😀B` | selection [1,3), Enter | `A\nB` | 2 | — |
| `AB` | backward selection 2→0, Enter | `\n` | 1 | — |

Каждый Enter проверяется до следующего символа и до внешнего remount.
Три последовательных Enter из `A` дают `A\n`, `A\n\n`, `A\n\n\n` с caret 2/3/4;
последующая Z даёт `A\n\n\nZ`, caret 5.
Backspace в offset 2 и Delete в offset 1 строки `A\nB` дают `AB`, caret 1;
Backspace в конце `A\n\n` даёт `A\n`, caret 2;
Delete перед последним LF в `A\n` даёт `A`, caret 1.
Нативный paste форматированного HTML с plain text `P\nQ` в конечную пустую строку
даёт `A\nP\nQ`, caret 5, без HTML-разметки clipboard в host.

Проверены обе affinities всех UTF-16 offsets, включая позиции внутри surrogate
pair (доступны для mapping, но запрещены для редактирования). Отдельное
пересоздание DOM сохраняет forward/backward Selection на каждом offset в
`A😀B\n`. Стилевые диапазоны после замены emoji на LF и ввода Z точно совпадают
с результатом существующей `replaceText()`; проверены цвет и размер DOM spans.
Metric line-height сохраняется после каждой проекции, terminal BR соответствует
последнему LF. Нет дополнительных вызовов применения из `input`: каждый Enter
даёт одну модельную операцию, а искусственный повтор `input.insertLineBreak`
не меняет текст и счётчик применений.

## Контракт прототипа

`mount(value,{terminalBr:true,controlledEnter:true})` включает режим.
Оба флага по умолчанию выключены. `applyMetricLineHeight()` сохраняется при
внутренней проекции. Форматирование и его наследование полностью принадлежат
`src/model/rich-text.mjs`; второй модели диапазонов нет.

Для отменяемого `beforeinput.insertLineBreak` вне композиции и с обоими
Selection endpoints в host индекс переводит anchor/focus в канонические offsets.
DOM должен совпадать с каноническим текстом. Затем `preventDefault()`, один вызов
`replaceText(layer,min,max,'\n')`, проекция spans/sentinel и collapsed caret
`min+1`. Нативного `input` для отменённого Enter нет, pending native-транзакции нет.
Безусловного удаления завершающего LF и переписывания исходного текста нет.

`insertText`, `insertFromPaste`, `deleteContentBackward/Forward` остаются
нативными. До операции сохраняются каноническое состояние, Selection, inputType
и данные вставки (для paste — настоящий clipboard `text/plain`). После `input`
проверяются тип, неизменные prefix/suffix вокруг предыдущего выделения и данные
вставки. Для collapsed удаления направление и изменение длины задают диапазон,
затем также проверяются prefix/suffix. Лишь подтверждённый результат передаётся
в существующую `replaceText()` и проецируется с текущей Selection. Нет поиска
произвольного diff или эвристики удаления LF. Неизвестная вставка или изменение
вне контекста операции прекращают синхронизацию.

## Ограничения и fallback

При `isComposing`/активной композиции, неотменяемом beforeinput, DOM вне грамматики
Text/span/BR, Selection вне host, CR/CRLF, редактировании внутри surrogate pair,
неподдерживаемом inputType или несовпадении native-контекста режим отмечает
`controlledState().fallback`. Каноническое состояние не изменяется и опасной
перестройки DOM нет; дальнейшая синхронизация остановлена до явного mount.
Синтетические проверки композиции, noncancelable, неизвестного DOM и Selection
не заменяют реальный IME smoke-test.

Нативное событие в таком случае не отменяется и может изменить DOM. Этот DOM
нельзя автоматически сохранять как канонический текст. Будущая интеграция обязана
переключать ввод на существующий textarea, сохраняя подтверждённую модель и
отдельно неподтверждённый ввод/композицию для восстановления. Автоматический
fallback и persistence здесь не реализованы. Сам spike не сохраняет документы.

## Undo/Redo — незакрытый блокер интеграции

Последовательность `A`, native X, controlled Enter, Ctrl+Z, Ctrl+Shift+Z
в обоих браузерах оставила `AX\n`: управляемый Enter не вошёл в нативную историю.
Chromium сохранил caret 3; Firefox после Undo потерял Selection, Redo её не вернул.
`historyUndo` переводит прототип в fallback; канонический текст сохранён, повторных
применений Enter нет. Это наблюдение ограничения, а не успешная проверка Undo.

История Ctrl+Z в этом PR не исправляется. До интеграции нужно подключить
управляемый Enter и остальные изменения к существующей истории редактора
(`createTextEditHistory` / `editTextWithHistory`) с восстановлением Selection.
Полноценный WYSIWYG до этого подключения **не готов**.

## Проверки

Добавлен один сгруппированный тест на браузер: строгий счётчик summary 32 → 34.
Целевые controlled-тесты: 2 passed. Итоговый `npm run test:spike`: 34 passed,
0 skipped, 0 unexpected; `node scripts/spike-summary.cjs`: execution PASS,
controlled limited smoke PASS, исходный Chromium native Enter FAIL,
строгие общие Gate 0A/0B FAIL. `git diff --check`: PASS.

Команда итогового прогона:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:spike`.
В этой среде Firefox требует запуска тестов вне файловой песочницы (в ней
ошибка `Could not find profile folder`); браузер установлен в локальный `.cache`,
сеть использует разрешённый доступ через неизменённый `proxy:8080`, TLS включён.
Attachments: `controlled-enter.json` (события, модель, guards, Undo/Redo),
`native-caret.json` (исходный native воспроизводитель), `gate.json` (строгие gates).
`test:all` не запускался. CI: pending; merge и Production Deploy не выполняются.
