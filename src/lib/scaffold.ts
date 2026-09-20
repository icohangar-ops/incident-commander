// Row 18: the degraded tier of the incident-response ladder.
//
// Builds a JSON scaffold from the ACTUAL incident fields the agent received —
// it echoes what is known and marks everything else as requiring human/model
// analysis. It never invents root causes, timelines, severities, or dollar
// impacts. (The removed fallback fabricated an entire fictional incident:
// a named microservice version, a connection-pool regression, and a revenue
// figure, regardless of the real incident.)

export interface DegradedScaffoldContext {
  title: string;
  description: string;
  source: string;
}

export type ScaffoldableAgentType = 'triage' | 'investigation' | 'resolution' | 'post-mortem';

const DEGRADED_MARKER = {
  reason: 'bedrock_unavailable',
  note: 'Deterministic scaffold — NOT model analysis. Requires human review; no conclusions should be drawn from this placeholder.',
} as const;

/**
 * Generic, incident-independent checklists. Every action is true regardless
 * of incident specifics — no invented facts. The actions differ per agent
 * because each step of the pipeline needs different (still generic) framing.
 */
const GENERIC_ACTIONS: Record<ScaffoldableAgentType, string[]> = {
  triage: [
    'Confirm the incident report details with the reporting source',
    'Check recent deployments and configuration changes',
    'Review monitoring dashboards for correlated alert spikes',
  ],
  investigation: [
    'Collect the affected service list from monitoring',
    'Correlate alert onset times with deployment history',
    'Gather relevant runbooks from the knowledge base',
  ],
  resolution: [
    'Convene the on-call human decision maker before executing changes',
    'Document current system state before any change',
    'Prepare rollback paths for every proposed action',
  ],
  'post-mortem': [
    'Schedule the human-led post-incident review',
    'Collect the actual alert timeline from monitoring exports',
  ],
};

export function buildDegradedScaffold(
  agentType: ScaffoldableAgentType,
  ctx: DegradedScaffoldContext
): string {
  const descriptionSummary = ctx.description.trim().length > 0
    ? `${ctx.description.trim().length}-character description on file`
    : 'no description provided';
  const placeholder = `"${ctx.title}" — deterministic scaffold: no model analysis was available. ${descriptionSummary}. Source: ${ctx.source}.`;

  const body: Record<string, unknown> = { _degraded: DEGRADED_MARKER };

  switch (agentType) {
    case 'triage':
      body.severity = null; // never guessed
      body.classification = null; // never guessed
      body.initial_assessment = placeholder;
      body.recommended_actions = GENERIC_ACTIONS.triage;
      break;
    case 'investigation':
      body.findings = [];
      body.root_cause_hypothesis = placeholder + ' Root cause NOT determined.';
      body.investigation_steps = GENERIC_ACTIONS.investigation;
      body.relevant_runbooks = [];
      break;
    case 'resolution':
      body.resolution_plan = GENERIC_ACTIONS.resolution;
      body.executed_steps = [];
      body.resolution_summary = placeholder + ' No changes were made.';
      body.follow_up_actions = [];
      break;
    case 'post-mortem':
      body.timeline = [];
      body.root_cause = placeholder + ' Root cause NOT determined.';
      body.impact_assessment = 'NOT ASSESSED — requires human review; no figures are available.';
      body.lessons_learned = [];
      body.action_items = GENERIC_ACTIONS['post-mortem'];
      body.prevention_measures = [];
      break;
  }

  return JSON.stringify(body);
}
