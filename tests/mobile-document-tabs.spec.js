const { test, expect, openHome, createDocument, exportedDocument, records, importPayload, openLibraryDocument } = require('./helpers');
const menu = '#documentTabsMenu', toggle = '#documentTabsMenuToggle';
const row = id => `[data-mobile-tab-id="${id}"]`;
async function choose(page, id) {
  await page.locator(toggle).tap();
  await page.locator(`${row(id)} [data-mobile-tab-activate]`).tap();
  await expect(page.locator(menu)).toBeHidden();
}
async function shape(page) {
  await page.locator('[data-mobile="shapes"]:visible').tap();
  await page.locator('[data-tray-shape="basic0"]').tap();
}

for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
  test.describe(`mobile document menu ${viewport.width}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });
    test('compact bar switches and closes resident documents', async ({ page }, testInfo) => {
      await openHome(page);
      const title = 'Длинное название первого документа для проверки многоточия';
      await createDocument(page, title);
      const first = await exportedDocument(page);
      await page.screenshot({ path: testInfo.outputPath('mobile-closed.png') });
      await expect(page.locator('#documentTabsScroll')).toBeHidden();
      for (const selector of ['#documentTabsHome', toggle, '#documentTabsPlus']) await expect(page.locator(selector)).toBeVisible();
      const geometry = await page.locator(toggle).evaluate(el => {
        const label = document.querySelector('#documentTabsMenuLabel');
        return { width: el.getBoundingClientRect().width, clipped: label.scrollWidth > label.clientWidth, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(geometry.width).toBeGreaterThan(250); expect(geometry.clipped).toBe(true); expect(geometry.overflow).toBe(false);
      await page.locator('#documentTabsHome').tap(); await createDocument(page, 'Второй документ');
      const second = await exportedDocument(page);
      await page.locator(toggle).tap();
      await expect(page.locator(`${menu} [data-mobile-tab-id]`)).toHaveCount(2);
      expect(await page.locator(`${menu} [data-mobile-tab-activate]`).allTextContents()).toEqual([`▧${title}`, '▧Второй документ✓']);
      await page.screenshot({ path: testInfo.outputPath('mobile-open.png') });
      await page.locator(`${row(first.id)} [data-mobile-tab-activate]`).tap();
      await expect(page.locator(menu)).toBeHidden();
      expect((await exportedDocument(page)).id).toBe(first.id);
      await page.locator(toggle).tap();
      await page.locator(`${row(second.id)} [data-mobile-tab-close]`).tap();
      await expect(page.locator(row(second.id))).toHaveCount(0);
      expect((await exportedDocument(page)).id).toBe(first.id);
      await page.locator('#documentTabsMenuAdd').tap();
      await expect(page.locator('#tabPickerDialog')).toBeVisible(); await expect(page.locator(menu)).toBeHidden();
      await page.locator('#tabPickerDialog .dialog-close').tap();
      await page.locator('#documentTabsHome').tap(); await createDocument(page, 'Третий документ');
      await page.locator(toggle).tap();
      await page.locator(`${menu} li.active [data-mobile-tab-close]`).tap();
      await expect(page.locator('#documentTabsMenuLabel')).toHaveText(title);
      await page.locator(toggle).tap(); await page.locator(`${row(first.id)} [data-mobile-tab-close]`).tap();
      await expect(page.locator('#homeScreen')).toBeVisible(); await expect(page.locator(menu)).toBeHidden();
      await page.locator('#documentTabsPlus').tap(); await expect(page.locator('#tabPickerDialog')).toBeVisible();
    });

    test('opening menu is read only; Escape, outside touch, focus and dialogs dismiss it', async ({ page }) => {
      await page.addInitScript(() => {
        window.menuWrites = 0;
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) { if (this.name === 'docs') menuWrites++; return put.apply(this, args); };
      });
      await openHome(page); await createDocument(page, 'Read only menu');
      await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
      const writes = await page.evaluate(() => menuWrites), stored = await records(page, 'docs');
      await page.locator(toggle).focus(); await page.keyboard.press('ArrowDown');
      await expect(page.locator('#documentTabsMenuList button').first()).toBeFocused();
      await page.keyboard.press('Escape'); await expect(page.locator(toggle)).toBeFocused();
      await expect(page.locator(toggle)).toHaveAttribute('aria-expanded', 'false');
      await page.locator(toggle).tap(); await page.locator('#canvas').tap(); await expect(page.locator(menu)).toBeHidden();
      await page.locator(toggle).tap(); await page.locator('#documentTabsPlus').tap();
      await expect(page.locator(menu)).toBeHidden(); await expect(page.locator('#tabPickerDialog')).toBeVisible();
      await page.locator('#tabPickerDialog .dialog-close').tap();
      await page.locator(toggle).tap(); await page.locator('#documentTabsHome').tap(); await expect(page.locator(menu)).toBeHidden();
      expect(await page.evaluate(() => menuWrites)).toBe(writes); expect(await records(page, 'docs')).toEqual(stored);
    });
  });
}

test.describe('mobile save barrier', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('failed save refuses active and inactive close, retaining documents and independent undo', async ({ page }) => {
    await page.addInitScript(() => {
      window.failMenuSave = false;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (this.name === 'docs') request.addEventListener('success', () => { if (failMenuSave) this.transaction.abort(); });
        return request;
      };
    });
    await openHome(page); await createDocument(page, 'Первый');
    await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
    const first = await exportedDocument(page);
    await page.locator('#documentTabsHome').tap(); await createDocument(page, 'Второй');
    await shape(page); const second = await exportedDocument(page);
    await choose(page, first.id); await page.evaluate(() => { failMenuSave = true; });
    await shape(page); await expect(page.locator('#saveStatus')).toContainText('Ошибка сохранения');
    const changed = await exportedDocument(page), zoom = await page.locator('#zoomLabel').textContent();
    await page.locator(toggle).tap(); await page.locator(`${row(first.id)} [data-mobile-tab-close]`).tap();
    await expect(page.locator(row(first.id))).toBeVisible(); await expect(page.locator('#toast')).toHaveText('Сохранение не подтверждено. Не закрывай приложение');
    await page.locator(`${row(second.id)} [data-mobile-tab-activate]`).tap();
    await page.locator(toggle).tap(); await page.locator(`${row(first.id)} [data-mobile-tab-close]`).tap();
    await expect(page.locator(row(first.id))).toBeVisible();
    expect((await exportedDocument(page)).elements).toEqual(second.elements);
    await page.locator(`${row(first.id)} [data-mobile-tab-activate]`).tap();
    expect((await exportedDocument(page)).elements).toEqual(changed.elements);
    await expect(page.locator('#zoomLabel')).toHaveText(zoom);
    await page.evaluate(() => { failMenuSave = false; });
    await page.locator('#undoBtn').tap(); expect((await exportedDocument(page)).elements).toEqual(first.elements);
    await choose(page, second.id); expect((await exportedDocument(page)).elements).toEqual(second.elements);
    await choose(page, first.id); await page.locator('#redoBtn').tap(); expect((await exportedDocument(page)).elements).toEqual(changed.elements);
  });
});


test.describe('inline edit and menu visibility', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('browsing the menu leaves inline text active until a document is selected', async ({ page }) => {
    await page.addInitScript(() => {
      window.menuWrites = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'docs') menuWrites++; return put.apply(this, args); };
    });
    await openHome(page);
    await createDocument(page, 'Другой документ');
    await page.locator('#documentTabsHome').tap();
    await importPayload(page, require('./fixtures/canvas-graph.json'));
    await expect(page.locator('#toast')).toContainText('Импортировано проектов');
    const doc = (await records(page, 'docs')).find(d => d.title === 'Graph template');
    await openLibraryDocument(page, doc.id);
    await page.locator('[data-mobile=layers]:visible').tap();
    await page.locator('#mobileLayerList [data-layer=title] .layer-name').tap();
    await page.locator('#mobileLayersClose').tap();
    await page.locator('#mobileContext [data-mobile=edit]').tap();
    await expect(page.locator('#inlineText')).toBeVisible();
    const writes = await page.evaluate(() => menuWrites);
    await page.locator('#inlineText').fill('Незавершённое редактирование');
    await page.locator(toggle).tap(); await expect(page.locator(menu)).toBeVisible();
    await expect(page.locator('#inlineText')).toBeVisible();
    await page.locator('#documentTabsMenuClose').tap();
    await expect(page.locator('#inlineText')).toBeFocused();
    await page.locator(toggle).tap(); await page.keyboard.press('Escape');
    await expect(page.locator('#inlineText')).toBeVisible();
    expect(await page.evaluate(() => menuWrites)).toBe(writes);
    await page.locator(toggle).tap();
    await page.locator('#documentTabsMenuList [data-mobile-tab-activate]').first().tap();
    await expect(page.locator('#inlineText')).toBeHidden();
    await expect.poll(async () => (await records(page, 'docs')).find(d => d.id === doc.id).elements.find(e => e.id === 'title').text).toBe('Незавершённое редактирование');
  });
});


test('desktop 1366 keeps horizontal tabs, switches and closes them', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openHome(page); await createDocument(page, 'Desktop A');
  const first = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'Desktop B');
  await expect(page.locator(toggle)).toBeHidden(); await expect(page.locator('#documentTabsScroll')).toBeVisible();
  await page.locator(`[data-tab-id="${first.id}"]`).click();
  expect((await exportedDocument(page)).id).toBe(first.id);
  await page.locator(`[data-tab-id="${first.id}"] .document-tab-close`).click();
  await expect(page.locator(`[data-tab-id="${first.id}"]`)).toHaveCount(0);
  await expect(page.locator('#documentTabsScroll .active')).toContainText('Desktop B');
});
