import test from 'node:test';
import assert from 'node:assert/strict';
import { nextZoom, parseZoomPercent } from '../src/core/zoom.mjs';

test('desktop steps use the next strict 10% boundary, including floating point residue', () => {
  for (const [percent, plus, minus] of [[147,150,140],[107,110,100],[97,100,90],[100,110,90],[150,160,140],[110,120,100],[230,240,220]]) {
    assert.equal(nextZoom(percent / 100, 1), plus / 100);
    assert.equal(nextZoom(percent / 100, -1), minus / 100);
  }
  assert.equal(nextZoom(1.47001, 1), 1.5);
  assert.equal(nextZoom(.04, -1), .04);
  assert.equal(nextZoom(8, 1), 8);
});

test('mobile retains its 3% step and range limits', () => {
  assert.equal(nextZoom(1.47, 1, true), 1.5);
  assert.equal(nextZoom(1.47, -1, true), 1.44);
  assert.equal(nextZoom(.04, -1, true), .04);
  assert.equal(nextZoom(8, 1, true), 8);
});

test('only integer percentages in range are accepted', () => {
  for (const percent of [4,100,125,800]) assert.equal(parseZoomPercent(String(percent)), percent / 100);
  for (const invalid of ['', ' ', 'NaN', 'Infinity', '1e2', '100%', '100abc', '3', '801', '-10', '100.5']) assert.equal(parseZoomPercent(invalid), null);
});

test('setZoom applies exactly 1 and rejects non-finite values before changing editor state', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../src/editor.js', import.meta.url), 'utf8');
  const app = { zoom: 1.47 };
  let applied = 0;
  const setZoom = runInNewContext(`(${source.split('\n').find(line => line.startsWith('function setZoom('))})`, {
    app, mobileV36State: {}, clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    applyZoom: () => applied++,
  });
  for (const invalid of [NaN, Infinity, -Infinity]) setZoom(invalid);
  assert.equal(app.zoom, 1.47);
  assert.equal(applied, 0);
  setZoom(parseZoomPercent('100'));
  assert.equal(app.zoom, 1);
  assert.equal(applied, 1);
});
