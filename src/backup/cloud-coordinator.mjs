import { prepareWorkspaceBackup, preparedDigest } from './prepared.mjs';

export const STATES = Object.freeze({ waiting: 'Ожидание', preparing: 'Подготовка', uploading: 'Загрузка', verifying: 'Проверка подтверждения', confirmed: 'Подтверждено', unconfirmed: 'Не подтверждено', cancelled: 'Отменено', reconnect: 'Требуется повторное подключение' });
// Provider adapters own authorization and reservation. This module owns one ZIP.
export function createCloudCoordinator({ snapshot, preferences, providers = [], assertAvailable = () => {}, prepare = prepareWorkspaceBackup, changed = () => {} }) {
  let busy = false, backup = null, controller = null, results = [], message = '';
  const view = () => ({ busy, archive: backup && { filename: backup.filename, size: backup.bytes.byteLength, backupId: backup.manifest.backupId, sha256: preparedDigest(backup) }, results: results.map(r => ({ ...r })), message });
  const emit = () => changed(view());
  const recipients = () => providers.flatMap(p => p.recipients());
  async function run(ids) {
    if (busy || backup) throw Error('Сначала заверши текущий сценарий резервного копирования.');
    assertAvailable();
    const available = recipients(), selected = [...new Set(ids)].map(id => available.find(r => r.id === id));
    if (selected.some(r => !r?.available || typeof r.reserve !== 'function' || !Number.isSafeInteger(r.maxBytes) || r.maxBytes <= 0)) throw Error('Подключи выбранные аккаунты и дождись завершения их операций.');
    busy = true; controller = new AbortController(); message = ''; results = selected.map(r => ({ id: r.id, name: r.name, state: 'waiting', detail: '' })); emit();
    const leases = [];
    try {
      // reserve() claims each recipient synchronously before its first await.
      for (const [index, recipient] of selected.entries()) {
        controller.signal.throwIfAborted();
        const lease = await recipient.reserve(controller.signal);
        leases.push({ lease, recipient, row: results[index] });
      }
      controller.signal.throwIfAborted(); assertAvailable();
      for (const { lease } of leases) lease.check();
      results.forEach(r => { r.state = 'preparing'; });
      backup = await prepare({ snapshot, preferences, preparing: value => { message = value; emit(); } });
      controller.signal.throwIfAborted(); message = '';
      const oversized = selected.filter(r => backup.bytes.byteLength > r.maxBytes);
      if (oversized.length) throw Error('ZIP превышает предел: ' + oversized.map(r => `${r.name} (${r.maxBytes / 1024 / 1024} МиБ)`).join(', ') + '. Исключи это направление или уменьши ресурсы и шрифты архива. Ни одна загрузка не начата.');
      for (const { lease, row } of leases) {
        if (controller.signal.aborted) { row.state = 'cancelled'; continue; }
        try { lease.check(); }
        catch (error) { row.state = 'reconnect'; row.detail = error.message; emit(); continue; }
        try {
          row.state = 'uploading'; emit();
          const result = await lease.upload(backup, progress => { row.state = progress.phase === 'verify' ? 'verifying' : 'uploading'; row.detail = progress.message || `${Math.round(progress.confirmed / progress.total * 100)}%`; emit(); });
          if (result?.confirmed !== true) throw Error('Сервер не подтвердил загрузку. Проверь список копий перед повтором.');
          row.state = 'confirmed'; row.detail = result.verification === 'size' ? 'Сервер подтвердил имя и размер; серверный SHA-256 отсутствует.' : 'Метаданные и SHA-256 подтверждены.';
        } catch (error) { row.state = 'unconfirmed'; row.detail = error.message + ' Проверь список копий перед повтором.'; }
        emit();
      }
    } catch (error) {
      message = controller.signal.aborted ? 'Операция отменена. Уже подтверждённые файлы сохранены.' : error.message;
      for (const row of results) if (['waiting', 'preparing'].includes(row.state)) { row.state = controller.signal.aborted ? 'cancelled' : 'unconfirmed'; row.detail = message; }
    } finally {
      for (const { lease } of leases) lease.release();
      busy = false; controller = null; emit();
    }
    return view();
  }
  return { run, view, recipients,
    cancel() { controller?.abort(); },
    save(download) { if (!backup) throw Error('Сначала подготовь ZIP.'); return download(new Blob([backup.bytes], { type: 'application/zip' }), backup.filename); },
    finish() { if (busy) throw Error('Дождись завершения отмены.'); backup = null; results = []; message = ''; emit(); },
  };
}
