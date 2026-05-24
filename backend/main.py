import json
import os
import re
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from google import genai
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

load_dotenv()

GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
CHROMA_DIR = os.getenv("CHROMA_DIR", "/tmp/codemap_chroma")
REPOS_DIR = os.getenv("REPOS_DIR", "/tmp/codemap_repos")
DATA_DIR = os.getenv("DATA_DIR", "/tmp/codemap_data")

os.makedirs(CHROMA_DIR, exist_ok=True)
os.makedirs(REPOS_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

chat_client = genai.Client(api_key=GEMINI_API_KEY)

app = FastAPI(title="CodeMap API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _repo_id_from_url(url: str) -> str:
    url = url.rstrip("/").replace(".git", "")
    parts = url.split("/")
    return re.sub(r"[^a-zA-Z0-9_-]", "_", "_".join(parts[-2:]))[:64]


def _data_path(repo_id: str) -> str:
    return os.path.join(DATA_DIR, f"{repo_id}.json")


class IngestRequest(BaseModel):
    github_url: str
    github_token: Optional[str] = None


class ChatRequest(BaseModel):
    repo_id: str
    message: str


@app.post("/ingest")
async def ingest(req: IngestRequest):
    from ingestion import ingest_repo

    github_token = req.github_token or os.getenv("GITHUB_TOKEN")
    repo_id = _repo_id_from_url(req.github_url)
    repo_name = req.github_url.rstrip("/").split("/")[-1].replace(".git", "")

    async def event_stream():
        result_data = None
        async for event in ingest_repo(
            github_url=req.github_url,
            repo_id=repo_id,
            github_token=github_token,
            chroma_dir=CHROMA_DIR,
            repos_dir=REPOS_DIR,
            gemini_api_key=GEMINI_API_KEY,
        ):
            if event.get("step") == "result":
                result_data = event
                # Persist tree + graph for GET /tree
                data_to_save = {
                    "repo_id": repo_id,
                    "repo_name": repo_name,
                    "github_url": req.github_url,
                    "tree": event["tree"],
                    "graph": event["graph"],
                    "file_count": event["file_count"],
                    "chunk_count": event["chunk_count"],
                }
                Path(_data_path(repo_id)).write_text(json.dumps(data_to_save))
            yield {"data": json.dumps(event)}

    return EventSourceResponse(event_stream())


@app.get("/tree")
async def get_tree(repo_id: str = Query(...)):
    data_file = _data_path(repo_id)
    if not os.path.exists(data_file):
        raise HTTPException(status_code=404, detail="Repo not ingested yet")
    data = json.loads(Path(data_file).read_text())
    return data


@app.get("/repos")
async def list_repos():
    repos = []
    for f in Path(DATA_DIR).glob("*.json"):
        try:
            data = json.loads(f.read_text())
            repos.append({
                "repo_id": data["repo_id"],
                "repo_name": data["repo_name"],
                "github_url": data["github_url"],
                "file_count": data.get("file_count", 0),
            })
        except Exception:
            pass
    return repos


@app.post("/chat")
async def chat(req: ChatRequest):
    from rag import chat_stream, extract_file_citations

    data_file = _data_path(req.repo_id)
    if not os.path.exists(data_file):
        raise HTTPException(status_code=404, detail="Repo not ingested yet")
    data = json.loads(Path(data_file).read_text())
    repo_name = data.get("repo_name", req.repo_id)

    full_response = []

    async def event_stream():
        async for token in chat_stream(
            query=req.message,
            repo_id=req.repo_id,
            repo_name=repo_name,
            chroma_dir=CHROMA_DIR,
            gemini_api_key=GEMINI_API_KEY,
            chat_client=chat_client,
        ):
            full_response.append(token)
            yield {"data": json.dumps({"type": "token", "content": token})}

        full_text = "".join(full_response)
        citations = extract_file_citations(full_text)
        yield {"data": json.dumps({"type": "done", "citations": citations})}

    return EventSourceResponse(event_stream())


@app.get("/file")
async def get_file(repo_id: str = Query(...), path: str = Query(...)):
    repo_dir = os.path.abspath(os.path.join(REPOS_DIR, repo_id))
    full_path = os.path.normpath(os.path.join(repo_dir, path))
    if not full_path.startswith(repo_dir):
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found in cloned repo")
    try:
        content = Path(full_path).read_text(encoding="utf-8", errors="replace")
        return {"path": path, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok"}
