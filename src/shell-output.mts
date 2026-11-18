import type { Recommendation } from './recommendation.mts';

import { REGISTRY_VERSION, SHELL_THRESHOLDS, shellOutputRule } from './registry.mts';

const {
  multilineCharacters: MIN_MULTILINE_CHARACTERS,
  minimumLines: MIN_LINES,
  longOutputCharacters: MIN_LONG_OUTPUT_CHARACTERS,
} = SHELL_THRESHOLDS;

export function detectShellOutput(event: unknown): Recommendation | undefined {
  if (!event || typeof event !== 'object') return;
  const { hook_event_name, tool_name, tool_use_id, tool_response } = event as Record<string, unknown>;
  if (hook_event_name !== 'PostToolUse' || tool_name !== 'Bash' ||
      typeof tool_use_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tool_use_id) ||
      !tool_response || typeof tool_response !== 'object') return;

  const { stdout, stderr, interrupted, isImage, backgroundTaskId } =
    tool_response as Record<string, unknown>;
  if (typeof stdout !== 'string' || stdout.length < MIN_MULTILINE_CHARACTERS ||
      (stderr !== undefined && stderr !== '') || interrupted || isImage || backgroundTaskId) return;

  if (stdout.length < MIN_LONG_OUTPUT_CHARACTERS) {
    let lines = 1;
    for (let index = 0; index < stdout.length - 1 && lines < MIN_LINES; index++) {
      if (stdout.charCodeAt(index) === 10) lines++;
    }
    if (lines < MIN_LINES) return;
  }

  return {
    id: `${shellOutputRule.id}:${tool_use_id}`,
    ruleId: shellOutputRule.id,
    registryVersion: REGISTRY_VERSION,
    savings: 'unverified',
    priority: 10,
    message: shellOutputRule.action,
    evidence: { stdoutCharacters: stdout.length },
  };
}
