import { NextRequest, NextResponse } from 'next/server';
import { runResolutionAgent } from '@/lib/agents';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await runResolutionAgent(id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('POST resolve error:', error);
    return NextResponse.json(
      { error: 'Resolution agent failed', details: String(error) },
      { status: 500 }
    );
  }
}