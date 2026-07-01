import { NextRequest, NextResponse } from 'next/server';
import { runPostMortemAgent } from '@/lib/agents';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await runPostMortemAgent(id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('POST postmortem error:', error);
    return NextResponse.json(
      { error: 'Post-mortem agent failed', details: String(error) },
      { status: 500 }
    );
  }
}