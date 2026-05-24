'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { streamChat } from '@/lib/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  citations?: string[]
  streaming?: boolean
}

interface Props {
  repoId: string
  repoName: string
  onCitationClick: (path: string) => void
}

const STARTER_QUESTIONS = [
  'What does this codebase do?',
  'Where is authentication handled?',
  'What are the main entry points?',
]

export default function Chat({ repoId, repoName, onCitationClick }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(text: string) {
    if (!text.trim() || busy) return
    setBusy(true)
    setInput('')

    const userMsg: Message = { role: 'user', content: text }
    const assistantMsg: Message = { role: 'assistant', content: '', streaming: true }
    setMessages(prev => [...prev, userMsg, assistantMsg])

    try {
      let fullContent = ''
      for await (const event of streamChat(repoId, text)) {
        if (event.type === 'token') {
          fullContent += event.content
          setMessages(prev => {
            const next = [...prev]
            next[next.length - 1] = { role: 'assistant', content: fullContent, streaming: true }
            return next
          })
        } else if (event.type === 'done') {
          setMessages(prev => {
            const next = [...prev]
            next[next.length - 1] = {
              role: 'assistant',
              content: fullContent,
              citations: event.citations,
              streaming: false,
            }
            return next
          })
        }
      }
    } catch (err) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: 'Error: ' + (err instanceof Error ? err.message : 'Request failed'),
          streaming: false,
        }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2.5 bg-[var(--surface)] flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-[var(--green-text)]" />
        <span className="text-sm font-medium text-[var(--text)] truncate">{repoName}</span>
        <span className="ml-auto text-xs text-[var(--subtle)]">AI Chat</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="space-y-4 pt-2">
            <p className="text-[var(--muted)] text-sm text-center">
              Ask anything about <span className="text-[var(--text)] font-medium">{repoName}</span>
            </p>
            <div className="space-y-2">
              {STARTER_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="w-full text-left text-sm bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-bg)] rounded-xl px-4 py-3 text-[var(--text)] transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {/* Avatar */}
            <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5 ${
              msg.role === 'user'
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--surface2)] border border-[var(--border)] text-[var(--muted)]'
            }`}>
              {msg.role === 'user' ? 'U' : 'AI'}
            </div>

            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
              msg.role === 'user'
                ? 'bg-[var(--accent)] text-white rounded-tr-sm'
                : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] rounded-tl-sm'
            }`}>
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              ) : (
                <MarkdownContent content={msg.content} streaming={msg.streaming} />
              )}

              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap gap-1.5">
                  {msg.citations.map(c => (
                    <button
                      key={c}
                      onClick={() => onCitationClick(c)}
                      className="inline-flex items-center gap-1 text-xs bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-bg)] rounded-lg px-2.5 py-1 text-[var(--accent)] font-mono transition-all"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                      {c.split('/').pop()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-[var(--border)] bg-[var(--surface)] flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the codebase..."
            rows={1}
            disabled={busy}
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--text)] placeholder-[var(--subtle)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-bg)] resize-none disabled:opacity-50 transition-all"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="w-10 h-10 flex items-center justify-center bg-[var(--accent)] hover:opacity-90 disabled:opacity-40 text-white rounded-xl transition-all flex-shrink-0"
          >
            {busy ? (
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            )}
          </button>
        </div>
        <p className="text-[var(--subtle)] text-xs mt-2 text-center">Enter to send · Shift+Enter for newline</p>
      </form>
    </div>
  )
}

function MarkdownContent({ content, streaming }: { content: string; streaming?: boolean }) {
  if (!content) {
    return streaming
      ? <span className="text-[var(--muted)] animate-pulse text-sm">Thinking...</span>
      : null
  }
  return (
    <div className={`prose prose-sm max-w-none leading-relaxed ${streaming ? 'cursor' : ''}`}
      style={{ color: 'var(--text)' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0" style={{ color: 'var(--text)' }}>{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5" style={{ color: 'var(--text)' }}>{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5" style={{ color: 'var(--text)' }}>{children}</ol>,
          li: ({ children }) => <li style={{ color: 'var(--text)' }}>{children}</li>,
          strong: ({ children }) => <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{children}</strong>,
          em: ({ children }) => <em style={{ color: 'var(--muted)' }}>{children}</em>,
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-')
            return isBlock
              ? <code className="block rounded-lg p-3 text-xs font-mono my-2 overflow-x-auto" style={{ background: 'var(--bg)', color: 'var(--accent)' }}>{children}</code>
              : <code className="rounded px-1.5 py-0.5 text-xs font-mono" style={{ background: 'var(--surface2)', color: 'var(--accent)' }}>{children}</code>
          },
          pre: ({ children }) => <pre className="rounded-lg p-3 my-2 overflow-x-auto text-xs" style={{ background: 'var(--bg)' }}>{children}</pre>,
          h1: ({ children }) => <h1 className="text-base font-bold mb-1 mt-3" style={{ color: 'var(--text)' }}>{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold mb-1 mt-3" style={{ color: 'var(--text)' }}>{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2" style={{ color: 'var(--text)' }}>{children}</h3>,
          a: ({ href, children }) => <a href={href} className="hover:underline" style={{ color: 'var(--accent)' }} target="_blank" rel="noreferrer">{children}</a>,
          hr: () => <hr className="my-2" style={{ borderColor: 'var(--border)' }} />,
          blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 my-2" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>{children}</blockquote>,
          table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs w-full" style={{ borderCollapse: 'collapse' }}>{children}</table></div>,
          th: ({ children }) => <th className="px-3 py-1.5 text-left font-semibold" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>{children}</th>,
          td: ({ children }) => <td className="px-3 py-1.5" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
