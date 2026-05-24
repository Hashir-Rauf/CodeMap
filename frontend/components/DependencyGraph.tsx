'use client'

import { useEffect, useRef, useState } from 'react'
import type { GraphNode, GraphEdge } from '@/lib/api'
import { langColor } from '@/lib/colors'
import { useTheme } from '@/components/ThemeProvider'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedFile: string | null
  onSelect: (path: string) => void
}

interface D3Node extends GraphNode {
  x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null
}

function getCssVar(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export default function DependencyGraph({ nodes, edges, selectedFile, onSelect }: Props) {
  const [ForceGraph, setForceGraph] = useState<React.ComponentType<unknown> | null>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 })
  const containerRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()

  useEffect(() => {
    import('react-force-graph-2d').then(m => setForceGraph(() => m.default))
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const uniqueNodes = Array.from(new Map(nodes.map(n => [n.id, n])).values())
  const edgeKey = (e: GraphEdge) => `${e.source}→${e.target}`
  const uniqueEdges = Array.from(new Map(edges.map(e => [edgeKey(e), e])).values())
  const maxImports = Math.max(...uniqueNodes.map(n => n.import_count), 1)

  const graphData = {
    nodes: uniqueNodes.map(n => ({
      ...n,
      color: langColor(n.language),
      val: Math.max(2, (n.import_count / maxImports) * 20),
    })),
    links: uniqueEdges.map(e => ({ source: e.source, target: e.target })),
  }

  const bgColor = theme === 'light' ? getCssVar('--bg') || '#ffffff' : getCssVar('--bg') || '#0d1117'
  const linkColor = theme === 'light' ? getCssVar('--border') || '#d0d7de' : getCssVar('--border') || '#30363d'
  const labelColor = theme === 'light' ? '#1f2328' : '#e6edf3'
  const accentColor = getCssVar('--accent') || '#58a6ff'

  if (!ForceGraph) {
    return (
      <div ref={containerRef} className="flex-1 h-full flex items-center justify-center text-[var(--muted)] text-sm">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          Loading graph...
        </div>
      </div>
    )
  }

  const FG = ForceGraph as React.ComponentType<{
    graphData: typeof graphData
    width: number; height: number
    nodeColor: (n: unknown) => string
    nodeVal: (n: unknown) => number
    nodeLabel: (n: unknown) => string
    onNodeClick: (n: unknown) => void
    linkColor: () => string
    linkWidth: number
    backgroundColor: string
    nodeCanvasObject: (n: unknown, ctx: CanvasRenderingContext2D, gs: number) => void
    nodeCanvasObjectMode: () => string
    cooldownTicks: number
  }>

  return (
    <div ref={containerRef} className="flex-1 h-full relative overflow-hidden">
      <FG
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeColor={(n: unknown) => (n as { color: string }).color}
        nodeVal={(n: unknown) => (n as { val: number }).val}
        nodeLabel={(n: unknown) => (n as { id: string }).id}
        onNodeClick={(n: unknown) => onSelect((n as { id: string }).id)}
        linkColor={() => linkColor}
        linkWidth={1}
        backgroundColor={bgColor}
        nodeCanvasObject={(n: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const node = n as D3Node & { color: string; val: number }
          const r = Math.sqrt(node.val) * 3
          const x = node.x ?? 0
          const y = node.y ?? 0
          const isSelected = node.id === selectedFile

          ctx.beginPath()
          ctx.arc(x, y, r, 0, 2 * Math.PI)
          ctx.fillStyle = isSelected ? accentColor : node.color
          ctx.fill()

          if (isSelected) {
            ctx.strokeStyle = accentColor
            ctx.lineWidth = 2.5 / globalScale
            ctx.globalAlpha = 0.3
            ctx.beginPath()
            ctx.arc(x, y, r + 4 / globalScale, 0, 2 * Math.PI)
            ctx.stroke()
            ctx.globalAlpha = 1
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 1.5 / globalScale
            ctx.beginPath()
            ctx.arc(x, y, r, 0, 2 * Math.PI)
            ctx.stroke()
          }

          if (globalScale > 1.5 || isSelected) {
            const label = node.id.split('/').pop() ?? node.id
            const fontSize = Math.max(8, 10 / globalScale)
            ctx.font = `${fontSize}px -apple-system, sans-serif`
            ctx.fillStyle = isSelected ? accentColor : labelColor
            ctx.textAlign = 'center'
            ctx.fillText(label, x, y + r + (12 / globalScale))
          }
        }}
        nodeCanvasObjectMode={() => 'replace'}
        cooldownTicks={100}
      />

      {/* Legend */}
      <div className="absolute top-3 left-3 rounded-xl p-3 text-xs space-y-1.5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
        <div className="font-medium" style={{ color: 'var(--text)' }}>
          {nodes.length} files · {edges.length} edges
        </div>
        <div style={{ color: 'var(--subtle)' }}>Node size = import count</div>
        {selectedFile && (
          <div className="font-mono truncate max-w-[160px]" style={{ color: 'var(--accent)' }}>
            {selectedFile.split('/').pop()}
          </div>
        )}
      </div>
    </div>
  )
}
