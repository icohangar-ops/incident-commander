import { query, rowToAction, rowToIncident } from './cockroachdb';
import { invokeClaude, invokeClaudeJSON, type BedrockMessage } from './bedrock';
import { uploadArtifact } from './s3';
import type { Incident, AgentAction, RAGResult } from './types';

// Generate a simple deterministic embedding for text (normalized)
// In production, this would use OpenAI/Titan embeddings
function textToEmbedding(text: string): number[] {
  const dims = 1536;
  const embedding = new Array(dims).fill(0);
  // Hash-based deterministic embedding
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
    const idx = Math.abs(hash) % dims;
    embedding[idx] += (char / 255) * 0.1;
  }
  // Spread to all dimensions based on text characteristics
  const words = text.toLowerCase().split(/\s+/);
  words.forEach((word, wi) => {
    for (let ci = 0; ci < word.length; ci++) {
      const idx = ((word.charCodeAt(ci) * 31 + wi * 7 + ci * 13) % dims + dims) % dims;
      embedding[idx] += 0.05;
    }
  });
  // Normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
  return embedding.map(v => v / magnitude);
}

export function generateEmbedding(text: string): number[] {
  return textToEmbedding(text);
}

export async function storeEmbedding(
  incidentId: string,
  content: string,
  chunkType: string = 'description'
) {
  const embedding = generateEmbedding(content);
  const vecStr = `[${embedding.join(',')}]`;
  await query(
    `INSERT INTO incident_embeddings (incident_id, content_chunk, embedding, chunk_type) VALUES ($1, $2, $3:::vector, $4)`,
    [incidentId, content, vecStr, chunkType]
  );
}

