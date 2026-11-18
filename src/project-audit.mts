import { lstat, opendir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { auditInstructions, readAuditFile, readPlainBullets } from './audit.mts';
import type { Recommendation } from './recommendation.mts';
import { duplicateInstructionRule, REGISTRY_VERSION, scopedInstructionRule } from './registry.mts';

const RULE_DIRECTORY = '.claude/rules';
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;
const EXPLICIT_SCOPE = /^[-*+] For files under ((?:[A-Za-z0-9_-]+\/)+), \S/i;
type Finding = { recommendation: Recommendation; location: string; preview?: string };

// Recognize an uncomplicated paths list or scalar. Unknown YAML is partial coverage.
function ruleScope(frontmatter: string[]): string | undefined {
  if (!frontmatter.length) return '';
  const [first, ...rest] = frontmatter;
  const header = /^paths:\s*(.*)$/.exec(first);
  if (!header || (header[1] && rest.length)) return;
  const patterns = header[1] ? header[1].split(',') :
    rest.map(line => /^ {1,4}- (.+)$/.exec(line)?.[1] ?? '');
  const clean = patterns.map(pattern => pattern.trim().replace(/^(['"])(.*)\1$/, '$2'));
  if (!clean.length || clean.some(pattern => !/^[A-Za-z0-9_.*/?-]+$/.test(pattern))) return;
  return [...new Set(clean)].sort().join(',');
}

export async function auditProjectInstructions(directory: string, includePreview = false) {
  const files: string[] = [];
  const findings: Finding[] = [];
  let skipped = 0;
  const root = await realpath(directory).catch(() => undefined);
  if (!root) return { files, findings, skipped: 1 };

  const paths = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];
  let entriesLeft = 256;
  async function discover(relative: string, depth: number) {
    const path = join(root!, relative);
    try {
      if (await realpath(path) !== path) { skipped++; return; }
      for await (const entry of await opendir(path)) {
        if (entriesLeft-- <= 0) { skipped++; break; }
        if (!SAFE_NAME.test(entry.name) || entry.isSymbolicLink()) { skipped++; continue; }
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory() && depth < 4) await discover(child, depth + 1);
        else if (entry.isDirectory()) skipped++;
        else if (entry.isFile() && entry.name.endsWith('.md')) paths.push(child);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skipped++;
    }
  }
  await discover(RULE_DIRECTORY, 0);

  const seen = new Map<string, string>();
  let scopeFound = false;
  for (const relative of paths.sort()) {
    const source = await readAuditFile(join(root, relative));
    if (source.status !== 'read') {
      if (source.status === 'unsupported') skipped++;
      continue;
    }
    const parsed = readPlainBullets(source.text);
    const isRule = relative.startsWith(RULE_DIRECTORY + '/');
    const scope = parsed && (isRule ? ruleScope(parsed.frontmatter) : '');
    if (!parsed || scope === undefined) { skipped++; continue; }
    files.push(relative);
    const duplicate = auditInstructions(source.text, includePreview, relative);
    if (duplicate.status === 'recommendation') {
      findings.push({ ...duplicate, location: `${relative}:${duplicate.recommendation.evidence.duplicateLine}` });
    }

    for (const index of parsed.bullets) {
      const line = parsed.lines[index];
      const location = `${relative}:${index + 1}`;
      const key = `${relative === 'CLAUDE.local.md' ? 'local' : scope}\0${line.slice(2)}`;
      const prior = seen.get(key);
      if (prior && !prior.startsWith(relative + ':') && findings.length < 100) {
        findings.push({ location, recommendation: {
          id: `${duplicateInstructionRule.id}:${location}`, ruleId: duplicateInstructionRule.id,
          registryVersion: REGISTRY_VERSION, priority: 10, savings: 'unverified', evidence: {},
          message: `Review this exact instruction also found at ${prior}. Confirm both locations have the intended effect before consolidating.`,
        } });
      } else if (!prior) seen.set(key, location);

      if (scopeFound || isRule || relative === 'CLAUDE.local.md' || parsed.frontmatter.length ||
          (parsed.lines[index - 1] ?? '').trim() || (parsed.lines[index + 1] ?? '').trim()) continue;
      const match = EXPLICIT_SCOPE.exec(line);
      if (!match) continue;
      const pattern = match[1];
      const sourceDir = join(root, pattern.slice(0, -1));
      const destination = `${RULE_DIRECTORY}/optimizer-${pattern.slice(0, -1).replaceAll('/', '-')}.md`;
      try {
        if (await realpath(sourceDir) !== sourceDir || !(await lstat(sourceDir)).isDirectory()) continue;
        // Any existing target, including a broken link, blocks a new-file preview.
        let occupied = true;
        try { await lstat(join(root, destination)); } catch (error) {
          occupied = (error as NodeJS.ErrnoException).code !== 'ENOENT';
        }
        if (occupied) continue;
        let unsafeParent = false;
        for (const parent of ['.claude', RULE_DIRECTORY]) {
          const path = join(root, parent);
          const info = await lstat(path).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
          if (info && (!info.isDirectory() || await realpath(path) !== path)) unsafeParent = true;
        }
        if (unsafeParent) continue;
      } catch { continue; }

      scopeFound = true;
      const finding: Finding = { location, recommendation: {
        id: `${scopedInstructionRule.id}:${location}`, ruleId: scopedInstructionRule.id,
        registryVersion: REGISTRY_VERSION, priority: 10, savings: 'unverified',
        message: scopedInstructionRule.action, evidence: { movedLines: 1 },
      } };
      if (includePreview) {
        finding.preview = [
          `--- a/${relative}`, `+++ b/${relative}`, `@@ -${index + 1},1 +${index},0 @@`,
          `-${parsed.raw[index]}`,
          ...(index === parsed.raw.length - 1 ? ['\\ No newline at end of file'] : []),
          '--- /dev/null', `+++ b/${destination}`, '@@ -0,0 +1,5 @@',
          '+---', '+paths:', `+  - "${pattern}**/*"`, '+---', `+${line}`, '',
        ].join('\n');
      }
      findings.push(finding);
    }
  }
  return { files, findings, skipped };
}
