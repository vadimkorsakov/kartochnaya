const { PNG } = require('pngjs');
const { test, expect, openHome, createDocument, importPayload, records, openLibraryDocument, exportedDocument, exportPNG, canvasPoint } = require('./helpers');

test.use({ serviceWorkers: 'block' });
const editorUIState = () => ({
  focus: { tag: document.activeElement?.tagName, id: document.activeElement?.id, className: document.activeElement?.className, editable: document.activeElement?.isContentEditable },
  selected: [...document.querySelectorAll('#layers .layer.selected')].map(e => e.dataset.layer),
  chooser: document.querySelector('#fxChooser')?.className,
  rename: !!document.querySelector('#layers .layer-rename-input'),
  tools: [...document.querySelectorAll('#dockMarquee.selected,#dockPen.selected,#dockSelect.selected')].map(e => e.id),
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await info.attach('region-ui-diagnostics', { body: JSON.stringify(await page.evaluate(editorUIState)), contentType: 'application/json' });
});
async function open(page, grouped = false) {
  await page.addInitScript(() => {
    window.regionWrites = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      if (this.name === 'docs') this.transaction.addEventListener('complete', () => regionWrites.push(structuredClone(value)));
      return put.call(this, value, ...args);
    };
  });
  await openHome(page);
  const elements = [
    { id: 'first', name: 'First', x: 0, y: 40, w: 70, h: 60, fill: '#ff0000' },
    { id: 'second', name: 'Second', x: 210, y: 140, w: 65, h: 60, fill: '#0000ff' },
  ].map(e => ({ type: 'rect', rotation: 0, opacity: 100, visible: true, fillType: 'solid', fillOpacity: 100, strokeWidth: 0, ...e }));
  await importPayload(page, { format: 'kartochnaya-project-v1', project: { id: 'region', name: 'Region tests', resources: [], resourceFolders: [] }, documents: [{ id: 'region-doc', projectId: 'region', title: 'Region document', type: 'template', width: 320, height: 240, background: '#ffffff', backgroundAlpha: 100, createdAt: 1, updatedAt: 1, rulers: [], palette: [], groups: grouped ? [{ id: 'objects', name: 'Objects', visible: true, locked: false }] : [], elements: grouped ? elements.map(e => ({ ...e, groupId: 'objects' })) : elements }], fonts: [] });
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const doc = (await records(page, 'docs')).find(d => d.title === 'Region document');
  await openLibraryDocument(page, doc.id);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  return doc;
}
async function drag(page, x, y, dx, dy) {
  const a = await canvasPoint(page, x, y), b = await canvasPoint(page, x + dx, y + dy);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
}
async function selection(page) {
  await page.locator('#dockMarquee').click();
  await drag(page, 15, 25, 100, 95);
}
async function addRegion(page) {
  await selection(page); await page.locator('#fxFromSelection').click();
  await page.locator('[data-fx-add="gaussianBlur"]').click();
}
const history = page => page.locator('#historyEntries [data-history-index]').evaluateAll(rows => ({ length: rows.length, index: rows.findIndex(r => r.getAttribute('aria-current') === 'step') }));
const selected = page => page.locator('#layers .layer.selected').getAttribute('data-layer');
async function selectLayer(page, id) {
  await page.locator(`#layers [data-layer="${id}"] .layer-name`).click();
  await expect(page.locator('#layers .layer.selected')).toHaveAttribute('data-layer', id);
  await expect(page.locator('#layers .layer-rename-input')).toHaveCount(0);
}
async function openLayerEffectChooser(page, id) {
  await expect(page.locator('#layers .layer.selected')).toHaveAttribute('data-layer', id);
  await expect(page.locator('[data-fx-show]')).not.toHaveAttribute('data-fx-region', 'true');
  await expect(page.locator('#fxChooser')).toBeHidden();
  await page.locator('[data-fx-show]').click();
  await expect(page.locator('#fxChooser')).toBeVisible();
}

