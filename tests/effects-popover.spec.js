const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument, exportPNG } = require('./helpers');

test.use({ serviceWorkers: 'block' });
const types = ['layerBlur', 'dropShadow', 'noise', 'textGlow', 'textEcho', 'textBackdrop', 'textCombine', 'textGlitch', 'glass'];
async function open(page, many = false) {
  await openHome(page);
  const effects = (many ? [...types, 'texture', 'innerShadow', 'gaussianBlur', 'backgroundBlur', 'noise', 'noise', 'noise'] : types).map((type, i) => ({
    id: `fx-${i}`, type, enabled: true, expanded: i % 2 === 0, radius: 4, x: 2, y: 3, spread: 3, opacity: 80,
    color: '#a477ff', color2: '#00f0f0', intensity: 55, direction: 42, distance: 8, thickness: 3, roundness: 35,
    size: 1, density: 50, amount: 30, frost: 55, depth: 55, light: 65, refraction: 55, dispersion: 18, surfaceOpacity: 30, seed: 123,
  }));
  const layer = { id: 'text', type: 'text', name: 'Effects text', text: 'Эффекты', x: 25, y: 60, w: 270, h: 100, fontSize: 40, fontFamily: 'Arial', fontWeight: 400, lineHeight: 1.2, rotation: 0, opacity: 100, visible: true, fillType: 'solid', fill: '#111111', textColor: '#111111', fillOpacity: 100, strokeWidth: 0, effects };
  await importPayload(page, { format: 'kartochnaya-project-v1', project: { id: 'fx-project', name: 'Effects tests', resources: [], resourceFolders: [] }, documents: [{ id: 'fx-doc', projectId: 'fx-project', title: 'Effects document', type: 'template', width: 320, height: 240, background: '#ffffff', backgroundAlpha: 100, createdAt: 1, updatedAt: 1, rulers: [], palette: [], groups: [], elements: [layer, { id: 'other', type: 'rect', name: 'Other', x: 0, y: 0, w: 10, h: 10, opacity: 100, visible: true, fill: '#ffffff', fillType: 'solid' }] }], fonts: [] });
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const doc = (await records(page, 'docs')).find(d => d.title === 'Effects document');
  await openLibraryDocument(page, doc.id);
  await page.locator('#layers [data-layer="text"] .layer-name').click();
  return doc;
}
const row = (page, id) => page.locator(`#inspector [data-fx-row="${id}"]`);
const popover = page => page.locator('#fxPopover');
const field = (page, key, type = 'number') => popover(page).locator(`input[type="${type}"][data-fx-key="${key}"]`);
const history = page => page.locator('#historyEntries').innerHTML();
async function show(page, id) { await row(page, id).locator('.fx-name').click(); await expect(popover(page)).toBeVisible(); }
async function menu(page, id) { await row(page, id).locator('[data-fx-menu]').click(); await expect(page.locator('#fxMenu')).toBeVisible(); }
async function contained(page, surface = popover(page)) {
  await expect(surface).toBeVisible();
  const box = await surface.boundingBox(), viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(await surface.evaluate(p => p.scrollWidth <= p.clientWidth)).toBe(true);
  const dock = await page.locator('.floating-docks').boundingBox();
  expect(box.x < dock.x + dock.width && box.x + box.width > dock.x && box.y < dock.y + dock.height && box.y + box.height > dock.y).toBe(false);
}

test('compact rows fit inspector; UI toggles and menus preserve JSON and history', async ({ page }) => {
  await open(page);
  const before = await exportedDocument(page), h = await history(page);
  const sizes = await page.locator('#inspector [data-fx-row]').evaluateAll(rows => rows.map(r => ({ height: r.getBoundingClientRect().height, overflow: r.scrollWidth > r.clientWidth })));
  expect(sizes).toHaveLength(types.length);
  expect(sizes.every(r => r.height >= 36 && r.height <= 40 && !r.overflow)).toBe(true);
  expect(await page.locator('#inspector').evaluate(p => p.scrollWidth <= p.clientWidth)).toBe(true);
  await expect(page.locator('.fx-drag')).toHaveCount(0);
  await show(page, 'fx-0'); await row(page, 'fx-0').locator('[data-fx-open]').last().click(); await expect(popover(page)).toBeHidden();
  await show(page, 'fx-1'); await page.keyboard.press('Escape'); await expect(popover(page)).toBeHidden();
  await row(page, 'fx-2').locator('.fx-name').press('Enter'); await expect(popover(page)).toBeVisible();
  await popover(page).getByRole('button', { name: 'Закрыть настройки эффекта' }).press('Space'); await expect(popover(page)).toBeHidden();
  await menu(page, 'fx-0'); await expect(page.locator('#fxMenu [data-dir="-1"]')).toBeDisabled();
  await row(page, 'fx-0').locator('[data-fx-menu]').click(); await expect(page.locator('#fxMenu')).toBeHidden();
  await menu(page, 'fx-8'); await expect(page.locator('#fxMenu [data-dir="1"]')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.locator('#fxMenu')).toBeHidden();
  expect(await exportedDocument(page)).toEqual(before); expect(await history(page)).toBe(h);
});

