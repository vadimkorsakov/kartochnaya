# КАРТОЧНАЯ v0.45 — базовые проверки

Исходный редактор находится в [`kartochnaya v0.45/`](<kartochnaya v0.45/>).
Файлы этого релиза не изменены. Корневые Node.js-зависимости используются только
для тестирования и упаковки; код приложения не преобразуется.

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

Команды: `npm run build`, `npm run build:html`, `npm run build:pwa`,
`npm run build:verify`. Этап 2 не начат.
