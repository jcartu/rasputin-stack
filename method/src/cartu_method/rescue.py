"""
Core memory rescue engine — intercepts pre-compaction context and 
extracts durable memories using parallel fast-inference calls.
"""

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol

from .extractors import (
    BaseExtractor,
    DecisionExtractor,
    FactExtractor,
    SkillExtractor,
)


@dataclass
class Memory:
    """A single rescued memory with metadata."""
    text: str
    category: str              # fact | decision | skill
    importance: int            # 1-10
    source_session: str = ""
    source_timestamp: str = ""
    extraction_model: str = ""
    commit_hash: str = ""      # dedup key
    committed_at: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not self.commit_hash:
            self.commit_hash = hashlib.sha256(self.text.encode()).hexdigest()[:16]
        if not self.committed_at:
            self.committed_at = datetime.now(timezone.utc).isoformat()


class VectorBackend(Protocol):
    """Protocol for vector database backends."""
    def commit(self, memory: Memory) -> bool: ...
    def search(self, query: str, limit: int = 5) -> List[Memory]: ...
    def deduplicate(self, commit_hash: str) -> bool: ...


class MemoryRescue:
    """
    Pre-compaction memory rescue engine.
    
    Intercepts context before compaction, fans out to parallel extractors,
    scores importance, deduplicates, and commits to vector storage.
    
    Usage:
        rescue = MemoryRescue(
            backend=QdrantBackend(url="http://localhost:6333"),
            fast_model="cerebras/llama-3.3-70b",
            importance_threshold=7,
            parallel_extractors=3,
        )
        memories = rescue.extract_and_commit(context_text)
    """

    def __init__(
        self,
        backend: VectorBackend,
        fast_model: str = "cerebras/llama-3.3-70b",
        importance_threshold: int = 7,
        parallel_extractors: int = 3,
        api_base: Optional[str] = None,
        api_key: Optional[str] = None,
        max_context_chars: int = 100_000,
        dedup: bool = True,
        session_id: str = "",
    ):
        self.backend = backend
        self.fast_model = fast_model
        self.importance_threshold = importance_threshold
        self.parallel_extractors = parallel_extractors
        self.api_base = api_base
        self.api_key = api_key
        self.max_context_chars = max_context_chars
        self.dedup = dedup
        self.session_id = session_id

        # Default extractors — one per perspective
        self.extractors: List[BaseExtractor] = [
            FactExtractor(model=fast_model, api_base=api_base, api_key=api_key),
            DecisionExtractor(model=fast_model, api_base=api_base, api_key=api_key),
            SkillExtractor(model=fast_model, api_base=api_base, api_key=api_key),
        ][:parallel_extractors]

    def extract_and_commit(
        self,
        context: str,
        session_id: Optional[str] = None,
    ) -> List[Memory]:
        """
        Synchronous entry point: extract memories and commit to backend.
        
        Args:
            context: The full pre-compaction context text
            session_id: Optional session identifier for provenance
            
        Returns:
            List of committed Memory objects
        """
        return asyncio.run(self.aextract_and_commit(context, session_id))

    async def aextract_and_commit(
        self,
        context: str,
        session_id: Optional[str] = None,
    ) -> List[Memory]:
        """
        Async entry point: extract memories in parallel and commit.
        """
        sid = session_id or self.session_id
        
        # Truncate context if needed
        if len(context) > self.max_context_chars:
            context = context[-self.max_context_chars:]

        t0 = time.monotonic()

        # Fan-out: run all extractors in parallel
        tasks = [ext.extract(context) for ext in self.extractors]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Flatten and filter
        all_memories: List[Memory] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                continue
            for mem in result:
                mem.source_session = sid
                mem.extraction_model = self.fast_model
                all_memories.append(mem)

        # Score importance (already done by extractors, but filter here)
        qualified = [
            m for m in all_memories
            if m.importance >= self.importance_threshold
        ]

        # Deduplicate against existing memories
        committed: List[Memory] = []
        for mem in qualified:
            if self.dedup and self.backend.deduplicate(mem.commit_hash):
                continue  # Already exists
            if self.backend.commit(mem):
                committed.append(mem)

        elapsed = time.monotonic() - t0

        return committed

    def search(self, query: str, limit: int = 5) -> List[Memory]:
        """Search previously rescued memories."""
        return self.backend.search(query, limit=limit)

    def stats(self) -> Dict[str, Any]:
        """Return rescue statistics."""
        return {
            "model": self.fast_model,
            "extractors": len(self.extractors),
            "threshold": self.importance_threshold,
            "dedup": self.dedup,
        }
