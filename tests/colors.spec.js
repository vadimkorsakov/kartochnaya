const {
  test, expect, openHome, createDocument, addShape, exportedDocument,
  exportPNG, records, openLibraryDocument,
} = require('./helpers');

async function openFill(page) {
  await page.locator('#inspector [data-fill-open="fill"]').click();
  await expect(page.locator('#fillPopover')).toBeVisible();
  await page.locator('#cpFormat').selectOption('HEX');
}
async function enterHex(page, value) {
  const input = page.getByRole('textbox', { name: 'HEX 1', exact: true });
  await input.fill(value);
  await input.press('Tab'); // Real change/blur through the existing picker.
}

test('shape fill changed through the picker is exported, saved, reopened and rendered in PNG', async ({ page }) => {
  await openHome(page);
  await createDocument(page, 'Color persistence');
  await addShape(page);
  const before = await exportPNG(page);
  await openFill(page);
  await enterHex(page, '#123456');
  await page.locator('#fillPopover [data-fill-close]').click();
  const document = await exportedDocument(page);
  expect(document.elements).toHaveLength(1);
  expect(document.elements[0]).toMatchObject({ fillType: 'solid', fill: '#123456' });
  const after = await exportPNG(page);
  expect(after.image.data).not.toEqual(before.image.data);
  const center = (120 * after.image.width + 160) * 4;
  expect([...after.image.data.subarray(center, center + 4)]).toEqual([18,52,86,255]);
  await expect.poll(async () => (await records(page, 'docs')).find(item => item.id === document.id)?.elements)
    .toEqual(document.elements);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, document.id);
  expect((await exportedDocument(page)).elements).toEqual(document.elements);
  expect((await exportPNG(page)).image.data).toEqual(after.image.data);
});

test('picker HEX, RGB, HSB, HSL and CSS display the same color without mutating it', async ({ page }) => {
  await openHome(page);
  await createDocument(page, 'Color formats');
  await addShape(page);
  await openFill(page);
  await enterHex(page, '#123456');
  for (const [format, expected] of [
    ['HEX', ['#123456']], ['RGB', ['18','52','86']], ['HSB', ['210','79','34']],
    ['HSL', ['210','65','20']], ['CSS', ['rgb(18, 52, 86)']], ['HEX', ['#123456']],
  ]) {
    await page.locator('#cpFormat').selectOption(format);
    const inputs = page.locator('#cpChannels input');
    await expect(inputs).toHaveCount(expected.length);
    for (let i = 0; i < expected.length; i++) {
      await expect(page.getByRole('textbox', { name: `${format} ${i + 1}`, exact: true })).toHaveValue(expected[i]);
    }
  }
  await page.locator('#fillPopover [data-fill-close]').click();
  expect((await exportedDocument(page)).elements[0].fill).toBe('#123456');
});
