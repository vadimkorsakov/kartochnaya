const { test, expect, openHome, createDocument, canvasPoint, exportedDocument, exportPNG } = require('./helpers');

// Three native editing/PNG/zoom round trips run in each layout case.
test.describe.configure({ timeout: 60_000 });

async function captureDraws(page) {
  await page.addInitScript(() => {
    window.textDraws = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
      window.textDraws.push({ text, x, y, font: this.font, advance: this.measureText(text).width,
        canvas: this.canvas.id, width: this.canvas.width, height: this.canvas.height });
      return original.call(this, text, x, y, ...rest);
    };
  });
}
async function setup(page, text, auto, spacing = 0) {
  await captureDraws(page);
  await openHome(page); await createDocument(page, 'Согласованность строк');
  await page.keyboard.press('t');
  const a = await canvasPoint(page, 20, 20), b = await canvasPoint(page, 260, 220);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up();
  const editor = page.locator('#inlineText');
  await editor.fill(text); await editor.press('ControlOrMeta+Enter');
  await page.locator('#inspector [data-text-auto-font]').uncheck();
  for (const [key, value] of [['fontSize', 18], ['w', 175], ['letterSpacing', spacing]]) {
    const input = page.locator(`#inspector [data-key="${key}"]`);
    await input.fill(String(value)); await input.press('Enter');
  }
  if (auto) await page.locator('#inspector [data-text-auto-font]').check();
  const p = await canvasPoint(page, 60, 45); await page.mouse.dblclick(p.x, p.y);
  await expect(editor).toBeFocused();
}
// Home/End operate on actual native textarea visual rows, including soft wraps.
// This does not mirror the production line-breaking implementation in a test div.
async function nativeRows(page) {
  const editor = page.locator('#inlineText');
  await editor.evaluate(el => { el.focus(); el.setSelectionRange(0, 0); });
  const rows = [];
  for (let i = 0; i < 100; i++) {
    await editor.press('Home');
    const start = await editor.evaluate(el => el.selectionStart);
    await editor.press('End');
    const row = await editor.evaluate(el => ({ end: el.selectionEnd, length: el.value.length, value: el.value }));
    rows.push(row.value.slice(start, row.end).trimEnd());
    if (row.end === row.length) return rows;
    await editor.press('ArrowDown');
  }
  throw new Error('Could not reach the last native visual row');
}
async function assertDrawing(page, rows, layer, exported = false) {
  const draws = await page.evaluate(({ fontSize, exported }) => window.textDraws.filter(d =>
    d.font.includes(`${fontSize}px`) && (exported ? !d.canvas && d.width === 320 && d.height === 240 : d.canvas === 'canvas')),
  { fontSize: layer.fontSize, exported });
  const last = draws.slice(-rows.length);
  expect(last.map(d => d.text)).toEqual(rows);
  const lh = layer.fontSize * layer.lineHeight;
  const advances = await page.evaluate(({ rows, layer }) => {
    const span = document.createElement('span');
    span.style.cssText = 'position:fixed;visibility:hidden;white-space:pre;font-kerning:normal';
    span.style.font = `${layer.fontStyle || 'normal'} ${layer.fontWeight || '400'} ${layer.fontSize}px "${layer.fontFamily}"`;
    span.style.fontKerning = 'normal';
    span.style.letterSpacing = (layer.letterSpacing || 0) + 'px';
    document.body.append(span);
    const widths = rows.map(row => { span.textContent = row; return span.getBoundingClientRect().width; });
    span.remove(); return widths;
  }, { rows, layer });
  last.forEach((d, i) => {
    expect(d.y).toBeCloseTo(i * lh, 5);
    expect(Math.abs(d.advance - advances[i])).toBeLessThan(0.05);
  });
}
for (const auto of [false, true]) {
  for (const spacing of [0, 1.3]) {
    test(`native rows match Canvas and PNG: auto=${auto}, spacing=${spacing}`, async ({ page }) => {
      await setup(page, 'подбор шрифта для карточки\nЯ и разные слова 😊\nслово сверхдлинноенеразрывноеслово\n\nКонец', auto, spacing);
      const editor = page.locator('#inlineText');
      let rows;
      for (let zoom = 0; zoom < 3; zoom++) {
        const actual = await nativeRows(page);
        const metrics = await editor.evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
        expect(metrics.scroll).toBeLessThanOrEqual(metrics.height);
        if (rows) expect(actual).toEqual(rows);
        rows = actual;
        const layer = (await exportedDocument(page)).elements[0];
        await editor.press('ControlOrMeta+Enter');
        await assertDrawing(page, rows, layer);
        await page.evaluate(() => { window.textDraws = []; });
        await exportPNG(page);
        await assertDrawing(page, rows, layer, true);
        await page.locator('#zoomOutBtn').click();
        const p = await canvasPoint(page, 60, 45); await page.mouse.dblclick(p.x, p.y);
        await expect(editor).toBeFocused();
      }
    });
  }
}

