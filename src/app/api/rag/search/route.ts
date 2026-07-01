import { NextRequest, NextResponse } from 'next/server';
import { searchSimilar } from '@/lib/agents';

export async function POST(req: NextRequest) {
  try {
    const { query: queryText, limit = 5 } = await req.json();
    if (!queryText) {
      return NextResponse.json({ error: 'Query text is required' }, { status: 400 });
    }
    const results = await searchSimilar(queryText, limit);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('POST /api/rag/search error:', error);
    return NextResponse.json({ error: 'RAG search failed' }, { status: 500 });
  }
}