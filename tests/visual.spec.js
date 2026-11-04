const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const {
  test, expect, fixturePath, openHome, createDocument, exportPNG,
  importPayload, savedDocument, openLibraryDocument,
} = require('./helpers');
const environment = require('./baselines/environment.json');
const shapes = require('./fixtures/visual-shapes.json');
const text = require('./fixtures/visual-text.json');

test.beforeAll(async ({ browser }) => {
  expect(browser.version(), 'Use the recorded Chromium version; do not regenerate PNGs to hide environment differences')
    .toBe(environment.chromium);
  expect(process.platform).toBe(environment.platform);
  expect(process.arch).toBe(environment.arch);
  expect(require('@playwright/test/package.json').version).toBe(environment.playwright);
  const font = await readFile(fixturePath('fonts/DejaVuSans.ttf'));
  expect(createHash('sha256').update(font).digest('hex')).toBe(environment.font.sha256);
});

test('visual baseline: blank 320x240 canvas', async ({ page }) => {
  await openHome(page);
  await createDocument(page, 'Visual blank');
  const { bytes } = await exportPNG(page);
  expect(bytes).toMatchSnapshot('blank-320x240.png', { threshold: 0, maxDiffPixels: 0 });
});

test('visual baseline: small shapes, rotation and opacity', async ({ page }) => {
  await openHome(page);
  await importPayload(page, shapes);
  const document = await savedDocument(page, shapes.document.title + ' (импорт)', 3);
  await openLibraryDocument(page, document.id);
  const { bytes } = await exportPNG(page);
  expect(bytes).toMatchSnapshot('shapes-320x240.png', { threshold: 0, maxDiffPixels: 0 });
});

test('visual baseline: Cyrillic and Latin text in the bundled fixed font', async ({ page }) => {
  await openHome(page);
  await page.locator('#fontInput').setInputFiles(fixturePath('fonts/DejaVuSans.ttf'));
  await expect.poll(() => page.evaluate(() => document.fonts.check('27px "DejaVu Sans"'))).toBe(true);
  // FontFaceSet.check alone accepts nonexistent families; require the actual loaded face.
  await expect.poll(() => page.evaluate(() => [...document.fonts].some(face =>
    face.family.replace(/^"|"$/g, '') === 'DejaVu Sans' && face.status === 'loaded'))).toBe(true);
  await importPayload(page, text);
  const document = await savedDocument(page, text.document.title + ' (импорт)', 1);
  await openLibraryDocument(page, document.id);
  const { bytes } = await exportPNG(page);
  // The pre-migration binary snapshot recorded the legacy top baseline.
  // Build a deterministic independent Canvas reference using measured
  // alphabetic font metrics, then compare EVERY output pixel (no tolerance).
  const referenceBase64=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=320;c.height=240;
    const g=c.getContext('2d');g.fillStyle='#f5f3ed';g.fillRect(0,0,320,240);
    g.save();g.translate(24,36);g.beginPath();g.rect(0,0,272,140);g.clip();
    g.font='normal 400 27px "DejaVu Sans"';g.textBaseline='alphabetic';
    g.textAlign='left';g.fontKerning='normal';g.letterSpacing='0px';
    g.fillStyle='#243746';
    let y=0;
    for(const value of ['КАРТОЧНАЯ','Canvas 0.45']){
      const m=g.measureText(value);
      const ascent=m.fontBoundingBoxAscent??m.actualBoundingBoxAscent??27*.8;
      const descent=m.fontBoundingBoxDescent??m.actualBoundingBoxDescent??27*.2;
      const h=Math.max(27*1.25,ascent+descent);
      g.fillText(value,0,y+ascent+(h-ascent-descent)/2);
      y+=h;
    }
    g.restore();return c.toDataURL('image/png').split(',')[1];
  });
  const {PNG}=require('pngjs');
  const actual=PNG.sync.read(bytes),reference=PNG.sync.read(Buffer.from(referenceBase64,'base64'));
  expect([actual.width,actual.height]).toEqual([320,240]);
  expect([...actual.data]).toEqual([...reference.data]);
});
