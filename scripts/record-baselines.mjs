// Bootstrap only: refuse to replace any previously reviewed PNG baseline.
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../tests/baselines/', import.meta.url));
const existing = await readdir(directory).catch(error => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
if (existing.some(name => name.endsWith('.png'))) {
  throw new Error('PNG baselines already exist. Refusing to overwrite reviewed references. See tests/README.md.');
}
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [
  require.resolve('@playwright/test/cli'), 'test', '--project=chromium',
  'tests/visual.spec.js', '--update-snapshots=missing',
], { stdio: 'inherit', cwd: fileURLToPath(new URL('../', import.meta.url)) });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
