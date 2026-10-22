const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config');
module.exports = defineConfig({
  ...base,
  testMatch: '**/netlify.spec.js',
  fullyParallel: false, workers: 1, timeout: 60_000,
  outputDir: 'test-results/netlify',
  reporter: [['list'], ['json', { outputFile: 'test-results/netlify-results.json' }]],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4174' },
  webServer: { command: 'node scripts/netlify-test-server.mjs', url: 'http://127.0.0.1:4174', reuseExistingServer: false },
  projects: [{ name: 'netlify', use: { browserName: 'chromium' } }],
});
