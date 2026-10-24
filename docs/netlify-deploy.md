# Ручные Production Deploy Netlify

После merge этой настройки в main обычный Merge больше не обновляет основной
сайт. GitHub CI и Netlify Deploy Preview для PR продолжают работать.
Netlify-сборка и её браузерные тесты по-прежнему выполняются в GitHub Actions.

## Однократная настройка

1. В Netlify откройте Project configuration → Continuous deployment → Build hooks
   (в некоторых версиях интерфейса — через Developer settings).
2. Создайте Build Hook для ветки **main**, которая должна оставаться production
   branch проекта. Оставьте сборки Netlify активными, чтобы работали hooks и Preview.
3. Скопируйте полученный адрес. Это приватный адрес управления публикацией:
   не добавляйте его в код, конфигурацию, документацию, PR или логи.
4. В GitHub откройте Settings → Secrets and variables → Actions.
5. Создайте repository secret `NETLIFY_BUILD_HOOK_URL` с этим адресом.

## Выпуск

После успешного CI нужного коммита в main откройте Actions → Deploy Netlify →
Run workflow и выберите **main**. Workflow доступен после merge в main;
запуск с другой ветки завершится ошибкой до отправки запроса.

Hook собирает **актуальное состояние main**, а не фиксирует SHA запуска workflow.
Если main успела измениться, дождитесь успешного CI её нового состояния перед
выпуском. Workflow отправляет единственный POST без повторов и не собирает
браузерное приложение самостоятельно.

Успешный workflow подтверждает только принятие запроса, **не успешную публикацию**.
Проверьте результат и SHA в Netlify → Deploys. При сетевой ошибке или таймауте
сначала проверьте Netlify: запрос мог быть принят до потери ответа.

## Механизм

`netlify.toml` запускает `scripts/netlify-ignore.cjs` без npm-зависимостей.
По [контракту Netlify](https://docs.netlify.com/build/configure-builds/ignore-builds/)
код `0` пропускает автоматическую Git-сборку при `CONTEXT=production`, а `1`
разрешает `deploy-preview`, `branch-deploy` и неизвестный или отсутствующий контекст.
[Build Hook](https://docs.netlify.com/build/configure-builds/build-hooks/)
обходит ignore, поэтому ручной Production Deploy остаётся доступным.
Merge без ручного выпуска не расходует кредиты на Production Deploy;
сам ручной Production Deploy оплачивается по действующему тарифу Netlify.