test('popover switches, is anchored on the left and closes outside without losing selection', async ({ page }) => {
  await open(page); await show(page, 'fx-0');
  const a = await row(page, 'fx-0').boundingBox(), b = await popover(page).boundingBox();
  expect(b.x + b.width).toBeLessThan(a.x);
  await show(page, 'fx-1'); await expect(page.locator('#fxPopoverTitle')).toHaveText('Внешняя тень');
  await expect(page.locator('#fxPopover')).toHaveCount(1); await expect(popover(page).locator('[data-fx-field="fx-0"]')).toHaveCount(0);
  await page.locator('#projectTitle').click(); await expect(popover(page)).toBeHidden();
  await expect(page.locator('#layers [data-layer="text"]')).toHaveClass(/selected/);
});

test('narrow desktop resize and inspector scroll keep surfaces within viewport', async ({ page }) => {
  await open(page, true); await page.setViewportSize({ width: 800, height: 560 });
  await show(page, 'fx-0'); await contained(page);
  const original = await popover(page).boundingBox();
  await row(page, 'fx-0').evaluate(row => { const p = document.querySelector('#inspector'); p.scrollTop += row.getBoundingClientRect().top - p.getBoundingClientRect().top - 2; });
  await expect.poll(async () => (await popover(page).boundingBox())?.y).not.toBe(original.y);
  await contained(page);
  await show(page, 'fx-8');
  await row(page, 'fx-8').evaluate(row => { const p = document.querySelector('#inspector'); p.scrollTop += row.getBoundingClientRect().top - p.getBoundingClientRect().top - 2; });
  await contained(page);
  await page.setViewportSize({ width: 920, height: 420 }); await contained(page);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 920, height: 300 }); await show(page, 'fx-8'); await contained(page);
  expect(await popover(page).locator('.fx-details').evaluate(p => p.scrollHeight > p.clientHeight)).toBe(true);
  await page.keyboard.press('Escape'); await show(page, 'fx-15'); await contained(page);
  await page.locator('#inspector').evaluate(p => p.scrollTop = 0);
  await expect(popover(page)).toBeHidden();
});

test('adding opens settings and stays a single undo operation with no expanded UI property', async ({ page }) => {
  await open(page);
  const before = await exportedDocument(page);
  await page.locator('[data-fx-show]').click(); await page.locator('[data-fx-add="gaussianBlur"]').click();
  await expect(page.locator('#fxPopoverTitle')).toHaveText('Размытие по Гауссу');
  await expect(field(page, 'radius')).toBeVisible(); await expect(page.locator('#fxChooser')).toBeHidden();
  const added = await exportedDocument(page), effect = added.elements[0].effects.at(-1);
  expect(effect).not.toHaveProperty('expanded');
  await page.keyboard.press('Escape'); expect((await exportedDocument(page)).elements).toEqual(added.elements);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#redoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(added.elements);
});

test('numeric input preserves focus and DOM; changes save and Undo/Redo restore parameters', async ({ page }) => {
  const doc = await open(page); const before = await exportedDocument(page);
  await show(page, 'fx-0');
  await field(page, 'radius').evaluate(el => { window.fxInputNode = el; });
  await field(page, 'radius').fill('18.5');
  await expect(field(page, 'radius')).toBeFocused();
  expect(await field(page, 'radius').evaluate(el => el === window.fxInputNode)).toBe(true);
  await field(page, 'radius').press('Tab');
  expect((await exportedDocument(page)).elements[0].effects[0].radius).toBe(18.5);
  await expect.poll(async () => (await records(page, 'docs')).find(d => d.id === doc.id).elements[0].effects[0].radius).toBe(18.5);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#redoBtn').click(); expect((await exportedDocument(page)).elements[0].effects[0].radius).toBe(18.5);
});