test('region permits real canvas selection and movement, including after lock and reselection', async ({ page }) => {
  await open(page); await addRegion(page);
  const model = await exportedDocument(page), region = model.elements.find(e => e.isFxRegion);
  await expect(page.locator('#dockSelect')).toHaveClass(/selected/);
  for (const locked of [false, true, false]) {
    if (locked !== !!(await exportedDocument(page)).elements.find(e => e.id === region.id).locked)
      await page.locator(`#layers [data-layeract="lock"][data-id="${region.id}"]`).click();
    for (const name of ['First', 'Second']) {
      await selectLayer(page, region.id);
      const before = (await exportedDocument(page)).elements.find(e => e.name === name);
      // First starts at the document edge: an active full-canvas handle must not intercept it.
      const x = name === 'First' ? before.x + 3 : before.x + 30, y = before.y + 30;
      const p = await canvasPoint(page, x, y); await page.mouse.click(p.x, p.y);
      expect(await selected(page)).toBe(before.id);
      await drag(page, before.x + 30, y, 12, 8);
      const after = (await exportedDocument(page)).elements.find(e => e.id === before.id);
      expect(after.x).toBe(before.x + 12); expect(after.y).toBe(before.y + 8);
      await page.locator('#undoBtn').click();
      expect((await exportedDocument(page)).elements.find(e => e.id === before.id)).toEqual(before);
    }
  }
  expect((await exportedDocument(page)).elements.find(e => e.id === region.id)).toMatchObject({ x: 0, y: 0, w: 320, h: 240 });
});

