// Rows 18/19/20: degradation ladder, degraded scaffold, evidence-carrying
// confidence, and Bedrock failure classification.

import { describe, it, expect, afterEach } from 'bun:test';
import { runDegradationLadder, type DegradationTier } from './degradation';
import { buildDegradedScaffold } from './scaffold';
import { composeConfidence, type ConfidenceFactor } from './confidence';
import { classifyBedrockError } from './bedrock';
import { probeBedrockProtocol } from './protocol-health';

describe('runDegradationLadder', () => {
  it('returns primary output and stops without running later tiers', async () => {
    let secondRan = false;
    const tiers: DegradationTier[] = [
      { name: 'primary', run: async () => 'model output' },
      { name: 'degraded-scaffold', run: async () => { secondRan = true; return 'scaffold'; } },
    ];
    const result = await runDegradationLadder(tiers);
    expect(result.level).toBe('primary');
    expect(result.text).toBe('model output');
    expect(result.tierUsed).toBe('primary');
    expect(secondRan).toBe(false);
  });

  it('falls through to the degraded tier and records every attempt', async () => {
    const tiers: DegradationTier[] = [
      { name: 'primary', run: async () => { throw new Error('Bedrock unavailable (THROTTLED): slow down'); } },
      { name: 'degraded-scaffold', run: async () => 'scaffold output' },
    ];
    const result = await runDegradationLadder(tiers);
    expect(result.level).toBe('degraded');
    expect(result.text).toBe('scaffold output');
    expect(result.tierUsed).toBe('degraded-scaffold');
    expect(result.attempts).toEqual([
      { tier: 'primary', ok: false, reason: 'Bedrock unavailable (THROTTLED): slow down' },
      { tier: 'degraded-scaffold', ok: true },
    ]);
  });

  it('treats an empty result as a failure, not a success', async () => {
    const tiers: DegradationTier[] = [
      { name: 'primary', run: async () => '   ' },
      { name: 'degraded-scaffold', run: async () => 'scaffold output' },
    ];
    const result = await runDegradationLadder(tiers);
    expect(result.level).toBe('degraded');
    expect(result.attempts[0]).toEqual({ tier: 'primary', ok: false, reason: 'empty output' });
  });

  it('reports unavailable with all attempts when every tier fails', async () => {
    const tiers: DegradationTier[] = [
      { name: 'primary', run: async () => { throw new Error('boom'); } },
      { name: 'degraded-scaffold', run: async () => '' },
    ];
    const result = await runDegradationLadder(tiers);
    expect(result.text).toBeNull();
    expect(result.level).toBe('unavailable');
    expect(result.tierUsed).toBeNull();
    expect(result.attempts).toHaveLength(2);
  });
});

describe('buildDegradedScaffold', () => {
  const ctx = { title: 'Checkout 503 spike', description: 'p95 latency tripled after the payments deploy', source: 'pagerduty' };

  it('echoes the real incident and marks itself as degraded, for every agent type', () => {
    for (const agentType of ['triage', 'investigation', 'resolution', 'post-mortem'] as const) {
      const parsed = JSON.parse(buildDegradedScaffold(agentType, ctx));
      expect(parsed._degraded.reason).toBe('bedrock_unavailable');
      expect(parsed._degraded.note).toContain('NOT model analysis');
      expect(JSON.stringify(parsed)).toContain('Checkout 503 spike');
    }
  });

  it('never guesses severity or classification in the triage scaffold', () => {
    const parsed = JSON.parse(buildDegradedScaffold('triage', ctx));
    expect(parsed.severity).toBeNull();
    expect(parsed.classification).toBeNull();
  });

  it('contains no fabricated incident specifics', () => {
    const all = (['triage', 'investigation', 'resolution', 'post-mortem'] as const)
      .map(t => buildDegradedScaffold(t, ctx))
      .join('\n');
    // The removed canned fallback invented these; their absence is the point.
    expect(all).not.toContain('v2.5.0');
    expect(all).not.toContain('v2.4.9');
    expect(all).not.toContain('connection pool');
    expect(all).not.toContain('$8,000');
    expect(all).not.toContain('auth-service');
  });

  it('marks undetermined root causes explicitly', () => {
    const inv = JSON.parse(buildDegradedScaffold('investigation', ctx));
    expect(inv.root_cause_hypothesis).toContain('Root cause NOT determined.');
    const pm = JSON.parse(buildDegradedScaffold('post-mortem', ctx));
    expect(pm.impact_assessment).toContain('NOT ASSESSED');
  });
});

