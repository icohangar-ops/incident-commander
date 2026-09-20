/**
 * CHP resolution gate — composes the hardening stages around an agentic
 * response action (gate-only port; shape from erp-control-plane
 * api/genbi/chp.py ChpPromotionGate).
 *
 *   1. R0 gate — before the response action. `evaluateR0` asks: is this
 *      action scoped and solvable from the incident state? HALT refuses with
 *      nothing executed or persisted.
 *   2. Foundation pass — the deterministic adversary scores the plan
 *      (guardrails 40 + bounded plan 30 + golden parity 30). A golden parity
 *      MISMATCH is fatal.
 *   3. Human lock — every case opens PROVISIONAL_LOCK; a named confirmer
 *      locks it (LOCKED). CHP_REQUIRE_HUMAN_LOCK (default ON) makes the
 *      confirmation mandatory for every apply; irreversible response verbs
 *      require it regardless of the flag — irreversible actions must never
 *      auto-execute.
 *   4. Decision record — the case, verdicts, parity evidence, and the
 *      incident-timeline refs are sealed into the CHP decision ledger.
 */

import {
  assessFoundation,
  GENERAL_FLOOR,
  type FoundationAssessment,
  type GoldenSource,
} from './foundation';
import {
  parsePlan,
  planHasIrreversibleVerb,
  evaluateR0,
  type PlanStep,
  type R0IncidentState,
} from './r0';
import {
  applyThirdPartyValidation,
  ChpRejection,
  openDecisionCase,
  openProvisionalLock,
  type DecisionCase,
} from './session';
import { ChpDecisionLedger } from './ledger';

/**
 * Human-lock policy: default ON. Only an explicit opt-out ('0'/'false'/'off')
 * disables the mandatory confirmer — and even then irreversible response
 * verbs still require one.
 */
export function requireHumanLock(): boolean {
  const raw = process.env.CHP_REQUIRE_HUMAN_LOCK;
  if (raw === undefined || raw.trim() === '') return true;
  return !['0', 'false', 'off'].includes(raw.trim().toLowerCase());
}

export interface ResolutionGateInput {
  incident: R0IncidentState;
  plan: string[];
  golden?: GoldenSource | null;
  /** Named human confirmer, when the caller carries one. */
  confirmedBy?: string;
  /** Incident-timeline refs (agent actions) the decision was made from. */
  timeline?: unknown;
  decisionId?: string;
}

export interface GateCommon {
  decisionCase: DecisionCase;
  assessment: FoundationAssessment;
  steps: PlanStep[];
}

export type GateOutcome =
  | (GateCommon & {
      outcome: 'HOLD';
      /** Why the response is held for human confirmation. */
      reason: string;
    })
  | (GateCommon & {
      outcome: 'APPLIED';
      /** True when a named confirmer locked the case before the apply. */
      lockedByHuman: boolean;
    });

export class ResolutionGate {
  constructor(private readonly ledger: ChpDecisionLedger) {}

  /**
   * Run a response plan through CHP: R0 → foundation → human lock → record.
   * Throws ChpRejection (nothing executed or persisted) on R0 HALT or a
   * fatal foundation finding.
   */
  run(input: ResolutionGateInput): GateOutcome {
    const evaluation = evaluateR0({ incident: input.incident, plan: input.plan });
    if (evaluation.verdict === 'HALT') {
      throw new ChpRejection(
        `CHP R0 gate: the response action failed ${evaluation.failed.join(', ')}`,
        evaluation
      );
    }

    const steps = parsePlan(input.plan) as PlanStep[];
    const assessment = assessFoundation({ steps, golden: input.golden ?? null });
    if (assessment.fatal) {
      throw new ChpRejection(
        `CHP foundation: ${assessment.findings[assessment.findings.length - 1]} — a plan` +
          ' contradicting the matched golden source must not be applied; fix the plan' +
          ' or update the runbook.'
      );
    }

    const decisionCase = openProvisionalLock(
      openDecisionCase({
        decision_id:
          input.decisionId ?? `resolve-${input.incident.id}-${Date.now()}`,
        title: `Resolve incident ${input.incident.id}: ${input.incident.title}`,
      })
    );

    const needsLock =
      requireHumanLock() ||
      assessment.score < GENERAL_FLOOR ||
      planHasIrreversibleVerb(steps);

    let applied: boolean;
    let lockedByHuman = false;
    let holdReason: string | undefined;
    if (needsLock && !input.confirmedBy) {
      applied = false;
      holdReason = requireHumanLock()
        ? 'CHP human lock: applying the response plan requires a named confirmer (CHP_REQUIRE_HUMAN_LOCK is ON by default)'
        : assessment.score < GENERAL_FLOOR
          ? `CHP foundation score ${assessment.score} is below the general floor ${GENERAL_FLOOR} — the plan may not self-certify; a named confirmer is required`
          : 'CHP human lock: the plan contains irreversible response verbs, which require a named confirmer';
    } else if (needsLock && input.confirmedBy) {
      applyThirdPartyValidation(decisionCase, {
        validator: input.confirmedBy,
        item: decisionCase.decision_id,
        challenge:
          'Confirm the response plan is scoped to the incident and safe to apply',
        result: 'CONFIRM',
        rationale: 'Named confirmer approved the response via the incident-commander API',
      });
      applied = true;
      lockedByHuman = true;
    } else {
      // Flag off, score at/above the floor, no irreversible verbs: the
      // response applies on the provisional lock (self-certified within
      // policy) — mirrors the reference gate's flag-off promotion path.
      applied = true;
    }

    const record = this.ledger.append({
      decision_id: decisionCase.decision_id,
      incident_id: input.incident.id,
      title: decisionCase.title,
      session_status: decisionCase.status,
      r0_verdict: evaluation.verdict,
      r0_results: evaluation.results,
      foundation_verdict: assessment.verdict,
      foundation_score: assessment.score,
      adversary_findings: assessment.findings,
      plan: input.plan,
      golden: input.golden
        ? {
            source_type: input.golden.source_type,
            title: input.golden.title,
            similarity: input.golden.similarity,
          }
        : null,
      confirmed_by: decisionCase.confirmed_by,
      timeline: input.timeline ?? [],
      applied,
    });

    if (!applied) {
      return {
        outcome: 'HOLD',
        decisionCase,
        assessment,
        steps,
        reason: `${holdReason} (decision ${record.decision_id})`,
      };
    }
    return {
      outcome: 'APPLIED',
      decisionCase,
      assessment,
      steps,
      lockedByHuman,
    };
  }
}