test('live auto sizing keeps native row breaks and caret; actual overflow scrolls', async ({ page }) => {
  await setup(page, 'Начало', true);
  const editor = page.locator('#inlineText');
  for (const text of ['А', 'подбор шрифта для карточки', 'Первое сверхдлинноенеразрывноеслово\nНовая строка']) {
    await editor.fill(text);
    await editor.press('End');
    const rows = await nativeRows(page), layer = (await exportedDocument(page)).elements[0];
    expect(await editor.evaluate(el => el.selectionEnd)).toBe(text.length);
    await editor.press('ControlOrMeta+Enter'); await assertDrawing(page, rows, layer);
    const p = await canvasPoint(page, 60, 45); await page.mouse.dblclick(p.x, p.y);
  }
  await editor.press('ControlOrMeta+Enter');
  await page.locator('#inspector [data-text-auto-font]').uncheck();
  const size = page.locator('#inspector [data-key="fontSize"]'); await size.fill('24'); await size.press('Enter');
  const p = await canvasPoint(page, 60, 45); await page.mouse.dblclick(p.x, p.y);
  const long = Array(40).fill('Длинный текст доступен целиком').join('\n');
  await editor.fill(long); await editor.press('ControlOrMeta+End');
  expect(await editor.evaluate(el => el.selectionEnd)).toBe(long.length);
  expect(await editor.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await editor.press('ControlOrMeta+Home');
  expect(await editor.evaluate(el => el.selectionStart)).toBe(0);
  expect(await editor.evaluate(el => el.scrollTop)).toBe(0);
  await editor.press('ControlOrMeta+End'); await editor.press('!');
  expect(await editor.inputValue()).toBe(long + '!');
  expect(await editor.evaluate(el => el.selectionStart)).toBe(long.length + 1);
  await editor.press('ControlOrMeta+Enter');
  expect((await exportedDocument(page)).elements[0].text).toBe(long + '!');
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements[0].text).not.toBe(long + '!');
  await page.locator('#redoBtn').click();
  expect((await exportedDocument(page)).elements[0].text).toBe(long + '!');
});

test('a word at the frame boundary keeps its row at fractional canvas zoom', async ({ page }) => {
  const text = 'подбор шрифта для текстовой карточки';
  await setup(page, text, false);
  const editor = page.locator('#inlineText');
  const layerBefore = (await exportedDocument(page)).elements[0];
  const width = await editor.evaluate((el, fontSize) => {
    const s = getComputedStyle(el), c = document.createElement('canvas').getContext('2d');
    c.font = `${s.fontStyle} ${s.fontWeight} ${fontSize}px ${s.fontFamily}`;
    c.fontKerning = 'normal';
    return c.measureText('подбор шрифта для').width + 0.03;
  }, layerBefore.fontSize);
  await editor.press('ControlOrMeta+Enter');
  const field = page.locator('#inspector [data-key="w"]');
  await field.fill(String(width)); await field.press('Enter');
  const p = await canvasPoint(page, 60, 45); await page.mouse.dblclick(p.x, p.y);
  const rows = await nativeRows(page);
  expect(rows[0]).toBe('подбор шрифта для');
  for (let i = 0; i < 3; i++) {
    expect(await nativeRows(page)).toEqual(rows);
    const layer = (await exportedDocument(page)).elements[0];
    await editor.press('ControlOrMeta+Enter'); await assertDrawing(page, rows, layer);
    await page.locator('#zoomOutBtn').click();
    const point = await canvasPoint(page, 60, 45); await page.mouse.dblclick(point.x, point.y);
    await expect(editor).toBeFocused();
    const metrics = await editor.evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.height);
  }
});
