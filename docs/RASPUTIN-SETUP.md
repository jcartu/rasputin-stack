# RASPUTIN Memory System — Part 1: Setup

**Target: Ubuntu server, zero VRAM, API-substituted LLMs, local nomic-embed-text on CPU.**

This is the standalone infrastructure and core system setup. For wiring into OpenClaw, see [Part 2: OpenClaw Integration](RASPUTIN-OPENCLAW.md).

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Phase 1: Infrastructure](#4-phase-1-infrastructure)
5. [Phase 2: Embedding Service](#5-phase-2-embedding-service)
6. [Phase 3: Hybrid Brain API Server](#6-phase-3-hybrid-brain-api-server)
7. [Phase 4: Search Pipeline](#7-phase-4-search-pipeline)
8. [Phase 5: Commit Pipeline](#8-phase-5-commit-pipeline)
9. [Phase 6: Quality Gate (A-MAC)](#9-phase-6-quality-gate-a-mac)
10. [Phase 7: Neural Reranker](#10-phase-7-neural-reranker)
11. [Phase 8: Knowledge Graph](#11-phase-8-knowledge-graph)
12. [Phase 9: Fact Extraction](#12-phase-9-fact-extraction)
13. [Phase 10: Enrichment & Maintenance](#13-phase-10-enrichment--maintenance)
14. [Phase 11: Process Management](#14-phase-11-process-management)
15. [Configuration Reference](#15-configuration-reference)
16. [Data Schemas](#16-data-schemas)
17. [Model Decision Guide](#17-model-decision-guide)
18. [Backup & Migration](#18-backup--migration)
19. [Troubleshooting](#19-troubleshooting)
20. [Implementation Checklist](#20-implementation-checklist)

---

## 1. System Overview

RASPUTIN is a self-hosted AI memory system that gives an AI agent persistent, searchable, cross-session memory. It combines:

- **Vector search** (Qdrant) — semantic similarity across all stored memories
- **Knowledge graph** (FalkorDB) — entity relationships and multi-hop traversal
- **BM25 keyword scoring** — exact term matching that vector search misses
- **Neural reranking** — cross-encoder precision scoring on top candidates
- **LLM quality gate** (A-MAC) — filters junk before storage
- **Fact extraction** — mines conversations for durable personal/project facts

All communication happens via HTTP `curl` calls to a local API on port 7777. Any agent that can run shell commands can use this system.

### No-VRAM Model Substitutions

This machine has no GPU. LLMs that previously ran locally are substituted with API calls. The embedding model (`nomic-embed-text`, 137M params) runs fine on CPU.

| Component | Original (GPU) | This Machine (CPU-only) |
|-----------|----------------|------------------------|
| **Embeddings** | `nomic-embed-text` on GPU via Ollama | `nomic-embed-text` on **CPU** via Ollama (~30-80ms/query) |
| **Reranker** | `bge-reranker-v2-m3` on GPU | `bge-reranker-v2-m3` **ONNX CPU** build (~0.5s/batch) |
| **A-MAC LLM** | `qwen3.5:35b` local GPU | **Claude Haiku API** (~$0.001/call, ~$9/month) |
| **Fact Extraction LLM** | `qwen3.5-122b` local GPU | **Claude Sonnet API** (every 4h, ~$0.50/day) |
| **Enrichment LLM** | Local Qwen | **Claude Haiku API** (nightly batch) |

---

## 2. Architecture

```
LAYER 1: HOT CONTEXT (always in agent prompt)
├── MEMORY.md / AGENTS.md / SOUL.md — identity, tools, rules
├── memory/hot-context/*.md — time-sensitive context (24h TTL)
└── memory/last-recall.md — auto-recall results (per-message)

LAYER 2: SEMANTIC SEARCH (on-demand retrieval)
├── Qdrant (port 6333) — 768d vectors, nomic-embed-text via Ollama
├── BM25 sparse keyword search (in-process, bm25_search.py)
└── Reranker (port 8006) — bge-reranker-v2-m3 CPU/ONNX

LAYER 3: KNOWLEDGE GRAPH (relationship reasoning)
├── FalkorDB (port 6380, Docker) — entity nodes + edges
└── Entity extraction: fast regex NER on every commit (<1ms)

LAYER 4: HYBRID SEARCH ENGINE (orchestration)
└── hybrid_brain.py (PM2 daemon, port 7777)
    ├── /search — vector + graph + BM25 + neural rerank
    ├── /commit — A-MAC + embed + dedup + store + graph
    ├── /graph — direct Cypher queries
    ├── /stats — counts + health
    ├── /health — component status
    └── /amac/metrics — quality gate stats

LAYER 5: LLM ENRICHMENT (quality + extraction)
├── A-MAC quality gate — Claude Haiku API scores every commit
├── fact_extractor.py — every 4h cron, mines sessions for facts
└── enrich_second_brain.py — nightly importance scoring + tagging

LAYER 6: AGENT INTEGRATION (see Part 2 for OpenClaw)
├── Any agent: curl calls to port 7777
└── OpenClaw: hooks for auto-recall, session capture, context injection
```

### Data Flow: Search

```
Query → Ollama embed (CPU, ~50ms) → 768d vector
  → Qdrant ANN search (HNSW, top 40 candidates, threshold 0.50)
  → FalkorDB graph search (entity lookup + 2-hop traversal)
  → Reciprocal Rank Fusion (merge vector + graph + BM25)
  → Ebbinghaus temporal decay (importance-scaled half-life)
  → Multi-factor scoring (source weight × importance × recency × retrieval boost)
  → Neural reranker (bge-reranker CPU, top 50 → top K)
  → Graph enrichment (entity context appended)
  → Return top K results + graph context
Total: ~200-500ms on CPU
```

### Data Flow: Commit

```
New memory text
  → A-MAC quality gate (Claude Haiku API, ~1s)
    → Score: Relevance × Novelty × Specificity (0-10 each)
    → Composite < 4.0 → REJECTED (logged)
    → Timeout (30s) → FAIL-OPEN (accept anyway)
  → Embed text (Ollama CPU, ~50ms)
  → Dedup check (cosine > 0.92 + text overlap > 50% → update existing)
  → Qdrant upsert (768d vector + payload)
  → Entity extraction (regex NER, <1ms)
  → FalkorDB graph write (entity nodes + MENTIONED_IN edges)
  → Return: {id, entities, graph_written, amac_scores}
```

---

## 3. Prerequisites

### System Requirements

- **Ubuntu 22.04+** (or any recent Debian-based distro)
- **Docker + Docker Compose** v2
- **Python 3.10+**
- **Node.js 18+** (for OpenClaw hooks)
- **16GB+ RAM**, 50GB+ disk
- No GPU required

### Install System Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Python
sudo apt install -y python3 python3-pip python3-venv

# Redis CLI (for FalkorDB testing)
sudo apt install -y redis-tools

# Build tools (needed for some Python packages)
sudo apt install -y build-essential
```

### Python Packages

```bash
pip3 install qdrant-client redis requests fastapi uvicorn python-dotenv anthropic
```

### Node.js Global Packages

```bash
sudo npm install -g pm2
```

### API Keys

| Service | Purpose | Get Key At |
|---------|---------|-----------|
| **Anthropic** | A-MAC scoring (Haiku), fact extraction (Sonnet), enrichment (Haiku) | [console.anthropic.com](https://console.anthropic.com/) |

> Any OpenAI-compatible chat endpoint can substitute for Anthropic. Adjust the A-MAC code accordingly.

---

## 4. Phase 1: Infrastructure

### 4.1 Qdrant (Vector Database) — Port 6333

```bash
docker run -d --name qdrant \
  --restart unless-stopped \
  -p 6333:6333 -p 6334:6334 \
  -v ~/.qdrant_storage:/qdrant/storage \
  qdrant/qdrant:latest
```

Verify:
```bash
curl http://localhost:6333/collections
# Expected: {"result":{"collections":[]},"status":"ok","time":...}
```

Create the `second_brain` collection:
```bash
curl -X PUT http://localhost:6333/collections/second_brain \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    },
    "optimizers_config": {
      "memmap_threshold": 20000
    },
    "hnsw_config": {
      "m": 16,
      "ef_construct": 100
    }
  }'
```

### 4.2 FalkorDB (Knowledge Graph) — Port 6380

```bash
docker run -d --name falkordb \
  --restart unless-stopped \
  -p 6380:6379 \
  -v ~/.falkordb_data:/data \
  falkordb/falkordb:latest
```

Verify:
```bash
redis-cli -p 6380 PING
# Expected: PONG
```

> FalkorDB uses Redis protocol internally on port 6379, mapped to host port 6380. The graph named `"brain"` is auto-created on first write.

### 4.3 Docker Compose (Alternative)

Save as `docker-compose.yml`:

```yaml
version: '3.8'
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - ~/.qdrant_storage:/qdrant/storage
    restart: unless-stopped

  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - "6380:6379"
    volumes:
      - ~/.falkordb_data:/data
    restart: unless-stopped
```

```bash
docker compose up -d
```

---

## 5. Phase 2: Embedding Service

### 5.1 Ollama + nomic-embed-text — Port 11434

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the embedding model
ollama pull nomic-embed-text

# Ollama runs as a systemd service automatically
sudo systemctl status ollama
```

Verify:
```bash
curl -s http://localhost:11434/api/embed \
  -d '{"model": "nomic-embed-text", "input": ["test query"]}' | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'OK, dim: {len(d[\"embeddings\"][0])}')"
# Expected: OK, dim: 768
```

### 5.2 CPU Performance

`nomic-embed-text` (137M params) on CPU:
- **Single query**: 30-80ms depending on text length
- **Batch throughput**: ~10-20 embeddings/second
- **Bulk import** (100K docs): several hours — run overnight or use ONNX int8 quantization for ~3x speedup

This is fast enough for interactive use. No GPU needed.

### 5.3 Embedding Function

```python
import requests

EMBED_URL = "http://localhost:11434/api/embed"
EMBED_MODEL = "nomic-embed-text"

def get_embedding(text):
    """Get 768d vector from Ollama nomic-embed-text."""
    resp = requests.post(EMBED_URL, json={
        "model": EMBED_MODEL,
        "input": text[:4000]
    }, timeout=35)
    data = resp.json()
    if "embeddings" in data:
        return data["embeddings"][0]
    elif "embedding" in data:
        return data["embedding"]
    raise ValueError(f"Unexpected response: {list(data.keys())}")
```

### 5.4 CRITICAL: Embedding Model Consistency

**ALL vectors MUST use the same embedding model.** Mixing models (e.g., nomic v1 vs v1.5) produces cosine ~0.63 between identical texts — memories become invisible. If you switch models, re-embed your entire collection.

| Model | Dimensions | Compatible with stored vectors? |
|-------|-----------|-------------------------------|
| `nomic-embed-text` v1 (Ollama :11434) | 768 | **YES — production default** |
| `nomic-embed-text` v1.5 | 768 | **NO** — different vector space |
| Any other model | varies | **NO** — requires re-embedding |

---

## 6. Phase 3: Hybrid Brain API Server

The core server `hybrid_brain.py` runs on **port 7777** via PM2.

### 6.1 Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/search` | GET/POST | Hybrid semantic + graph + BM25 + reranker search |
| `/commit` | POST | Store memory (A-MAC → embed → dedup → store → graph) |
| `/graph` | GET/POST | Direct FalkorDB graph queries |
| `/stats` | GET | Collection sizes and health |
| `/health` | GET | Component status check |
| `/amac/metrics` | GET | A-MAC acceptance/rejection stats |

### 6.2 Configuration

```python
# === Database Connections ===
QDRANT_URL = "http://localhost:6333"
COLLECTION = "second_brain"
FALKORDB_HOST = "localhost"
FALKORDB_PORT = 6380
FALKORDB_GRAPH = "brain"

# === Embedding ===
EMBED_URL = "http://localhost:11434/api/embed"
EMBED_MODEL = "nomic-embed-text"
EMBED_DIM = 768

# === Neural Reranker ===
RERANKER_URL = "http://localhost:8006/rerank"  # None to disable

# === A-MAC Quality Gate (API-based, no local GPU) ===
AMAC_ENABLED = True
AMAC_THRESHOLD = 4.0
AMAC_TIMEOUT = 30
AMAC_PROVIDER = "anthropic"
AMAC_MODEL = "claude-3-haiku-20240307"

# === Search Tuning ===
DEFAULT_SEARCH_LIMIT = 10
DEFAULT_SCORE_THRESHOLD = 0.50
RERANKER_CANDIDATE_POOL = 50
DEDUP_THRESHOLD = 0.92
TEXT_OVERLAP_THRESHOLD = 0.50
```

### 6.3 Running

```bash
# Direct
python3 hybrid_brain.py

# Via PM2 (production)
pm2 start hybrid_brain.py --name rasputin --interpreter python3
pm2 save
pm2 startup  # auto-start on reboot
```

### 6.4 API Usage Examples

**Search:**
```bash
curl -s "http://localhost:7777/search?q=project+planning+decisions&limit=5"

# With source filter
curl -s "http://localhost:7777/search?q=database+migration&limit=10&source=conversation"

# POST
curl -s -X POST http://localhost:7777/search \
  -H 'Content-Type: application/json' \
  -d '{"q": "authentication architecture", "limit": 5}'
```

**Search response:**
```json
{
  "query": "project planning decisions",
  "elapsed_ms": 187,
  "results": [
    {
      "score": 0.7234,
      "text": "Alice decided to use microservices...",
      "source": "conversation",
      "date": "2026-03-15T10:30:00",
      "importance": 70,
      "retrieval_count": 3,
      "rerank_score": 0.934,
      "bm25_score": 4.21
    }
  ],
  "graph_context": [
    {"entity": "Alice", "connected_to": "Acme Corp", "relationship": "MENTIONED_IN"}
  ],
  "stats": {"qdrant_hits": 8, "graph_hits": 3, "neural_reranked": true}
}
```

**Commit:**
```bash
curl -s -X POST http://localhost:7777/commit \
  -H 'Content-Type: application/json' \
  -d '{"text": "Alice decided to migrate to PostgreSQL by Q2 2026", "source": "conversation", "importance": 70}'
```

**Commit response (accepted):**
```json
{
  "ok": true, "id": 8234567890123456,
  "dedup": {"action": "created", "similarity": null},
  "graph": {"entities": 2, "connected_to": ["Alice", "PostgreSQL"]},
  "amac": {"relevance": 8, "novelty": 7, "specificity": 9, "composite": 8.0}
}
```

**Commit response (rejected):**
```json
{
  "ok": false, "rejected": true,
  "reason": "amac_below_threshold",
  "scores": {"relevance": 2, "novelty": 1, "specificity": 1, "composite": 1.33},
  "threshold": 4.0
}
```

**Health / Stats:**
```bash
curl -s http://localhost:7777/health | python3 -m json.tool
curl -s http://localhost:7777/stats | python3 -m json.tool
curl -s http://localhost:7777/amac/metrics | python3 -m json.tool
```

---

## 7. Phase 4: Search Pipeline

Stages execute in order when `/search` is called:

### Stage 1: Embed Query

Text → Ollama `nomic-embed-text` → 768d float vector (~50ms CPU).

### Stage 2: Qdrant ANN Search

```python
def qdrant_search(query, limit=10, source_filter=None):
    vector = get_embedding(query)
    results = qdrant.query_points(
        collection_name=COLLECTION,
        query=vector,
        limit=limit * 4,  # Overfetch for reranking
        query_filter=source_filter,
        with_payload=True,
    )
    return [{"score": p.score, **p.payload} for p in results.points]
```

### Stage 3: Ebbinghaus Temporal Decay

Older memories decay unless important or frequently retrieved:

```python
import math
from datetime import datetime

def apply_temporal_decay(results):
    now = datetime.now()
    for r in results:
        importance = r.get("importance", 50)
        days_old = (now - datetime.fromisoformat(r.get("date", now.isoformat()))).total_seconds() / 86400

        if importance >= 80:   base_half_life = 365   # 1 year
        elif importance >= 40: base_half_life = 60    # 2 months
        else:                  base_half_life = 14    # 2 weeks

        retrieval_count = r.get("retrieval_count", 0) or 0
        effective_half_life = base_half_life * (1 + 0.1 * min(retrieval_count, 20))
        stability = effective_half_life / math.log(2)
        decay_factor = math.exp(-days_old / stability)

        r["score"] = round(r["score"] * (0.2 + 0.8 * decay_factor), 4)  # Floor 20%
    return results
```

### Stage 4: Multi-Factor Scoring

```python
SOURCE_WEIGHTS = {
    "conversation": 0.9, "fact_extractor": 0.85,
    "email": 0.6, "web_page": 0.4,
}

def apply_multifactor_scoring(results):
    for r in results:
        importance_norm = r.get("importance", 50) / 100
        source_weight = SOURCE_WEIGHTS.get(r.get("source", ""), 0.5)
        retrieval_boost = min(r.get("retrieval_count", 0) or 0, 20) / 20
        recency = max(0, 1 - days_old / 365)

        multiplier = (0.35 + 0.25 * importance_norm + 0.20 * recency
                      + 0.10 * source_weight + 0.10 * retrieval_boost)
        r["score"] = round(r["score"] * multiplier, 4)
    return results
```

### Stage 5: BM25 + Reciprocal Rank Fusion

```python
class BM25Scorer:
    def __init__(self, k1=1.5, b=0.75):
        self.k1, self.b = k1, b

    def score(self, query_terms, documents):
        N = len(documents)
        avg_dl = sum(len(d.split()) for d in documents) / max(N, 1)
        scores = []
        for doc in documents:
            doc_terms = doc.lower().split()
            dl = len(doc_terms)
            s = 0
            for term in query_terms:
                n = sum(1 for d in documents if term in d.lower())
                idf = math.log((N - n + 0.5) / (n + 0.5) + 1)
                freq = doc_terms.count(term.lower())
                tf_norm = (freq * (self.k1 + 1)) / (freq + self.k1 * (1 - self.b + self.b * dl / avg_dl))
                s += idf * tf_norm
            scores.append(s)
        return scores

def reciprocal_rank_fusion(dense_results, bm25_scores, k=60):
    rrf_scores = {}
    dense_ranked = sorted(range(len(dense_results)), key=lambda i: dense_results[i]["score"], reverse=True)
    bm25_ranked = sorted(range(len(bm25_scores)), key=lambda i: bm25_scores[i], reverse=True)
    for rank, idx in enumerate(dense_ranked):
        rrf_scores[idx] = rrf_scores.get(idx, 0) + 1.0 / (k + rank + 1)
    for rank, idx in enumerate(bm25_ranked):
        rrf_scores[idx] = rrf_scores.get(idx, 0) + 1.0 / (k + rank + 1)
    return rrf_scores
```

### Stage 6: Neural Reranking

```python
def neural_rerank(query, results, top_k=None):
    if not RERANKER_URL:
        return results
    passages = [r.get("text", "")[:1000] for r in results]
    try:
        resp = requests.post(RERANKER_URL, json={
            "query": query, "passages": passages
        }, timeout=15)
        scores = resp.json().get("scores", [])
        for i, r in enumerate(results):
            r["rerank_score"] = scores[i] if i < len(scores) else 0
        return sorted(results, key=lambda x: x.get("rerank_score", 0), reverse=True)
    except Exception:
        return results  # Graceful fallback
```

### Stage 7: Graph Search + Enrichment

Graph traversal finds entity relationships. See [Phase 8](#11-phase-8-knowledge-graph).

---

## 8. Phase 5: Commit Pipeline

### Step 1: A-MAC Quality Gate

See [Phase 6](#9-phase-6-quality-gate-a-mac).

### Step 2: Deduplication

```python
def check_duplicate(vector, text, threshold=0.92):
    results = qdrant.query_points(
        collection_name=COLLECTION, query=vector,
        limit=3, with_payload=True,
    )
    for point in results.points:
        if point.score >= threshold:
            existing_text = point.payload.get("text", "")
            words_new = set(text.lower().split())
            words_old = set(existing_text.lower().split())
            overlap = len(words_new & words_old) / max(len(words_new | words_old), 1)
            if overlap > 0.5 or point.score >= 0.95:
                return True, point.id, round(point.score, 4)
    return False, None, 0
```

- Cosine ≥ 0.92 AND overlap > 50% → **update** existing
- Cosine ≥ 0.95 → **update** regardless
- Otherwise → **create** new

### Step 3: Store + Entity Extract + Graph Write

```python
def commit_memory(text, source="conversation", importance=60, force=False):
    if AMAC_ENABLED and not force:
        passed, reason, scores = amac_gate(text)
        if not passed:
            return {"ok": False, "rejected": True, "reason": reason, "scores": scores}

    vector = get_embedding(text[:4000])
    is_dup, existing_id, similarity = check_duplicate(vector, text)
    point_id = existing_id if is_dup else int(time.time() * 1000000)

    payload = {
        "text": text[:4000], "source": source,
        "date": datetime.now().isoformat(),
        "importance": importance, "retrieval_count": 0,
    }
    qdrant.upsert(
        collection_name=COLLECTION,
        points=[PointStruct(id=point_id, vector=vector, payload=payload)]
    )

    entities = extract_entities_fast(text)
    connected_to = write_to_graph(point_id, text, entities)
    if connected_to:
        qdrant.set_payload(collection_name=COLLECTION,
            points=[point_id], payload={"connected_to": connected_to})

    return {
        "ok": True, "id": point_id,
        "dedup": {"action": "updated" if is_dup else "created", "similarity": similarity},
        "graph": {"entities": len(entities), "connected_to": connected_to}
    }
```

---

## 9. Phase 6: Quality Gate (A-MAC)

**A-MAC** (Admission Memory Assessment and Control) scores each memory on:

- **Relevance (0-10)**: About topics you care about?
- **Novelty (0-10)**: Genuinely new information?
- **Specificity (0-10)**: Concrete details (names, numbers, dates)?

Composite = mean of all three. Threshold: **4.0**.

### 9.1 API-Based Scoring (Claude Haiku)

```python
import anthropic
import re, os

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY_RASP"))

AMAC_PROMPT = """You are a memory quality filter. Score the following memory on 3 dimensions.
Return ONLY three integers separated by commas. No text, no explanation. Just three numbers like: 7,4,8

Relevance 0-10: Is this about your user's key domains? (0=totally unrelated, 10=highly relevant)
Novelty 0-10: Does this add genuinely NEW, specific information? (0=generic platitude, 10=unique concrete fact)
Specificity 0-10: Is this a concrete verifiable fact with numbers/names/dates? (0=vague filler, 10=specific actionable data)

Examples:
"Things are going well." -> 0,1,0
"The weather is nice today." -> 1,1,1
"Project Alpha deadline moved to Q3 2026, budget approved at $500K." -> 9,8,10

Memory: "{text}"

Output format: R,N,S (three integers separated by commas, nothing else)"""
```

> **Customize**: Replace the Relevance description with YOUR domains.

### 9.2 Implementation

```python
def amac_score(text):
    prompt = AMAC_PROMPT.format(text=text[:800])
    try:
        response = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = response.content[0].text.strip()

        all_triplets = []
        for line in raw.split('\n'):
            found = re.findall(r'(?<!\d)(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})(?!\d)', line)
            for s in found:
                if all(0 <= int(x) <= 10 for x in s):
                    all_triplets.append(s)

        if not all_triplets:
            return None
        r, n, s = [float(x) for x in all_triplets[-1]]
        return r, n, s, round((r + n + s) / 3, 2)
    except Exception:
        return None

def amac_gate(text, force=False):
    if force:
        return True, "bypassed", {}
    if not AMAC_ENABLED:
        return True, "disabled", {}
    if re.search(r'PIPELINE_TEST_|HEALTH_CHECK_|SYSTEM_DIAGNOSTIC_', text, re.IGNORECASE):
        return True, "diagnostic_skip", {}

    result = amac_score(text)
    if result is None:
        return True, "timeout_failopen", {}

    relevance, novelty, specificity, composite = result
    scores = {"relevance": relevance, "novelty": novelty, "specificity": specificity, "composite": composite}
    if composite >= AMAC_THRESHOLD:
        return True, "accepted", scores
    else:
        return False, "below_threshold", scores
```

### 9.3 Design Decisions

- **Fail-open**: API down → accept. Better noisy than lost.
- **Use LAST triplet**: LLMs may echo examples before the real answer.
- **Cost**: Haiku ~$0.001/call. 300 calls/day ≈ $9/month.

---

## 10. Phase 7: Neural Reranker

### 10.1 CPU Setup

```bash
pip3 install flask transformers torch sentencepiece
```

Create `~/tools/reranker_server.py`:

```python
from flask import Flask, request, jsonify
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

app = Flask(__name__)
MODEL_NAME = "BAAI/bge-reranker-v2-m3"
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
model.eval()

@app.route("/rerank", methods=["POST"])
def rerank():
    data = request.json
    pairs = [[data["query"], p] for p in data["passages"]]
    with torch.no_grad():
        inputs = tokenizer(pairs, padding=True, truncation=True,
                          max_length=512, return_tensors="pt")
        scores = model(**inputs).logits.squeeze(-1).tolist()
    if isinstance(scores, float):
        scores = [scores]
    return jsonify({"scores": scores})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8006)
```

```bash
pm2 start ~/tools/reranker_server.py --name reranker --interpreter python3
```

Verify:
```bash
curl -s http://localhost:8006/rerank \
  -H 'Content-Type: application/json' \
  -d '{"query": "test", "passages": ["hello world", "unrelated"]}'
```

### 10.2 CPU Tuning

Reduce candidate pool for faster responses:
```python
RERANKER_CANDIDATE_POOL = 20  # Down from 50, saves ~250ms on CPU
```

Or disable entirely: `RERANKER_URL = None`. System falls back to vector + BM25.

---

## 11. Phase 8: Knowledge Graph

### 11.1 Entity Extraction (Fast Regex NER, <1ms)

```python
import re

def extract_entities_fast(text):
    entities = []
    seen = set()

    KNOWN_PERSONS = set()       # Populate with known names
    KNOWN_ORGS = set()
    KNOWN_PROJECTS = set()

    text_lower = text.lower()
    for name in KNOWN_PERSONS:
        if name.lower() in text_lower and name not in seen:
            seen.add(name); entities.append((name, "Person"))
    for name in KNOWN_ORGS:
        if name.lower() in text_lower and name not in seen:
            seen.add(name); entities.append((name, "Organization"))
    for name in KNOWN_PROJECTS:
        if name.lower() in text_lower and name not in seen:
            seen.add(name); entities.append((name, "Project"))

    # Unknown capitalized multi-word names
    for match in re.finditer(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b', text):
        name = match.group(1)
        if name not in seen and len(name) > 4:
            seen.add(name); entities.append((name, "Person"))
    return entities
```

### 11.2 FalkorDB Write

```python
import redis

r = redis.Redis(host=FALKORDB_HOST, port=FALKORDB_PORT)

def write_to_graph(point_id, text, entities):
    connected_to = []
    ts = datetime.now().isoformat()
    text_preview = text[:500].replace("'", "\\'").replace('"', '\\"')
    try:
        r.execute_command('GRAPH.QUERY', FALKORDB_GRAPH, f"""
            MERGE (m:Memory {{id: '{point_id}'}})
            SET m.text = '{text_preview}', m.created_at = '{ts}'
        """)
        for name, etype in entities:
            safe_name = name.replace("'", "\\'")
            r.execute_command('GRAPH.QUERY', FALKORDB_GRAPH, f"""
                MERGE (n:{etype} {{name: '{safe_name}'}})
                ON CREATE SET n.type = '{etype}', n.created_at = '{ts}'
                WITH n
                MATCH (m:Memory {{id: '{point_id}'}})
                MERGE (n)-[:MENTIONED_IN]->(m)
            """)
            connected_to.append(safe_name)
    except Exception:
        pass  # Non-fatal
    return connected_to
```

### 11.3 Graph Search

```python
def graph_search(query, hops=2, limit=10):
    entities = extract_entities_fast(query)
    results = []
    for entity_name, entity_type in entities[:3]:
        safe = entity_name.replace("'", "\\'")
        for label in ["Person", "Organization", "Project", "Topic", "Location"]:
            try:
                match = r.execute_command('GRAPH.QUERY', FALKORDB_GRAPH, f"""
                    MATCH (n:{label})
                    WHERE toLower(n.name) CONTAINS toLower('{safe}')
                    RETURN id(n), n.name LIMIT 3
                """)
                for row in match[1]:
                    node_id = row[0]
                    hood = r.execute_command('GRAPH.QUERY', FALKORDB_GRAPH, f"""
                        MATCH (start)-[rel]-(connected)
                        WHERE id(start) = {node_id}
                        RETURN labels(connected)[0], connected.name, type(rel)
                        LIMIT {limit}
                    """)
                    for conn in hood[1]:
                        results.append({
                            "entity": entity_name, "connected_to": conn[1],
                            "relationship": conn[2], "node_type": conn[0], "origin": "graph"
                        })
            except Exception:
                continue
    return results
```

### 11.4 Schema

**Node labels**: `Person`, `Organization`, `Project`, `Topic`, `Location`, `Memory`

**Edge type**: `MENTIONED_IN` (Entity → Memory)

**Key query — find relationships through shared memories:**
```cypher
MATCH (source)-[:MENTIONED_IN]->(m:Memory)<-[:MENTIONED_IN]-(related)
WHERE source.name = 'Alice'
RETURN related.name, labels(related), count(m) AS shared_memories
ORDER BY shared_memories DESC
```

---

## 12. Phase 9: Fact Extraction

`fact_extractor.py` mines conversation transcripts via a 3-pass LLM pipeline. Runs every 4 hours.

### 12.1 Three Passes

**Pass 1 — Extract**: LLM identifies candidate facts with strict specificity (must have names/dates/numbers/decisions).

**Pass 2 — Verify**: Cross-reference against source text. Remove HALLUCINATED, keep CONFIRMED and INFERRED.

**Pass 3 — Filter**: Compare against existing `facts.jsonl`. Remove duplicates and ephemeral content.

### 12.2 Storage

Surviving facts go to:

1. **JSONL** (`memory/facts.jsonl`):
```json
{"ts": "2026-03-15T10:00:00", "category": "Technical decisions", "fact": "Team chose PostgreSQL", "hash": "a1b2c3d4"}
```

2. **Brain API** via `/commit` (for embedding + graph + dedup).

### 12.3 Dedup

```python
import hashlib
def is_duplicate_fact(fact_text, existing_hashes):
    h = hashlib.md5(fact_text.lower().strip().encode()).hexdigest()
    return h in existing_hashes, h
```

### 12.4 LLM

Uses Claude Sonnet API. Configure:
```python
FACT_LLM_MODEL = "claude-sonnet-4-6-20250514"
```

### 12.5 Schedule

```bash
# Crontab
crontab -e
# Add:
0 */4 * * * cd ~/tools && python3 fact_extractor.py >> /tmp/fact_extractor.log 2>&1
```

Or via PM2:
```bash
pm2 start ~/tools/fact_extractor.py --name fact-extractor --interpreter python3 \
  --cron "0 */4 * * *" --no-autorestart
```

---

## 13. Phase 10: Enrichment & Maintenance

### 13.1 Second Brain Enrichment

`enrich_second_brain.py` runs nightly. For each memory batch:
1. Generate importance score (0-100)
2. Extract/refine tags
3. Identify category
4. Update Qdrant payload

Uses Claude Haiku API (~$0.05/night for 600 memories).

```bash
# Crontab — nightly at 2 AM
0 2 * * * cd ~/tools && python3 enrich_second_brain.py --batch 100 >> /tmp/enrichment.log 2>&1
```

### 13.2 Observational Memory

Fast local cache at `memory/om_observations.md`:
- Date-grouped observation blocks
- Keyword overlap scoring (pure Python, <1ms)
- 24h TTL — stale entries flagged
- Prepended to search results for recency

### 13.3 Entity Graph Cache

Lightweight JSON at `memory/entity_graph.json`:
```json
{
  "people": {"Alice": {"role": "wife", "context": "project planning"}},
  "companies": {"Acme Corp": {"type": "SaaS", "context": "EMEA market"}}
}
```
Read in-process during query expansion to enrich entity searches.

---

## 14. Phase 11: Process Management

### 14.1 PM2

```bash
# Start all services
pm2 start ~/tools/hybrid_brain.py --name rasputin --interpreter python3
pm2 start ~/tools/reranker_server.py --name reranker --interpreter python3

# Save + auto-start on reboot
pm2 save
pm2 startup
# Follow the output instructions (sudo command)
```

### 14.2 PM2 Commands

```bash
pm2 list                     # All processes
pm2 logs rasputin            # Brain server logs
pm2 logs rasputin --lines 50 # Last 50 lines
pm2 restart rasputin         # Restart
pm2 monit                    # Live dashboard
```

### 14.3 Health Check Script

Save as `~/tools/healthcheck.sh`:

```bash
#!/bin/bash
echo "=== Docker Containers ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo -e "\n=== Qdrant ==="
curl -s http://localhost:6333/collections | python3 -m json.tool

echo -e "\n=== FalkorDB ==="
redis-cli -p 6380 PING

echo -e "\n=== Ollama Embed ==="
curl -s http://localhost:11434/api/embed \
  -d '{"model":"nomic-embed-text","input":["test"]}' | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f'OK, dim={len(d[\"embeddings\"][0])}')"

echo -e "\n=== Brain API ==="
curl -s http://localhost:7777/health | python3 -m json.tool

echo -e "\n=== Reranker ==="
curl -s http://localhost:8006/rerank \
  -H 'Content-Type: application/json' \
  -d '{"query":"t","passages":["t"]}' | python3 -c "import json,sys; print('OK')"

echo -e "\n=== PM2 ==="
pm2 list
```

```bash
chmod +x ~/tools/healthcheck.sh
```

---

## 15. Configuration Reference

### 15.1 Port Map

| Port | Service | Purpose |
|------|---------|---------|
| **6333** | Qdrant | Vector database HTTP API |
| **6334** | Qdrant | gRPC (not used) |
| **6380** | FalkorDB | Knowledge graph (Redis protocol) |
| **7777** | hybrid_brain.py | Main memory API |
| **7778** | graph_api.py | Graph expansion API (optional) |
| **8006** | reranker_server.py | Neural reranker |
| **11434** | Ollama | Embedding model |
| **18790** | openclaw-mem | MCP server (OpenClaw only, see Part 2) |

### 15.2 Environment Variables

```bash
# ~/.bashrc
export ANTHROPIC_API_KEY_RASP="sk-ant-..."

# Optional overrides
export RASPUTIN_QDRANT_URL="http://localhost:6333"
export RASPUTIN_EMBED_URL="http://localhost:11434/api/embed"
export RASPUTIN_RERANKER_URL="http://localhost:8006/rerank"
export RASPUTIN_AMAC_THRESHOLD="4.0"
export RASPUTIN_PORT="7777"
```

### 15.3 All Constants

| Constant | Default | Description |
|----------|---------|-------------|
| `COLLECTION` | `"second_brain"` | Qdrant collection name |
| `EMBED_MODEL` | `"nomic-embed-text"` | **DO NOT CHANGE** after vectors stored |
| `EMBED_DIM` | `768` | Vector dimensions |
| `FALKORDB_GRAPH` | `"brain"` | FalkorDB graph name |
| `AMAC_THRESHOLD` | `4.0` | Minimum composite score (lower=more permissive) |
| `AMAC_TIMEOUT` | `30` | Seconds before fail-open |
| `DEFAULT_SEARCH_LIMIT` | `10` | Results per search |
| `DEFAULT_SCORE_THRESHOLD` | `0.50` | Minimum cosine similarity |
| `RERANKER_CANDIDATE_POOL` | `50` | Top-N to reranker (lower=faster on CPU) |
| `DEDUP_THRESHOLD` | `0.92` | Cosine = duplicate |
| `TEXT_OVERLAP_THRESHOLD` | `0.50` | Word overlap = duplicate |
| `BM25_K1` | `1.5` | Term frequency saturation |
| `BM25_B` | `0.75` | Length normalization |
| `RRF_K` | `60` | Reciprocal Rank Fusion constant |
| `OM_MAX_AGE_HOURS` | `24` | Observational memory freshness |

### 15.4 Cron Jobs

```bash
# Fact extraction every 4 hours
0 */4 * * * cd ~/tools && python3 fact_extractor.py >> /tmp/fact_extractor.log 2>&1

# Enrichment nightly at 2 AM
0 2 * * * cd ~/tools && python3 enrich_second_brain.py --batch 100 >> /tmp/enrichment.log 2>&1
```

---

## 16. Data Schemas

### 16.1 Qdrant Collection: `second_brain`

**Vector**: 768 dimensions, Cosine distance

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Main content (max 4000 chars) |
| `source` | string | `conversation`, `email`, `chatgpt`, `perplexity`, `fact_extractor`, `telegram`, `whatsapp`, `web_page` |
| `date` | string (ISO 8601) | Creation timestamp |
| `importance` | int (0-100) | Ranking weight |
| `auto_committed` | bool | System-committed? |
| `retrieval_count` | int | Times retrieved (spaced repetition) |
| `connected_to` | list[string] | Entity names linked in graph |
| `subject` | string | Email subject |
| `from` / `to` | string | Email sender/recipient |
| `thread_id` | string | Email thread dedup key |
| `title` | string | ChatGPT/web page title |
| `type` | string | `personal_fact` for fact_extractor |
| `category` | string | Fact category |

### 16.2 FalkorDB Graph: `brain`

**Node labels**: `Person`, `Organization`, `Project`, `Topic`, `Location`, `Memory`

- Entity nodes: `{name, type, created_at}`
- Memory nodes: `{id (= Qdrant point_id), text (500 char preview), created_at}`

**Edge type**: `MENTIONED_IN` (Entity → Memory)

### 16.3 Fact Extractor State

`memory/fact_extractor_state.json`:
```json
{"last_run": "2026-03-15T10:00:00", "processed_lines": {}, "fact_hashes": ["a1b2c3d4"]}
```

---

## 17. Model Decision Guide

### 17.1 Embedding Models

| Model | Dims | MTEB | Cost | CPU? | Notes |
|-------|------|------|------|------|-------|
| **nomic-embed-text v1** (Ollama) | 768 | ~62.0 | $0 | YES | **Use this.** 137M params, production default. |
| nomic-embed-text v1.5 | 768 | ~62.4 | $0 | YES | Only for fresh collections. Incompatible with v1. |
| OpenAI text-embedding-3-small | 1536 | ~62.3 | $0.02/1M tok | API | Same MTEB as nomic. API fallback option. |
| Google gemini-embedding-001 | 3072 | ~68.3 | $0.15/1M tok | API | Best quality (MTEB leader). Free tier: 1500 req/day. |
| Voyage voyage-3.5 | 2048 | ~67+ | $0.06/1M tok | API | Anthropic-recommended. 200M free tokens. |

### 17.2 Reranker Models

| Model | CPU Time | Cost | Notes |
|-------|----------|------|-------|
| **bge-reranker-v2-m3** | ~0.5s/batch | $0 | **Use this.** ONNX-optimized for CPU. |
| bge-reranker-base | ~0.2s/batch | $0 | Lighter, slightly less accurate. |
| Cohere Rerank | API | ~$1/1K | If CPU too slow. |

### 17.3 LLM Costs (No-VRAM Budget)

| Use Case | Model | $/call | Monthly |
|----------|-------|--------|---------|
| A-MAC scoring | Claude Haiku | ~$0.001 | ~$9 |
| Fact extraction | Claude Sonnet | ~$0.01 | ~$15 |
| Enrichment | Claude Haiku | ~$0.001 | ~$2 |
| **Total** | | | **~$26/month** |

---

## 18. Backup & Migration

### 18.1 Qdrant Snapshots

```bash
# Create
curl -X POST http://localhost:6333/collections/second_brain/snapshots

# List
curl http://localhost:6333/collections/second_brain/snapshots

# Download
curl -o ~/backups/second_brain.snapshot \
  "http://localhost:6333/collections/second_brain/snapshots/<snapshot_name>"

# Restore on new machine
curl -X POST "http://localhost:6333/collections/second_brain/snapshots/upload" \
  -H 'Content-Type: multipart/form-data' \
  -F "snapshot=@second_brain.snapshot"
```

### 18.2 FalkorDB Dump

```bash
redis-cli -p 6380 BGSAVE
docker cp falkordb:/data/dump.rdb ~/backups/falkordb_backup.rdb

# Restore: copy dump.rdb into volume before starting container
```

### 18.3 Files to Back Up

- `memory/facts.jsonl`
- `memory/fact_extractor_state.json`
- `memory/entity_graph.json`
- `memory/hot-context/`
- `~/.openclaw-mem/memory.db` (if using OpenClaw)

### 18.4 Migration Procedure

1. Backup Qdrant snapshot + FalkorDB dump + memory/ files
2. On new machine: follow this guide through Phase 1
3. Restore Qdrant snapshot
4. Restore FalkorDB dump
5. Copy memory/ files
6. Start services, run `healthcheck.sh`

---

## 19. Troubleshooting

### Embedding Model Mismatch (CRITICAL)

**Symptom**: Searches return nothing or cosine ~0.63.
**Cause**: Wrong embedding model used.
**Fix**: Always verify `curl http://localhost:11434/api/embed -d '{"model":"nomic-embed-text","input":["test"]}'` returns 768 dimensions.

### A-MAC Rejecting Everything

**Check API**: `curl https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY_RASP" ...`
**Fixes**: Lower threshold (`3.5`), bypass (`"force": true`), or disable (`AMAC_ENABLED = False`).

### Qdrant Issues

```bash
docker ps | grep qdrant && docker logs qdrant --tail 50
# Permission fix: sudo chown -R 1000:1000 ~/.qdrant_storage/
```

### FalkorDB Issues

```bash
docker ps | grep falkordb && redis-cli -p 6380 PING
```

### Reranker Slow

Lower `RERANKER_CANDIDATE_POOL` to 20, or disable: `RERANKER_URL = None`.

### Empty Search Results

```bash
curl http://localhost:6333/collections/second_brain  # Check vector count
curl "http://localhost:7777/search?q=test&limit=5&threshold=0.3"  # Lower threshold
```

### Log Locations

| Log | Location |
|-----|---------|
| Brain API | `pm2 logs rasputin` |
| Reranker | `pm2 logs reranker` |
| Fact extractor | `/tmp/fact_extractor.log` |
| Enrichment | `/tmp/enrichment.log` |
| Qdrant | `docker logs qdrant` |
| FalkorDB | `docker logs falkordb` |
| Ollama | `journalctl -u ollama` |

---

## 20. Implementation Checklist

### Phase 1: Infrastructure (30 min)

- [ ] Install Python 3.10+, Node.js 18+, PM2
- [ ] Start Qdrant on port 6333
- [ ] Create `second_brain` collection (768d, Cosine)
- [ ] Start FalkorDB on port 6380
- [ ] Install Ollama, pull `nomic-embed-text`
- [ ] Verify embedding returns 768 dimensions
- [ ] Set `ANTHROPIC_API_KEY_RASP` in `~/.bashrc`

### Phase 2: Core Brain Server (2-3 hours)

- [ ] Implement `get_embedding()` — Ollama HTTP
- [ ] Implement `qdrant_search()` — embed → search
- [ ] Implement temporal decay + multi-factor scoring
- [ ] Implement BM25 + RRF fusion
- [ ] Implement `check_duplicate()` — cosine 0.92 + overlap 50%
- [ ] Implement `commit_memory()` — full pipeline
- [ ] Start HTTP server on port 7777
- [ ] Test: commit → search → verify

### Phase 3: Quality Gate (1 hour)

- [ ] Implement `amac_score()` — Claude Haiku, parse R,N,S
- [ ] Implement `amac_gate()` — threshold + fail-open
- [ ] Wire into `/commit`

### Phase 4: Reranker (30 min)

- [ ] Create `reranker_server.py` (CPU mode)
- [ ] Start on port 8006 via PM2
- [ ] Wire into search pipeline

### Phase 5: Knowledge Graph (1 hour)

- [ ] Implement `extract_entities_fast()` — regex NER
- [ ] Implement `write_to_graph()` — FalkorDB
- [ ] Implement `graph_search()` — traversal
- [ ] Wire into search + commit

### Phase 6: Fact Extraction (1-2 hours)

- [ ] Implement 3-pass pipeline
- [ ] Set up cron every 4 hours
- [ ] Test manually

### Phase 7: Process Management (15 min)

- [ ] PM2 start all services
- [ ] PM2 startup + save
- [ ] Run `healthcheck.sh`
- [ ] Create first backup

### Phase 8: OpenClaw Integration

- [ ] See [Part 2: RASPUTIN-OPENCLAW.md](RASPUTIN-OPENCLAW.md)

---

## File Structure

```
~/tools/
├── hybrid_brain.py          # THE brain server (port 7777)
├── memory_engine.py         # Agent CLI (recall, commit, deep, whois, briefing)
├── bm25_search.py           # BM25 + RRF fusion (library)
├── fact_extractor.py        # 3-pass fact mining (cron)
├── enrich_second_brain.py   # Nightly importance/tagging (cron)
├── reranker_server.py       # Neural reranker HTTP (port 8006)
└── healthcheck.sh           # Full system health check

~/memory/  (or ~/.openclaw/workspace/memory/)
├── facts.jsonl              # Extracted facts
├── fact_extractor_state.json
├── entity_graph.json        # Static entity graph
├── om_observations.md       # Observational memory
├── last-recall.md           # Auto-recall results
└── hot-context/             # Time-sensitive context (24h TTL)
```
