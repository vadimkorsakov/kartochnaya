import { createBackup, readBackup, sha256, FORMAT } from './archive.mjs';

// Capability shared by the two upload clients. No additional ZIP buffer is made.
const verified = new WeakMap();
export const preparedDigest = backup => verified.get(backup);
export async function prepareWorkspaceBackup({ snapshot, preferences, preparing = () => {}, create = createBackup, read = readBackup }) {
  preparing('Подтверждаем сохранения IndexedDB и читаем согласованный снимок…');
  let data = await snapshot();
  preparing('Сохранения подтверждены. Создаём один полный ZIP…');
  const backup = await create(data, { preferences: preferences() });
  data = null;
  preparing('Проверяем ZIP: CRC, SHA-256, manifest и связи…');
  const result = await read(backup.bytes);
  if (result.manifest.scope !== 'workspace' || result.manifest.format !== FORMAT || JSON.stringify(result.manifest) !== JSON.stringify(backup.manifest) ||
      backup.filename !== `kartochnaya-${result.manifest.createdAt.replace(/[:.]/g, '-')}-${result.manifest.backupId}.zip`) throw Error('Manifest полного ZIP или имя архива не совпадает.');
  const digest = await sha256(backup.bytes);
  Object.freeze(backup.manifest); Object.freeze(backup);
  verified.set(backup, digest);
  return backup;
}
