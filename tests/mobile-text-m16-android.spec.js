const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG} = require('./helpers');
const fixture = require('./fixtures/visual-text.json');

const caption = 'Текст для Android';
const source = 'АБВГД ЕЖЗИК';
const range = [0,5,'backward'];
const editor = page => page.locator('#inlineText');
const properties = page => page.locator('#mobilePropertyUI');
const tool = (page,key) => page.locator(`#mobileContext [data-mobile=${key}]`).tap();
const prop = (page,key,type='number') => properties(page).locator(`input[data-mp-key=${key}][type=${type}]`);
const history = (page,key) => page.locator(`#${key}Btn`).tap();
const layer = async page => (await exportedDocument(page)).elements.find(e=>e.name===caption);
const action = (page,name) => properties(page).locator(`[data-mp-action=${name}]`);
const arrange = (page,key) => properties(page).locator(`[data-mp-arrange=${key}]`);
const settings = (page,tab) => properties(page).locator(`[data-mp-tab=${tab}]`);
const order = async page => (await exportedDocument(page)).elements.map(e=>e.name);
const caret = page => editor(page).evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]);

async function seed(page,{group=false}={}) {
  await openHome(page);
  const payload = structuredClone(fixture),doc = payload.document;
  Object.assign(doc,{title:'Приёмка Android',width:320,height:240});
  const e = Object.assign(doc.elements[0],{
    id:'m16-android',name:caption,text:source,x:35,y:25,w:160,h:100,fontSize:26,fontFamily:'Arial',
    fontWeight:'400',autoFontSize:false,textAlign:'left',fillType:'solid',textColor:'#7145ad',fill:'#7145ad',
    stroke:'#254438',strokeWidth:3,letterSpacing:2,lineHeight:1.6,
    textRuns:[{start:0,end:2,style:{letterSpacing:4,lineHeight:2}},{start:6,end:9,style:{fontStyle:'italic'}}],
  });
  doc.palette = ['#7145ad','#521795','#008161','#c03015','#88649d','#847551','#123456','#335cbc','#dab712','#773355'];
  if (group) {
    const shape = (id,name,x,y,groupId=null)=>({
      id,name,groupId,type:'rect',visible:true,locked:false,x,y,w:50,h:28,fill:'#9e674a',fillType:'solid',opacity:100,
    });
    doc.groups=[{id:'family',name:'Группа',visible:true,locked:false,parentId:null,collapsed:false}];
    doc.elements=[shape('bottom','Низ',215,15),e,shape('mid','Середина',200,70),
      shape('first','Группа А',40,140,'family'),shape('second','Группа Б',110,165,'family'),
      shape('top','Верх',220,160)];
  }
  await importPayload(page,payload);
  await expect.poll(async()=>(await records(page,'docs')).some(doc=>doc.elements.some(e=>e.name===caption))).toBe(true);
  const docId=(await records(page,'docs')).find(doc=>doc.elements.some(e=>e.name===caption)).id;
  await openLibraryDocument(page,docId);
  await select(page,caption);
  return docId;
}
const row = (page,name) => page.locator('#mobileLayerList .layer-sort').filter({has:page.getByText(name,{exact:true})});
const layers = page => page.locator('#mobileToolbars [data-mobile=layers]:visible').tap();
async function select(page,name) {
  await layers(page);
  await row(page,name).locator('.layer-name').tap();
  await page.locator('#mobileLayersClose').tap();
}
async function edit(page,selection=range) {
  await tool(page,'edit');
  await expect(editor(page)).toBeFocused();
  await editor(page).evaluate((node,selection)=>{
    node.setSelectionRange(...selection);
    node.dispatchEvent(new Event('select',{bubbles:true}));
  },selection);
}
async function mockIme(page,viewport) {
  await page.addInitScript(({width,height})=>{
    const vv=new EventTarget();
    Object.assign(vv,{width,height,offsetTop:0,offsetLeft:0,pageTop:0,scale:1});
    Object.defineProperty(window,'visualViewport',{configurable:true,value:vv});
    window.setImeHeight=next=>{
      vv.height=next;
      vv.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
    };
    const events=[];
    window.imeTouchTrace=events;
    const push=(type,target)=>events.push({type,target:target?.closest?.('button')?.dataset.mobile||target?.id,focused:document.activeElement?.id,height:vv.height});
    for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','click','focus','blur','selectionchange'])
      document.addEventListener(type,event=>push(type,event.target),true);
    vv.addEventListener('resize',()=>push('VisualViewport.resize'));
  },viewport);
}
async function nativeTapWithOpenIme(page,context,viewport,info) {
  await mockIme(page,viewport);
  await seed(page);
  await edit(page);
  const format=page.locator('#mobileContext [data-mobile=format]');
  await editor(page).evaluate((node,height)=>{
    window.imeTouchTrace.length=0;
    node.addEventListener('blur',()=>window.setImeHeight(height),{once:true});
    window.setImeHeight(height-225);
  },viewport.height);
  await expect.poll(async()=> (await format.boundingBox()).y).toBeLessThan(viewport.height-240);
  const box = await format.boundingBox();
  const touch = await context.newCDPSession(page);
  const hit={x:box.x+box.width/2,y:box.y+box.height/2,id:1,radiusX:3,radiusY:3,force:1};
  try{
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[hit]});
    await expect.poll(()=>page.evaluate(()=>window.imeTouchTrace.some(x=>x.type==='pointerdown'&&x.target==='format'))).toBe(true);
    await expect(editor(page)).toBeFocused();
    expect((await format.boundingBox()).y).toBeCloseTo(box.y,0);
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(properties(page).getByRole('dialog',{name:'Формат'})).toBeVisible();
  }finally{
    await info.attach('ime-touch-trace.json',{body:JSON.stringify(await page.evaluate(()=>window.imeTouchTrace),null,2),contentType:'application/json'});
    await touch.detach();
  }
  await expect(editor(page)).not.toBeFocused();
  expect(await caret(page)).toEqual(range);
  await expect(properties(page).locator('[data-mobile-text-selection]')).toHaveText('Выделено: «АБВГД»');
  const trace = await page.evaluate(()=>window.imeTouchTrace);
  const pointerUp = trace.findIndex(e=>e.type==='pointerup'&&e.target==='format');
  const click = trace.findIndex(e=>e.type==='click'&&e.target==='format');
  const blur = trace.findIndex(e=>e.type==='blur'&&e.target==='inlineText');
  expect(pointerUp).toBeGreaterThanOrEqual(0);
  expect(click).toBeGreaterThan(pointerUp);
  expect(blur).toBeGreaterThan(click);
  expect(trace.filter(e=>e.type==='click'&&e.target==='format')).toHaveLength(1);
  await properties(page).locator('[data-mp-format=bold]').tap();
  expect((await layer(page)).fontWeight).toBe('400');
  expect((await layer(page)).textRuns.filter(run=>run.style.fontWeight==='700').map(run=>[run.start,run.end])).toEqual([[0,2],[2,5]]);
  await tool(page,'edit');
  await expect(editor(page)).toBeFocused();
  expect(await caret(page)).toEqual(range);
}

