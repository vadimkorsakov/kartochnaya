const { test, expect, openHome, createDocument, canvasPoint, exportedDocument, addShape, importPayload, openLibraryDocument, records } = require('./helpers');
const graph = require('./fixtures/canvas-graph.json');

async function textDocument(page) {
  await openHome(page);
  await createDocument(page, 'Numeric input Enter');
  await page.keyboard.press('t');
  const a = await canvasPoint(page, 30, 40), b = await canvasPoint(page, 270, 130);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  await page.locator('#inlineText').fill('Текст');
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  await expect(page.locator('#inlineText')).toBeHidden();
}

const steps = page => page.locator('#historyEntries .history-entry').count();

test('font size Enter commits and releases arrow keys back to the selected layer', async ({ page }) => {
  await textDocument(page);
  const before = (await exportedDocument(page)).elements[0];
  const size = page.locator('#inspector input[type="number"][data-key="fontSize"]');
  const count = await steps(page);
  await size.focus();
  await size.press('ArrowUp');
  await size.press('Enter');
  await expect(page.locator('#canvas')).toBeFocused();
  expect((await exportedDocument(page)).elements[0].fontSize).toBe(before.fontSize + 1);
  expect(await steps(page)).toBe(count + 1);
  await page.keyboard.press('ArrowDown');
  const moved = (await exportedDocument(page)).elements[0];
  expect(moved.y).toBe(before.y + 1);
  expect(moved.fontSize).toBe(before.fontSize + 1);
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements[0].y).toBe(before.y);
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements[0].fontSize).toBe(before.fontSize);
});

test('numeric position edit has one history entry and supports Undo/Redo', async ({ page }) => {
  await openHome(page); await createDocument(page); await addShape(page);
  const original = (await exportedDocument(page)).elements[0];
  const count = await steps(page);
  const x = page.locator('#inspector input[type="number"][data-key="x"]');
  await x.fill(String(original.x + 13));
  await x.press('Enter');
  await expect(page.locator('#canvas')).toBeFocused();
  expect((await exportedDocument(page)).elements[0].x).toBe(original.x + 13);
  expect(await steps(page)).toBe(count + 1);
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements[0].x).toBe(original.x);
  await page.locator('#redoBtn').click();
  expect((await exportedDocument(page)).elements[0].x).toBe(original.x + 13);
});

test('effect number Enter commits without dismissing the settings popover', async ({ page }) => {
  await openHome(page); await createDocument(page); await addShape(page);
  await page.locator('#inspector [data-fx-show]').click();
  await page.locator('#fxChooser [data-fx-add="layerBlur"]').click();
  await expect(page.locator('#fxPopover')).toBeVisible();
  const radius = page.locator('#fxPopover input[type="number"][data-fx-key="radius"]');
  const old = Number(await radius.inputValue()), count = await steps(page);
  // A manually typed fractional value must remain valid even if it mismatches the slider step.
  await radius.fill(String(old + 2.25));
  await radius.press('Enter');
  await expect(page.locator('#fxPopover')).toBeVisible();
  await expect(page.locator('#canvas')).toBeFocused();
  expect((await exportedDocument(page)).elements[0].effects[0].radius).toBe(old + 2.25);
  expect(await steps(page)).toBe(count + 1);
});

test('invalid or empty numeric input does not become zero, ordinary blur commits', async ({ page }) => {
  await textDocument(page);
  const font = page.locator('#inspector input[type="number"][data-key="fontSize"]');
  const old = Number(await font.inputValue()), count = await steps(page);
  await font.fill('');
  await font.press('Enter');
  expect((await exportedDocument(page)).elements[0].fontSize).toBe(old);
  expect(await steps(page)).toBe(count);
  await font.fill('99999999');
  await font.press('Enter');
  expect((await exportedDocument(page)).elements[0].fontSize).toBe(old);
  expect(await steps(page)).toBe(count);
  await font.fill(String(old + 3));
  await page.locator('#projectTitle').click();
  expect((await exportedDocument(page)).elements[0].fontSize).toBe(old + 3);
  expect(await steps(page)).toBe(count + 1);
});

test.describe('mobile numeric properties', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('Done/Enter commits font size without closing the mobile property UI', async ({ page }) => {
    await openHome(page);
    const fixture = structuredClone(graph);
    fixture.documents = [fixture.documents[0]];
    await importPayload(page, fixture);
    const doc = (await records(page, 'docs')).find(d => d.title === 'Graph template');
    expect(doc).toBeTruthy();
    await openLibraryDocument(page, doc.id);
    await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
    await page.locator('#mobileLayerList [data-layer="title"] .layer-name').tap();
    await page.locator('#mobileLayersClose').tap();
    await page.locator('#mobileContext [data-mobile="size"]').tap();
    await expect(page.locator('#mobilePropertyUI')).toHaveClass(/mp-open/);
    const size = page.locator('#mobilePropertyUI input[type="number"][data-mp-key="fontSize"]');
    await expect(size).toBeVisible();
    const old = Number(await size.inputValue()), count = await steps(page);
    await size.fill(String(old + 2));
    await size.press('Enter');
    await expect(size).not.toBeFocused();
    await expect(page.locator('#mobilePropertyUI')).toHaveClass(/mp-open/);
    const updated = await exportedDocument(page);
    expect(updated.elements.find(e => e.id === 'title').fontSize).toBe(old + 2);
    expect(await steps(page)).toBe(count + 1);
  });
});
