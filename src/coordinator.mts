import { isSnoozed, transition } from './lifecycle.mts';
import type { Lifecycle, SnoozeUntil } from './lifecycle.mts';
import type { Feedback, Recommendation } from './recommendation.mts';

export const COOLDOWN_MS = 10 * 60_000;
export const SNOOZE_MS = 30 * 60_000;

export interface History {
  seen: string[];
  blockedUntil: Record<string, number>;
}

export function createCoordinator(history: History = { seen: [], blockedUntil: {} }) {
  let latest: Lifecycle | undefined;
  let shownUntil = 0;
  let sessionSnooze: SnoozeUntil | undefined;
  const ruleSnoozes = new Map<string, SnoozeUntil>();
  const suppressedRules = new Set<string>();

  function expire(now: number) {
    if ((latest?.status === 'shown' && now >= shownUntil) ||
        (latest?.status === 'snoozed' && !isSnoozed(latest.until, now))) {
      latest = transition(latest, { status: 'expired' });
    }
  }

  return {
    expire,
    allowRule(ruleId: string) { suppressedRules.delete(ruleId); ruleSnoozes.delete(ruleId); },
    snoozeRule(ruleId: string, until: SnoozeUntil) { ruleSnoozes.set(ruleId, until); },
    get active() { return latest?.status === 'shown' ? latest.recommendation : undefined; },
    get latest() { return latest; },
    offer(candidate: Recommendation, now: number) {
      expire(now);
      if (history.seen.includes(candidate.id)) return false;
      history.seen.push(candidate.id);
      if (history.seen.length > 128) history.seen.shift();

      if (now < (history.blockedUntil[candidate.ruleId] ?? 0) ||
          suppressedRules.has(candidate.ruleId) || isSnoozed(sessionSnooze, now) ||
          isSnoozed(ruleSnoozes.get(candidate.ruleId), now) ||
          (latest?.status === 'shown' && latest.recommendation.priority >= candidate.priority)) return false;

      latest = transition({ recommendation: candidate, status: 'new' }, { status: 'shown' });
      shownUntil = now + COOLDOWN_MS;
      history.blockedUntil[candidate.ruleId] = shownUntil;
      return true;
    },
    feedback(id: string, action: Feedback, now: number, until: SnoozeUntil = now + SNOOZE_MS) {
      expire(now);
      if (latest?.status !== 'shown' || latest.recommendation.id !== id) return false;
      const ruleId = latest.recommendation.ruleId;
      if (action === 'snooze') {
        if (until !== 'next-session' && (!Number.isFinite(until) || until <= now)) return false;
        ruleSnoozes.set(ruleId, until);
        latest = transition(latest, { status: 'snoozed', until });
      } else {
        history.blockedUntil[ruleId] = now + COOLDOWN_MS;
        latest = transition(latest, { status: 'dismissed' });
      }
      return true;
    },
    snoozeSession(until?: SnoozeUntil) {
      sessionSnooze = until;
      if (until !== undefined && latest?.status === 'shown') latest = transition(latest, { status: 'snoozed', until });
    },
    suppressRule(ruleId: string) {
      suppressedRules.add(ruleId);
      if (latest?.status === 'shown' && latest.recommendation.ruleId === ruleId) {
        latest = transition(latest, { status: 'dismissed' });
      }
    },
  };
}
