# Hybrid Memory System

A memory layer combining vector search (Qdrant), knowledge graphs (FalkorDB), and cross-encoder reranking for AI agent long-term memory.

## Architecture

```
User Query
    │
    ▼
┌──────────────────┐
│ Query Expansion   │ → 5+ search angles from one question
│ (entity, topic,   │   (original, entity-specific, topic,
│  temporal, source) │    source-filtered, semantic opposite)
└────────┬─────────┘
         │
    ┌────┴────┬──────────┐
    ▼         ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│ Qdrant │ │FalkorDB│ │  BM25  │
│ Vector │ │ Graph  │ │ Sparse │
│ Search │ │Traversal│ │ Search │
└────┬───┘ └────┬───┘ └────┬───┘
     └──────────┼──────────┘
                ▼
         ┌──────────┐
         │ Reranker │ → bge-reranker-v2-m3
         │(cross-enc)│
         └────┬─────┘
              ▼
         ┌──────────┐
         │  Dedup   │ → Content hash deduplication
         │ + Format │   Smart truncation for LLM context
         └──────────┘
```

## Components

### `memory_engine.py` — Core Search & Commit
- **Multi-angle query expansion**: One user question generates 5+ search queries, each catching different memories
- **Entity graph lookup**: Maintains a local entity graph for fast pre-search context
- **Observational memory**: Sub-millisecond keyword lookup against compressed observations
- **Hybrid search**: Vector (Qdrant) + sparse (BM25) + graph (FalkorDB)
- **Cross-encoder reranking**: bge-reranker-v2-m3 reranks combined results
- **Smart deduplication**: Content-based dedup across multiple search angles
- **Modes**: `recall`, `commit`, `briefing`, `challenge`, `deep`, `whois`

### `enrich.py` — Importance Scoring Pipeline
- Batches 10 chunks per LLM call for importance scoring (1-10) and 1-line summaries
- Runs nightly, processing 500 chunks per run (~8 hours for 96K chunks total)
- Scores written back to Qdrant payload for priority-weighted retrieval
- Zero-cost: uses local Qwen model for all scoring

### `hot_commit.py` — Real-Time Fact Extraction (No LLM)
- Heuristic-based fact extraction from live sessions — no model call needed
- Scans recent session files for user statements, decisions, preferences
- Pattern matching for "I am", "decided", "changed", "starting" etc.
- Sub-second execution, safe for high-frequency cron

### `episode_detector.py` — Episodic Memory Detection
- Parses session transcripts into coherent "episodes" (topic-bounded conversation segments)
- Time-gap segmentation (30min threshold) + topic coherence scoring
- LLM-powered episode summarization and embedding
- Stored in dedicated Qdrant collection for temporal retrieval

### `fact_extractor.py` — LLM-Powered Personal Knowledge Mining
- Deep fact extraction from conversation history using local Qwen
- Structured output: who, what, when, significance
- Deduplication against existing facts (content hash)
- Runs every 4 hours via cron

### `graph_brain/` — Knowledge Graph Layer
- FalkorDB graph database alongside Qdrant vectors
- Node types: Memory, Person, Organization, Project, Topic, Location
- Relationship types: MENTIONS, ABOUT, RELATED_TO, WORKS_AT, etc.
- Entity extraction via local LLM (structured JSON output)
- Multi-hop traversal for "who is connected to what?" queries
- Full-text index on memory text for graph-side keyword search

## What Makes This Novel

1. **Multi-angle query expansion** — most RAG systems do one embedding search. This generates 5+ search queries per question (entity-specific, topic, temporal, source-filtered) and deduplicates results. Catches memories that single-vector search misses.

2. **Hybrid three-way search** — vector similarity + BM25 sparse + graph traversal, combined and reranked. Each modality catches different types of memories.

3. **Zero-cost enrichment** — importance scoring runs on local inference, processing the entire 96K vector store for $0. Enables priority-weighted retrieval without API costs.

4. **Heuristic hot commit** — the fast path doesn't even call a model. Pattern matching extracts facts in <100ms, so crons can run every few minutes without GPU contention.

5. **Episodic memory** — not just "facts" but "stories". Episode detection clusters conversations into coherent narratives with summaries, enabling "what happened last time we discussed X?" queries.
