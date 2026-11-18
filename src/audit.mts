import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { Recommendation } from './recommendation.mts';
import { duplicateInstructionRule, REGISTRY_VERSION } from './registry.mts';

const TARGET = duplicateInstructionRule.proposedChange.target;
const MAX_BYTES = 128 * 1024;
// Plain, top-level bullets only. Excluding markup keeps the preview literal.
export const PLAIN_BULLET = /^[-*+] [A-Za-z0-9][A-Za-z0-9 .,;:!?()/'_-]{0,239}$/;

type AuditResult =
  | { status: 'missing' | 'unsupported' | 'no-finding' }
  | { status: 'recommendation'; recommendation: Recommendation; preview?: string };

export function readPlainBullets(text: string) {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\r(?!\n)|</m.test(text)) {
    return;
  }
  const raw = text.split('\n');
  const lines = raw.map(line => line.replace(/\r$/, ''));
  let index = 0;
  let frontmatter: string[] = [];
  if (lines[0].replace(/^\uFEFF/, '') === '---') {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)$/.test(line));
    if (end === -1) return;
    frontmatter = lines.slice(1, end);
    index = end + 1;
  }

  const bullets: number[] = [];
  let fence: string | undefined;
  for (; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1].startsWith(fence) && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (!fence && PLAIN_BULLET.test(line)) bullets.push(index);

  }
  return { raw, lines, bullets, frontmatter };
}

export function auditInstructions(text: string, includePreview = false, target: string = TARGET): AuditResult {
  const parsed = readPlainBullets(text);
  if (!parsed) return { status: 'unsupported' };
  const { raw, lines, bullets } = parsed;
  for (const index of bullets) {
    if (lines[index + 1] !== lines[index]) continue;
    const previous = lines[index - 1] ?? '';
    if (previous.trim() && !/^#{1,6} /.test(previous) && !PLAIN_BULLET.test(previous)) continue;
    let after = index + 2;
    while (after < lines.length && !lines[after].trim()) after++;
    if (after < lines.length && !/^#{1,6} /.test(lines[after]) &&
        !PLAIN_BULLET.test(lines[after])) continue;

    const recommendation: Recommendation = {
      id: duplicateInstructionRule.id,
      ruleId: duplicateInstructionRule.id,
      registryVersion: REGISTRY_VERSION,
      savings: 'unverified',
      priority: 10,
      message: duplicateInstructionRule.action,
      evidence: { retainedLine: index + 1, duplicateLine: index + 2, addedInstructionLines: 0 },
    };
    if (!includePreview) return { status: 'recommendation', recommendation };

    const number = index + 1;
    const noFinalNewline = index + 1 === raw.length - 1;
    const preview = [
      `--- a/${target}`,
      `+++ b/${target}`,
      `@@ -${number},2 +${number},1 @@`,
      ` ${raw[index]}`,
      `-${raw[index + 1]}`,
      ...(noFinalNewline ? ['\\ No newline at end of file'] : []),
    ].join('\n') + '\n';
    return { status: 'recommendation', recommendation, preview };
  }
  return { status: 'no-finding' };
}

export async function readAuditFile(path: string): Promise<{ status: 'missing' | 'unsupported' } | { status: 'read'; text: string }> {
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK) return { status: 'unsupported' };

  try {
    if (await realpath(path) !== path) return { status: 'unsupported' };
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_BYTES) return { status: 'unsupported' };
      const data = Buffer.alloc(MAX_BYTES + 1);
      let size = 0;
      while (size < data.length) {
        const { bytesRead } = await file.read(data, size, data.length - size, size);
        if (bytesRead === 0) break;
        size += bytesRead;
      }
      if (size > MAX_BYTES) return { status: 'unsupported' };
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data.subarray(0, size));
      return { status: 'read', text };
    } finally {
      await file.close();
    }
  } catch (error) {
    return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unsupported' };
  }
}

export async function auditProject(directory: string, includePreview = false): Promise<AuditResult> {
  const root = await realpath(directory).catch(() => undefined);
  if (!root) return { status: 'missing' };
  const source = await readAuditFile(join(root, TARGET));
  return source.status === 'read' ? auditInstructions(source.text, includePreview) : source;
}
