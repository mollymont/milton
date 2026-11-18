# macOS developer alpha smoke test

**Current status: the earlier native band and one real Bash recommendation were observed in a signed-in terminal. The polished band and remaining interactions are pending.** This runbook uses synthetic tool calls and a scratch copy. Run it from your regular macOS Terminal, using an existing signed-in Claude Code account and normal network configuration.

## Diagnose startup

In your regular terminal, run:

```sh
claude --version
dscacheutil -q host -a name api.anthropic.com
curl -sS -I --connect-timeout 5 https://api.anthropic.com
curl -sS -I --connect-timeout 5 https://github.com
env | cut -d= -f1 | grep -Ei '^(https?_proxy|all_proxy|no_proxy|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY))$'
scutil --proxy | awk '/Enable/ {print}'
```

- A resolved address and an HTTP response, including an HTTP error, show the DNS and transport path worked for that invocation. They do not verify Claude sign-in. Check `claude auth status` locally and keep account details out of the test record.
- If both hosts resolve outside the sandbox, the sandbox is the likely source of the observed failure. Inside the sandbox both hosts failed with `curl: (6)`, and no proxy variables or Claude endpoint overrides were present.
- If both hosts fail outside the sandbox, investigate the Mac's resolver, VPN, or managed network. If only Anthropic fails, investigate domain-specific filtering or routing. If curl works but Claude Code fails, compare the CLI version and provider or proxy configuration in the same terminal. Check environment variable names without sharing values. Leave credentials and network controls as configured.
- Use a CLI with native mod support. This branch was tested in the Claude Code 2.1.326 host. [Claude Code mods overview](https://code.claude.com/docs/en/plugins/mods/overview)

## Prepare and launch

```sh
cd ~/Projects/milton
npm run prepare:plugins
checkout=$PWD
fixture=$(mktemp -d "${TMPDIR:-/tmp}/milton-smoke.XXXXXX")
cp -R "$checkout/fixtures/alpha/." "$fixture/"
fixture=$(cd "$fixture" && pwd -P)
cd "$fixture"
MILTON_DIAGNOSTICS=1 claude --plugin-dir "$checkout/mod"
```

Use only the native mod for this run. Accept the workspace trust prompt only after confirming the directory is the synthetic scratch copy. Look for **Efficiency companion · ready** above the prompt and `efficiency-companion` in the active mods shown by `/plugin`.

Use **Control+X**, release it, then press **Tab** to focus the band. Move with **Tab** or **← / →**, press **Enter** to activate a button, and use **Esc** to return to your draft. Open **Details** for full advice, rule mute, and next-session snooze. [Claude Code keyboard shortcuts](https://code.claude.com/docs/en/keybindings#above-prompt-actions)

Start each detector in a fresh session using the same launch command. Wait for the prompt to return after each test. The two sequence detectors require the calls to happen consecutively in the same turn. Accept the ordinary tool permission prompts as needed.

| Test | Paste this prompt | Expected |
| --- | --- | --- |
| Oversized output | “Use the Bash tool to run exactly `sh ./oversized.sh` once, with no pipe or redirection. Then reply only with DONE.” | The original synthetic output is available and **Large shell output** appears in the band. |
| Overlapping Read | “In this turn use the Read tool twice, sequentially and with no other tool calls. Read `src/settings.ts` with offset 1 and limit 100, then the same file with offset 21 and limit 100. Then reply only with DONE.” | The second call overlaps the first by 80 lines. The band suggests reusing the earlier excerpt or reading only the missing lines. |
| Repeated failures | “In this turn invoke Bash three separate times in sequence with the exact command `sh ./fail.sh` each time. After each expected nonzero exit, issue the next call. Keep the same working directory and use no other tools. Then reply only with DONE.” | Each call reports exit code 2 and the same synthetic unknown-option diagnostic. The third failure queues the repeated-command tip. |
| Read-only audit | After exiting Claude, run `npm --prefix "$checkout" run audit -- "$fixture" --preview` in the same shell. | The CLI shows a duplicate deletion preview and a relocation preview into `.claude/rules/optimizer-src.md`. The scratch files stay unchanged. |

If Claude changes the command or uses a different tool, retry in a fresh session. Count only runs that executed the requested tool sequence. A `no-match` diagnostic after that sequence indicates a payload or detector issue to investigate.

## Feedback, restart, and model context

1. In a fresh session, rename it with `/rename milton-alpha-dismiss`, trigger the Bash tip, and press **Dismiss**. The band returns to ready. Repeat the Bash trigger within ten minutes and expect no repeat tip. Exit and resume with `MILTON_DIAGNOSTICS=1 claude --plugin-dir "$checkout/mod" --resume milton-alpha-dismiss`, then repeat within the same ten-minute window and expect suppression. A fresh session remains eligible.
2. In another fresh session, run `/rename milton-alpha-snooze`, trigger the tip, press **Snooze 30 min**, and exit with `/exit`. From the same fixture directory run:
   ```sh
   MILTON_DIAGNOSTICS=1 claude --plugin-dir "$checkout/mod" --resume milton-alpha-snooze
   ```
   Repeat the Bash trigger before 30 minutes and expect suppression. Repeat after expiry and expect the tip on a fresh matching result.
3. Open **Details**, press **Snooze until new session**, exit, resume the same named session, and verify suppression. Open a new session and confirm the tip can appear there.
4. In that new session, open **Details** and press **Mute this rule** on the Bash tip and exit. Open another fresh session and run the Bash fixture. Expect suppression. Press **Enable all tips** and run another Bash call. Expect the tip to return.
5. Repeat the oversized Bash fixture with diagnostics omitted in a fresh session. Confirm the recommendation still appears, the original tool output is intact, no extra model turn starts, and no diagnostic lines appear. Keep all recommendation text out of your prompts. Inspect the synthetic session's local transcript if available and check that no recommendation text was added to model-facing message or tool-result rows. The expected reply of DONE is a visible check only. A transcript and the validated hook inventory can expose accidental injection, but they do not prove the contents of a captured outbound API request. Mark that stronger check unverified unless you have an approved way to inspect it.

## Diagnostics and troubleshooting

`MILTON_DIAGNOSTICS=1` is opt-in for the process. Look for dim lines prefixed `Milton diagnostic` in the terminal. They contain event type, rule ID, a run-local recommendation ID, presentation or feedback outcome, elapsed handler time, and an optional fixed error code. `queued` means the coordinator selected a tip and requested a redraw. Verify painting visually. For tool events, duration covers observer and preference work before logging. For `ui.render`, `tree-built` measures the first compact tree construction for a queued recommendation, with millisecond resolution. That sample is delivered on the next tool event, feedback action, or session exit. Neither measurement includes terminal paint, log delivery, downstream callbacks, or model time. A `preference-write-failed` code means the feedback took effect locally in memory and persistence needs investigation. Diagnostic rows use Claude Code's user-only log API. The surrounding transcript can contain ordinary session data, so share only copied diagnostic lines from the synthetic run. [Claude Code mod UI logging](https://code.claude.com/docs/en/plugins/mods/api#show-something-without-starting-a-turn)

If the mod is missing, rerun `npm run prepare:plugins` from the checkout, confirm the absolute mod path and CLI version, then run `claude plugin validate "$checkout/mod"`. Check workspace trust and managed mod policy. If necessary, inspect the host debug log locally for module load and skipped-hook messages. Keep host debug logs out of public reports. [Claude Code mod troubleshooting](https://code.claude.com/docs/en/plugins/mods/troubleshoot)

### Check overhead in a signed-in session

Run a short representative task in a disposable project with the same model and effort twice, first with the native mod and diagnostics off, then with diagnostics enabled. Include ordinary Read and Bash calls and at least one eligible recommendation. Repeat enough to see whether lag is consistent. Keep the observed wall-clock interaction lag separate from the `PostToolUse` observer and `ui.render` tree-build samples. Compare the samples for matching and nonmatching events, and press **Details**, **Dismiss**, and **Snooze** while watching for visible lag or prompt input loss. A single 1 ms live observer sample from the original smoke test is a datapoint, with no evidence of paint time or typical latency. For end-to-end comparison use the same task once without the mod and record any reproducible delay. Record sample count, median, worst case, and terminal/CLI version.

## Alpha readiness checklist

- [ ] **Automated:** `npm test` and `npm run test:integration` pass. Includes fixture output, both sequence conditions, cooldown and expiry, audit file safety, and classic plugin startup.
- [ ] **Native host:** after preparing plugins, run `(cd mod && claude plugin test)`. Confirm UI tree controls, synthetic feedback persistence, diagnostics opt-in and redaction, and tool-hook passthrough tests pass. Run `claude plugin validate ./mod`.
- [ ] **Signed-in interactive:** record CLI version and terminal, then pass all three live detector cases with visible recommendations and original diagnostics intact.
- [ ] **Signed-in interactive:** dismiss, timed snooze before and after expiry, next-session snooze, persistent mute, and re-enable all behave as described across exit, resume, and fresh sessions.
- [ ] **Signed-in interactive:** diagnostics are absent by default, contain only allowlisted metadata when enabled, and report no unexpected errors. Normal tool execution feels responsive in both modes.
- [ ] **Signed-in interactive:** the context checks above show no added recommendation text in model-facing rows or extra model turns. Record the limits of the evidence.
- [ ] **Read-only:** both audit previews are correct and the fixture files stay unchanged after both audit modes.

Record pass, fail, or unverified for each item. Alpha readiness requires the live items to pass. Automated and native-host passes do not count as live passes.
