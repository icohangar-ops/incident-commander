/**
 * CHP R0 evaluator — the pre-execution gate for agentic response actions.
 *
 * Gate-only port of the Consensus Hardening Protocol shape proven in
 * erp-control-plane (api/genbi/chp.py, commit 70678cc). Before a resolution
 * plan may be applied to an incident, R0 asks: "is this action scoped and
 * solvable from the incident state?" Result keys use the upstream capitalized
 * names; a FATAL key HALTs the response loop with nothing executed.
 */

export type R0Key = 'Solvable' | 'Scoped' | 'Valid' | 'Worth_it';
export type R0Result = 'PASS' | 'FATAL';
export type R0Verdict = 'PASS' | 'HALT';

export interface GateEvaluation {
  verdict: R0Verdict;
  results: Record<R0Key, R0Result>;
  /** Keys whose failure HALTed the evaluation, sorted. */
  failed: R0Key[];
}

/** Response verbs a resolution plan may use (deterministic grammar). */
export const RESPONSE_VERBS = [
  'restart', 'scale', 'rollback', 'failover', 'drain', 'reroute',
  'patch', 'deploy', 'isolate', 'clear_cache', 'throttle',
  'verify', 'inspect', 'monitor',
] as const;

/**
 * State-mutating verbs that can never auto-execute without a named human
 * confirmer — regardless of CHP_REQUIRE_HUMAN_LOCK.
 */
export const IRREVERSIBLE_VERBS = [
  'restart', 'scale', 'rollback', 'failover', 'deploy', 'patch', 'isolate',
] as const;

/** Maximum steps in a bounded response plan (R0 Scoped). */
export const MAX_PLAN_STEPS = 8;

/** Statuses from which a response action may be applied. */
const ACTIONABLE_STATUSES = new Set(['investigating', 'resolving']);

export interface PlanStep {
  verb: string;
  target: string;
  raw: string;
}

/**
 * Parse one plan line into a verb + target step. Returns null when the line
 * does not start with a legal response verb. List decorations ("1.", "-",
 * "Step 3:") are stripped first so LLM-formatted plans parse deterministically.
 */
export function parsePlanStep(raw: string): PlanStep | null {
  const text = raw
    .trim()
    .replace(/^[-*•\d.)\s]+/, '')
    .replace(/^step\s*\d+\s*[:.\-]\s*/i, '')
    .trim();
  if (!text) return null;
  const match = text.toLowerCase().match(/^[a-z][a-z0-9_]*/);
  if (!match) return null;
  const verb = match[0].replace(/-+/g, '_');
  if (!(RESPONSE_VERBS as readonly string[]).includes(verb)) return null;
  const target = text.slice(match[0].length).trim().replace(/^[\s:\-]+/, '');
  return { verb, target, raw: text };
}

export function parsePlan(plan: string[]): (PlanStep | null)[] {
  return plan.map(parsePlanStep);
}

export function planHasIrreversibleVerb(steps: PlanStep[]): boolean {
  return steps.some((s) => (IRREVERSIBLE_VERBS as readonly string[]).includes(s.verb));
}

/**
 * Significant tokens for the worth_it grounding check: lowercase runs of 4+
 * characters, minus common filler words. "API" is deliberately excluded by
 * length — the check wants component/symptom words like "gateway" or "payments".
 */
export function significantTokens(text: string): string[] {
  const STOP = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'has', 'was',
    'were', 'into', 'after', 'before', 'when', 'then', 'than', 'there',
    'their', 'been', 'being', 'also', 'some', 'such', 'which', 'while',
    'about', 'incident', 'error', 'issue', 'failed', 'failing', 'root',
    'cause', 'step', 'steps', 'action', 'actions',
  ]);
  return (text.toLowerCase().match(/[a-z][a-z0-9_.\-]{3,}/g) ?? [])
    .flatMap((t) => {
      // Compound tokens ("payments-api") also emit their parts so a plan step
      // naming "payments-api" grounds against context that says "payments".
      const parts = t.split(/[.\-_]+/).filter((p) => p.length >= 4);
      return parts.length > 0 ? parts : [t];
    })
    .filter((t) => !STOP.has(t));
}

/** The slice of incident state R0 reasons over. */
export interface R0IncidentState {
  id: string;
  status: string;
  title: string;
  description: string;
  agent_notes: string | null;
  /** True when an investigation action exists on the incident timeline. */
  has_investigation: boolean;
}

export interface R0Input {
  incident: R0IncidentState;
  plan: string[];
}

/**
 * Full R0 evaluation of a proposed response plan against the incident state.
 * - Solvable: the incident carries investigation evidence AND the plan is
 *   non-empty — a response with nothing to act from is not solvable.
 * - Scoped: the plan is bounded (1..MAX_PLAN_STEPS steps).
 * - Valid: the incident is in an actionable status AND every step parses to
 *   a legal verb + target.
 * - Worth_it: the plan is grounded in this incident's own context — it
 *   references a significant token from the title or agent notes
 *   (deterministic proxy, mirroring the reference gate's analytical regex).
 */
export function evaluateR0(input: R0Input): GateEvaluation {
  const { incident, plan } = input;
  const steps = parsePlan(plan);

  const hasEvidence = incident.has_investigation || Boolean(incident.agent_notes?.trim());
  const solvable = hasEvidence && plan.length > 0;
  const scoped = plan.length >= 1 && plan.length <= MAX_PLAN_STEPS;
  const valid = ACTIONABLE_STATUSES.has(incident.status) && steps.every((s) => s !== null);

  const contextTokens = new Set([
    ...significantTokens(incident.title),
    ...significantTokens(incident.agent_notes ?? ''),
  ]);
  const planText = steps.filter((s) => s !== null).map((s) => (s as PlanStep).raw).join(' ');
  const worthIt = plan.length > 0 && significantTokens(planText).some((t) => contextTokens.has(t));

  const results: Record<R0Key, R0Result> = {
    Solvable: solvable ? 'PASS' : 'FATAL',
    Scoped: scoped ? 'PASS' : 'FATAL',
    Valid: valid ? 'PASS' : 'FATAL',
    Worth_it: worthIt ? 'PASS' : 'FATAL',
  };
  const failed = (Object.keys(results) as R0Key[]).filter((k) => results[k] === 'FATAL');
  return { verdict: failed.length === 0 ? 'PASS' : 'HALT', results, failed };
}

export interface IncidentPreflight {
  ok: boolean;
  results: Partial<Record<R0Key, R0Result>>;
  failed: R0Key[];
}

/**
 * Cheap pre-flight subset run before the response model is even invoked: an
 * incident without investigation evidence or in a non-actionable status can
 * never ground a response action, so the loop HALTs here and saves the model
 * call. Only the criteria decidable from incident state alone are reported —
 * Scoped and Worth_it need the plan, so they are deliberately absent.
 */
export function assessIncidentActionable(incident: R0IncidentState): IncidentPreflight {
  const solvable = incident.has_investigation || Boolean(incident.agent_notes?.trim());
  const valid = ACTIONABLE_STATUSES.has(incident.status);
  const results: Partial<Record<R0Key, R0Result>> = {
    Solvable: solvable ? 'PASS' : 'FATAL',
    Valid: valid ? 'PASS' : 'FATAL',
  };
  const failed = (Object.keys(results) as R0Key[]).filter(
    (k) => results[k] === 'FATAL'
  );
  return { ok: failed.length === 0, results, failed };
}
