// Row 18: degradation ladder.
//
// A ladder is an ordered list of tiers. Each tier either produces a usable
// result or fails with a reason. The ladder runs tiers in order and STOPS at
// the first success. The outcome always records which tier served the result
// and what was attempted — degraded output must be visibly degraded, never
// dressed up as primary output.
//
// The failure mode this replaces: a fallback that silently fabricated an
// entire incident response (invented root causes, timelines, dollar impacts)
// when the primary model was unavailable.

export type DegradationLevel = 'primary' | 'degraded' | 'unavailable';

export interface TierAttempt {
  tier: string;
  ok: boolean;
  reason?: string;
}

export interface LadderResult {
  /** The produced text, or null when every tier failed. */
  text: string | null;
  level: DegradationLevel;
  /** Name of the tier whose output is returned (null when unavailable). */
  tierUsed: string | null;
  attempts: TierAttempt[];
}

export interface DegradationTier {
  name: string;
  run: () => Promise<string>;
}

/** A tier that produced an empty result counts as a failure, not a success. */
export async function runDegradationLadder(tiers: DegradationTier[]): Promise<LadderResult> {
  const attempts: TierAttempt[] = [];
  for (const tier of tiers) {
    try {
      const text = await tier.run();
      if (typeof text === 'string' && text.trim().length > 0) {
        attempts.push({ tier: tier.name, ok: true });
        return {
          text,
          level: tier.name === 'primary' ? 'primary' : 'degraded',
          tierUsed: tier.name,
          attempts,
        };
      }
      attempts.push({ tier: tier.name, ok: false, reason: 'empty output' });
    } catch (e) {
      attempts.push({ tier: tier.name, ok: false, reason: (e as Error).message });
    }
  }
  return { text: null, level: 'unavailable', tierUsed: null, attempts };
}
