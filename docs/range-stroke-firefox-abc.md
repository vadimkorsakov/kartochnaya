# Firefox Windows: сравнение layer-only / range-only / redundant runs

Пользовательский дефект: Firefox 159 / Windows 10 / DPR 1,5; слойный тип обводки работает, диапазонный визуально остаётся solid. Обычный Canvas API у пользователя работает. Эти факты приняты; масштаб и глобальная поддержка dash не являются предметом исправления.

## Точные входные данные

Готовый проект: [range-stroke-abc.json](../tests/fixtures/range-stroke-abc.json). Импорт создаёт отдельный тестовый проект с тремя документами A/B/C; использовать именно импорт JSON проекта, без восстановления ZIP/workspace. Они содержат одинаковые Arial 72 px, AV fi TEST, strokeWidth 5, stroke #0030ff, strokeOpacity 100, слой fillOpacity 100 и диапазонный fillOpacity 0, документ 1080×1350, рамку x127/y413/w827/h555.

- A: слой dotted, весь диапазон задаёт только fillOpacity 0.
- B: слой solid, весь диапазон задаёт fillOpacity 0 и dotted.
- C: слой dotted, [0,3) задаёт fillOpacity 0; [3,10) задаёт fillOpacity 0 и dotted.

После разрешения наследования все три состояния должны иметь один и тот же фрагмент `[0,10)`, текст `AV fi TEST`, fillOpacity 0 и strokeStyle dotted. Лишняя исходная граница [3] не должна разделять painter-фрагменты. `styleKey` сравнивает разрешённые paint-стили; geometryKey и decoration spans исключают strokeStyle. При единственном фрагменте paint-boundary correction не применяется. Overlay и основной Canvas используют fill-pass → stroke-pass одного painter.

## Короткая процедура на пользовательском Firefox

1. Открыть актуальный Deploy Preview, импортировать проект выше. F12 → Console: выполнить содержимое [text-stroke-painter-probe.js](../tests/experiments/text-stroke-painter-probe.js). Скрипт не меняет стили, dash, transform или альфу и не обращается к сети/хранилищу; он оборачивает draw calls с сохранением `this` и аргументов.
2. В Debugger найти **paintHorizontalTextPass** (в собранном index.html; имена функции и локальных `c`, `e`, `part`, `method` сохранены). Поставить **условную точку останова** непосредственно на двух строках: `c.fillText(part.text, part.x, part.y)` и `c.strokeText(part.text, part.x, part.y)`. У обеих одно условие:

   ```js
   window.__kartochnayaStrokeProbe.mark(c, e, part, method), false
   ```

   Условие всегда возвращает false, поэтому исполнение не останавливается. Оно передаёт реальные локальные part/element перед самым native draw. Точки ставятся после установки font/letterSpacing и параметров stroke. Если Firefox предлагает несколько колонок одной строки, выбрать колонку начала вызова fillText/strokeText.
3. Для A: в Console выполнить `__kartochnayaStrokeProbe.reset('A')`. Через UI открыть текстовый слой в WYSIWYG, затем закрыть Ctrl+Enter и скачать PNG. После этого сохранить Console-командой:

   ```js
   copy(JSON.stringify(__kartochnayaStrokeProbe.report(), null, 2))
   ```

   Вставить результат в `A.json`. Повторить для B и C с соответствующими reset/именами. Размер документа и zoom между состояниями сохранять; специально менять или исправлять zoom не требуется.
4. Завершение: снять обе условные точки останова и выполнить `__kartochnayaStrokeProbe.stop()` либо перезагрузить страницу. Если остановить probe при оставленных точках, убрать их перед следующей перерисовкой.

В JSON есть реальные part.text/start/end/strokeStyle, element.strokeStyle, getLineDash(), lineCap, lineWidth, globalAlpha, font, letterSpacing, CTM [a,b,c,d,e,f], порядок fillText/strokeText, canvas id/номер/размер, overlay/connected и число вызовов по canvas/clear-epoch/слою. `marked:false`/`UNMARKED` означает draw вне размеченного shared painter — такой вызов не скрывается. `dropped` должен быть 0; иначе повторить короткую запись после reset.

