# Mobile Text M1.2.1: Justify и фокус Android

Продолжение PR #154, ветка `feat/mobile-text-m12-mixed-gestures`.
Исходный HEAD: `cf84850ccd6c451f34bf552ca9e8ac3413b97d1e`.
M1.1 routing, M1.2 Mixed/gesture/save contracts сохраняются.

## Причины дефектов

Legacy Justify не получал `inlineSession` в `openInlineText()`. Дополнительно
его отклоняли `mobileTextTarget()` и legacy guard в `styleInlineSelection()`.
M1.1 предотвращал ошибочную запись Bold во весь слой, но корректный native range
также оставался недоступным.

Открытие панели сохраняло фокус textarea через pointerdown/mousedown
`preventDefault()`. После команды `resumeInlineTextFromButton()` вызывал
`restoreInlineCaret()` с фокусировкой. Numeric Enter делал то же после blur
числового поля. Ещё несколько callers (family, alignment, Undo/Redo) также
использовали default focus. `preventScroll` ограничивает прокрутку, но не
запрещает Android открывать IME.

## Передача управления панели

Transient native session хранит признак `formatting`. Это не поле документа.

1. Capture pointerdown панели сохраняет native start/end/direction.
2. `pauseInlineTextInput()` подтверждает snapshot до blur, устанавливает режим
   форматирования и снимает фокус textarea. Программное открытие панели и
   keyboard focusin настоящего поля используют тот же handoff.
3. `restoreSelectionWithoutFocus()` восстанавливает native offsets без `.focus()`.
4. `restoreInlineCaret()` сохраняет прежнюю desktop-политику, но в mobile
   formatting не фокусирует textarea. Это охватывает и family/alignment/history.
5. Mobile `resumeInlineTextFromButton()` восстанавливает только selection.
   Numeric/HEX/search Enter освобождает настоящее поле и оставляет панель открытой.
6. Явный Edit использует `resumeTextInputWithFocus()`. Обычный native tap по
   textarea также возвращает ввод; браузер сам определяет позицию этого tap.
   Deferred open callback не возвращает фокус, если панель уже получила управление.

Zoom во время обычного ввода сохраняет прежний focus/IME контракт. Zoom во время
форматирования не фокусирует textarea; открытие панели передаёт управление до
bubble обработчиков кнопок.

Явный Ctrl/Cmd+Enter из панели завершает native session без восстановления
input focus, как прежний shortcut из textarea. Done/shortcut удаляют подпись
завершённого range, даже если панель остаётся открытой.

`rememberInlineCaret(true)` допускает адресный capture до handoff/на blur, когда
`activeElement` уже сменился. Обычные поздние select/selectionchange от unfocused
textarea игнорируются. В режиме форматирования принудительный повторный capture
не подтверждает схлопнутую DOM-каретку. Owner и text revision проверяются прежним
resolver перед командой и каждым gesture preview/finish. Смена документа,
элемента, native session, неподтверждённый текст, lock и composition сохраняют
безопасный отказ; команды не переходят на весь слой.

Незавершённая composition не размыкается принудительным blur ради панели. Если
IME синхронно подтверждает новый native input внутри blur, snapshot до blur
сбрасывается: новая revision текста не подтверждает старые offsets автоматически.

Android Back и VisualViewport сохраняют прежнюю политику: Back сначала может
убрать IME настоящего поля, следующий уровень завершает session/panel. Layout
измеряется существующим `v41KeyboardViewport()`; высота клавиатуры не задаётся
константой. Новый focus/blur цикл не добавляется.

## Justify и достоверность диапазона

Мобильный горизонтальный Justify получает **ту же** `createInlineHistory`, что
Left/Center/Right. Resolver допускает range при выполнении прежних owner,
revision, locked, composition, horizontal и grapheme checks. Legacy desktop
textarea guard сохранён; desktop WYSIWYG и его Justify projection не меняются.

Источник offsets — реальная видимая native textarea, а не позиции Canvas glyphs.
Перед применением требуется `editor.value === element.text === owner.text`.
Justify растягивает пробелы визуально, но не вставляет символы в value. LF,
несколько U+0020, surrogate pairs, ZWJ и combining sequences остаются исходными
UTF-16 символами. Направление хранится отдельно от упорядоченных start/end.
Диапазон нельзя расширить до другой графемы молча: split grapheme отклоняется.

`applyTextStyle()` применяет patch по этим offsets и записывает sparse runs;
изменение Bold/family/size не вычисляет offsets заново по новой геометрии слова.
Последующие команды используют тот же snapshot. Undo/Redo и Done используют
прежнюю inline/document history, числовые/цветовые жесты — прежний M1.2 adapter.
Защита preview перед IDB/JSON/PNG не изменяется.

Native textarea по-прежнему показывает базовую типографику, а не live mixed
rich text. Оформленный результат виден после Done и в PNG. Вывод M0 о неверной
геометрии Canvas overlay остаётся в силе: overlay здесь не включается и его
координаты не используются для native hit testing.

После blur Android может убрать highlight и handles. Панель показывает
`Выделено: «Оплатить»` из подтверждённого model range. Длинная строка сокращена
до 40 графем, пробельные символы компактно показаны в одной строке. Это подпись,
а не новая геометрия выделения. Stale/unsupported target не показывается как
действительное выделение. Для pill добавлена только строка подписи; панели
сохраняют существующие контролы.

