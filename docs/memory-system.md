# Memory System Design

## Philosophy

An AI agent without memory is just a chatbot. Memory is the single most important differentiator between an assistant you tolerate and one you rely on.

This system is designed around three principles:
1. **Multiple search angles catch what single-vector misses** — the same question searched 5 different ways
2. **Memory should be self-maintaining** — enrichment, cleanup, and dedup run autonomously
3. **Zero-cost enrichment** — local inference means we can process 96K vectors for $0

## Three-Layer Architecture

### Layer 1: Vector Search (Qdrant)
- **96,000+ vectors** with 768-dimensional nomic-embed-text embeddings
- Payload includes: text, source, date, category, importance_score, summary
- Importance scoring enables priority-weighted retrieval
- Filtered search by source type (email, conversation, web, etc.)

### Layer 2: Knowledge Graph (FalkorDB)
- **240,000+ nodes** across 6 entity types (Memory, Person, Organization, Project, Topic, Location)
- **7 relationship types** for multi-hop traversal
- Entity extraction via local LLM with structured JSON output
- Full-text index on memory text for keyword fallback
- Enables queries like "who is connected to what project?" that vectors can't answer

### Layer 3: Sparse Search (BM25)
- Term-frequency search alongside vector similarity
- Catches exact keyword matches that embedding models might miss
- Particularly useful for proper nouns, technical terms, and IDs

## Query Pipeline

```python
def recall(query):
    # 1. Expand query into 5+ search angles
    queries = expand_queries(query)  # entity, topic, temporal, source, semantic
    
    # 2. Search all three layers in parallel
    vector_results = [search_qdrant(q) for q in queries]
    graph_results = traverse_graph(extract_entities(query))
    bm25_results = bm25_search(query)
    
    # 3. Merge and deduplicate
    all_results = merge(vector_results + graph_results + bm25_results)
    deduped = dedup_by_content_hash(all_results)
    
    # 4. Rerank with cross-encoder
    reranked = reranker.predict(query, deduped)  # bge-reranker-v2-m3
    
    # 5. Smart truncation for LLM context window
    return format_for_context(reranked, max_tokens=4000)
```

## Query Expansion Strategy

One user question becomes 5+ search queries:

| Angle | Example (query: "What supplements is she taking?") |
|-------|-----------------------------------------------------|
| Original | "What supplements is she taking?" |
| Entity-specific | "ContactName supplements" |
| Topic search | "supplements taking" |
| Source-filtered | "email supplements" (if email-related keywords detected) |
| Temporal | "recent supplements" (if time keywords detected) |
| Semantic expansion | "fertility supplements embryo PGT genetic screening" |

Each angle catches different memories. The entity search finds mentions by name. The topic search finds discussions about supplements in general. The source filter narrows to specific data types. Combined and reranked, this dramatically improves recall.

## Enrichment Pipeline

```
Raw Memory (96K chunks)
    │
    ▼ (batches of 10, local Qwen, $0)
┌──────────────────┐
│ Importance Score  │ → 1-10 scale
│ 1-Line Summary   │ → max 15 words
└──────────────────┘
    │
    ▼ (written back to Qdrant payload)
Enriched Memory
```

**Schedule:** 500 chunks/run × 4 runs/night = 2000/night → full corpus in ~7 weeks
**Cost:** $0 (all local inference)

## Autonomous Memory Maintenance

| Process | Frequency | What |
|---------|-----------|------|
| Hot Commit | Every 30min | Heuristic fact extraction (<100ms, no LLM) |
| Fact Extractor | Every 4h | Deep LLM-powered knowledge mining from sessions |
| Enrichment | Nightly | Importance scoring in batches |
| Episode Detection | Daily | Cluster conversations into episodic memories |
| Brain Cleanup | Weekly | Dedup, stale removal, consistency checks |
| Graph Deepening | Weekly | Discover new entity relationships |
| Weekly Synthesis | Weekly | Compress week's memories into observations |

## Embedding Consistency

**Critical lesson learned:** All vectors MUST use the same embedding model. The system uses Ollama's nomic-embed-text (768d). An earlier GPU embedding service used a different model version (v1.5, cosine similarity ~0.63 cross-model). Mixing models made memories effectively invisible during search. This was a silent failure — no errors, just degraded recall.
