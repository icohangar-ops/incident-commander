/**
 * CHP gate suite — mirrors the erp-control-plane CHP tests:
 * R0 refusal, lock flow, ledger round trip + tamper detection,
 * human-lock enforcement, response-loop integration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { evaluateR0, assessIncidentActionable, parsePlanStep } from './r0';
import { assessFoundation, GENERAL_FLOOR, FULL_SCORE } from './foundation';
import {
  applyThirdPartyValidation,
  ChpRejection,
  openDecisionCase,
  openProvisionalLock,
} from './session';
import { ChpDecisionLedger, sha256Hex } from './ledger';
import { ResolutionGate, requireHumanLock, type GateOutcome } from './gate';
import type { R0IncidentState } from './r0';
import type { GoldenSource } from './foundation';

const ACTIONABLE: R0IncidentState = {
  id: 'inc-1',
  status: 'resolving',
  title: 'Payments API latency spike',
  description: 'p99 latency over 2s on checkout',
  agent_notes: 'Root cause: cache stampede in payments service after deploy',
  has_investigation: true,
};

// Reversible plan (no irreversible verbs), grounded in the incident context.
const GOLDEN_PLAN = [
  'clear_cache on payments-api edge nodes',
  'verify the payments p99 latency returned to baseline',
];

function tmpLedger(): { ledger: ChpDecisionLedger; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-gate-'));
  return { ledger: new ChpDecisionLedger(path.join(dir, 'decisions.jsonl')), dir };
}

// Assertion helpers that narrow the GateOutcome union for TS (expect() alone
// does not narrow).
function expectHold(o: GateOutcome): asserts o is Extract<GateOutcome, { outcome: 'HOLD' }> {
  if (o.outcome !== 'HOLD') throw new Error(`expected HOLD, got ${o.outcome}`);
}
function expectApplied(o: GateOutcome): asserts o is Extract<GateOutcome, { outcome: 'APPLIED' }> {
  if (o.outcome !== 'APPLIED') throw new Error(`expected APPLIED, got ${o.outcome}`);
}

let envBackup: string | undefined;

beforeEach(() => {
  envBackup = process.env.CHP_REQUIRE_HUMAN_LOCK;
  delete process.env.CHP_REQUIRE_HUMAN_LOCK;
});

afterEach(() => {
  if (envBackup === undefined) {
    delete process.env.CHP_REQUIRE_HUMAN_LOCK;
  } else {
    process.env.CHP_REQUIRE_HUMAN_LOCK = envBackup;
  }
});

describe('R0 refusal', () => {
  it('passes a grounded, bounded plan on an actionable incident', () => {
    const evaluation = evaluateR0({ incident: ACTIONABLE, plan: GOLDEN_PLAN });
    expect(evaluation.verdict).toBe('PASS');
    expect(Object.values(evaluation.results).every((r) => r === 'PASS')).toBe(true);
  });

  it('HALTs with capitalized FATAL keys when the plan is empty (nothing to execute)', () => {
    const evaluation = evaluateR0({ incident: ACTIONABLE, plan: [] });
    expect(evaluation.verdict).toBe('HALT');
    expect(evaluation.results.Solvable).toBe('FATAL');
    expect(evaluation.results.Scoped).toBe('FATAL');
    expect(evaluation.failed).toContain('Solvable');
  });

  it('HALTs when a step uses an illegal verb (Valid FATAL)', () => {
    const evaluation = evaluateR0({
      incident: ACTIONABLE,
      plan: ['rm -rf / on payments-api', ...GOLDEN_PLAN],
    });
    expect(evaluation.verdict).toBe('HALT');
    expect(evaluation.results.Valid).toBe('FATAL');
  });

  it('HALTs an unbounded plan (> 8 steps) on Scoped', () => {
    const plan = Array.from({ length: 9 }, () => 'verify payments latency');
    const evaluation = evaluateR0({ incident: ACTIONABLE, plan });
    expect(evaluation.verdict).toBe('HALT');
    expect(evaluation.results.Scoped).toBe('FATAL');
  });

  it('HALTs a plan not grounded in the incident context (Worth_it FATAL)', () => {
    const evaluation = evaluateR0({
      incident: ACTIONABLE,
      plan: ['verify the weather station humidity reading'],
    });
    expect(evaluation.verdict).toBe('HALT');
    expect(evaluation.results.Worth_it).toBe('FATAL');
  });

  it('preflight refuses an incident with no investigation evidence before the model runs', () => {
    const preflight = assessIncidentActionable({
      ...ACTIONABLE,
      agent_notes: null,
      has_investigation: false,
    });
    expect(preflight.ok).toBe(false);
    expect(preflight.failed).toContain('Solvable');
  });

  it('preflight refuses a non-actionable status (Valid FATAL)', () => {
    const preflight = assessIncidentActionable({ ...ACTIONABLE, status: 'open' });
    expect(preflight.ok).toBe(false);
    expect(preflight.failed).toContain('Valid');
  });

  it('parses list-decorated LLM steps and rejects unknown verbs', () => {
    expect(parsePlanStep('1. clear_cache on payments-api')?.verb).toBe('clear_cache');
    expect(parsePlanStep('- restart the payments-api pod')?.verb).toBe('restart');
    expect(parsePlanStep('rm -rf the disk')).toBeNull();
  });
});

describe('lock flow', () => {
  it('walks EXPLORING → PROVISIONAL_LOCK → LOCKED with a named confirmer', () => {
    const c = openProvisionalLock(
      openDecisionCase({ decision_id: 'resolve-inc-1-1', title: 't' })
    );
    expect(c.status).toBe('PROVISIONAL_LOCK');
    const status = applyThirdPartyValidation(c, {
      validator: 'oncall@sre',
      item: 'resolve-inc-1-1',
      challenge: 'confirm safe to apply',
      result: 'CONFIRM',
      rationale: 'approved in standup',
    });
    expect(status).toBe('LOCKED');
    expect(c.confirmed_by).toBe('oncall@sre');
    expect(c.locked_decisions).toContain('resolve-inc-1-1');
  });

  it('refuses to lock without a named confirmer', () => {
    const c = openProvisionalLock(openDecisionCase({ decision_id: 'd', title: 't' }));
    expect(() =>
      applyThirdPartyValidation(c, {
        validator: '  ',
        item: 'd',
        challenge: 'c',
        result: 'CONFIRM',
        rationale: 'r',
      })
    ).toThrow(ChpRejection);
    expect(c.status).toBe('PROVISIONAL_LOCK');
  });

  it('refuses a REJECT validation and never reaches LOCKED', () => {
    const c = openProvisionalLock(openDecisionCase({ decision_id: 'd', title: 't' }));
    expect(() =>
      applyThirdPartyValidation(c, {
        validator: 'oncall@sre',
        item: 'd',
        challenge: 'c',
        result: 'REJECT',
        rationale: 'not safe',
      })
    ).toThrow(ChpRejection);
    expect(c.status).toBe('PROVISIONAL_LOCK');
  });

  it('cannot validate a case that is not PROVISIONAL_LOCK, and never double-locks', () => {
    const exploring = openDecisionCase({ decision_id: 'd', title: 't' });
    expect(() =>
      applyThirdPartyValidation(exploring, {
        validator: 'a',
        item: 'd',
        challenge: 'c',
        result: 'CONFIRM',
        rationale: 'r',
      })
    ).toThrow(ChpRejection);

    const locked = openProvisionalLock(openDecisionCase({ decision_id: 'd2', title: 't' }));
    applyThirdPartyValidation(locked, {
      validator: 'a',
      item: 'd2',
      challenge: 'c',
      result: 'CONFIRM',
      rationale: 'r',
    });
    expect(() =>
      applyThirdPartyValidation(locked, {
        validator: 'b',
        item: 'd2',
        challenge: 'c',
        result: 'CONFIRM',
        rationale: 'r',
      })
    ).toThrow(ChpRejection);
  });
});

describe('decision ledger round trip + tamper detection', () => {
  let dir: string;
  let ledger: ChpDecisionLedger;

  beforeEach(() => {
    const tmp = tmpLedger();
    dir = tmp.dir;
    ledger = tmp.ledger;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const baseInput = {
    decision_id: 'resolve-inc-1-1',
    incident_id: 'inc-1',
    title: 'Resolve incident inc-1',
    session_status: 'PROVISIONAL_LOCK' as const,
    r0_verdict: 'PASS',
    r0_results: { Solvable: 'PASS', Scoped: 'PASS', Valid: 'PASS', Worth_it: 'PASS' },
    foundation_verdict: 'PASS',
    foundation_score: 70,
    adversary_findings: ['ok'],
    plan: GOLDEN_PLAN,
    golden: null,
    confirmed_by: null,
    timeline: [{ agent_type: 'investigation', action: 'investigate_incident' }],
    applied: false,
  };

  it('round-trips a record with intact integrity and structure-only envelope', () => {
    ledger.append(baseInput);
    const [read] = ledger.list();
    expect(read.decision_id).toBe('resolve-inc-1-1');
    expect(read.envelope_valid).toBe(true);
    expect(read.integrity_valid).toBe(true);
    expect(read.timeline).toEqual([{ agent_type: 'investigation', action: 'investigate_incident' }]);
    // The envelope is structure-only: it must NOT certify the body.
    expect(read.body_sha256).toBe(sha256Hex(read.body));
  });

  it('reads back integrity_valid: false when the body is tampered with', () => {
    ledger.append(baseInput);
    const file = (ledger as unknown as { ledgerPath: string }).ledgerPath;
    const lines = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const rec = JSON.parse(lines[0]);
    // Tamper the SEALED body — the digest's integrity anchor. (The top-level
    // `plan` field is a convenience projection outside the digest by design,
    // matching the reference gate: only the body is tamper-evident.)
    rec.body = rec.body.replace('clear_cache', 'failover');
    lines[0] = JSON.stringify(rec);
    fs.writeFileSync(file, lines.join('\n') + '\n');

    const [read] = ledger.list();
    expect(read.integrity_valid).toBe(false);
    expect(read.envelope_valid).toBe(true); // structure-only envelope still parses
  });

  it('reads back envelope_valid: false for a structurally broken envelope', () => {
    ledger.append(baseInput);
    const file = (ledger as unknown as { ledgerPath: string }).ledgerPath;
    const lines = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const rec = JSON.parse(lines[0]);
    rec.envelope = { kind: 'something-else' };
    lines[0] = JSON.stringify(rec);
    fs.writeFileSync(file, lines.join('\n') + '\n');

    const [read] = ledger.list();
    expect(read.envelope_valid).toBe(false);
  });

  it('get() returns the newest record for a decision id, or null', () => {
    ledger.append(baseInput);
    expect(ledger.get('resolve-inc-1-1')?.decision_id).toBe('resolve-inc-1-1');
    expect(ledger.get('missing')).toBeNull();
  });

  it('treats an absent ledger as empty and rejects traversal paths', () => {
    expect(ledger.list()).toEqual([]);
    expect(() => new ChpDecisionLedger('../../../../etc/passwd')).toThrow(
      /Path traversal rejected/
    );
  });
});

describe('human-lock enforcement', () => {
  it('defaults CHP_REQUIRE_HUMAN_LOCK to ON', () => {
    expect(requireHumanLock()).toBe(true);
  });

  it('explicit opt-out disables the flag', () => {
    process.env.CHP_REQUIRE_HUMAN_LOCK = '0';
    expect(requireHumanLock()).toBe(false);
    process.env.CHP_REQUIRE_HUMAN_LOCK = 'false';
    expect(requireHumanLock()).toBe(false);
  });

  it('flag ON: an irreversible plan is HELD, not applied, and recorded PROVISIONAL_LOCK', () => {
    const { ledger, dir } = tmpLedger();
    try {
      const gate = new ResolutionGate(ledger);
      const outcome = gate.run({
        incident: ACTIONABLE,
        plan: ['rollback the payments-api deployment', 'verify payments p99 latency'],
        timeline: [],
      });
      expectHold(outcome);
      expect(outcome.reason).toMatch(/human lock/i);

      const [record] = ledger.list();
      expect(record.session_status).toBe('PROVISIONAL_LOCK');
      expect(record.applied).toBe(false);
      expect(record.confirmed_by).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flag ON: a named confirmer locks the case and the plan applies (LOCKED)', () => {
    const { ledger, dir } = tmpLedger();
    try {
      const gate = new ResolutionGate(ledger);
      const outcome = gate.run({
        incident: ACTIONABLE,
        plan: GOLDEN_PLAN,
        confirmedBy: 'oncall@sre',
        timeline: [],
      });
      expectApplied(outcome);
      expect(outcome.lockedByHuman).toBe(true);

      const [record] = ledger.list();
      expect(record.session_status).toBe('LOCKED');
      expect(record.applied).toBe(true);
      expect(record.confirmed_by).toBe('oncall@sre');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flag OFF: an irreversible plan is STILL held — irreversible actions never auto-execute', () => {
    process.env.CHP_REQUIRE_HUMAN_LOCK = '0';
    const { ledger, dir } = tmpLedger();
    try {
      const gate = new ResolutionGate(ledger);
      const outcome = gate.run({
        incident: ACTIONABLE,
        plan: ['restart the payments-api pods'],
        timeline: [],
      });
      expectHold(outcome);
      expect(outcome.reason).toMatch(/irreversible/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flag OFF: a reversible plan at/above the floor self-certifies on the provisional lock', () => {
    process.env.CHP_REQUIRE_HUMAN_LOCK = '0';
    const { ledger, dir } = tmpLedger();
    try {
      const gate = new ResolutionGate(ledger);
      const outcome = gate.run({
        incident: ACTIONABLE,
        plan: GOLDEN_PLAN,
        timeline: [],
      });
      expectApplied(outcome);
      expect(outcome.lockedByHuman).toBe(false);
      expect(outcome.decisionCase.status).toBe('PROVISIONAL_LOCK');
      expect(outcome.assessment.score).toBe(GENERAL_FLOOR); // 40 + 30, no golden
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('response-loop integration', () => {
  let dir: string;
  let ledger: ChpDecisionLedger;

  beforeEach(() => {
    const tmp = tmpLedger();
    dir = tmp.dir;
    ledger = tmp.ledger;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('full pipeline: R0 HALT throws and persists NOTHING', () => {
    const gate = new ResolutionGate(ledger);
    expect(() =>
      gate.run({ incident: { ...ACTIONABLE, status: 'open' }, plan: GOLDEN_PLAN })
    ).toThrow(/R0 gate/);
    expect(ledger.list()).toEqual([]);
  });

  it('full pipeline: golden parity MISMATCH is fatal and persists NOTHING', () => {
    const gate = new ResolutionGate(ledger);
    const golden: GoldenSource = {
      source_type: 'runbook',
      title: 'Payments latency runbook',
      // Documents drain/reroute only — a rollback plan contradicts it.
      content: 'procedure: drain traffic from payments-api, reroute to standby',
      similarity: 0.82,
    };
    expect(() =>
      gate.run({
        incident: ACTIONABLE,
        plan: ['rollback the payments-api deployment', 'verify payments p99 latency'],
        golden,
      })
    ).toThrow(/golden parity MISMATCH/);
    expect(ledger.list()).toEqual([]);
  });

  it('full pipeline: R0 HALT → fix → hold → confirm applies, all keyed to the incident timeline', () => {
    const gate = new ResolutionGate(ledger);
    const timeline = [
      { agent_type: 'investigation', action: 'investigate_incident', status: 'completed' },
    ];

    // First attempt: gate refuses an unbounded plan.
    expect(() =>
      gate.run({ incident: ACTIONABLE, plan: [], timeline })
    ).toThrow(ChpRejection);
    expect(ledger.list()).toEqual([]);

    // Second attempt: survivable plan, no confirmer → HOLD.
    const hold = gate.run({ incident: ACTIONABLE, plan: GOLDEN_PLAN, timeline });
    expect(hold.outcome).toBe('HOLD');
    const holdId = hold.decisionCase.decision_id;

    // Third attempt (new case): confirmer present → LOCKED + applied.
    const applied = gate.run({
      incident: ACTIONABLE,
      plan: GOLDEN_PLAN,
      confirmedBy: 'oncall@sre',
      timeline,
      decisionId: 'resolve-inc-1-3',
    });
    expect(applied.outcome).toBe('APPLIED');

    // All records key to the incident timeline.
    const records = ledger.list();
    expect(records.length).toBe(2);
    expect(records[0].decision_id).toBe('resolve-inc-1-3');
    expect(records[0].session_status).toBe('LOCKED');
    expect(records[1].decision_id).toBe(holdId);
    for (const r of records) {
      expect(r.incident_id).toBe('inc-1');
      expect(r.timeline).toEqual(timeline);
      expect(r.integrity_valid).toBe(true);
      expect(r.golden).toBeNull();
    }
  });

  it('golden parity grounds the plan: a matching runbook scores the full 100', () => {
    const gate = new ResolutionGate(ledger);
    const golden: GoldenSource = {
      source_type: 'runbook',
      title: 'Cache stampede runbook',
      content:
        'procedure: clear_cache on the payments-api edge nodes, then verify payments p99 latency',
      similarity: 0.9,
    };
    const outcome = gate.run({
      incident: ACTIONABLE,
      plan: GOLDEN_PLAN,
      golden,
      confirmedBy: 'oncall@sre',
    });
    expect(outcome.outcome).toBe('APPLIED');
    expect(outcome.assessment.score).toBe(FULL_SCORE);
    expect(outcome.assessment.parity?.within_tolerance).toBe(true);
    const [record] = ledger.list();
    expect(record.golden).toEqual({
      source_type: 'runbook',
      title: 'Cache stampede runbook',
      similarity: 0.9,
    });
  });
});
