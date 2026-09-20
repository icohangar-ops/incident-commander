// Row 19: protocol health endpoint. Returns the report envelope with HTTP 200
// in both healthy and unhealthy states — dashboards poll this endpoint to
// render either state; load balancers should keep using the plain liveness
// endpoint. Handshake-level detail (reason codes, schema fingerprint) is the
// point here, not traffic-light status.
//
// Contract notes (prelint concern 3, recorded here because this is the route
// that owns the behavior):
// - "200-always" describes the PROBE OUTCOME only: a completed probe answers
//   200 with the envelope, healthy or not. This endpoint is NOT a liveness
//   probe — LB/k8s checks should hit the plain /api/health surface.
// - Authorization failures are plain HTTP 403 with no probe call; they never
//   masquerade as an unhealthy protocol.
//
// SECURITY (post-merge hardening of the HIGH finding on #4):
// 1. Shared secret — GET requires the `x-protocol-health-token` header to
//    match the PROTOCOL_HEALTH_TOKEN env var (timing-safe compare). When the
//    env var is UNSET the endpoint fails CLOSED (403, no probe): a missing
//    secret disables the endpoint rather than opening it.
// 2. Result cache — probe reports are cached in-process for
//    PROTOCOL_HEALTH_TTL_MS (default 60000) so even authorized polling
//    cannot amplify into one Bedrock InvokeModel per request.
// 3. Envelope hygiene — the JSON body never contains raw provider exception
//    text; the full error goes to server logs only.

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { probeBedrockProtocol, type ProtocolHealthReport } from '@/lib/protocol-health';

export const dynamic = 'force-dynamic';

const TOKEN_HEADER = 'x-protocol-health-token';
const DEFAULT_TTL_MS = 60_000;

let cached: { report: ProtocolHealthReport; at: number } | null = null;

function authorized(request: Request): boolean {
  const expected = process.env.PROTOCOL_HEALTH_TOKEN;
  if (!expected) return false; // fail closed when unconfigured
  const provided = request.headers.get(TOKEN_HEADER) ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 403 });
  }
  const ttlMs = Number(process.env.PROTOCOL_HEALTH_TTL_MS ?? DEFAULT_TTL_MS);
  if (cached && Date.now() - cached.at < ttlMs) {
    return NextResponse.json(cached.report);
  }
  try {
    const report = await probeBedrockProtocol();
    cached = { report, at: Date.now() };
    return NextResponse.json(report);
  } catch (e) {
    // Full detail to server logs only — the public envelope stays generic.
    console.error('[protocol-health] probe crashed:', e);
    return NextResponse.json({
      protocol: 'bedrock-invoke',
      healthy: false,
      reason_code: 'UNKNOWN',
      reason: 'Unclassified Bedrock failure — inspect application logs.',
      checked_at: new Date().toISOString(),
      schema_fingerprint: null,
    });
  }
}
