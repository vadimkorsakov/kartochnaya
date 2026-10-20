const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const {
  test, expect, fixturePath, openHome, createDocument, exportPNG,
  importPayload, savedDocument, openLibraryDocument,
} = require('./helpers');
const environment = require('./baselines/environment.json');
const shapes = require('./fixtures/visual-shapes.json');
const text = require('./fixtures/visual-text.json');

test.beforeAll(async ({ browser }) => {
  expect(browser.version(), 'Use the recorded Chromium version; do not regenerate PNGs to hide environment differences')
    .toBe(environment.chromium);
  expect(process.platform).toBe(environment.platform);
  expect(process.arch).toBe(environment.arch);
  expect(require('@playwright/test/package.json').version).toBe(environment.playwright);
  const font = await readFile(fixturePath('fonts/DejaVuSans.ttf'));
  expect(createHash('sha256').update(font).digest('hex')).toBe(environment.font.sha256);
});

test('visual baseline: blank 320x240 canvas', async ({ page }) => {
  await openHome(page);
  await createDocument(page, 'Visual blank');
  const { bytes } = await exportPNG(page);
  expect(bytes).toMatchSnapshot('blank-320x240.png', { threshold: 0, maxDiffPixels: 0 });
});

test('visual baseline: small shapes, rotation and opacity', async ({ page }) => {
  await openHome(page);
  await importPayload(page, shapes);
  const document = await savedDocument(page, shapes.document.title + ' (импорт)', 3);
  await openLibraryDocument(page, document.id);
  const { bytes } = await exportPNG(page);
  expect(bytes).toMatchSnapshot('shapes-320x240.png', { threshold: 0, maxDiffPixels: 0 });
});

test('visual baseline: Cyrillic and Latin text in the bundled fixed font', async ({ page }) => {
  await openHome(page);
  await page.locator('#fontInput').setInputFiles(fixturePath('fonts/DejaVuSans.ttf'));
  await expect.poll(() => page.evaluate(() => document.fonts.check('27px "DejaVu Sans"'))).toBe(true);
  // FontFaceSet.check alone accepts nonexistent families; require the actual loaded face.
  await expect.poll(() => page.evaluate(() => [...document.fonts].some(face =>
    face.family.replace(/^"|"$/g, '') === 'DejaVu Sans' && face.status === 'loaded'))).toBe(true);
  await importPayload(page, text);
  const document = await savedDocument(page, text.document.title + ' (импорт)', 1);
  await openLibraryDocument(page, document.id);
  const { bytes } = await exportPNG(page);
  expect(bytes).toMatchSnapshot('text-320x240.png', { threshold: 0, maxDiffPixels: 0 });
});
