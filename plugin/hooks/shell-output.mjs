import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCoordinator } from './shared/coordinator.mts';
import { detectShellOutput } from './shared/shell-output.mts';

async function readEvent() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 512 * 1024) return;
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function recommend(event) {
  const candidate = detectShellOutput(event);
  if (!candidate) return;

  const { session_id: sessionId } = event;
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir || typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return;

  const directory = join(dataDir, 'recommendations');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stateFile = join(directory, `session-${sessionId}.json`);
  const lock = stateFile + '.lock';
  // Parallel Bash completions can race. A busy lock means this tip can be skipped.
  await mkdir(lock, { mode: 0o700 });
  try {
    const stored = await readFile(stateFile, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '{"seen":[],"blockedUntil":{}}';
    });
    const history = JSON.parse(stored);
    const coordinator = createCoordinator(history);
    const show = coordinator.offer(candidate, Date.now());
    await writeFile(stateFile, JSON.stringify(history), { mode: 0o600 });
    if (show) process.stdout.write(JSON.stringify({ systemMessage: candidate.message }));
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

try {
  await recommend(await readEvent());
} catch {
  // Malformed input, unavailable state, and lock contention leave Bash alone.
}
