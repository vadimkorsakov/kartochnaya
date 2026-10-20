// Playwright's default "passed" total includes expected failures. Keep them distinct.
class Summary {
  onBegin() { this.results = []; }
  onTestEnd(test, result) { this.results.push({ test, result }); }
  onEnd(run) {
    let passed = 0, expectedFailures = 0, skipped = 0, unexpected = 0;
    for (const { test, result } of this.results) {
      if (result.status === 'skipped') skipped++;
      else if (test.expectedStatus === 'failed' && result.status === 'failed') expectedFailures++;
      else if (test.expectedStatus === 'passed' && result.status === 'passed') passed++;
      else unexpected++;
    }
    console.log(`Baseline summary: ${passed} passed; ${expectedFailures} known failures reproduced; ${skipped} skipped; ${unexpected} unexpected. Run: ${run.status}.`);
  }
}
module.exports = Summary;
