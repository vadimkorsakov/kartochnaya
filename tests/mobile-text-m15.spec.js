const {readFile} = require('node:fs/promises');
const {join} = require('node:path');
const {PNG} = require('pngjs');
const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument} = require('./helpers');
const fixture = require('./fixtures/visual-text.json');

const text = 'A👩‍💻e\u0301Z\nСписок';
const end = text.indexOf('Z');
const rich = [
  {start:0,end:1,style:{fontWeight:'700',fillOpacity:42}},
  {start:1,end:6,style:{fontStyle:'italic',fillOpacity:60}},
  {start:end,end:end+1,style:{textColor:'#475869'}},
];
const paragraphs = [{start:end+2,style:{listKind:'bullet',listMarker:'◆'}}];
const editor = page => page.locator('#inlineText');
const sheet = page => page.locator('#mobilePropertyUI .mp-sheet');
const tool = (page,key) => page.locator(`#mobileContext [data-mobile=${key}]`).tap();
const back = page => sheet(page).getByRole('button',{name:'Назад',exact:true}).tap();
const done = page => sheet(page).getByRole('button',{name:'Готово',exact:true}).tap();
const field = (page,key,type='number') => sheet(page).locator(`input[type=${type}][data-mp-paint-field=${key}]`);
const choice = (page,key,value) => sheet(page).locator(`[data-mp-paint-key=${key}][data-mp-paint-value=${value}]`);
const caret = page => editor(page).evaluate(node=>[node.selectionStart,node.selectionEnd,node.selectionDirection]);
const model = async page => (await exportedDocument(page)).elements.find(e=>e.name==='M1.5');
const selectLayer = async (page,name='M1.5') => {
  await page.locator('[data-mobile=layers]:visible').tap();
  await page.locator('#mobileLayerList').getByText(name,{exact:true}).tap();
  await page.locator('#mobileLayersClose').tap();
};
async function seed(page,patch={},withSlides=false) {
  await openHome(page);
  const payload = structuredClone(fixture);
  const layer = Object.assign(payload.document.elements[0],{
    id:'m15',name:'M1.5',text,x:14,y:20,w:280,h:180,fontFamily:'Arial',fontSize:30,
    autoFontSize:false,textAlign:'left',opacity:81,fillType:'solid',fill:'#234567',
    textColor:'#234567',fillOpacity:90,stroke:'#111111',strokeWidth:0,strokeOpacity:80,
    textRuns:rich,paragraphRuns:paragraphs,...patch,
  });
  payload.document.elements.push({...layer,id:'neighbor',name:'Соседний слой',y:205,h:22,text:'Сосед',textRuns:[],paragraphRuns:[]});
  if (withSlides) {
    const {width,height,background,elements} = payload.document;
    Object.assign(payload.document,{type:'card',activeSlideIndex:0,hasCustomName:true,title:'M1.5',
      slides:[
        {id:'first',width,height,background,elements},
        {id:'second',width,height,background,elements:[{...layer,id:'separate',name:'Другой слайд'}]},
      ]});
  }
  await importPayload(page,payload);
  await expect.poll(async()=>(await records(page,'docs')).some(doc=>doc.elements.some(e=>e.name==='M1.5'))).toBe(true);
  const {id} = (await records(page,'docs')).find(doc=>doc.elements.some(e=>e.name==='M1.5'));
  await openLibraryDocument(page,id);
  await selectLayer(page);
  return id;
}
async function edit(page,start=1,finish=end) {
  await tool(page,'edit');
  await expect(editor(page)).toBeFocused();
  await editor(page).evaluate((node,[a,b])=>{
    node.setSelectionRange(a,b,'backward');
    node.dispatchEvent(new Event('select',{bubbles:true}));
  },[start,finish]);
}
const panels = {underline:'Подчёркивание',stroke:'Обводка текста',fill:'Прозрачность заливки'};
async function open(page,key,{fromMenu=false}={}) {
  if (!fromMenu) await tool(page,'paint');
  await expect(sheet(page)).toHaveAccessibleName('Оформление текста');
  await sheet(page).locator(`[data-mp-format=${key}Settings]`).tap();
  await expect(sheet(page)).toHaveAccessibleName(panels[key]);
}
async function enter(input,value) {
  await input.fill(String(value));
  await input.press('Enter');
  await expect(input).not.toBeFocused();
}
async function color(page,key,value) {
  await sheet(page).locator('[data-mp-paint-color]').tap();
  await expect(sheet(page)).toHaveAccessibleName(key==='stroke'?'Цвет обводки':'Цвет подчёркивания');
  await enter(field(page,key,'text'),value);
}
async function download(page,selector) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).evaluate(button=>button.click());
  const result = await pending;
  expect(await result.failure()).toBeNull();
  return readFile(await result.path());
}
async function geometry(page,info,key,viewport,rows) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const data = await sheet(page).evaluate(panel=>{
    const body = panel.querySelector('.mp-body'), clip = body.getBoundingClientRect();
    const rect = node => {
      const {x,y,right,bottom,width,height} = node.getBoundingClientRect();
      return {x,y,right,bottom,width,height};
    };
    return {panel:rect(panel),width:body.clientWidth,scrollWidth:body.scrollWidth,
      viewportWidth:document.documentElement.scrollWidth,height:body.clientHeight,scrollHeight:body.scrollHeight,
      rows:[...body.querySelectorAll('[data-mp-paint-row]')].filter(node=>node.checkVisibility())
        .map(node=>{const {y,bottom,height}=rect(node);return {height,visible:y>=clip.y&&bottom<=clip.bottom};}),
      targets:[...panel.querySelectorAll('input,button')].filter(node=>node.checkVisibility()).map(rect)};
  });
  expect(data.width).toBe(data.scrollWidth);
  expect(data.viewportWidth).toBe(viewport.width);
  expect(data.panel.right).toBeLessThanOrEqual(viewport.width);
  for (const [index,a] of data.targets.entries()) {
    expect(a.width).toBeGreaterThanOrEqual(44);
    expect(a.height).toBeGreaterThanOrEqual(34);
    for (const b of data.targets.slice(index+1))
      expect(Math.min(a.right,b.right)>Math.max(a.x,b.x)&&Math.min(a.bottom,b.bottom)>Math.max(a.y,b.y)).toBe(false);
  }
  if (rows !== undefined) {
    expect(data.scrollHeight).toBe(data.height);
    // The compact row target is 40 CSS px; mixed/inherited labels may
    // require a few extra pixels depending on the browser's font metrics.
    expect(data.rows).toHaveLength(rows);
    for (const [index, row] of data.rows.entries()) {
      expect(row.visible, `row ${index + 1} is fully visible`).toBe(true);
      expect(row.height, `row ${index + 1} height`).toBeGreaterThanOrEqual(40);
      expect(row.height, `row ${index + 1} height`).toBeLessThanOrEqual(44);
    }
  }
  const name = `${key}-${viewport.width}x${viewport.height}.png`;
  const path = process.env.M15_SCREENSHOTS ? join(process.env.M15_SCREENSHOTS,name) : info.outputPath(name);
  await page.screenshot({path});
  await info.attach(key,{path,contentType:'image/png'});
  await info.attach(key+' geometry',{body:JSON.stringify(data),contentType:'application/json'});
}

