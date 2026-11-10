// Read-only qualification of the bounded E/F experiment across both browsers.
const fs=require('node:fs');
const input=process.argv[2]||'test-results/justify-gate-results.json';
const output=process.argv[3]||'test-results/justify-css-summary.json';
const report=JSON.parse(fs.readFileSync(input,'utf8')),projects=new Map();
function visit(suite){
 for(const spec of suite.specs||[])for(const test of spec.tests||[]){
  const result=test.results.at(-1),project=projects.get(test.projectName)||{phases:[],pilots:[],tests:[]};
  project.tests.push({title:spec.title,status:result.status});
  for(const attachment of result.attachments||[]){
   if(!['css-candidates-measurements.json','css-candidates-tracking.json','single-space-pilot.json'].includes(attachment.name))continue;
   const bytes=attachment.body?Buffer.from(attachment.body,'base64'):fs.readFileSync(attachment.path);
   const value=JSON.parse(bytes);
   if(attachment.name==='single-space-pilot.json')project.pilots=value;
   else project.phases.push(value);
  }
  projects.set(test.projectName,project);
 }
 for(const child of suite.suites||[])visit(child);
}
for(const suite of report.suites)visit(suite);
const variants=['B-left-split','D-justify-space-fix','E-letter-spacing','F-explicit-width'];
const browsers=[...projects].map(([browser,project])=>{
 const groups=project.phases.flatMap(p=>p.results);
 const qualified=variants.filter(v=>/^[EF]-/.test(v)&&project.pilots.length===4&&project.pilots.find(p=>p.variant===v)?.clicks.every(p=>p.ok)&&project.phases.length===3&&project.phases.every(p=>p.winners.includes(v))&&project.tests.length===4&&project.tests.every(t=>t.status==='passed'));
 const rows=variants.map(variant=>{
  const results=groups.filter(r=>r.variant===variant),summaries=results.map(r=>r.summary),pilot=project.pilots.find(p=>p.variant===variant);
  const sum=key=>summaries.reduce((n,r)=>n+r[key],0),max=key=>Math.max(0,...summaries.map(r=>r[key]));
  return {variant,additionalVsB:max('additionalVsB'),nativeSpaceWidthError:max('maxSpaceWidthError'),localShapeDifference:max('maxLocalShapeDifference'),wordOriginDifference:max('maxWordOriginDifference'),
   clickErrors:sum('clickErrors')+(pilot?.clicks.filter(p=>!p.ok).length||0),clicks:sum('clicks')+(pilot?.clicks.length||0),dragErrors:sum('dragErrors'),drags:sum('drags'),inputErrors:sum('inputErrors'),inputCases:sum('inputCases'),navigationErrors:sum('navigationErrors'),navigationCases:sum('navigationCases'),
   sourceAndDOMPreserved:results.every(r=>r.sourcePreserved&&r.text===r.sourceText),selectedUTF16OffsetsExact:summaries.every(r=>r.utf16Preserved),runsPreserved:summaries.every(r=>r.runsPreserved),qualified:qualified.includes(variant),
   counterexamples:results.flatMap(r=>r.mouse.clicks.filter(p=>!p.ok&&p.start===6&&p.fraction===.4).map(p=>({rich:r.rich,tracking:r.tracking,...p}))),pilot};
 });
 return {browser,qualified,tests:project.tests,rows};
});
const expected=['gate-chromium','gate-firefox'];
const shared=variants.filter(v=>/^[EF]-/.test(v)&&expected.every(browser=>browsers.find(b=>b.browser===browser)?.qualified.includes(v)));
const verdict={sharedQualifiedCandidates:shared,browsers,localGeometryTolerance:2/60,productionEnabled:false};
fs.writeFileSync(output,JSON.stringify(verdict,null,2)+'\n');
const fmt=n=>n.toFixed(6);
const lines=['# Justify source-space CSS candidate qualification','',`Shared qualified candidates: ${shared.join(', ')||'NONE'}. Production WYSIWYG remains disabled.`,'',
 '| Browser | Candidate | Extra geometry vs B, px | Native space-width error, px | Click errors | Drag errors | Input errors | Exact target UTF-16 |',
 '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |'];
for(const b of browsers)for(const r of b.rows)lines.push(`| ${b.browser} | ${r.variant} | ${fmt(r.additionalVsB)} | ${fmt(r.nativeSpaceWidthError)} | ${r.clickErrors}/${r.clicks} | ${r.dragErrors}/${r.drags} | ${r.inputErrors}/${r.inputCases} | ${r.selectedUTF16OffsetsExact} |`);
lines.push('','The JSON includes measured native endpoints, pointer coordinates/distances and exact source offsets for the first-space pilot. B is a structural control; its existing shaping/midpoint mismatches are reported separately. Rejected candidates remain measured, without expected-failure or skip.');
fs.writeFileSync(output.replace(/\.json$/,'.md'),lines.join('\n')+'\n');
console.log('CSS_SHARED_VERDICT',JSON.stringify({shared,browsers:browsers.map(({browser,qualified,tests})=>({browser,qualified,tests}))}));
if(!shared.length)process.exitCode=1;
