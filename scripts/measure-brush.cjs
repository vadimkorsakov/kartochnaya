// Reproducible, opt-in benchmark. No timing thresholds and no production hooks.
// Build first. Usage: node scripts/measure-brush.cjs [source-editor.js] [result.json]
// One pass by default; BRUSH_BENCH_RUNS=3 requests three repetitions.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const os = require('node:os');
const { diagnosticHTML, reset, snapshot, fixture, moves } = require('../tests/brush-diagnostics.cjs');

(async () => {
  const output = process.argv[3] || 'work/brush-after.json', runs = Number(process.env.BRUSH_BENCH_RUNS || 1);
  if (!Number.isInteger(runs) || runs < 1) throw Error('BRUSH_BENCH_RUNS must be a positive integer');
  await mkdir('work', { recursive: true });
  const sourceSHA256 = createHash('sha256').update(await readFile(process.argv[2] || 'src/editor.js')).digest('hex');
  const html = await diagnosticHTML(process.argv[2] || undefined);
  const server = createServer((req, res) => {
    if(req.url !== '/index.html') { res.writeHead(204).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html);
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
    const results = { startedAt: new Date().toISOString(), sourceSHA256, browser: browser.version(), playwright: require('playwright/package.json').version, cpu: os.cpus()[0].model, platform: os.platform(), viewport: { width: 1280, height: 900 }, dpr: 1, points: 360, batches: 36, samples: [] };
    for(const width of [1080, 4096]) for(const profile of ['round', 'chalk']) for(let run = 0; run < runs; run++) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      page.on('console', message => { if (message.text().startsWith('BRUSH_PROGRESS ')) console.log(JSON.stringify({ width, profile, run }) + ' ' + message.text()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
      await page.locator('#createTemplateBtn').waitFor();
      await page.locator('#jsonInput').setInputFiles({ name: 'brush.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture(width))) });
      await page.locator('[data-projectact="open"]').first().click();
      await page.keyboard.press('b');
      await page.locator('#inkProfile').selectOption(profile);
      await page.locator('#inkSizeNum').fill('32'); await page.locator('#inkSizeNum').dispatchEvent('input');
      await page.locator('#inkClose').click();
      // Warm the raster layer once; measure subsequent strokes, not creation.
      let rect = await page.locator('#canvas').boundingBox();
      await page.mouse.click(rect.x + rect.width * .1, rect.y + rect.height * .1);
      await page.locator('#saveStatus').filter({ hasText: 'Сохранено на этом устройстве' }).waitFor();
      rect = await page.locator('#canvas').boundingBox();
      await page.mouse.move(rect.x + rect.width * .12, rect.y + rect.height * .5);
      await reset(page); await page.mouse.down(); const initiation = await snapshot(page); await reset(page);
      const frames = await moves(page, { width, progress: true });
      const drawing = await snapshot(page);
      await reset(page); await page.mouse.up();
      const finalization = await snapshot(page);
      const sample = { width, profile, run, frames, initiation, drawing, finalization };
      results.samples.push(sample);
      await writeFile(output, JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ width, profile, run, compositions: drawing.calls.paint || 0, finalize: finalization.times.inkEnd }));
      await page.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