test('Alt numeric drag, paired slider and panel undo shortcuts reuse existing handlers', async ({ page }) => {
  await open(page); await show(page, 'fx-3');
  await field(page, 'radius').fill('5'); await field(page, 'radius').press('Tab');
  const before = await exportedDocument(page), box = await field(page, 'radius').boundingBox();
  await page.keyboard.down('Alt'); await page.mouse.move(box.x + 15, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + box.height / 2, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Alt');
  await expect(field(page, 'radius')).toHaveValue('15');
  await expect(field(page, 'radius', 'range')).toHaveValue('15');
  await field(page, 'radius').press('ControlOrMeta+z');
  await expect(field(page, 'radius')).toHaveValue('5');
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await field(page, 'intensity', 'range').focus(); await page.keyboard.press('ArrowRight');
  await expect(field(page, 'intensity')).toHaveValue('56');
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
});

for (const [type, key] of [['textGlow', 'intensity'], ['textEcho', 'direction'], ['textBackdrop', 'roundness'], ['textCombine', 'thickness'], ['textGlitch', 'distance']]) test(`${type} keeps its controls, HEX and rendering with Undo`, async ({ page }) => {
  await open(page); const before = await exportedDocument(page), id = before.elements[0].effects.find(f => f.type === type).id;
  const png = await exportPNG(page); await show(page, id);
  const initial = Number(await field(page, key).inputValue());
  await field(page, key).fill(String(initial + 1)); await field(page, key).press('Tab');
  expect((await exportedDocument(page)).elements[0].effects.find(f => f.id === id)[key]).toBe(initial + 1);
  await field(page, 'color', 'text').fill('#123456'); await field(page, 'color', 'text').press('Tab');
  expect((await exportedDocument(page)).elements[0].effects.find(f => f.id === id).color).toBe('#123456');
  expect((await exportPNG(page)).image.data.equals(png.image.data)).toBe(false);
  await page.locator('#undoBtn').click(); await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
});

test('existing color picker edits effect and synchronizes HEX swatch through popover', async ({ page }) => {
  await open(page); const before = await exportedDocument(page);
  await show(page, 'fx-7');
  await popover(page).locator('.tf43-color').last().locator('[data-unified-color]').click();
  await expect(page.locator('#fillPopover')).toBeVisible(); await expect(popover(page)).toBeVisible();
  const hex = page.locator('#fillPopover [data-cp-part="0"]');
  await hex.fill('#2255AA'); await hex.press('Tab');
  await expect(field(page, 'color2', 'text')).toHaveValue('#2255aa');
  expect((await exportedDocument(page)).elements[0].effects[7].color2).toBe('#2255aa');
  await page.keyboard.press('Escape'); await expect(page.locator('#fillPopover')).toBeHidden(); await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(popover(page)).toBeHidden();
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
});

test('visibility, reorder and deletion preserve data and each undo correctly', async ({ page }) => {
  await open(page); const before = await exportedDocument(page);
  await row(page, 'fx-1').locator('[data-fx-toggle]').click();
  expect((await exportedDocument(page)).elements[0].effects[1].enabled).toBe(false);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#layers [data-layer="text"] .layer-name').click();
  await menu(page, 'fx-1'); await page.locator('#fxMenu [data-dir="-1"]').click();
  expect((await exportedDocument(page)).elements[0].effects.map(f => f.id)).toEqual(['fx-1', 'fx-0', ...before.elements[0].effects.slice(2).map(f => f.id)]);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#layers [data-layer="text"] .layer-name').click();
  await menu(page, 'fx-1'); await expect(page.locator('#fxMenu [data-fx-remove]')).toHaveCount(0);
  await page.keyboard.press('Escape'); await show(page, 'fx-1');
  const remove = row(page, 'fx-1').getByRole('button', { name: 'Удалить: Внешняя тень', exact: true });
  await expect(remove).toBeVisible(); await remove.click();
  await expect(popover(page)).toBeHidden(); expect((await exportedDocument(page)).elements[0].effects).toHaveLength(types.length - 1);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#layers [data-layer="text"] .layer-name').click();
});

test('selection, document navigation, section collapse and mobile breakpoint close settings', async ({ page }) => {
  await open(page); await show(page, 'fx-0');
  await page.locator('#layers [data-layer="other"] .layer-name').click(); await expect(popover(page)).toBeHidden();
  await page.locator('#layers [data-layer="text"] .layer-name').click(); await show(page, 'fx-0');
  await page.locator('[data-ins-section="Эффекты"]').click(); await expect(popover(page)).toBeHidden();
  await page.locator('[data-ins-section="Эффекты"]').click(); await show(page, 'fx-0');
  await page.locator('#brandHomeBtn').click(); await expect(popover(page)).toBeHidden();
  await page.locator('#homeEditorBtn').click(); await show(page, 'fx-0');
  await page.setViewportSize({ width: 390, height: 844 }); await expect(popover(page)).toBeHidden();
});

test('mobile effects still use the bottom sheet and its existing parameter controls', async ({ page }) => {
  const doc = await open(page); await page.locator('#brandHomeBtn').click();
  await page.setViewportSize({ width: 390, height: 844 }); await openLibraryDocument(page, doc.id);
  await page.locator('#mobileContext [data-mobile="effects"]').click();
  await expect(page.locator('.mp-sheet')).toBeVisible();
  await page.locator('[data-mp-effect="textGlow"]').click();
  await page.locator('[data-mp-effect="textGlow"]').click();
  const number = page.locator('[data-mp-effect-type="textGlow"][data-mp-effect-key="intensity"][type="number"]');
  await number.fill('66'); await number.press('Tab');
  await expect(popover(page)).toBeHidden(); await expect(page.locator('#fxChooser')).toBeHidden();
  await page.locator('[data-mp-action="done"]').click();
  expect((await exportedDocument(page)).elements[0].effects.find(f => f.type === 'textGlow').intensity).toBe(66);
});


test('chooser floats outside inspector without resizing sections; closing is read only', async ({ page }) => {
  await open(page);
  const add = page.locator('#inspector [data-fx-show]'), chooser = page.locator('#fxChooser');
  await add.scrollIntoViewIfNeeded();
  const sizes = () => page.locator('#inspector .ins-section').evaluateAll(nodes => nodes.map(n => ({ width: n.offsetWidth, height: n.offsetHeight })));
  const before = await exportedDocument(page), h = await history(page), dimensions = await sizes();
  expect(dimensions.length).toBeGreaterThan(0);
  await add.click(); await expect(chooser).toBeVisible();
  await expect(page.locator('#fxChooser')).toHaveCount(1); await expect(page.locator('#inspector #fxChooser')).toHaveCount(0);
  await expect(chooser.locator('[data-fx-add]')).toHaveCount(13);
  expect(await sizes()).toEqual(dimensions);
  const a = await add.boundingBox(), b = await chooser.boundingBox();
  expect(b.width).toBeGreaterThanOrEqual(280); expect(b.width).toBeLessThanOrEqual(340);
  expect(b.x + b.width).toBeLessThan(a.x); await contained(page, chooser);
  expect(await chooser.evaluate(p => p.scrollHeight > p.clientHeight)).toBe(true);
  await add.click(); await expect(chooser).toBeHidden();
  await add.click(); await page.keyboard.press('Escape'); await expect(chooser).toBeHidden(); await expect(add).toBeFocused();
  await add.click(); await page.locator('#projectTitle').click(); await expect(chooser).toBeHidden();
  expect(await exportedDocument(page)).toEqual(before); expect(await history(page)).toBe(h);
  await page.setViewportSize({ width: 800, height: 420 });
  await add.click(); await expect(chooser).toBeVisible(); await contained(page, chooser);
  expect(await page.locator('#inspector').evaluate(p => p.scrollWidth <= p.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 920, height: 300 }); await contained(page, chooser);
  await page.keyboard.press('Escape'); await add.click();
  await page.locator('#layers [data-layer="other"] .layer-name').click(); await expect(chooser).toBeHidden();
});

const numericKeys = {
  gaussianBlur: ['radius'], layerBlur: ['radius'], backgroundBlur: ['radius', 'surfaceOpacity'],
  dropShadow: ['x', 'y', 'radius', 'spread', 'opacity'], innerShadow: ['x', 'y', 'radius', 'spread', 'opacity'],
  noise: ['size', 'density', 'amount', 'opacity'], texture: ['size', 'amount', 'opacity'],
  glass: ['frost', 'depth', 'light', 'refraction', 'dispersion', 'surfaceOpacity'],
};
for (const [type, keys] of Object.entries(numericKeys)) test(`${type} pairs all numeric parameters and records one Undo per slider gesture`, async ({ page }) => {
  await open(page, true); const before = await exportedDocument(page), id = before.elements[0].effects.find(f => f.type === type).id;
  await show(page, id);
  await expect(popover(page).locator('input[type=number]')).toHaveCount(keys.length);
  await expect(popover(page).locator('input[type=range]')).toHaveCount(keys.length);
  for (const key of keys) {
    const number = field(page, key), range = field(page, key, 'range');
    for (const attr of ['min', 'max', 'step']) expect(await range.getAttribute(attr)).toBe(await number.getAttribute(attr));
    await number.fill(key === 'x' || key === 'y' ? '-12.5' : key === 'radius' ? '12.5' : '3');
    await expect(number).toBeFocused(); await number.press('Tab');
    // Range inputs normalize values to their step; exact manual values remain in the document.
    expect((await exportedDocument(page)).elements[0].effects.find(f => f.id === id)[key]).toBe(key === 'x' || key === 'y' ? -12.5 : key === 'radius' ? 12.5 : 3);
    expect(await range.inputValue()).toBe(await range.evaluate(el => { const copy = el.cloneNode(); copy.value = el.parentElement.querySelector('input[type=number]').value; return copy.value; }));
  }
  const key = keys[0], range = field(page, key, 'range'), number = field(page, key);
  await range.scrollIntoViewIfNeeded();
  await range.evaluate(el => { window.fxRangeNode = el; });
  const snapshot = await exportedDocument(page), h = await history(page);
  const steps = () => page.locator('#historyEntries [data-history-index]').count(), count = await steps();
  const box = await range.boundingBox(), y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * .25, y); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, y, { steps: 12 });
  await expect(range).toBeFocused();
  await expect(number).toHaveValue(await range.inputValue());
  expect(await history(page)).toBe(h); // Preview must not write history.
  expect(await range.evaluate(el => el === window.fxRangeNode)).toBe(true);
  await page.mouse.up();
  expect(await steps()).toBe(count + 1);
  const after = await exportedDocument(page); expect(after.elements).not.toEqual(snapshot.elements);
  await range.press('ControlOrMeta+z'); expect((await exportedDocument(page)).elements).toEqual(snapshot.elements);
  await expect(number).toHaveValue(String(snapshot.elements[0].effects.find(f => f.id === id)[key]));
  await range.press('ControlOrMeta+Shift+z'); expect((await exportedDocument(page)).elements).toEqual(after.elements);
});

