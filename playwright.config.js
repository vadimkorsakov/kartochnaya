const { defineConfig } = require('@playwright/test');
const path = require('node:path');

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(__dirname, '.cache/ms-playwright');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  forbidOnly: true,
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  outputDir: 'test-results',
  reporter: [
    ['list'], ['./scripts/test-summary.cjs'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'ru-RU',
    timezoneId: 'UTC',
    colorScheme: 'light',
    acceptDownloads: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 15_000,
  },
  projects: [
    { name: 'chromium', testIgnore: ['**/known-failures.spec.js', '**/netlify.spec.js', '**/google-drive.spec.js', '**/yandex-disk.spec.js'], use: { browserName: 'chromium' } },
    { name: 'standalone', testMatch: /(?:smoke|visual)\.spec\.js$/, use: { browserName: 'chromium' } },
    { name: 'known-failures', testMatch: '**/known-failures.spec.js', use: { browserName: 'chromium' } },
  ],
});
