const { test, expect, openHome, createDocument, canvasPoint, exportedDocument, exportPNG, openLibraryDocument, savedDocument } = require('./helpers');

const editor = '#inlineText';
async function frame(page) {
  await openHome(page);
  await createDocument(page, 'Редактирование текста');
  await page.keyboard.press('t');
  const a = await canvasPoint(page, 30, 40), b = await canvasPoint(page, 270, 130);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  await expect(page.locator(editor)).toBeFocused();
}
async function finish(page) {
  await page.locator(editor).press('ControlOrMeta+Enter');
  await expect(page.locator(editor)).toBeHidden();
}
async function reopen(page, x = 80, y = 70) {
  const p = await canvasPoint(page, x, y);
  await page.mouse.dblclick(p.x, p.y);
  await expect(page.locator(editor)).toBeFocused();
}

test('creating a frame returns to Move while accepting input, then moves and resizes one layer', async ({ page }) => {
  await frame(page);
  await expect(page.locator('#dockText')).not.toHaveClass(/active/);
  await page.keyboard.type('Текст'); await finish(page);
  const before = await exportedDocument(page), e = before.elements[0];
  const p = await canvasPoint(page, 90, 80);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 15, p.y + 10, { steps: 5 }); await page.mouse.up();
  const moved = await exportedDocument(page);
  expect(moved.elements).toHaveLength(1);
  expect(moved.elements[0].x).toBeGreaterThan(e.x);
  const corner = await canvasPoint(page, moved.elements[0].x + e.w, moved.elements[0].y + e.h);
  await page.mouse.move(corner.x, corner.y); await page.mouse.down();
  await page.mouse.move(corner.x + 10, corner.y + 10, { steps: 5 }); await page.mouse.up();
  const resized = await exportedDocument(page);
  expect(resized.elements).toHaveLength(1);
  expect(resized.elements[0].w).toBeGreaterThan(e.w);
});

test('empty frame survives deselection, exports invisibly and accepts text on double click', async ({ page }) => {
  await openHome(page); await createDocument(page);
  const blank = (await exportPNG(page)).image.data;
  await page.keyboard.press('t');
  const a = await canvasPoint(page, 30, 40), b = await canvasPoint(page, 270, 130);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up();
  await expect(page.locator(editor)).toBeFocused(); await finish(page);
  await page.keyboard.press('Escape');
  const d = await exportedDocument(page);
  expect(d.elements).toHaveLength(1); expect(d.elements[0].text).toBe('');
  expect((await exportPNG(page)).image.data.equals(blank)).toBe(true);
  const p = await canvasPoint(page, 80, 70); await page.mouse.click(p.x, p.y);
  await expect(page.locator(`#layers [data-layer="${d.elements[0].id}"]`)).toHaveClass(/selected/);
  await reopen(page); await page.keyboard.type('Повторный ввод'); await finish(page);
  expect((await exportedDocument(page)).elements[0].text).toBe('Повторный ввод');
});

test('mouse drag selects text without closing editing or changing layer geometry', async ({ page }) => {
  await frame(page); await page.locator(editor).fill('Обычное выделение текста');
  const before = await exportedDocument(page);
  const box = await page.locator(editor).boundingBox();
  await page.mouse.move(box.x + 2, box.y + 15); await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 15, { steps: 12 }); await page.mouse.up();
  await expect(page.locator(editor)).toBeFocused();
  expect(await page.locator(editor).evaluate(e => e.selectionEnd - e.selectionStart)).toBeGreaterThan(0);
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
});

test('Canvas font metrics fit without scrollbars and genuine overflow remains scrollable across zoom', async ({ page }) => {
  await frame(page);
  // The legacy overflow contract concerns fixed-size text, not the new auto-fit mode.
  await finish(page);
  await page.locator('#inspector [data-text-auto-font]').uncheck();
  await reopen(page);
  // A full-width line at the Canvas wrap boundary catches border-induced reflow.
  const line = await page.locator(editor).evaluate(el => {
    const c = document.createElement('canvas').getContext('2d'), s = getComputedStyle(el);
    c.font = s.font; let text = '';
    while (c.measureText(text + 'M').width <= el.clientWidth) text += 'M';
    while (c.measureText(text + 'i').width <= el.clientWidth) text += 'i';
    return text;
  });
  await page.locator(editor).fill(Array(4).fill(line).join('\n'));
  for (let i = 0; i < 2; i++) {
    const metrics = await page.locator(editor).evaluate(el => ({ w: el.clientWidth, sw: el.scrollWidth, h: el.clientHeight, sh: el.scrollHeight }));
    expect(metrics.sw).toBeLessThanOrEqual(metrics.w); expect(metrics.sh).toBeLessThanOrEqual(metrics.h);
    await page.locator('#zoomOutBtn').click();
    await reopen(page);
  }
  await page.locator(editor).fill(Array(20).fill(line).join('\n'));
  expect(await page.locator(editor).evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; })).toBeGreaterThan(0);
  await finish(page); await reopen(page);
  await expect(page.locator(editor)).toHaveValue(Array(20).fill(line).join('\n'));
});

test('confirmed text survives closing and reopening the document', async ({ page }) => {
  await frame(page); await page.locator(editor).fill('Сохранённый текст\nВторая строка'); await finish(page);
  const d = await exportedDocument(page);
  await savedDocument(page, d.title, 1);
  await page.locator('#documentTabsHome').click();
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, d.id); await reopen(page);
  await expect(page.locator(editor)).toHaveValue('Сохранённый текст\nВторая строка');
  await finish(page);
  expect((await exportedDocument(page)).elements).toEqual(d.elements);
});
