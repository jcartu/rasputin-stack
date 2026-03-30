"""
The operator Method — Zero-loss context compaction for AI agents.

Pre-compaction memory rescue using parallel fast-inference extraction
and vector database persistence.
"""

__version__ = "0.1.0"

from .rescue import MemoryRescue
from .extractors import FactExtractor, DecisionExtractor, SkillExtractor
from .backends import QdrantBackend, ChromaBackend, PineconeBackend

__all__ = [
    "MemoryRescue",
    "FactExtractor",
    "DecisionExtractor", 
    "SkillExtractor",
    "QdrantBackend",
    "ChromaBackend",
    "PineconeBackend",
]
