const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument} = require('./helpers');
const fixture = require('./fixtures/visual-text.json');

const tool = (page,key) => page.locator(`#mobileContext [data-mobile=${key}]`).tap();
const ui = page => page.locator('#mobilePropertyUI');
const sheet = page => ui(page).locator('.mp-sheet');
const action = (page,key) => ui(page).locator(`[data-mp-action=${key}]`);
const number = (page,key) => ui(page).locator(`input[type=number][data-mp-key=${key}]`);
const input = page => page.locator('#inlineText');
const model = async page => (await exportedDocument(page)).elements[0];
const selection = page => input(page).evaluate(e=>[e.selectionStart,e.selectionEnd,e.selectionDirection]);
const expectedSelection = [0,5,'backward'];

async function open(page,patch={}) {
  await openHome(page);
  const payload = structuredClone(fixture);
  Object.assign(payload.document.elements[0],{
    id:'m16',name:'M1.6',text:'Текст для маленькой рамки\nСписок',w:180,h:120,x:16,y:20,
    fontFamily:'Arial',fontWeight:'400',fontSize:28,lineHeight:1.15,autoFontSize:false,
    fillType:'solid',textColor:'#263047',fill:'#263047',opacity:86,
    textRuns:[{start:1,end:3,style:{fontSize:30}}],
    paragraphRuns:[{start:27,style:{listKind:'bullet'}}],...patch,
  });
  await importPayload(page,payload);
  await expect.poll(async ()=>(await records(page,'docs')).some(doc=>doc.elements[0]?.name==='M1.6')).toBe(true);
  const doc = (await records(page,'docs')).find(doc=>doc.elements[0]?.name==='M1.6');
  await openLibraryDocument(page,doc.id);
  await page.locator('[data-mobile=layers]:visible').tap();
  await page.locator('#mobileLayerList .layer-name').filter({hasText:'M1.6',exact:true}).tap();
  await page.locator('#mobileLayersClose').tap();
}
async function edit(page) {
  await tool(page,'edit');
  await expect(input(page)).toBeFocused();
  await input(page).evaluate(e=>{
    e.setSelectionRange(0,5,'backward');
    e.dispatchEvent(new Event('select',{bubbles:true}));
  });
}
async function enter(field,value) {
  await field.fill(String(value));
  await field.press('Enter');
  await expect(field).not.toBeFocused();
}

for(const viewport of [{width:360,height:640},{width:390,height:844},{width:640,height:360},{width:844,height:390}]) {
  test.describe(`${viewport.width} × ${viewport.height}`,()=>{
    test.use({viewport,isMobile:true,hasTouch:true});

    test('text tools, compact rows and color controls stay within their scroll view',async ({page})=>{
      await open(page);
      const context = page.locator('#mobileContext');
      await expect(context.locator('[data-mobile=opacity]')).toHaveCount(0);
      expect(await context.evaluate(row=>[...row.querySelectorAll('button')].slice(0,5).every(button=>
        button.getBoundingClientRect().right<=row.getBoundingClientRect().right+1
      ))).toBe(true);

      await tool(page,'spacing');
      const data = await sheet(page).evaluate(panel=>{
        const body = panel.querySelector('.mp-body'), clip = body.getBoundingClientRect();
        const rows = [...panel.querySelectorAll('.mp-text-number')].map(row=>{
          const children = [...row.children].map(node=>node.getBoundingClientRect());
          const bounds = row.getBoundingClientRect();
          return {height:bounds.height,fullyVisible:bounds.bottom<=clip.bottom+1,
            nonoverlapping:children.every((r,i)=>i===0||r.left>=children[i-1].right-1),
            inBounds:children.every(r=>r.left>=bounds.left-1&&r.right<=bounds.right+1)};
        });
        return {rows,bodyOverflow:body.scrollWidth-body.clientWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth};
      });
      expect(data.bodyOverflow).toBeLessThanOrEqual(1);
      expect(data.pageOverflow).toBeLessThanOrEqual(1);
      expect(data.rows).toHaveLength(3);
      for(const row of data.rows) {
        expect(row.height).toBeGreaterThanOrEqual(40);
        expect(row.height).toBeLessThanOrEqual(52);
        expect(row.nonoverlapping&&row.inBounds).toBe(true);
        expect(row.fullyVisible).toBe(true);
      }
      await expect(action(page,'back')).toHaveCount(0);
      await expect(action(page,'done')).toBeInViewport();
      await action(page,'done').tap();
      await tool(page,'position');
      await expect(sheet(page)).toHaveAccessibleName('Слой');
      await expect(number(page,'opacity')).toHaveValue('86');
      await ui(page).locator('[data-mp-tab=advanced]').tap();
      await number(page,'rotation').scrollIntoViewIfNeeded();
      await expect(number(page,'rotation')).toBeInViewport();
      await action(page,'done').tap();
      await tool(page,'color');
      await action(page,'colorEdit').tap();
      for(const selector of ['[data-mp-plane]','[data-mp-hue]','[data-mp-hex]']) {
        const control = sheet(page).locator(selector);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ratio:.9});
      }
      await expect(action(page,'done')).toBeInViewport();
      await action(page,'back').tap();
      await expect(ui(page).locator('.mp-pill')).toBeVisible();
    });
  });
}

