const { mkdir, copyFile, readdir } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const baseline = require('../docs/baseline-v045.json');
const { test, expect, openHome, createDocument, addShape, exportPNG } = require('./helpers');

test('all packaged PWA assets are available with their original bytes', async ({ request }) => {
  const assets = Object.entries(baseline.files).filter(([name]) => name !== 'README.md');
  expect(assets).toHaveLength(18);
  for (const [name, expected] of assets) {
    const response = await request.get('/' + name.split('/').map(encodeURIComponent).join('/'));
    expect(response.status(), name).toBe(200);
    const bytes = await response.body();
    expect(bytes.length, name).toBe(expected.bytes);
    expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(expected.sha256);
  }
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ start_url: './', scope: './', display: 'standalone' });
  expect(manifest.icons.map(icon => icon.src)).toEqual(['./icon-192.png', './icon-512.png']);
});

test('the existing HTML works alone via file:// with the network disabled', async ({ page, context }, testInfo) => {
  const directory = testInfo.outputPath('standalone');
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, 'index.html');
  await copyFile(path.join(__dirname, '..', baseline.applicationRoot, 'index.html'), target);
  expect(await readdir(directory)).toEqual(['index.html']);
  const networkRequests = [];
  page.on('request', request => {
    if (/^https?:/.test(request.url())) networkRequests.push(request.url());
  });
  await context.setOffline(true);
  try {
    await openHome(page, pathToFileURL(target).href);
  } catch (error) {
    // A managed browser may forbid file URLs. Do not disable administrator policy
    // or substitute an HTTP run and claim file:// was verified.
    if (!error.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR')) throw error;
    if (process.env.KARTOCHNAYA_REQUIRE_FILE_URL === '1') throw error;
    await testInfo.attach('environment-blocker', {
      body: 'ENV-001: managed Chromium blocks file:// navigation (ERR_BLOCKED_BY_ADMINISTRATOR). No application assertion ran.',
      contentType: 'text/plain',
    });
    test.skip(true, 'ENV-001: administrator policy blocks file://; rerun in a browser where local-file navigation is permitted');
  }
  await createDocument(page, 'Standalone smoke');
  await addShape(page);
  await exportPNG(page);
  expect(networkRequests).toEqual([]);
});

test('service worker reloads the editor offline after activation', async ({ page, context }) => {
  await openHome(page);
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state === 'activated';
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#createTemplateBtn')).toBeVisible();
  await createDocument(page, 'Offline smoke');
  await addShape(page);
  await exportPNG(page);
});
