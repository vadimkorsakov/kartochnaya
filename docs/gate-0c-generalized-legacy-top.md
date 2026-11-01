# Gate 0C/4A: измерения legacy-top

База: `afbfb5764af4d1f00ac84c9d9e56ac10b2f0c028`. Chromium 154.0.8037.57, Linux, desktop, URL-флаг включён.

`legacyTopProjection()` больше не проверяет имя семейства, размер и начертание. Она проверяет конечность метрик, согласованность ascent/descent при смене baseline, вместимость font box в legacy-шаг, одинаковую вертикальную геометрию непустых LF-строк и однородность типографики. Сначала учитывается естественный baseline самих строк: если компенсация не нужна, маркер не сохраняется. Проверки доступности/загрузки шрифта, ширины, shaping и переносов остаются в существующем пути допуска.

CSS baseline по-прежнему измеряет реальный DOM probe. Его результат переиспользуется внутри сессии по шрифту, размеру, spacing, высоте/baseline и тексту первой строки; кэш ограничен, инвалидируется при загрузке/ошибке FontFaceSet и учитывает его размер. Это не persisted-кэш; измерения не добавлены в `paint()`. Существующий layout engine и два Canvas-алгоритма сохранены. Очистка последнего реального override удаляет ненужный маркер; неизменённое открытие старых документов ничего не переписывает.

Проверены 62 комбинации: 40 WYSIWYG, 22 textarea. Текст матрицы: `ABCD\nABCD`; явный LF, широкая рамка 200 px. Системные семейства используют штатное разрешение шрифтов браузера; Nimbus Sans загружен из существующего OTF fixture. Montserrat и Golos Text не установлены/не загружены, не подменялись и в матрицу не включены. Новые бинарные ассеты не добавлялись.

Для каждого WYSIWYG проверены первое открытие, точная структура после no-op, [1,3), один sparse color run, непрерывная сессия, Undo/Redo, Escape, сохранение/reload, повторное открытие, Canvas и реальный PNG. DOM Range проверен на 50/100/200% до и после цвета. Максимальные отклонения baseline DOM/legacy: **0.335 document px**, Canvas после цвета/legacy: **0.436875 px**; x DOM/native Canvas prefix: **0.481003 px**. Существующие более строгие тесты Arial 32 сохранены отдельно (0.05 px DOM, 1e-6 px Canvas). PNG проверяется по фактическим вызовам рисования при экспорте; файл декодируется существующим helper с проверкой CRC и размеров. PNG-эталоны не изменяются.

Существующий guard shaping сохранён. Для компенсируемой проекции добавлена проверка двух границ вместе: исходный допуск должен выдерживаться и после split/reload. Это отказывает Nimbus при больших lineHeight, где потеря парного kerning суммарно составляет 0.649994 px (26 px) или 0.800003 px (32 px). Естественный путь Nimbus при 1.0/1.03 сохраняет существующее поведение без маркера.