for(const viewport of [{width:360,height:640},{width:390,height:844}]) {
  test.describe(`Android ${viewport.width}`,()=>{
    test.use({viewport,hasTouch:true,isMobile:true});

    test('first genuine touch activates formatting before mock VisualViewport expands after blur',
      async ({page,context},info)=>nativeTapWithOpenIme(page,context,viewport,info));

    test('spacing resets update Mixed, numeric fields, sliders and each Undo/Redo independently',async({page})=>{
      await seed(page);
      await edit(page);
      const before=await layer(page);
      await tool(page,'spacing');
      const reset=key=>properties(page).locator(`[data-mp-spacing-reset=${key}]`);
      await expect(prop(page,'letterSpacing')).toHaveAttribute('placeholder','Разные');
      await expect(prop(page,'lineHeight')).toHaveAttribute('placeholder','Разные');
      await reset('letterSpacing').tap();
      const tracked=await layer(page);
      expect(tracked.letterSpacing).toBe(2);
      expect(tracked.lineHeight).toBe(1.6);
      const expectTrack=async value=>{
        await expect(prop(page,'letterSpacing')).toHaveValue(value);
        if(value)await expect(prop(page,'letterSpacing','range')).toHaveValue(value);
      };
      await expectTrack('0');
      await expect(reset('letterSpacing')).toBeDisabled();
      await reset('lineHeight').tap();
      const resetBoth=await layer(page);
      await expect(prop(page,'lineHeight')).toHaveValue('1.15');
      await expect(prop(page,'lineHeight','range')).toHaveValue('1.15');
      expect(resetBoth.textRuns.at(-1)).toEqual(before.textRuns.at(-1));
      expect(resetBoth.textRuns.slice(0,-1)).toEqual([{start:0,end:5,style:{letterSpacing:0,lineHeight:1.15}}]);
      await history(page,'undo');
      expect(await layer(page)).toEqual(tracked);
      await expect(prop(page,'lineHeight')).toHaveValue('');
      await history(page,'undo');
      expect(await layer(page)).toEqual(before);
      await expectTrack('');
      await history(page,'redo');
      await expectTrack('0');
      await history(page,'redo');
      expect(await layer(page)).toEqual(resetBoth);
      expect(await caret(page)).toEqual(range);

      await page.locator('#mobileConfirm').tap();
      // Reopen the inspector explicitly on the base layer after leaving text input.
      if(await properties(page).locator('.mp-spacing-sheet').count())await action(page,'done').tap();
      await tool(page,'spacing');
      await reset('letterSpacing').tap();
      expect(await layer(page)).toEqual({...resetBoth,letterSpacing:0});
      await expect(prop(page,'letterSpacing')).toHaveValue('0');
      await history(page,'undo');
      await expect(prop(page,'letterSpacing')).toHaveValue('2');
      await history(page,'redo');
      await expect(prop(page,'letterSpacing')).toHaveValue('0');
      await edit(page,[3,3,'forward']);
      await tool(page,'spacing');
      await reset('lineHeight').tap();
      expect((await layer(page)).lineHeight).toBe(1.15);
      expect(await caret(page)).toEqual([3,3,'forward']);
      await history(page,'undo');
      await expect(prop(page,'lineHeight')).toHaveValue('1.6');
    });

    test('color capsule fits the hit areas and selected swatch before and after horizontal scroll',async({page})=>{
      await seed(page);
      await tool(page,'color');
      const pill=properties(page).locator('.mp-color-pill');
      const read=()=>pill.evaluate(node=>{
        const rect=node.getBoundingClientRect(),swatches=node.querySelector('.mp-swatches');
        return {height:rect.height,overflow:getComputedStyle(node).overflowY,scroll:swatches.scrollWidth-swatches.clientWidth,
          controls:[...node.querySelectorAll('button')].map(b=>{
            const r=b.getBoundingClientRect(),d=b.querySelector('.mp-color-glyph').getBoundingClientRect();
            return {height:r.height,diameter:d.width,difference:Math.abs((r.top+r.bottom-d.top-d.bottom)/2),
              inside:r.top>=rect.top&&r.bottom<=rect.bottom};
          })};
      });
      const first=await read();
      expect(first.overflow).toBe('visible');
      expect(first.height).toBeLessThan(60);
      expect(first.scroll).toBeGreaterThan(0);
      for(const button of first.controls) {
        expect(button).toEqual({height:40,diameter:28,difference:0,inside:true});
      }
      await expect(pill.locator('[data-mp-swatch="#7145ad"]')).toHaveAttribute('aria-pressed','true');
      expect(await pill.locator('.mp-swatch.active .mp-color-glyph').evaluate(e=>getComputedStyle(e).boxShadow)).not.toBe('none');
      await pill.locator('[data-mp-swatch="#773355"]').tap();
      expect((await layer(page)).textColor).toBe('#773355');
      expect((await read()).controls.every(button=>button.inside)).toBe(true);
    });

    test('two touch presses reorder without replacing buttons; boundary actions disable and alignment is undoable',async({page})=>{
      const id=await seed(page,{group:true});
      const before=await order(page);
      await tool(page,'position');
      await arrange(page,'forward').evaluate(node=>node.dataset.identity='unchanged');
      await arrange(page,'forward').tap();
      expect(await order(page)).toEqual(['Низ','Середина',caption,'Группа А','Группа Б','Верх']);
      await expect(arrange(page,'forward')).toHaveAttribute('data-identity','unchanged');
      await arrange(page,'forward').tap();
      expect(await order(page)).toEqual(['Низ','Середина','Группа А','Группа Б',caption,'Верх']);
      await arrange(page,'front').tap();
      await expect(arrange(page,'front')).toBeDisabled();
      await expect(arrange(page,'forward')).toHaveAttribute('title','Уже вверху своего уровня');
      expect(await order(page)).toEqual(['Низ','Середина','Группа А','Группа Б','Верх',caption]);
      await arrange(page,'backward').tap();
      expect((await order(page)).slice(-2)).toEqual([caption,'Верх']);
      await arrange(page,'back').tap();
      expect((await order(page))[0]).toBe(caption);
      await expect(arrange(page,'back')).toBeDisabled();
      await history(page,'undo');
      await history(page,'undo');
      await expect(arrange(page,'front')).toBeDisabled();
      await history(page,'undo');
      await expect(arrange(page,'front')).toBeEnabled();
      await history(page,'undo');
      await history(page,'undo');
      expect(await order(page)).toEqual(before);
      await history(page,'redo');
      await expect(arrange(page,'backward')).toBeEnabled();
      await settings(page,'align').tap();
      await arrange(page,'atop').tap();
      await expect(arrange(page,'atop')).toBeDisabled();
      expect((await layer(page)).y).toBe(0);
      await arrange(page,'aright').tap();
      const moved=await layer(page);
      expect(moved.x).toBe(320-moved.w);
      await history(page,'undo');
      expect((await layer(page)).x).toBe(35);
      await history(page,'redo');
      expect(await layer(page)).toEqual(moved);
      const png=(await exportPNG(page)).image.data;
      await expect.poll(async()=>(await records(page,'docs')).find(doc=>doc.id===id)?.elements.find(e=>e.name===caption)?.x).toBe(moved.x);
      await page.reload();
      await openLibraryDocument(page,id);
      expect(await layer(page)).toEqual(moved);
      expect((await exportPNG(page)).image.data).toEqual(png);
    });
  });
}

