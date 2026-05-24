'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { fetchRepoData, type RepoData } from '@/lib/api'
import FileTree from '@/components/FileTree'
import Chat from '@/components/Chat'
import FileViewer from '@/components/FileViewer'
import { ThemeToggle } from '@/components/ThemeProvider'

const DependencyGraph = dynamic(() => import('@/components/DependencyGraph'), { ssr: false })

type LeftPanel = 'tree' | 'graph'
type CenterPanel = 'viewer' | 'graph'

function WorkspaceInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const repoId = searchParams.get('repo_id') ?? ''

  const [data, setData]           = useState<RepoData | null>(null)
  const [error, setError]         = useState('')
  const [selectedFile, setSelectedFile]   = useState<string | null>(null)
  const [selectedLang, setSelectedLang]   = useState<string | undefined>()
  const [leftPanel, setLeftPanel]         = useState<LeftPanel>('tree')
  const [centerPanel, setCenterPanel]     = useState<CenterPanel>('graph')

  useEffect(() => {
    if (!repoId) { router.push('/'); return }
    fetchRepoData(repoId).then(setData).catch(e => setError(e.message))
  }, [repoId, router])

  function selectFile(path: string, lang?: string) {
    setSelectedFile(path)
    setSelectedLang(lang)
    setCenterPanel('viewer')
  }

  function handleCitationClick(path: string) {
    setSelectedFile(path)
    setCenterPanel('viewer')
    setLeftPanel('tree')
  }

  function handleFileSelect(path: string, lang?: string) {
    selectFile(path, lang)
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="glass rounded-3xl p-8 text-center space-y-4 max-w-sm">
        <p style={{ color: 'var(--red)' }}>{error}</p>
        <button onClick={() => router.push('/')} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          ← Back to home
        </button>
      </div>
    </div>
  )

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading workspace…</p>
      </div>
    </div>
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="glass-sm h-12 flex items-center px-4 gap-3 flex-shrink-0 z-10"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => router.push('/')}
          className="flex items-center gap-1.5 text-sm transition-all"
          style={{ color: 'var(--muted)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          CodeMap
        </button>

        <div className="h-4 w-px" style={{ background: 'var(--border)' }} />

        <div className="flex items-center gap-2 min-w-0">
          <div className="relative w-2 h-2">
            <span className="absolute inset-0 rounded-full" style={{ background: 'var(--green-text)' }} />
            <span className="absolute inset-0 rounded-full pulse-ring" style={{ background: 'var(--green-text)' }} />
          </div>
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{data.repo_name}</span>
          <span className="text-xs hidden sm:block" style={{ color: 'var(--subtle)' }}>
            {data.file_count} files · {data.chunk_count} chunks
          </span>
        </div>

        {selectedFile && (
          <>
            <div className="h-4 w-px hidden md:block" style={{ background: 'var(--border)' }} />
            <span className="text-xs font-mono truncate max-w-[220px] hidden md:block" style={{ color: 'var(--accent)' }}>
              {selectedFile}
            </span>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <a href={data.github_url} target="_blank" rel="noreferrer"
            className="hidden sm:flex items-center gap-1.5 text-xs rounded-xl px-3 py-1.5 transition-all glass-sm"
            style={{ color: 'var(--muted)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            GitHub ↗
          </a>
        </div>
      </header>

      {/* Three-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-64 flex-shrink-0 flex flex-col overflow-hidden glass-sm"
          style={{ borderRight: '1px solid var(--border)' }}>
          <div className="flex flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            {(['tree', 'graph'] as const).map(p => (
              <button key={p} onClick={() => setLeftPanel(p)}
                className="flex-1 py-2.5 text-xs font-medium transition-all"
                style={{
                  color: leftPanel === p ? 'var(--accent)' : 'var(--muted)',
                  borderBottom: leftPanel === p ? '2px solid var(--accent)' : '2px solid transparent',
                }}>
                {p === 'tree' ? 'File Tree' : 'Dep Graph'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {leftPanel === 'tree' ? (
              <FileTree files={data.tree} selectedFile={selectedFile} onSelect={(path, lang) => handleFileSelect(path, lang)} />
            ) : (
              <DependencyGraph nodes={data.graph.nodes} edges={data.graph.edges}
                selectedFile={selectedFile}
                onSelect={path => {
                  setSelectedFile(path)
                  setCenterPanel('viewer')
                }} />
            )}
          </div>
        </aside>

        {/* Center panel */}
        <main className="flex-1 flex flex-col overflow-hidden" style={{ background: 'transparent' }}>
          {/* Center panel tabs */}
          <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0 glass-sm"
            style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex gap-1">
              {(['graph', 'viewer'] as const).map(p => (
                <button key={p} onClick={() => setCenterPanel(p)}
                  className="text-xs px-3 py-1.5 rounded-xl transition-all"
                  style={{
                    background: centerPanel === p ? 'var(--accent-soft)' : 'transparent',
                    color: centerPanel === p ? 'var(--accent)' : 'var(--muted)',
                    border: `1px solid ${centerPanel === p ? 'var(--accent)' : 'transparent'}`,
                  }}>
                  {p === 'graph' ? 'Dependency Graph' : selectedFile ? selectedFile.split('/').pop() : 'File Viewer'}
                </button>
              ))}
            </div>
            {centerPanel === 'viewer' && selectedFile && (
              <button onClick={() => setCenterPanel('graph')}
                className="ml-auto text-xs" style={{ color: 'var(--subtle)' }}>
                ← Graph
              </button>
            )}
          </div>

          <div className="flex-1 overflow-hidden">
            {centerPanel === 'graph' ? (
              <DependencyGraph nodes={data.graph.nodes} edges={data.graph.edges}
                selectedFile={selectedFile}
                onSelect={path => { setSelectedFile(path); setCenterPanel('viewer') }} />
            ) : selectedFile ? (
              <FileViewer
                repoId={repoId}
                filePath={selectedFile}
                language={selectedLang}
                onClose={() => setCenterPanel('graph')}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"
                  style={{ color: 'var(--subtle)' }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>Click a file in the tree to view its source</p>
              </div>
            )}
          </div>
        </main>

        {/* Right: Chat */}
        <aside className="w-[380px] flex-shrink-0 flex flex-col overflow-hidden glass-sm"
          style={{ borderLeft: '1px solid var(--border)' }}>
          <Chat repoId={repoId} repoName={data.repo_name} onCitationClick={handleCitationClick} />
        </aside>
      </div>
    </div>
  )
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    }>
      <WorkspaceInner />
    </Suspense>
  )
}