test.describe('M1.6 semantic parity',()=>{
  test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});

  test('exact numeric typography, layer alignment and opacity preserve independent history and selection',async ({page})=>{
    await open(page);
    const original = await model(page);
    await edit(page);
    await tool(page,'size');
    await expect(number(page,'fontSize')).toHaveAttribute('placeholder','Разные');
    await enter(number(page,'fontSize'),525);
    const sized = await model(page);
    expect(sized.fontSize).toBe(original.fontSize);
    expect(sized.textRuns).toEqual([{start:0,end:5,style:{fontSize:525}}]);
    await tool(page,'spacing');
    await enter(number(page,'lineHeight'),.2);
    await enter(number(page,'letterSpacing'),-21.5);
    const tracked = await model(page);
    expect(tracked.textRuns).toEqual([{start:0,end:5,style:{fontSize:525,lineHeight:.2,letterSpacing:-21.5}}]);
    expect(tracked.lineHeight).toBe(original.lineHeight);
    expect(await selection(page)).toEqual(expectedSelection);

    await tool(page,'format');
    const justify = ui(page).locator('[data-mp-format=justify]');
    await justify.evaluate(node=>{node.dataset.domIdentity='retained'});
    await justify.tap();
    await expect(justify).toHaveAttribute('aria-pressed','true');
    await expect(justify).toHaveAttribute('data-dom-identity','retained');
    const aligned = await model(page);
    expect(aligned).toEqual({...tracked,textAlign:'justify'});
    await tool(page,'spacing');
    await ui(page).locator('[data-mp-valign=bottom]').tap();
    const verticallyAligned = await model(page);
    expect(verticallyAligned).toEqual({...aligned,verticalAlign:'bottom'});
    await tool(page,'position');
    await enter(number(page,'opacity'),63);
    const translucent = await model(page);
    expect(translucent).toEqual({...verticallyAligned,opacity:63});
    expect(await selection(page)).toEqual(expectedSelection);
    await expect(input(page)).not.toBeFocused();
    for(const expected of [verticallyAligned,aligned,tracked]) {
      await page.locator('#undoBtn').tap();
      expect(await model(page)).toEqual(expected);
    }
    await expect(number(page,'opacity')).toHaveValue('86');
    for(const expected of [aligned,verticallyAligned,translucent]) {
      await page.locator('#redoBtn').tap();
      expect(await model(page)).toEqual(expected);
    }
    await expect(number(page,'opacity')).toHaveValue('63');
    expect(await selection(page)).toEqual(expectedSelection);
  });

  test('gradient browsing and Back preserve formatting; gradient edits have an explicit layer scope',async ({page})=>{
    await open(page);
    await edit(page);
    const original = await model(page);
    await tool(page,'color');
    await action(page,'colorEdit').tap();
    await sheet(page).getByRole('button',{name:'Градиент · Весь слой',exact:true}).tap();
    expect(await model(page)).toEqual(original);
    await expect(ui(page).locator('[data-mobile-text-selection]')).toHaveCount(0);
    await action(page,'back').tap();
    await expect(ui(page).locator('.mp-pill')).toBeVisible();
    expect(await model(page)).toEqual(original);

    await action(page,'expand').tap();
    const gradient = sheet(page).getByRole('button',{name:/^Градиент #7956eb.*Весь слой$/});
    await gradient.tap();
    const colored = await model(page);
    expect(colored.fillType).toBe('gradient');
    expect(colored.textRuns).toEqual(original.textRuns);
    await expect(sheet(page).locator('[data-mp-swatch]').first()).toBeDisabled();
    await action(page,'colorEdit').tap();
    await expect(sheet(page).getByText(/Цвет выделения доступен при сплошной заливке/)).toBeVisible();
    await expect(sheet(page).locator('[data-mp-hex]')).toHaveCount(0);
    expect(await selection(page)).toEqual(expectedSelection);
    expect(await model(page)).toEqual(colored);
  });

  test('rotation keeps the editor target; Back returns from the same child without losing selection',async ({page})=>{
    await open(page);
    await edit(page);
    await tool(page,'color');
    await action(page,'expand').tap();
    await action(page,'colorEdit').tap();
    const original = await model(page);
    await page.setViewportSize({width:844,height:390});
    await expect(sheet(page)).toHaveAccessibleName('Свой цвет');
    await expect(page.locator('#inlineWysiwyg')).toBeHidden();
    await expect(input(page)).toBeVisible();
    expect(await selection(page)).toEqual(expectedSelection);
    await page.goBack();
    await expect(sheet(page)).toHaveAccessibleName('Цвет текста');
    await action(page,'done').tap();
    await expect(sheet(page)).toHaveCount(0);
    await tool(page,'edit');
    await expect(input(page)).toBeFocused();
    expect(await selection(page)).toEqual(expectedSelection);
    expect(await model(page)).toEqual(original);
  });

  test('clearing text effects preserves its separately configured stroke',async ({page})=>{
    await open(page,{strokeWidth:6,stroke:'#25784a'});
    await tool(page,'effects');
    await expect(ui(page).locator('[data-mp-effect=outline]')).toHaveCount(0);
    await ui(page).locator('[data-mp-effect=dropShadow]').tap();
    expect((await model(page)).effects.some(effect=>effect.type==='dropShadow')).toBe(true);
    await ui(page).locator('[data-mp-effect=none]').tap();
    const cleared = await model(page);
    expect(cleared.effects).toEqual([]);
    expect(cleared.strokeWidth).toBe(6);
    expect(cleared.stroke).toBe('#25784a');
  });

  test('font filtering keeps the native search field and the confirmed text selection',async ({page})=>{
    await open(page);
    await edit(page);
    await tool(page,'font');
    await action(page,'expand').tap();
    await action(page,'fontSearch').tap();
    const search = sheet(page).getByRole('searchbox',{name:'Поиск шрифта'});
    await search.evaluate(node=>{node.dataset.domIdentity='retained'});
    await search.pressSequentially('Georg');
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('data-dom-identity','retained');
    await expect(sheet(page).locator('.mp-font-row')).toHaveCount(1);
    await sheet(page).locator('[data-mp-font=Georgia]').tap();
    await sheet(page).locator('[data-mp-variant="700:normal"]').tap();
    const formatted = await model(page);
    expect(formatted.fontFamily).toBe('Arial');
    expect(formatted.textRuns.every(run=>run.start>=0&&run.end<=5&&run.style.fontFamily==='Georgia'&&run.style.fontWeight==='700')).toBe(true);
    expect(await selection(page)).toEqual(expectedSelection);
  });
});
