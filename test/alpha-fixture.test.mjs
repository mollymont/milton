import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditProjectInstructions } from '../src/project-audit.mts';
import { detectShellOutput } from '../src/shell-output.mts';
import { createToolSequence } from '../src/tool-sequence.mts';

const fixtureUrl = new URL('../fixtures/alpha/', import.meta.url);
const cwd = fileURLToPath(fixtureUrl);
const run = script => spawnSync('sh', [script], { cwd, encoding: 'utf8', timeout: 2_000 });

test('alpha Bash fixtures produce bounded verbose output and a stable nonzero error', () => {
  const result = run('./oversized.sh');
  assert.equal(result.status, 0);
  assert.ok(result.stdout.length >= 16_000 && result.stdout.length < 24_000);
  assert.equal(detectShellOutput({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'alpha-output',
    tool_response: { stdout: result.stdout, stderr: result.stderr },
  })?.ruleId, 'oversized-shell-output');

  const sequence = createToolSequence();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const failure = run('./fail.sh');
    assert.equal(failure.status, 2);
    assert.equal(failure.stdout, '');
    const tip = sequence.observe({
      hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: `alpha-fail-${attempt}`,
      cwd, tool_input: { command: 'sh ./fail.sh' }, error: `Exit code 2\n${failure.stderr}`,
    });
    assert.equal(tip?.ruleId, attempt === 3 ? 'repeated-failed-command' : undefined);
  }
});

test('alpha Read ranges overlap and fixture audit produces both previews', async () => {
  const file = new URL('src/settings.ts', fixtureUrl);
  const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
  const sequence = createToolSequence();
  function read(start) {
    return sequence.observe({
      hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: `alpha-read-${start}`,
      tool_response: { type: 'text', file: {
        filePath: fileURLToPath(file), startLine: start, numLines: 100, totalLines: lines.length,
        content: lines.slice(start - 1, start + 99).join('\n'),
      } },
    });
  }
  assert.equal(read(1), undefined);
  assert.equal(read(21)?.evidence.overlappingLines, 80);

  const audit = await auditProjectInstructions(cwd, true);
  assert.deepEqual(audit.findings.map(finding => finding.recommendation.ruleId), [
    'duplicate-claude-md-bullet', 'scope-explicit-directory-guidance',
  ]);
  assert.ok(audit.findings.every(finding => finding.preview));
});
