# F-04 / F-07: независимые облачные копии и Яндекс OAuth

База: `e8165c91d47bbcf0815467fbd5364321120a1fa5` — проверенная через GitHub
и обычный fetch актуальная main после merge PR #37. Ветка:
`fix/f04-f07-cloud-reservation`. `AGENTS.md` прочитан. Merge и production deploy
не выполнялись. Итоговый SHA и ссылка на автоматический CI указаны в PR.

## Исходные результаты — до исправления

Коммит `3580057` содержит только тесты и baseline; `src/` полностью совпадает
с исходной main. Машиночитаемые результаты, названия тестов, фактические
ошибки и команды: [baseline JSON](cloud-resilience-f04-f07-baseline.json).

- Unit: **55 passed / 11 failed / 0 skipped** из 66.
- Browser через реальные UI-маршруты Netlify: **3 passed / 5 failed / 0 skipped**
  из 8 выбранных сценариев. Chromium 154.0.8037.57.
- Предварительные запуски в ограниченном sandbox не могли открыть loopback
  listener и корректно передать child-process test output. Это не результаты
  приложения. Приведённые выше прогоны выполнены с разрешённым сетевым доступом
  Cloud Environment, без изменения proxy environment или TLS.

На main падали:

1. Отказ reserve Яндекса после двух успешных Google reservations: все три
   строки `unconfirmed`, ни одного ZIP/PUT вместо двух подтверждённых Google.
2. Отказ первого Google A: все строки `unconfirmed`, Google B и Яндекс даже
   не доходили до резервирования. Отказ Google B также останавливал пакет.
3. Все reserve отказали: ноль confirmations уже было правильным результатом;
   падало ожидание доступного проверенного локального ZIP, а не проверка
   ложного общего успеха.
4. Lease первого получателя терял поколение, пока резервировался следующий:
   общий pre-ZIP `lease.check()` прерывал весь пакет.
5. Падавший получатель с малым size limit: выполнение останавливалось на
   reserve и не доходило до общего size preflight. Это не доказательство
   обхода лимита в main; тест фиксирует требуемый контракт после изоляции.
6. Уже подтверждённый Яндекс ID + временный network/403/некорректный `/info`:
   `connected` становился false, OAuth generation менялся; после восстановления
   связи первоначальная owner capability уже не могла использоваться.
7. Настоящий другой ID уже блокировал PUT на main. Browser-тест падал из-за
   потери результатов Google и отсутствия отдельного `reconnect` состояния;
   отправка в подменённый аккаунт на main не заявляется.

Контроли, которые **уже работали на main**: смена generation во время ZIP и при
получении upload link, реальная смена ID блокирует PUT, новое поколение не
наследует ID, неизвестная исходная личность ограничена generation, отмена во
время reserve освобождает предыдущие и поздние leases, ambiguous PUT не
повторяется, ошибки IndexedDB/CRC/размера блокируют передачи. Они сохранены.
В новом browser-тесте после первого исправления уточнён селектор состояния
подключения (`yandexConnectionStatus` вместо текста текущей операции);
исходный main падал раньше, на отсутствии двух подтверждений Google.

## Причины и архитектура

F-04: последовательные `reserve()` и общий цикл `lease.check()` находились
внутри одного внешнего catch. Любой отказ выглядел как глобальная ошибка
подготовки и не давал создать общий ZIP.

Теперь каждая выбранная строка имеет собственный результат резервирования,
проверки и передачи. Известное, но уже недоступное назначение — отказ этой
строки; неизвестные ID, некорректный набор/контракт получателей и лимиты
остаются глобальными ошибками. Ошибка резервирования не даёт вызвать upload
этого назначения. Предварительно устаревший lease получает `reconnect`.
Успешные назначения используют один и тот же подготовленный объект ZIP.

Все полученные leases сохраняются до общего finally, включая lease,
вернувшийся после отмены. Освобождение одного lease не препятствует вызову
release остальных. Provider adapter освобождает свою локальную reservation,
если асинхронный reserve завершился отказом до возврата lease координатору.
`confirmed` выставляется только после `result.confirmed === true` и не
перезаписывается последующими отказами или отменой.

