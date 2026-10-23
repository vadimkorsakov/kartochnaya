import { randomString, signedEndpoint, networkError } from './oauth.mjs';
export const MAX_TEST_BYTES = 1024;
export const STEPS = { identity: 'Идентификация /info', folder: 'Папка app:/', uploadLink: 'Ссылка загрузки', put: 'PUT тестового файла', downloadLink: 'Ссылка скачивания', get: 'GET тестового файла', remove: 'Удаление тестового файла' };
const endpoint = (suffix, path) => 'https://cloud-api.yandex.net/v1/disk/resources' + suffix + '?' + new URLSearchParams({ path });
export function createDiagnostics(oauth, changed = () => {}) {
  let results = {}, path = '', busy = false, removable = false;
  const view = () => ({ results: { ...results }, path, busy, removable });
  const emit = () => changed(view());
  async function step(key, action, check) {
    results[key] = 'Проверяется…'; emit();
    try { const value = await action(); check(); results[key] = 'Подтверждено: ответ доступен JavaScript.'; emit(); return value; }
    catch (error) {
      results[key] = 'Заблокировано: ' + (error instanceof TypeError ? networkError(STEPS[key]) : error.message); emit(); throw error;
    }
  }
  async function json(res) {
    if (!res.ok) throw Error(res.status === 403 ? 'HTTP 403: доступ запрещён; возможны недостаточные разрешения. Scope не расширяется.' : `HTTP ${res.status}: API недоступен или операция отклонена.`);
    try { return await res.json(); } catch { throw Error('API вернул некорректный JSON.'); }
  }
  async function task(action) {
    if (busy) return;
    busy = true; emit();
    try { await oauth.operation(action); } catch { /* Safe, per-step results already rendered. */ }
    finally { busy = false; emit(); }
  }
  async function api() {
    return task(async op => {
      // Independently test each endpoint: /info failure does not block app:/.
      for (const [key, url] of [['identity', 'https://login.yandex.ru/info'], ['folder', endpoint('', 'app:/')]]) {
        try { await step(key, async () => {
          const body = await json(await op.request(url));
          if (key === 'identity' && (typeof body.id !== 'string' || !body.id)) throw Error('Устойчивый ID отсутствует; дополнительные scope не запрашиваются.');
          // Account identifiers and directory contents are not retained/displayed.
        }, op.check); } catch { /* Continue independent permission/CORS checks. */ }
      }
    });
  }
  async function transfer() {
    if (path) return; // Never lose an unremoved file by starting another probe.
    return task(async op => {
      const candidate = 'app:/kartochnaya-probe-' + randomString() + '.txt';
      const content = new TextEncoder().encode('КАРТОЧНАЯ: browser CORS probe\n' + randomString() + '\n');
      if (content.length > MAX_TEST_BYTES) throw Error('Тестовый файл слишком большой.');
      for (const key of ['uploadLink', 'put', 'downloadLink', 'get', 'remove']) delete results[key];
      const upload = await step('uploadLink', async () => {
        const body = await json(await op.request(endpoint('/upload', candidate) + '&overwrite=false'));
        if (body.method !== 'PUT' || body.templated === true) throw Error('Ошибка контракта подписанного URL загрузки.');
        return signedEndpoint(body.href);
      }, op.check);
      path = candidate; removable = true; emit(); // PUT may succeed even if its response is blocked.
      await step('put', async () => {
        const res = await op.request(upload, { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content }, false);
        if (!res.ok) throw Error(`HTTP ${res.status}: ошибка записи тестового файла.`);
      }, op.check);
      const download = await step('downloadLink', async () => {
        const body = await json(await op.request(endpoint('/download', path)));
        if (body.method !== 'GET' || body.templated === true) throw Error('Ошибка контракта подписанного URL скачивания.');
        return signedEndpoint(body.href);
      }, op.check);
      await step('get', async () => {
        const res = await op.request(download, {}, false);
        if (!res.ok || !res.body) throw Error(`HTTP ${res.status}: ошибка чтения тестового файла.`);
        const reader = res.body.getReader(); let size = 0; const bytes = [];
        try {
          while (true) {
            op.check(); const { done, value } = await reader.read(); if (done) break;
            size += value.length;
            if (size > MAX_TEST_BYTES) throw Error('Ответ превышает предел 1024 байта.');
            bytes.push(...value);
          }
        } catch (error) {
          if (error instanceof TypeError) throw Error(networkError('Чтение файла'));
          if (error.name !== 'Error') throw Error('Чтение тестового файла прервано.');
          throw error;
        } finally { await reader.cancel().catch(() => {}); }
        if (size !== content.length || bytes.some((v, i) => v !== content[i])) throw Error('Содержимое скачанного файла не совпадает с оригиналом.');
      }, op.check);
      results.get = 'Подтверждено: ответ прочитан, содержимое совпадает. Можно удалить только этот тестовый файл.'; emit();
    });
  }
  async function remove() {
    if (!path || !removable) return;
    return task(async op => {
      await step('remove', async () => {
        const res = await op.request(endpoint('', path) + '&permanently=true', { method: 'DELETE' });
        if (res.status !== 204 && res.status !== 404) throw Error(`HTTP ${res.status}: удаление не подтверждено. Оставшийся путь: ${path}`);
      }, op.check);
      path = ''; removable = false; emit();
    });
  }
  // After disconnect no deletion in another account; retain only safe orphan path.
  function disconnected() { removable = false; results = {}; emit(); }
  return { view, api, transfer, remove, disconnected };
}
