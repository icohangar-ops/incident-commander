// Row 19: protocol health endpoint. Returns the report envelope with HTTP 200
// in both healthy and unhealthy states — dashboards poll this endpoint to
// render either state; load balancers should keep using the plain liveness
// endpoint. Handshake-level detail (reason codes, schema fingerprint) is the
// point here, not traffic-light status.

import { NextResponse } from 'next/server';
import { probeBedrockProtocol } from '@/lib/protocol-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = await probeBedrockProtocol();
    return NextResponse.json(report);
  } catch (e) {
    // The probe itself must never 500: an unexpected probe error is reported
    // as an unhealthy protocol with the detail, not swallowed.
    return NextResponse.json({
      protocol: 'bedrock-invoke',
      healthy: false,
      reason_code: 'UNKNOWN',
      reason: `Probe crashed: ${(e as Error).message || String(e)}`,
      checked_at: new Date().toISOString(),
      schema_fingerprint: null,
    });
  }
}