test('ordinary shadow color still uses the existing picker and Undo', async ({ page }) => {
  await open(page); const before = await exportedDocument(page); await show(page, 'fx-1');
  await popover(page).locator('[data-unified-color]').click();
  const hex = page.locator('#fillPopover [data-cp-part="0"]');
  await hex.fill('#2255AA'); await hex.press('Tab');
  await expect(field(page, 'color', 'color')).toHaveValue('#2255aa');
  expect((await exportedDocument(page)).elements[0].effects[1].color).toBe('#2255aa');
  await page.keyboard.press('Escape'); await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
});


const colorPicker = page => page.locator('#fillPopover');
async function openEffectColor(page, id = 'fx-7', key = 'color2') {
  await show(page, id);
  await popover(page).locator(`input[type=color][data-fx-key="${key}"]`).locator('..').locator('[data-unified-color]').click();
  await expect(colorPicker(page)).toBeVisible();
}
async function colorGeometry(page, side) {
  await expect(colorPicker(page)).toBeVisible(); await expect(popover(page)).toBeVisible();
  const color = await colorPicker(page).boundingBox(), effect = await popover(page).boundingBox(), view = page.viewportSize();
  for (const b of [color, effect]) {
    expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(view.width); expect(b.y + b.height).toBeLessThanOrEqual(view.height);
  }
  if (side) {
    const gap = side === 'left' ? effect.x - color.x - color.width : color.x - effect.x - effect.width;
    expect(gap).toBeGreaterThanOrEqual(8); expect(gap).toBeLessThanOrEqual(12);
  }
  const dock = await page.locator('.floating-docks').boundingBox();
  const overlap = (a,b) => Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  expect(overlap(color,dock)).toBe(0);
  return { color, effect };
}

