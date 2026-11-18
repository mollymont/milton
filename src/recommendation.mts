// Surface-independent contract. Evidence contains derived values only.
export interface Recommendation {
  id: string;
  ruleId: string;
  priority: number;
  message: string;
  registryVersion: number;
  savings: 'unverified' | 'estimated' | 'measured';
  evidence: Readonly<Record<string, number>>;
}

export type Feedback = 'dismiss' | 'snooze';
