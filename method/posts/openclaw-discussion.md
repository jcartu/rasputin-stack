# [Idea] Pre-compaction memory rescue: solving context loss with parallel fast-inference extraction

## The Problem

Context compaction is necessary but lossy. Multiple issues track this pain:
- #5429 — Lost 2 days of agent context to silent compaction
- #7477 — Default compaction mode silently fails on large contexts
- #2730 — Feature request: notify user when context is compacted

The summaries preserve facts but lose decision rationale, debugging context, and cross-reference chains.

## Proposed Solution: The operator Method

A pre-compaction memory rescue layer that:

1. Hooks into `preCompactionFlush` (already supported in OpenClaw config)
2. Before compaction fires, fans out 3 parallel calls to fast/cheap models (Cerebras, Groq, or local Ollama)
3. Each call extracts a different type of knowledge: facts/entities, decisions/rationale, skills/lessons
4. Memories are scored for importance (1-10) by an LLM evaluator
5. High-value memories (≥7) are committed to a vector database with dedup
6. Agent retrieves from vector DB on subsequent queries — zero amnesia

### Key design principle
Use the *cheapest, fastest* model for extraction, not your expensive reasoning model. A $0.10/MTok model (Cerebras Llama 70B at ~2000 tok/s) is perfect for "read this context and extract what matters."

## Production Results

Running in production for 3 months on a 24/7 autonomous agent:

- 761K+ memories in Qdrant
- 16ms average retrieval
- Zero context amnesia across 2,500+ compaction events
- ~$0.02 per compaction event ($45 total over 3 months)
- Decision recall: 23% → 89% after compaction

## Code

Full implementation open-sourced: **[joperator/operator-method](https://github.com/joperator/operator-method)**

- Python package with Qdrant, ChromaDB, and Pinecone backends
- Integrates directly with OpenClaw's `preCompactionFlush`
- Works with any OpenAI-compatible fast inference endpoint

## Potential Integration

This could become a first-class OpenClaw feature:
- `compaction.memoryRescue.enabled: true`
- `compaction.memoryRescue.model: "cerebras/llama-3.3-70b"`
- `compaction.memoryRescue.backend: "qdrant"`
- `compaction.memoryRescue.threshold: 7`

Would love to hear thoughts from the maintainers and community. Happy to contribute a PR if there's interest.
