export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface FileNode {
  path: string
  language: string
  size_kb: number
  symbol_count: number
}

export interface GraphNode {
  id: string
  language: string
  symbol_count: number
  import_count: number
}

export interface GraphEdge {
  source: string
  target: string
}

export interface RepoData {
  repo_id: string
  repo_name: string
  github_url: string
  tree: FileNode[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
  file_count: number
  chunk_count: number
}

export async function fetchFileContent(repo_id: string, path: string): Promise<{ path: string; content: string }> {
  const res = await fetch(`${API}/file?repo_id=${encodeURIComponent(repo_id)}&path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`File not found: ${res.status}`)
  return res.json()
}

export async function fetchRepoData(repo_id: string): Promise<RepoData> {
  const res = await fetch(`${API}/tree?repo_id=${encodeURIComponent(repo_id)}`)
  if (!res.ok) throw new Error(`Failed to load repo: ${res.status}`)
  return res.json()
}

export async function* streamChat(
  repo_id: string,
  message: string
): AsyncGenerator<{ type: 'token'; content: string } | { type: 'done'; citations: string[] }> {
  const res = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id, message }),
  })
  if (!res.ok || !res.body) throw new Error('Chat request failed')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6))
        } catch { /* skip */ }
      }
    }
  }
}
