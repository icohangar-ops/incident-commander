'use client'

import { useState } from 'react'
import { PlusCircle, Loader2, Zap, ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

interface IncidentFormProps {
  onIncidentCreated: (id: string) => void
  onBack: () => void
}

export default function IncidentForm({ onIncidentCreated, onBack }: IncidentFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('medium')
  const [source, setSource] = useState('manual')
  const [submitting, setSubmitting] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [runningTriage, setRunningTriage] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !description.trim()) {
      toast({ title: 'Validation Error', description: 'Title and description are required', variant: 'destructive' })
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), severity, source }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCreatedId(data.incident.id)
      toast({ title: 'Incident Created', description: `"${data.incident.title}" is now open` })
    } catch (err) {
      toast({ title: 'Error', description: String(err), variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRunTriage = async () => {
    if (!createdId) return
    setRunningTriage(true)
    try {
      const res = await fetch(`/api/incidents/${createdId}/triage`, { method: 'POST' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast({ title: 'Triage Complete', description: 'AI triage agent finished analysis' })
      onIncidentCreated(createdId)
    } catch (err) {
      toast({ title: 'Triage Failed', description: String(err), variant: 'destructive' })
    } finally {
      setRunningTriage(false)
    }
  }

  if (createdId) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" className="text-zinc-400 hover:text-zinc-100 -ml-2" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" /> Back to Dashboard
        </Button>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-10 px-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-950 border border-emerald-800/50 flex items-center justify-center">
              <PlusCircle className="size-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-zinc-100 mb-2">Incident Created Successfully</h2>
            <p className="text-zinc-400 text-sm mb-6">Your incident has been logged and is now in <span className="text-red-400 font-medium">open</span> status.</p>
            <div className="flex items-center justify-center gap-3">
              <Button
                onClick={handleRunTriage}
                disabled={runningTriage}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {runningTriage ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                {runningTriage ? 'Running Triage...' : 'Run Triage Agent'}
              </Button>
              <Button
                variant="outline"
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                onClick={() => onIncidentCreated(createdId)}
              >
                View Incident
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" className="text-zinc-400 hover:text-zinc-100 -ml-2 mb-2" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <PlusCircle className="size-6 text-orange-400" />
          New Incident
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Report a new incident for AI-powered triage and resolution</p>
      </div>

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Incident Details</CardTitle>
          <CardDescription className="text-zinc-500">Provide information about the incident you're reporting</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-zinc-300 text-sm">Title</Label>
              <Input
                id="title"
                placeholder="e.g., Database connection pool exhausted"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-red-800 focus:ring-red-800/30"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-zinc-300 text-sm">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe the incident in detail. Include error messages, affected services, timeline of events, and any mitigation steps already taken..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 min-h-[140px] focus:border-red-800 focus:ring-red-800/30 resize-y"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger className="w-full bg-zinc-800 border-zinc-700 text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    <SelectItem value="critical" className="text-red-400 focus:bg-red-950/50">Critical</SelectItem>
                    <SelectItem value="high" className="text-orange-400 focus:bg-orange-950/50">High</SelectItem>
                    <SelectItem value="medium" className="text-yellow-400 focus:bg-yellow-950/50">Medium</SelectItem>
                    <SelectItem value="low" className="text-zinc-400 focus:bg-zinc-800">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Source</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger className="w-full bg-zinc-800 border-zinc-700 text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="pagerduty">PagerDuty</SelectItem>
                    <SelectItem value="monitoring">Monitoring</SelectItem>
                    <SelectItem value="cloudwatch">CloudWatch</SelectItem>
                    <SelectItem value="external_report">External Report</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                disabled={submitting}
                className="bg-red-600 hover:bg-red-700 text-white w-full sm:w-auto"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <PlusCircle className="size-4" />}
                {submitting ? 'Creating...' : 'Create Incident'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}