for (const viewport of [{width:360,height:640},{width:390,height:844}]) test.describe(`M1.5 ${viewport.width}`,()=>{
  test.use({viewport,hasTouch:true,isMobile:true});

  test('compact panels and child color stay in the bottom sheet',async({page},info)=>{
    await seed(page);
    await edit(page);
    await open(page,'underline');
    await expect(sheet(page).locator('[data-mp-paint-target]')).toHaveText('Выделено: «👩‍💻é»');
    await expect(sheet(page).locator('#mp-paint-state-underlineOpacity')).toHaveText('Как у текста · Разные');
    await geometry(page,info,'underline',viewport,6);
    await sheet(page).locator('[data-mp-paint-color]').tap();
    await expect(sheet(page)).toHaveAccessibleName('Цвет подчёркивания');
    await geometry(page,info,'color',viewport,0);
    await page.goBack();
    await expect(sheet(page)).toHaveAccessibleName(panels.underline);
    await expect(editor(page)).toHaveJSProperty('readOnly',true);
    expect(await caret(page)).toEqual([1,end,'backward']);
    await back(page);
    await open(page,'stroke',{fromMenu:true});
    await geometry(page,info,'stroke',viewport,5);
    await back(page);
    await open(page,'fill',{fromMenu:true});
    await expect(field(page,'fillOpacity')).toHaveValue('');
    await expect(sheet(page).getByText('Разные',{exact:true})).toBeVisible();
    await geometry(page,info,'fill',viewport,1);
    await done(page);
    await expect(sheet(page)).toHaveCount(0);
    expect(await caret(page)).toEqual([1,end,'backward']);
    await open(page,'stroke');
    await expect(field(page,'strokeOpacity')).toHaveValue('80');
    const landscape = {width:viewport.height,height:viewport.width};
    await page.setViewportSize(landscape);
    await expect(sheet(page)).toHaveAccessibleName(panels.stroke);
    await geometry(page,info,'landscape',landscape);
    await field(page,'strokeOpacity').scrollIntoViewIfNeeded();
    await expect(field(page,'strokeOpacity')).toBeInViewport({ratio:1});
    await page.goBack();
    await expect(sheet(page)).toHaveAccessibleName('Оформление текста');
    expect(await caret(page)).toEqual([1,end,'backward']);
  });

  test('underline details merge per run and retain automatic and inherited values',async({page})=>{
    await seed(page);
    const before = await model(page);
    await edit(page);
    await tool(page,'format');
    const quick = sheet(page).locator('[data-mp-format=underline]');
    await quick.tap();
    await expect(quick).toHaveAttribute('aria-pressed','true');
    await quick.tap();
    await expect(quick).toHaveAttribute('aria-pressed','false');
    await done(page);
    await open(page,'underline');
    for (const style of ['solid','dotted','wavy']) {
      await choice(page,'underlineStyle',style).tap();
      await expect(choice(page,'underlineStyle',style)).toHaveAttribute('aria-pressed','true');
    }
    await enter(field(page,'underlineThickness'),3.5);
    await enter(field(page,'underlineOffset'),-2.5);
    await enter(field(page,'underlineOpacity'),35);
    await color(page,'underlineColor','#d62956');
    await back(page);
    await expect(sheet(page)).toHaveAccessibleName(panels.underline);
    const styled = await model(page);
    expect(styled).toMatchObject({fill:before.fill,textColor:before.textColor,opacity:81,fillOpacity:90,strokeOpacity:80,paragraphRuns:paragraphs});
    const changed = styled.textRuns.filter(run=>run.start>=1&&run.end<=end);
    expect(changed).toHaveLength(2);
    for (const run of changed) expect(run.style).toMatchObject({underline:true,underlineDetails:{
      style:'wavy',thickness:3.5,offset:-2.5,color:'#d62956',opacity:35,
    }});
    expect(styled.textRuns[0]).toEqual(before.textRuns[0]);
    expect(styled.textRuns.at(-1)).toEqual(before.textRuns.at(-1));
    await choice(page,'underlineThickness','auto').tap();
    await choice(page,'underlineOffset','auto').tap();
    await choice(page,'underlineColor','inherit').tap();
    await choice(page,'underlineOpacity','inherit').tap();
    await choice(page,'underline',false).tap();
    const reset = await model(page);
    for (const run of reset.textRuns.filter(run=>run.start>=1&&run.end<=end)) {
      expect(run.style.underlineDetails.style).toBe('wavy');
      for(const key of ['thickness','offset','color','opacity'])
        expect(run.style.underlineDetails[key] ?? ({thickness:'auto',offset:'auto',color:'inherit',opacity:'inherit'})[key]).toBe(({thickness:'auto',offset:'auto',color:'inherit',opacity:'inherit'})[key]);
    }
    await expect(choice(page,'underline',false)).toHaveAttribute('aria-pressed','true');
    expect(await caret(page)).toEqual([1,end,'backward']);
  });

  test('stroke and fill edits are independent and survive undo, exports and reload',async({page})=>{
    const id = await seed(page);
    await edit(page);
    await open(page,'stroke');
    await choice(page,'strokeEnabled',true).tap();
    await expect(field(page,'strokeWidth')).toHaveValue('2');
    await choice(page,'strokeEnabled',false).tap();
    await expect(field(page,'strokeWidth')).toHaveValue('0');
    for (const style of ['dotted','solid','dashed']) await choice(page,'strokeStyle',style).tap();
    await enter(field(page,'strokeWidth'),4);
    await enter(field(page,'strokeOpacity'),65);
    await color(page,'stroke','#1266b0');
    await back(page);
    const stroke = await model(page);
    await back(page);
    await open(page,'fill',{fromMenu:true});
    const originalPNG = await download(page,'#exportBtn');
    await enter(field(page,'fillOpacity'),0);
    const after = await model(page);
    expect(after).toMatchObject({fillOpacity:90,strokeOpacity:80,strokeWidth:0,opacity:81,paragraphRuns:paragraphs});
    expect(after.textRuns.filter(run=>run.start>=1&&run.end<=end).map(run=>run.style)).toEqual([
      {fontStyle:'italic',fillOpacity:0,stroke:'#1266b0',strokeWidth:4,strokeStyle:'dashed',strokeOpacity:65},
      {fillOpacity:0,stroke:'#1266b0',strokeWidth:4,strokeStyle:'dashed',strokeOpacity:65},
    ]);
    expect(after.textRuns[0]).toEqual(rich[0]);
    expect(after.textRuns.at(-1)).toEqual(rich.at(-1));
    expect(await download(page,'#exportBtn')).not.toEqual(originalPNG);
    await page.locator('#undoBtn').tap();
    expect(await model(page)).toEqual(stroke);
    await page.locator('#redoBtn').tap();
    expect(await model(page)).toEqual(after);
    expect(await caret(page)).toEqual([1,end,'backward']);
    await page.keyboard.press('Control+Enter');
    await expect(editor(page)).toBeHidden();
    await expect.poll(async()=>(await records(page,'docs')).find(e=>e.id===id)?.elements[0].textRuns).toEqual(after.textRuns);
    await page.reload();
    await expect(page.locator('#homeScreen')).toBeVisible();
    await openLibraryDocument(page,id);
    expect(await model(page)).toEqual(after);
    await page.locator('#documentTabsHome').tap();
    await page.locator('[data-home-nav=data]').tap();
    await page.locator('#zipStorage').tap();
    await expect(page.locator('#zipConfirm')).toBeEnabled();
    const zip = await download(page,'#zipConfirm');
    const {readBackup} = await import('../src/backup/archive.mjs');
    const backup = await readBackup(zip);
    expect(backup.data.docs.find(doc=>doc.id===id).elements[0]).toEqual(after);
  });

  test('touch slider drafts stay out of PNG and JSON until release',async({page})=>{
    await seed(page);
    await edit(page);
    await open(page,'fill');
    const initial = await model(page), png = await download(page,'#exportBtn');
    const slider = field(page,'fillOpacity','range');
    const box = await slider.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const dispatch = (type,fraction) => cdp.send('Input.dispatchTouchEvent',{
      type,touchPoints:fraction === undefined ? [] : [{x:box.x+box.width*fraction,y:box.y+box.height/2}],
    });
    await dispatch('touchStart',.75);
    await dispatch('touchMove',.32);
    await expect(field(page,'fillOpacity')).not.toHaveValue('');
    expect(await model(page)).toEqual(initial);
    expect(await download(page,'#exportBtn')).toEqual(png);
    await dispatch('touchCancel');
    await expect(field(page,'fillOpacity')).toHaveValue('');
    expect(await model(page)).toEqual(initial);
    await dispatch('touchStart',.65);
    await dispatch('touchMove',.25);
    const value = Number(await slider.inputValue());
    await dispatch('touchEnd');
    await expect(field(page,'fillOpacity')).toHaveValue(String(value));
    const changed = await model(page);
    expect(changed.textRuns.filter(run=>run.start>=1&&run.end<=end).every(run=>run.style.fillOpacity===value)).toBe(true);
    await page.keyboard.press('Control+z');
    expect(await model(page)).toEqual(initial);
    await page.keyboard.press('Control+Shift+z');
    expect(await model(page)).toEqual(changed);
  });

  test('draft ownership follows the layer, slide and document',async({page})=>{
    const id = await seed(page,{},true);
    const initial = await exportedDocument(page);
    await edit(page);
    await open(page,'stroke');
    const width = field(page,'strokeWidth');
    await width.fill('18');
    await width.evaluate(node=>{window.abandonedPaintField=node;});
    await selectLayer(page,'Соседний слой');
    await expect(sheet(page)).toHaveCount(0);
    expect((await exportedDocument(page)).elements).toEqual(initial.elements);

    await selectLayer(page);
    await edit(page);
    await open(page,'fill');
    await field(page,'fillOpacity').fill('23');
    await page.locator('#mobileSeriesToggle').tap();
    await page.locator('#mobileSeriesList [data-side-slide="1"]').tap();
    await expect(sheet(page)).toHaveCount(0);
    await selectLayer(page,'Другой слайд');
    await open(page,'stroke');
    await page.evaluate(()=>window.abandonedPaintField.dispatchEvent(new Event('change',{bubbles:true})));
    const switched = await exportedDocument(page);
    expect(switched.activeSlideIndex).toBe(1);
    expect(switched.slides.map(slide=>slide.elements)).toEqual(initial.slides.map(slide=>slide.elements));

    const alpha = field(page,'strokeOpacity');
    await alpha.fill('21');
    await page.locator('#documentTabsHome').tap();
    await expect(page.locator('#homeScreen')).toBeVisible();
    await page.locator('#createTemplateBtn').tap();
    await page.locator('#newDocTitle').fill('Другой документ');
    await page.locator('#confirmNewDoc').tap();
    await expect(page.locator('#documentTabsMenuLabel')).toHaveText('Другой документ');
    expect((await exportedDocument(page)).elements).toEqual([]);
    await page.locator('#documentTabsMenuToggle').tap();
    await page.locator(`[data-mobile-tab-id="${id}"] [data-mobile-tab-activate]`).tap();
    await expect(sheet(page)).toHaveCount(0);
    expect((await exportedDocument(page)).slides.map(slide=>slide.elements)).toEqual(initial.slides.map(slide=>slide.elements));
  });

  test('partial graphemes and unconfirmed IME input block range changes',async({page})=>{
    await seed(page);
    await edit(page,2,end);
    await open(page,'stroke');
    await expect(field(page,'strokeWidth')).toBeDisabled();
    await expect(sheet(page).locator('[data-mp-paint-hint]')).toContainText('Выделите символ целиком');
    await done(page);
    await edit(page);
    await open(page,'fill');
    const initial = await model(page);
    const alpha = field(page,'fillOpacity');
    await alpha.fill('10');
    await editor(page).dispatchEvent('compositionstart');
    await expect(alpha).toBeDisabled();
    await editor(page).dispatchEvent('compositionend');
    await expect(alpha).toBeEnabled();
    await alpha.dispatchEvent('change');
    expect(await model(page)).toEqual(initial);
    expect(await caret(page)).toEqual([1,end,'backward']);
  });

  test('whole-layer edits replace just the selected paint property',async({page})=>{
    await seed(page);
    const initial = await model(page);
    await open(page,'underline');
    await choice(page,'underlineStyle','dotted').tap();
    await enter(field(page,'underlineThickness'),2.5);
    const underlined = await model(page);
    expect(underlined).toMatchObject({underline:true,underlineDetails:{style:'dotted',thickness:2.5},textRuns:initial.textRuns});
    await back(page);
    await open(page,'stroke',{fromMenu:true});
    await enter(field(page,'strokeWidth'),7);
    await choice(page,'strokeStyle','dotted').tap();
    await color(page,'stroke','#7a5092');
    await back(page);
    await enter(field(page,'strokeOpacity'),44);
    const outlined = await model(page);
    expect(outlined).toMatchObject({stroke:'#7a5092',strokeWidth:7,strokeStyle:'dotted',strokeOpacity:44,
      underlineDetails:underlined.underlineDetails,fillOpacity:90,opacity:81,textRuns:initial.textRuns});
    await back(page);
    await open(page,'fill',{fromMenu:true});
    await enter(field(page,'fillOpacity'),29);
    const after = await model(page);
    expect(after).toMatchObject({fillOpacity:29,opacity:81,strokeOpacity:44,paragraphRuns:paragraphs});
    expect(after.textRuns).toEqual([
      {start:0,end:1,style:{fontWeight:'700'}},
      {start:1,end:6,style:{fontStyle:'italic'}},
      rich.at(-1),
    ]);
    await page.locator('#undoBtn').tap();
    expect(await model(page)).toEqual(outlined);
    await expect(field(page,'fillOpacity')).toHaveValue('');
    await page.locator('#redoBtn').tap();
    expect(await model(page)).toEqual(after);
    await expect(field(page,'fillOpacity')).toHaveValue('29');
  });

  test('a vertical text layer keeps its layer controls outside typing',async({page})=>{
    await seed(page,{textMode:'vertical'});
    await edit(page,1,1);
    await open(page,'stroke');
    await expect(field(page,'strokeWidth')).toBeDisabled();
    await expect(sheet(page).locator('[data-mp-paint-hint]')).toContainText('Завершите ввод');
    await page.keyboard.press('Control+Enter');
    await expect(editor(page)).toBeHidden();
    await expect(sheet(page)).toHaveCount(0);
    await open(page,'stroke');
    await enter(field(page,'strokeWidth'),6);
    expect((await model(page)).strokeWidth).toBe(6);
    await page.locator('#undoBtn').tap();
    expect((await model(page)).strokeWidth).toBe(0);
  });

  test('image fill alpha is layer-wide and leaves the source image intact',async({page})=>{
    const sample = new PNG({width:2,height:2});
    sample.data.fill(180);
    const imageSrc = 'data:image/png;base64,'+PNG.sync.write(sample).toString('base64');
    await seed(page,{fillType:'image',imageSrc});
    await edit(page);
    await open(page,'fill');
    const before = await model(page);
    await expect(field(page,'fillOpacity')).toBeDisabled();
    await expect(sheet(page).locator('[data-mp-paint-hint]')).toContainText('растровой заливки');
    await done(page);
    await edit(page,1,1);
    await open(page,'fill');
    await enter(field(page,'fillOpacity'),34);
    expect(await model(page)).toEqual({...before,fillOpacity:34});
  });

  test('a gradient range is blocked and a collapsed caret uses layer opacity for the fill',async({page})=>{
    const gradientStops = [{pos:0,color:'#123456',alpha:33},{pos:100,color:'#fda001',alpha:96}];
    await seed(page,{fillType:'gradient',fill2:'#fda001',gradientStops});
    await edit(page);
    await open(page,'fill');
    await expect(field(page,'fillOpacity')).toBeDisabled();
    await expect(sheet(page).locator('[data-mp-paint-hint]')).toContainText('Снимите выделение');
    await back(page);
    await open(page,'underline',{fromMenu:true});
    await expect(field(page,'underlineThickness')).toBeDisabled();
    await done(page);
    await edit(page,1,1);
    await open(page,'fill');
    await expect(sheet(page).locator('[data-mp-paint-target]')).toHaveText('Весь слой');
    await enter(field(page,'fillOpacity'),16);
    expect(await model(page)).toMatchObject({fillType:'gradient',gradientStops,fillOpacity:16,opacity:81,textRuns:rich,paragraphRuns:paragraphs});
  });
});