| Семейство | px | Weight/style | lineHeight | Режим | Сохранённый marker при цвете | Font box / шаг, px | Причина отказа |
|---|---:|---|---:|---|---|---|---|
| Arial | 24 | 400/normal | 1 | textarea | — | 27 / 24 | Font box выше legacy-шага; естественный baseline вне допуска |
| Arial | 24 | 400/normal | 1.15 | WYSIWYG | legacy-top | 27 / 27.6 | — |
| Arial | 24 | 400/normal | 1.3 | WYSIWYG | legacy-top | 27 / 31.2 | — |
| Arial | 32 | 400/normal | 1 | textarea | — | 36 / 32 | Font box выше legacy-шага; естественный baseline вне допуска |
| Arial | 32 | 400/normal | 1.15 | WYSIWYG | legacy-top | 36 / 36.8 | — |
| Arial | 32 | 400/normal | 1.3 | WYSIWYG | legacy-top | 36 / 41.6 | — |
| Arial | 40 | 400/normal | 1 | textarea | — | 44 / 40 | Font box выше legacy-шага; естественный baseline вне допуска |
| Arial | 40 | 400/normal | 1.15 | WYSIWYG | legacy-top | 44 / 46 | — |
| Arial | 40 | 400/normal | 1.3 | WYSIWYG | legacy-top | 44 / 52 | — |
| Georgia | 24 | 400/normal | 1 | textarea | — | 26 / 24 | Font box выше legacy-шага; естественный baseline вне допуска |
| Georgia | 24 | 400/normal | 1.15 | WYSIWYG | legacy-top | 26 / 27.6 | — |
| Georgia | 24 | 400/normal | 1.3 | WYSIWYG | legacy-top | 26 / 31.2 | — |
| Georgia | 32 | 400/normal | 1 | textarea | — | 36 / 32 | Font box выше legacy-шага; естественный baseline вне допуска |
| Georgia | 32 | 400/normal | 1.15 | WYSIWYG | legacy-top | 36 / 36.8 | — |
| Georgia | 32 | 400/normal | 1.3 | WYSIWYG | legacy-top | 36 / 41.6 | — |
| Georgia | 40 | 400/normal | 1 | textarea | — | 45 / 40 | Font box выше legacy-шага; естественный baseline вне допуска |
| Georgia | 40 | 400/normal | 1.15 | WYSIWYG | legacy-top | 45 / 46 | — |
| Georgia | 40 | 400/normal | 1.3 | WYSIWYG | legacy-top | 45 / 52 | — |
| Verdana | 24 | 400/normal | 1 | textarea | — | 26 / 24 | Font box выше legacy-шага; естественный baseline вне допуска |
| Verdana | 24 | 400/normal | 1.15 | WYSIWYG | legacy-top | 26 / 27.6 | — |
| Verdana | 24 | 400/normal | 1.3 | WYSIWYG | legacy-top | 26 / 31.2 | — |
| Verdana | 40 | 400/normal | 1 | textarea | — | 45 / 40 | Font box выше legacy-шага; естественный baseline вне допуска |
| Verdana | 40 | 400/normal | 1.15 | WYSIWYG | legacy-top | 45 / 46 | — |
| Verdana | 40 | 400/normal | 1.3 | WYSIWYG | legacy-top | 45 / 52 | — |
| Courier New | 24 | 400/normal | 1 | textarea | — | 27 / 24 | Font box выше legacy-шага; естественный baseline вне допуска |
| Courier New | 24 | 400/normal | 1.15 | WYSIWYG | legacy-top | 27 / 27.6 | — |
| Courier New | 24 | 400/normal | 1.3 | WYSIWYG | legacy-top | 27 / 31.2 | — |
| Courier New | 40 | 400/normal | 1 | textarea | — | 45 / 40 | Font box выше legacy-шага; естественный baseline вне допуска |
| Courier New | 40 | 400/normal | 1.15 | WYSIWYG | legacy-top | 45 / 46 | — |
| Courier New | 40 | 400/normal | 1.3 | WYSIWYG | legacy-top | 45 / 52 | — |
| Times New Roman | 24 | 400/normal | 1 | textarea | — | 26 / 24 | Font box выше legacy-шага; естественный baseline вне допуска |
| Times New Roman | 24 | 400/normal | 1.15 | WYSIWYG | legacy-top | 26 / 27.6 | — |
| Times New Roman | 24 | 400/normal | 1.3 | WYSIWYG | legacy-top | 26 / 31.2 | — |
| Times New Roman | 40 | 400/normal | 1 | textarea | — | 45 / 40 | Font box выше legacy-шага; естественный baseline вне допуска |
| Times New Roman | 40 | 400/normal | 1.15 | WYSIWYG | legacy-top | 45 / 46 | — |
| Times New Roman | 40 | 400/normal | 1.3 | WYSIWYG | legacy-top | 45 / 52 | — |
| Nimbus Sans | 26 | 400/normal | 1 | WYSIWYG | нет | 26 / 26 | — |
| Nimbus Sans | 26 | 400/normal | 1.03 | WYSIWYG | нет | 26 / 26.78 | — |
| Nimbus Sans | 32 | 400/normal | 1 | WYSIWYG | нет | 32 / 32 | — |
| Nimbus Sans | 32 | 400/normal | 1.03 | WYSIWYG | нет | 32 / 32.96 | — |
| Arial | 32 | 700/normal | 1 | textarea | — | 36 / 32 | Font box выше legacy-шага; естественный baseline вне допуска |
| Arial | 32 | 700/normal | 1.15 | WYSIWYG | legacy-top | 36 / 36.8 | — |
| Arial | 32 | 700/normal | 1.3 | WYSIWYG | legacy-top | 36 / 41.6 | — |
| Arial | 32 | 400/italic | 1 | textarea | — | 36 / 32 | Font box выше legacy-шага; естественный baseline вне допуска |
| Arial | 32 | 400/italic | 1.15 | WYSIWYG | legacy-top | 36 / 36.8 | — |
| Arial | 32 | 400/italic | 1.3 | WYSIWYG | legacy-top | 36 / 41.6 | — |
| Arial | 32 | 700/italic | 1 | textarea | — | 36 / 32 | Font box выше legacy-шага; естественный baseline вне допуска |
| Arial | 32 | 700/italic | 1.15 | WYSIWYG | legacy-top | 36 / 36.8 | — |
| Arial | 32 | 700/italic | 1.3 | WYSIWYG | legacy-top | 36 / 41.6 | — |
| Georgia | 32 | 700/normal | 1 | textarea | — | 36 / 32 | Font box выше legacy-шага; естественный baseline вне допуска |
| Georgia | 32 | 700/normal | 1.15 | WYSIWYG | legacy-top | 36 / 36.8 | — |
| Georgia | 32 | 700/normal | 1.3 | WYSIWYG | legacy-top | 36 / 41.6 | — |
| Georgia | 32 | 400/italic | 1 | textarea | — | 36 / 32 | Font box выше legacy-шага; естественный baseline вне допуска |
| Georgia | 32 | 400/italic | 1.15 | WYSIWYG | legacy-top | 36 / 36.8 | — |
| Georgia | 32 | 400/italic | 1.3 | WYSIWYG | legacy-top | 36 / 41.6 | — |
| Georgia | 32 | 700/italic | 1 | textarea | — | 36 / 32 | Font box выше legacy-шага; естественный baseline вне допуска |
| Georgia | 32 | 700/italic | 1.15 | WYSIWYG | legacy-top | 36 / 36.8 | — |
| Georgia | 32 | 700/italic | 1.3 | WYSIWYG | legacy-top | 36 / 41.6 | — |
| Nimbus Sans | 26 | 400/normal | 1.15 | textarea | — | 26 / 29.9 | Суммарный shaping двух границ >0.5 px при повторном открытии |
| Nimbus Sans | 26 | 400/normal | 1.3 | textarea | — | 26 / 33.8 | Суммарный shaping двух границ >0.5 px при повторном открытии |
| Nimbus Sans | 32 | 400/normal | 1.15 | textarea | — | 32 / 36.8 | Суммарный shaping двух границ >0.5 px при повторном открытии |
| Nimbus Sans | 32 | 400/normal | 1.3 | textarea | — | 32 / 41.6 | Суммарный shaping двух границ >0.5 px при повторном открытии |

