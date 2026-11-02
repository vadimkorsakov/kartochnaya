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

test('edit mode reorders swatches by dragging and persists the chosen order',async({page})=>{
 await start(page,'Palette drag sorting');
 for(const hex of ['#aabbcc','#112233','#ee7799'])await addColor(page,hex);
 await page.locator('[data-cp-manage]').click();
 await expect(page.locator('[data-cp-manage] svg')).toHaveCount(0);
 const savedOrder=()=>page.locator('.cp-palette-saved [data-cp-remove]').evaluateAll(nodes=>nodes.map(node=>node.dataset.cpRemove));
 expect(await savedOrder()).toEqual(['#aabbcc','#112233','#ee7799']);
 const source=page.locator('.cp-palette-saved [data-cp-remove="#ee7799"]');
 const target=page.locator('.cp-palette-saved [data-cp-remove="#aabbcc"]');
 await target.scrollIntoViewIfNeeded();
 const startBox=await source.boundingBox(),endBox=await target.boundingBox();
 expect(startBox).toBeTruthy();expect(endBox).toBeTruthy();
 await page.mouse.move(startBox.x+startBox.width/2,startBox.y+startBox.height/2);
 await page.mouse.down();
 await page.mouse.move(endBox.x+endBox.width*.25,endBox.y+endBox.height/2,{steps:12});
 await expect(target).toHaveClass(/cp-swatch-drop-before/);
 await page.mouse.up();
 expect(await savedOrder()).toEqual(['#ee7799','#aabbcc','#112233']);
 let doc=await exportedDocument(page);
 expect(doc.palette).toEqual(['#ee7799','#aabbcc','#112233']);
 await expect(page.locator('.cp-palette-saved [data-cp-remove]')).toHaveCount(3);
 await page.locator('[data-fill-close]').click();
 await page.locator('#undoBtn').click();
 expect((await exportedDocument(page)).palette).toEqual(['#aabbcc','#112233','#ee7799']);
 await page.locator('#redoBtn').click();
 expect((await exportedDocument(page)).palette).toEqual(['#ee7799','#aabbcc','#112233']);
 await expect.poll(async()=> (await records(page,'docs')).find(d=>d.id===doc.id)?.palette).toEqual(['#ee7799','#aabbcc','#112233']);
 await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,doc.id);
 await page.locator('#inspector [data-fill-open="_docBackground"]').click();
 expect(await page.locator('.cp-palette-saved [data-fill-palette]').evaluateAll(nodes=>nodes.map(n=>n.dataset.fillPalette))).toEqual(['#ee7799','#aabbcc','#112233']);
});

test('edit mode allows keyboard reordering and does not delete on a short drag',async({page})=>{
 await start(page,'Palette keyboard sorting');
 for(const hex of ['#aabbcc','#112233','#ee7799'])await addColor(page,hex);
 await page.locator('[data-cp-manage]').click();
 const middle=page.locator('.cp-palette-saved [data-cp-remove="#112233"]');
 await middle.focus();await page.keyboard.press('Shift+ArrowRight');
 expect((await exportedDocument(page)).palette).toEqual(['#aabbcc','#ee7799','#112233']);
 await expect(page.locator('.cp-palette-saved [data-cp-remove="#112233"]')).toBeFocused();
 await page.keyboard.press('Shift+ArrowLeft');
 expect((await exportedDocument(page)).palette).toEqual(['#aabbcc','#112233','#ee7799']);
});
