import { COOLDOWN_MS, createCoordinator, SNOOZE_MS } from './shared/coordinator.mts';
import { optimizationRegistry } from './shared/registry.mts';
import { detectShellOutput } from './shared/shell-output.mts';
import { createToolSequence } from './shared/tool-sequence.mts';

const liveRules = optimizationRegistry.filter(rule => rule.category === 'tool-output');
const ruleKey = id => `rule:${id}`;
const sessionKey = id => `session-snooze:${id}`;
const dismissKey = id => `dismissed:${id}`;
const summaries = {
  'oversized-shell-output': 'Large shell output. Try a quieter or narrower command.',
  'overlapping-file-reads': 'Overlapping reads. Request only the missing lines.',
  'repeated-failed-command': 'Repeated failure. Fix the first error before retrying.',
};

let current;
let diagnosticSetting;
let diagnosticSequence = 0;
let diagnosticActive = false;

function diagnosticsEnabled($) {
  diagnosticSetting ??= Promise.resolve($.env.get('MILTON_DIAGNOSTICS'))
    .then(value => { diagnosticActive = value === '1'; }, () => {});
  return diagnosticSetting;
}

async function diagnostic($, event, outcome, durationMs, tip, error) {
  if (!diagnosticActive) return;
  const record = {
    event,
    detector: tip?.ruleId ?? null,
    recommendationId: tip?.diagnosticId ?? null,
    outcome,
    durationMs,
    error: error ?? null,
  };
  try {
    await $.ui.log(`Milton diagnostic ${JSON.stringify(record)}`);
  } catch {
    // Diagnostic output is best effort and never changes hook behavior.
  }
}

async function flushRenderSample($, state) {
  const sample = state?.renderSample;
  if (!sample) return;
  state.renderSample = undefined;
  await diagnostic($, 'ui.render', 'tree-built', sample.durationMs, sample.tip);
}

function session($, id) {
  if (current?.id === id) return current;
  const history = { seen: [], blockedUntil: {} };
  const coordinator = createCoordinator(history);
  const state = { id, coordinator, sequence: createToolSequence(), canReset: false, dismissals: {} };
  current = state;
  state.ready = (async () => {
    try {
      const records = await Promise.all([
        ...liveRules.map(rule => $.store.get(ruleKey(rule.id))),
        $.store.get(sessionKey(id)),
        $.store.get(dismissKey(id)),
      ]);
      const now = Date.now();
      const savedDismissals = records.at(-1);
      for (const [i, rule] of liveRules.entries()) {
        const dismissedUntil = savedDismissals?.[rule.id];
        if (Number.isFinite(dismissedUntil) && dismissedUntil > now) {
          history.blockedUntil[rule.id] = dismissedUntil;
          state.dismissals[rule.id] = dismissedUntil;
        }
        const value = records[i];
        if (value?.suppressed === true) {
          coordinator.suppressRule(rule.id);
          state.canReset = true;
        } else if (Number.isFinite(value?.until) && value.until > now) {
          coordinator.snoozeRule(rule.id, value.until);
          state.canReset = true;
        }
      }
      if (records.at(-2) === 'next-session') {
        coordinator.snoozeSession('next-session');
        state.canReset = true;
      }
    } catch {
      state.preferenceReadFailed = true;
    }
  })();
  return state;
}

async function observe($, event, next) {
  const began = Date.now();
  const setting = diagnosticSetting ?? diagnosticsEnabled($);
  const previous = current;
  const eventType = event.hook_event_name === 'PostToolUseFailure' ? 'PostToolUseFailure' : 'PostToolUse';
  let tip;
  let outcome = 'no-match';
  let error;
  try {
    if (typeof event.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(event.session_id)) {
      error = 'invalid-event';
      outcome = 'error';
    } else {
      const changed = current?.id !== event.session_id;
      const state = session($, event.session_id);
      tip = state.sequence.observe(event) ?? detectShellOutput(event);
      if (changed || tip) {
        await state.ready;
        if (current === state) {
          const shown = tip && state.coordinator.offer(tip, Date.now());
          if (tip) {
            tip = { ruleId: tip.ruleId, diagnosticId: `recommendation-${++diagnosticSequence}` };
            outcome = shown ? 'queued' : 'suppressed';
            if (shown) {
              state.diagnosticTip = tip;
              state.expandedTipId = undefined;
            }
          }
          if (changed || shown) $.ui.invalidate('ui.render');
        } else {
          outcome = 'session-changed';
          tip = undefined;
        }
        if (state.preferenceReadFailed) error = 'preference-read-failed';
      }
    }
  } catch {
    outcome = 'error';
    error = 'observer-failed';
    tip = undefined;
  }
  // Only fixed metadata enters the diagnostic channel. Never include the host event.
  const durationMs = Math.max(0, Date.now() - began);
  await setting;
  if (diagnosticActive) {
    await flushRenderSample($, previous);
    await diagnostic($, eventType, outcome, durationMs, tip, error);
  }
  return next(event);
}

