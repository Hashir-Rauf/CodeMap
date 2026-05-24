# Codebase onboarding assistant — hackathon build plan

## Overview

A tool that accepts a GitHub repo URL and produces three things: an interactive file tree, a dependency graph, and a RAG-powered chat interface that can answer questions about the codebase with file-level citations.

**Target**: 8-hour hackathon MVP  
**Stack**: FastAPI + Next.js 14 + ChromaDB + OpenAI  
**Demo repos to pre-ingest**: FastAPI (medium, ~200 files), one of your own projects (small, familiar)

---

## System architecture

```
GitHub URL
    │
    ▼
[Ingestion] ──── clone, walk tree, filter junk
    │
    ▼
[AST parsing] ── extract functions, classes, imports per file
    │
    ▼
[Chunk + embed] ─ 512-token windows, text-embedding-3-small, upsert to Chroma
    │
    ├──► File tree store      (JSON: path, language, size, symbols)
    ├──► Dependency graph     (JSON: nodes=files, edges=imports)
    └──► Vector store         (Chroma: chunks + metadata)
              │
              ▼
    [RAG chat engine]
    query → embed → retrieve top-8 chunks → gpt-4o-mini → stream response
              │
              ▼
    [Frontend workspace]
    Left: file tree  |  Center: dependency graph  |  Right: chat
```

---

## Hour-by-hour build sequence

### Hour 0–1 — Project setup and skeleton

- Scaffold FastAPI backend with three routes:
  - `POST /ingest` — accepts GitHub URL + optional token, starts pipeline
  - `GET /tree` — returns file tree JSON for a repo
  - `POST /chat` — accepts message, streams RAG response via SSE
- Scaffold Next.js 14 frontend, two pages:
  - `/` — URL input + ingestion progress view
  - `/workspace` — three-panel layout (tree, graph, chat)
- Spin up ChromaDB locally: `docker run -p 8001:8000 chromadb/chroma`
- Set env vars: `GITHUB_TOKEN`, `OPENAI_API_KEY`, `CHROMA_HOST`

**Deliverable**: both servers run, routes return 200 with dummy data.

---

### Hour 1–3 — Repo ingestion pipeline

- Clone repo into a temp directory using `GitPython`
- Walk file tree with `os.walk`, skip:
  - Directories: `node_modules`, `.git`, `__pycache__`, `dist`, `build`
  - Files: `*.lock`, `*.png`, `*.jpg`, `*.woff`, binaries
- Build file tree JSON per file: `{ path, language, size_kb, last_modified }`
- For each source file, extract via AST:
  - **Python**: use stdlib `ast` — pull function names, class names, docstrings, import statements
  - **JS/TS**: use `tree-sitter` Python bindings with JS/TS grammar
  - **Other languages**: fall back to regex for import lines only
- Chunk each file into 512-token windows with 50-token overlap
  - Prefix each chunk with: `File: {path}\nLanguage: {lang}\nSymbols: {func1, func2}\n---\n{code}`
- Batch-embed chunks with `text-embedding-3-small` (max 2048 inputs per API call)
- Upsert into Chroma with metadata: `{ file_path, language, start_line, repo_id }`
- Stream ingestion progress back to the frontend via SSE: `{ step, file, progress_pct }`

**Deliverable**: `POST /ingest` with a real public repo returns a populated Chroma collection and file tree JSON.

---

### Hour 3–4 — Dependency graph extraction

- From AST output, parse import statements into an adjacency list:
  - `file_a.py` imports `file_b.py` → edge `(a → b)`
  - Resolve relative imports to absolute paths within the repo
- Build graph JSON:
  ```json
  {
    "nodes": [{ "id": "src/auth.py", "language": "python", "symbol_count": 12 }],
    "edges": [{ "source": "src/main.py", "target": "src/auth.py" }]
  }
  ```
- For each top-level directory, make one LLM call (gpt-4o-mini) with a sample of filenames and extracted symbols — ask for a one-paragraph plain-English summary
- Store directory summaries alongside the graph in a simple JSON file per repo

**Deliverable**: `GET /tree` returns both the file tree and the dependency graph JSON.

---

### Hour 4–6 — RAG chat engine

