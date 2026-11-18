import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COOLDOWN_MS, SNOOZE_MS, createCoordinator } from '../src/coordinator.mts';
import { transition } from '../src/lifecycle.mts';
import { detectShellOutput } from '../src/shell-output.mts';

function shellEvent(stdout, id = 'tool-1', extra = {}) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: 'fixture-session',
    tool_use_id: id,
    tool_name: 'Bash',
    tool_input: { command: 'PRIVATE_COMMAND' },
    tool_response: { stdout, ...extra },
  };
}

test('detector requires 8,000 characters and 100 lines, or 16,000 characters', () => {
  const lines = 'x'.repeat(79).concat('\n').repeat(100);
  assert.equal(detectShellOutput(shellEvent(lines.slice(1))), undefined);
  assert.equal(detectShellOutput(shellEvent('x\n'.repeat(98) + 'x'.repeat(8_000))), undefined);
  assert.equal(detectShellOutput(shellEvent('x'.repeat(15_999))), undefined);
  assert.equal(detectShellOutput(shellEvent(lines)).evidence.stdoutCharacters, 8_000);
  assert.equal(detectShellOutput(shellEvent('x'.repeat(16_000))).evidence.stdoutCharacters, 16_000);
});

test('detector ignores missing fields, mismatched events, diagnostics, and non-text results', () => {
  const output = 'x'.repeat(16_000);
  const event = shellEvent(output);
  for (const ignored of [
    undefined, null, [], {}, { ...event, tool_name: 'Read' },
    { ...event, hook_event_name: 'PostToolUseFailure' }, { ...event, tool_use_id: '../bad' },
    { ...event, tool_response: output }, shellEvent(123),
    shellEvent(output, 'tool-1', { stderr: 'error' }),
    shellEvent(output, 'tool-1', { interrupted: true }),
    shellEvent(output, 'tool-1', { isImage: true }),
    shellEvent(output, 'tool-1', { backgroundTaskId: 'task' }),
  ]) assert.equal(detectShellOutput(ignored), undefined);
});

test('recommendation contains derived evidence and explicitly preserves diagnostics', () => {
  const tip = detectShellOutput(shellEvent('PRIVATE_OUTPUT'.repeat(2_000)));
  assert.equal(tip.ruleId, 'oversized-shell-output');
  assert.match(tip.message, /scope the command or use its quiet reporter/);
  assert.match(tip.message, /warnings, failures, and stack traces/);
  assert.match(tip.message, /retain the full log locally/);
  assert.doesNotMatch(JSON.stringify(tip), /PRIVATE_/);
});

test('coordinator prioritizes a single tip and deduplicates across dismiss and cooldown', () => {
  const coordinator = createCoordinator();
  const low = { id: 'a', ruleId: 'low', priority: 1, message: 'low', evidence: {} };
  const high = { ...low, id: 'b', ruleId: 'high', priority: 2 };
  assert.equal(coordinator.offer(low, 1), true);
  assert.equal(coordinator.offer(high, 2), true);
  assert.equal(coordinator.active, high);
  assert.equal(coordinator.offer({ ...low, id: 'lower', ruleId: 'lower' }, 3), false);
  assert.equal(coordinator.feedback(low.id, 'dismiss', 4), false);
  assert.equal(coordinator.feedback(high.id, 'dismiss', 4), true);
  assert.equal(coordinator.active, undefined);
  assert.equal(coordinator.offer({ ...high, id: 'c' }, 4 + COOLDOWN_MS - 1), false);
  assert.equal(coordinator.offer(high, 4 + COOLDOWN_MS), false);
  assert.equal(coordinator.offer({ ...high, id: 'd' }, 4 + COOLDOWN_MS), true);
});

test('snooze suppresses fresh events for 30 minutes and requires a fresh occurrence', () => {
  const coordinator = createCoordinator();
  const tip = detectShellOutput(shellEvent('x'.repeat(16_000)));
  coordinator.offer(tip, 1);
  assert.equal(coordinator.feedback(tip.id, 'snooze', 2), true);
  const duringSnooze = { ...tip, id: 'during-snooze' };
  assert.equal(coordinator.offer(duringSnooze, 2 + SNOOZE_MS - 1), false);
  assert.equal(coordinator.offer(duringSnooze, 2 + SNOOZE_MS), false);
  assert.equal(coordinator.offer({ ...tip, id: 'fresh' }, 2 + SNOOZE_MS), true);
});

