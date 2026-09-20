/**
 * CHP decision-session lifecycle (gate-only port).
 *
 * Every hardened response action opens a decision case that moves through:
 *
 *   EXPLORING → PROVISIONAL_LOCK → (third-party validation with a named
 *   confirmer) → LOCKED
 *
 * A case may never self-certify to LOCKED: only `applyThirdPartyValidation`
 * with a named human confirmer promotes a provisional decision. Ported from
 * the reference gate's SessionStatus / apply_third_party_validation shape.
 */

import type { GateEvaluation } from './r0';

/** CHP session status for an incident-response decision case. */
export type SessionStatus = 'EXPLORING' | 'PROVISIONAL_LOCK' | 'LOCKED';

/** Raised when CHP refuses a response action (R0 HALT, foundation FATAL, or lock violation). */
export class ChpRejection extends Error {
  readonly reason: string;
  readonly evaluation: GateEvaluation | null;

  constructor(reason: string, evaluation: GateEvaluation | null = null) {
    super(reason);
    this.name = 'ChpRejection';
    this.reason = reason;
    this.evaluation = evaluation;
  }
}

export interface DecisionCase {
  decision_id: string;
  title: string;
  /** CHP defines no infra/ops domain — incident response runs as general. */
  domain: 'general';
  created_at: string;
  owner: string;
  high_stakes: boolean;
  status: SessionStatus;
  locked_decisions: string[];
  confirmed_by: string | null;
}

export interface ThirdPartyValidation {
  /** Named human confirmer (e.g. an on-call engineer's id). Required. */
  validator: string;
  /** The item being confirmed — the decision id. */
  item: string;
  challenge: string;
  result: 'CONFIRM' | 'REJECT';
  rationale: string;
}

export function openDecisionCase(input: {
  decision_id: string;
  title: string;
  owner?: string;
  createdAt?: string;
}): DecisionCase {
  return {
    decision_id: input.decision_id,
    title: input.title,
    domain: 'general',
    created_at: input.createdAt ?? new Date().toISOString(),
    owner: input.owner ?? 'incident-commander',
    high_stakes: true,
    status: 'EXPLORING',
    locked_decisions: [],
    confirmed_by: null,
  };
}

/**
 * Open the hardened decision: EXPLORING → PROVISIONAL_LOCK. Every case that
 * survives R0 + foundation opens as a provisional decision pending human
 * confirmation — the response may only proceed through the same human lock,
 * never self-certify.
 */
export function openProvisionalLock(decisionCase: DecisionCase): DecisionCase {
  if (decisionCase.status !== 'EXPLORING') {
    throw new ChpRejection(
      `provisional lock requires an EXPLORING session, got ${decisionCase.status}`
    );
  }
  decisionCase.status = 'PROVISIONAL_LOCK';
  return decisionCase;
}

/**
 * Third-party confirmation: PROVISIONAL_LOCK → LOCKED, recorded on the case.
 * Approval may confirm a provisional decision, never overturn a FATAL one (a
 * FATAL case never reaches here).
 */
export function applyThirdPartyValidation(
  decisionCase: DecisionCase,
  validation: ThirdPartyValidation
): SessionStatus {
  if (decisionCase.status === 'LOCKED') {
    throw new ChpRejection('decision case is already LOCKED');
  }
  if (decisionCase.status !== 'PROVISIONAL_LOCK') {
    throw new ChpRejection(
      `third-party validation requires PROVISIONAL_LOCK, got ${decisionCase.status}`
    );
  }
  if (!validation.validator || !validation.validator.trim()) {
    throw new ChpRejection('a named human confirmer is required to lock');
  }
  if (validation.result !== 'CONFIRM') {
    throw new ChpRejection(
      `third-party validation did not confirm (got ${validation.result})`
    );
  }
  decisionCase.status = 'LOCKED';
  decisionCase.confirmed_by = validation.validator.trim();
  decisionCase.locked_decisions.push(validation.item);
  return decisionCase.status;
}