test('effect color follows the measured parent on the left, resize and inspector scroll', async ({ page }) => {
  await open(page, true); await openEffectColor(page, 'fx-3', 'color');
  const initial = await colorGeometry(page, 'left');
  expect(initial.color.y).toBeLessThanOrEqual(initial.effect.y);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(async () => (await colorPicker(page).boundingBox())?.x).not.toBe(initial.color.x);
  await colorGeometry(page, 'left');
  const before = await colorPicker(page).boundingBox();
  await row(page, 'fx-3').evaluate(row => { const p=document.querySelector('#inspector');p.scrollTop+=row.getBoundingClientRect().top-p.getBoundingClientRect().top-2; });
  await expect.poll(async () => (await colorPicker(page).boundingBox())?.y).not.toBe(before.y);
  const aligned = await colorGeometry(page, 'left');
  expect(aligned.color.y).toBeCloseTo(aligned.effect.y, 0);
  await page.setViewportSize({ width: 1280, height: 560 }); await colorGeometry(page, 'left');
});

test('effect color uses right fallback and the least overlap when neither side fits', async ({ page }) => {
  await open(page); await openEffectColor(page);
  // Move the actual parent without moving its color button independently.
  await popover(page).evaluate(p => p.style.left='30px');
  await expect.poll(async () => (await colorPicker(page).boundingBox())?.x).toBe(380);
  await colorGeometry(page, 'right');
  await page.setViewportSize({ width: 800, height: 900 });
  const {color,effect} = await colorGeometry(page);
  const intersection = x => Math.max(0, Math.min(x+color.width,effect.x+effect.width)-Math.max(x,effect.x));
  expect(intersection(color.x)).toBe(Math.min(intersection(8),intersection(800-color.width-8)));
});

