const {expect,openHome,importPayload,records,openLibraryDocument,canvasPoint,exportPNG}=require('../helpers');
const fixture=require('../fixtures/visual-text.json');
const editor='#inlineText';
async function model(page){return page.evaluate(async()=>{
 let blob;const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;
 try{URL.createObjectURL=function(value){if(value.type==='application/json')blob=value;return create.call(this,value)};HTMLAnchorElement.prototype.click=function(){if(!this.download.endsWith('.json'))return click.call(this)};document.querySelector('#jsonExportBtn').click()}
 finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}
 return JSON.parse(await blob.text()).document.elements[0];
})}
async function setup(page,mobile=false){
 page.setDefaultTimeout(5000);
 await page.addInitScript(()=>{
  window.selectionEvents=[];window.textDraws=[];
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','blur','focus','selectionchange','select','click'])document.addEventListener(type,ev=>{
   const el=document.querySelector('#inlineText');if(!el)return;
   window.selectionEvents.push({type,target:ev.target.id||ev.target.dataset?.fontOption||ev.target.dataset?.mobile||ev.target.tagName,active:document.activeElement?.id,range:[el.selectionStart,el.selectionEnd],hidden:el.classList.contains('hidden')});
  },true);
  const proto=CanvasRenderingContext2D.prototype,fill=proto.fillText;proto.fillText=function(text,...args){if(this.canvas.id==='canvas')window.textDraws.push({text,font:this.font,color:this.fillStyle});return fill.call(this,text,...args)};
 });
 await openHome(page);const payload=structuredClone(fixture);
 Object.assign(payload.document.elements[0],{id:'interaction-text',name:'Interaction text',x:16,y:16,w:288,h:208,fontFamily:'Arial',fontSize:20,lineHeight:1.25,text:'Привет мир',textColor:'#000000',fill:'#000000',fillType:'solid',autoFontSize:false});
 payload.document.palette=['#ff0000','#000000'];
 await importPayload(page,payload);const doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');await openLibraryDocument(page,doc.id);
 const plain=(await exportPNG(page)).image.data;
 if(mobile){await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList .layer-name').filter({hasText:'Interaction text'}).tap();await page.locator('#mobileLayersClose').tap();await page.locator('#mobileContext [data-mobile=edit]').tap()}
 else{const p=await canvasPoint(page,60,40);await page.mouse.dblclick(p.x,p.y)}
 await expect(page.locator(editor)).toBeFocused();return plain;
}
async function selectWord(page){const b=await page.locator(editor).boundingBox();await page.mouse.dblclick(b.x+24,b.y+12);expect(await range(page)).toEqual([0,6])}
const range=page=>page.locator(editor).evaluate(el=>[el.selectionStart,el.selectionEnd]);
async function trace(page,info){await info.attach('selection-events.json',{body:JSON.stringify(await page.evaluate(()=>window.selectionEvents),null,2),contentType:'application/json'})}
module.exports={setup,model,selectWord,range,trace,editor};
