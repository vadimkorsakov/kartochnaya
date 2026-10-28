# Android Brave: диагностика зазора над IME

Статус: причина на физическом устройстве **не подтверждена**, исправление
компоновки ожидает измерений. Эта ветка предоставляет диагностический Preview,
а не объявляет дефект закрытым. Merge и Production Deploy не выполняются.

## Проверенная база и анализ

База — `fc5ecf2d3bbc97a2c93512ec92c5fe637a416d07` (main).
PR #47 объединён 28 октября 2026 года; его HEAD
`a382bd3735eb294a6d6af199d9de68109dfb057a` — предок базы без последующих
изменений файлов между ним и main.

В `src/editor.js`, `src/styles/legacy-01.css`, `src/styles/legacy-02.css`
и `src/index.template.html` проверена цепочка:
`body → #app → .app-body → .stage-column → #mobileToolbars`.

- `body` имеет border-box, высоту 100%, padding-top высотой вкладок.
  `#app` в обычном режиме использует `100dvh - --document-tab-height`.
- Во время редактирования `#app` уже имеет border-box, flex-shrink:0,
  min-height:0; высота равна `offsetTop + visualViewport.height - appRect.top`.
  Повторного вычитания вкладок в этом пути нет.
- `.app-body` и `.stage-column` растягиваются через flex:1 с min-height:0.
  Панель — дочерний элемент `.stage-column`, flex:0 0 auto, высота 50px;
  старые content-box/64px перекрываются более поздними ID-правилами.
- Для текстовой подпанели резервируется margin на stageScroller; padding
  колонки очищается. Изменение этого резерва без измерений не обосновано.
- `--mobile-toolbar-anchor` — расстояние от layout viewport bottom (`innerHeight`)
  до toolbar top для уже существующих fixed-подпанелей. Оно не определяет
  высоту `#app` и не должно заменяться высотой visual viewport без проверки
  системы координат fixed-контейнера на устройстве.

Локально воспроизводимого конфликта CSS не найдено. На исходной main три
целевых теста IME/геометрии проходят. Уверенность в этих наблюдениях высокая;
в причине зазора на физическом Brave — недостаточная для изменения layout.
Остаются непроверенными события и геометрия реального браузера, включая его UI
и актуальность закэшированной сборки на телефоне.

Предыдущие тесты проверяли фактическую панель, а не только формулу. Однако
VisualViewport в них — EventTarget с заданными числами. Такой тест не моделирует
Android IME, browser UI, browser-driven viewport panning и кеш устройства.
Нулевой зазор в нём не доказывает нулевой зазор на телефоне.

Формулы, позиционирование панели, Android Back, ✓, история, масштабирование,
модель документа, IndexedDB, cloud и PWA/Service Worker **не изменены**.

## Проверка на телефоне

Откройте адрес Deploy Preview этого PR с `?debugIme=1` в Brave на том же
Android. Наличие блока «IME: зазор … px» подтверждает загрузку диагностической
сборки. Обычный адрес без параметра не создаёт блок и его наблюдатели.

1. Выберите текст и нажмите «Править», воспроизведите зазор.
2. Раскройте компактный блок и нажмите «Скопировать диагностику». При нажатии
   сохраняются фокус, caret и открытая клавиатура.
3. Передайте JSON и скриншот со всей доступной веб-областью, адресной строкой
   и клавиатурой. Нужны замеры: клавиатура открыта; скрыта; открыта повторно;
   после поворота телефона. Если возможно, повторите с другой высотой подсказок.
4. Для сравнения повторите при верхней/нижней адресной строке и в установленной
   PWA. Это отдельные режимы; Chromium-моки не являются их полноценной проверкой.

Блок показывает innerHeight/clientHeight, параметры VisualViewport, DPR,
visualBottom, DOMRect всей цепочки, высоту панели, участвующие CSS-переменные,
вычисленные ограничения height/min/max/flex/box-sizing/padding/margin/position,
scrollHeight и три зазора. Все расстояния — CSS px. DOMRect и
`offsetTop + height` относятся к layout viewport; pageTop записывается отдельно
и к DOMRect не прибавляется.

Интерпретация:

- `visualBottomToApp` большой, `appBottomToToolbar` ≈ 0: исследовать размер/начало
  редактора и события viewport на телефоне.
- `visualBottomToApp` ≈ 0, `appBottomToToolbar` большой: искать ограничение
  внутри flex-цепочки по записанным rect и вычисленным CSS.
- Оба ≈ 0, а на снимке есть пустая веб-область: проверить, соответствует ли
  reported VisualViewport видимой границе Brave; DOM не измеряет browser UI.

Обновления идут по resize/scroll window и VisualViewport, orientationchange,
ResizeObserver контейнеров и изменению класса body/переменных root, объединены
requestAnimationFrame. Polling отсутствует. Блок fixed, вне flex flow;
раскрытие ограничено по высоте, не добавляет document overflow.
В JSON нет введённого текста, документа, URL, авторизации или хранилищ.
При недоступном Clipboard API сообщение предлагает выделить JSON вручную.

## Автоматические проверки и снимки

Тесты проверяют rect `#app`, `.app-body`, `.stage-column`, реальное положение
панели, высоту stageScroller и отсутствие document overflow. Дополнительный
негативный сценарий ограничивает max-height колонки при математически правильной
высоте `#app`: диагностика обязана показать большой фактический зазор. Это
искусственная проверка измерителя, а не утверждение о причине дефекта Brave.

Проверены моки: уменьшается только visual viewport; уменьшаются оба viewport;
меняется offsetTop; повторные resize/scroll; дополнительная высота IME;
закрытие/повторное открытие; поворот. Сохраняется масштаб 29%, работает
копирование без потери фокуса и без текста документа. Блок скрыт без debugIme.

Снимки ниже — **Chromium-эмуляция**, без системной клавиатуры и адресной строки.
Каждому PNG соответствует JSON с тем же именем. Они не принимают дефект на
физическом Brave и не подтверждают работу установленной PWA.

| Веб-область | Открыта IME | Другой offsetTop | Закрыта | Открыта повторно |
| --- | --- | --- | --- | --- |
| 360×640 | [PNG](screenshots/ime-diagnostics/360-ime-open.png) | [PNG](screenshots/ime-diagnostics/360-ime-offset.png) | [PNG](screenshots/ime-diagnostics/360-ime-closed.png) | [PNG](screenshots/ime-diagnostics/360-ime-reopened.png) |
| 390×844 | [PNG](screenshots/ime-diagnostics/390-ime-open.png) | [PNG](screenshots/ime-diagnostics/390-ime-offset.png) | [PNG](screenshots/ime-diagnostics/390-ime-closed.png) | [PNG](screenshots/ime-diagnostics/390-ime-reopened.png) |