test('fallback hook emits one user message and persists only cooldown and deduplication data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'optimizer-hook-'));
  const root = fileURLToPath(new URL('../plugin', import.meta.url));
  const config = JSON.parse(readFileSync(join(root, 'hooks/hooks.json')));
  const [hook] = config.hooks.PostToolUse[0].hooks;
  assert.equal(config.hooks.PostToolUse[0].matcher, 'Bash');

  function run(input, dataDir = directory) {
    const result = spawnSync(hook.command, {
      shell: true,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: dataDir },
      input,
      encoding: 'utf8',
      timeout: 2000,
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.equal(result.stderr, '');
    return result.stdout;
  }

  try {
    const output = 'PRIVATE_OUTPUT'.repeat(2_000);
    const input = JSON.stringify(shellEvent(output));
    for (const malformed of ['', '{', 'null', '{}', 'x'.repeat(513 * 1024)]) {
      assert.equal(run(malformed), '');
    }
    assert.equal(run(input, ''), '');
    assert.equal(run(JSON.stringify({ ...shellEvent(output), session_id: '../unsafe' })), '');
    assert.deepEqual(JSON.parse(run(input)), { systemMessage: detectShellOutput(shellEvent(output)).message });
    assert.equal(run(input), '');
    assert.equal(run(JSON.stringify(shellEvent(output, 'another-tool'))), '');
    const saved = readFileSync(join(directory, 'recommendations/session-fixture-session.json'), 'utf8');
    assert.doesNotMatch(saved, /PRIVATE_|Large shell output/);
    assert.equal(typeof JSON.parse(saved).blockedUntil['oversized-shell-output'], 'number');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('timed and next-session snoozes and per-rule suppression stay scoped', () => {
  const coordinator = createCoordinator();
  const tip = detectShellOutput(shellEvent('x'.repeat(16_000)));
  coordinator.snoozeSession(2000);
  assert.equal(coordinator.offer(tip, 1999), false);
  assert.equal(coordinator.offer(tip, 2000), false);
  const fresh = { ...tip, id: 'fresh-session-tip' };
  assert.equal(coordinator.offer(fresh, 2000), true);
  assert.equal(coordinator.feedback(fresh.id, 'snooze', 2001, 'next-session'), true);
  assert.equal(coordinator.latest.status, 'snoozed');
  assert.equal(coordinator.offer({ ...tip, id: 'later' }, 2001 + SNOOZE_MS), false);
  const nextSession = createCoordinator();
  assert.equal(nextSession.offer(tip, 2001 + SNOOZE_MS), true);
  nextSession.suppressRule(tip.ruleId);
  assert.equal(nextSession.active, undefined);
  assert.equal(nextSession.offer({ ...tip, id: 'different-tip' }, 2001 + 2 * SNOOZE_MS), false);
});

test('applying a recommendation requires a prior accepted state', () => {
  const recommendation = detectShellOutput(shellEvent('x'.repeat(16_000)));
  const created = { recommendation, status: 'new' };
  const shown = transition(created, { status: 'shown' });
  assert.equal(transition(shown, { status: 'applied' }), undefined);
  const accepted = transition(shown, { status: 'accepted' });
  assert.equal(transition(accepted, { status: 'applied' }).status, 'applied');
  assert.equal(transition(shown, { status: 'superseded' }).status, 'superseded');
});

test('displayed recommendations expire and a distinct event can show a new tip', () => {
  const coordinator = createCoordinator();
  const tip = detectShellOutput(shellEvent('x'.repeat(16_000)));
  assert.equal(coordinator.offer(tip, 1), true);
  coordinator.expire(COOLDOWN_MS + 1);
  assert.equal(coordinator.active, undefined);
  assert.equal(coordinator.latest.status, 'expired');
  assert.equal(coordinator.offer({ ...tip, id: 'fresh' }, COOLDOWN_MS + 1), true);
});