`prepareWorkspaceBackup` не изменён: один согласованный snapshot IndexedDB,
один createBackup, одна полная проверка readBackup и один SHA-256 всего ZIP.
Все успешные upload и локальное сохранение используют идентичные байты.
Даже при нуле исправных облаков проверенный ZIP доступен локально, но UI
явно показывает 0 подтверждений. После завершения окно можно закрыть;
следующий сценарий начинает с пустых результатов и без старого архива.

Глобальные блокировки сохранены: сохранение IndexedDB, создание/проверка ZIP,
workspace replacement/Web Locks, входной набор и отмена. Дополнительно общий
`assertAvailable()` повторяется после подготовки и перед каждым назначением;
потеря доступности workspace не становится частной ошибкой провайдера.

**Size preflight не ослаблен:** общий ZIP проверяется относительно *всех*
выбранных направлений, в том числе отказавших при reserve. Если у отказавшего
Яндекса предел Android 128 МиБ, ZIP больше этого предела по-прежнему блокирует
Google с пределом 256 МиБ. Локальное сохранение проверенного ZIP остаётся
возможным. Снять направление можно только новым явным выбором пользователя.

## Гарантии идентификации Яндекса

F-07: после неудачного `/info` переменная результата оставалась null;
`accountId !== null && id !== accountId` трактовало null как подтверждённую
смену личности и вызывало reset/disconnect.

Теперь ситуации различаются:

- Валидный другой ID: reset, disconnect, ошибка `reconnect`, ни одного PUT.
- Известный ID, но текущий `/info` не подтвердился: операция отклонена,
  `unconfirmed`, ID и OAuth generation сохранены. Старый ID не подставляется
  вместо результата сетевого запроса. Следующая операция снова проверяет
  `/info`; сетевой отказ не превращается в успешную проверку.
- Новое generation: прежний ID сбрасывается; старый owner не принимается даже
  при совпадающих строках ID. Нужна новая capability после проверок identity/root.
- Изначально неизвестный ID при `cloud_api:disk.app_folder`: null остаётся
  null. Доступ разрешён только через capability исходного generation и
  подтверждённую app-folder. Подтверждение старого аккаунта не переносится.
  Если личность позже становится известна, owner с null не заменяется на owner
  с известным ID; нужен новый явный reserve.
- `checkUpload(owner)` проверяет принадлежность capability этому экземпляру
  клиента, connected, generation и ID. `releaseUpload` отзывает capability;
  reset заменяет весь registry, поэтому отозванный owner нельзя оживить новым
  reserve с тем же generation/ID.
- Проверки повторяются после identity/root, всех await получения upload URL и
  progress callback непосредственно перед signed PUT, затем при подтверждении
  результата. Реальные OAuth `op.check()` дополнительно защищают token,
  generation, expiry и abort; они не заменены фиктивным check.
- HTTP 401 до PUT требует reconnect. Если PUT уже мог состояться, последующая
  ошибка, включая 401/недоступный `/info`, сохраняет UNCERTAIN/unconfirmed.
  Автоматического повтора PUT, удаления или новой загрузки нет.

Signed URL grammar, доверенные домены, `overwrite=false` и отсутствие
Authorization на signed PUT сохранены. Токены остаются только в памяти.
OAuth scopes, IndexedDB v3, ZIP/manifest/SHA-256, восстановление workspace,
Web Locks, Object URL и политика ambiguous upload не менялись.

## Покрытие требований

