const {test, expect, openHome, createDocument, exportedDocument, openLibraryDocument, records}=require('./helpers');

const picker='#fillPopover';
async function start(page,title){
 await openHome(page);
 await createDocument(page,title,320,240);
 await page.locator('#inspector [data-fill-open="_docBackground"]').click();
 await expect(page.locator(picker)).toBeVisible();
}
async function addColor(page,hex){
 await page.locator('[data-cp-savehex]').fill(hex);
 await page.locator('[data-cp-add]').click();
}

test('saved color can be removed without changing a currently used color; undo, redo and reload persist',async({page})=>{
 await start(page,'Palette removal');
 const initial=await exportedDocument(page);
 expect(initial.palette).toEqual([]);
 await expect(page.locator('.cp-palette-used [data-fill-palette="#ffffff"]')).toHaveCount(1);
 await addColor(page,'#AB92FB');
 await expect(page.locator('.cp-palette-saved [data-fill-palette="#ab92fb"]')).toHaveCount(1);
 await page.locator('.cp-palette-saved [data-fill-palette="#ab92fb"]').click();
 await page.locator('[data-cp-manage]').click();
 await expect(page.locator('[data-cp-manage]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.cp-palette-saved [data-cp-remove="#ab92fb"]')).toHaveCount(1);
 await page.locator('.cp-palette-saved [data-cp-remove="#ab92fb"]').click();
 await expect(page.locator('.cp-palette-saved [data-cp-remove="#ab92fb"]')).toHaveCount(0);
 await expect(page.locator('.cp-palette-used [data-fill-palette="#ab92fb"]')).toHaveCount(1);
 let saved=await exportedDocument(page);
 expect(saved.palette).toEqual([]);
 expect(saved.background).toBe('#ab92fb');
 await page.locator('[data-fill-close]').click();
 await page.locator('#undoBtn').click();
 saved=await exportedDocument(page);
 expect(saved.palette).toEqual(['#ab92fb']);
 expect(saved.background).toBe('#ab92fb');
 await page.locator('#redoBtn').click();
 saved=await exportedDocument(page);
 expect(saved.palette).toEqual([]);
 expect(saved.background).toBe('#ab92fb');
 await expect.poll(async()=> (await records(page,'docs')).find(d=>d.id===initial.id)?.palette).toEqual([]);
 await page.reload();
 await expect(page.locator('#homeScreen')).toBeVisible();
 await openLibraryDocument(page,initial.id);
 saved=await exportedDocument(page);
 expect(saved.background).toBe('#ab92fb');
 expect(saved.palette).toEqual([]);
 await page.locator('#inspector [data-fill-open="_docBackground"]').click();
 await expect(page.locator('.cp-palette-used [data-fill-palette="#ab92fb"]')).toHaveCount(1);
});

test('manage toggle does not delete by itself; only saved swatches have removal controls',async({page})=>{
 await start(page,'Palette management toggle');
 await addColor(page,'#aabbcc');
 await addColor(page,'#112233');
 await page.locator('[data-cp-manage]').click();
 await expect(page.locator('.cp-palette-saved [data-cp-remove]')).toHaveCount(2);
 await expect(page.locator('.cp-palette-used [data-cp-remove]')).toHaveCount(0);
 await page.locator('[data-cp-manage]').click();
 await expect(page.locator('.cp-palette-saved [data-cp-remove]')).toHaveCount(0);
 expect((await exportedDocument(page)).palette).toEqual(['#aabbcc','#112233']);
 await page.locator('[data-cp-manage]').click();
 await page.locator('.cp-palette-saved [data-cp-remove="#aabbcc"]').click();
 expect((await exportedDocument(page)).palette).toEqual(['#112233']);
 await expect(page.locator('.cp-palette-saved [data-cp-remove="#112233"]')).toHaveCount(1);
});
