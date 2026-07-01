import { NextResponse } from 'next/server';
import { query, rowToRunbook } from '@/lib/cockroachdb';

export async function GET() {
  try {
    const result = await query('SELECT * FROM runbooks ORDER BY created_at DESC');
    const runbooks = result.rows.map(r => rowToRunbook(r as Record<string, unknown>));
    return NextResponse.json({ runbooks });
  } catch (error) {
    console.error('GET /api/runbooks error:', error);
    return NextResponse.json({ error: 'Failed to fetch runbooks' }, { status: 500 });
  }
}