import { NextRequest, NextResponse } from 'next/server';
import { query, rowToIncident, rowToAction } from '@/lib/cockroachdb';
import { searchSimilar } from '@/lib/agents';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await query('SELECT * FROM incidents WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }
    const incident = rowToIncident(result.rows[0] as Record<string, unknown>);

    const actionsResult = await query(
      'SELECT * FROM agent_actions WHERE incident_id = $1 ORDER BY created_at',
      [id]
    );
    const actions = actionsResult.rows.map(r => rowToAction(r as Record<string, unknown>));

    // Get similar incidents via RAG
    const similar = await searchSimilar(`${incident.title} ${incident.description}`, 3);

    return NextResponse.json({ incident, actions, similar });
  } catch (error) {
    console.error('GET /api/incidents/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch incident' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { title, description, severity, status } = body;

    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (title) { sets.push(`title = $${paramIdx++}`); values.push(title); }
    if (description) { sets.push(`description = $${paramIdx++}`); values.push(description); }
    if (severity) { sets.push(`severity = $${paramIdx++}`); values.push(severity); }
    if (status) { sets.push(`status = $${paramIdx++}`); values.push(status); }

    values.push(id);
    const result = await query(
      `UPDATE incidents SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    return NextResponse.json({ incident: rowToIncident(result.rows[0] as Record<string, unknown>) });
  } catch (error) {
    console.error('PATCH /api/incidents/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update incident' }, { status: 500 });
  }
}