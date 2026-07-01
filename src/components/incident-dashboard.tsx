'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  LayoutDashboard, AlertTriangle, Eye, Clock, CheckCircle2,
  ChevronRight, Loader2, Zap, AlertCircle
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import type { Incident } from '@/lib/types'

interface DashboardProps {
  onSelectIncident: (id: string) => void
  refreshTrigger: number
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

const severityConfig: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  critical: { color: 'text-red-400', bg: 'bg-red-950 border-red-800/50', icon: <AlertCircle className="size-3 text-red-400" /> },
  high: { color: 'text-orange-400', bg: 'bg-orange-950 border-orange-800/50', icon: <AlertTriangle className="size-3 text-orange-400" /> },
  medium: { color: 'text-yellow-400', bg: 'bg-yellow-950 border-yellow-800/50', icon: <Clock className="size-3 text-yellow-400" /> },
  low: { color: 'text-zinc-400', bg: 'bg-zinc-800 border-zinc-700/50', icon: <Eye className="size-3 text-zinc-400" /> },
}

const statusConfig: Record<string, { color: string; bg: string }> = {
  open: { color: 'text-red-400', bg: 'bg-red-950/80 border-red-800/50' },
  triaging: { color: 'text-yellow-400', bg: 'bg-yellow-950/80 border-yellow-800/50' },
  investigating: { color: 'text-cyan-400', bg: 'bg-cyan-950/80 border-cyan-800/50' },
  resolving: { color: 'text-purple-400', bg: 'bg-purple-950/80 border-purple-800/50' },
  resolved: { color: 'text-emerald-400', bg: 'bg-emerald-950/80 border-emerald-800/50' },
  post_mortem: { color: 'text-emerald-300', bg: 'bg-emerald-950/80 border-emerald-700/50' },
}

