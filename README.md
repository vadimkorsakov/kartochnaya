# КАРТОЧНАЯ v0.45 — базовые проверки

Рабочие исходники находятся в [`src/`](src/): HTML-шаблон, два файла CSS
и `editor.js` с прежним IIFE. `core/primitives.mjs` и `core/colors.mjs` — настоящие
ES-модули; esbuild собирает их с редактором в один встроенный обычный скрипт.
Исторический эталон [`kartochnaya v0.45/`](<kartochnaya v0.45/>) сохранён без изменений.
Корневые Node.js-зависимости нужны только для разработки и тестов.

- [Запуск тестов и работа с эталонами](tests/README.md)
- [Зафиксированное исходное состояние](docs/baseline-v045.md)
- [Известные дефекты и архитектурные риски](docs/known-issues.md)
- [Результаты проверенного прогона](docs/validation-v045.md)

В текущей облачной среде:

```sh
npm ci
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
npm test
npm run test:known
```

Основные проверки и known failures разделены. Для всех проверок вместе —
`npm run test:all`. Окружение PNG-эталонов зафиксировано отдельно; ограничения
скачивания браузера и проверки file:// описаны в документации тестов.

## Готовые HTML и PWA ZIP

[Как скачать через GitHub Actions и как устроена сборка](docs/build-v045.md).
Актуальная архитектура и проверки: [этап 6 — esbuild и ES-модули](docs/esbuild-foundation-v045.md).

Команды: `npm run build`, `npm run build:html`, `npm run build:pwa`,
`npm run build:verify`, `npm run test:source`.

[Устройство исходников и результаты этапа 2](docs/source-extraction-v045.md).
Этапы 0–5 завершены; изменения этапа 6 представлены отдельным PR. Этап 7 не начат.