Ожидание: для каждого paint-цикла слоя один fillText с alpha 0 и один strokeText с alpha 1; stroke фрагмент [0,10), dotted, dash [1,10], cap round, width 5. У B только element.strokeStyle=solid, при этом part.strokeStyle=dotted. Несколько canvas/эпох за одно действие нормальны: это разные перерисовки, live overlay и экспорт; их нельзя считать вторым проходом одного кадра.

Если вызовы/параметры расходятся, логи локализуют участок модели/layout/painter. Если у A/B/C все вызовы и параметры равны, а пиксели Windows различаются, это уже доказательство различия исполнения/состояния backend, для которого потребуются Windows-профиль Firefox и приложенные A/B/C PNG. Из успешного Linux-прогона такой вывод не делается.

## Результаты текущего окружения

На исходном production-коде PR проверен реальный Deploy Preview, документ 1080×1350, DPR 1,5, Linux Chromium 154 / Firefox 157. Специальная фиксация zoom не применяется. Измеряется ROI x100/y380/650×150; поверхности приводятся к документным координатам, а сравнения выполняются **между A/B/C внутри одной поверхности**, без смешения DPR-растрирования разных поверхностей.

| Движок Linux | Поверхность | A–B / A–C max | Белых разрывов (у каждого A/B/C) | Компонентов |
|---|---|---:|---:|---:|
| stroke-chromium | live | 0 / 0 | 2904 | 137 |
| stroke-chromium | canvas | 0 / 0 | 2896 | 137 |
| stroke-chromium | png | 0 / 0 | 3220 | 146 |
| stroke-firefox | live | 0 / 0 | 2871 | 134 |
| stroke-firefox | canvas | 0 / 0 | 2871 | 134 |
| stroke-firefox | png | 0 / 0 | 3184 | 145 |

Все A/B/C равны побайтно (changed=0, above2=0). Семантика сравнивается с четвёртым контрольным состоянием solid: >max(64,5% solid-ядра) пикселей должны стать белыми, >того же порога отличаться на >32, и должно остаться >10 отдельных синих компонентов. Существующие допуски не изменялись.

Во всех реальных strokeText A/B/C: текст AV fi TEST, dash [1,10], cap round, width 5, alpha 1. Все fillText имеют alpha 0. Для каждого состояния записано 14 fillText и 14 strokeText **за весь UI-сценарий** (отдельные перерисовки/overlay/export, не 14 вызовов в одном кадре). Лишнего solid stroke в трассе A/B/C нет. CTM одинаковы между состояниями: для viewport/overlay масштаб около 1.27777779 и translate около [162.27778,527.72217]; экспорт [1,0,0,1,127,413]. Firefox: font `72px "Arial"`, letterSpacing `0px`. Chromium: font `72px Arial`, наблюдаемый getter letterSpacing пустой — прежняя известная особенность save/getter; A/B/C одинаковы, присваивание остаётся внутри saved scope.

Адресный unit-тест сравнивает полный layout и **вызовы настоящей функции paintHorizontalTextPass** для A/B/C: один фрагмент [0,10), один fillText alpha 0 → один strokeText alpha 1, одинаковые font/spacing/dash/cap/width. Это исключает различие нормализации, styleKey, fragment split и correction в этих входных данных на Linux. Семантический E2E отдельно проверяет три поверхности, реальный Canvas-state прикладывается как abc-real-canvas-calls.json.

Проверки: 45/45 адресных unit, полный unit 605/605, source 17/17, build, build:verify, diff-check; две A/B/C browser-проверки прошли. Smoke-проверка probe подтверждает сбор real-context state/метаданных, счётчики, UNMARKED и восстановление оригинальных методов через stop(). Полная Playwright-матрица не перезапускалась.

Windows runner в Cloud Environment отсутствует; пользовательский Windows-сценарий **не воспроизведён и не считается исправленным**. Production-код не менялся. Трасса с условными точками на Windows нужна, чтобы установить первое фактическое расхождение; менять backend или масштаб без этого основания нельзя.
