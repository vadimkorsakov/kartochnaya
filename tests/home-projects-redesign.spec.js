const {test,expect,openHome,records}=require('./helpers');

test.use({viewport:{width:1360,height:900}});

test('project cards use edge-to-edge covers, their title sits below, and removal is only in the active header',async({page})=>{
 await openHome(page);
 const chooser=page.locator('#projectChooser');
 const tile=chooser.locator('.project-choice').first();
 await expect(tile).toBeVisible();
 await expect(tile.locator('.project-choice-delete,[data-delete-project]')).toHaveCount(0);
 await expect(page.locator('#newProjectName')).toHaveCount(0);
 const dimensions=await tile.evaluate(button=>{
  const cover=button.querySelector('.project-choice-cover').getBoundingClientRect();
  const label=button.querySelector('.project-choice-name').getBoundingClientRect();
  const bounds=button.getBoundingClientRect();
  const art=button.querySelector('.project-initial,img').getBoundingClientRect();
  return {button:bounds.width,cover:cover.width,artWidth:art.width,artHeight:art.height,coverHeight:cover.height,labelTop:label.top,coverBottom:cover.bottom};
 });
 expect(Math.abs(dimensions.button-dimensions.cover)).toBeLessThan(2.1);
 expect(Math.abs(dimensions.artWidth-dimensions.cover)).toBeLessThan(2.1);
 expect(Math.abs(dimensions.artHeight-dimensions.coverHeight)).toBeLessThan(2.1);
 expect(dimensions.labelTop).toBeGreaterThanOrEqual(dimensions.coverBottom+4);
 for(const name of ['projectRenameBtn','projectCoverBtn','projectDeleteBtn']){
  const button=page.locator('#'+name);
  await expect(button).toBeVisible();
  await expect(button.locator('svg')).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-label',/проект/);
 }
 const layout=await page.evaluate(()=>{
  const h=document.querySelector('#activeProjectName').getBoundingClientRect();
  const buttons=document.querySelector('.project-hub-cover-actions').getBoundingClientRect();
  const header=document.querySelector('.home-topbar').getBoundingClientRect();
  const brand=document.querySelector('#homeBrandBtn').getBoundingClientRect();
  const pane=document.querySelector('.home-pane-heading').getBoundingClientRect();
  const projectStrip=document.querySelector('.project-hub-top').getBoundingClientRect();
  const fab=document.querySelector('#createTemplateBtn').getBoundingClientRect();
  const editor=document.querySelector('#homeEditorBtn').getBoundingClientRect();
  const a=document.querySelector('#createProjectBtn').getBoundingClientRect();
  const b=document.querySelector('#projectJsonImportBtn').getBoundingClientRect();
  return {nameMiddle:h.top+h.height/2,buttonsMiddle:buttons.top+buttons.height/2,
   headerRight:header.right,editorRight:editor.right,headerLeft:header.left,brandLeft:brand.left,
   stripLeft:projectStrip.left,paneLeft:pane.left,stripWidth:projectStrip.width,paneWidth:pane.width,
   fabRight:fab.right,fabBottom:fab.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,
   createRight:a.right,importLeft:b.left};
 });
 expect(Math.abs(layout.nameMiddle-layout.buttonsMiddle)).toBeLessThan(5);
 // The header now has deliberate, small insets on BOTH sides.
 expect(layout.headerRight-layout.editorRight).toBeGreaterThanOrEqual(10);
 expect(layout.headerRight-layout.editorRight).toBeLessThanOrEqual(16);
 expect(layout.brandLeft-layout.headerLeft).toBeGreaterThanOrEqual(10);
 expect(layout.brandLeft-layout.headerLeft).toBeLessThanOrEqual(16);
 expect(Math.abs(layout.stripLeft-layout.paneLeft)).toBeLessThan(2.1);
 expect(layout.stripWidth).toBeLessThan(layout.paneWidth/2);
 expect(layout.viewportWidth-layout.fabRight).toBeGreaterThan(15);
 expect(layout.viewportHeight-layout.fabBottom).toBeGreaterThan(15);
 await expect(page.locator('#homeBrandBtn .home-version')).toHaveCount(0);
 expect(layout.createRight).toBeLessThan(layout.importLeft);
});

test('creating projects without a name field assigns unique default names, and rename still works',async({page})=>{
 await openHome(page);
 const create=page.locator('#createProjectBtn');
 await create.click();
 await expect(page.locator('#activeProjectName')).toHaveText('Проект 1');
 await expect(create).toBeEnabled();
 await create.click();
 await expect(page.locator('#activeProjectName')).toHaveText('Проект 2');
 const names=(await records(page,'projects')).map(x=>x.name);
 expect(names).toContain('Проект 1');
 expect(names).toContain('Проект 2');
 const rename=page.locator('#projectRenameBtn');
 await rename.click();
 const editor=page.locator('.project-hub-title-row .rename-project');
 await expect(editor).toBeVisible();
 await editor.fill('Отредактированный проект');
 await editor.press('Enter');
 await expect(page.locator('#activeProjectName')).toHaveText('Отредактированный проект');
 await expect(page.locator('#projectChooser .project-choice.active .project-choice-name')).toHaveText('Отредактированный проект');
 await page.reload();
 await expect(page.locator('#activeProjectName')).toHaveText('Отредактированный проект');
});

test('floating + creates a blank card in Cards, and stays hidden in Resources',async({page})=>{
 await openHome(page);
 const plus=page.locator('#createTemplateBtn');
 await expect(plus).toBeVisible();
 await expect(plus).toHaveAttribute('aria-label','Создать пустой шаблон');
 await page.locator('[data-filter="resource"]').click();
 await expect(plus).toBeHidden();
 await page.locator('[data-filter="card"]').click();
 await expect(plus).toBeVisible();
 await expect(plus).toHaveAttribute('aria-label','Создать пустую карточку');
 await plus.click();
 await expect(page.locator('#sizeDialog')).toBeVisible();
 await expect(page.locator('#sizeDialog .dialog-header h2')).toHaveText('Новая карточка');
 await expect(page.locator('#confirmNewDoc')).toHaveText('Создать карточку');
 await page.locator('#newDocTitle').fill('Проверочная карточка');
 await page.locator('#confirmNewDoc').click();
 await expect(page.locator('#typeChip')).toHaveText('КАРТОЧКА');
 await expect.poll(async()=>{
  return (await records(page,'docs')).find(d=>d.title==='Проверочная карточка')?.type;
 }).toBe('card');
});
