import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [join(dirname(require.resolve('playwright/package.json')), 'cli.js'), 'install', 'chromium'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH
      || fileURLToPath(new URL('../.cache/ms-playwright', import.meta.url)),
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
