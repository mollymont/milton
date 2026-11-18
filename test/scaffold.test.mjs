import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('configured startup hook emits only fixed user-facing JSON', () => {
  const root = fileURLToPath(new URL('../plugin', import.meta.url));
  const config = JSON.parse(readFileSync(new URL('../plugin/hooks/hooks.json', import.meta.url)));
  const [entry] = config.hooks.SessionStart;
  assert.equal(entry.matcher, 'startup');
  const [hook] = entry.hooks;
  const result = spawnSync(hook.command, {
    shell: true,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'synthetic' }),
    encoding: 'utf8',
    timeout: 2000,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    systemMessage: 'Efficiency companion · ready',
  });
});

test('configured mod renders one line and yields to surveys', async () => {
  const configUrl = new URL('../mod/hooks/hooks.json', import.meta.url);
  const config = JSON.parse(readFileSync(configUrl));
  const { register } = await import(new URL(config.modules[0], configUrl));
  const registrations = new Map();
  register((name, ...args) => {
    registrations.set(name, args);
    return { catch() {} };
  });
  const [matcher, render] = registrations.get('ui.render');
  assert.deepEqual(matcher, { component: 'AbovePrompt' });
  const host = { ui: { resolve: () => ({ Text: props => props }) } };
  assert.equal(render(host, { props: {} }).children, 'Efficiency companion · ready');
  const survey = { props: { hasSurvey: true } };
  assert.equal(render({}, survey, event => event), survey);
});
