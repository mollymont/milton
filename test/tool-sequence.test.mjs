import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToolSequence } from '../src/tool-sequence.mts';

const lines = Array.from({ length: 300 }, (_, i) => `export const setting${i} = ${i};`);
const read = (id, start, count = 100) => ({
  hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: id,
  tool_response: { type: 'text', file: {
    filePath: '/project/src/settings.ts', startLine: start, totalLines: lines.length,
    numLines: count, content: lines.slice(start - 1, start - 1 + count).join('\n'),
  } },
});
const failure = (id, override = {}) => ({
  hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: id,
  cwd: '/project', tool_input: { command: 'npm run test:unit' },
  error: 'Exit code 1\nnpm error Missing script: "test:unit"', ...override,
});

test('overlapping reads require substantial unchanged returned text', () => {
  const sequence = createToolSequence();
  assert.equal(sequence.observe(read('first', 1)), undefined);
  const tip = sequence.observe(read('second', 21));
  assert.equal(tip.ruleId, 'overlapping-file-reads');
  assert.deepEqual(tip.evidence, { overlappingLines: 80, returnedLines: 100 });
  assert.doesNotMatch(JSON.stringify(tip), /settings\.ts|export const/);

  for (const later of [
    read('second', 22),
    { ...read('second', 21), tool_response: { type: 'file_unchanged' } },
    { ...read('second', 21), tool_response: {
      ...read('second', 21).tool_response,
      file: { ...read('second', 21).tool_response.file, content: read('second', 21).tool_response.file.content.replace('setting20', 'changed') },
    } },
  ]) {
    sequence.reset();
    sequence.observe(read('first', 1));
    assert.equal(sequence.observe(later), undefined);
  }
  sequence.reset();
  sequence.observe(read('first', 1));
  sequence.observe({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'edit' });
  assert.equal(sequence.observe(read('second', 21)), undefined);
});

test('command retries require three distinct matching stable failures and reset on changes', () => {
  const sequence = createToolSequence();
  assert.equal(sequence.observe(failure('first')), undefined);
  assert.equal(sequence.observe(failure('first')), undefined);
  assert.equal(sequence.observe(failure('second')), undefined);
  const tip = sequence.observe(failure('third'));
  assert.equal(tip.ruleId, 'repeated-failed-command');
  assert.doesNotMatch(JSON.stringify(tip), /test:unit/);

  for (const intervening of [
    failure('second', { cwd: '/other' }),
    failure('second', { tool_input: { command: 'npm test' } }),
    failure('second', { error: 'Exit code 1\nnetwork error' }),
    failure('second', { is_interrupt: true }),
    read('second', 21),
  ]) {
    sequence.reset();
    sequence.observe(failure('first'));
    sequence.observe(intervening);
    assert.equal(sequence.observe(failure('third')), undefined);
    assert.equal(sequence.observe(failure('fourth')), undefined);
  }
});
