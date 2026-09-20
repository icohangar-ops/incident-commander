import { NextRequest, NextResponse } from 'next/server';
import { runResolutionAgent } from '@/lib/agents';
import { ChpRejection } from '@/lib/chp/session';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Optional named confirmer: when CHP requires the human lock (default ON),
    // a resolve call carrying { "confirmed_by": "..." } locks the decision
    // (PROVISIONAL_LOCK → LOCKED) and applies the response plan.
    let confirmedBy: string | undefined;
    try {
      const body = await req.json();
      if (body && typeof body === 'object' && typeof (body as { confirmed_by?: unknown }).confirmed_by === 'string') {
        const trimmed = ((body as { confirmed_by: string }).confirmed_by).trim();
        if (trimmed) confirmedBy = trimmed;
      }
    } catch {
      // No/invalid JSON body — resolve without a confirmer; the gate decides.
    }

    const result = await runResolutionAgent(id, { confirmedBy });

    // A held response is accepted-but-not-applied: HTTP 202 with the pending
    // decision, so callers can confirm it.
    const status = result.gate.applied ? 200 : 202;
    return NextResponse.json(result, { status });
  } catch (error) {
    if (error instanceof ChpRejection) {
      // CHP refusal (R0 HALT or fatal foundation finding): nothing executed.
      return NextResponse.json(
        {
          error: 'CHP gate refused the response action',
          reason: error.reason,
          gate: error.evaluation,
        },
        { status: 422 }
      );
    }
    console.error('POST resolve error:', error);
    return NextResponse.json(
      { error: 'Resolution agent failed', details: String(error) },
      { status: 500 }
    );
  }
}