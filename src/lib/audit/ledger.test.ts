import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AuditLedger,
  canonicalJson,
  DEFAULT_AUDIT_KEY,
  type AuditRecord,
} from './ledger';

const TEST_KEY = 'unit-test-audit-key';

let dir: string;
let ledgerPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ledger-'));
  ledgerPath = path.join(dir, 'ledger.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function appendN(ledger: AuditLedger, n: number): string[] {
  const sigs: string[] = [];
  for (let i = 0; i < n; i++) {
    sigs.push(
      ledger.append({
        event: 'decision',
        actor: 'test-agent',
        inputs: { i, incident_id: `inc-${i}` },
        sources: [{ source_type: 'runbook', id: `rb-${i}` }],
        confidence: 0.9,
        rationale: `rationale ${i}`,
      })
    );
  }
  return sigs;
}

describe('canonicalJson', () => {
  it('is stable regardless of key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });
});

describe('AuditLedger', () => {
  it('appends N records and verify() reports intact', () => {
    const ledger = new AuditLedger(ledgerPath, TEST_KEY);
    const sigs = appendN(ledger, 5);

    const records = ledger.readAll();
    expect(records).toHaveLength(5);
    expect(sigs).toHaveLength(5);

    // First record chains from the empty genesis signature.
    expect(records[0].prevSig).toBe('');
    // Each subsequent record chains the previous line's signature.
    for (let i = 1; i < records.length; i++) {
      expect(records[i].prevSig).toBe(records[i - 1].sig);
    }

    const result = ledger.verify();
    expect(result.intact).toBe(true);
    expect(result.tamperedIndex).toBeNull();
  });

  it('detects tampering and reports the right tamperedIndex', () => {
    const ledger = new AuditLedger(ledgerPath, TEST_KEY);
    appendN(ledger, 5);

    // Tamper with the payload of line index 2 without re-signing.
    const lines = fs
      .readFileSync(ledgerPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const rec = JSON.parse(lines[2]) as AuditRecord;
    rec.rationale = 'TAMPERED — attacker rewrote the decision';
    lines[2] = JSON.stringify(rec);
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    const result = AuditLedger.verify(ledgerPath, TEST_KEY);
    expect(result.intact).toBe(false);
    expect(result.tamperedIndex).toBe(2);
  });

  it('detects a deleted line via the broken chain link', () => {
    const ledger = new AuditLedger(ledgerPath, TEST_KEY);
    appendN(ledger, 5);

    const lines = fs
      .readFileSync(ledgerPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    lines.splice(2, 1); // remove line index 2
    fs.writeFileSync(ledgerPath, lines.join('\n') + '\n');

    // The old line 3 (now at index 2) still references the deleted line's sig.
    const result = AuditLedger.verify(ledgerPath, TEST_KEY);
    expect(result.intact).toBe(false);
    expect(result.tamperedIndex).toBe(2);
  });

  it('verify() fails when the wrong key is used', () => {
    const ledger = new AuditLedger(ledgerPath, TEST_KEY);
    appendN(ledger, 3);
    const result = AuditLedger.verify(ledgerPath, 'the-wrong-key');
    expect(result.intact).toBe(false);
    expect(result.tamperedIndex).toBe(0);
  });

  it('treats an absent ledger as an empty, intact chain', () => {
    const missing = path.join(dir, 'does-not-exist.jsonl');
    expect(AuditLedger.readAll(missing)).toEqual([]);
    expect(AuditLedger.verify(missing, TEST_KEY)).toEqual({
      intact: true,
      tamperedIndex: null,
    });
  });

  it('falls back to the documented default key when none is provided', () => {
    const ledger = new AuditLedger(ledgerPath); // no explicit key, no env override
    ledger.append({ event: 'decision', actor: 'a', inputs: {}, sources: [] });
    // Re-verifying with the default key explicitly must succeed.
    expect(AuditLedger.verify(ledgerPath, DEFAULT_AUDIT_KEY).intact).toBe(true);
  });
});
