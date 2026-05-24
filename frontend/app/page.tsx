'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeProvider'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface ProgressEvent {
  step: string
  file: string
  progress_pct: number
  tree?: unknown
  graph?: unknown
  file_count?: number
  chunk_count?: number
}

const STEPS = ['cloning', 'scanning', 'parsing', 'chunking', 'embedding', 'upserting']
const STEP_LABEL: Record<string, string> = {
  cloning: 'Cloning', scanning: 'Scanning', parsing: 'Parsing',
  chunking: 'Chunking', embedding: 'Embedding', upserting: 'Storing',
}

const DEMOS = [
  { label: 'anthropic-sdk-python', url: 'https://github.com/anthropics/anthropic-sdk-python' },
  { label: 'tiangolo/fastapi',     url: 'https://github.com/tiangolo/fastapi' },
  { label: 'vercel/next.js',       url: 'https://github.com/vercel/next.js' },
]

const FEATURES = [
  { title: 'File Tree', desc: 'Click any file to view its source with syntax highlighting.' },
  { title: 'Dep Graph', desc: 'Force-directed graph showing import relationships across files.' },
  { title: 'AI Chat',   desc: 'Ask questions, get answers with clickable file citations.' },
]

export default function LandingPage() {
  const router = useRouter()
  const [url, setUrl]           = useState('')
  const [token, setToken]       = useState('')
  const [showToken, setShowToken] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [error, setError]       = useState('')

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true); setError(''); setProgress(null)

    try {
      const resp = await fetch(`${API}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_url: url, github_token: token || undefined }),
      })
      if (!resp.ok || !resp.body) throw new Error(`Server error: ${resp.status}`)

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev: ProgressEvent = JSON.parse(line.slice(6))
            setProgress(ev)
            if (ev.step === 'result') {
              const id = repoIdFromUrl(url)
              setTimeout(() => router.push(`/workspace?repo_id=${id}`), 700)
            } else if (ev.step === 'error') {
              setError(ev.file)
              setLoading(false)
              return
            }
          } catch { /**/ }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ingestion failed')
    } finally {
      setLoading(false)
    }
  }

  const curStep = progress ? STEPS.indexOf(progress.step) : -1

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="glass-sm sticky top-0 z-50 flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-bold"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--purple))' }}>
            C
          </div>
          <span className="font-semibold tracking-tight" style={{ color: 'var(--text)' }}>CodeMap</span>
        </div>
        <ThemeToggle />
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-20">
        {/* Hero */}
        <div className="text-center mb-14 float-in float-in-1">
          <h1 className="text-5xl sm:text-7xl font-bold mb-5 leading-[1.08] tracking-tight">
            <span className="text-gradient">Understand any repo</span>
            <br />
            <span style={{ color: 'var(--text)' }}>in minutes.</span>
          </h1>
          <p className="text-lg max-w-md mx-auto leading-relaxed" style={{ color: 'var(--muted)' }}>
            Paste a GitHub URL to get an interactive file tree, dependency graph, and AI chat that knows the entire codebase.
          </p>
        </div>

        {/* Glass form */}
        <div className="glass w-full max-w-2xl rounded-3xl p-6 float-in float-in-2">
          <form onSubmit={handleIngest} className="space-y-4">
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                required
                disabled={loading}
                className="flex-1 rounded-2xl px-4 py-3 text-sm focus:outline-none transition-all disabled:opacity-50"
                style={{
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 rounded-2xl font-semibold text-sm text-white transition-all disabled:opacity-50 whitespace-nowrap"
                style={{
                  background: loading ? 'var(--muted)' : 'linear-gradient(135deg, var(--accent), var(--purple))',
                  boxShadow: loading ? 'none' : '0 0 24px var(--accent-glow)',
                }}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full spin" />
                    Analyzing...
                  </span>
                ) : 'Analyze →'}
              </button>
            </div>

            <div>
              <button type="button" onClick={() => setShowToken(p => !p)}
                className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>
                {showToken ? '− Hide' : '+ Add'} private repo token
              </button>
              {showToken && (
                <input type="password" value={token} onChange={e => setToken(e.target.value)}
                  placeholder="ghp_..."
                  className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none"
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--subtle)' }}>Try:</span>
              {DEMOS.map(d => (
                <button key={d.url} type="button" onClick={() => setUrl(d.url)}
                  className="text-xs rounded-full px-3 py-1 transition-all"
                  style={{ border: '1px solid var(--border)', color: 'var(--accent)', background: 'var(--surface2)' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </form>

          {/* Progress */}
          {loading && progress && (
            <div className="mt-6 pt-5 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
              {/* Step pills */}
              <div className="flex flex-wrap gap-1.5">
                {STEPS.map((step, i) => {
                  const done = i < curStep, active = i === curStep
                  return (
                    <span key={step} className="text-[11px] px-2.5 py-1 rounded-full transition-all"
                      style={{
                        border: `1px solid ${done || active ? 'var(--accent)' : 'var(--border)'}`,
                        background: active ? 'var(--accent)' : done ? 'var(--accent-soft)' : 'transparent',
                        color: active ? '#fff' : done ? 'var(--accent)' : 'var(--subtle)',
                      }}>
                      {done ? '✓ ' : ''}{STEP_LABEL[step]}
                    </span>
                  )
                })}
              </div>

              {/* Bar */}
              <div>
                <div className="flex justify-between text-xs mb-2" style={{ color: 'var(--muted)' }}>
                  <span style={{ color: 'var(--accent)' }}>{STEP_LABEL[progress.step] ?? progress.step}</span>
                  <span>{progress.progress_pct}%</span>
                </div>
                <div className="w-full rounded-full h-1 overflow-hidden" style={{ background: 'var(--surface2)' }}>
                  <div className="h-1 rounded-full transition-all duration-500"
                    style={{
                      width: `${progress.progress_pct}%`,
                      background: 'linear-gradient(90deg, var(--accent), var(--purple))',
                    }} />
                </div>
              </div>

              {progress.file && (
                <p className="text-[11px] font-mono truncate flex items-center gap-1.5" style={{ color: progress.file.startsWith('waiting') ? 'var(--muted)' : 'var(--subtle)' }}>
                  {progress.file.startsWith('waiting') && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 spin" style={{ background: 'var(--accent)', animation: 'pulse-ring 1.5s ease-out infinite' }} />}
                  {progress.file}
                </p>
              )}
              {progress.step === 'result' && (
                <p className="text-sm font-medium" style={{ color: 'var(--green-text)' }}>
                  ✓ {progress.file_count} files · {progress.chunk_count} chunks — opening workspace…
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-2xl p-4 text-sm" style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', color: 'var(--red)' }}>
              {error}
            </div>
          )}
        </div>

        {/* Feature cards */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl float-in float-in-3">
          {FEATURES.map(f => (
            <div key={f.title} className="glass rounded-2xl p-5 group hover:scale-[1.02] transition-all cursor-default">
              <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>{f.title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center py-5 text-xs" style={{ color: 'var(--subtle)', borderTop: '1px solid var(--border)' }}>
        Powered by Gemini · ChromaDB · Next.js
      </footer>
    </div>
  )
}

function repoIdFromUrl(url: string): string {
  const clean = url.replace(/\.git$/, '').replace(/\/$/, '')
  const parts = clean.split('/')
  return parts.slice(-2).join('_').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}
