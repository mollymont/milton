import { expect, test } from 'claude-code/testing';

const band = {
  plugin: 'efficiency-companion',
  component: 'AbovePrompt',
  surface: 'terminal',
  viewport: { columns: 100, rows: 30 },
  props: { bodyColumns: 100, hasSurvey: false },
} as const;

for (const action of ['dismiss', 'snooze']) {
  test(`the terminal band handles ${action}`, async ($, on) => {
    on('classic.PostToolUse', () => ({}));
    const ui = await $.ui.mount(band);
    const event = {
      hook_event_name: 'PostToolUse',
      session_id: 'test-session',
      transcript_path: '/work/transcript.jsonl',
      cwd: '/work',
      tool_name: 'Bash',
      tool_input: { command: 'synthetic test command' },
      tool_use_id: 'test-tool',
      tool_response: { stdout: 'x'.repeat(16_000), stderr: '' },
    } as const;

    await $.classic.PostToolUse(event);
    expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeDefined();
    await ui.press({ key: `optimizer-${action}` });
    expect(await ui.find({ type: 'Text', text: /companion · ready/ })).toBeDefined();
    await $.classic.PostToolUse({ ...event, tool_use_id: 'next-tool' });
    expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeUndefined();
    await ui.unmount();
  });
}

test('stored snoozes distinguish a resumed session from a fresh session', async ($, on) => {
  const preferences = new Map<string, unknown>();
  on('store.get', ($, event) => ({ value: preferences.get(event.key) }));
  on('store.set', ($, event) => {
    preferences.set(event.key, event.value);
    return { value: undefined };
  });
  on('classic.PostToolUse', () => ({}));
  on('session.end', () => ({}));

  const ui = await $.ui.mount(band);
  const fire = (sessionId: string, id: string) => $.classic.PostToolUse({
    hook_event_name: 'PostToolUse', session_id: sessionId,
    transcript_path: '/work/transcript.jsonl', cwd: '/work',
    tool_name: 'Bash', tool_input: { command: 'fixture' },
    tool_use_id: id, tool_response: { stdout: 'x'.repeat(16_000), stderr: '' },
  });
  await fire('session-a', 'tool-a');
  await ui.press({ key: 'optimizer-session-snooze' });
  expect([...preferences.values()]).toEqual(['next-session']);
  await fire('session-b', 'tool-b');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeDefined();

  await fire('session-a', 'tool-c');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeUndefined();
  await ui.press({ key: 'optimizer-enable' });
  await fire('session-a', 'tool-d');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeDefined();
  await ui.press({ key: 'optimizer-suppress' });
  await fire('session-c', 'tool-e');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeUndefined();
  expect([...preferences.values()]).toContainEqual({ suppressed: true });
  await ui.unmount();
});
