import { NextRequest, NextResponse } from 'next/server';
import { query, rowToIncident } from '@/lib/cockroachdb';

function isValidUiPathSecret(signature: string | null) {
  const expected = process.env.UIPATH_WEBHOOK_SECRET;
  if (!expected) return true;
  return signature === expected;
}

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get('x-uipath-signature');
    if (!isValidUiPathSecret(signature)) {
      return NextResponse.json({ error: 'Invalid UiPath signature' }, { status: 401 });
    }

    const body = await req.json();
    const title = body.title || body.subject || 'UiPath incident handoff';
    const details = [body.description, body.evidence_summary, body.attachment_name, body.source_url]
      .filter(Boolean)
      .join('\n\n');

    const result = await query(
      `INSERT INTO incidents (title, description, severity, source, status) VALUES ($1, $2, $3, $4, 'open') RETURNING *`,
      [title, details || title, body.severity || 'medium', body.source || 'uipath']
    );

    return NextResponse.json({ incident: rowToIncident(result.rows[0] as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    console.error('POST /api/uipath error:', error);
    return NextResponse.json({ error: 'Failed to ingest UiPath payload' }, { status: 500 });
  }
}
