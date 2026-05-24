# CodeMap

Paste a GitHub URL and get an interactive file tree, dependency graph, syntax-highlighted file viewer, and an AI assistant that has read the entire codebase — all in the browser.

---

## Features

- **File Tree** — collapsible, searchable, color-coded by language with symbol counts
- **Dependency Graph** — force-directed WebGL graph showing which files import what
- **File Viewer** — click any file to view syntax-highlighted source with a copy button
- **AI Chat** — ask anything about the codebase; answers stream in real time with clickable file citations that jump straight to the source
- **Dark / Light mode** — persists across sessions, respects system preference on first visit

## How it works

```
GitHub URL
    ↓  clone (GitPython, depth=1)
    ↓  walk & filter files
    ↓  AST parse (Python stdlib ast / tree-sitter for JS/TS)
    ↓  extract code cells from Jupyter notebooks
    ↓  chunk (tiktoken, 512 tokens, 20-token overlap)
    ↓  embed (Gemini gemini-embedding-001, sequential to avoid rate limits)
    ↓  upsert into ChromaDB
    ↓  stream progress to browser via SSE

Query
    ↓  embed query (same model, RETRIEVAL_QUERY task type)
    ↓  retrieve top-15 chunks from ChromaDB
    ↓  prompt Gemini (gemini-2.0-flash with fallback chain)
    ↓  stream tokens → browser
    ↓  extract file citations from response
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, Tailwind CSS, react-force-graph-2d, react-syntax-highlighter |
| Backend | FastAPI, uvicorn, SSE (sse-starlette) |
| Vector store | ChromaDB (embedded, no Docker required) |
| Embeddings | Gemini `gemini-embedding-001` via direct REST |
| Chat | Gemini `gemini-2.0-flash` → `gemini-2.0-flash-lite` → `gemini-flash-lite-latest` (quota fallback chain) |
| Chunking | tiktoken cl100k_base |
| Repo cloning | GitPython |

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/app/apikey) (free tier works)

## Setup

### 1. Clone

```bash
git clone <this-repo>
cd codemap
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env`:

```env
GEMINI_API_KEY=AIza...             # required
GITHUB_TOKEN=ghp_...               # optional — only needed for private repos
CHROMA_DIR=/tmp/codemap_chroma     # where ChromaDB persists its index
REPOS_DIR=/tmp/codemap_repos       # where repos are cloned
DATA_DIR=/tmp/codemap_data         # where repo metadata is cached
```

Start the backend:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # or create it manually
```

`frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Start the frontend:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### One-command start (macOS / Linux)

```bash
chmod +x start.sh && ./start.sh
```

This starts the backend and frontend in the background and waits. `Ctrl+C` stops everything.

---

## Project structure

```
codemap/
├── backend/
│   ├── main.py          # FastAPI app — routes: /ingest /tree /file /chat /repos /health
│   ├── ingestion.py     # Clone → parse → chunk → embed → upsert pipeline
│   ├── rag.py           # Query embedding + ChromaDB retrieval + Gemini streaming
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── page.tsx           # Landing page (URL input, progress, feature cards)
│   │   └── workspace/
│   │       └── page.tsx       # Three-panel workspace
│   ├── components/
│   │   ├── Chat.tsx           # Streaming chat with citation chips
│   │   ├── DependencyGraph.tsx # react-force-graph-2d canvas graph
│   │   ├── FileTree.tsx       # Collapsible file tree
│   │   ├── FileViewer.tsx     # Syntax-highlighted source viewer
│   │   └── ThemeProvider.tsx  # Dark/light mode context + toggle button
│   └── lib/
│       ├── api.ts             # fetch wrappers for all backend endpoints
│       └── colors.ts          # Language → color mapping
├── docker-compose.yml   # ChromaDB service (optional, embedded mode used by default)
├── start.sh             # One-command startup script
└── README.md
```

## API reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/ingest` | Stream ingestion progress (SSE). Body: `{ github_url, github_token? }` |
| `GET` | `/tree?repo_id=` | Return persisted file tree + dependency graph + metadata |
| `GET` | `/file?repo_id=&path=` | Return raw file content from the cloned repo |
| `POST` | `/chat` | Stream chat tokens (SSE). Body: `{ repo_id, message }` |
| `GET` | `/repos` | List all previously ingested repos |
| `GET` | `/health` | Health check |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | **Required.** Google AI Studio key |
| `GITHUB_TOKEN` | — | Optional. Personal access token for private repos |
| `CHROMA_DIR` | `/tmp/codemap_chroma` | ChromaDB persistence directory |
| `REPOS_DIR` | `/tmp/codemap_repos` | Clone destination |
| `DATA_DIR` | `/tmp/codemap_data` | JSON cache for repo metadata |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend base URL for the frontend |

## File filtering

The ingestion pipeline skips:

- **Directories:** `node_modules`, `.git`, `__pycache__`, `dist`, `build`, `.next`, `venv`, `tests`, `docs`, `examples`, and similar
- **Extensions:** images, fonts, videos, lock files, `.min.js`, `.min.css`, compiled binaries
- **Files over 100 KB** (except Jupyter notebooks — only the code cells are extracted, so large notebook files with embedded outputs are handled correctly)

## Rate limits

The free Gemini API tier has per-minute request limits. The ingestion pipeline processes embeddings sequentially with a 0.1 s delay between requests and retries with exponential backoff (up to 60 s) on HTTP 429. For large repos, expect ingestion to take a few minutes.

## Notes

- Re-ingesting a repo replaces the existing index for that repo ID.
- Cloned repos are kept in `REPOS_DIR` so the file viewer can serve content without re-cloning.
- The Gemini chat model falls back automatically across `gemini-2.0-flash` → `gemini-2.0-flash-lite` → `gemini-flash-lite-latest` if quota is exhausted.