for (const key of ['color','color2']) test(`bound picker edits only ${key} and keeps Undo/Redo and two-stage Escape`, async ({ page }) => {
  await open(page);
  // Establish a committed selection so Undo tests the color edit alone.
  await show(page, 'fx-7'); await field(page, 'distance').fill('9'); await field(page, 'distance').press('Tab');
  await page.keyboard.press('Escape');
  const before=await exportedDocument(page), h=await history(page);
  await openEffectColor(page, 'fx-7', key);
  expect(await history(page)).toBe(h);
  const hex=colorPicker(page).locator('[data-cp-part="0"]');
  await hex.fill('#123456'); await hex.press('Tab');
  const after=await exportedDocument(page);
  expect(after.elements[0].effects[7]).toEqual({...before.elements[0].effects[7],[key]:'#123456'});
  await hex.press('ControlOrMeta+z'); expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await hex.press('ControlOrMeta+Shift+z'); expect((await exportedDocument(page)).elements).toEqual(after.elements);
  await page.keyboard.press('Escape'); await expect(colorPicker(page)).toBeHidden(); await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(popover(page)).toBeHidden();
});

test('effect color closes with parent, effect switch, layer switch and invisible row', async ({ page }) => {
  await open(page); await openEffectColor(page);
  await popover(page).locator('[data-fx-close]').click(); await expect(colorPicker(page)).toBeHidden();
  await openEffectColor(page); await show(page, 'fx-1'); await expect(colorPicker(page)).toBeHidden();
  await page.keyboard.press('Escape'); await openEffectColor(page);
  await page.locator('#layers [data-layer="other"] .layer-name').click(); await expect(colorPicker(page)).toBeHidden();
  await page.locator('#layers [data-layer="text"] .layer-name').click(); await openEffectColor(page);
  await page.locator('#inspector').evaluate(p=>p.scrollTop=0);
  await expect(popover(page)).toBeHidden(); await expect(colorPicker(page)).toBeHidden();
});

test('ordinary fill picker retains its positioning after effect color closes', async ({ page }) => {
  await open(page); await openEffectColor(page);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  const fill=page.locator('#inspector [data-fill-open="fill"]'); await fill.click();
  await expect(colorPicker(page)).toBeVisible(); await expect(colorPicker(page)).not.toHaveClass(/fx-color-popover/);
  expect(await colorPicker(page).evaluate(p=>p.style.maxHeight)).toBe('');
  const button=await fill.boundingBox(), color=await colorPicker(page).boundingBox();
  expect(color.x).toBe(Math.max(12,button.x-375));
  const before=await exportedDocument(page), hex=colorPicker(page).locator('[data-cp-part="0"]');
  await hex.fill('#123456');await hex.press('Tab');
  const after=await exportedDocument(page);expect(after.elements[0].fill).toBe('#123456');
  expect(after.elements[0].effects).toEqual(before.elements[0].effects);
  await hex.press('ControlOrMeta+z');expect((await exportedDocument(page)).elements).toEqual(before.elements);
});
