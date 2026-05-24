export const LANG_COLORS: Record<string, string> = {
  python: '#3572A5',
  javascript: '#f1e05a',
  typescript: '#2b7489',
  tsx: '#2b7489',
  jsx: '#f1e05a',
  go: '#00ADD8',
  rust: '#dea584',
  java: '#b07219',
  ruby: '#701516',
  php: '#4F5D95',
  csharp: '#178600',
  cpp: '#f34b7d',
  c: '#555555',
  markdown: '#083fa1',
  yaml: '#cb171e',
  json: '#292929',
  bash: '#89e051',
  text: '#8b949e',
}

export function langColor(lang: string): string {
  return LANG_COLORS[lang] ?? '#8b949e'
}
