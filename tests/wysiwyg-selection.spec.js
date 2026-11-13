const {test,expect}=require('./helpers');
const {seed,edit,selection,select,zoom}=require('./wysiwyg-fixture.cjs');
const {PNG}=require('pngjs');
const {applicationHTML}=require('./wysiwyg-profile.cjs');
test.use({serviceWorkers:'block'});
const host='#inlineWysiwyg';
const text='Команда проверяет цвет и оформление текста. Несколько строк помогают увидеть границы выделения.\nВторой абзац сохраняет исходные символы.';

for(const textAlign of ['left','center','right','justify'])for(const rich of [false,true])test(`live selection ${textAlign} rich=${rich}`,async({page},info)=>{
 await seed(page,{text,w:280,h:300,fontSize:22,textAlign,...(rich?{textRuns:[{start:0,end:7,style:{textColor:'#b02030'}},{start:18,end:22,style:{fontWeight:'700'}}]}:{})},'/',{height:360});
 await edit(page);
 // Entering edit creates an end caret, never a blanket selection.
 expect(await selection(page)).toEqual({anchor:text.length,focus:text.length});
 await zoom(page,80);await select(page,7,0);
 for(const key of ['underline','strikethrough'])await page.locator(`#inspector [data-text-decoration=${key}]`).click();
 expect(await selection(page)).toEqual({anchor:7,focus:0});
 await page.locator('#inspector [data-fill-open=fill]').click();
 const hex=page.locator('#fillPopover [data-cp-part="0"]');await hex.fill('#b02030');await hex.press('Tab');
 await page.locator('#fillPopover [data-fill-close]').click();await page.locator(host).focus();
 expect(await selection(page)).toEqual({anchor:7,focus:0});
 const style=await page.locator(`${host} [data-wysiwyg-fragment]`).first().evaluate(el=>({ink:getComputedStyle(el).color,selection:getComputedStyle(el,'::selection').color,bg:getComputedStyle(el,'::selection').backgroundColor}));
 expect(style.selection).toBe(style.ink);expect(style.bg).toBe('rgba(128, 98, 247, 0.2)');
 await info.attach('selected-word.png',{body:await page.screenshot(),contentType:'image/png'});
 // Read pixels at the actual projected underline/strike rectangles. A native
 // opaque blue highlight must not erase either live decoration while selected.
 const rects=await page.locator(host).evaluate(h=>{
  const box=h.getBoundingClientRect(),scale=box.width/parseFloat(h.style.width);
  return [...h.querySelectorAll('[data-wysiwyg-row]')].flatMap(row=>{
   const pos=row.style.backgroundPosition.split(', '),size=row.style.backgroundSize.split(', ');
   return pos.map((p,i)=>{const [x,y]=p.split(' ').map(parseFloat),[w,height]=size[i].split(' ').map(parseFloat);return {x:x*scale,y:(parseFloat(row.style.top)+y)*scale,w:w*scale,h:height*scale}});
  }).filter(r=>r.w>0);
 });
 expect(rects.length).toBeGreaterThanOrEqual(2);
 const png=PNG.sync.read(await page.locator(host).screenshot());
 for(const r of rects){let dark=0,total=0;for(let y=Math.max(0,Math.floor(r.y));y<Math.min(png.height,Math.ceil(r.y+r.h));y++)for(let x=Math.ceil(r.x+1);x<Math.min(png.width,Math.floor(r.x+r.w-1));x++){const i=(y*png.width+x)*4;if(png.data[i]<205&&png.data[i+1]<150&&png.data[i+2]<180)dark++;total++}expect(dark/total).toBeGreaterThan(.25)}
 await select(page,0,70);await info.attach('selected-multiline.png',{body:await page.screenshot(),contentType:'image/png'});
 expect(await selection(page)).toEqual({anchor:0,focus:70});
 await select(page,70,0);await page.keyboard.press('ArrowRight');expect(await selection(page)).toEqual({anchor:70,focus:70});
 await page.keyboard.type('X');await expect(page.locator(host)).toHaveText(text.slice(0,70)+'X'+text.slice(70));
});

test('native word selection and CSS canvas ink selection',async({page},info)=>{
 await seed(page,{text:'Команда проверяет цвета',fontSize:28,textRuns:[{start:0,end:7,style:{underline:true,strikethrough:true,fillOpacity:70}}]});await edit(page);await zoom(page,80);
 await expect(page.locator(host)).toHaveClass(/wysiwyg-canvas-ink/);
 const box=await page.locator(`${host} [data-wysiwyg-fragment]`).first().boundingBox();await page.mouse.dblclick(box.x+box.width*.4,box.y+box.height*.5);
 expect(await page.evaluate(()=>getSelection().toString())).toBe('Команда');
 const styles=await page.locator(`${host} [data-wysiwyg-fragment]`).first().evaluate(el=>({ink:getComputedStyle(el).color,selection:getComputedStyle(el,'::selection').color,bg:getComputedStyle(el,'::selection').backgroundColor}));
 expect(styles).toEqual({ink:'rgba(0, 0, 0, 0)',selection:'rgba(0, 0, 0, 0)',bg:'rgba(128, 98, 247, 0.2)'});
 await info.attach('selected-canvas-ink.png',{body:await page.screenshot(),contentType:'image/png'});
 await page.locator('#inspector [data-key=fontSize]').click();await page.locator(host).focus();expect(await page.evaluate(()=>getSelection().toString())).toBe('Команда');
 await page.keyboard.press('ArrowRight');await page.keyboard.type('X');await expect(page.locator(host)).toContainText('КомандаX');
});

for(const ref of ['pr147','current'])test(`selection evidence ${ref}`,async({page},info)=>{
 const html=await applicationHTML(ref);
 await page.route(/\/(?:index\.html)?(?:\?.*)?$/,route=>route.fulfill({body:html,contentType:'text/html'}));
 await seed(page,{text:'Команда видит подчёркивание и зачёркивание',w:280,h:210,fontSize:26,textRuns:[{start:0,end:7,style:{textColor:'#b02030',underline:true,strikethrough:true}}]});await edit(page);await select(page,7,0);
 await info.attach(ref==='pr147'?'before-selection.png':'after-selection.png',{body:await page.screenshot(),contentType:'image/png'});
});

for(const canvasInk of [false,true])test(`selection on a dark document canvasInk=${canvasInk}`,async({page},info)=>{
 await seed(page,{text:'Светлый текст виден при выделении',textColor:'#f4f1ff',fontSize:28,...(canvasInk?{fillOpacity:80}:{})},'/',{background:'#16121f'});await edit(page);await select(page,7,0);
 const selected=PNG.sync.read(await page.locator(host).screenshot());
 await info.attach('dark-selected.png',{body:await page.screenshot(),contentType:'image/png'});
 await page.keyboard.press('ArrowRight');const caret=PNG.sync.read(await page.locator(host).screenshot());
 let changed=0,brightSelected=0,brightCaret=0;
 for(let i=0;i<selected.data.length;i+=4){
  if([0,1,2].some(k=>Math.abs(selected.data[i+k]-caret.data[i+k])>10))changed++;
  if([0,1,2].every(k=>selected.data[i+k]>150))brightSelected++;
  if([0,1,2].every(k=>caret.data[i+k]>150))brightCaret++;
 }
 expect(changed).toBeGreaterThan(50);expect(brightSelected).toBeGreaterThan(brightCaret*.7);
});
