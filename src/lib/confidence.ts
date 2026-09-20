// Row 20: evidence-carrying confidence.
//
// A confidence score without visible factors is a vibe. Every factor here is
// a named component with a cap, a score, and evidence strings pointing at the
// data that produced it. The composed score is the capped sum (0-100) and the
// band (HIGH/MEDIUM/LOW) is the human-readable form.

export interface ConfidenceFactor {
  name: string;
  /** Raw factor score; clamped to the factor's cap before summing. */
  score: number;
  /** Maximum this factor may contribute — no single factor can dominate. */
  cap: number;
  /** Where this score came from: source ids, values, degradation attempts. */
  evidence: string[];
}

export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ComposedConfidence {
  score: number;
  band: ConfidenceBand;
  factors: ConfidenceFactor[];
}

export function composeConfidence(factors: ConfidenceFactor[]): ComposedConfidence {
  let score = 0;
  for (const f of factors) {
    if (f.score > 0) score += Math.min(f.score, f.cap);
  }
  score = Math.max(0, Math.min(100, score));
  const band: ConfidenceBand = score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW';
  return { score, band, factors };
}
