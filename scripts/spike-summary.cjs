// A successful diagnostic runner is deliberately distinct from passing a gate.
const fs=require('node:fs');
const report=JSON.parse(fs.readFileSync('test-results/spike-results.json','utf8'));
const entries=[],nativeEntries=[],controlledEntries=[],historyEntries=[];
function walk(suite){
 for(const spec of suite.specs||[])for(const test of spec.tests||[])for(const result of test.results||[]){
  for(const a of result.attachments||[]){
  if(a.name==='controlled-history.json'){
   const history=JSON.parse(a.body?Buffer.from(a.body,'base64').toString():fs.readFileSync(a.path,'utf8'));
   historyEntries.push({...history,browser:test.projectName,version:history.browser,status:result.status});
  }
  if(a.name==='controlled-enter.json'){
   const controlled=JSON.parse(a.body?Buffer.from(a.body,'base64').toString():fs.readFileSync(a.path,'utf8'));
   controlledEntries.push({...controlled,browser:test.projectName,version:controlled.browser,status:result.status});
  }
  if(a.name==='native-caret.json'){
   const native=JSON.parse(a.body?Buffer.from(a.body,'base64').toString():fs.readFileSync(a.path,'utf8'));
   nativeEntries.push({...native,browser:test.projectName,version:native.browser,status:result.status});
  }
  if(a.name==='gate.json'){
   const gate=JSON.parse(a.body?Buffer.from(a.body,'base64').toString():fs.readFileSync(a.path,'utf8'));
   entries.push({browser:test.projectName,status:result.status,...gate});
  }
  }
 }
 for(const child of suite.suites||[])walk(child);
}
for(const suite of report.suites||[])walk(suite);
if(historyEntries.length!==2||!['chromium-spike','firefox-spike'].every(browser=>historyEntries.some(e=>e.browser===browser&&e.status==='passed'&&e.passed)))throw Error('Expected passing Chromium and Firefox controlled-history measurements; diagnostics incomplete');
if(controlledEntries.length!==2)throw Error('Expected Chromium and Firefox controlled-enter measurements; diagnostics incomplete');
if(nativeEntries.length!==2)throw Error('Expected Chromium and Firefox native-caret measurements; diagnostics incomplete');
if(entries.length!==2)throw Error('Expected Chromium and Firefox gate measurements; diagnostics incomplete');
const executionPassed=report.stats.unexpected===0&&report.stats.skipped===0&&report.stats.expected===36;
const overall=executionPassed&&entries.every(e=>e.gate0APassed);
const markdown=[
 '### Plaintext-only diagnostic execution and gate verdict',
 '',`Diagnostic tests: **${executionPassed?'PASS':'FAIL / INCOMPLETE'}** (${report.stats.expected} passed; ${report.stats.unexpected} unexpected; ${report.stats.skipped} skipped).`,
 '', '| Browser | Line boundary Gate 0A | Full geometry Gate 0 | Remaining line cases |',
 '| --- | --- | --- | --- |',
 ...entries.map(e=>`| ${e.browser} | ${e.gate0APassed?'PASS':'FAIL'} | ${e.gatePassed?'PASS':'FAIL'} | ${(e.mismatches||[]).map(m=>m.name).join(', ')||'none'} |`),
 '',`Combined Gate 0A: **${overall?'PASS':'FAIL'}**. Passing the diagnostic command does not approve WYSIWYG integration.`,
 '', 'Native editing is checked separately in the original pre-wrap/break-spaces modes; the metric CSS matrix remains separate; terminal-BR native diagnostics are attached as native-caret.json. Full Gate 0 also requires empty-line/affinity/IME validation.',
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
const nativeMarkdown=[
 '### Terminal BR native candidate (limited Gate 0B/2)', '',
 '| Browser | Exact input, offsets and glyph geometry | Soft-wrap | Gate 0B/2 |',
 '| --- | --- | --- | --- |',
 ...nativeEntries.map(e=>`| ${e.browser} | ${e.results.filter(r=>r.passed).length}/${e.results.length} | ${e.softWrap.passed?'PASS':'FAIL'} | ${e.gate0B2Passed?'PASS (limited smoke)':'FAIL'} |`), '',
 'This limited result does not override strict Gate 0A/0B. Chromium insertLineBreak is pinned as a canonical-text blocker, not a passing save contract.', '',
].join('\n');
const controlledMarkdown=[
 '### Controlled Enter candidate (limited Gate 0B/3)', '',
 '| Browser | Canonical text / UTF-16 / styles | Editor history |',
 '| --- | --- | --- |',
 ...controlledEntries.map(e=>`| ${e.browser} | ${e.status==='passed'&&e.passed?'PASS (limited smoke)':'FAIL'} | Disabled in this diagnostic |`), '',
 'Controlled Enter uses replaceText once; native Enter diagnostics above remain unchanged. Strict Gate 0A/0B and production integration are not approved. IME/unsupported input requires a preserving textarea fallback. The separate opt-in session-history result follows.', '',
].join('\n');
const historyMarkdown=[
 '### Controlled session history (limited Gate 0B/4)', '',
 '| Browser | Mixed native input / Enter / Undo / Redo / UTF-16 / textRuns |',
 '| --- | --- |',
 ...historyEntries.map(e=>`| ${e.browser} | ${e.status==='passed'&&e.passed?'PASS (limited smoke)':'FAIL'} |`), '',
 'Opt-in spike uses existing inline history; fallback blocks Undo on unconfirmed DOM. Strict Gate 0A/0B remain unchanged; production integration is not approved.', '',
].join('\n');
console.log(markdown+metricMarkdown+nativeMarkdown+controlledMarkdown+historyMarkdown);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown+metricMarkdown+nativeMarkdown+controlledMarkdown+historyMarkdown);
fs.writeFileSync('test-results/spike-gates.json',JSON.stringify({executionPassed,gate0APassed:overall,browsers:entries,native:nativeEntries,controlled:controlledEntries,history:historyEntries},null,2)+'\n');
if(!executionPassed)process.exitCode=1;
