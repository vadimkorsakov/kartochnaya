const {test,expect,openHome,importPayload,records,openLibraryDocument,canvasPoint}=require('./helpers');
const fixture=require('./fixtures/canvas-graph.json');
const surface='#inlineWysiwyg';

// Exercise the shipped bundle with a deterministic fresh document.
async function seed(page,patch={},url='/',docPatch={}){
 await page.setViewportSize({width:1600,height:1100});
 await openHome(page,url);const payload=structuredClone(fixture);payload.documents=[payload.documents[0]];
 const doc=Object.assign(payload.documents[0],docPatch);doc.groups=[];doc.background=docPatch.background||'#ffffff';doc.palette=['#ff0000','#000000'];doc.elements=doc.elements.filter(e=>e.id==='title');
 Object.assign(doc.elements[0],{text:'ABCD',x:20,y:40,w:280,h:170,fontFamily:'Arial',fontSize:24,lineHeight:1.2,letterSpacing:0,textColor:'#111111',autoFontSize:false,rotation:0,textAlign:'left',verticalAlign:'top',...patch});
 await importPayload(page,payload);await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const stored=(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title'));await openLibraryDocument(page,stored.id);
 for(let i=0;i<60;i++){const z=parseInt(await page.locator('#zoomLabel').textContent());if(z===100)break;await page.locator(z>100?'#zoomOutBtn':'#zoomInBtn').click()}
 await expect(page.locator('#zoomLabel')).toHaveText('100%');return stored.elements[0];
}
async function edit(page,live=true){
 await page.locator('#layers [data-layer="title"] .layer-name').click();const p=await canvasPoint(page,55,57);await page.mouse.dblclick(p.x,p.y);
 await expect(page.locator(live?surface:'#inlineText')).toBeFocused();await expect(page.locator(live?'#inlineText':surface)).toBeHidden();
}
async function model(page){return page.evaluate(async()=>{
 const click=HTMLAnchorElement.prototype.click;let url;
 HTMLAnchorElement.prototype.click=function(...args){if(this.download?.endsWith('.json'))url=this.href;else return click.apply(this,args)};
 try{document.querySelector('#jsonExportBtn').click();return (await (await fetch(url)).json()).document.elements.find(e=>e.id==='title')}finally{HTMLAnchorElement.prototype.click=click}
})}
async function selection(page){return page.locator(surface).evaluate(host=>{
 const s=getSelection(),offset=(n,i)=>{const r=document.createRange();r.setStart(host,0);r.setEnd(n,i);return r.toString().length};
 return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset)};
})}
async function select(page,anchor,focus){
 await page.locator(surface).focus();await page.keyboard.press('Control+Home');const text=await page.locator(surface).textContent();
 const count=i=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text.slice(0,i))].length;
 for(let i=0;i<count(anchor);i++)await page.keyboard.press('ArrowRight');
 for(let i=0;i<Math.abs(count(anchor)-count(focus));i++)await page.keyboard.press(focus<anchor?'Shift+ArrowLeft':'Shift+ArrowRight');
 expect(await selection(page)).toEqual({anchor,focus});
}
async function zoom(page,value){await page.locator('#zoomLabel').click();await page.locator('#zoomInput').fill(String(value));await page.locator('#zoomInput').press('Enter');await expect(page.locator('#zoomLabel')).toHaveText(value+'%')}
module.exports={seed,edit,model,selection,select,zoom};
