import ast
import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import AsyncGenerator, Optional

import asyncio
import random

import chromadb
import httpx
import tiktoken
from git import Repo

try:
    from tree_sitter_languages import get_language, get_parser
    TREE_SITTER_AVAILABLE = True
except Exception:
    TREE_SITTER_AVAILABLE = False

SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", "dist", "build", ".next",
    "venv", ".venv", "env", ".env", "coverage", ".nyc_output", "vendor",
    ".idea", ".vscode", "target", "out",
    # skip test & doc heavy dirs
    "tests", "test", "__tests__", "spec", "specs", "e2e",
    "docs", "doc", "documentation", "examples", "example",
    "fixtures", "mocks", "stubs", "migrations",
}
SKIP_EXTENSIONS = {
    ".lock", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff",
    ".woff2", ".ttf", ".eot", ".mp4", ".mp3", ".pdf", ".zip", ".tar",
    ".gz", ".min.js", ".min.css", ".map", ".pkl", ".h5",
    ".parquet", ".csv", ".xlsx", ".bin", ".txt",
}
LANGUAGE_MAP = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".tsx": "tsx", ".jsx": "jsx", ".go": "go", ".rs": "rust",
    ".java": "java", ".rb": "ruby", ".php": "php", ".cs": "csharp",
    ".cpp": "cpp", ".c": "c", ".h": "c", ".hpp": "cpp",
    ".md": "markdown", ".yaml": "yaml", ".yml": "yaml",
    ".json": "json", ".toml": "toml", ".sh": "bash",
    ".ipynb": "python",
}
CHUNK_TOKENS = 512
OVERLAP_TOKENS = 20
EMBED_BATCH = 100
MAX_FILE_KB = 100        # skip files larger than this
MAX_CHUNKS_PER_FILE = 4  # per-file cap
MAX_TOTAL_CHUNKS = 150   # global cap — keeps embedding fast on free-tier API keys
EMBED_CONCURRENCY = 3    # 3 concurrent keeps RPM well under free-tier limits
EMBED_DELAY = 0.4        # seconds between requests per worker


def _lang(path: str) -> str:
    ext = Path(path).suffix.lower()
    return LANGUAGE_MAP.get(ext, "text")


def _should_skip(path: str) -> bool:
    p = Path(path)
    if any(part in SKIP_DIRS for part in p.parts):
        return True
    for skip_ext in SKIP_EXTENSIONS:
        if path.lower().endswith(skip_ext):
            return True
    # Notebooks can be large due to embedded outputs, but we only extract code cells — don't size-skip them
    if not path.lower().endswith(".ipynb"):
        try:
            if os.path.getsize(path) > MAX_FILE_KB * 1024:
                return True
        except OSError:
            pass
    return False


def _extract_symbols_python(source: str) -> list[str]:
    try:
        tree = ast.parse(source)
        symbols = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                symbols.append(node.name)
        return symbols
    except Exception:
        return []


def _extract_imports_python(source: str) -> list[str]:
    try:
        tree = ast.parse(source)
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imports.append(node.module)
        return imports
    except Exception:
        return []


def _extract_symbols_ts(source: str, lang: str) -> list[str]:
    if not TREE_SITTER_AVAILABLE:
        return []
    try:
        ts_lang = lang if lang in ("javascript", "typescript") else "javascript"
        parser = get_parser(ts_lang)
        tree = parser.parse(source.encode())
        symbols = []
        cursor = tree.walk()
        def visit(node):
            if node.type in (
                "function_declaration", "function_definition",
                "method_definition", "class_declaration",
                "lexical_declaration", "variable_declarator",
                "export_statement",
            ):
                for child in node.children:
                    if child.type == "identifier":
                        symbols.append(child.text.decode())
            for child in node.children:
                visit(child)
        visit(tree.root_node)
        return symbols
    except Exception:
        return []


def _extract_imports_ts(source: str, lang: str) -> list[str]:
    imports = re.findall(r'(?:import|require)\s*(?:.*?\s+from\s+)?["\']([^"\']+)["\']', source)
    return imports


