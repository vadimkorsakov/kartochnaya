# Android Brave: зазор над IME и viewport-политика

Исправление: HTML viewport теперь явно задаёт
`interactive-widget=resizes-content`. Браузер должен уменьшать layout viewport
вместе с визуальным при появлении клавиатуры. Формула высоты редактора,
flex-цепочка и существующее позиционирование панели сохранены.

Пользователь проверил обновлённый Developer Preview на физическом Android
в Brave и сообщил: **«Теперь зазора нет»**. Также проверены скрытие и повторное открытие
клавиатуры, поворот телефона, кнопки масштаба и pinch: зазор не возвращается,
текст и масштаб работают. Это подтверждение одного физического устройства,
а не всех версий Brave, Android и режимов браузера.
Merge и Production Deploy не выполняются.

## База, диагноз и уверенность

База — `fc5ecf2d3bbc97a2c93512ec92c5fe637a416d07` (main).
PR #47 объединён 28 октября 2026 года; его HEAD
`a382bd3735eb294a6d6af199d9de68109dfb057a` — предок базы.

До изменения политики пользователь передал диагностику с телефона и
подтвердил, что большой тёмный зазор в этот момент оставался виден:

| Параметр | CSS px |
| --- | --- |
| innerHeight / documentElement.clientHeight | 604 / 604 |
| VisualViewport height / offsetTop / pageTop | 320 / 0 / 0 |
| VisualViewport scale / DPR | 1 / 3 |
| body height / padding-top / scrollHeight | 604 / 42 / 604 |
| #app top / height / bottom | 42 / 278 / 320 |
| .app-body и .stage-column bottom | 320 |
| #stageScroller top / height / bottom | 140 / 130 / 270 |
| #mobileToolbars top / height / bottom | 270 / 50 / 320 |
| visualBottomToToolbar / appBottomToToolbar / visualBottomToApp | 0 / 0 / 0 |
| --mobile-toolbar-anchor | 334 |

Значит, в измеренном состоянии панель доходит до **сообщаемой** границы
VisualViewport и до края app; ограничения flex/min-height/padding не оставляют
зазор внутри app. Высота `320 - 42 = 278` правильна; вкладки не вычитаются
дважды. При этом на устройстве видна веб-область ниже сообщаемой границы.
Проблема связана с моделью viewport браузера при visual-only IME resize,
а не с подтверждённым CSS-ограничением потомка app.

Нативный режим `resizes-content` устранил зазор на том же устройстве.
Уверенность в наблюдаемом результате высокая. Конкретная внутренняя ошибка
Brave и универсальность исправления для других устройств не установлены.
Не используются высота конкретной клавиатуры, отрицательные margin,
смещения под телефон, дополнительное позиционирование панели или polling.

Прежние тесты уже проверяли фактическую панель, но подменяли VisualViewport
через EventTarget. В них заданная граница по определению считалась реальной
доступной границей. Нулевой зазор в этой модели не доказывал отсутствие видимой
пустоты в Brave. Моки сохранены для проверки координат, а не приёмки браузера.

Android Back, ✓, Undo/Redo, атомарность ввода, масштаб/жесты, форматирование,
переключение документов, модель, IndexedDB, cloud и PWA/Service Worker
не переписаны. Изменение обычной viewport meta применяется браузером нативно.
Существующий обработчик resize при активном вводе не запускает fitCanvas.

## Диагностика на телефоне

[Developer Preview с диагностикой](https://deploy-preview-48--kartochnaya.netlify.app/?debugIme=1).
При необходимости обновите страницу до появления в JSON `viewport.policy`
с `interactive-widget=resizes-content`.

Выберите текст, нажмите «Править», раскройте компактный блок «IME» и нажмите
«Скопировать диагностику». Нажатие сохраняет фокус и клавиатуру. Для сравнения
нужны состояния: открытая IME, скрытая, открытая повторно, после поворота;
верхняя/нижняя адресная строка, дополнительные подсказки и установленная PWA —
отдельные режимы, которые нельзя объявлять проверенными по мокам Chromium.

Блок показывает политику viewport, innerHeight/clientHeight, VisualViewport,
DPR, visualBottom, DOMRect body/app/app-body/column/scroller/toolbar/context,
высоту панели, участвующие CSS-переменные, вычисленные ограничения
height/min/max/flex/box-sizing/padding/margin/position, scrollHeight и три зазора.
Все расстояния — CSS px. DOMRect и `offsetTop + height` относятся к layout
viewport; pageTop записывается отдельно и к DOMRect не прибавляется.

Обновления идут по resize/scroll window и VisualViewport, orientationchange,
ResizeObserver контейнеров и изменению класса body/переменных root, объединены
requestAnimationFrame. Блок fixed, вне flex flow, с ограниченной высотой;
раскрытие не добавляет document overflow. Без `?debugIme=1` блок и наблюдатели
не создаются. В JSON нет текста документа, URL, авторизации или хранилищ.
При недоступном Clipboard API можно выделить JSON вручную.

## Автоматические проверки и снимки

Тесты проверяют rect app, app-body и column, реальное положение панели,
положительную высоту scroller, отсутствие document overflow и сохранение 29%.
Контрольный сценарий ограничивает max-height колонки при правильной высоте
app: диагностика обязана обнаружить зазор 136/340 px. Это проверка измерителя,
а не причина дефекта на телефоне.

Проверены моки visual-only и одновременного resize обоих viewport, offsetTop,
повторные resize/scroll, дополнительная высота IME, закрытие/повторное открытие,
поворот, копирование без потери фокуса и без текста документа. Visual-only
модель остаётся полезной для браузеров, игнорирующих interactive-widget.

Снимки — **Chromium-эмуляция**, без системной клавиатуры и адресной строки.
Штриховка показывает область вне VisualViewport. Каждому PNG соответствует
JSON с тем же именем. Они дополняют физическую проверку, не заменяя её.

| Веб-область | Открыта IME | Другой offsetTop | Закрыта | Открыта повторно |
| --- | --- | --- | --- | --- |
| 360×640 | [PNG](screenshots/ime-diagnostics/360-ime-open.png) | [PNG](screenshots/ime-diagnostics/360-ime-offset.png) | [PNG](screenshots/ime-diagnostics/360-ime-closed.png) | [PNG](screenshots/ime-diagnostics/360-ime-reopened.png) |
| 390×844 | [PNG](screenshots/ime-diagnostics/390-ime-open.png) | [PNG](screenshots/ime-diagnostics/390-ime-offset.png) | [PNG](screenshots/ime-diagnostics/390-ime-closed.png) | [PNG](screenshots/ime-diagnostics/390-ime-reopened.png) |