const failOpen = ($, event, next) => next.called ? {} : next(event);
export function register(on) {
  on('classic.PostToolUse', observe).catch(failOpen);
  on('classic.PostToolUseFailure', observe).catch(failOpen);

  on('turn.complete', ($, event, next) => {
    if (!event.agentId) current?.sequence.reset();
    return next(event);
  });

  on('session.end', async ($, event, next) => {
    const previous = current;
    current = undefined;
    if (diagnosticActive) await flushRenderSample($, previous);
    return next(event);
  });

  on('ui.render', { component: 'AbovePrompt' }, ($, event, next) => {
    if (event.props.hasSurvey) return next(event);
    const began = diagnosticActive ? Date.now() : 0;

    const { Box, Button, Text } = $.ui.resolve(event);
    const state = current;
    const coordinator = state?.coordinator;
    coordinator?.expire(Date.now());
    const tip = coordinator?.active;
    const redraw = () => $.ui.invalidate('ui.render');
    if (!tip) {
      const ready = Text({ dimColor: true, children: 'Efficiency companion · ready' });
      if (!state?.canReset) return ready;
      return Box({ flexDirection: 'row', columnGap: 2, children: [
        ready,
        Button({ key: 'optimizer-enable', label: 'Enable all tips', onPress: async () => {
          if (current !== state) return;
          for (const rule of liveRules) coordinator.allowRule(rule.id);
          coordinator.snoozeSession();
          state.canReset = false;
          redraw();
          await Promise.all([
            ...liveRules.map(rule => $.store.set(ruleKey(rule.id), null)),
            $.store.set(sessionKey(state.id), null),
          ]).catch(() => {});
        } }),
      ] });
    }

    const act = (key, label, outcome, action) => Button({ key, label, onPress: async () => {
      const began = Date.now();
      coordinator.expire(began);
      if (current !== state || coordinator.active?.id !== tip.id) return;
      const diagnosticTip = state.diagnosticTip;
      let error;
      try { await action(); } catch { error = 'preference-write-failed'; }
      const durationMs = Math.max(0, Date.now() - began);
      if (diagnosticActive) {
        await flushRenderSample($, state);
        await diagnostic($, 'feedback', outcome, durationMs, diagnosticTip, error);
      }
    } });
    const save = async (key, value) => {
      state.canReset = true;
      redraw();
      await $.store.set(key, value);
    };
    const expanded = state.expandedTipId === tip.id;
    const primary = Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: [
      Text({ children: summaries[tip.ruleId] ?? tip.message }),
      Button({
        key: 'optimizer-details',
        label: expanded ? 'Hide details' : 'Details',
        onPress: () => {
          if (current !== state || coordinator.active?.id !== tip.id) return;
          state.expandedTipId = expanded ? undefined : tip.id;
          redraw();
        },
      }),
      act('optimizer-dismiss', 'Dismiss', 'dismissed', async () => {
        const now = Date.now();
        if (!coordinator.feedback(tip.id, 'dismiss', now)) return;
        for (const rule of liveRules) {
          if (state.dismissals[rule.id] <= now) delete state.dismissals[rule.id];
        }
        state.dismissals[tip.ruleId] = now + COOLDOWN_MS;
        redraw();
        await $.store.set(dismissKey(state.id), state.dismissals);
      }),
      act('optimizer-snooze', 'Snooze 30 min', 'snoozed', async () => {
        const now = Date.now();
        const until = now + SNOOZE_MS;
        if (coordinator.feedback(tip.id, 'snooze', now, until)) await save(ruleKey(tip.ruleId), { until });
      }),
    ] });
    if (diagnosticActive && state.sampledTipId !== tip.id) {
      state.sampledTipId = tip.id;
      state.renderSample = {
        tip: state.diagnosticTip,
        durationMs: Math.max(0, Date.now() - began),
      };
    }
    if (!expanded) return primary;

    return Box({ flexDirection: 'column', children: [
      primary,
      Text({ children: tip.message }),
      Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: [
        act('optimizer-suppress', 'Mute this rule', 'muted', async () => {
          coordinator.suppressRule(tip.ruleId);
          await save(ruleKey(tip.ruleId), { suppressed: true });
        }),
        act('optimizer-session-snooze', 'Snooze until new session', 'session-snoozed', async () => {
          coordinator.snoozeSession('next-session');
          await save(sessionKey(state.id), 'next-session');
        }),
      ] }),
    ] });
  });
}
