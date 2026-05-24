'use client'

import { useMemo, useState } from 'react'
import type { FileNode } from '@/lib/api'
import { langColor } from '@/lib/colors'

interface Props {
  files: FileNode[]
  selectedFile: string | null
  onSelect: (path: string, lang?: string) => void
}

interface TreeItem {
  id: string
  name: string
  path: string
  isDir: boolean
  depth: number
  language?: string
  symbol_count?: number
  size_kb?: number
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--muted)', flexShrink: 0 }}>
      {open
        ? <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/>
        : <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>}
    </svg>
  )
}

function FileIcon({ language }: { language?: string }) {
  const color = langColor(language ?? 'text')
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: 'var(--subtle)', flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

export default function FileTree({ files, selectedFile, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return files
    return files.filter(f => f.path.toLowerCase().includes(search.toLowerCase()))
  }, [files, search])

  const displayList = useMemo<TreeItem[]>(() => {
    if (search) {
      return filtered.map(f => ({
        id: f.path, name: f.path, path: f.path, isDir: false, depth: 0,
        language: f.language, symbol_count: f.symbol_count, size_kb: f.size_kb,
      }))
    }

    const root: Record<string, { item: TreeItem; children: Record<string, unknown> }> = {}
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))

    for (const file of sorted) {
      const parts = file.path.split('/')
      let cur = root
      for (let i = 0; i < parts.length; i++) {
        const key = parts.slice(0, i + 1).join('/')
        if (!cur[key]) {
          const isLast = i === parts.length - 1
          cur[key] = {
            item: {
              id: key, name: parts[i], path: key, isDir: !isLast, depth: i,
              ...(isLast ? { language: file.language, symbol_count: file.symbol_count, size_kb: file.size_kb } : {}),
            },
            children: {},
          }
        }
        if (i < parts.length - 1) cur = cur[key].children as typeof root
      }
    }

    const result: TreeItem[] = []
    function walk(map: typeof root, depth: number) {
      const entries = Object.values(map).sort((a, b) => {
        if (a.item.isDir !== b.item.isDir) return a.item.isDir ? -1 : 1
        return a.item.name.localeCompare(b.item.name)
      })
      for (const { item, children } of entries) {
        result.push({ ...item, depth })
        if (item.isDir && expanded.has(item.id)) {
          walk(children as typeof root, depth + 1)
        }
      }
    }
    walk(root, 0)
    return result
  }, [files, filtered, expanded, search])

  function toggleDir(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Search */}
      <div className="p-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--subtle)' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-bg)] transition-all"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--subtle)] hover:text-[var(--text)]"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {displayList.length === 0 && (
          <p className="text-center text-[var(--subtle)] text-xs py-8">No files found</p>
        )}
        {displayList.map(item => {
          const isSelected = selectedFile === item.path
          const isOpen = expanded.has(item.id)
          return (
            <div
              key={item.id}
              onClick={() => item.isDir ? toggleDir(item.id) : onSelect(item.path, item.language)}
              style={{ paddingLeft: `${item.depth * 14 + 10}px` }}
              className={`flex items-center gap-1.5 py-1 pr-3 cursor-pointer text-xs transition-colors group ${
                isSelected
                  ? 'bg-[var(--accent-bg)] border-l-2 border-[var(--accent)]'
                  : 'hover:bg-[var(--surface2)] border-l-2 border-transparent'
              }`}
            >
              {item.isDir ? (
                <>
                  <ChevronIcon open={isOpen} />
                  <FolderIcon open={isOpen} />
                  <span className="font-medium truncate" style={{ color: 'var(--text)' }}>{item.name}</span>
                </>
              ) : (
                <>
                  <span className="w-2.5 flex-shrink-0" />
                  <FileIcon language={item.language} />
                  <span className={`truncate ${isSelected ? 'font-medium' : ''}`}
                    style={{ color: isSelected ? 'var(--accent)' : 'var(--text)' }}>
                    {search ? item.path : item.name}
                  </span>
                  {item.symbol_count !== undefined && item.symbol_count > 0 && (
                    <span className="ml-auto flex-shrink-0 text-[10px] px-1.5 rounded-full"
                      style={{ color: 'var(--subtle)', background: 'var(--surface2)' }}>
                      {item.symbol_count}
                    </span>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-[var(--border)] flex items-center justify-between">
        <span className="text-[10px]" style={{ color: 'var(--subtle)' }}>
          {search ? `${filtered.length} / ` : ''}{files.length} files
        </span>
        {search && (
          <button onClick={() => setSearch('')} className="text-[10px] hover:underline" style={{ color: 'var(--accent)' }}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
