import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const workflow = read('.github/workflows/deploy-netlify.yml');
// Extract the literal Bash blocks so tests execute the actual workflow commands.
const blocks = [...workflow.matchAll(/^        run: \|\n((?:          .*\n|\n)+)/gm)]
  .map(match => match[1].replace(/^          /gm, ''));

for (const [context, expected] of [
  ['production', 0], ['deploy-preview', 1], ['branch-deploy', 1],
  [undefined, 1], ['', 1], ['unknown', 1],
]) {
  test(`Netlify ignore: ${context === undefined ? 'missing CONTEXT' : JSON.stringify(context)} → ${expected}`, () => {
    const env = { ...process.env };
    delete env.CONTEXT;
    if (context !== undefined) env.CONTEXT = context;
    const result = spawnSync(process.execPath, ['scripts/netlify-ignore.cjs'], { cwd: root, env });
    assert.equal(result.error, undefined);
    assert.equal(result.status, expected, result.stderr.toString());
  });
}

test('Netlify runs the ignore script without changing build or publish targets', () => {
  const config = read('netlify.toml');
  assert.match(config, /^  ignore = "node \.\/scripts\/netlify-ignore\.cjs"$/m);
  assert.match(config, /^  command = "npm run build:netlify"$/m);
  assert.match(config, /^  publish = "dist\/netlify"$/m);
});

test('release workflow is dispatch-only, has no token permissions or application build', () => {
  const events = workflow.match(/^on:\n((?:[ \t].*\n|\n)*)/m)?.[1];
  assert.equal(events?.trim(), 'workflow_dispatch:');
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.doesNotMatch(workflow, /^[ \t]+(?:- )?(?:uses:|permissions:)|\bnpm\b|\bnpx\b/m);
  assert.match(workflow, /NETLIFY_BUILD_HOOK_URL: \$\{\{ secrets\.NETLIFY_BUILD_HOOK_URL \}\}/);
  assert.equal(blocks.length, 2);
});

test('release refuses non-main refs before requesting a deploy', () => {
  for (const ref of ['refs/heads/feature', 'refs/tags/main', 'refs/pull/28/merge', '']) {
    const result = spawnSync('bash', ['-e', '-c', blocks[0]], {
      env: { ...process.env, GITHUB_REF: ref }, encoding: 'utf8',
    });
    assert.equal(result.status, 1, ref);
    assert.match(result.stdout, /must be requested from main/);
  }
  const result = spawnSync('bash', ['-e', '-c', blocks[0]], {
    env: { ...process.env, GITHUB_REF: 'refs/heads/main' },
  });
  assert.equal(result.status, 0);
});

test('hook request: one POST, missing secret, HTTP/transport errors, no secret in logs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'netlify-hook-test-'));
  // curl is replaced entirely; no network request or production deploy is possible.
  const hook = 'test-only-private-hook-value';
  try {
    writeFileSync(join(directory, 'curl'), '#!/bin/bash\nprintf "%s\\n" "$@" >> "$HOOK_TEST_ARGS"\nprintf "%s" "$HOOK_TEST_HTTP"\necho "$NETLIFY_BUILD_HOOK_URL" >&2\nexit "$HOOK_TEST_EXIT"\n', { mode: 0o755 });
    for (const [secret, http, exit, expected] of [
      ['', '200', '0', 1], [hook, '200', '0', 0], [hook, '202', '0', 0],
      [hook, '302', '0', 1], [hook, '400', '0', 1], [hook, '500', '0', 1],
      [hook, '000', '28', 1],
    ]) {
      const argsFile = join(directory, 'args');
      writeFileSync(argsFile, '');
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', blocks[1]], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`,
          NETLIFY_BUILD_HOOK_URL: secret, HOOK_TEST_ARGS: argsFile,
          HOOK_TEST_HTTP: http, HOOK_TEST_EXIT: exit },
      });
      assert.equal(result.status, expected, `${http}/${exit}: ${result.stdout}${result.stderr}`);
      assert.ok(!(result.stdout + result.stderr).includes(hook), 'Hook is never logged');
      const args = readFileSync(argsFile, 'utf8');
      if (!secret) {
        assert.equal(args, '', 'No curl call without secret');
        assert.match(result.stdout, /Set the NETLIFY_BUILD_HOOK_URL Actions secret/);
      } else {
        assert.equal(args.split('\n').filter(x => x === hook).length, 1, 'Exactly one curl invocation');
        assert.match(args, /--request\nPOST\n/);
        assert.doesNotMatch(args, /--retry|--location/);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
