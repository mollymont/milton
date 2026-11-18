import { createCoordinator, SNOOZE_MS } from './shared/coordinator.mts';
import { optimizationRegistry } from './shared/registry.mts';
import { detectShellOutput } from './shared/shell-output.mts';
import { createToolSequence } from './shared/tool-sequence.mts';

const liveRules = optimizationRegistry.filter(rule => rule.category === 'tool-output');
const ruleKey = id => `rule:${id}`;
const sessionKey = id => `session-snooze:${id}`;

let current;
let diagnosticSetting;
let diagnosticSequence = 0;

function diagnosticsEnabled($) {
  diagnosticSetting ??= Promise.resolve($.env.get('MILTON_DIAGNOSTICS'))
    .then(value => value === '1', () => false);
  return diagnosticSetting;
}

async function diagnostic($, enabled, event, outcome, began, tip, error) {
  if (!await enabled) return;
  const record = {
    event,
    detector: tip?.ruleId ?? null,
    recommendationId: tip?.diagnosticId ?? null,
    outcome,
    durationMs: Math.max(0, Date.now() - began),
    error: error ?? null,
  };
  try {
    await $.ui.log(`Milton diagnostic ${JSON.stringify(record)}`);
  } catch {
    // Diagnostic output is best effort and never changes hook behavior.
  }
}

function session($, id) {
  if (current?.id === id) return current;
  const coordinator = createCoordinator();
  const state = { id, coordinator, sequence: createToolSequence(), canReset: false };
  current = state;
  state.ready = (async () => {
    try {
      const records = await Promise.all([
        ...liveRules.map(rule => $.store.get(ruleKey(rule.id))),
        $.store.get(sessionKey(id)),
      ]);
      for (const [i, rule] of liveRules.entries()) {
        const value = records[i];
        if (value?.suppressed === true) {
          coordinator.suppressRule(rule.id);
          state.canReset = true;
        } else if (Number.isFinite(value?.until) && value.until > Date.now()) {
          coordinator.snoozeRule(rule.id, value.until);
          state.canReset = true;
        }
      }
      if (records.at(-1) === 'next-session') {
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
  const enabled = diagnosticsEnabled($);
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
            if (shown) state.diagnosticTip = tip;
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
  await diagnostic($, enabled, eventType, outcome, began, tip, error);
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

  on('session.end', ($, event, next) => {
    current = undefined;
    return next(event);
  });

  on('ui.render', { component: 'AbovePrompt' }, ($, event, next) => {
    if (event.props.hasSurvey) return next(event);

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
      await diagnostic($, diagnosticSetting, 'feedback', outcome, began, diagnosticTip, error);
    } });
    const save = async (key, value) => {
      state.canReset = true;
      redraw();
      await $.store.set(key, value);
    };
    return Box({
      flexDirection: 'column',
      children: [
        Text({ children: tip.message }),
        Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: [
          act('optimizer-dismiss', 'Dismiss', 'dismissed', () => {
            if (coordinator.feedback(tip.id, 'dismiss', Date.now())) redraw();
          }),
          act('optimizer-snooze', 'Snooze 30 min', 'snoozed', async () => {
            const now = Date.now();
            const until = now + SNOOZE_MS;
            if (coordinator.feedback(tip.id, 'snooze', now, until)) await save(ruleKey(tip.ruleId), { until });
          }),
          act('optimizer-suppress', 'Mute this rule', 'muted', async () => {
            coordinator.suppressRule(tip.ruleId);
            await save(ruleKey(tip.ruleId), { suppressed: true });
          }),
          act('optimizer-session-snooze', 'Snooze until new session', 'session-snoozed', async () => {
            coordinator.snoozeSession('next-session');
            await save(sessionKey(state.id), 'next-session');
          }),
        ] }),
      ],
    });
  });
}
