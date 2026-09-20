/**
 * CHP deterministic adversary — foundation scoring for a proposed response
 * plan (gate-only port; shape from erp-control-plane api/genbi/chp.py).
 *
 * Scores the plan's foundation out of 100:
 *   40 — response grammar held (every step parses to a legal verb; the R0
 *        structural pass)
 *   30 — bounded plan: every step names an explicit target
 *   30 — golden parity: where a golden source exists (a matched runbook or a
 *        resolved past incident's playbook), every plan verb is grounded in
 *        that playbook text
 *
 * General floor 70 — CHP defines no infra/ops floor, so the general floor
 * applies. A plan that contradicts a matched golden source (a verb absent
 * from the documented procedure) is FATAL: like golden parity mismatch in the
 * reference gate, no human confirmer may wave it through — fix the plan or
 * fix the runbook.
 */

import type { PlanStep } from './r0';

export const GUARDRAIL_POINTS = 40;
export const BOUNDED_PLAN_POINTS = 30;
export const PARITY_POINTS = 30;
export const FULL_SCORE = GUARDRAIL_POINTS + BOUNDED_PLAN_POINTS + PARITY_POINTS;

/** General-domain floor: CHP has no infra/ops floor, so 70 applies. */
export const GENERAL_FLOOR = 70;

export interface GoldenSource {
  source_type: 'runbook' | 'incident';
  title: string;
  /** Playbook text: runbook body or the past incident's resolution summary. */
  content: string;
  similarity: number;
}

export interface ParityEvidence {
  source_type: 'runbook' | 'incident';
  title: string;
  similarity: number;
  /** Plan verbs checked against the golden playbook. */
  verbs: string[];
  /** Verbs found in the golden text. */
  grounded: string[];
  /** null = the golden record carries no comparable procedure. */
  within_tolerance: boolean | null;
}

export interface FoundationAssessment {
  score: number;
  verdict: 'PASS' | 'REFRAME';
  /** Fatal findings (golden contradiction) cannot be confirmed by a human. */
  fatal: boolean;
  findings: string[];
  parity: ParityEvidence | null;
  golden_matched: boolean;
}

export interface FoundationInput {
  steps: (PlanStep | null)[];
  golden?: GoldenSource | null;
}

function uniqueVerbs(steps: PlanStep[]): string[] {
  return [...new Set(steps.map((s) => s.verb))];
}

/**
 * Score the proposed response plan. Total over its input: illegal steps score
 * zero guardrail points rather than throwing — the verdict carries the refusal.
 */
export function assessFoundation(input: FoundationInput): FoundationAssessment {
  const { steps, golden } = input;
  const findings: string[] = [];
  let score = 0;
  let fatal = false;

  const parsed = steps.filter((s): s is PlanStep => s !== null);
  if (parsed.length === steps.length && parsed.length > 0) {
    score += GUARDRAIL_POINTS;
    findings.push(
      `response grammar held: ${parsed.length} step(s), all verbs legal`
    );
  } else {
    findings.push(
      'response grammar violated: one or more steps lack a legal response verb'
    );
  }

  if (parsed.length > 0 && parsed.every((s) => s.target.length > 0)) {
    score += BOUNDED_PLAN_POINTS;
    findings.push('bounded plan: every step names an explicit target');
  } else {
    findings.push('plan not concrete: every step must name an explicit target');
  }

  let parity: ParityEvidence | null = null;
  if (golden) {
    const verbs = uniqueVerbs(parsed);
    const goldenText = golden.content.toLowerCase();
    if (verbs.length === 0 || !goldenText.trim()) {
      parity = {
        source_type: golden.source_type,
        title: golden.title,
        similarity: golden.similarity,
        verbs,
        grounded: [],
        within_tolerance: null,
      };
      findings.push(
        'golden source matched but carries no comparable procedure — parity evidence unavailable'
      );
    } else {
      const grounded = verbs.filter((v) => goldenText.includes(v));
      const within = grounded.length === verbs.length;
      parity = {
        source_type: golden.source_type,
        title: golden.title,
        similarity: golden.similarity,
        verbs,
        grounded,
        within_tolerance: within,
      };
      if (within) {
        score += PARITY_POINTS;
        findings.push(
          `golden parity: all plan verbs (${verbs.join(', ')}) grounded in ${golden.source_type} "${golden.title}"`
        );
      } else {
        const contradicting = verbs.filter((v) => !grounded.includes(v));
        fatal = true;
        findings.push(
          `golden parity MISMATCH: verb(s) ${contradicting.join(', ')} absent from ${golden.source_type} "${golden.title}" — the plan contradicts the documented procedure`
        );
      }
    }
  } else {
    findings.push(
      'no golden source matched this plan — parity evidence unavailable'
    );
  }

  score = Math.min(score, FULL_SCORE);
  return {
    score,
    verdict: !fatal && score >= GENERAL_FLOOR ? 'PASS' : 'REFRAME',
    fatal,
    findings,
    parity,
    golden_matched: Boolean(golden),
  };
}
