'use client'

import { useEffect, useState, useCallback } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Calendar } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import type { Runbook } from '@/lib/types'

interface KnowledgeBaseProps {
  refreshTrigger: number
}

export default function KnowledgeBase({ refreshTrigger }: KnowledgeBaseProps) {
  const [runbooks, setRunbooks] = useState<Runbook[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchRunbooks = useCallback(async () => {
    try {
      const res = await fetch('/api/runbooks')
      const data = await res.json()
      setRunbooks(data.runbooks || [])
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch runbooks', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchRunbooks()
  }, [fetchRunbooks, refreshTrigger])

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 bg-zinc-900 mb-2" />
          <Skeleton className="h-4 w-64 bg-zinc-900" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl bg-zinc-900" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <BookOpen className="size-6 text-orange-400" />
          Knowledge Base
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Operational runbooks and procedures for incident response
        </p>
      </div>

      {runbooks.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-16 text-center">
            <BookOpen className="size-10 mx-auto mb-3 text-zinc-700" />
            <p className="text-zinc-500 text-sm">No runbooks found. Seed sample data to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {runbooks.map((runbook) => {
            const isExpanded = expandedId === runbook.id
            return (
              <Card
                key={runbook.id}
                className="bg-zinc-900 border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : runbook.id)}
              >
                <CardHeader className="pb-2 pt-4 px-5">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-zinc-100 text-sm font-semibold leading-tight flex-1">
                      {runbook.title}
                    </CardTitle>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className="bg-zinc-800 text-zinc-400 border-zinc-700 text-[10px]">
                        {runbook.category}
                      </Badge>
                      {isExpanded ? (
                        <ChevronUp className="size-4 text-zinc-500" />
                      ) : (
                        <ChevronDown className="size-4 text-zinc-500" />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-600 mt-1">
                    <Calendar className="size-3" />
                    {new Date(runbook.created_at).toLocaleDateString()}
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  {isExpanded ? (
                    <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {runbook.content}
                    </div>
                  ) : (
                    <p className="text-zinc-500 text-sm leading-relaxed line-clamp-3">
                      {runbook.content.slice(0, 150)}...
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}