'use client'

import { useState } from 'react'
import { Search, Loader2, AlertTriangle, BookOpen, FileText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import type { RAGResult } from '@/lib/types'

export default function RAGSearchView() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RAGResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const { toast } = useToast()

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setSearched(true)
    try {
      const res = await fetch('/api/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit: 10 }),
      })
      const data = await res.json()
      setResults(data.results || [])
    } catch {
      toast({ title: 'Error', description: 'Search failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <Search className="size-6 text-cyan-400" />
          RAG Search
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Vector similarity search across incidents and runbooks
        </p>
      </div>

      {/* Search Form */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="py-4 px-5">
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for similar incidents, runbooks, or error patterns..."
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 pl-9 focus:border-cyan-800 focus:ring-cyan-800/30"
              />
            </div>
            <Button
              type="submit"
              disabled={loading || !query.trim()}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Search
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl bg-zinc-900" />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-16 text-center">
            <Search className="size-10 mx-auto mb-3 text-zinc-700" />
            <p className="text-zinc-500 text-sm">No results found. Try a different search query.</p>
          </CardContent>
        </Card>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">{results.length} results found</p>
          {results.map((result) => (
            <Card key={result.id} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
              <CardContent className="py-4 px-5">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">
                    {result.source_type === 'incident' ? (
                      <div className="p-1.5 rounded-md bg-red-950/50">
                        <AlertTriangle className="size-3.5 text-red-400" />
                      </div>
                    ) : (
                      <div className="p-1.5 rounded-md bg-cyan-950/50">
                        <BookOpen className="size-3.5 text-cyan-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`text-[10px] ${
                        result.source_type === 'incident'
                          ? 'bg-red-950/80 text-red-400 border-red-800/50'
                          : 'bg-cyan-950/80 text-cyan-400 border-cyan-800/50'
                      } border`}>
                        {result.source_type === 'incident' ? 'Incident' : 'Runbook'}
                      </Badge>
                      {result.title && (
                        <span className="text-zinc-200 text-sm font-medium truncate">{result.title}</span>
                      )}
                      {result.chunk_type && (
                        <Badge className="bg-zinc-800 text-zinc-500 border-zinc-700 text-[10px]">
                          {result.chunk_type}
                        </Badge>
                      )}
                    </div>
                    <p className="text-zinc-400 text-sm leading-relaxed line-clamp-3">{result.content}</p>
                  </div>
                  <Badge className="shrink-0 text-xs bg-zinc-800 text-zinc-300 border-zinc-700">
                    {(result.similarity * 100).toFixed(1)}%
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!searched && !loading && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-16 text-center">
            <FileText className="size-10 mx-auto mb-3 text-zinc-700" />
            <p className="text-zinc-500 text-sm">Enter a query to search across your incident history and runbooks</p>
            <p className="text-zinc-600 text-xs mt-1">Powered by vector embeddings and semantic similarity</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}