| Сценарий | Проверки |
| --- | --- |
| Яндекс reserve failure → Google A+B confirmed | coordinator unit и browser с сетевым отказом app-folder API |
| Google A reserve failure → Google B+Яндекс confirmed | unit и browser с истечением реального Google session lease |
| Последний reserve отказал после предыдущих leases | unit, browser Яндекс последним; предыдущие upload подтверждены |
| Все reserve отказали | unit/browser: 0 confirmations, один локальный ZIP |
| Один snapshot/create/read и идентичные байты/SHA | счётчики unit, IDB transaction counter browser, сравнение всех upload с download |
| Все leases освобождаются | unit release accounting при успехе/отказе/отмене; provider dialogs снова доступны |
| Временный `/info` и восстановление связи | реальные createOAuth/createYandexClient unit: network/403/malformed; browser до и после ZIP |
| Настоящий другой ID | unit и browser до и после ZIP: 0 Яндекс PUT, остальные confirmed |
| Generation до/во время ZIP и непосредственно перед PUT | unit с реальным OAuth, browser IDB snapshot hook и управляемый upload link |
| Новое generation + неизвестный ID | real OAuth unit: чужой/старый owner отклонён, новый unknown owner ограничен своим поколением |
| Отозванный/поддельный/reset owner | unit после reserve, внутри upload-link await и progress перед PUT: 0 PUT |
| Отмена reserve | unit: rejecting reserve и late lease; browser: отмена сетевого app-folder reserve |
| IndexedDB / CRC / size отказ | unit: 0 передач; browser: реальный IDB snapshot failure; полный существующий ZIP регресс |
| Workspace/Web Locks guard | unit после ZIP и между передачами: блокировка последующих, сохранение confirmed |
| Неопределённый PUT | существующие unit/browser: один PUT/одна ссылка, нет автоматического повтора |
| Повторное открытие | unit finish и browser: пустые строки, новый выбор, старый ZIP скрыт |

Unit harness координатора управляет стадиями, но безопасность проверена также
через реальные `createOAuth`, `createYandexClient`, Google session/accounts/client
и реальные UI-маршруты. В browser подменяются сетевые ответы, не provider checks.

## Проверки после исправления

Целевые: **78/78 unit**, **23/23 browser**; дополнительный финальный прогон
пяти lifecycle browser-сценариев после уточнения HTTP 401 classification:
**5/5**. Без skip/expected failure.

Полный локальный регресс (Node 24.19.0, Chromium 154.0.8037.57):

| Команда | Результат |
| --- | --- |
| `test:source` | 17 passed |
| `test:unit` | 510 passed |
| `test:drive` | 45 passed |
| `test:yandex` | 65 passed |
| `test:cloud` | 33 passed |
| `test:pwa` | 4 passed |
| `build`, `build:verify` | passed |
| `node scripts/verify-reproducible.mjs` | passed, независимые сборки побайтно совпадают |
| `test:netlify` | 10 Node + 109 browser passed, 1 skipped, 0 failed |
| `test:all` | 246 passed, 2 skipped, 0 unexpected, 0 expected failures |
| `git diff --check` | passed |

Все три локальных пропуска — существующий ENV-001 с точным
`ERR_BLOCKED_BY_ADMINISTRATOR`: Drive file mode, built HTML file offline и
standalone HTML file/network-disabled. Проверки и условия skip не менялись.
Все новые сценарии выполнены без пропусков. Полный регресс запускался один раз;
после него исходники и тесты не менялись.

Воспроизводимые SHA-256:

- HTML: `db75423de490fac91e99fdbe45942f840de180ece60d91deb04d06e05cdbbd3e`.
- PWA ZIP: `fa0a1f87aaf9989f83e123c2510209404e75a7665e061840f4259e481449594e`.
- Netlify SHA256SUMS: `a2a6c57dbf7d3d89d446616db175d7202edb3a22a54d4d87fdee3a119fba5f22`.

GitHub Actions проверяется отдельно; ссылка, итоговый SHA и фактический статус
автоматического CI записываются в PR после завершения run.

## Ограничения и границы

- Live provider API с пользовательскими OAuth-токенами не вызывались. Отказы
  воспроизводятся управляемыми ответами поверх реальных adapters/OAuth/UI.
- Если `/info` недоступен с самого начала generation, модель app_folder не даёт
  подтвердить человекочитаемый аккаунт. Сохранена существующая совместимость
  на основании token generation + app-folder + owner capability; старый ID
  не используется как замена неизвестному.
- Временный отказ известной личности после PUT означает неопределённый результат,
  даже если файл уже сохранён. Пользователь проверяет список копий перед новым
  действием. Повторные автоматические PUT не добавлены.
- Последовательное резервирование и существующие сетевые timeout/лимиты памяти
  сохранены; общего изменения политики размера нет.
- F-05/F-06/F-08/F-09 и другие несвязанные дефекты не исправлялись.
