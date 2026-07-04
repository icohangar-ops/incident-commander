import { createHmac } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Signed, append-only, tamper-evident audit ledger.
 *
 * Each record is written as a single JSON line (JSONL). Every line carries an
 * HMAC-SHA256 signature computed over the canonical JSON of the record fields
 * *plus the previous line's signature* (`prevSig`). Because each signature
 * chains the one before it, any edit, reorder, insertion or deletion of a line
 * breaks the chain from that point onward and is detected by `verify`.
 *
 * Scheme (ported from the Rust donor ledgers — cleanmandate / swarmfi-executor /
 * glacier-edge-arm / compliance-as-code-agent — and extended with prev-sig
 * chaining):
 *
 *   canonical = canonicalJson({ ts, event, actor, inputs, sources,
 *                               confidence, rationale, prevSig })
 *   sig       = hex(HMAC_SHA256(key, canonical))
 *
 * The signing key is read from `process.env.AUDIT_LEDGER_KEY`. A documented
 * insecure default is used when unset so the app and tests run out of the box;
 * production deployments MUST set a real key.
 */

/** Documented insecure default — override with AUDIT_LEDGER_KEY in production. */
export const DEFAULT_AUDIT_KEY = 'incident-commander-dev-audit-key';

/** Signature of the genesis (pre-first) record, i.e. the empty chain root. */
export const GENESIS_SIG = '';

/** Fields the caller supplies when appending a record. */
export interface AuditRecordInput {
  /** What happened, e.g. `triage_incident`, `resolve_incident`. */
  event: string;
  /** Who/what produced the decision, e.g. `triage-agent`. */
  actor: string;
  /** Inputs the decision was made from (incident id, prompt fields, ...). */
  inputs: unknown;
  /** Provenance of the decision (RAG hits, runbooks, model id, ...). */
  sources: unknown;
  /** Optional model/decision confidence in [0, 1]. */
  confidence?: number;
  /** Optional human-readable justification for the decision. */
  rationale?: string;
  /** Optional caller-supplied timestamp; defaults to now (ISO-8601). */
  ts?: string;
}

/** A fully-formed, signed ledger record as persisted on disk. */
export interface AuditRecord {
  ts: string;
  event: string;
  actor: string;
  inputs: unknown;
  sources: unknown;
  confidence?: number;
  rationale?: string;
  /** Signature of the previous line (chains the ledger). */
  prevSig: string;
  /** HMAC-SHA256 over canonicalJson(record fields + prevSig). */
  sig: string;
}

export interface VerifyResult {
  /** True when every line's signature and chain link validates. */
  intact: boolean;
  /** Zero-based index of the first bad line, or null when intact. */
  tamperedIndex: number | null;
}

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order at
 * every level so the signed bytes do not depend on insertion order. Arrays keep
 * their order (it is semantically meaningful).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function resolveKey(explicitKey?: string): string {
  return explicitKey ?? process.env.AUDIT_LEDGER_KEY ?? DEFAULT_AUDIT_KEY;
}

/**
 * Compute the signature for a record given the previous line's signature.
 * The canonical payload deliberately excludes `sig` (the field being computed)
 * but includes every other field, including `prevSig`, so the chain is bound.
 */
function computeSig(
  record: Omit<AuditRecord, 'sig'>,
  key: string
): string {
  const canonical = canonicalJson({
    ts: record.ts,
    event: record.event,
    actor: record.actor,
    inputs: record.inputs,
    sources: record.sources,
    confidence: record.confidence ?? null,
    rationale: record.rationale ?? null,
    prevSig: record.prevSig,
  });
  return createHmac('sha256', key).update(canonical).digest('hex');
}

export class AuditLedger {
  private readonly ledgerPath: string;
  private readonly key: string;

  /**
   * @param ledgerPath Absolute or cwd-relative path to the JSONL ledger file.
   * @param key Optional explicit signing key (defaults to env / dev default).
   */
  constructor(ledgerPath: string, key?: string) {
    this.ledgerPath = ledgerPath;
    this.key = resolveKey(key);
  }

  /** Signature of the last record on disk, or GENESIS_SIG for an empty ledger. */
  private lastSig(): string {
    if (!fs.existsSync(this.ledgerPath)) {
      return GENESIS_SIG;
    }
    const lines = fs
      .readFileSync(this.ledgerPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return GENESIS_SIG;
    }
    const last = JSON.parse(lines[lines.length - 1]) as AuditRecord;
    return last.sig;
  }

  /**
   * Append one signed record to the ledger and return its signature.
   * Creates the ledger file (and parent directories) on first write.
   */
  append(input: AuditRecordInput): string {
    const prevSig = this.lastSig();
    const base: Omit<AuditRecord, 'sig'> = {
      ts: input.ts ?? new Date().toISOString(),
      event: input.event,
      actor: input.actor,
      inputs: input.inputs,
      sources: input.sources,
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
      prevSig,
    };
    const sig = computeSig(base, this.key);
    const record: AuditRecord = { ...base, sig };

    const dir = path.dirname(this.ledgerPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.ledgerPath, JSON.stringify(record) + '\n');
    return sig;
  }

  /** Read every record from the ledger (empty array if the file is absent). */
  readAll(): AuditRecord[] {
    return AuditLedger.readAll(this.ledgerPath);
  }

  /** Re-walk the chain and report whether it is intact. */
  verify(): VerifyResult {
    return AuditLedger.verify(this.ledgerPath, this.key);
  }

  /** Static reader used by `verify` and callers that only have a path. */
  static readAll(ledgerPath: string): AuditRecord[] {
    if (!fs.existsSync(ledgerPath)) {
      return [];
    }
    return fs
      .readFileSync(ledgerPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as AuditRecord);
  }

  /**
   * Re-walk the chain on disk. Returns the first line index whose stored
   * signature does not match a freshly computed one, or whose `prevSig` does not
   * equal the previous line's `sig` — that is the tampered/broken point.
   */
  static verify(ledgerPath: string, key?: string): VerifyResult {
    const signingKey = resolveKey(key);
    const records = AuditLedger.readAll(ledgerPath);
    let prevSig = GENESIS_SIG;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      // Chain link: this record must reference the previous record's signature.
      if (rec.prevSig !== prevSig) {
        return { intact: false, tamperedIndex: i };
      }
      // Integrity: recomputing the HMAC must reproduce the stored signature.
      const expected = computeSig(
        {
          ts: rec.ts,
          event: rec.event,
          actor: rec.actor,
          inputs: rec.inputs,
          sources: rec.sources,
          confidence: rec.confidence,
          rationale: rec.rationale,
          prevSig: rec.prevSig,
        },
        signingKey
      );
      if (expected !== rec.sig) {
        return { intact: false, tamperedIndex: i };
      }
      prevSig = rec.sig;
    }

    return { intact: true, tamperedIndex: null };
  }
}

/** Default on-disk location for the incident-commander signed ledger. */
export function defaultLedgerPath(): string {
  return (
    process.env.AUDIT_LEDGER_PATH ??
    path.join(process.cwd(), '.audit', 'incident-ledger.jsonl')
  );
}

/** Process-wide shared ledger instance (lazy singleton). */
let sharedLedger: AuditLedger | null = null;
export function getAuditLedger(): AuditLedger {
  if (!sharedLedger) {
    sharedLedger = new AuditLedger(defaultLedgerPath());
  }
  return sharedLedger;
}
