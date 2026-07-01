import { NextRequest, NextResponse } from 'next/server';
import { runTriageAgent } from '@/lib/agents';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await runTriageAgent(id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('POST triage error:', error);
    return NextResponse.json(
      { error: 'Triage agent failed', details: String(error) },
      { status: 500 }
    );
  }
}