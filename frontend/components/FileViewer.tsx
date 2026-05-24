'use client'

import { useEffect, useState, useCallback } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { fetchFileContent } from '@/lib/api'
import { useTheme } from '@/components/ThemeProvider'

const LANG_MAP: Record<string, string> = {
  python: 'python', javascript: 'javascript', typescript: 'typescript',
  tsx: 'tsx', jsx: 'jsx', go: 'go', rust: 'rust', java: 'java',
  ruby: 'ruby', php: 'php', csharp: 'csharp', cpp: 'cpp', c: 'c',
  markdown: 'markdown', yaml: 'yaml', json: 'json', bash: 'bash', toml: 'toml',
}

interface Props {
  repoId: string
  filePath: string
  language?: string
  onClose: () => void
}

export default function FileViewer({ repoId, filePath, language, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const { theme } = useTheme()

  useEffect(() => {
    setLoading(true); setError(''); setContent(null)
    fetchFileContent(repoId, filePath)
      .then(d => setContent(d.content))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [repoId, filePath])

  const copy = useCallback(() => {
    if (!content) return
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [content])

  const lang = LANG_MAP[language ?? ''] ?? 'text'
  const fileName = filePath.split('/').pop() ?? filePath
  const lineCount = content?.split('\n').length ?? 0

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 glass-sm"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            style={{ color: 'var(--accent)', flexShrink: 0 }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span className="font-mono text-xs font-medium truncate" style={{ color: 'var(--text)' }}>
            {filePath}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {content && (
            <span className="text-[11px] hidden sm:block" style={{ color: 'var(--subtle)' }}>
              {lineCount} lines
            </span>
          )}

          <button onClick={copy} title="Copy"
            className="flex items-center gap-1.5 text-[11px] rounded-lg px-2.5 py-1.5 transition-all"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: copied ? 'var(--green-text)' : 'var(--muted)',
            }}>
            {copied ? (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy
              </>
            )}
          </button>

          <button onClick={onClose} title="Close"
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
            style={{ border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-full gap-3" style={{ color: 'var(--muted)' }}>
            <span className="w-4 h-4 border-2 border-t-transparent rounded-full spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            Loading {fileName}…
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--subtle)' }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{error}</p>
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>File may not exist in cloned repo</p>
          </div>
        )}
        {content !== null && !loading && (
          <SyntaxHighlighter
            language={lang}
            style={theme === 'light' ? oneLight : oneDark}
            showLineNumbers
            lineNumberStyle={{
              color: 'var(--subtle)',
              fontSize: '11px',
              paddingRight: '16px',
              userSelect: 'none',
              minWidth: '40px',
            }}
            customStyle={{
              margin: 0,
              padding: '16px',
              background: 'transparent',
              fontSize: '12px',
              lineHeight: '1.6',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            }}
            codeTagProps={{ style: { fontFamily: 'inherit' } }}
          >
            {content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  )
}
