const { test, expect, openHome, createDocument, canvasPoint, exportedDocument, importPayload, openLibraryDocument, records } = require('./helpers');
const fixture = require('./fixtures/canvas-graph.json');

async function drawTextFrame(page, value = 'Текст') {
  await openHome(page);
  await createDocument(page, 'Text autofit', 320, 240);
  await page.keyboard.press('t');
  const a = await canvasPoint(page, 30, 40), b = await canvasPoint(page, 270, 130);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('#inlineText')).toBeFocused();
  await page.locator('#inlineText').fill(value);
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  await expect(page.locator('#inlineText')).toBeHidden();
  return (await exportedDocument(page)).elements[0];
}
const historyCount = page => page.locator('#historyEntries [data-history-index]').count();

test('a new horizontal frame automatically fits font size to the text', async ({ page }) => {
  const e = await drawTextFrame(page, 'Короткий текст');
  expect(e.autoFontSize).toBe(true);
  expect(e.fontSize).toBeGreaterThan(20);
  expect(e.w).toBe(240);
  expect(e.h).toBe(90);
  await expect(page.locator('#inspector [data-text-auto-font]')).toBeChecked();
});

test('disabling auto sizing preserves manual font size even when the frame is resized', async ({ page }) => {
  const original = await drawTextFrame(page, 'Пример');
  const auto = page.locator('#inspector [data-text-auto-font]');
  await auto.uncheck();
  expect((await exportedDocument(page)).elements[0].autoFontSize).toBe(false);
  const size = page.locator('#inspector [data-key="fontSize"]');
  await size.fill('22');
  await size.press('Enter');
  await expect(auto).not.toBeChecked();
  const width = page.locator('#inspector [data-key="w"]');
  await width.fill('125');
  await width.press('Enter');
  const now = (await exportedDocument(page)).elements[0];
  expect(now.fontSize).toBe(22);
  expect(now.w).toBe(125);
  await auto.check();
  const fitted = (await exportedDocument(page)).elements[0];
  expect(fitted.autoFontSize).toBe(true);
  expect(fitted.fontSize).not.toBe(22);
  expect(fitted.text).toBe(original.text);
});

test('double click on an edge fits text box to its content with a single Undo', async ({ page }) => {
  await drawTextFrame(page, 'Привет');
  const toggle = page.locator('#inspector [data-text-auto-font]');
  await toggle.uncheck();
  const size = page.locator('#inspector [data-key="fontSize"]');
  await size.fill('24'); await size.press('Enter');
  const before = (await exportedDocument(page)).elements[0], count = await historyCount(page);
  const p = await canvasPoint(page, before.x + before.w / 2, before.y + 1);
  await page.mouse.dblclick(p.x, p.y);
  const after = (await exportedDocument(page)).elements[0];
  expect(after.text).toBe('Привет');
  expect(after.w).toBeLessThan(before.w);
  expect(after.h).toBeLessThan(before.h);
  expect(await historyCount(page)).toBe(count + 1);
  await expect(page.locator('#inlineText')).toBeHidden();
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements[0].w).toBe(before.w);
  await page.locator('#redoBtn').click();
  expect((await exportedDocument(page)).elements[0].w).toBe(after.w);
  const inside = await canvasPoint(page, after.x + after.w / 2, after.y + after.h / 2);
  await page.mouse.dblclick(inside.x, inside.y);
  await expect(page.locator('#inlineText')).toBeFocused();
});

test('auto font adjusts when text changes; empty text keeps a persistent frame', async ({ page }) => {
  await openHome(page); await createDocument(page, 'Live sizing');
  await page.keyboard.press('t');
  const a = await canvasPoint(page, 20, 20), b = await canvasPoint(page, 180, 65);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up();
  const editor = page.locator('#inlineText');
  await editor.fill('А');
  const first = await editor.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await editor.fill('Слово за словом возникает длинная строка и много переносов текста');
  const second = await editor.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(second).toBeLessThan(first);
  await editor.fill('');
  await editor.press('ControlOrMeta+Enter');
  const e = (await exportedDocument(page)).elements[0];
  expect(e.text).toBe('');
  expect(e.autoFontSize).toBe(true);
  expect(e.w).toBe(160);
  expect(e.h).toBe(45);
});

test.describe('mobile auto sizing', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('legacy text has no automatic fitting; mobile can enable auto size', async ({ page }) => {
  await openHome(page);
  const data = structuredClone(fixture);
  data.documents = [data.documents[0]];
  await importPayload(page, data);
  const record = (await records(page, 'docs')).find(d => d.title === 'Graph template');
  expect(record).toBeTruthy();
  await openLibraryDocument(page, record.id);
  await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
  await page.locator('#mobileLayerList [data-layer="title"] .layer-name').tap();
  await page.locator('#mobileLayersClose').tap();
  const before = (await exportedDocument(page)).elements.find(x => x.id === 'title');
  expect(before.autoFontSize).toBeUndefined();
  await page.locator('#mobileContext [data-mobile="size"]').tap();
  await expect(page.locator('#mobilePropertyUI')).toHaveClass(/mp-open/);
  const auto = page.locator('#mobilePropertyUI [data-text-auto-font]');
  await expect(auto).not.toBeChecked();
  await auto.check();
  await expect(page.locator('#mobilePropertyUI')).toHaveClass(/mp-open/);
  const after = (await exportedDocument(page)).elements.find(x => x.id === 'title');
  expect(after.autoFontSize).toBe(true);
  expect(after.fontSize).toBeGreaterThan(0);
  });
});