def _extract_imports_regex(source: str) -> list[str]:
    patterns = [
        r'^\s*import\s+["\']([^"\']+)["\']',
        r'^\s*from\s+["\']([^"\']+)["\']',
        r'require\s*\(\s*["\']([^"\']+)["\']\s*\)',
        r'^\s*use\s+([\w:]+)',
        r'^\s*#include\s+[<"]([^>"]+)[>"]',
    ]
    results = []
    for pat in patterns:
        results.extend(re.findall(pat, source, re.MULTILINE))
    return results


def _extract_notebook_source(file_path: str) -> str:
    try:
        nb = json.loads(Path(file_path).read_text(encoding="utf-8", errors="replace"))
        code_cells = [
            "".join(cell["source"])
            for cell in nb.get("cells", [])
            if cell.get("cell_type") == "code" and cell.get("source")
        ]
        return "\n\n# --- cell ---\n\n".join(code_cells)
    except Exception:
        return ""


def extract_file_info(file_path: str, repo_root: str) -> dict:
    rel_path = os.path.relpath(file_path, repo_root)
    lang = _lang(file_path)
    try:
        if Path(file_path).suffix.lower() == ".ipynb":
            source = _extract_notebook_source(file_path)
            if not source:
                return None
        else:
            source = Path(file_path).read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None

    if lang == "python":
        symbols = _extract_symbols_python(source)
        imports = _extract_imports_python(source)
    elif lang in ("javascript", "typescript", "tsx", "jsx"):
        symbols = _extract_symbols_ts(source, lang)
        imports = _extract_imports_ts(source, lang)
    else:
        symbols = []
        imports = _extract_imports_regex(source)

    size_kb = round(os.path.getsize(file_path) / 1024, 2)
    return {
        "path": rel_path,
        "language": lang,
        "size_kb": size_kb,
        "symbols": symbols,
        "imports": imports,
        "source": source,
    }


def _tokenize(text: str) -> list[int]:
    enc = tiktoken.get_encoding("cl100k_base")
    return enc.encode(text)


def _detokenize(tokens: list[int]) -> str:
    enc = tiktoken.get_encoding("cl100k_base")
    return enc.decode(tokens)


def chunk_file(info: dict) -> list[dict]:
    header = f"File: {info['path']}\nLanguage: {info['language']}\nSymbols: {', '.join(info['symbols'][:20])}\n---\n"
    header_tokens = _tokenize(header)
    source_tokens = _tokenize(info["source"])

    body_budget = CHUNK_TOKENS - len(header_tokens)
    if body_budget <= 0:
        body_budget = 256

    chunks = []
    start = 0
    while start < len(source_tokens):
        end = start + body_budget
        body = _detokenize(source_tokens[start:end])
        chunk_text = header + body
        chunks.append({
            "text": chunk_text,
            "file_path": info["path"],
            "language": info["language"],
            "start_token": start,
        })
        if end >= len(source_tokens):
            break
        start = end - OVERLAP_TOKENS
    return chunks


async def _embed_one(
    text: str,
    api_key: str,
    task_type: str,
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
) -> list[float]:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models"
        f"/gemini-embedding-001:embedContent?key={api_key}"
    )
    payload = {
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
        "taskType": task_type,
    }
    # Stagger workers on first attempt to prevent thundering herd
    await asyncio.sleep(random.uniform(0, 0.5))
    backoff = 2.0
    for attempt in range(12):
        async with sem:
            resp = await client.post(url, json=payload, timeout=12)
            await asyncio.sleep(EMBED_DELAY)
        if resp.status_code == 429:
            # Full jitter: sleep random in [0, backoff] so workers desync
            await asyncio.sleep(random.uniform(0, backoff))
            backoff = min(backoff * 2, 60)
            continue
        resp.raise_for_status()
        return resp.json()["embedding"]["values"]
    raise RuntimeError("Embedding failed after 12 retries")


