# Gate 0B/5: безопасный textarea fallback в диагностическом стенде

База: удалённый `main` `657257a444561c086b12bc9796ab1b931ec6ebcf`.
PR #72 merged; `4883f900f3a093d7e9a6e86129f5e8ea9f7f50fa` — предок main
(проверено `git fetch origin main` и `git merge-base --is-ancestor`).
Изменения ограничены `tests/spikes/**`, этим отчётом и `scripts/spike-summary.cjs`.
`src/**`, production UI, Canvas, IndexedDB и пользовательские документы не менялись.

## Контракт и границы

`mount(value,{terminalBr:true,controlledEnter:true,controlledHistory:true,
safeFallback:true,selection:{anchor,focus}})` включает режим. По умолчанию он
выключен. `requestFallback()` возвращает `fallbackState()` с фазой, причиной,
`replayNeeded`, счётчиком переключений и полным confirmed snapshot: слой,
направленный UTF-16 Selection и существующая история. Snapshot — диагностическая
копия, не второе хранилище редактирования. Общая модель — `layer`; используются
существующие `replaceText`, `createInlineHistory`, `recordInlineHistory`,
`moveInlineHistory`. HTML не становится моделью форматирования.

Фазы: `confirmed`, `pending`, `composing`, `fallback-ready`, `recovery-required`.
Перед переключением проверяются отсутствие pending/composition, точный текст,
совпадение DOM с последней подтверждённой проекцией и сопоставимость Selection.
Сравнение проекции консервативно: даже изменение span с тем же текстом требует
recovery. Разбор произвольного HTML и приблизительный diff отсутствуют.

Textarea получает точный LF-текст и Selection. Сам переход не записывает историю,
не воспроизводит событие и выполняется один раз. Последующий подтверждённый ввод
textarea отменяет native default и применяет существующий replaceText в той же
истории. Поддержаны insertText, LF/Enter, plaintext paste и удаления по UTF-16 с
защитой surrogate pair. Нативные истории двух контролов не объединяются.

## Результаты сценариев

| Сценарий | Результат |
| --- | --- |
| 1. `A\r\nБ`, caret 3 → textarea → Z | **BLOCKED**: нативный textarea.value нормализует CRLF в LF |
| 2. `A` → X → Enter → fallback | `AX\n`, caret 3; история остаётся из 3 записей |
| 3. Undo / Redo после перехода | `AX`, caret 2 / `AX\n`, caret 3 |
| 4. Форматированный `A😀B` | Полный слой/textRuns и оба направления 1→3 / 3→1 сохранены; textarea replacement и Undo возвращают исходное выделение |
| 5. Отменяемый formatBold | preventDefault; текст и история неизменны; `replayNeeded` содержит невыполненное намерение |
| 6. Синтетическая композиция | DOM и фокус сохранены; после end — recovery; финальный input синхронный, поздний или отсутствующий ничего не затирает |
| 7. Неизвестный block / input без beforeinput / несопоставимый Selection / pending | recovery; confirmed, история и неподтверждённый DOM сохранены; Undo/Redo блокируются |
| 8. Повторный fallback / поздний дубликат input | Одно переключение; нет повторного применения и новой записи истории |

**Блокер сценария A нельзя считать выполненным.** В Chromium и Firefox присвоение
`textarea.value = 'A\r\nБ'` даёт `'A\nБ'`; аналогично одиночный CR превращается в LF.
Требуемый точный textarea value и caret UTF-16 нельзя передать прямым контрактом
существующего textarea. Стенд сохраняет исходные text/textRuns, caret 3 и историю
в confirmed snapshot, не строит редактируемую WYSIWYG-проекцию, показывает readonly
textarea и возвращает `recovery-required` с явной причиной. Z не применяется;
`A\r\nZБ`, caret 4 не заявляется как PASS. Автоматической нормализации модели нет.
Отдельный адаптер смещений/редактирования для нормализованного отображения здесь
не создаётся; это не было бы точным native textarea.value из условия задачи.

Бесшовны только чистые LF-переходы без невыполненного намерения, включая
форматированный текст и направленное выделение. Неподдерживаемое отменённое
действие требует явного повторения пользователем; replay автоматически не идёт.
Неподтверждённый DOM и textarea input без проверенного контракта требуют recovery:
они остаются доступны и не попадают в модель. Явный `cancel()` / Escape для LF-сессии
может восстановить исходный слой; автоматически отмена не выполняется.

Для композиции не доказан контракт итогового beforeinput/input. Таймер после
compositionend не доказывает отсутствие позднего input, поэтому даже неизменённый
DOM автоматически не переключается. Во время compositionstart…end нет mount,
скрытия host, переноса фокуса или восстановления старого текста. В textarea
композиция также оставляет native текст доступным и требует recovery. Реальная
IME, OS/browser ordering, candidate UI и мобильная клавиатура **не проверены**.
Синтетические guards не являются заявлением поддержки IME.

## Проверки

Один новый сгруппированный тест на браузер; все прежние тесты сохранены.
Attachment `safe-fallback.json` фиксирует результаты и явные CRLF/IME ограничения.
Summary требует оба attachment, строго 38 успешных тестов вместо 36 и отдельно
показывает CR/CRLF BLOCKED. Общий строгий Gate 0A и Gate 0B остаются FAIL; прежние verdict не переименованы.

Целевые Chromium/Firefox: история + fallback — 4 passed; после уточнения guards
fallback — 2 passed.
Единственный итоговый `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:spike`:
**38 passed, 0 skipped, 0 unexpected** (44.5 s).
`node scripts/spike-summary.cjs`: execution PASS; clean fallback/recovery guards —
PASS (limited smoke) в обоих браузерах; CR/CRLF BLOCKED; реальная IME unverified.
Общий Gate 0A FAIL (Chromium line boundary PASS, Firefox FAIL); Gate 0B FAIL в обоих
браузерах. Предыдущая логика строгих verdict не изменена.
`git diff --check`: PASS; `git diff --quiet -- src`: PASS.
Браузеры: Chromium 154.0.8037.57 и Firefox 157.0. Тесты запущены с локальным сервером
в разрешённом cloud runtime, proxy environment сохранён.
`test:all` не запускался. Merge и Production Deploy не выполняются. CI: pending.
