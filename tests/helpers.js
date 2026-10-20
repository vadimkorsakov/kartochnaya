const { test: base, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { PNG } = require('pngjs');

const fixturePath = name => path.join(__dirname, 'fixtures', name);

// Fresh browser contexts are supplied by Playwright for every test. Never expose app
// or patch the release script. Observe errors from navigation onward, including reloads.
const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const standaloneWarnings = [];
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      // Chromium requests this optional, unreferenced icon on its own. It is not
      // part of v0.45; ignore only its resource 404, never application errors.
      const optionalFavicon = message.location().url.endsWith('/favicon.ico')
        && message.text().includes('404');
      if (testInfo.project.name === 'standalone' && message.type() === 'error'
        && message.text() === 'A bad HTTP response code (404) was received when fetching the script.') {
        standaloneWarnings.push(message.text()); return;
      }
      if (message.type() === 'error' && !optionalFavicon) errors.push(`console: ${message.text()}`);
    });
    await use(page);
    if (standaloneWarnings.length) await testInfo.attach('standalone-worker-warning', { body: standaloneWarnings.join('\n'), contentType: 'text/plain' });
    expect(errors, 'No uncaught JavaScript or console errors').toEqual([]);
  },
});

async function openHome(page, url = base.info().project.name === 'standalone' ? '/standalone/kartochnaya.html' : '/') {
  const response = await page.goto(url);
  if (url.startsWith('http') || url === '/') expect(response.ok()).toBe(true);
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#createTemplateBtn')).toBeVisible();
}

async function createDocument(page, title = 'Baseline smoke', width = 320, height = 240) {
  await page.locator('#createTemplateBtn').click();
  await page.locator('#newDocTitle').fill(title);
  await page.locator('#newDocW').fill(String(width));
  await page.locator('#newDocH').fill(String(height));
  await page.locator('#confirmNewDoc').click();
  await expect(page.locator('#exportBtn')).toBeVisible();
  await expect(page.locator('#sizeLabel')).toHaveText(`${width} × ${height} px`);
  await expect(page.locator('#projectTitle')).toContainText(title);
}

async function downloadBytes(page, selector) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const filename = await download.path();
  expect(filename).toBeTruthy();
  return { bytes: await readFile(filename), name: download.suggestedFilename() };
}

async function exportedDocument(page) {
  const { bytes } = await downloadBytes(page, '#jsonExportBtn');
  const payload = JSON.parse(bytes.toString('utf8'));
  expect(payload.format).toBe('kartochnaya-v1');
  return payload.document;
}

async function exportPNG(page, width = 320, height = 240) {
  const { bytes, name } = await downloadBytes(page, '#exportBtn');
  expect(name).toMatch(/\.png$/);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const image = PNG.sync.read(bytes, { checkCRC: true });
  expect({ width: image.width, height: image.height }).toEqual({ width, height });
  expect(image.data.length).toBe(width * height * 4);
  expect(image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  return { bytes, image };
}

async function canvasPoint(page, x, y, width = 320, height = 240) {
  const box = await page.locator('#canvas').boundingBox();
  expect(box).toBeTruthy();
  return { x: box.x + box.width * x / width, y: box.y + box.height * y / height };
}

async function createText(page, content = 'Тестовый текст') {
  await page.keyboard.press('t');
  const from = await canvasPoint(page, 32, 36);
  const to = await canvasPoint(page, 260, 112);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#inlineText')).toBeVisible();
  await page.locator('#inlineText').fill(content);
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  await expect(page.locator('#inlineText')).toBeHidden();
}

async function addShape(page) {
  await page.locator('#dockShapes').click();
  await page.locator('[data-tray-shape="basic0"]').click();
  await expect(page.locator('#shapeTray')).toBeHidden();
}

async function importPayload(page, payload, name = 'synthetic.json') {
  await page.locator('#jsonInput').setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)),
  });
}

async function openLibraryDocument(page, id) {
  await page.locator(`[data-docid="${id}"] [data-projectact="open"]`).click();
  await expect(page.locator('#exportBtn')).toBeVisible();
}

// Read-only browser observation: await transaction completion and close the handle.
// No test writes directly to the application's IndexedDB or calls internal functions.
async function records(page, store) {
  return page.evaluate(async storeName => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('kartochnaya_local_v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Read aborted'));
      });
    } finally { db.close(); }
  }, store);
}

async function savedDocument(page, title, elementCount) {
  let document;
  await expect.poll(async () => {
    document = (await records(page, 'docs')).find(item => item.title === title);
    return document?.elements.length;
  }, { message: `Wait for ${title} to reach IndexedDB` }).toBe(elementCount);
  return document;
}

module.exports = {
  test, expect, fixturePath, openHome, createDocument, exportedDocument, exportPNG,
  canvasPoint, createText, addShape, importPayload, openLibraryDocument, records, savedDocument,
};
