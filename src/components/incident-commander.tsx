'use client'

import { useState, useCallback } from 'react'
import {
  LayoutDashboard, PlusCircle, BookOpen, Search, Database,
  Menu, Loader2, Bug
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import IncidentDashboard from '@/components/incident-dashboard'
import IncidentForm from '@/components/incident-form'
import IncidentDetail from '@/components/incident-detail'
import KnowledgeBase from '@/components/knowledge-base'
import RAGSearchView from '@/components/rag-search'

type View = 'dashboard' | 'new-incident' | 'knowledge-base' | 'rag-search' | 'incident-detail'

const navItems: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
  { key: 'new-incident', label: 'New Incident', icon: <PlusCircle className="size-4" /> },
  { key: 'knowledge-base', label: 'Knowledge Base', icon: <BookOpen className="size-4" /> },
  { key: 'rag-search', label: 'RAG Search', icon: <Search className="size-4" /> },
]

export default function IncidentCommander() {
  const [currentView, setCurrentView] = useState<View>('dashboard')
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const { toast } = useToast()

  const navigateTo = useCallback((view: View, incidentId?: string) => {
    if (incidentId) setSelectedIncidentId(incidentId)
    setCurrentView(view)
    setSidebarOpen(false)
  }, [])

  const handleRefresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1)
  }, [])

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const res = await fetch('/api/seed', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast({
          title: 'Data Seeded',
          description: `${data.runbooksSeeded} runbooks and ${data.incidentsSeeded} incidents created`,
        })
        setRefreshTrigger(prev => prev + 1)
      } else {
        throw new Error('Seed failed')
      }
    } catch (err) {
      toast({ title: 'Seed Error', description: String(err), variant: 'destructive' })
    } finally {
      setSeeding(false)
    }
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-red-950 border border-red-800/50 flex items-center justify-center">
            <Bug className="size-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-zinc-100 leading-tight">Incident Commander</h1>
            <p className="text-[10px] text-zinc-500 leading-tight">AI-Powered Incident Response</p>
          </div>
        </div>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Nav Items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = currentView === item.key && !selectedIncidentId
          return (
            <button
              key={item.key}
              onClick={() => navigateTo(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-red-950/50 text-red-400 border border-red-900/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border border-transparent'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          )
        })}

        <Separator className="bg-zinc-800 my-3" />

        {/* Seed Data */}
        <button
          onClick={handleSeed}
          disabled={seeding}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent transition-all disabled:opacity-50"
        >
          {seeding ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
          {seeding ? 'Seeding...' : 'Seed Data'}
        </button>
      </nav>

      {/* Bottom Badge */}
      <div className="px-5 py-4">
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/30 px-3 py-2.5">
          <p className="text-[10px] text-zinc-500 font-medium">CockroachDB × AWS Hackathon</p>
        </div>
      </div>
    </div>
  )

  const renderView = () => {
    if (currentView === 'incident-detail' && selectedIncidentId) {
      return (
        <IncidentDetail
          incidentId={selectedIncidentId}
          onBack={() => navigateTo('dashboard')}
          onRefresh={handleRefresh}
        />
      )
    }

    switch (currentView) {
      case 'dashboard':
        return (
          <IncidentDashboard
            onSelectIncident={(id) => navigateTo('incident-detail', id)}
            refreshTrigger={refreshTrigger}
          />
        )
      case 'new-incident':
        return (
          <IncidentForm
            onIncidentCreated={(id) => navigateTo('incident-detail', id)}
            onBack={() => navigateTo('dashboard')}
          />
        )
      case 'knowledge-base':
        return <KnowledgeBase refreshTrigger={refreshTrigger} />
      case 'rag-search':
        return <RAGSearchView />
      default:
        return (
          <IncidentDashboard
            onSelectIncident={(id) => navigateTo('incident-detail', id)}
            refreshTrigger={refreshTrigger}
          />
        )
    }
  }

  return (
    <div className="min-h-screen flex bg-zinc-950">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-zinc-800 bg-zinc-950 flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 bg-zinc-950 border-zinc-800 p-0">
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        {/* Mobile Header */}
        <div className="lg:hidden sticky top-0 z-40 flex items-center gap-3 px-4 py-3 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-zinc-100 h-8 w-8">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-zinc-950 border-zinc-800 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <Bug className="size-4 text-red-400" />
            <span className="text-sm font-semibold text-zinc-100">Incident Commander</span>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          {renderView()}
        </div>
      </main>
    </div>
  )
}