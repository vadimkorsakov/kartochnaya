const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument } = require('./helpers');
const fixture = require('./fixtures/canvas-graph.json');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function mobileTab(page, id, close = false) {
  await page.locator('#documentTabsMenuToggle').tap();
  await page.locator(`[data-mobile-tab-id="${id}"] ${close ? '[data-mobile-tab-close]' : '[data-mobile-tab-activate]'}`).tap();
}

async function open(page) {
  await page.addInitScript(() => {
    window.panelWrites = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'docs') panelWrites.push(structuredClone(value));
      return put.call(this, value, ...args);
    };
  });
  await openHome(page);
  const payload = structuredClone(fixture);
  const source = payload.documents[0];
  source.groups = [];
  source.elements = [{ ...source.elements[3], x: 40, y: 40, w: 80, h: 80 }];
  payload.documents = [source, { ...structuredClone(source), id: 'panel-second', title: 'Panel second' }];
  await importPayload(page, payload);
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const docs = (await records(page, 'docs')).filter(d => ['Graph template', 'Panel second'].includes(d.title));
  expect(docs).toHaveLength(2);
  await openLibraryDocument(page, docs[0].id);
  await select(page);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await page.evaluate(() => { panelWrites = []; });
  return docs;
}
async function select(page) {
  await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
  await page.locator('#mobileLayerList [data-layer="independent"] .layer-name').tap();
  await page.locator('#mobileLayersClose').tap();
  await expect(page.locator('#quickBubble')).toBeVisible();
}
async function color(page) {
  await page.locator('#mobileContext [data-mobile="color"]').tap();
  await page.locator('[data-mp-action="colorEdit"]').tap();
  await expect(page.locator('#mobilePropertyUI [data-mp-hex]')).toBeVisible();
}
async function closed(page) {
  await expect(page.locator('#mobilePropertyUI')).toBeEmpty();
  await expect(page.locator('body')).not.toHaveClass(/mobile-panel-visible/);
  await expect(page.locator('#mobileLayersSheet')).not.toHaveClass(/open/);
  await expect(page.locator('#rightPanel')).not.toHaveClass(/open/);
  for (const id of ['shapeTray', 'assetsPopover', 'historyPopover', 'selectionMenu', 'editorProjectMenu', 'mobileSeriesSheet', 'mobileLayerActionMenu', 'fillPopover', 'boundaryFloatingPanel', 'inkPopover', 'textModeMenu']) {
    await expect(page.locator('#' + id)).toBeHidden();
  }
}
async function history(page) {
  return page.locator('#historyEntries [data-history-index]').evaluateAll(rows => rows.map(r => [r.textContent, r.getAttribute('aria-current')]));
}

test('home hides the body quick bubble across sections and restores only valid selection', async ({ page }) => {
  await open(page);
  const before = await exportedDocument(page), h = await history(page), stored = await records(page, 'docs');
  const zoom = await page.locator('#zoomLabel').textContent();
  await page.locator('#documentTabsHome').tap();
  await expect(page.locator('#quickBubble')).toBeHidden();
  await closed(page);
  for (const section of ['fonts', 'data', 'workspace']) {
    await page.locator(`[data-home-nav="${section}"]`).tap();
    // Scroll fires the same public redraw path that used to resurrect the bubble.
    await page.locator('#stageScroller').dispatchEvent('scroll');
    await expect(page.locator('#quickBubble')).toBeHidden();
  }
  await page.locator('#homeEditorBtn').tap();
  await expect(page.locator('#quickBubble')).toBeVisible();
  await closed(page);
  expect(await exportedDocument(page)).toEqual(before);
  expect(await history(page)).toEqual(h);
  await expect(page.locator('#zoomLabel')).toHaveText(zoom);
  await color(page);
  await page.locator('#documentTabsHome').tap();
  await closed(page);
  await expect(page.locator('#quickBubble')).toBeHidden();
  await page.locator('#homeEditorBtn').tap();
  await expect(page.locator('#quickBubble')).toBeVisible();
  await closed(page);
  await page.waitForTimeout(550);
  expect(await records(page, 'docs')).toEqual(stored);
  expect(await page.evaluate(() => panelWrites)).toEqual([]);
});

test('library, tab switches and active tab closure discard temporary panels without writes', async ({ page }) => {
  const docs = await open(page), before = await exportedDocument(page), h = await history(page);
  const stored = await records(page, 'docs');
  await color(page);
  await page.locator('#documentTabsHome').tap();
  await openLibraryDocument(page, docs[1].id);
  await closed(page);
  await expect(page.locator('#quickBubble')).toBeHidden();
  await select(page); await color(page);
  await mobileTab(page, docs[0].id);
  await closed(page);
  await expect(page.locator('#quickBubble')).toBeVisible();
  expect(await exportedDocument(page)).toEqual(before);
  expect(await history(page)).toEqual(h);
  await color(page);
  await mobileTab(page, docs[0].id, true);
  await closed(page);
  await expect(page.locator('#documentTabsMenuLabel')).toHaveText(docs[1].title);
  await color(page);
  await mobileTab(page, docs[1].id, true);
  await expect(page.locator('#homeScreen')).toBeVisible();
  await closed(page);
  await expect(page.locator('#quickBubble')).toBeHidden();
  await page.waitForTimeout(550);
  expect(await records(page, 'docs')).toEqual(stored);
  expect(await page.evaluate(() => panelWrites)).toEqual([]);
});

for (const destination of ['home', 'tab']) test(`active F-06 interaction settles before ${destination} and releases its timer`, async ({ page }) => {
  const docs = await open(page);
  await page.locator('#documentTabsHome').tap();
  await openLibraryDocument(page, docs[1].id);
  await mobileTab(page, docs[0].id);
  const before = await exportedDocument(page), h = await history(page);
  await page.evaluate(() => { panelWrites = []; });
  await expect(page.locator('#mobileNudge')).toBeVisible();
  // Freeze repeat/debounce timers so actionability waits cannot add extra nudges.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  // Keep a panel interaction active while navigating with an ordinary tap.
  // Synthetic ownership avoids multi-touch navigation being interpreted as a pinch.
  await page.locator('[data-mp-nudge="right"]').dispatchEvent('pointerdown', { pointerId: 91, pointerType: 'touch', button: 0, buttons: 1 });
  if (destination === 'home') await page.locator('#documentTabsHome').tap(); else await mobileTab(page, docs[1].id);
  await closed(page);
  await page.clock.runFor(600);
  await page.clock.resume();
  const after = (await records(page, 'docs')).find(d => d.id === before.id);
  expect(after.elements[0].x).toBe(before.elements[0].x + 1);
  expect(await page.evaluate(() => panelWrites.map(d => d.id))).toEqual([before.id]);
  expect((await records(page, 'docs')).find(d => d.id === docs[1].id)).toEqual(docs[1]);
  await mobileTab(page, docs[0].id);
  expect((await exportedDocument(page)).elements).toEqual(after.elements);
  expect((await history(page)).length).toBe(h.length + 1);
  await page.locator('#undoBtn').tap();
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#redoBtn').tap();
  expect((await exportedDocument(page)).elements).toEqual(after.elements);
});
