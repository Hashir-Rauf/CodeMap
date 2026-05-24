import asyncio
import re
from typing import AsyncGenerator

import chromadb
import httpx
from google import genai
from google.genai import types as genai_types

# Try models in order until one works
CHAT_MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-flash-lite-latest"]


async def _embed_query_rest(query: str, api_key: str) -> list[float]:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models"
        f"/gemini-embedding-001:embedContent?key={api_key}"
    )
    payload = {
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": query}]},
        "taskType": "RETRIEVAL_QUERY",
    }
    backoff = 5
    async with httpx.AsyncClient(timeout=30) as client:
        for attempt in range(8):
            resp = await client.post(url, json=payload)
            if resp.status_code == 429:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)
                continue
            resp.raise_for_status()
            return resp.json()["embedding"]["values"]
    raise RuntimeError("Query embedding failed after retries")


async def chat_stream(
    query: str,
    repo_id: str,
    repo_name: str,
    chroma_dir: str,
    gemini_api_key: str,
    chat_client: genai.Client,
) -> AsyncGenerator[str, None]:
    try:
        query_embedding = await _embed_query_rest(query, gemini_api_key)

        chroma = chromadb.PersistentClient(path=chroma_dir)
        col = chroma.get_collection(repo_id)
        # Retrieve up to 15 chunks, or all of them if the collection is small
        n_results = min(15, col.count())
        results = col.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where={"repo_id": repo_id},
            include=["documents", "metadatas"],
        )

        docs = results["documents"][0]
        metas = results["metadatas"][0]

        context_parts = []
        for doc, meta in zip(docs, metas):
            lang = meta.get("language", "")
            fp = meta.get("file_path", "")
            context_parts.append(f"```{lang}\n# {fp}\n{doc}\n```")
        context = "\n\n".join(context_parts)

        prompt = f"""You are an expert codebase assistant for the repository: **{repo_name}**.

Answer developer questions about the codebase clearly and concisely.
Always cite specific file paths using backtick-wrapped paths like `src/auth.py` when referencing code locations.
Base your answers on the provided context chunks. If the answer is not in the context, say so honestly.

Context from the codebase:

{context}

---

Question: {query}"""

        # Try each model until one succeeds (quota fallback)
        last_err = None
        for model in CHAT_MODELS:
            try:
                async for chunk in await chat_client.aio.models.generate_content_stream(
                    model=model,
                    contents=prompt,
                    config=genai_types.GenerateContentConfig(
                        temperature=0.2,
                        max_output_tokens=1024,
                    ),
                ):
                    if chunk.text:
                        yield chunk.text
                return
            except Exception as e:
                last_err = e
                if "429" in str(e) or "quota" in str(e).lower() or "RESOURCE_EXHAUSTED" in str(e):
                    continue  # try next model
                raise

        yield f"\n\n⚠️ All models hit quota limits. Please wait a minute and try again.\n(Last error: {last_err})"

    except Exception as e:
        # Yield error as text so the stream closes cleanly (no ERR_INCOMPLETE_CHUNKED_ENCODING)
        yield f"Error: {e}"


def extract_file_citations(text: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"`([^`]*\.[a-zA-Z]{1,6})`", text)))