export async function searchSimilar(
  queryText: string,
  limit: number = 5
): Promise<RAGResult[]> {
  const embedding = generateEmbedding(queryText);
  const vecStr = `[${embedding.join(',')}]`;

  // Search incidents
  const incResult = await query(
    `SELECT ie.id, ie.incident_id, ie.content_chunk, ie.chunk_type, ie.created_at,
            i.title, 1 - (ie.embedding <=> $1:::vector) as similarity
     FROM incident_embeddings ie
     JOIN incidents i ON ie.incident_id = i.id
     ORDER BY ie.embedding <=> $1:::vector
     LIMIT $2`,
    [vecStr, limit]
  );

  // Search runbooks
  const rbResult = await query(
    `SELECT id, title, content, created_at,
            1 - (embedding <=> $1:::vector) as similarity
     FROM runbooks
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1:::vector
     LIMIT $2`,
    [vecStr, limit]
  );

  const results: RAGResult[] = [];

  for (const row of incResult.rows) {
    results.push({
      id: (row as Record<string, unknown>).id as string,
      content: (row as Record<string, unknown>).content_chunk as string,
      similarity: (row as Record<string, unknown>).similarity as number,
      source_type: 'incident',
      source_id: (row as Record<string, unknown>).incident_id as string,
      title: (row as Record<string, unknown>).title as string,
      chunk_type: (row as Record<string, unknown>).chunk_type as string,
      created_at: (row as Record<string, unknown>).created_at as string,
    });
  }

  for (const row of rbResult.rows) {
    results.push({
      id: (row as Record<string, unknown>).id as string,
      content: (row as Record<string, unknown>).content as string,
      similarity: (row as Record<string, unknown>).similarity as number,
      source_type: 'runbook',
      source_id: (row as Record<string, unknown>).id as string,
      title: (row as Record<string, unknown>).title as string,
      created_at: (row as Record<string, unknown>).created_at as string,
    });
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

// === AGENT IMPLEMENTATIONS ===

interface TriageResult {
  severity: string;
  classification: string;
  initial_assessment: string;
  recommended_actions: string[];
}

export async function runTriageAgent(incidentId: string): Promise<{ action: AgentAction; incident: Incident; ragResults: RAGResult[] }> {
  const start = Date.now();
  const incResult = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  const incident = rowToIncident(incResult.rows[0] as Record<string, unknown>);

  // 1. Store embedding for RAG
  await storeEmbedding(incidentId, `${incident.title} ${incident.description}`, 'description');

  // 2. RAG search for similar past incidents
  const ragResults = await searchSimilar(`${incident.title} ${incident.description}`, 5);

  // 3. Build context from RAG
  const context = ragResults.length > 0
    ? `\n\nSimilar past incidents for reference:\n${ragResults.map((r, i) =>
        `[${i + 1}] (${r.source_type}: ${r.title || 'N/A'}, similarity: ${r.similarity.toFixed(3)})\n${r.content.substring(0, 300)}`
      ).join('\n\n')}`
    : '\n\nNo similar past incidents found. This is a new type of incident.';

  // 4. Call Claude via Bedrock
  const systemPrompt = `You are a senior SRE triage agent for Incident Commander. Analyze the incident and provide:
1. Severity classification (critical/high/medium/low)
2. Incident category/type
3. Initial assessment
4. Recommended immediate actions (2-4 specific steps)

You have access to historical incident data via RAG. Use it to inform your triage decision.`;

  const messages: BedrockMessage[] = [
    { role: 'user', content: `Incident Report:\nTitle: ${incident.title}\nDescription: ${incident.description}\nSource: ${incident.source}${context}` }
  ];

  const triageResult = await invokeClaudeJSON<TriageResult>(systemPrompt, messages);

  // 5. Update incident
  const newSeverity = (['critical', 'high', 'medium', 'low'].includes(triageResult.severity?.toLowerCase())
    ? triageResult.severity.toLowerCase()
    : incident.severity) as Incident['severity'];

  await query(
    `UPDATE incidents SET severity = $1, status = 'investigating', agent_notes = $2, updated_at = now() WHERE id = $3`,
    [newSeverity, `Triage: ${triageResult.initial_assessment}\nClassification: ${triageResult.classification}\nRecommended: ${triageResult.recommended_actions.join(', ')}`, incidentId]
  );

  // 6. Log agent action
  const duration = Date.now() - start;
  const actionResult = await query(
    `INSERT INTO agent_actions (incident_id, agent_type, action, input_data, output_data, status, duration_ms) VALUES ($1, 'triage', 'triage_incident', $2, $3, 'completed', $4) RETURNING *`,
    [incidentId, JSON.stringify({ title: incident.title, description: incident.description }), JSON.stringify(triageResult), duration]
  );

  // 7. Upload to S3
  await uploadArtifact(
    `incidents/${incidentId}/triage.json`,
    JSON.stringify({ incident, triageResult, ragResults, timestamp: new Date().toISOString() }, null, 2)
  );

  const updatedInc = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  return {
    action: rowToAction(actionResult.rows[0] as Record<string, unknown>),
    incident: rowToIncident(updatedInc.rows[0] as Record<string, unknown>),
    ragResults,
  };
}

interface InvestigationResult {
  findings: string[];
  root_cause_hypothesis: string;
  investigation_steps: string[];
  relevant_runbooks: string[];
}

export async function runInvestigationAgent(incidentId: string): Promise<{ action: AgentAction; incident: Incident; ragResults: RAGResult[] }> {
  const start = Date.now();
  const incResult = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  const incident = rowToIncident(incResult.rows[0] as Record<string, unknown>);

  // Get previous agent actions for context
  const actionsResult = await query(
    'SELECT * FROM agent_actions WHERE incident_id = $1 ORDER BY created_at', [incidentId]
  );
  const prevActions = actionsResult.rows.map(r => rowToAction(r as Record<string, unknown>));

  // RAG search with enriched context
  const ragResults = await searchSimilar(
    `${incident.title} ${incident.description} ${incident.agent_notes || ''} investigation root cause`,
    8
  );

  const systemPrompt = `You are an expert investigation agent. Analyze the incident, review previous triage results, and search the knowledge base to determine root cause and investigation steps.

Previous agent actions provide context. RAG results contain similar past incidents and runbooks.`;

  const prevContext = prevActions.map(a => `[${a.agent_type}] ${a.action}: ${a.output_data || 'N/A'}`).join('\n');
  const ragContext = ragResults.map((r, i) =>
    `[${i + 1}] (${r.source_type}: ${r.title || 'N/A'})\n${r.content.substring(0, 400)}`
  ).join('\n\n');

  const messages: BedrockMessage[] = [
    { role: 'user', content: `Incident: ${incident.title}\nSeverity: ${incident.severity}\nDescription: ${incident.description}\nAgent notes: ${incident.agent_notes || 'None'}\n\nPrevious actions:\n${prevContext}\n\nKnowledge base (RAG):\n${ragContext || 'No similar results found.'}` }
  ];

  const investigationResult = await invokeClaudeJSON<InvestigationResult>(systemPrompt, messages);

  // Update incident status
  await query(
    `UPDATE incidents SET status = 'resolving', agent_notes = $1, updated_at = now() WHERE id = $2`,
    [`${incident.agent_notes || ''}\n\nInvestigation:\nFindings: ${investigationResult.findings.join('; ')}\nRoot cause: ${investigationResult.root_cause_hypothesis}\nSteps: ${investigationResult.investigation_steps.join('; ')}`, incidentId]
  );

  const duration = Date.now() - start;
  const actionResult = await query(
    `INSERT INTO agent_actions (incident_id, agent_type, action, input_data, output_data, status, duration_ms) VALUES ($1, 'investigation', 'investigate_incident', $2, $3, 'completed', $4) RETURNING *`,
    [incidentId, JSON.stringify({ incident_id: incidentId, rag_count: ragResults.length }), JSON.stringify(investigationResult), duration]
  );

  await uploadArtifact(
    `incidents/${incidentId}/investigation.json`,
    JSON.stringify({ incident, investigationResult, ragResults, timestamp: new Date().toISOString() }, null, 2)
  );

  const updatedInc = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  return {
    action: rowToAction(actionResult.rows[0] as Record<string, unknown>),
    incident: rowToIncident(updatedInc.rows[0] as Record<string, unknown>),
    ragResults,
  };
}

interface ResolutionResult {
  resolution_plan: string[];
  executed_steps: string[];
  resolution_summary: string;
  follow_up_actions: string[];
}

export async function runResolutionAgent(incidentId: string): Promise<{ action: AgentAction; incident: Incident }> {
  const start = Date.now();
  const incResult = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  const incident = rowToIncident(incResult.rows[0] as Record<string, unknown>);

  const actionsResult = await query(
    'SELECT * FROM agent_actions WHERE incident_id = $1 ORDER BY created_at', [incidentId]
  );
  const prevActions = actionsResult.rows.map(r => rowToAction(r as Record<string, unknown>));

  const systemPrompt = `You are an automated resolution agent. Based on the investigation findings and incident context, execute a resolution plan. Provide concrete steps that were "executed" and a summary of the resolution.`;

  const prevContext = prevActions.map(a => `[${a.agent_type}] ${a.output_data || ''}`).join('\n\n');

  const messages: BedrockMessage[] = [
    { role: 'user', content: `Incident: ${incident.title}\nSeverity: ${incident.severity}\nDescription: ${incident.description}\n\nAgent history:\n${prevContext}` }
  ];

  const resolutionResult = await invokeClaudeJSON<ResolutionResult>(systemPrompt, messages);

  await query(
    `UPDATE incidents SET status = 'resolved', resolution_summary = $1, resolved_at = now(), updated_at = now() WHERE id = $2`,
    [resolutionResult.resolution_summary, incidentId]
  );

  // Store resolution embedding for future RAG
  await storeEmbedding(incidentId, `Resolution: ${resolutionResult.resolution_summary}`, 'resolution');

  const duration = Date.now() - start;
  const actionResult = await query(
    `INSERT INTO agent_actions (incident_id, agent_type, action, input_data, output_data, status, duration_ms) VALUES ($1, 'resolution', 'resolve_incident', $2, $3, 'completed', $4) RETURNING *`,
    [incidentId, JSON.stringify({ incident_id: incidentId }), JSON.stringify(resolutionResult), duration]
  );

  await uploadArtifact(
    `incidents/${incidentId}/resolution.json`,
    JSON.stringify({ incident, resolutionResult, timestamp: new Date().toISOString() }, null, 2)
  );

  const updatedInc = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  return {
    action: rowToAction(actionResult.rows[0] as Record<string, unknown>),
    incident: rowToIncident(updatedInc.rows[0] as Record<string, unknown>),
  };
}

interface PostMortemResult {
  timeline: string[];
  root_cause: string;
  impact_assessment: string;
  lessons_learned: string[];
  action_items: string[];
  prevention_measures: string[];
}

export async function runPostMortemAgent(incidentId: string): Promise<{ action: AgentAction; incident: Incident }> {
  const start = Date.now();
  const incResult = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  const incident = rowToIncident(incResult.rows[0] as Record<string, unknown>);

  const actionsResult = await query(
    'SELECT * FROM agent_actions WHERE incident_id = $1 ORDER BY created_at', [incidentId]
  );
  const prevActions = actionsResult.rows.map(r => rowToAction(r as Record<string, unknown>));

  const systemPrompt = `You are a post-mortem analysis agent. Review the entire incident lifecycle (triage → investigation → resolution) and produce a comprehensive post-mortem document. Include timeline, root cause, impact, lessons learned, and prevention measures.`;

  const fullHistory = prevActions.map(a => `[${a.agent_type}] (${a.status}, ${a.duration_ms || '?'}ms)\nAction: ${a.action}\nOutput: ${a.output_data || 'N/A'}`).join('\n\n');

  const messages: BedrockMessage[] = [
    { role: 'user', content: `Incident: ${incident.title}\nSeverity: ${incident.severity}\nResolved: ${incident.resolved_at}\nResolution: ${incident.resolution_summary}\n\nFull agent history:\n${fullHistory}` }
  ];

  const postMortemResult = await invokeClaudeJSON<PostMortemResult>(systemPrompt, messages, 3000);

  await query(
    `UPDATE incidents SET status = 'post_mortem', agent_notes = $1, updated_at = now() WHERE id = $2`,
    [`${incident.agent_notes || ''}\n\nPost-Mortem:\nRoot cause: ${postMortemResult.root_cause}\nImpact: ${postMortemResult.impact_assessment}\nLessons: ${postMortemResult.lessons_learned.join('; ')}\nAction items: ${postMortemResult.action_items.join('; ')}`, incidentId]
  );

  const duration = Date.now() - start;
  const actionResult = await query(
    `INSERT INTO agent_actions (incident_id, agent_type, action, input_data, output_data, status, duration_ms) VALUES ($1, 'post_mortem', 'post_mortem_analysis', $2, $3, 'completed', $4) RETURNING *`,
    [incidentId, JSON.stringify({ incident_id: incidentId }), JSON.stringify(postMortemResult), duration]
  );

  // Upload post-mortem report to S3
  const reportMarkdown = `# Post-Mortem: ${incident.title}\n\n**Severity:** ${incident.severity}\n**Created:** ${incident.created_at}\n**Resolved:** ${incident.resolved_at}\n\n## Timeline\n${postMortemResult.timeline.map(t => `- ${t}`).join('\n')}\n\n## Root Cause\n${postMortemResult.root_cause}\n\n## Impact Assessment\n${postMortemResult.impact_assessment}\n\n## Lessons Learned\n${postMortemResult.lessons_learned.map(l => `- ${l}`).join('\n')}\n\n## Action Items\n${postMortemResult.action_items.map(a => `- [ ] ${a}`).join('\n')}\n\n## Prevention Measures\n${postMortemResult.prevention_measures.map(p => `- ${p}`).join('\n')}\n`;
  await uploadArtifact(
    `incidents/${incidentId}/postmortem.md`,
    reportMarkdown,
    'text/markdown'
  );

  await query(
    `INSERT INTO s3_artifacts (incident_id, artifact_type, s3_key, s3_bucket, description) VALUES ($1, 'post_mortem', $2, $3, $4)`,
    [incidentId, `incidents/${incidentId}/postmortem.md`, process.env.S3_BUCKET, `Post-mortem report for ${incident.title}`]
  );

  const updatedInc = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  return {
    action: rowToAction(actionResult.rows[0] as Record<string, unknown>),
    incident: rowToIncident(updatedInc.rows[0] as Record<string, unknown>),
  };
}