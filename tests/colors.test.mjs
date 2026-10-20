import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { inspect } from 'node:util';

// Run the actual production fragments in a fresh strict IIFE, with no DOM, app,
// browser globals or production test hooks. No duplicate conversion algorithms.
const fragments = await Promise.all(['primitives', 'colors'].map(name =>
  readFile(new URL(`../src/core/${name}.js`, import.meta.url), 'utf8')));
const colors = vm.runInNewContext(`(()=>{'use strict';\n${fragments.join('\n')}\nreturn {rgbHex,hexRgb,hsvRGB,rgbHSV,rgbHSL,hslRGB,normalizeHex,cpFormatValues};})()`);

function equal(actual, expected) {
  // Convert cross-realm arrays without JSON (which would lose NaN/Infinity).
  if (Array.isArray(actual)) actual = Array.from(actual);
  assert.deepEqual(actual, expected);
}
function cases(name, rows) {
  for (const [args, expected] of rows) {
    test(`${name}(${inspect(args, { breakLength: Infinity })}) => ${String(expected)}`, () => equal(colors[name](...args), expected));
  }
}
function near(actual, expected) {
  assert.ok(Array.isArray(actual));
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => {
    assert.equal(typeof value, 'number');
    assert.ok(Math.abs(value - expected[i]) < 1e-10, `${value} ≈ ${expected[i]}`);
  });
}

cases('rgbHex', [
  [[0,0,0], '#000000'], [[255,255,255], '#ffffff'], [[255,0,0], '#ff0000'],
  [[0,255,0], '#00ff00'], [[0,0,255], '#0000ff'], [[18,52,86], '#123456'],
  [[171,146,251], '#ab92fb'], [[1.49,1.5,254.5], '#0102ff'],
  [[-10,300,256], '#00ffff'], [['18','52','86'], '#123456'],
  [[undefined,null,'bad'], '#000000'], [[NaN,Infinity,-Infinity], '#00ff00'],
  [[], '#000000'], [[true,false,''], '#010000'],
]);
cases('hexRgb', [
  [['#000000'], [0,0,0]], [['#ffffff'], [255,255,255]], [['#ff0000'], [255,0,0]],
  [['#00ff00'], [0,255,0]], [['#0000ff'], [0,0,255]], [['#Ab92fB'], [171,146,251]],
  [['#123456'], [18,52,86]], [['123456'], [35,69,6]],
  [['#abc'], [171,12,NaN]], [['#12zz34'], [18,NaN,52]],
  [['#1g2x3!'], [1,2,3]], [[''], [NaN,NaN,NaN]],
  [['#12345678'], [18,52,86]], [[' #123456'], [NaN,35,69]],
]);
for (const input of [null, undefined, 123]) {
  test(`hexRgb throws TypeError for ${input}`, () => assert.throws(() => colors.hexRgb(input), { name: 'TypeError' }));
}

cases('normalizeHex', [
  [['#A1B2C3'], '#a1b2c3'], [['#a1b2c3'], '#a1b2c3'], [['A1B2C3'], '#a1b2c3'],
  [['#abc'], '#aabbcc'], [['#ABC'], '#AABBCC'], [['#aBc'], '#aaBBcc'],
  [[' \t#ABC\n'], '#AABBCC'], [['  A1B2C3  '], '#a1b2c3'],
  [['abc'], null], [['#12'], null], [['#1234'], null], [['#12345'], null],
  [['#12345678'], null], [['#gg0000'], null], [['#12 456'], null],
  [['##123456'], null], [['red'], null], [[''], null], [['   '], null],
  [[null], null], [[undefined], null], [[false], null], [[0], null], [[123456], '#123456'],
]);