async def embed_chunks(
    chunks: list[dict],
    api_key: str,
    progress_queue: asyncio.Queue | None = None,
) -> list[list[float]]:
    sem = asyncio.Semaphore(EMBED_CONCURRENCY)
    total = len(chunks)
    results: list[list[float] | None] = [None] * total
    completed = 0
    consecutive_429s = 0  # shared counter to detect quota exhaustion

    async def run_one(i: int, text: str, client: httpx.AsyncClient):
        nonlocal completed, consecutive_429s
        try:
            emb = await _embed_one(text, api_key, "RETRIEVAL_DOCUMENT", client, sem)
            results[i] = emb
            consecutive_429s = 0  # reset on success
        except RuntimeError as e:
            consecutive_429s += 1
            # After 6 consecutive total failures, signal quota error to UI
            if consecutive_429s >= 6 and progress_queue is not None:
                await progress_queue.put({
                    "step": "error",
                    "file": "Gemini API quota exhausted. Wait a minute and try again, or check your Google AI Studio quota.",
                    "progress_pct": 40,
                })
        except Exception:
            pass
        finally:
            completed += 1
            if progress_queue is not None and completed % 3 == 0:
                pct = 40 + int((completed / total) * 40)
                await progress_queue.put(
                    {"step": "embedding", "file": f"{completed}/{total} chunks", "progress_pct": pct}
                )

    try:
        async with httpx.AsyncClient() as client:
            await asyncio.gather(*[run_one(i, c["text"], client) for i, c in enumerate(chunks)])
    finally:
        if progress_queue is not None:
            await progress_queue.put(None)

    return results  # type: ignore


