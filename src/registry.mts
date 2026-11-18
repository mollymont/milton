export interface OptimizationRule {
  id: string;
  category: 'tool-output' | 'project-instructions';
  inefficiency: string;
  detectionCriteria: string;
  requiredEvidence: readonly string[];
  action: string;
  cadence: 'one-time' | 'situational' | 'persistent';
  claudeCodeVersions: string;
  confidence: 'high' | 'medium';
  limitations: string;
  documentation: string;
  proposedChange?: { target: string; strategy: 'remove-exact-duplicate' | 'relocate-to-scoped-rule' };
}

export const REGISTRY_VERSION = 2;

export const SHELL_THRESHOLDS = {
  multilineCharacters: 8_000,
  minimumLines: 100,
  longOutputCharacters: 16_000,
} as const;

export const shellOutputRule = {
  id: 'oversized-shell-output',
  category: 'tool-output',
  inefficiency: 'Verbose shell output can add avoidable material to subsequent model requests.',
  detectionCriteria: 'A successful textual Bash result reaches 8,000 characters and 100 lines, or 16,000 characters.',
  requiredEvidence: ['Bash tool-use ID', 'Visible stdout character count', 'Line threshold for multiline results'],
  action: 'Large shell output. Next time, scope the command or use its quiet reporter. Keep warnings, failures, and stack traces visible, and retain the full log locally if needed. Task-level savings are unverified.',
  cadence: 'situational',
  claudeCodeVersions: 'Classic Bash PostToolUse payload on the hooks plugin. Native mods require 2.1.287+.',
  confidence: 'medium',
  limitations: 'The hook may receive a preview. Volume is a signal and some large output is necessary.',
  documentation: 'https://claude.com/resources/articles/maximizing-the-value-of-your-claude-code-sessions',
} as const satisfies OptimizationRule;

export const duplicateInstructionRule = {
  id: 'duplicate-claude-md-bullet',
  category: 'project-instructions',
  inefficiency: 'An immediately repeated instruction occupies context twice.',
  detectionCriteria: 'Adjacent identical plain bullets within one project instruction file, or exact repeated bullet text across files with the same recognized scope.',
  requiredEvidence: ['Exact matching bullet text', 'Same recognized scope or unambiguous top-level list boundary'],
  action: 'Review removing the repeated bullet. Keep the first copy so Claude still receives the instruction.',
  cadence: 'persistent',
  claudeCodeVersions: 'Any Claude Code version that loads the root CLAUDE.md. The standalone audit requires no Claude Code installation.',
  confidence: 'high',
  limitations: 'Cross-file matches are review-only because file ordering can matter. Effective instruction loading and task-level savings are unverified.',
  documentation: 'https://code.claude.com/docs/en/memory#when-to-add-to-claudemd',
  proposedChange: { target: 'CLAUDE.md', strategy: 'remove-exact-duplicate' },
} as const satisfies OptimizationRule;


export const overlappingReadRule = {
  id: 'overlapping-file-reads',
  category: 'tool-output',
  inefficiency: 'Rereading unchanged file ranges adds repeated text to context.',
  detectionCriteria: 'Consecutive textual Read results of one file share at least 80 identical lines and 80% of the newer range.',
  requiredEvidence: ['Matching file and total line count', 'Exact content match in overlapping ranges', 'Distinct tool-use IDs'],
  action: 'Most of the latest file read was already in context. Reuse the earlier excerpt or request only the missing lines. Reread when the file changes or the earlier context is unavailable.',
  cadence: 'situational',
  claudeCodeVersions: 'Native mods 2.1.287+ with structured Read results.',
  confidence: 'medium',
  limitations: 'Skips content-free deduplication results and truncated reads. A repeat can still be intentional.',
  documentation: 'https://claude.com/resources/articles/maximizing-the-value-of-your-claude-code-sessions',
} as const satisfies OptimizationRule;

export const failedCommandRule = {
  id: 'repeated-failed-command',
  category: 'tool-output',
  inefficiency: 'Unchanged retries can repeat deterministic errors and consume extra turns.',
  detectionCriteria: 'Three consecutive Bash failures share the same command, working directory, and error with a recognized configuration or invocation diagnostic.',
  requiredEvidence: ['Three distinct tool-use IDs', 'Exact command and error match', 'No intervening observed tool result'],
  action: 'The same command failed three times with the same diagnostic. Inspect the first error, fix the invocation or prerequisite, then retry once. Keep the original failure details.',
  cadence: 'situational',
  claudeCodeVersions: 'Native mods 2.1.287+ with Bash PostToolUseFailure events.',
  confidence: 'medium',
  limitations: 'Changes outside the observed tool sequence are invisible. Transient-looking and unknown errors are excluded.',
  documentation: 'https://code.claude.com/docs/en/hooks#posttoolusefailure-input',
} as const satisfies OptimizationRule;

export const scopedInstructionRule = {
  id: 'scope-explicit-directory-guidance',
  category: 'project-instructions',
  inefficiency: 'Directory-specific guidance in an always-loaded file occupies context on unrelated tasks.',
  detectionCriteria: 'A standalone plain bullet explicitly limited to files under an existing project directory.',
  requiredEvidence: ['Explicit scope in the text', 'Existing directory inside the project', 'Unoccupied destination rule path'],
  action: 'Review moving this directory-specific instruction to a path-scoped rule. Check that tasks which need it touch a matching file before relying on the rule.',
  cadence: 'persistent',
  claudeCodeVersions: 'Claude Code versions supporting paths frontmatter in project rules.',
  confidence: 'medium',
  limitations: 'Path-scoped guidance loads on matching file access and can be unavailable during early planning.',
  documentation: 'https://code.claude.com/docs/en/memory#path-specific-rules',
  proposedChange: { target: '.claude/rules/', strategy: 'relocate-to-scoped-rule' },
} as const satisfies OptimizationRule;

export const optimizationRegistry = [
  shellOutputRule, duplicateInstructionRule, overlappingReadRule, failedCommandRule, scopedInstructionRule,
] as const;
