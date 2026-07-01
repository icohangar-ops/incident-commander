'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  ArrowLeft, Loader2, Zap, ShieldCheck, Search, Wrench, FileText,
  ChevronDown, ChevronUp, ChevronRight, CheckCircle2, XCircle, Clock
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import type { Incident, AgentAction, RAGResult } from '@/lib/types'

interface IncidentDetailProps {
  incidentId: string
  onBack: () => void
  onRefresh: () => void
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay < 30) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function formatDuration(ms: number | null): string {
  if (!ms) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const severityConfig: Record<string, { color: string; bg: string }> = {
  critical: { color: 'text-red-400', bg: 'bg-red-950 border-red-800/50' },
  high: { color: 'text-orange-400', bg: 'bg-orange-950 border-orange-800/50' },
  medium: { color: 'text-yellow-400', bg: 'bg-yellow-950 border-yellow-800/50' },
  low: { color: 'text-zinc-400', bg: 'bg-zinc-800 border-zinc-700/50' },
}

const statusConfig: Record<string, { color: string; bg: string }> = {
  open: { color: 'text-red-400', bg: 'bg-red-950/80 border-red-800/50' },
  triaging: { color: 'text-yellow-400', bg: 'bg-yellow-950/80 border-yellow-800/50' },
  investigating: { color: 'text-cyan-400', bg: 'bg-cyan-950/80 border-cyan-800/50' },
  resolving: { color: 'text-purple-400', bg: 'bg-purple-950/80 border-purple-800/50' },
  resolved: { color: 'text-emerald-400', bg: 'bg-emerald-950/80 border-emerald-800/50' },
  post_mortem: { color: 'text-emerald-300', bg: 'bg-emerald-950/80 border-emerald-700/50' },
}

const agentSteps = [
  { key: 'triage', label: 'Triage', icon: ShieldCheck, color: 'text-yellow-400', bgColor: 'bg-yellow-950/50 border-yellow-800/30', activeBg: 'bg-yellow-900/20 border-yellow-700/50' },
  { key: 'investigation', label: 'Investigate', icon: Search, color: 'text-cyan-400', bgColor: 'bg-cyan-950/50 border-cyan-800/30', activeBg: 'bg-cyan-900/20 border-cyan-700/50' },
  { key: 'resolution', label: 'Resolve', icon: Wrench, color: 'text-purple-400', bgColor: 'bg-purple-950/50 border-purple-800/30', activeBg: 'bg-purple-900/20 border-purple-700/50' },
  { key: 'post_mortem', label: 'Post-Mortem', icon: FileText, color: 'text-emerald-400', bgColor: 'bg-emerald-950/50 border-emerald-800/30', activeBg: 'bg-emerald-900/20 border-emerald-700/50' },
] as const

function parseOutputData(outputData: string | null): Record<string, unknown> | null {
  if (!outputData) return null
  try {
    return JSON.parse(outputData)
  } catch {
    return null
  }
}

export default function IncidentDetail({ incidentId, onBack, onRefresh }: IncidentDetailProps) {
  const [incident, setIncident] = useState<Incident | null>(null)
  const [actions, setActions] = useState<AgentAction[]>([])
  const [similar, setSimilar] = useState<RAGResult[]>([])
  const [loading, setLoading] = useState(true)
  const [runningAgent, setRunningAgent] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const { toast } = useToast()

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/incidents/${incidentId}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setIncident(data.incident)
      setActions(data.actions || [])
      setSimilar(data.similar || [])
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [incidentId, toast])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const runAgent = async (agentKey: string) => {
    setRunningAgent(agentKey)
    toast({ title: `Running ${agentKey} agent...`, description: 'Please wait for AI analysis' })
    try {
      const res = await fetch(`/api/incidents/${incidentId}/${agentKey}`, { method: 'POST' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast({ title: 'Agent Complete', description: `${agentKey} agent finished successfully` })
      await fetchDetail()
      onRefresh()
    } catch (err) {
      toast({ title: 'Agent Failed', description: String(err), variant: 'destructive' })
    } finally {
      setRunningAgent(null)
    }
  }

  const runAllAgents = async () => {
    setRunningAll(true)
    toast({ title: 'Running Full Pipeline...', description: 'Executing all 4 agents sequentially' })
    for (const step of agentSteps) {
      setRunningAgent(step.key)
      try {
        const res = await fetch(`/api/incidents/${incidentId}/${step.key}`, { method: 'POST' })
        const data = await res.json()
        if (data.error) {
          toast({ title: `${step.label} Failed`, description: data.error, variant: 'destructive' })
          setRunningAll(false)
          setRunningAgent(null)
          await fetchDetail()
          return
        }
        toast({ title: `${step.label} Complete`, description: `Step ${agentSteps.indexOf(step) + 1}/4 done` })
        await fetchDetail()
      } catch (err) {
        toast({ title: `${step.label} Failed`, description: String(err), variant: 'destructive' })
        setRunningAll(false)
        setRunningAgent(null)
        return
      }
    }
    setRunningAll(false)
    setRunningAgent(null)
    toast({ title: 'Pipeline Complete', description: 'All agents finished successfully!' })
  }

  const getAgentStatus = (agentKey: string): 'pending' | 'running' | 'completed' | 'failed' => {
    if (runningAgent === agentKey) return 'running'
    const action = actions.find(a => a.agent_type === agentKey)
    if (!action) return 'pending'
    return action.status
  }

  const getAgentAction = (agentKey: string): AgentAction | undefined => {
    return actions.find(a => a.agent_type === agentKey)
  }

  const getPipelineProgress = () => {
    const completed = actions.filter(a => a.status === 'completed').length
    return (completed / agentSteps.length) * 100
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24 bg-zinc-900" />
        <Skeleton className="h-32 w-full rounded-xl bg-zinc-900" />
        <Skeleton className="h-40 w-full rounded-xl bg-zinc-900" />
        <Skeleton className="h-60 w-full rounded-xl bg-zinc-900" />
      </div>
    )
  }

  if (!incident) {
    return (
      <div className="text-center py-16">
        <p className="text-zinc-500">Incident not found</p>
        <Button variant="ghost" className="text-zinc-400 mt-4" onClick={onBack}>Go Back</Button>
      </div>
    )
  }

  const sev = severityConfig[incident.severity] || severityConfig.low
  const sta = statusConfig[incident.status] || statusConfig.open

  return (
    <div className="space-y-5">
      {/* Back Button */}
      <Button variant="ghost" className="text-zinc-400 hover:text-zinc-100 -ml-2" onClick={onBack}>
        <ArrowLeft className="size-4 mr-1" /> Back to Dashboard
      </Button>

      {/* Incident Header */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge className={`${sev.bg} ${sev.color} border text-xs uppercase font-bold`}>
              {incident.severity}
            </Badge>
            <Badge className={`${sta.bg} ${sta.color} border text-xs capitalize`}>
              {incident.status.replace('_', ' ')}
            </Badge>
            <span className="text-zinc-600 text-xs ml-auto font-mono">{incident.id.slice(0, 8)}</span>
          </div>
          <CardTitle className="text-zinc-100 text-xl leading-tight">{incident.title}</CardTitle>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> Created {formatRelativeTime(incident.created_at)}
            </span>
            <span>Source: <span className="text-zinc-400 font-mono">{incident.source}</span></span>
            {incident.resolved_at && (
              <span className="text-emerald-500">Resolved {formatRelativeTime(incident.resolved_at)}</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{incident.description}</p>
          {incident.agent_notes && (
            <div className="mt-4 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
              <p className="text-xs text-zinc-500 font-medium mb-1">Agent Notes</p>
              <p className="text-zinc-300 text-sm whitespace-pre-wrap">{incident.agent_notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent Pipeline */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-zinc-100 text-base flex items-center gap-2">
              <Zap className="size-4 text-orange-400" />
              Agent Pipeline
            </CardTitle>
            <Button
              size="sm"
              onClick={runAllAgents}
              disabled={runningAll}
              className="bg-red-600 hover:bg-red-700 text-white h-8 text-xs"
            >
              {runningAll ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
              {runningAll ? 'Running Pipeline...' : 'Run All Agents'}
            </Button>
          </div>
          <Progress value={getPipelineProgress()} className="mt-2 h-1.5 bg-zinc-800 [&>div]:bg-red-500" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {agentSteps.map((step, idx) => {
              const status = getAgentStatus(step.key)
              const action = getAgentAction(step.key)
              const Icon = step.icon
              const isActive = runningAgent === step.key
              return (
                <button
                  key={step.key}
                  onClick={() => !isActive && status !== 'completed' && runAgent(step.key)}
                  disabled={isActive || runningAll}
                  className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-left ${
                    status === 'completed'
                      ? 'border-emerald-800/40 bg-emerald-950/20'
                      : status === 'failed'
                      ? 'border-red-800/40 bg-red-950/20'
                      : isActive
                      ? `${step.activeBg} border`
                      : 'border-zinc-800 bg-zinc-800/30 hover:border-zinc-700 hover:bg-zinc-800/60 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {status === 'completed' ? (
                      <CheckCircle2 className="size-4 text-emerald-400" />
                    ) : status === 'failed' ? (
                      <XCircle className="size-4 text-red-400" />
                    ) : isActive ? (
                      <Loader2 className={`size-4 ${step.color} animate-spin`} />
                    ) : (
                      <Icon className={`size-4 ${step.color}`} />
                    )}
                    <span className={`text-xs font-semibold ${status === 'completed' ? 'text-emerald-400' : step.color}`}>
                      {step.label}
                    </span>
                  </div>
                  {status === 'completed' && action?.duration_ms && (
                    <span className="text-[10px] text-zinc-500">{formatDuration(action.duration_ms)}</span>
                  )}
                  {status === 'pending' && (
                    <span className="text-[10px] text-zinc-600">Click to run</span>
                  )}
                  {idx < agentSteps.length - 1 && (
                    <div className="hidden lg:block absolute -right-2 top-1/2 -translate-y-1/2 text-zinc-700 z-10">
                      <ChevronRight className="size-3" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* RAG Results Panel */}
      {similar.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-zinc-100 text-base flex items-center gap-2">
              <Search className="size-4 text-cyan-400" />
              Similar Incidents & Runbooks
            </CardTitle>
            <CardDescription className="text-zinc-500 text-xs">RAG similarity search results</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {similar.map((result) => (
                <div key={result.id} className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
                  <Badge className={`shrink-0 text-[10px] mt-0.5 ${
                    result.source_type === 'incident'
                      ? 'bg-red-950/80 text-red-400 border-red-800/50'
                      : 'bg-cyan-950/80 text-cyan-400 border-cyan-800/50'
                  } border`}>
                    {result.source_type === 'incident' ? 'Incident' : 'Runbook'}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    {result.title && (
                      <p className="text-zinc-200 text-sm font-medium truncate">{result.title}</p>
                    )}
                    <p className="text-zinc-500 text-xs mt-1 line-clamp-2">{result.content.slice(0, 200)}</p>
                  </div>
                  <Badge className="shrink-0 text-[10px] bg-zinc-800 text-zinc-400 border-zinc-700">
                    {(result.similarity * 100).toFixed(0)}%
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent Timeline */}
      {actions.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-zinc-100 text-base flex items-center gap-2">
              <Clock className="size-4 text-yellow-400" />
              Agent Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="multiple" className="space-y-2">
              {actions.map((action) => {
                const step = agentSteps.find(s => s.key === action.agent_type)
                const output = parseOutputData(action.output_data)
                const Icon = step?.icon || Clock
                return (
                  <AccordionItem
                    key={action.id}
                    value={action.id}
                    className="border-zinc-800 bg-zinc-800/30 rounded-lg px-1"
                  >
                    <AccordionTrigger className="hover:no-underline py-3 px-3">
                      <div className="flex items-center gap-3">
                        <Icon className={`size-4 ${step?.color || 'text-zinc-400'} shrink-0`} />
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-200 text-sm font-medium">{action.action}</span>
                            <Badge className={`text-[10px] ${
                              action.status === 'completed'
                                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/50'
                                : action.status === 'failed'
                                ? 'bg-red-950/80 text-red-400 border-red-800/50'
                                : 'bg-yellow-950/80 text-yellow-400 border-yellow-800/50'
                            } border`}>
                              {action.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-zinc-500 mt-0.5">
                            <span>{formatRelativeTime(action.created_at)}</span>
                            {action.duration_ms && <span>{formatDuration(action.duration_ms)}</span>}
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3">
                      {action.input_data && (
                        <div className="mb-3">
                          <p className="text-xs text-zinc-500 font-medium mb-1">Input</p>
                          <pre className="text-xs text-zinc-400 bg-zinc-900/80 rounded-lg p-3 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {(() => {
                              try { return JSON.stringify(JSON.parse(action.input_data), null, 2) } catch { return action.input_data }
                            })()}
                          </pre>
                        </div>
                      )}
                      {action.output_data && (
                        <div>
                          <p className="text-xs text-zinc-500 font-medium mb-1">Output</p>
                          <pre className="text-xs text-zinc-300 bg-zinc-900/80 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                            {(() => {
                              try { return JSON.stringify(JSON.parse(action.output_data), null, 2) } catch { return action.output_data }
                            })()}
                          </pre>
                        </div>
                      )}
                      {output && (
                        <div className="mt-2 space-y-1">
                          {output.summary && (
                            <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                              <span className="text-[10px] text-zinc-500 uppercase font-medium">Summary</span>
                              <p className="text-xs text-zinc-300 mt-0.5">{String(output.summary)}</p>
                            </div>
                          )}
                          {output.root_cause && (
                            <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                              <span className="text-[10px] text-zinc-500 uppercase font-medium">Root Cause</span>
                              <p className="text-xs text-zinc-300 mt-0.5">{String(output.root_cause)}</p>
                            </div>
                          )}
                          {output.recommendation && (
                            <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                              <span className="text-[10px] text-zinc-500 uppercase font-medium">Recommendation</span>
                              <p className="text-xs text-zinc-300 mt-0.5">{String(output.recommendation)}</p>
                            </div>
                          )}
                          {output.resolution_steps && (
                            <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                              <span className="text-[10px] text-zinc-500 uppercase font-medium">Resolution Steps</span>
                              <p className="text-xs text-zinc-300 mt-0.5 whitespace-pre-wrap">{String(output.resolution_steps)}</p>
                            </div>
                          )}
                          {output.lessons_learned && (
                            <div className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                              <span className="text-[10px] text-zinc-500 uppercase font-medium">Lessons Learned</span>
                              <p className="text-xs text-zinc-300 mt-0.5 whitespace-pre-wrap">{String(output.lessons_learned)}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {/* Resolution Summary */}
      {incident.resolution_summary && (
        <Card className="bg-zinc-900 border-emerald-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-emerald-400 text-base flex items-center gap-2">
              <CheckCircle2 className="size-4" />
              Resolution Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{incident.resolution_summary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}