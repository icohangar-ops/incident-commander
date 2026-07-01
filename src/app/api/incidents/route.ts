import { NextRequest, NextResponse } from 'next/server';
import { query, rowToIncident } from '@/lib/cockroachdb';

export async function GET() {
  try {
    const result = await query(
      'SELECT * FROM incidents ORDER BY created_at DESC LIMIT 50'
    );
    const incidents = result.rows.map(r => rowToIncident(r as Record<string, unknown>));

    // Get counts by status
    const counts = await query(`
      SELECT status, count(*)::int as count FROM incidents GROUP BY status
    `);
    const statusCounts: Record<string, number> = {};
    for (const row of counts.rows) {
      statusCounts[(row as Record<string, unknown>).status as string] = (row as Record<string, unknown>).count as number;
    }

    // Get counts by severity
    const sevCounts = await query(`
      SELECT severity, count(*)::int as count FROM incidents GROUP BY severity
    `);
    const severityCounts: Record<string, number> = {};
    for (const row of sevCounts.rows) {
      severityCounts[(row as Record<string, unknown>).severity as string] = (row as Record<string, unknown>).count as number;
    }

    return NextResponse.json({ incidents, statusCounts, severityCounts });
  } catch (error) {
    console.error('GET /api/incidents error:', error);
    return NextResponse.json({ error: 'Failed to fetch incidents' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, description, severity, source } = body;

    if (!title || !description) {
      return NextResponse.json({ error: 'Title and description are required' }, { status: 400 });
    }

    const result = await query(
      `INSERT INTO incidents (title, description, severity, source, status) VALUES ($1, $2, $3, $4, 'open') RETURNING *`,
      [title, description, severity || 'medium', source || 'manual']
    );

    const incident = rowToIncident(result.rows[0] as Record<string, unknown>);
    return NextResponse.json({ incident }, { status: 201 });
  } catch (error) {
    console.error('POST /api/incidents error:', error);
    return NextResponse.json({ error: 'Failed to create incident' }, { status: 500 });
  }
}