Отдельные регрессии проверяют старый unmarked Arial rich и сохранённый legacy-top Arial 32, недоступные шрифты, сильный kerning, тесную рамку и переносы, mobile/без флага, атомарный mixed-font fallback, очистку последнего оформления и отсутствие истории при no-op. Модель/история/IndexedDB и Canvas алгоритмы не объединялись.

## Firefox smoke

Firefox 157.0 (Playwright v1555): **27/27 passed**. Проверены ввод, Selection, Undo/Redo/Escape, sparse color, calibrated Arial 32, old unmarked Arial, mixed-font fallback, очистка последнего override и no-op история.

| Семейство | px | lineHeight | Режим | Font box / шаг, px | Причина |
|---|---:|---:|---|---|---|
| Arial | 24 | 1.3 | WYSIWYG | 28 / 31.2 | — |
| Arial | 40 | 1.3 | WYSIWYG | 46 / 52 | — |
| Georgia | 24 | 1.3 | textarea | 34 / 31.2 | Font box превышает legacy-шаг |
| Georgia | 40 | 1.3 | textarea | 55 / 52 | Font box превышает legacy-шаг |

Для запуска Firefox в локальном managed окружении потребовался запуск тестов вне файловой песочницы: внутри неё браузер завершался до тестов с `Could not find profile folder`. Изменений приложения для обхода этой ошибки нет.

## Проверки

- Chromium: 62 измеренных комбинации (40 WYSIWYG / 22 textarea); 95 регрессий inline-WYSIWYG, rich rendering, inline text, selected formatting и visual; 13 финальных целевых повторов после последних правок.
- Firefox smoke: 27 passed, включая 4 измеренных комбинации из таблицы выше.
- `npm run test:unit`, `npm run test:source`, `npm run build`, `npm run build:verify`, `git diff --check` — успешно.
- Полный `npm run test:all` выполняется в CI; его итог и SHA приводятся в отчёте PR. Merge и Production Deploy не выполняются.