Поддержаны прежние range properties: family/variant, Bold/Italic, solid color,
size, U/S, tracking/leading, stroke width/color и существующий fillOpacity route.
По-прежнему unsupported: vertical/path/boundary/arc range, отсутствующая history,
strokeOpacity/strokeStyle в native textarea, split grapheme, отсутствие Segmenter,
locked/composition/stale/unconfirmed selection. Alignment, auto-fit, gradients,
effects, geometry, opacity и case/list сохраняют layer-only семантику.

## Регрессии

Новые реальные E2E `tests/mobile-text-m121.spec.js` сначала запущены на исходном
HEAD без исправлений: **6 failed** на 360×640 и 390×844:

- Justify Bold не создаёт run только для `Оплатить`, `[3,11)`.
- Открытие Format оставляет textarea сфокусированной.
- Numeric Enter возвращает фокус textarea.

При последующей проверке жизненного цикла ещё два красных E2E подтвердили,
что Done оставлял подпись завершённого диапазона. Первый CI также выявил прежний
mobile U/S → Ctrl+Enter сценарий в Firefox: после handoff shortcut попадал панели
и не завершал textarea. Обработчик явного finish расширен на native session;
существующие U/S, selection, hidden-editor и PNG assertions не ослаблялись.

Тесты пишут focusin/focusout/selectionchange/pointerdown и VisualViewport resize
только из тестового окружения и прикладывают журнал к результату. Production
debug bridge не добавлен. Отсутствие focusin после handoff проверяется отдельно
от сохранения offsets и конечного JSON.

Native hit-test дополнительно проверен без `setSelectionRange`-исправления
результата: два touchscreen tap выбирают слово в настоящей textarea. После
Bold, изменения size и family новый native выбор проверяется повторно.
До первого выбора включён auto-fit, строки содержат тройные пробелы и LF.

| Chromium touch emulation | Alignment | Native UTF-16 до / после изменения геометрии |
| --- | --- | --- |
| 360×640 | Justify | `Оплатить`, `[5,13)` / `[5,13)` |
| 390×844 | Justify | `Оплатить`, `[5,13)` / `[5,13)` |
| 360×640 | Left | `Оплатить`, `[5,13)` / `[5,13)` |
| 390×844 | Left | `Оплатить`, `[5,13)` / `[5,13)` |

Позиция для tap находится пробами native caret hit testing, не Canvas metrics.
Это доказательство браузерного source mapping, не приёмка Android handles/IME.

Цепочки проверяют B/I/Color/U/S, повторное отключение Italic, смену панелей,
numeric/HEX, native tap для ввода, composition replay, stale revision, Back,
Escape/cancel, Unicode, LF и двойные/тройные пробелы, Undo/Redo в session и после
Done, IDB reload, JSON round-trip и PNG equality. Routing suite дополнительно
проверяет Justify family/variant/size/tracking/leading/stroke и соседние runs.

Старые отрицательные Justify assertions заменены точными положительными range
assertions с неизменными layer defaults и соседями. Негативные проверки
специализированных режимов/PNG/history сохранены. В selected-text-touch
ожидание focus после форматирования/Enter изменено на **отсутствие focus**;
native selection, Canvas и PNG assertions сохранены. Desktop focus tests
сохраняют прежний контракт. PNG-эталоны и пороги не менялись.

Фактические результаты локальных запусков, GitHub CI, окончательный HEAD и
Deploy Preview приведены в PR #154. Неизменённый успешный полный CI повторно
вручную не запускается.

## Обязательная физическая приёмка Android Brave

Playwright проверяет DOM focus и native Chromium selection в эмуляции, но не
Gboard, реальные handles/long-press и OEM VisualViewport. **Физическая приёмка
не выполнена; PR #154 не готов к merge до успешной проверки ниже. M2 не начат.**

На `https://deploy-preview-154--kartochnaya.netlify.app` после подтверждения
публикации нового HEAD записать модель телефона, Android, Brave и клавиатуру:

1. Создать/открыть горизонтальный Justify: `До Оплатить после`, несколько строк
   и ещё один абзац. Отключить auto-fit для первого контрольного сценария.
2. Начать native ввод. Долгим нажатием и системными handles выделить `Оплатить`.
3. Открыть «Формат»: клавиатура должна скрыться, подпись должна назвать это слово.
4. Нажать Bold, затем Italic: клавиатура не открывается, панель остаётся доступной.
5. Открыть «Цвет» и выбрать красный; вернуться в «Формат», отключить Italic.
6. Открыть «Размер», нажать numeric field, ввести 28 и Enter. Цифровая клавиатура
   разрешена только на время ввода; Enter скрывает её и не возвращает текстовую.
7. Проверить интервалы, шрифт/вариант, U/S и HEX. После подтверждения поля
   клавиатура не должна возвращаться от обычной команды.
8. Нажать «Готово»: изменилось только `Оплатить`, соседи и layer defaults прежние.
9. Выполнить Undo/Redo, переоткрыть документ/перезагрузить страницу и проверить
   сохранение. Проверить JSON и PNG.
10. Повторить с backward handles, растянутыми пробелами, LF, emoji/ZWJ и е́,
    отдельно с auto-fit и после изменения font/size. Подпись должна соответствовать
    фактическому native выделению до открытия панели.
11. Проверить Android Back из numeric/HEX и панели. Явно нажать по тексту:
    клавиатура должна открыться, ввод/autocorrect/composition работать в месте tap.
12. Повторить основной сценарий с Left. Зафиксировать любые неожиданные открытия
    клавиатуры или несовпадения выбранного слова; при них приёмка не пройдена.

Merge и production deploy не выполняются.
