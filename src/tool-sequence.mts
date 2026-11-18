import type { Recommendation } from './recommendation.mts';
import { failedCommandRule, overlappingReadRule, REGISTRY_VERSION } from './registry.mts';

type Result = Record<string, unknown>;
type Read = { path: string; start: number; total: number; lines: string[] };
type Failure = { command: string; cwd: string; error: string; count: number };

function object(value: unknown): Result {
  return value && typeof value === 'object' ? value as Result : {};
}

function textRead(response: Result): Read | undefined {
  const { filePath, content, startLine, numLines, totalLines } = object(response.file);
  if (response.type !== 'text' || response.truncatedByTokenCap || object(response.file).truncatedByTokenCap ||
      typeof filePath !== 'string' || !filePath || typeof content !== 'string' || content.length > 64_000 ||
      typeof startLine !== 'number' || !Number.isSafeInteger(startLine) || startLine < 1 ||
      typeof totalLines !== 'number' || !Number.isSafeInteger(totalLines)) return;
  const lines = content.split('\n');
  if (lines.at(-1) === '' && lines.length !== numLines) lines.pop();
  if (lines.length !== numLines || startLine + lines.length - 1 > totalLines) return;
  return { path: filePath, start: startLine, total: totalLines, lines };
}

function durableFailure(event: Result): Omit<Failure, 'count'> | undefined {
  const { command } = object(event.tool_input);
  const { cwd, error } = event;
  if (event.is_interrupt || typeof command !== 'string' || !command || command.length > 2_000 ||
      typeof cwd !== 'string' || !cwd || typeof error !== 'string' || error.length > 8_000 ||
      !/^Exit code [1-9]\d*\b/i.test(error) ||
      /timed? ?out|econnreset|temporar|rate limit|network error/i.test(error) ||
      !/cannot find module|missing script:|command not found|unrecognized (?:option|argument)|unknown option/i.test(error)) return;
  return { command, cwd, error };
}

export function createToolSequence() {
  // These bounded comparisons are in memory only and reset between turns/sessions.
  let priorRead: Read | undefined;
  let priorFailure: Failure | undefined;
  const seen = new Set<string>();
  const reset = () => { priorRead = undefined; priorFailure = undefined; seen.clear(); };

  return {
    reset,
    observe(input: unknown): Recommendation | undefined {
      const event = object(input);
      const id = event.tool_use_id;
      if (event.hook_event_name !== 'PostToolUse' && event.hook_event_name !== 'PostToolUseFailure') return;
      if (event.agent_id || event.agent_type) { reset(); return; }
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) { reset(); return; }
      if (seen.has(id)) return;
      if (seen.size === 128) reset();
      seen.add(id);
      const read = event.tool_name === 'Read' && event.hook_event_name === 'PostToolUse'
        ? textRead(object(event.tool_response)) : undefined;
      const failure = event.tool_name === 'Bash' && event.hook_event_name === 'PostToolUseFailure'
        ? durableFailure(event) : undefined;
      const oldRead = priorRead;
      const oldFailure = priorFailure;
      priorRead = read;
      priorFailure = failure && {
        ...failure,
        count: oldFailure && failure.command === oldFailure.command &&
          failure.cwd === oldFailure.cwd && failure.error === oldFailure.error ? oldFailure.count + 1 : 1,
      };
      const common = { registryVersion: REGISTRY_VERSION, savings: 'unverified' as const };
      if (priorFailure?.count === 3) {
        const rule = failedCommandRule;
        return { ...common, id: `${rule.id}:${id}`, ruleId: rule.id, priority: 30,
          message: rule.action, evidence: { attempts: 3 } };
      }
      if (!read || !oldRead || read.path !== oldRead.path || read.total !== oldRead.total) return;
      const start = Math.max(read.start, oldRead.start);
      const end = Math.min(read.start + read.lines.length, oldRead.start + oldRead.lines.length);
      const overlap = end - start;
      if (overlap < 80 || overlap / read.lines.length < 0.8) return;
      for (let line = start; line < end; line++) {
        if (read.lines[line - read.start] !== oldRead.lines[line - oldRead.start]) return;
      }
      const rule = overlappingReadRule;
      return { ...common, id: `${rule.id}:${id}`, ruleId: rule.id, priority: 20,
        message: rule.action, evidence: { overlappingLines: overlap, returnedLines: read.lines.length } };
    },
  };
}