describe('composeConfidence', () => {
  it('clamps each factor to its cap', () => {
    const factors: ConfidenceFactor[] = [
      { name: 'big', score: 999, cap: 30, evidence: ['over the cap'] },
      { name: 'small', score: 5, cap: 10, evidence: [] },
    ];
    const composed = composeConfidence(factors);
    expect(composed.score).toBe(35);
  });

  it('ignores non-positive factors', () => {
    const composed = composeConfidence([
      { name: 'zero', score: 0, cap: 25, evidence: ['nothing'] },
      { name: 'negative', score: -10, cap: 25, evidence: [] },
      { name: 'real', score: 20, cap: 25, evidence: [] },
    ]);
    expect(composed.score).toBe(20);
    expect(composed.band).toBe('LOW');
  });

  it('draws the bands at 80 and 60', () => {
    const at = (score: number): string =>
      composeConfidence([{ name: 'only', score, cap: 100, evidence: [] }]).band;
    expect(at(80)).toBe('HIGH');
    expect(at(79)).toBe('MEDIUM');
    expect(at(60)).toBe('MEDIUM');
    expect(at(59)).toBe('LOW');
  });

  it('clamps the composed score to 100', () => {
    const composed = composeConfidence([{ name: 'huge', score: 500, cap: 500, evidence: [] }]);
    expect(composed.score).toBe(100);
  });
});

describe('classifyBedrockError', () => {
  const savedId = process.env.AWS_ACCESS_KEY_ID;
  const savedKey = process.env.AWS_SECRET_ACCESS_KEY;

  afterEach(() => {
    if (savedId === undefined) delete process.env.AWS_ACCESS_KEY_ID; else process.env.AWS_ACCESS_KEY_ID = savedId;
    if (savedKey === undefined) delete process.env.AWS_SECRET_ACCESS_KEY; else process.env.AWS_SECRET_ACCESS_KEY = savedKey;
  });

  it('maps known failure shapes to reason codes', () => {
    process.env.AWS_ACCESS_KEY_ID = 'x';
    process.env.AWS_SECRET_ACCESS_KEY = 'y';
    expect(classifyBedrockError({ name: 'AccessDeniedException', message: 'User is not authorized' })).toBe('AUTH_DENIED');
    expect(classifyBedrockError({ name: 'ThrottlingException', message: 'rate exceeded' })).toBe('THROTTLED');
    expect(classifyBedrockError({ name: 'ValidationException', message: 'model not found in this region' })).toBe('MODEL_NOT_FOUND');
    expect(classifyBedrockError({ name: 'AWSCogressoError', message: 'socket hang up' })).toBe('NETWORK');
    expect(classifyBedrockError({ name: 'SomethingElse', message: 'totally novel' })).toBe('UNKNOWN');
  });

  it('reports missing credentials before inspecting the error', () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    expect(classifyBedrockError({ name: 'AccessDeniedException', message: 'anything' })).toBe('CREDENTIALS_MISSING');
  });
});

describe('probeBedrockProtocol', () => {
  const savedId = process.env.AWS_ACCESS_KEY_ID;
  const savedKey = process.env.AWS_SECRET_ACCESS_KEY;

  afterEach(() => {
    if (savedId === undefined) delete process.env.AWS_ACCESS_KEY_ID; else process.env.AWS_ACCESS_KEY_ID = savedId;
    if (savedKey === undefined) delete process.env.AWS_SECRET_ACCESS_KEY; else process.env.AWS_SECRET_ACCESS_KEY = savedKey;
  });

  it('fails fast with CREDENTIALS_MISSING and zero latency when no keys are configured', async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    const report = await probeBedrockProtocol();
    expect(report.healthy).toBe(false);
    expect(report.reason_code).toBe('CREDENTIALS_MISSING');
    expect(report.latency_ms).toBe(0);
    expect(report.schema_fingerprint).toBeNull();
    expect(report.protocol).toBe('bedrock-invoke');
  });
});