export default function IncidentDashboard({ onSelectIncident, refreshTrigger }: DashboardProps) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [severityCounts, setSeverityCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [runningPipeline, setRunningPipeline] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchIncidents = useCallback(async () => {
    try {
      const res = await fetch('/api/incidents')
      const data = await res.json()
      setIncidents(data.incidents || [])
      setStatusCounts(data.statusCounts || {})
      setSeverityCounts(data.severityCounts || {})
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch incidents', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchIncidents()
  }, [fetchIncidents, refreshTrigger])

  const runAgent = async (incidentId: string, agentPath: string) => {
    try {
      const res = await fetch(`/api/incidents/${incidentId}/${agentPath}`, { method: 'POST' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      return data
    } catch (err) {
      throw err
    }
  }

  const runFullPipeline = async (incidentId: string) => {
    setRunningPipeline(incidentId)
    toast({ title: 'Pipeline Started', description: 'Running all agents sequentially...' })
    const steps = ['triage', 'investigate', 'resolve', 'postmortem']
    const stepNames: Record<string, string> = {
      triage: 'Triage', investigate: 'Investigate', resolve: 'Resolve', postmortem: 'Post-Mortem'
    }
    try {
      for (const step of steps) {
        toast({ title: `Running ${stepNames[step]} Agent...`, description: `Step ${steps.indexOf(step) + 1}/4` })
        await runAgent(incidentId, step)
      }
      toast({ title: 'Pipeline Complete', description: 'All agents finished successfully' })
      fetchIncidents()
    } catch (err) {
      toast({ title: 'Pipeline Failed', description: String(err), variant: 'destructive' })
    } finally {
      setRunningPipeline(null)
    }
  }

  const stats = [
    {
      label: 'Total Incidents',
      value: incidents.length,
      icon: <LayoutDashboard className="size-5 text-red-400" />,
      color: 'text-zinc-100',
      bg: 'bg-zinc-900',
      border: 'border-zinc-800',
    },
    {
      label: 'Open',
      value: statusCounts['open'] || 0,
      icon: <AlertCircle className="size-5 text-red-400" />,
      color: 'text-red-400',
      bg: 'bg-zinc-900',
      border: 'border-zinc-800',
    },
    {
      label: 'Investigating',
      value: (statusCounts['investigating'] || 0) + (statusCounts['triaging'] || 0) + (statusCounts['resolving'] || 0),
      icon: <Eye className="size-5 text-cyan-400" />,
      color: 'text-cyan-400',
      bg: 'bg-zinc-900',
      border: 'border-zinc-800',
    },
    {
      label: 'Resolved',
      value: (statusCounts['resolved'] || 0) + (statusCounts['post_mortem'] || 0),
      icon: <CheckCircle2 className="size-5 text-emerald-400" />,
      color: 'text-emerald-400',
      bg: 'bg-zinc-900',
      border: 'border-zinc-800',
    },
  ]

  const sevBadges = [
    { key: 'critical', label: 'Critical', color: 'bg-red-900/80 text-red-300 border-red-700/50' },
    { key: 'high', label: 'High', color: 'bg-orange-900/80 text-orange-300 border-orange-700/50' },
    { key: 'medium', label: 'Medium', color: 'bg-yellow-900/80 text-yellow-300 border-yellow-700/50' },
    { key: 'low', label: 'Low', color: 'bg-zinc-800 text-zinc-300 border-zinc-700/50' },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl bg-zinc-900" />
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-xl bg-zinc-900" />
        <Skeleton className="h-96 w-full rounded-xl bg-zinc-900" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <LayoutDashboard className="size-6 text-red-400" />
          Dashboard
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Real-time incident overview and management</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className={`${stat.bg} ${stat.border} border py-4 px-4`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{stat.label}</p>
                <p className={`text-3xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-800/50">{stat.icon}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Severity Distribution */}
      <div className="flex flex-wrap gap-2">
        {sevBadges.map((sev) => (
          <Badge key={sev.key} className={`${sev.color} border px-3 py-1 text-xs font-semibold`}>
            {sev.label}: {severityCounts[sev.key] || 0}
          </Badge>
        ))}
      </div>

      {/* Incident Table */}
      <Card className="bg-zinc-900 border-zinc-800 py-0 gap-0">
        <CardHeader className="pb-4 pt-5 px-5">
          <CardTitle className="text-zinc-100 text-base flex items-center gap-2">
            <AlertTriangle className="size-4 text-orange-400" />
            Active Incidents
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {incidents.length === 0 ? (
            <div className="py-16 text-center text-zinc-500">
              <AlertTriangle className="size-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No incidents found. Create one or seed sample data.</p>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-500 font-medium text-xs uppercase tracking-wider">Severity</TableHead>
                    <TableHead className="text-zinc-500 font-medium text-xs uppercase tracking-wider">Title</TableHead>
                    <TableHead className="text-zinc-500 font-medium text-xs uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-zinc-500 font-medium text-xs uppercase tracking-wider hidden sm:table-cell">Source</TableHead>
                    <TableHead className="text-zinc-500 font-medium text-xs uppercase tracking-wider hidden md:table-cell">Created</TableHead>
                    <TableHead className="text-zinc-500 font-medium text-xs uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.map((incident) => {
                    const sev = severityConfig[incident.severity] || severityConfig.low
                    const sta = statusConfig[incident.status] || statusConfig.open
                    const isRunning = runningPipeline === incident.id
                    return (
                      <TableRow
                        key={incident.id}
                        className="border-zinc-800 cursor-pointer group"
                        onClick={() => onSelectIncident(incident.id)}
                      >
                        <TableCell>
                          <Badge className={`${sev.bg} ${sev.color} border text-xs gap-1`}>
                            {sev.icon}
                            {incident.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-zinc-100 font-medium text-sm group-hover:text-red-400 transition-colors">
                            {incident.title}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={`${sta.bg} ${sta.color} border text-xs capitalize`}>
                            {incident.status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className="text-zinc-400 text-xs font-mono">{incident.source}</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="text-zinc-500 text-xs">{formatRelativeTime(incident.created_at)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-zinc-400 hover:text-orange-400 hover:bg-orange-950/30 h-7 px-2"
                            onClick={(e) => {
                              e.stopPropagation()
                              runFullPipeline(incident.id)
                            }}
                            disabled={isRunning}
                          >
                            {isRunning ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Zap className="size-3.5" />
                            )}
                            <span className="ml-1 text-xs hidden lg:inline">
                              {isRunning ? 'Running...' : 'Pipeline'}
                            </span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 h-7 px-2"
                            onClick={(e) => {
                              e.stopPropagation()
                              onSelectIncident(incident.id)
                            }}
                          >
                            <ChevronRight className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}