- On each `POST /chat` request:
  1. Embed the user query with `text-embedding-3-small`
  2. Query Chroma — retrieve top 8 chunks filtered by `repo_id`
  3. Build the prompt:
     - **System**: repo name, primary language, directory summaries, instruction to always cite file paths
     - **Context**: retrieved chunks formatted as fenced code blocks with path headers
     - **User**: the question
  4. Stream response from `gpt-4o-mini` via `StreamingResponse` in FastAPI
- Frontend consumes the SSE stream with `ReadableStream` and renders tokens as they arrive
- Parse file path citations from the model response (look for backtick-wrapped paths) and render them as clickable chips below each message
- Clicking a chip highlights that file in the left-panel tree and centers it in the graph

**Deliverable**: chat answers questions about the repo with streaming output and working file citations.

---

### Hour 6–7.5 — Frontend workspace

**Left panel — file tree**
- Use `react-arborist` (virtualised, handles 10k+ files without lag)
- Color-code nodes by language (Python = blue, JS = yellow, etc.)
- Show symbol count badge on each file node
- Clicking a file opens a code preview drawer

**Center panel — dependency graph**
- Use `react-force-graph` (WebGL-powered, smooth at 500+ nodes)
- Nodes sized by import count (more imported = larger node)
- Edges colored by import direction
- Clicking a node highlights it in the tree and filters chat context to that file

**Right panel — chat**
- Standard message list with user/assistant alignment
- Streaming tokens render character-by-character
- Source file chips appear below each AI message
- Pre-fill three starter questions as clickable prompts on first load:
  - "What does this codebase do?"
  - "Where is authentication handled?"
  - "What are the main entry points?"

**Landing page**
- Single input: GitHub URL + optional private token
- On submit, show real-time ingestion progress via SSE with step labels

**Deliverable**: full three-panel workspace works end-to-end with a pre-ingested repo.

---

### Hour 7.5–8 — Demo prep

- Pre-ingest two repos and cache results so demo never waits on ingestion
- Rehearse five demo questions that show the system at its best:
  1. "What does this codebase do?" — tests global summary
  2. "Where is authentication handled?" — tests retrieval precision
  3. "What calls the payment service?" — tests dependency awareness
  4. "How is error handling structured?" — tests cross-file reasoning
  5. "What would I need to change to add a new API endpoint?" — tests onboarding utility
- Add a global error boundary with a readable fallback message
- Verify dark mode works in the frontend

---

## Tech stack

| Layer | Library | Notes |
|---|---|---|
| Backend | FastAPI | Async streaming, minimal boilerplate |
| Frontend | Next.js 14 + Tailwind | App router, streaming-native |
| Embeddings | `text-embedding-3-small` | 1536 dims, cheapest OpenAI embedding |
| LLM | `gpt-4o-mini` | 128k context, strong at code, cheap |
| Vector DB | ChromaDB (Docker) | Zero config, local, perfect for hackathon |
| AST (Python) | stdlib `ast` | No extra dep, covers docstrings and imports |
| AST (JS/TS) | `tree-sitter` | Python bindings, multi-language |
| Repo cloning | `GitPython` | Handles auth, branch selection |
| Graph viz | `react-force-graph` | WebGL, handles large graphs |
| File tree | `react-arborist` | Virtualised list, fast |

---

## Three things that will win the demo

1. **Ingestion progress bar** — show judges "Cloning... Parsing 47 files... Embedding 312 chunks..." in real time. Makes the technical depth visible without explaining it.

2. **Streaming responses with clickable file citations** — when the AI says "authentication is in `src/auth/middleware.py`", that path is a chip that highlights the file in the tree. Judges see the whole system working in one gesture.

3. **The dependency graph** — most codebases have 3–4 central files everything imports. Showing that structure visually in 5 seconds is a stronger pitch than any slide.

---

## Go-to-market (post-hackathon)

- **Day 1**: post on Hacker News Show HN and Product Hunt on demo day
- **Pricing**: free for public repos, $15/mo per private repo
- **First 10 customers**: cold email CTOs at 50–200 person startups — frame it around new engineer onboarding cost (~2 weeks saved per hire)
- **Week 2**: add VS Code extension that surfaces the chat panel inside the editor
