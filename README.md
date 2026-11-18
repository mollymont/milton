# Claude Optimizer

A local efficiency companion that helps Claude Code users spot avoidable usage before it interrupts their work. It should make the next useful action easy to see, whether that means narrowing a test run, supplying a smaller excerpt, or dealing with a nearly full context window.

## Phase 1 scaffold

- `plugin/` contains a standard Claude Code plugin with a single startup hook.
- `mod/` contains a separate native UI prototype that draws one quiet line above the prompt. It yields during surveys.
- `test/` contains dependency-free Node tests and a live CLI startup smoke test.

Run `npm test` for the hook and renderer tests. Run `npm run test:integration` with Claude Code on PATH, or set `CLAUDE_BIN` to a specific executable. The integration test uses an isolated temporary config and ends before any model prompt is submitted.

The scaffold uses plain JavaScript modules with no build step. Keep TypeScript for the shared engine once it has typed event contracts. Use Node 24 LTS as the development baseline for that phase. Decide on SQLite when persistent, concurrent reporting needs it.

### Manual terminal checks

Run each entry point separately to check its display.

```sh
claude plugin validate ./plugin
claude --plugin-dir ./plugin

claude --version
claude plugin validate ./mod
claude --plugin-dir ./mod
```

On a mod-capable CLI, verify the ready line above the prompt and check the active-mod list in `/plugin`. Confirm the line fits a narrow terminal and yields to surveys. Use `claude plugin test` to diagnose whether this CLI allows modules. [Anthropic's troubleshooting guide](https://code.claude.com/docs/en/plugins/mods/troubleshoot)

### Verified on this machine

- Claude Code 2.1.236 loaded the standard plugin and emitted a successful `SessionStart` hook response with the ready message over stream JSON. The CLI then exited because it received no prompt. Interactive display of the hook message still needs a terminal check.
- The standard plugin manifest passed validation with an optional author metadata warning.
- The mod renderer passed a stubbed host test. Claude Code 2.1.236 rejects the documented module-only hook configuration. The public terminal minimum is 2.1.287. Native loading and rendering still need a compatible binary. The sandbox could not resolve either the npm registry or Anthropic's download host, so a temporary upgrade was unavailable. [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview)

## Companion surfaces

| Surface | Role and tradeoff |
| --- | --- |
| Native mod | Preferred. A one-line band above the prompt stays in view with little screen space. Native panes and local slash commands can offer details and feedback later. Requires a recent supported CLI, workspace trust, and a policy that permits mods. Render handlers run in the client and should only display already-prepared state. [Mod examples and API walkthrough](https://claude.dev/blog/getting-started-with-claude-code-mods/) |
| Standard hooks | Compatibility path for collecting lifecycle signals and issuing occasional messages. Broadly useful as a fallback, with process startup overhead and no persistent pane. Test that synchronous messages reach the user on each supported event. [Hooks reference](https://code.claude.com/docs/en/hooks) |
| Status line | Optional compact context and quota display. It uses a user-configured slot and may compete with an existing status line. Subscription windows and reset times depend on the account and response. [Status-line reference](https://code.claude.com/docs/en/statusline) |
| Desktop overlay | Could display a companion across terminals, with independent layout and animation. It adds a separate process, platform-specific placement, and lifecycle work. Revisit after the terminal experience is useful. |

## Architecture and rollout

1. **Verify the host integration.** Use the Phase 1 scaffold to exercise real hook delivery and native rendering. On a supported CLI, verify the band before wiring in data. Check read-only usage snapshots, native command behavior, and fallback messages with a small synthetic test session. Anthropic documents `session.usage()` as a free snapshot when called without a breakdown. [Mod usage walkthrough](https://claude.dev/blog/getting-started-with-claude-code-mods/)
2. **Ship a companion with one useful tip.** Introduce independent collection, recommendation, usage, and presentation modules. Implement oversized shell output first, then pasted logs and overlapping reads one at a time with fixtures. Show the latest useful tip at a turn boundary and flag high quota utilization where Claude reports it. Prompt coaching applies to the next prompt or a user-requested revision. Use the native band once verified and occasional hook messages on the fallback. Pick one presenter per session as a distribution choice.
3. **Add local feedback and reporting.** Start with dismiss or snooze, then add accept and an optional usefulness rating. Store feedback by recommendation and durable rule ID. Use cooldowns and per-rule preferences to keep the companion quiet. Accept records intent. A local report shows token counts by category and observation coverage, with usage trends where comparable observations exist.
4. **Expand from pilot evidence.** Add detectors for repeated failed commands, subagent fan-out, excessive exploration, verbose output, and context-management opportunities as signals prove useful. Validate savings claims with comparable tasks and acceptance checks before publishing them. Track basic usage and review real workflows from the first usable prototype.

Collectors normalize host events into bounded features. A detector declares a stable ID and the signals it needs, then evaluates those features and returns evidence, confidence, and one suggested action. A shared policy handles priority, cooldowns, and feedback. Presenters consume the selected recommendation and usage snapshot. The planned source directories are `src/collection/`, `src/recommendations/`, `src/usage/`, `src/storage/`, and `src/ui/`. Add them as those parts land.

Process raw prompts and tool results transiently and store only allowlisted derived values. Keep the optimizer offline, use zero model calls, and add zero instructions to the model context. Do bounded work on events, batch background accounting where feasible, and keep the render path free of polling and I/O. Measure hook latency before broadening collection and favor one turn-end process over a process on every tool call when it provides enough evidence.

Track context fullness, cumulative tokens, and plan quota independently. A quota alert reflects Claude's latest available snapshot. Report observed fresh input, cache reads, cache writes, and output separately. Transcript coverage and request deduplication need validation before those counts support comparisons. Report verified savings only where the baseline and task outcome support the claim. [Monitoring reference](https://code.claude.com/docs/en/monitoring-usage)

## Phase 2 shell-output companion

Run `npm run prepare:plugins` under Node.js 24 or newer to copy the typed shared engine into both self-contained plugin directories. The generated copies are ignored. Run one surface per Claude Code session.

```sh
# Standard hooks
claude --plugin-dir ./plugin

# Native companion with a compatible Claude Code binary
claude --plugin-dir ./mod
```

In a scratch session, ask Claude to run the following once via Bash without rerunning it or reading its output through another tool.

```sh
awk 'BEGIN { for (i=1; i<=200; i++) printf "synthetic passing test %04d ........................................................\n", i }'
```

A successful Bash result qualifies at 8,000 characters and 100 lines, or at 16,000 characters regardless of line count. The detector uses the stdout visible in the hook payload. It skips failures, results with stderr, interruptions, image output, and background task acknowledgments. It leaves tool output intact and suggests scoping the command or choosing a quiet reporter that retains diagnostics. Host truncation or preview-only results can hide large output from the detector.

The native band shows one tip with **Dismiss** and **Snooze 30 min**. Dismiss hides the tip and starts a ten-minute cooldown. Snooze hides it for 30 minutes. A new eligible result after that interval can produce a new tip. Native feedback is session-local and resets on reload or session changes. The standard hook emits a noninteractive message and keeps a ten-minute per-rule cooldown across hook processes. Its per-session files under `${CLAUDE_PLUGIN_DATA}/recommendations` contain tool-use IDs, rule IDs, and timestamps. A bounded deduplication history keeps up to 128 event IDs per session. The optimizer itself makes no model calls or network requests.

### Phase 2 checks

- `npm test` covers thresholds, malformed input, event handling, generated advice, prioritization, cooldowns, deduplication, and fallback persistence.
- `npm run test:integration` checks the real CLI startup hook. `CLAUDE_BIN` can point it at a different executable. A separate probe confirmed the installed 2.1.236 CLI supplies `CLAUDE_PLUGIN_DATA` to a local plugin.
- On a mod-capable CLI, run `claude plugin validate ./mod` and `(cd mod && claude plugin test)` after preparing the plugins. The Claude Desktop-bundled macOS CLI 2.1.326 validated and loaded the module in a real process. The built-in mod test host exercised `classic.PostToolUse`, mounting the band, and pressing both feedback controls with synthetic input. Its validator also revealed reserved name prefixes, so the manifest names are now `efficiency-optimizer` and `efficiency-companion`.
- A live interactive launch with that binary exited during startup because the sandbox could not resolve `api.anthropic.com`. The live terminal paint, feedback input, and real Bash event payload on both surfaces still need a signed-in terminal with network access. Run the scratch-session example above there and check that the original output is intact, a tip appears only once, and either native button hides it. The standard hook's display and end-to-end latency under live workloads also need verification. [Anthropic's mod test guide](https://code.claude.com/docs/en/plugins/mods/test)

## Optimization knowledge base and audit

The versioned registry in `src/registry.mts` currently contains two sourced techniques. Each entry records a stable ID, category, evidence requirements, user action, cadence, host compatibility, confidence, limits, and documentation. A recommendation carries the registry version and its savings status. Confidence describes the strength of the finding. Savings describe the effect on a successfully completed task, which is unverified for both techniques. [Anthropic's efficiency guide](https://claude.com/resources/articles/maximizing-the-value-of-your-claude-code-sessions) · [Project instructions](https://code.claude.com/docs/en/memory#when-to-add-to-claudemd)

- **Live Companion** uses host events and deterministic detectors to offer one timely intervention. The coordinator handles deduplication, priority, cooldowns, and feedback. The native UI exposes dismiss and timed snooze. The coordinator also supports session-wide snoozing, snoozing until the next session, and suppressing a rule in the current session. Those additional controls have no UI or durable preferences yet. The classic hook remains noninteractive.
- **Optimization Audit** evaluates configuration when requested. The initial CLI checks the root `CLAUDE.md` in the directory supplied. It looks for the first pair of consecutive, byte-identical plain bullets and proposes deleting the second. A single surviving instruction clears this check. The result describes this specific pattern and does not certify the full configuration. The scanner skips ambiguous Markdown, rejects symlinks and nonregular files, and reads at most 128 KiB of valid UTF-8. The default output shows line numbers and savings status. Preview explicitly prints the local diff. Neither mode modifies files, invokes a model, or transmits content.

```sh
npm run audit -- /path/to/project
npm run audit -- /path/to/project --preview
```

### Expansion design

1. **Collect and resolve evidence.** Add separate readers for the project and user instruction layers, path-scoped rules, skills, and supported settings. Resolve actual precedence and rule scope before comparing instructions. Record partial coverage where managed settings or other active layers are unavailable. Suggest adding a project convention only with explicit confirmation or repeated task evidence. Prefer scoped rules or on-demand skills for guidance that only some tasks need. [Project memory and scoped rules](https://code.claude.com/docs/en/memory) · [Settings precedence](https://code.claude.com/docs/en/settings)
2. **Route recommendations through a shared lifecycle.** The state contract covers new, shown, dismissed, snoozed, accepted, applied, superseded, and expired. The live coordinator handles the presentation and suppression subset. Future storage can persist state and opt-in feedback by rule and scope. Acceptance records intent. Application records a successful, explicit write. A change in evidence or rule version can supersede a proposal.
3. **Review changes before applying them.** The current CLI has no write path. A future apply operation requires review of the exact diff and an explicit action, then verifies the file still matches the preview and updates it atomically. Keep a local inverse patch and post-change fingerprint so undo can reject stale or conflicting files. Assess additional instruction context before proposing additions and use the smallest change that preserves project intent.
4. **Measure successful work.** Compare overall usage for comparable tasks with the same success checks when making savings claims. Report evidence and coverage independently of any savings estimate. Keep storage, notification scheduling, and host UI behind separate boundaries so later integrations can reuse the same rule definitions.

## Interactive pilot milestone

### Live recommendations and privacy

- Two consecutive text reads of the same file can trigger guidance when at least 80 returned lines match exactly and the overlap covers at least 80% of the newer read. For example, if reads of lines 1–100 and 21–120 of a settings module return identical lines 21–100, reuse the prior excerpt or request only lines 101–120. Claude's content-free unchanged response does not qualify.
- Three consecutive Bash failures in the same directory with the exact same command and a recognized stable diagnostic can trigger guidance. For example, three `npm run test:unit` attempts that all report a missing script suggest checking the invocation or prerequisite before retrying. An intervening observed tool event, a different error, or a transient-looking failure breaks the chain. Tool actions outside the observed sequence can still affect the outcome.
- The sequence detectors run in the native mod. They hold at most one bounded prior result in memory and reset at the end of the turn. The standard plugin continues to provide the original oversized Bash tip. It does not start processes for the additional sequence detectors. The optimizer makes no model calls or network requests.

Native dismiss starts a ten-minute cooldown in the current session. Thirty-minute snooze and rule mute are saved as per-rule preferences through Claude Code's local mod store. **Snooze until new session** is stored against the current session ID, survives reopening that ID, and leaves fresh sessions eligible. **Enable all tips** clears the saved rule preferences and the current session snooze. A displayed tip expires after ten minutes and is dropped on the next event or render. There is no background polling. The native store receives rule flags, expiry timestamps, and an opaque session ID for session snoozes. Detector observations stay out of the store. These storage semantics were exercised with a mock store in Claude Code's test host. [Claude Code mod test guide](https://code.claude.com/docs/en/plugins/mods/test)

### Expanded audit

`npm run audit -- /path/to/project [--preview]` inspects root `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, and a bounded recursive scan of `.claude/rules/`. The audit compares literal bullets within the same recognized scope. Similar wording and cross-scope equivalence are outside the check. For an isolated line such as `- For files under src/api/, use the API error format.`, the audit can preview moving the unchanged line into a new path-scoped rule, provided the directory exists and the destination is free. It explains the timing change because a scoped rule loads on matching file access. Preview never writes files. Cross-file duplicate findings have no proposed automatic deletion.

The scanner accepts a limited frontmatter subset and skips unsupported content and links. It does not resolve imports, user or managed rules, skills, settings, or the actual runtime load order. The audit reports task-level savings as unverified. [Claude Code path-scoped rules](https://code.claude.com/docs/en/memory#path-specific-rules)

### Signed-in terminal smoke test

**Status: unverified.** The Claude Desktop-bundled CLI 2.1.326 was available, but an isolated interactive launch exited with `api.anthropic.com ENOTFOUND`. The checks below require a signed-in, network-enabled terminal and a compatible Claude Code installation.

1. From this checkout run `npm run prepare:plugins`, then save the absolute source path as `optimizer_checkout=$PWD`. In a different scratch directory, run `claude --version` and `claude --plugin-dir "$optimizer_checkout/mod"`. Confirm the ready band appears above the prompt and `/plugin` lists `efficiency-companion` as active. Keep the standard plugin unloaded for this test.
2. Name the session with `/rename optimizer-smoke-a`. Ask Claude to run this exact command once **using the Bash tool**, without output redirection, pipes, or a second read. Confirm the original output is available and the band shows **Large shell output**.

   ```sh
   awk 'BEGIN { for (i=1; i<=200; i++) printf "synthetic passing test %04d ........................................................\n", i }'
   ```

3. Press **Dismiss** in the band. Confirm it returns to ready. Ask for the exact Bash command again within ten minutes. A fresh Bash tool result should arrive and no repeat tip should appear.
4. Start a separate session named `optimizer-smoke-b` with the same mod command. Trigger the Bash tip, press **Snooze 30 min**, exit, and launch `claude --plugin-dir "$optimizer_checkout/mod" --resume optimizer-smoke-b`. Confirm another eligible Bash result remains quiet during that interval. After 30 minutes, run a fresh eligible tool call and confirm the tip can appear.
5. Press **Snooze until new session**, exit and resume `optimizer-smoke-b`, and confirm an eligible Bash result stays quiet. Start a fresh session, trigger the tip, and press **Mute this rule**. Check that a different fresh session still suppresses it. Press **Enable all tips** and confirm another eligible result can show it.
6. Record CLI version, terminal, session names, and pass/fail for each step. Record only the results and synthetic fixture details. If the band appears but a tip is missing, rerun with `--debug` and look for module load or skipped-hook messages. The test host checks state transitions, but they do not confirm the signed-in terminal path.

## Developer alpha

Use the [macOS alpha smoke test](docs/alpha-smoke-test.md) to try the native companion against synthetic fixtures and record signed-in results.

### Live validation status

| Evidence | Status |
| --- | --- |
| Signed-in Claude Code 2.1.326 terminal | User observed the ready band and a visible oversized Bash recommendation from a real `PostToolUse` event. Its diagnostic reported 1 ms of observer time for that one event. |
| Automated and native host tests | Cover the compact summary and Details toggle, dismissal across a simulated resume and expiry, timed and next-session snooze, rule mute, diagnostics disabled by default and redacted when on, and unchanged downstream hook output. |
| Remaining signed-in checks | Polished band, keyboard and mouse feedback, on-disk preference persistence across exit and resume, model-facing message inspection, and realistic end-to-end notification/render overhead. |

The native band defaults to a short suggestion with direct **Dismiss** and **Snooze 30 min** actions. **Details** shows the full explanation, rule mute, and next-session snooze. A dismissal remains in effect for ten minutes if you resume that same session. A fresh session may show the rule again. Developer diagnostics require `MILTON_DIAGNOSTICS=1` and use Claude Code's user-only UI log. The hook passes the original event through and the recommendation is drawn in the UI. Host checks and the documented log behavior are evidence for context isolation. A live outbound model request has not been inspected. [Claude Code UI logging](https://code.claude.com/docs/en/plugins/mods/api#show-something-without-starting-a-turn)
