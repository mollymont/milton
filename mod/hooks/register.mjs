import { createCoordinator, SNOOZE_MS } from './shared/coordinator.mts';
import { optimizationRegistry } from './shared/registry.mts';
import { detectShellOutput } from './shared/shell-output.mts';
import { createToolSequence } from './shared/tool-sequence.mts';

const liveRules = optimizationRegistry.filter(rule => rule.category === 'tool-output');
const ruleKey = id => `rule:${id}`;
const sessionKey = id => `session-snooze:${id}`;

let current;

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
      // Preference storage is optional for live advice.
    }
  })();
  return state;
}

async function observe($, event, next) {
  if (typeof event.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(event.session_id)) return next(event);
  const changed = current?.id !== event.session_id;
  const state = session($, event.session_id);
  const tip = state.sequence.observe(event) ?? detectShellOutput(event);
  if (changed || tip) {
    await state.ready;
    if (current === state) {
      const shown = tip && state.coordinator.offer(tip, Date.now());
      if (changed || shown) $.ui.invalidate('ui.render');
    }
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

    const act = (key, label, action) => Button({ key, label, onPress: async () => {
      coordinator.expire(Date.now());
      if (current === state && coordinator.active?.id === tip.id) await action();
    } });
    const save = async (key, value) => {
      state.canReset = true;
      redraw();
      await $.store.set(key, value).catch(() => {});
    };
    return Box({
      flexDirection: 'column',
      children: [
        Text({ children: tip.message }),
        Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: [
          act('optimizer-dismiss', 'Dismiss', () => {
            if (coordinator.feedback(tip.id, 'dismiss', Date.now())) redraw();
          }),
          act('optimizer-snooze', 'Snooze 30 min', async () => {
            const now = Date.now();
            const until = now + SNOOZE_MS;
            if (coordinator.feedback(tip.id, 'snooze', now, until)) await save(ruleKey(tip.ruleId), { until });
          }),
          act('optimizer-suppress', 'Mute this rule', async () => {
            coordinator.suppressRule(tip.ruleId);
            await save(ruleKey(tip.ruleId), { suppressed: true });
          }),
          act('optimizer-session-snooze', 'Snooze until new session', async () => {
            coordinator.snoozeSession('next-session');
            await save(sessionKey(state.id), 'next-session');
          }),
        ] }),
      ],
    });
  });
}
