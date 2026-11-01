# Gate 0C/2: оформление выделения в экспериментальном WYSIWYG

База: `78775756d1a3e02377cce66099a162cdb851bc20` (актуальный remote main,
PR #74). URL-флаг и eligibility Gate 0C/1 сохранены.

## Поведение

Существующий инспектор, меню шрифтов и color picker направляют непустой диапазон
в `createWysiwygSession().applyRangeStyle()`. Поддерживаются `fontFamily`,
`fontVariant`, `fontWeight`, `fontStyle`, aliases bold/italic, `fontSize`,
`textColor`, `letterSpacing`. Формирование patch остаётся в
`styleInlineSelection()`, включая очистку aliases и пересчёт размера:
`requestedDisplayedSize * textRunsBaseFontSize / layer.fontSize`.

Сессия сохраняет anchor/focus в UTF-16, проверяет границы и surrogate pairs.
Чужие input не становятся источником выделения текста. Pointer/focusout сохраняют
диапазон при передаче фокуса панели; переход без pointerdown также поддержан.
Пока input панели активен, DOM Selection не устанавливается: в Chromium это
вызвало бы blur и синхронный change посреди input. Диапазон и направление
восстанавливаются при фокусе WYSIWYG. Числовые поля сохраняют фокус и DOM identity.

Модель меняет только существующий `applyTextStyle()`. `project()` подготавливает
узлы, проверяет доступность шрифтов и измеряет все необходимые метрики перед
изменением слоя/DOM. При отказе проекции используется clean handoff в textarea;
неподтверждённый DOM и композиция сохраняют прежний recovery-контракт.
Отдельного persisted формата, движка или DOM-источника форматирования нет.

## Preview и история

Первый preview хранит исходный слой и диапазон. Следующие значения того же
свойства вычисляются от этого слоя. В существующую inline history записывается
один результат при final, смене операции, обычном вводе, Undo, handoff или
закрытии. Одинаковое состояние не добавляет историю; input/change не дублируются.
Финализация обновляет штатные callback и состояние кнопок истории.

Undo/Redo WYSIWYG охватывают ввод и оформление; новый ввод после Undo удаляет
Redo. Ctrl+Z в input инспектора остаётся нативным. Escape возвращает исходный
полный слой. Ctrl+Enter (включая активную панель) публикует одну текстовую сессию
в существующую document history. Изменение textRuns сохраняется при reload.

Пустое выделение, lineHeight, auto-fit, заливки/opacity и отдельные инструменты
используют handoff. Capture-защита охватывает pointerdown/click/input/change,
включая клавиатурные действия после перехода в панель.

## Проверки

- Chromium 154.0.8037.57: `inline-wysiwyg.spec.js` — **24 passed**.
- Chromium: `rich-text.spec.js` + `inline-text.spec.js` — **13 passed**
  (совместный прогон с WYSIWYG: 36 passed до добавления проверки collapsed caret).
- Firefox 157.0: `playwright.wysiwyg.config.js` — **7 passed**.
- После последней правки callback финализации повторены затронутые preview/history
  сценарии Chromium — **5 passed**.
- `npm run test:source` — passed; `npm run test:unit` — **16 passed**.
- `npm run build`, `git diff --check` — passed.
- `test:all` не запускался, PNG-baselines не менялись.

Запуск Chromium: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.
Firefox в этом Cloud Environment требует доступные каталоги конфигурации/кэша
и временного профиля:

```sh
MOZ_DISABLE_CONTENT_SANDBOX=1 \
XDG_CONFIG_HOME=$PWD/work/config XDG_CACHE_HOME=$PWD/work/cache \
TMPDIR=$PWD/work/tmp npx playwright test --config=playwright.wysiwyg.config.js
```

## Ограничения

Только прежние eligible desktop-слои с URL-флагом. Не добавлены auto-fit,
вертикальный/повёрнутый текст, абзацные свойства и эффекты. Без флага и на mobile
сохраняется textarea. IME/CRLF, строгие verdict Gate 0A/0B, IndexedDB v3, формат
документа, PNG export и облачные функции не изменены. Реальный italic-вариант
может использоваться через существующий UI загруженного семейства; меню
встроенных семейств предлагает только normal-варианты веса, как прежде.
