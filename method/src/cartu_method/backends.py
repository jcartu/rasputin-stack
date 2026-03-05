"""
Vector database backends for storing rescued memories.
"""

import hashlib
import json
import os
import uuid
from typing import Any, Dict, List, Optional

from .rescue import Memory


class QdrantBackend:
    """Qdrant vector database backend with hybrid search."""

    def __init__(
        self,
        url: str = "http://localhost:6333",
        collection: str = "agent_memory",
        api_key: Optional[str] = None,
        embedding_model: str = "text-embedding-3-small",
        embedding_api_key: Optional[str] = None,
    ):
        self.url = url.rstrip("/")
        self.collection = collection
        self.api_key = api_key
        self.embedding_model = embedding_model
        self.embedding_api_key = embedding_api_key or os.environ.get("OPENAI_API_KEY", "")
        self._seen_hashes: set = set()
        self._ensure_collection()

    def _ensure_collection(self):
        """Create collection if it doesn't exist."""
        import httpx
        try:
            resp = httpx.get(f"{self.url}/collections/{self.collection}", timeout=5)
            if resp.status_code == 404:
                httpx.put(
                    f"{self.url}/collections/{self.collection}",
                    json={
                        "vectors": {"size": 1536, "distance": "Cosine"},
                    },
                    timeout=10,
                )
        except Exception:
            pass  # Best effort

    def _embed(self, text: str) -> List[float]:
        """Get embedding vector for text."""
        import httpx
        resp = httpx.post(
            "https://api.openai.com/v1/embeddings",
            headers={
                "Authorization": f"Bearer {self.embedding_api_key}",
                "Content-Type": "application/json",
            },
            json={"model": self.embedding_model, "input": text},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["data"][0]["embedding"]

    def commit(self, memory: Memory) -> bool:
        """Store a memory in Qdrant."""
        import httpx
        try:
            vector = self._embed(memory.text)
            point_id = str(uuid.uuid4())

            resp = httpx.put(
                f"{self.url}/collections/{self.collection}/points",
                json={
                    "points": [{
                        "id": point_id,
                        "vector": vector,
                        "payload": {
                            "text": memory.text,
                            "category": memory.category,
                            "importance": memory.importance,
                            "source_session": memory.source_session,
                            "commit_hash": memory.commit_hash,
                            "committed_at": memory.committed_at,
                            "extraction_model": memory.extraction_model,
                            **memory.metadata,
                        },
                    }],
                },
                timeout=10,
            )
            resp.raise_for_status()
            self._seen_hashes.add(memory.commit_hash)
            return True
        except Exception:
            return False

    def search(self, query: str, limit: int = 5) -> List[Memory]:
        """Semantic search over rescued memories."""
        import httpx
        try:
            vector = self._embed(query)
            resp = httpx.post(
                f"{self.url}/collections/{self.collection}/points/search",
                json={
                    "vector": vector,
                    "limit": limit,
                    "with_payload": True,
                },
                timeout=10,
            )
            resp.raise_for_status()
            results = resp.json().get("result", [])
            return [
                Memory(
                    text=r["payload"]["text"],
                    category=r["payload"].get("category", ""),
                    importance=r["payload"].get("importance", 0),
                    commit_hash=r["payload"].get("commit_hash", ""),
                    source_session=r["payload"].get("source_session", ""),
                )
                for r in results
            ]
        except Exception:
            return []

    def deduplicate(self, commit_hash: str) -> bool:
        """Check if memory with this hash already exists."""
        if commit_hash in self._seen_hashes:
            return True
        import httpx
        try:
            resp = httpx.post(
                f"{self.url}/collections/{self.collection}/points/scroll",
                json={
                    "filter": {
                        "must": [{"key": "commit_hash", "match": {"value": commit_hash}}]
                    },
                    "limit": 1,
                },
                timeout=5,
            )
            if resp.status_code == 200:
                points = resp.json().get("result", {}).get("points", [])
                if points:
                    self._seen_hashes.add(commit_hash)
                    return True
        except Exception:
            pass
        return False


class ChromaBackend:
    """ChromaDB backend for local/embedded use."""

    def __init__(
        self,
        path: str = "./chroma_data",
        collection: str = "agent_memory",
    ):
        try:
            import chromadb
            self.client = chromadb.PersistentClient(path=path)
            self.collection = self.client.get_or_create_collection(collection)
        except ImportError:
            raise ImportError("pip install chromadb")

    def commit(self, memory: Memory) -> bool:
        try:
            self.collection.add(
                documents=[memory.text],
                ids=[memory.commit_hash],
                metadatas=[{
                    "category": memory.category,
                    "importance": memory.importance,
                    "source_session": memory.source_session,
                    "committed_at": memory.committed_at,
                }],
            )
            return True
        except Exception:
            return False

    def search(self, query: str, limit: int = 5) -> List[Memory]:
        try:
            results = self.collection.query(query_texts=[query], n_results=limit)
            return [
                Memory(
                    text=doc,
                    category=meta.get("category", ""),
                    importance=meta.get("importance", 0),
                    commit_hash=id_,
                )
                for doc, meta, id_ in zip(
                    results["documents"][0],
                    results["metadatas"][0],
                    results["ids"][0],
                )
            ]
        except Exception:
            return []

    def deduplicate(self, commit_hash: str) -> bool:
        try:
            result = self.collection.get(ids=[commit_hash])
            return len(result["ids"]) > 0
        except Exception:
            return False


class PineconeBackend:
    """Pinecone managed cloud backend."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        index_name: str = "agent-memory",
        environment: str = "us-east-1",
    ):
        try:
            from pinecone import Pinecone
            self.pc = Pinecone(api_key=api_key or os.environ.get("PINECONE_API_KEY", ""))
            self.index = self.pc.Index(index_name)
        except ImportError:
            raise ImportError("pip install pinecone-client")
        
        self.embedding_api_key = os.environ.get("OPENAI_API_KEY", "")

    def _embed(self, text: str) -> List[float]:
        import httpx
        resp = httpx.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {self.embedding_api_key}", "Content-Type": "application/json"},
            json={"model": "text-embedding-3-small", "input": text},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["data"][0]["embedding"]

    def commit(self, memory: Memory) -> bool:
        try:
            vector = self._embed(memory.text)
            self.index.upsert(vectors=[{
                "id": memory.commit_hash,
                "values": vector,
                "metadata": {
                    "text": memory.text,
                    "category": memory.category,
                    "importance": memory.importance,
                    "source_session": memory.source_session,
                    "committed_at": memory.committed_at,
                },
            }])
            return True
        except Exception:
            return False

    def search(self, query: str, limit: int = 5) -> List[Memory]:
        try:
            vector = self._embed(query)
            results = self.index.query(vector=vector, top_k=limit, include_metadata=True)
            return [
                Memory(
                    text=m["metadata"]["text"],
                    category=m["metadata"].get("category", ""),
                    importance=m["metadata"].get("importance", 0),
                    commit_hash=m["id"],
                )
                for m in results["matches"]
            ]
        except Exception:
            return []

    def deduplicate(self, commit_hash: str) -> bool:
        try:
            result = self.index.fetch(ids=[commit_hash])
            return len(result.get("vectors", {})) > 0
        except Exception:
            return False