test.describe('Android companion controls',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

  test('group moves as a sibling block and layer icons show both flags and inherited restrictions',async({page})=>{
    await seed(page,{group:true});
    await select(page,'Группа');
    await tool(page,'position');
    await arrange(page,'front').tap();
    expect((await order(page)).slice(-2)).toEqual(['Группа А','Группа Б']);
    await settings(page,'align').tap();
    await arrange(page,'aleft').tap();
    const doc=await exportedDocument(page);
    expect(doc.elements.filter(e=>e.name.startsWith('Группа ')).map(e=>e.x)).toEqual([0,70]);
    await layers(page);
    const parent=row(page,'Группа'),member=row(page,'Группа А');
    const control=(row,key)=>row.locator(`[data-layeract=${key}]`);
    await expect(parent).toHaveClass(/selected/);
    const icon=button=>button.locator('path').getAttribute('d');
    const contrast=async button=>button.evaluate(el=>{
      function light(rgb){
        const values=rgb.match(/\d+/g).slice(0,3).map(n=>Number(n)/255)
          .map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
        return values[0]*.2126+values[1]*.7152+values[2]*.0722;
      }
      const s=getComputedStyle(el),a=light(s.color),b=light(s.backgroundColor);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
    const eye=control(parent,'visibility'),lock=control(parent,'lock');
    expect(await contrast(eye)).toBeGreaterThan(4.5);
    expect(await contrast(control(member,'lock'))).toBeGreaterThan(4.5);
    const openLock=await icon(lock),visibleEye=await icon(eye);
    await eye.tap();
    await expect(eye).toHaveAttribute('aria-pressed','false');
    expect(await icon(eye)).not.toBe(visibleEye);
    await expect(control(member,'visibility')).toBeDisabled();
    await lock.tap();
    await expect(lock).toHaveAttribute('aria-pressed','true');
    expect(await icon(lock)).not.toBe(openLock);
    await expect(control(member,'lock')).toBeDisabled();
    await expect(control(member,'lock')).toHaveAccessibleName('Заблокировано родительской группой');
    expect(await contrast(control(member,'lock'))).toBeGreaterThan(4.5);
  });

  test('effect opens settings on one tap and reopening plus Back leaves history and paint independent',async({page})=>{
    await seed(page);
    const before=await layer(page);
    await tool(page,'effects');
    const effect=properties(page).locator('[data-mp-effect=dropShadow]');
    await effect.tap();
    const panel=properties(page).getByRole('dialog',{name:'Падающая тень'});
    await expect(panel).toBeVisible();
    await expect(properties(page).locator('.mp-effect-grid')).toHaveCount(0);
    const radius=panel.locator('[data-mp-effect-key=radius][type=number]');
    const defaultRadius=Number(await radius.inputValue());
    await radius.fill('23');
    await radius.press('Enter');
    const configured=await layer(page);
    expect(configured.effects.at(-1).radius).toBe(23);
    await history(page,'undo');
    await expect(radius).toHaveValue(String(defaultRadius));
    await history(page,'redo');
    await expect(radius).toHaveValue('23');
    await action(page,'back').tap();
    await expect(effect).toHaveAttribute('aria-pressed','true');
    await effect.tap();
    await expect(radius).toHaveValue('23');
    expect(await layer(page)).toEqual(configured);
    await panel.locator('[data-unified-color]').tap();
    await expect(page.locator('#fillPopover')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#fillPopover')).toBeHidden();
    await expect(panel).toBeVisible();
    await panel.locator('[data-mp-fx-pick]').tap();
    await expect(properties(page).getByRole('dialog',{name:'Цвет эффекта'})).toBeVisible();
    await page.goBack();
    await expect(panel).toBeVisible();
    await action(page,'done').tap();
    await expect(panel).toBeHidden();
    expect(configured.stroke).toBe(before.stroke);
    expect(configured.strokeWidth).toBe(before.strokeWidth);
    expect(configured.fill).toBe(before.fill);
  });
});

test.use({hasTouch:true,isMobile:true});
test('landscape keeps compact color and both effect levels available after changing orientation',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await seed(page);
  await tool(page,'effects');
  await properties(page).locator('[data-mp-effect=dropShadow]').tap();
  await page.setViewportSize({width:844,height:390});
  await expect(properties(page).getByRole('dialog',{name:'Падающая тень'})).toBeVisible();
  await action(page,'back').tap();
  await expect(properties(page).locator('[data-mp-effect=textGlitch]')).toBeVisible();
  await tool(page,'color');
  await expect(properties(page).locator('.mp-color-pill')).toBeVisible();
});
