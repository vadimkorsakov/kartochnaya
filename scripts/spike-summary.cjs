// A successful diagnostic runner is deliberately distinct from passing a gate.
const fs=require('node:fs');
const report=JSON.parse(fs.readFileSync('test-results/spike-results.json','utf8'));
const entries=[];
function walk(suite){
 for(const spec of suite.specs||[])for(const test of spec.tests||[])for(const result of test.results||[]){
  for(const a of result.attachments||[])if(a.name==='gate.json'){
   const gate=JSON.parse(a.body?Buffer.from(a.body,'base64').toString():fs.readFileSync(a.path,'utf8'));
   entries.push({browser:test.projectName,status:result.status,...gate});
  }
 }
 for(const child of suite.suites||[])walk(child);
}
for(const suite of report.suites||[])walk(suite);
if(entries.length!==2)throw Error('Expected Chromium and Firefox gate measurements; diagnostics incomplete');
const executionPassed=report.stats.unexpected===0&&report.stats.skipped===0&&report.stats.expected===30;
const overall=executionPassed&&entries.every(e=>e.gate0APassed);
const markdown=[
 '### Plaintext-only diagnostic execution and gate verdict',
 '',`Diagnostic tests: **${executionPassed?'PASS':'FAIL / INCOMPLETE'}** (${report.stats.expected} passed; ${report.stats.unexpected} unexpected; ${report.stats.skipped} skipped).`,
 '', '| Browser | Line boundary Gate 0A | Full geometry Gate 0 | Remaining line cases |',
 '| --- | --- | --- | --- |',
 ...entries.map(e=>`| ${e.browser} | ${e.gate0APassed?'PASS':'FAIL'} | ${e.gatePassed?'PASS':'FAIL'} | ${(e.mismatches||[]).map(m=>m.name).join(', ')||'none'} |`),
 '',`Combined Gate 0A: **${overall?'PASS':'FAIL'}**. Passing the diagnostic command does not approve WYSIWYG integration.`,
 '', 'Native editing is checked separately in both CSS modes; full Gate 0 also requires further empty-line/IME/geometry validation.',
 '',
].join('\n');
console.log(markdown);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown);
fs.writeFileSync('test-results/spike-gates.json',JSON.stringify({executionPassed,gate0APassed:overall,browsers:entries},null,2)+'\n');
if(!executionPassed)process.exitCode=1;