// Independent, fixed reference values for all hue sectors, achromatic colors,
// periodic hue, clamped percentages and the existing NaN behavior.
cases('hsvRGB', [
  [[0,100,100], [255,0,0]], [[60,100,100], [255,255,0]],
  [[120,100,100], [0,255,0]], [[180,100,100], [0,255,255]],
  [[240,100,100], [0,0,255]], [[300,100,100], [255,0,255]],
  [[0,0,0], [0,0,0]], [[120,100,0], [0,0,0]], [[0,0,100], [255,255,255]],
  [[210,0,50], [128,128,128]], [[210,50,80], [102,153,204]],
  [[360,100,100], [255,0,0]], [[720,100,100], [255,0,0]],
  [[-60,100,100], [255,0,255]], [[420,100,100], [255,255,0]],
  [[0,120,120], [255,0,0]], [[0,-1,50], [128,128,128]], [[0,50,-1], [0,0,0]],
  [['210','50','80'], [102,153,204]], [[NaN,100,100], [255,0,NaN]],
  [[0,NaN,100], [NaN,NaN,NaN]], [[0,100,undefined], [NaN,NaN,NaN]],
]);
cases('hslRGB', [
  [[0,100,50], [255,0,0]], [[60,100,50], [255,255,0]],
  [[120,100,50], [0,255,0]], [[180,100,50], [0,255,255]],
  [[240,100,50], [0,0,255]], [[300,100,50], [255,0,255]],
  [[0,0,0], [0,0,0]], [[120,100,0], [0,0,0]], [[0,100,100], [255,255,255]],
  [[210,0,50], [128,128,128]], [[210,50,60], [102,153,204]],
  [[360,100,50], [255,0,0]], [[720,100,50], [255,0,0]],
  [[-60,100,50], [255,0,255]], [[420,100,50], [255,255,0]],
  [[0,120,50], [255,0,0]], [[0,-1,50], [128,128,128]],
  [[0,100,-1], [0,0,0]], [[0,100,120], [255,255,255]],
  [['210','50','60'], [102,153,204]], [[NaN,100,50], [255,0,NaN]],
  [[0,NaN,50], [NaN,NaN,NaN]], [[0,100,undefined], [NaN,NaN,NaN]],
]);

for (const [rgb, hsv, hsl] of [
  [[0,0,0], [0,0,0], [0,0,0]],
  [[255,255,255], [0,0,100], [0,0,100]],
  [[255,0,0], [0,100,100], [0,100,50]],
  [[255,255,0], [60,100,100], [60,100,50]],
  [[0,255,0], [120,100,100], [120,100,50]],
  [[0,255,255], [180,100,100], [180,100,50]],
  [[0,0,255], [240,100,100], [240,100,50]],
  [[255,0,255], [300,100,100], [300,100,50]],
  [[128,128,128], [0,0,50.19607843137255], [0,0,50.19607843137255]],
  [[102,153,204], [210,50,80], [210,50,60]],
  [[18,52,86], [210,79.06976744186046,33.72549019607843], [210,65.38461538461539,20.3921568627451]],
  [['102','153','204'], [210,50,80], [210,50,60]],
  [[510,0,0], [0,100,200], [0,Infinity,100]],
  [[-255,0,0], [180,0,0], [180,-100,-50]],
]) {
  for (const [name, expected] of [['rgbHSV',hsv], ['rgbHSL',hsl]]) {
    test(`${name} fixed reference: ${rgb}`, () => {
      if (expected.includes(Infinity)) equal(colors[name](...rgb), expected);
      else near(colors[name](...rgb), expected);
    });
  }
}
for (const name of ['rgbHSV', 'rgbHSL']) {
  const saturation = name === 'rgbHSL' ? 0 : NaN;
  cases(name, [[[NaN,0,0], [0,saturation,NaN]], [[undefined,0,0], [0,saturation,NaN]]]);
}

for (const rgb of [[0,0,0], [255,255,255], [128,128,128], [18,52,86], [171,146,251], [1,254,127]]) {
  test(`additional round trips preserve integer RGB ${rgb}`, () => {
    equal(colors.hexRgb(colors.rgbHex(...rgb)), rgb);
    equal(colors.hsvRGB(...colors.rgbHSV(...rgb)), rgb);
    equal(colors.hslRGB(...colors.rgbHSL(...rgb)), rgb);
  });
}
cases('cpFormatValues', [
  [['#123456','HEX'], ['#123456']], [['#ab92fb','HEX'], ['#AB92FB']],
  [['#123456','RGB'], [18,52,86]], [['#123456','HSB'], [210,79,34]],
  [['#123456','HSL'], [210,65,20]], [['#123456','CSS'], ['rgb(18, 52, 86)']],
  [['#ffffff','HSB'], [0,0,100]], [['#000000','HSL'], [0,0,0]],
  [['#abcdef','unknown'], ['#ABCDEF']], [['#abcdef','rgb'], ['#ABCDEF']],
  [['#abcdef',undefined], ['#ABCDEF']], [['#zzzzzz','RGB'], [NaN,NaN,NaN]],
  [['#zzzzzz','CSS'], ['rgb(NaN, NaN, NaN)']], [['#abc','HEX'], ['#ABC']],
]);

for (const [name, level] of [['hsvRGB',100], ['hslRGB',50]]) {
  cases(name, [[[359.999,100,level], [255,0,0]], [[0.001,100,level], [255,0,0]]]);
}
