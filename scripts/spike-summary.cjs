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
 '', 'Native editing is checked separately in the original pre-wrap/break-spaces modes; the metric CSS candidate is measured by the matrix only. Full Gate 0 also requires empty-line/affinity/IME validation.',
 '',
].join('\n');
const metricEntries=entries.filter(e=>e.comparison);
const metricMarkdown=metricEntries.length?[
 '### Metric line-height candidate (original break-spaces → candidate)', '',
 '| Browser | Lines | Matching glyph ΔX/ΔY | Matching glyph caret ΔX/ΔY | Empty probes: missing / inaccurate | Gate 0B |',
 '| --- | --- | --- | --- | --- | --- |',
 ...metricEntries.map(e=>{
  const fmt=(m,caret=false)=>`${m[caret?'maxCaretDx':'maxDx'].toFixed(3)}/${m[caret?'maxCaretDy':'maxDy'].toFixed(3)}`;
  const [a,b]=e.comparison;
  return `| ${e.browser} | ${a.lineMatches}/${a.total} → ${b.lineMatches}/${b.total} | ${fmt(a.matching)} → ${fmt(b.matching)} | ${fmt(a.matching,true)} → ${fmt(b.matching,true)} | ${a.missingEmptyRects}/${a.inaccurateEmptyRects} → ${b.missingEmptyRects}/${b.inaccurateEmptyRects} (of ${b.emptyProbes}) | ${e.gate0BPassed?'PASS':'FAIL'} |`;
 }), '',
 'Glyph/caret maxima exclude cases with differing line boundaries. Empty probes include both DOM affinities independently; absent rects are not zero error.', '',
].join('\n'):'';
console.log(markdown+metricMarkdown);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown+metricMarkdown);
fs.writeFileSync('test-results/spike-gates.json',JSON.stringify({executionPassed,gate0APassed:overall,browsers:entries},null,2)+'\n');
if(!executionPassed)process.exitCode=1;
