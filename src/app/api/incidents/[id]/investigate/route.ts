import { NextRequest, NextResponse } from 'next/server';
import { runInvestigationAgent } from '@/lib/agents';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await runInvestigationAgent(id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('POST investigate error:', error);
    return NextResponse.json(
      { error: 'Investigation agent failed', details: String(error) },
      { status: 500 }
    );
  }
}