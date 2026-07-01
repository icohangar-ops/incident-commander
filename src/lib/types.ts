export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'triaging' | 'investigating' | 'resolving' | 'resolved' | 'post_mortem';
  source: string;
  agent_notes: string | null;
  resolution_summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface AgentAction {
  id: string;
  incident_id: string;
  agent_type: 'triage' | 'investigation' | 'resolution' | 'post_mortem';
  action: string;
  input_data: string | null;
  output_data: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration_ms: number | null;
  created_at: string;
}

export interface Runbook {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface RAGResult {
  id: string;
  content: string;
  similarity: number;
  source_type: 'incident' | 'runbook';
  source_id: string;
  title?: string;
  chunk_type?: string;
  created_at?: string;
}

export interface AgentRunResult {
  action: AgentAction;
  incident: Incident;
  ragResults?: RAGResult[];
}