async def ingest_repo(
    github_url: str,
    repo_id: str,
    github_token: Optional[str],
    chroma_dir: str,
    repos_dir: str,
    gemini_api_key: str,
) -> AsyncGenerator[dict, None]:

    repo_dir = os.path.join(repos_dir, repo_id)
    if os.path.exists(repo_dir):
        shutil.rmtree(repo_dir)
    os.makedirs(repo_dir, exist_ok=True)

    yield {"step": "cloning", "file": github_url, "progress_pct": 0}

    clone_url = github_url
    if github_token and "github.com" in github_url:
        clone_url = github_url.replace("https://", f"https://{github_token}@")
    Repo.clone_from(clone_url, repo_dir, depth=1)

    yield {"step": "scanning", "file": "", "progress_pct": 5}

    all_files = []
    for root, dirs, files in os.walk(repo_dir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fname in files:
            full_path = os.path.join(root, fname)
            if not _should_skip(full_path):
                all_files.append(full_path)

    total = len(all_files)
    file_infos = []
    for i, fp in enumerate(all_files):
        info = extract_file_info(fp, repo_dir)
        if info:
            file_infos.append(info)
        pct = 5 + int((i / total) * 30)
        yield {"step": "parsing", "file": os.path.relpath(fp, repo_dir), "progress_pct": pct}

    yield {"step": "chunking", "file": "", "progress_pct": 35}

    all_chunks = []
    for info in file_infos:
        file_chunks = chunk_file(info)
        if len(file_chunks) > MAX_CHUNKS_PER_FILE:
            keep = file_chunks[:MAX_CHUNKS_PER_FILE - 1] + [file_chunks[-1]]
            file_chunks = keep
        all_chunks.extend(file_chunks)

    # Global cap: prioritise files with more symbols (more useful for RAG)
    if len(all_chunks) > MAX_TOTAL_CHUNKS:
        # Sort by symbol_count desc so important files keep more chunks
        chunk_priority = {
            info["path"]: len(info["symbols"]) + len(info["imports"])
            for info in file_infos
        }
        all_chunks.sort(key=lambda c: chunk_priority.get(c["file_path"], 0), reverse=True)
        all_chunks = all_chunks[:MAX_TOTAL_CHUNKS]

    yield {"step": "embedding", "file": f"{len(all_chunks)} chunks", "progress_pct": 40}

    # Run embedding in background task and stream progress via queue
    progress_queue: asyncio.Queue = asyncio.Queue()
    embed_task = asyncio.create_task(
        embed_chunks(all_chunks, gemini_api_key, progress_queue)
    )

    # Drain progress with heartbeat so SSE stays alive during long backoffs
    last_pct = 40
    while True:
        try:
            event = await asyncio.wait_for(progress_queue.get(), timeout=6.0)
        except asyncio.TimeoutError:
            yield {"step": "embedding", "file": "waiting for API...", "progress_pct": last_pct}
            continue
        if event is None:  # sentinel: embedding finished
            break
        last_pct = event.get("progress_pct", last_pct)
        yield event

    embeddings = await embed_task

    yield {"step": "upserting", "file": "ChromaDB (embedded)", "progress_pct": 85}

    chroma = chromadb.PersistentClient(path=chroma_dir)
    try:
        chroma.delete_collection(repo_id)
    except Exception:
        pass
    col = chroma.get_or_create_collection(repo_id)

    # Drop any chunks whose embedding failed (None)
    valid = [(i, c, e) for i, (c, e) in enumerate(zip(all_chunks, embeddings)) if e is not None]
    ids = [f"{repo_id}_{i}" for i, _, _ in valid]
    metadatas = [
        {
            "file_path": c["file_path"],
            "language": c["language"],
            "start_token": c["start_token"],
            "repo_id": repo_id,
        }
        for _, c, _ in valid
    ]
    documents = [c["text"] for _, c, _ in valid]
    embeds   = [e         for _, _, e in valid]

    batch_size = 500
    for i in range(0, len(ids), batch_size):
        col.upsert(
            ids=ids[i : i + batch_size],
            embeddings=embeds[i : i + batch_size],
            documents=documents[i : i + batch_size],
            metadatas=metadatas[i : i + batch_size],
        )

    yield {"step": "done", "file": "", "progress_pct": 100}

    # Return structured data as the final event
    tree_data = build_file_tree(file_infos)
    graph_data = build_dependency_graph(file_infos, repo_dir)
    yield {
        "step": "result",
        "file": "",
        "progress_pct": 100,
        "tree": tree_data,
        "graph": graph_data,
        "file_count": len(file_infos),
        "chunk_count": len(all_chunks),
    }


def build_file_tree(file_infos: list[dict]) -> list[dict]:
    return [
        {
            "path": info["path"],
            "language": info["language"],
            "size_kb": info["size_kb"],
            "symbol_count": len(info["symbols"]),
        }
        for info in file_infos
    ]


def build_dependency_graph(file_infos: list[dict], repo_root: str) -> dict:
    path_set = {info["path"] for info in file_infos}

    def resolve_import(imp: str, current_file: str, lang: str) -> Optional[str]:
        if lang == "python":
            imp_path = imp.replace(".", "/")
            for ext in (".py", "/__init__.py"):
                candidate = imp_path + ext
                if candidate in path_set:
                    return candidate
        elif lang in ("javascript", "typescript", "tsx", "jsx"):
            if imp.startswith("."):
                base_dir = str(Path(current_file).parent)
                for ext in ("", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"):
                    candidate = str(Path(base_dir) / (imp + ext))
                    candidate = os.path.normpath(candidate)
                    if candidate in path_set:
                        return candidate
        return None

    seen_paths: set[str] = set()
    nodes = []
    edges = []
    seen_edges: set[tuple[str, str]] = set()

    for info in file_infos:
        if info["path"] in seen_paths:
            continue
        seen_paths.add(info["path"])
        import_count = len([
            imp for imp in info["imports"]
            if resolve_import(imp, info["path"], info["language"])
        ])
        nodes.append({
            "id": info["path"],
            "language": info["language"],
            "symbol_count": len(info["symbols"]),
            "import_count": import_count,
        })
        for imp in info["imports"]:
            target = resolve_import(imp, info["path"], info["language"])
            if target and (info["path"], target) not in seen_edges:
                edges.append({"source": info["path"], "target": target})
                seen_edges.add((info["path"], target))

    return {"nodes": nodes, "edges": edges}
