/**
 * CHP decision ledger — append-only JSONL keyed to the incident timeline.
 *
 * Ported from the reference gate's DecisionLedger (erp-control-plane
 * api/genbi/chp.py): each record seals a JSON `body` (canonical JSON, sorted
 * keys) with the ledger's own SHA-256 `body_sha256`. The payload envelope is
 * deliberately structure-only — it carries no content integrity — so the body
 * digest is the tamper-evidence. Reads re-validate both, exposing
 * `envelope_valid` and `integrity_valid` per record: a tampered record reads
 * back with `integrity_valid: false`.
 *
 * Each record keys to the incident timeline via `incident_id` and `timeline`
 * (the agent-action refs the decision was made from).
 *
 * The ledger path stays under cwd or the OS temp dir (traversal rejected via
 * the repo's safe-path confinement). Default location `.chp/decisions.jsonl`
 * is a gitignored runtime artifact; override with CHP_LEDGER_PATH.
 */

import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { confinePath } from '../safe-path';
import { canonicalJson } from '../audit/ledger';
import type { SessionStatus } from './session';

/** Structure-only payload envelope: describes the body, never certifies it. */
export interface PayloadEnvelope {
  kind: 'chp-payload-envelope';
  version: string;
  route: string;
  rendered_at: string;
}

export function buildPayloadEnvelope(body: string, route: string): PayloadEnvelope {
  return {
    kind: 'chp-payload-envelope',
    version: '1.0',
    route,
    rendered_at: new Date().toISOString(),
  };
}

/** Structure-only validation: shape and required fields, not content. */
export function validatePayloadEnvelope(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false;
  const env = raw as Record<string, unknown>;
  return (
    env.kind === 'chp-payload-envelope' &&
    typeof env.version === 'string' &&
    env.version.length > 0 &&
    typeof env.route === 'string' &&
    env.route.length > 0 &&
    typeof env.rendered_at === 'string'
  );
}

export interface ChpDecisionRecordInput {
  decision_id: string;
  incident_id: string;
  title: string;
  session_status: SessionStatus;
  r0_verdict: string;
  r0_results: Record<string, string>;
  foundation_verdict: string;
  foundation_score: number;
  adversary_findings: string[];
  plan: string[];
  golden: { source_type: string; title: string; similarity: number } | null;
  confirmed_by: string | null;
  /** Incident-timeline refs (agent actions) the decision was made from. */
  timeline: unknown;
  applied: boolean;
}

/** A sealed record as persisted (envelope/integrity flags filled on read). */
export interface ChpDecisionRecord extends ChpDecisionRecordInput {
  created_at: string;
  body: string;
  body_sha256: string;
  envelope: PayloadEnvelope;
  envelope_valid?: boolean;
  integrity_valid?: boolean;
}

export type CheckedDecisionRecord = ChpDecisionRecord &
  Required<Pick<ChpDecisionRecord, 'envelope_valid' | 'integrity_valid'>>;

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The sealed body for a decision: canonical JSON so the digest is stable. */
export function decisionBody(input: ChpDecisionRecordInput): string {
  return canonicalJson({
    decision_id: input.decision_id,
    incident_id: input.incident_id,
    title: input.title,
    session_status: input.session_status,
    r0_verdict: input.r0_verdict,
    r0_results: input.r0_results,
    foundation_verdict: input.foundation_verdict,
    foundation_score: input.foundation_score,
    adversary_findings: input.adversary_findings,
    plan: input.plan,
    golden: input.golden,
    confirmed_by: input.confirmed_by,
    timeline: input.timeline,
    applied: input.applied,
  });
}

function confineLedgerPath(ledgerPath: string): string {
  return confinePath(ledgerPath, [process.cwd(), os.tmpdir()]);
}

export class ChpDecisionLedger {
  private readonly ledgerPath: string;

  /**
   * @param ledgerPath Absolute or cwd-relative path to the JSONL ledger file.
   *   Confined to cwd or the OS temp dir; traversal is rejected.
   */
  constructor(ledgerPath: string) {
    this.ledgerPath = confineLedgerPath(ledgerPath);
  }

  /** Seal the body, build the structure-only envelope, and append one record. */
  append(input: ChpDecisionRecordInput): ChpDecisionRecord {
    const body = decisionBody(input);
    const record: ChpDecisionRecord = {
      ...input,
      created_at: new Date().toISOString(),
      body,
      body_sha256: sha256Hex(body),
      envelope: buildPayloadEnvelope(body, 'RESOLVE'),
    };
    const dir = path.dirname(this.ledgerPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.ledgerPath, JSON.stringify(record) + '\n');
    return record;
  }

  /** Newest-first records with envelope and body integrity re-validated on read. */
  list(limit: number = 100): CheckedDecisionRecord[] {
    return this.readAll()
      .slice(-limit)
      .reverse()
      .map((r) => ChpDecisionLedger.check(r));
  }

  get(decisionId: string): CheckedDecisionRecord | null {
    const found = this.readAll()
      .reverse()
      .find((r) => r.decision_id === decisionId);
    return found ? ChpDecisionLedger.check(found) : null;
  }

  readAll(): ChpDecisionRecord[] {
    if (!fs.existsSync(this.ledgerPath)) return [];
    return fs
      .readFileSync(this.ledgerPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as ChpDecisionRecord);
  }

  /**
   * Re-validate a record on read. The envelope check is structure-only (by
   * design); the body digest is the integrity evidence — a body edited after
   * sealing reads back with integrity_valid: false.
   */
  static check(record: ChpDecisionRecord): CheckedDecisionRecord {
    return {
      ...record,
      envelope_valid: validatePayloadEnvelope(record.envelope),
      integrity_valid: sha256Hex(record.body) === record.body_sha256,
    };
  }
}

/** Default on-disk location for the CHP decision ledger (gitignored). */
export function defaultChpLedgerPath(): string {
  const raw =
    process.env.CHP_LEDGER_PATH ??
    path.join(process.cwd(), '.chp', 'decisions.jsonl');
  return confineLedgerPath(raw);
}

/** Process-wide shared CHP ledger instance (lazy singleton). */
let sharedLedger: ChpDecisionLedger | null = null;
export function getChpDecisionLedger(): ChpDecisionLedger {
  if (!sharedLedger) {
    sharedLedger = new ChpDecisionLedger(defaultChpLedgerPath());
  }
  return sharedLedger;
}
