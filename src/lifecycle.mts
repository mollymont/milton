import type { Recommendation } from './recommendation.mts';

export type SnoozeUntil = number | 'next-session';
type Status = 'new' | 'shown' | 'dismissed' | 'accepted' | 'applied' | 'superseded' | 'expired';
type State = { status: Status } | { status: 'snoozed'; until: SnoozeUntil };
export type Lifecycle = { recommendation: Recommendation } & State;

const allowed: Record<Lifecycle['status'], readonly Lifecycle['status'][]> = {
  new: ['shown', 'superseded', 'expired'],
  shown: ['dismissed', 'snoozed', 'accepted', 'superseded', 'expired'],
  snoozed: ['expired', 'superseded'],
  accepted: ['applied', 'superseded', 'expired'],
  dismissed: [],
  applied: [],
  superseded: [],
  expired: [],
};

export function transition(record: Lifecycle, state: State): Lifecycle | undefined {
  if (!allowed[record.status].includes(state.status)) return;
  return { recommendation: record.recommendation, ...state };
}

export function isSnoozed(until: SnoozeUntil | undefined, now: number): boolean {
  return until === 'next-session' || (until !== undefined && now < until);
}
