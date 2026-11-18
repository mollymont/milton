import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditInstructions, auditProject } from '../src/audit.mts';
import { optimizationRegistry, REGISTRY_VERSION } from '../src/registry.mts';

const bullet = '- Run the unit tests before submitting changes.';

test('registry IDs are unique and recommendations link to their definition version', () => {
  assert.equal(new Set(optimizationRegistry.map(rule => rule.id)).size, optimizationRegistry.length);
  const result = auditInstructions(`${bullet}\n${bullet}\n`);
  assert.equal(result.recommendation.registryVersion, REGISTRY_VERSION);
  assert.equal(result.recommendation.savings, 'unverified');
  assert.equal(result.recommendation.evidence.addedInstructionLines, 0);
  assert.equal(result.preview, undefined);
});

test('audit keeps an existing instruction and only proposes exact adjacent duplicates', () => {
  for (const text of [
    `${bullet}\n`,
    `# Build\n${bullet}\n# Tests\n${bullet}\n`,
    `${bullet}\n${bullet.toUpperCase()}\n`,
    `~~~md\n${bullet}\n${bullet}\n~~~\n`,
    `\uFEFF---\n${bullet}\n${bullet}\n---\n`,
    `${bullet}\n${bullet}\n  Keep the logs.\n`,
  ]) assert.equal(auditInstructions(text, true).status, 'no-finding');
  assert.equal(auditInstructions(`<!--\n${bullet}\n${bullet}\n-->\n`, true).status, 'unsupported');
});

test('explicit preview removes one duplicate and preserves CRLF and EOF markers', () => {
  const result = auditInstructions(`# Checks\r\n${bullet}\r\n${bullet}`, true);
  assert.deepEqual(result.recommendation.evidence, { retainedLine: 2, duplicateLine: 3, addedInstructionLines: 0 });
  assert.equal(result.preview, [
    '--- a/CLAUDE.md', '+++ b/CLAUDE.md', '@@ -2,2 +2,1 @@',
    ` ${bullet}\r`, `-${bullet}`, '\\ No newline at end of file', '',
  ].join('\n'));
});

test('audit CLI is read-only, hides source by default, and rejects unsafe file types', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'optimizer-audit-'));
  const path = join(directory, 'CLAUDE.md');
  const script = fileURLToPath(new URL('../scripts/audit.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, directory, ...args], { encoding: 'utf8' });
  try {
    assert.equal((await auditProject(directory)).status, 'missing');
    const source = Buffer.from(`# Checks\n${bullet}\n${bullet}\n`);
    await writeFile(path, source);
    const summary = run();
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /savings: unverified/);
    assert.ok(!summary.stdout.includes(bullet));
    const preview = run('--preview');
    assert.equal(preview.status, 0, preview.stderr);
    assert.ok(preview.stdout.includes(`-${bullet}`));
    assert.deepEqual(await readFile(path), source);
    assert.equal(run('--apply').status, 2);
    assert.deepEqual(await readFile(path), source);

    await writeFile(path, Buffer.alloc(128 * 1024 + 1));
    assert.equal((await auditProject(directory)).status, 'unsupported');
    await writeFile(path, Buffer.from([0xff]));
    assert.equal((await auditProject(directory)).status, 'unsupported');
    await rm(path);
    await writeFile(join(directory, 'other.md'), source);
    await symlink('other.md', path);
    assert.equal((await auditProject(directory, true)).status, 'unsupported');
    assert.deepEqual(await readFile(join(directory, 'other.md')), source);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('project audit compares like scopes and previews a relocation without touching either path', async () => {
  const { mkdir, readdir } = await import('node:fs/promises');
  const { auditProjectInstructions } = await import('../src/project-audit.mts');
  const directory = await mkdtemp(join(tmpdir(), 'optimizer-project-audit-'));
  const target = '.claude/rules/optimizer-src-api.md';
  const instruction = '- For files under src/api/, use the API error format.';
  try {
    await mkdir(join(directory, '.claude/rules/nested'), { recursive: true });
    await mkdir(join(directory, 'src/api'), { recursive: true });
    await writeFile(join(directory, 'CLAUDE.md'), `# Guidance\n\n${instruction}\n\n# Checks\n${bullet}\n`);
    await writeFile(join(directory, '.claude/CLAUDE.md'), `${bullet}\n`);
    await writeFile(join(directory, '.claude/rules/one.md'), `---\npaths:\n  - "src/api/**/*"\n---\n${bullet}\n`);
    await writeFile(join(directory, '.claude/rules/nested/two.md'), `---\npaths: src/api/**/*\n---\n${bullet}\n`);
    await writeFile(join(directory, '.claude/rules/nested/other.md'), `---\npaths: src/ui/**/*\n---\n${bullet}\n`);
    const original = await readFile(join(directory, 'CLAUDE.md'));
    const result = await auditProjectInstructions(directory, true);
    assert.equal(result.files.length, 5);
    assert.equal(result.findings.filter(finding => /also found/.test(finding.recommendation.message)).length, 2);
    const move = result.findings.find(finding => finding.recommendation.ruleId === 'scope-explicit-directory-guidance');
    assert.ok(move.preview.includes(`-${instruction}`));
    assert.ok(move.preview.includes(`+${instruction}`));
    assert.ok(move.preview.includes(`+++ b/${target}`));
    assert.match(move.preview, /src\/api\/\*\*\/\*/);
    assert.deepEqual(await readFile(join(directory, 'CLAUDE.md')), original);
    assert.ok(!(await readdir(join(directory, '.claude/rules'))).includes('optimizer-src-api.md'));
    await symlink('missing.md', join(directory, target));
    const occupied = await auditProjectInstructions(directory, true);
    assert.ok(!occupied.findings.some(finding => finding.recommendation.ruleId === 'scope-explicit-directory-guidance'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
