import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('Claude Code loads the plugin and runs SessionStart before model input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'optimizer-integration-'));
  const plugin = fileURLToPath(new URL('../plugin', import.meta.url));
  try {
    const result = spawnSync(process.env.CLAUDE_BIN || 'claude', [
      '-p', '--plugin-dir', plugin, '--setting-sources', '',
      '--output-format', 'stream-json', '--verbose',
    ], {
      cwd: directory,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: directory,
        DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      input: '',
      encoding: 'utf8',
      timeout: 10000,
    });
    if (result.error) throw result.error;

    // The CLI can exit with a missing-input error after the hook runs.
    const events = result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    const response = events.find(event =>
      event.subtype === 'hook_response' && event.hook_event === 'SessionStart',
    );
    assert.ok(response, 'Expected a SessionStart hook response from Claude Code');
    assert.equal(response.exit_code, 0);
    assert.deepEqual(JSON.parse(response.stdout), {
      systemMessage: 'Efficiency companion · ready',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
