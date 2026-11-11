const fs=require('node:fs');
const input=process.argv[2]||'test-results/justify-gate-results.json';
const output=process.argv[3]||'test-results/justify-pointer-summary.json';
const report=JSON.parse(fs.readFileSync(input,'utf8')),projects=new Map();
function walk(suite){
 for(const spec of suite.specs||[])for(const test of spec.tests||[]){
  const result=test.results.at(-1),p=projects.get(test.projectName)||{tests:[],matrix:[],gestures:[],cancellations:[],alignments:[],pilot:null,race:null};
  p.tests.push({title:spec.title,status:result.status});
  for(const attachment of result.attachments||[]){
   if(!attachment.name.startsWith('pointer-'))continue;
   const bytes=attachment.body?Buffer.from(attachment.body,'base64'):fs.readFileSync(attachment.path),v=JSON.parse(bytes);
   if(attachment.name==='pointer-pilot.json')p.pilot=v;
   if(attachment.name==='pointer-race.json')p.race=v;
   if(attachment.name==='pointer-matrix.json')p.matrix.push(...v.cases);
   if(attachment.name==='pointer-gestures.json')p.gestures.push(...v.cases);
   if(attachment.name==='pointer-cancellation.json')p.cancellations.push(...v.cases);
   if(attachment.name==='pointer-nonjustify.json')p.alignments.push(...v.cases);
  }
  projects.set(test.projectName,p);
 }
 for(const child of suite.suites||[])walk(child);
}
for(const suite of report.suites)walk(suite);
const browsers=[...projects].map(([browser,p])=>{
 const models=p.matrix.flatMap(c=>c.models),adapted=models.filter(r=>r.variant==='D+adapter');
 const rows=['B-left-split','D-justify-space-fix','D+adapter'].map(variant=>{
  const list=models.filter(r=>r.variant===variant).map(r=>r.summary),sum=k=>list.reduce((n,r)=>n+r[k],0),max=k=>Math.max(0,...list.map(r=>r[k]));
  return {variant,eligibleErrors:sum('eligibleErrors'),eligibleClicks:sum('eligibleClicks'),otherClicks:sum('otherClicks'),newOutsideErrors:sum('newOutsideErrors'),inputErrors:sum('inputErrors'),inputCases:sum('inputCases'),dragErrors:sum('dragErrors'),drags:sum('drags'),additionalVsB:max('additionalVsB'),spaceWidthError:max('spaceWidth'),localShapeDifference:max('localShape'),sourcePreserved:list.every(r=>r.sourcePreserved&&!r.modelHasDiagnosticFlags),
   zoom:[.6,1,1.5].map(zoom=>({zoom,eligibleErrors:list.filter(r=>r.zoom===zoom).reduce((n,r)=>n+r.eligibleErrors,0),inputErrors:list.filter(r=>r.zoom===zoom).reduce((n,r)=>n+r.inputErrors,0),dragErrors:list.filter(r=>r.zoom===zoom).reduce((n,r)=>n+r.dragErrors,0)}))};
 });
 const first=p.pilot?.find(r=>r.variant==='D+adapter');
 const complete=Array.isArray(p.pilot)&&p.pilot.length===2&&p.tests.length===7&&p.tests.every(t=>t.status==='passed')&&p.matrix.length===18&&adapted.length===18&&p.gestures.length===6&&p.cancellations.length===11&&p.alignments.length===3;
 const accepted=complete&&p.race?.ok===true&&first?.later.selection?.focus===6&&first?.afterInput.selection?.focus===7&&adapted.every(r=>r.summary.pass)&&p.gestures.every(c=>!c.errors.length)&&p.cancellations.every(c=>c.ok)&&p.alignments.every(c=>c.ok);
 const examples=adapted.flatMap(r=>r.clicks.points.filter(p=>p.start===6&&p.fraction===.4).map(p=>({rich:r.rich,tracking:r.tracking,zoom:r.zoom,...p})));
 return {browser,accepted,tests:p.tests,rows,pilot:p.pilot,firstSpaceExamples:examples,gestureErrors:p.gestures.filter(c=>c.errors.length).map(c=>({rich:c.rich,zoom:c.zoom,errors:c.errors})),cancellationErrors:p.cancellations.filter(c=>!c.ok),nonjustifyErrors:p.alignments.filter(c=>!c.ok),
  gestureCases:p.gestures.length,shiftCases:p.gestures.reduce((n,c)=>n+c.adapted.shifts.length,0),nativeDnDCases:p.gestures.filter(c=>c.adapted.dnd.events.some(e=>e.type==='dragstart')).length,copyCases:p.gestures.reduce((n,c)=>n+c.adapted.shifts.filter(s=>s.copy.writes.some(w=>w.type==='text/plain'&&w.data===s.wanted)).length,0),
  counterexamples:adapted.filter(r=>!r.summary.pass).map(r=>({summary:r.summary,clicks:r.clicks.points.filter(p=>p.reference.category==='eligible'&&!p.reference.ok),editing:r.editing.filter(p=>!p.ok),drags:r.drags.filter(p=>!p.ok)})),race:p.race,pilotStable:first?.later.selection?.focus===6&&first?.afterInput.selection?.focus===7};
});
const accepted=['gate-chromium','gate-firefox'].every(name=>browsers.find(b=>b.browser===name)?.accepted);
const value={accepted,subject:'D word-spacing plus eligible-U+0020 pointer adapter',productionEnabled:false,pixelTolerancesChanged:false,browsers};
fs.writeFileSync(output,JSON.stringify(value,null,2)+'\n');
const lines=['# Justify pointer adapter qualification','',`Both-browser acceptance: ${accepted}. Production justify remains disabled.`,'',
 '| Browser | Variant | Eligible errors | New outside errors vs D | Input errors | Drag errors | Extra geometry vs B, px |',
 '| --- | --- | ---: | ---: | ---: | ---: | ---: |'];
for(const b of browsers)for(const r of b.rows)lines.push(`| ${b.browser} | ${r.variant} | ${r.eligibleErrors}/${r.eligibleClicks} | ${r.variant==='D+adapter'?r.newOutsideErrors+'/'+r.otherClicks:'control'} | ${r.inputErrors}/${r.inputCases} | ${r.dragErrors}/${r.drags} | ${r.additionalVsB.toFixed(6)} |`);
lines.push('','The JSON preserves actual native event coordinates/order, source offsets, zoom results, cancellation and first-space traces. B/D are controls; only D+adapter has acceptance requirements. Previous CSS-only E/F results remain historical evidence and are not the qualifier.');
fs.writeFileSync(output.replace(/\.json$/,'.md'),lines.join('\n')+'\n');
console.log('POINTER_SHARED_VERDICT',JSON.stringify({accepted,browsers:browsers.map(b=>({browser:b.browser,accepted:b.accepted,tests:b.tests,gestureErrors:b.gestureErrors}))}));
if(!accepted)process.exitCode=1;
