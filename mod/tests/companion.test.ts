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
  await ui.press({ key: 'optimizer-details' });
  await ui.press({ key: 'optimizer-session-snooze' });
  expect([...preferences.values()]).toEqual(['next-session']);
  await fire('session-b', 'tool-b');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeDefined();

  await fire('session-a', 'tool-c');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeUndefined();
  await ui.press({ key: 'optimizer-enable' });
  await fire('session-a', 'tool-d');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeDefined();
  await ui.press({ key: 'optimizer-details' });
  await ui.press({ key: 'optimizer-suppress' });
  await fire('session-c', 'tool-e');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeUndefined();
  expect([...preferences.values()]).toContainEqual({ suppressed: true });
  await ui.unmount();
});

for (const enabled of [false, true]) {
  test(`diagnostics ${enabled ? 'emit only allowlisted metadata' : 'are off by default'}`, async ($, on) => {
    const records: string[] = [];
    const sentinel = 'PRIVATE_ALPHA_SENTINEL';
    on('env.get', ($, event) => ({ value: event.name === 'MILTON_DIAGNOSTICS' && enabled ? '1' : undefined }));
    on('ui.log', ($, event) => {
      records.push(event.text);
      return { value: undefined };
    });
    on('classic.PostToolUse', () => ({}));
    on('store.get', () => ({ value: undefined }));
    on('store.set', () => ({ deny: sentinel }));

    const ui = await $.ui.mount(band);
    const event = {
      hook_event_name: 'PostToolUse', session_id: 'private-session-id',
      transcript_path: '/private/fixture.jsonl', cwd: '/private/fixture',
      tool_name: 'Bash', tool_input: { command: sentinel },
      tool_use_id: 'private-tool-id', tool_response: { stdout: sentinel.repeat(2_000), stderr: '' },
    } as const;
    expect(await $.classic.PostToolUse(event)).toEqual({});
    await ui.press({ key: 'optimizer-snooze' });

    if (enabled) {
      expect(records).toHaveLength(3);
      const decoded = records.map(line => JSON.parse(line.replace(/^Milton diagnostic /, '')));
      expect(decoded.map(record => record.event)).toEqual(['PostToolUse', 'ui.render', 'feedback']);
      expect(decoded.map(record => record.outcome)).toEqual(['queued', 'tree-built', 'snoozed']);
      expect(decoded.map(record => record.error)).toEqual([null, null, 'preference-write-failed']);
      expect(decoded.map(record => record.detector)).toEqual(['oversized-shell-output', 'oversized-shell-output', 'oversized-shell-output']);
      expect(decoded[0].recommendationId).toBe(decoded[2].recommendationId);
      expect(decoded.every(record => Number.isFinite(record.durationMs) && record.durationMs >= 0)).toBe(true);
      expect(records.join('\n').includes(sentinel)).toBe(false);
      expect(records.join('\n').includes('private-')).toBe(false);
    } else {
      expect(records).toHaveLength(0);
    }
    await ui.unmount();
  });
}

test('the compact tip expands on demand and dismissal survives resume until expiry', async ($, on) => {
  const preferences = new Map<string, unknown>();
  on('store.get', ($, event) => ({ value: preferences.get(event.key) }));
  on('store.set', ($, event) => {
    preferences.set(event.key, event.value);
    return { value: undefined };
  });
  on('classic.PostToolUse', () => ({}));
  on('session.end', () => ({}));
  const ui = await $.ui.mount(band);
  const fire = (id: string, session = 'resume-fixture') => $.classic.PostToolUse({
    hook_event_name: 'PostToolUse', session_id: session,
    transcript_path: '/work/transcript.jsonl', cwd: '/work',
    tool_name: 'Bash', tool_input: { command: 'fixture' },
    tool_use_id: id, tool_response: { stdout: 'x'.repeat(16_000), stderr: '' },
  });

  await fire('first');
  expect(await ui.find({ type: 'Text', text: /quieter or narrower command/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /stack traces/ })).toBeUndefined();
  await ui.press({ key: 'optimizer-details' });
  expect(await ui.find({ type: 'Text', text: /stack traces/ })).toBeDefined();
  await ui.press({ key: 'optimizer-details' });
  expect(await ui.find({ type: 'Text', text: /stack traces/ })).toBeUndefined();
  await ui.press({ key: 'optimizer-dismiss' });

  await fire('fresh', 'other-session');
  expect(await ui.find({ type: 'Text', text: /quieter or narrower command/ })).toBeDefined();
  await fire('resumed');
  expect(await ui.find({ type: 'Text', text: /quieter or narrower command/ })).toBeUndefined();
  preferences.set('dismissed:resume-fixture', { 'oversized-shell-output': 1 });
  await fire('switch', 'other-session');
  await fire('after-expiry');
  expect(await ui.find({ type: 'Text', text: /quieter or narrower command/ })).toBeDefined();
  await ui.unmount();
});

test('timed snooze is restored in another session and stops suppressing after expiry', async ($, on) => {
  const preferences = new Map<string, unknown>();
  on('store.get', ($, event) => ({ value: preferences.get(event.key) }));
  on('store.set', ($, event) => {
    preferences.set(event.key, event.value);
    return { value: undefined };
  });
  on('classic.PostToolUse', () => ({}));
  const ui = await $.ui.mount(band);
  const fire = (session: string) => $.classic.PostToolUse({
    hook_event_name: 'PostToolUse', session_id: session,
    transcript_path: '/work/transcript.jsonl', cwd: '/work',
    tool_name: 'Bash', tool_input: { command: 'fixture' },
    tool_use_id: `tool-${session}`, tool_response: { stdout: 'x'.repeat(16_000), stderr: '' },
  });
  await fire('initial');
  await ui.press({ key: 'optimizer-snooze' });
  await fire('during');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeUndefined();
  preferences.set('rule:oversized-shell-output', { until: 1 });
  await fire('expired');
  expect(await ui.find({ type: 'Text', text: /^Large shell output/ })).toBeDefined();
  await ui.unmount();
});
