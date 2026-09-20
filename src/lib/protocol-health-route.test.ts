// Security regression tests for the gated /api/health/protocol route
// (HIGH finding on #4: the route previously ran a live Bedrock probe per
// unauthenticated GET and returned raw SDK exception text).
//
// The probe module is mocked so no test ever reaches AWS. Env-based auth is
// read per request, so tests manipulate PROTOCOL_HEALTH_TOKEN directly.
// PROTOCOL_HEALTH_TTL_MS=0 disables the route cache for fresh-probe tests;
// the cache test overrides it with a large TTL.

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { ProtocolHealthReport } from './protocol-health';

let probeCalls = 0;
let probeImpl: () => Promise<ProtocolHealthReport>;

mock.module('./protocol-health', () => ({
  probeBedrockProtocol: () => {
    probeCalls += 1;
    return probeImpl();
  },
}));

const { GET } = await import('../app/api/health/protocol/route');

const okReport: ProtocolHealthReport = {
  protocol: 'bedrock-invoke',
  healthy: true,
  reason_code: null,
  reason: null,
  model_id: 'anthropic.claude-sonnet-4-20250514-v1:0',
  checked_at: '2026-09-20T00:00:00.000Z',
  latency_ms: 12,
  schema_fingerprint: 'abc123',
};

const TOKEN = 'test-secret-token';
const url = 'http://localhost/api/health/protocol';

function req(headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

beforeEach(() => {
  probeCalls = 0;
  probeImpl = async () => okReport;
  process.env.PROTOCOL_HEALTH_TOKEN = TOKEN;
  process.env.PROTOCOL_HEALTH_TTL_MS = '0'; // cache off unless a test opts in
});

afterEach(() => {
  delete process.env.PROTOCOL_HEALTH_TOKEN;
  delete process.env.PROTOCOL_HEALTH_TTL_MS;
});

describe('protocol health route auth gate', () => {
  it('403s and never probes an unauthenticated request, leaking no SDK text', async () => {
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(probeCalls).toBe(0);
    const body = await res.text();
    expect(body).not.toContain('Probe crashed');
    expect(body).not.toContain('AWS');
    expect(body).not.toContain('bedrock');
  });

  it('403s a wrong token without probing', async () => {
    const res = await GET(req({ 'x-protocol-health-token': 'wrong' }));
    expect(res.status).toBe(403);
    expect(probeCalls).toBe(0);
  });

  it('fails CLOSED when PROTOCOL_HEALTH_TOKEN is unset, even with a header', async () => {
    delete process.env.PROTOCOL_HEALTH_TOKEN;
    const res = await GET(req({ 'x-protocol-health-token': 'anything' }));
    expect(res.status).toBe(403);
    expect(probeCalls).toBe(0);
  });

  it('returns the envelope with the correct token and caches within the TTL', async () => {
    process.env.PROTOCOL_HEALTH_TTL_MS = '600000';
    const res = await GET(req({ 'x-protocol-health-token': TOKEN }));
    expect(res.status).toBe(200);
    const report = (await res.json()) as ProtocolHealthReport;
    expect(report.healthy).toBe(true);
    const res2 = await GET(req({ 'x-protocol-health-token': TOKEN }));
    expect(res2.status).toBe(200);
    expect(probeCalls).toBe(1); // second hit served from the TTL cache
  });

  it('never returns raw SDK exception text when the probe crashes', async () => {
    const sdkDetail =
      'AccessDeniedException: User arn:aws:iam::123456789012:user/probe is not authorized to perform bedrock:InvokeModel';
    probeImpl = async () => {
      throw new Error(sdkDetail);
    };
    const res = await GET(req({ 'x-protocol-health-token': TOKEN }));
    expect(res.status).toBe(200); // probe outcome still answers 200
    const report = (await res.json()) as ProtocolHealthReport;
    expect(report.healthy).toBe(false);
    expect(report.reason_code).toBe('UNKNOWN');
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('arn:aws');
    expect(serialized).not.toContain('AccessDeniedException');
    expect(serialized).not.toContain('123456789012');
    expect(report.reason).toBe('Unclassified Bedrock failure — inspect application logs.');
  });
});