test('selection effect is one history operation with complete Undo and Redo', async ({ page }) => {
  await open(page); const original = await exportedDocument(page);
  await selection(page); const h = await history(page);
  await page.locator('#fxFromSelection').click(); await page.locator('[data-fx-add="gaussianBlur"]').click();
  const added = await exportedDocument(page);
  expect(await history(page)).toEqual({ length: h.length + 1, index: h.index + 1 });
  expect(added.elements).toHaveLength(3); expect(added.elements.slice(0, 2)).toEqual(original.elements);
  expect(added.elements[2]).toMatchObject({ isFxRegion: true, effects: [{ type: 'gaussianBlur', radius: 32 }] });
  expect(added.elements[2].layerMaskSrc).toMatch(/^data:image\/png;base64,/);
  expect(added.elements[2].effects[0].maskSrc).toBe(added.elements[2].layerMaskSrc);
  const mask = PNG.sync.read(Buffer.from(added.elements[2].layerMaskSrc.split(',')[1], 'base64'));
  expect([mask.width, mask.height]).toEqual([320, 240]);
  expect(mask.data[(50 * 320 + 30) * 4 + 3]).toBe(255);
  expect(mask.data[(170 * 320 + 240) * 4 + 3]).toBe(0);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(original.elements);
  await page.locator('#redoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(added.elements);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  const writes = await page.evaluate(() => regionWrites);
  for (const write of writes) for (const e of write.elements.filter(e => e.isFxRegion)) {
    expect(e.effects).toHaveLength(1); expect(e.layerMaskSrc).toBe(added.elements[2].layerMaskSrc);
  }
});

test('opening and cancelling selection effects is read only', async ({ page }) => {
  await open(page); await selection(page);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  const before = await exportedDocument(page), h = await history(page), stored = await records(page, 'docs');
  const writes = await page.evaluate(() => regionWrites.length);
  await page.locator('#fxFromSelection').click();
  await expect(page.locator('#fxChooser')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#fxChooser')).toBeHidden();
  await page.locator('#fxFromSelection').click();
  await page.locator('#dockSelect').click();
  await page.waitForTimeout(600); // Longer than the existing 420 ms save debounce.
  expect(await exportedDocument(page)).toEqual(before); expect(await history(page)).toEqual(h);
  expect(await records(page, 'docs')).toEqual(stored); expect(await page.evaluate(() => regionWrites.length)).toBe(writes);
});

test('existing region effects and parameters each keep their own history; new edits invalidate Redo', async ({ page }) => {
  await page.clock.install();
  await open(page); await addRegion(page);
  const first = await exportedDocument(page), region = first.elements[2], h = await history(page);
  await openLayerEffectChooser(page, region.id); await page.locator('[data-fx-add="noise"]').click();
  const second = await exportedDocument(page);
  expect(second.elements[2].effects.map(f => f.type)).toEqual(['gaussianBlur', 'noise']);
  expect(await history(page)).toEqual({ length: h.length + 1, index: h.index + 1 });
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(first.elements);
  await page.locator('#redoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(second.elements);
  // Keep these real pointer actions within the rename double-click interval.
  // Reload can advance the browser clock beyond the test runner's wall time.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await selectLayer(page, region.id);
  await page.locator(`[data-fx-row="${region.effects[0].id}"] .fx-name`).click();
  const radius = page.locator(`#fxPopover [data-fx-field="${region.effects[0].id}"][data-fx-key="radius"]`);
  await radius.fill('18'); await radius.press('Tab');
  expect((await exportedDocument(page)).elements[2].effects[0].radius).toBe(18);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(second.elements);
  await page.locator('#undoBtn').click();
  await selectLayer(page, region.id);
  await openLayerEffectChooser(page, region.id); await page.locator('[data-fx-add="layerBlur"]').click();
  expect((await exportedDocument(page)).elements[2].effects.map(f => f.type)).toEqual(['gaussianBlur', 'layerBlur']);
  await expect(page.locator('#redoBtn')).toBeDisabled();
  await page.clock.resume();
});

test('selected ordinary layer stays unchanged by region command; object properties keep their semantics', async ({ page }) => {
  await open(page); await selectLayer(page, 'first');
  const before = await exportedDocument(page); await selection(page);
  await page.locator('#fxFromSelection').click();
  await page.locator('[data-fx-show]').click(); await expect(page.locator('#fxChooser')).toBeHidden();
  await page.locator('[data-fx-show]').click(); await page.locator('[data-fx-add="gaussianBlur"]').click();
  expect((await exportedDocument(page)).elements.slice(0, 2)).toEqual(before.elements);
  await selectLayer(page, 'second');
  await page.locator('[data-fx-show]').click(); await page.locator('[data-fx-add="layerBlur"]').click();
  const after = await exportedDocument(page);
  expect(after.elements).toHaveLength(3); expect(after.elements[1].effects.map(f => f.type)).toEqual(['layerBlur']);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements[1]).toEqual(before.elements[1]);
});

test('masked PNG survives Redo, confirmed save, reload and JSON import; old regions remain editable', async ({ page }) => {
  await page.clock.install();
  const doc = await open(page); const plain = await exportPNG(page);
  await addRegion(page); const added = await exportedDocument(page), png = await exportPNG(page);
  expect(png.image.data.equals(plain.image.data)).toBe(false);
  // The second shape lies entirely outside the mask and is unchanged.
  const offset = (170 * 320 + 240) * 4;
  expect(png.image.data.subarray(offset, offset + 4)).toEqual(plain.image.data.subarray(offset, offset + 4));
  await page.locator('#undoBtn').click(); expect((await exportPNG(page)).image.data).toEqual(plain.image.data);
  await page.locator('#redoBtn').click(); expect((await exportPNG(page)).image.data).toEqual(png.image.data);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  expect((await records(page, 'docs')).find(d => d.id === doc.id).elements).toEqual(added.elements);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); await openLibraryDocument(page, doc.id);
  expect((await exportedDocument(page)).elements).toEqual(added.elements);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
  await importPayload(page, { format: 'kartochnaya-v1', document: added, resources: [], fonts: [] });
  await expect(page.locator('#toast')).toContainText('Документ импортирован');
  const roundtrip = await exportedDocument(page);
  expect(roundtrip.elements.map(e => ({ ...e, id: null }))).toEqual(added.elements.map(e => ({ ...e, id: null })));
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
  const region = roundtrip.elements.find(e => e.isFxRegion);
  // Keep these real pointer actions within the rename double-click interval.
  // Reload can advance the browser clock beyond the test runner's wall time.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await selectLayer(page, region.id); await page.locator(`#layers [data-layeract="visibility"][data-id="${region.id}"]`).click();
  expect((await exportPNG(page)).image.data).toEqual(plain.image.data);
  await page.locator(`#layers [data-layeract="visibility"][data-id="${region.id}"]`).click();
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
  await selectLayer(page, region.id);
  const beforeDelete = await exportedDocument(page), deleteHistory = await history(page);
  expect(await page.evaluate(() => document.activeElement.matches('input,textarea,select,[contenteditable="true"]') || document.activeElement.isContentEditable)).toBe(false);
  await expect(page.locator('#dockSelect')).toHaveClass(/selected/);
  await expect(page.locator('#inlineText')).toBeHidden();
  await page.keyboard.press('Delete');
  const remaining = beforeDelete.elements.filter(e => e.id !== region.id);
  expect(remaining).toHaveLength(2);
  expect((await exportedDocument(page)).elements).toEqual(remaining);
  expect(await history(page)).toEqual({ length: deleteHistory.length + 1, index: deleteHistory.index + 1 });
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(beforeDelete.elements);
  await page.locator('#redoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(remaining);
  await page.clock.resume();
});

for (const active of [false, true]) test(`mobile chooser adds one atomic region effect (ordinary object selected: ${active})`, async ({ page }) => {
  await open(page); if (active) await selectLayer(page, 'first'); await selection(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await exportedDocument(page), h = await history(page);
  await page.locator('#fxFromSelection').click();
  await expect(page.locator('[data-mp-effect="gaussianBlur"]')).toBeVisible();
  expect((await exportedDocument(page)).elements).toEqual(before.elements); expect(await history(page)).toEqual(h);
  await page.locator('[data-mp-action="done"]').click();
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#fxFromSelection').click(); await page.locator('[data-mp-effect="gaussianBlur"]').click();
  const after = await exportedDocument(page);
  expect(after.elements).toHaveLength(3); expect(after.elements[2].effects.map(f => f.type)).toEqual(['gaussianBlur']);
  expect(await history(page)).toEqual({ length: h.length + 1, index: h.index + 1 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#redoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(after.elements);
});

test('groups below a region move normally and ordinary handles still resize', async ({ page }) => {
  await open(page, true); await addRegion(page);
  const before = await exportedDocument(page), region = before.elements[2];
  const p = await canvasPoint(page, 30, 70); await page.mouse.click(p.x, p.y);
  await expect(page.locator('#layers .layer.selected')).toHaveCount(2);
  await drag(page, 30, 70, 12, 8);
  const moved = await exportedDocument(page);
  for (let i = 0; i < 2; i++) expect(moved.elements[i]).toEqual({ ...before.elements[i], x: before.elements[i].x + 12, y: before.elements[i].y + 8 });
  expect(moved.elements[2]).toEqual(region);
  await page.locator('#undoBtn').click();
  // Thumbnail selection isolates the ordinary object from its group, as before.
  await page.locator('#layers [data-select-layer-thumb="first"]').click();
  await drag(page, 70, 100, 20, 20);
  expect((await exportedDocument(page)).elements[0]).toMatchObject({ x: 0, y: 40, w: 93, h: 80 });
});

test('pending selection effect never leaks across document tabs', async ({ page }) => {
  const first = await open(page); await addRegion(page); const original = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'Other document');
  const second = await exportedDocument(page);
  await page.locator(`[data-tab-id="${first.id}"]`).click();
  await page.locator('#dockMarquee').click(); await page.locator('#fxFromSelection').click();
  await expect(page.locator('#fxChooser')).toBeVisible();
  await page.locator(`[data-tab-id="${second.id}"]`).click();
  expect((await exportedDocument(page)).elements).toEqual([]);
  await page.locator(`[data-tab-id="${first.id}"]`).click();
  expect((await exportedDocument(page)).elements).toEqual(original.elements);
  await expect(page.locator('#fxChooser')).toBeHidden();
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toHaveLength(2);
  await page.locator('#redoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(original.elements);
});

test('region layer can be reordered and restored with ordinary history', async ({ page }) => {
  await open(page); await addRegion(page);
  const before = await exportedDocument(page), region = before.elements[2];
  const rows = page.locator('#layers [data-layer]');
  const from = await rows.first().locator('.layer-name').boundingBox(), to = await rows.last().boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + 90, to.y + to.height - 3, { steps: 12 }); await page.mouse.up();
  expect((await exportedDocument(page)).elements).toEqual([{ ...region, groupId: null }, ...before.elements.slice(0, 2)]);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
});

test('consecutive layer-name clicks still rename the effect layer without deleting it', async ({ page }) => {
  await open(page); await addRegion(page);
  const before = await exportedDocument(page), region = before.elements[2];
  await page.locator(`#layers [data-layer="${region.id}"] .layer-name`).dblclick();
  const input = page.locator('#layers .layer-rename-input');
  await expect(input).toBeFocused();
  await input.press('Delete');
  await expect(input).toHaveValue('');
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await input.fill('Renamed effect'); await input.press('Enter');
  expect((await exportedDocument(page)).elements).toEqual([...before.elements.slice(0, 2), { ...region, name: 'Renamed effect' }]);
});
