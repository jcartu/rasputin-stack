# System Architecture

## Overview

Self-hosted AI agent infrastructure running on a single bare-metal server with three GPUs (224 GB total VRAM). The system handles LLM inference, memory management, voice communication, autonomous research, and monitoring — all locally, at zero per-token cost.

---

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      INTERFACE LAYER                        │
│   Telegram · Discord · Voice WebRTC · Browser · Dashboard   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    AGENT FRAMEWORK                          │
│   OpenClaw Gateway → Session Management → Sub-Agents       │
│   Cron Orchestration · Tool Dispatch · Safety Rules         │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                   LLM ROUTING PROXY                         │
│   llm-proxy v11 — Session Affinity · Quality Gate         │
│   Cost Logging · Rate Limiting · Adaptive Thinking Budget   │
└────┬──────────────┬───────────────┬────────────────┬────────┘
     │              │               │                │
┌────▼────┐  ┌──────▼─────┐  ┌─────▼──────┐  ┌─────▼──────┐
│  Local  │  │  Zen/Free  │  │   OAuth    │  │  Direct   │
│ Qwen 3.5│  │  Opus 4    │  │  Claude    │  │  API      │
│ 122B MoE│  │  ($0)      │  │            │  │  Gemini+  │
│  ($0)   │  │            │  │            │  │           │
└─────────┘  └────────────┘  └────────────┘  └───────────┘

┌─────────────────────────────────────────────────────────────┐
│                      MEMORY LAYER                           │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌─────────────┐  │
│  │  Qdrant  │  │ FalkorDB │  │  BM25  │  │  Reranker   │  │
│  │ 96K+ vec │  │ 240K node│  │ Sparse │  │ bge-v2-m3   │  │
│  └──────────┘  └──────────┘  └────────┘  └─────────────┘  │
│                                                             │
│  Multi-angle query expansion · Importance scoring           │
│  Sub-500ms end-to-end retrieval                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    VOICE PIPELINE                           │
│  Whisper STT ──► LLM Reasoning ──► Qwen3 TTS ──► Audio    │
│  WebRTC · Streaming · Voice Cloning                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   AUTONOMOUS LAYER                          │
│  30+ Cron Jobs on $0 Local Inference                        │
│  Fact Extraction · Enrichment · Research · Anomaly Detection│
│  Episode Detection · Health Monitoring · Brain Cleanup      │
└─────────────────────────────────────────────────────────────┘
```

---

## Hardware Allocation

| Component | Spec | Assignment |
|-----------|------|------------|
| **GPU 0** | RTX PRO 6000 Blackwell (96 GB) | Qwen 3.5 122B-A10B MoE (IQ3_XXS, 131K context) |
| **GPU 1** | RTX PRO 6000 Blackwell (96 GB) | Qwen3 Coder 30B, embeddings (nomic-embed-text), reranker (bge-v2-m3) |
| **GPU 2** | RTX 5090 (32 GB) | Qwen3 TTS, faster-whisper STT, auxiliary inference |
| **CPU** | Xeon w9-3495X (56C/112T) | Ollama embeddings, Qdrant, FalkorDB, all web services |
| **RAM** | 251 GB DDR5 | — |
| **OS** | Arch Linux | — |

---

## Proxy Routing Chain

The proxy selects the cheapest viable provider for each request:

```
Request ──► Session Affinity Check
               │
               ▼
         ┌─ Priority 1: Local Qwen 122B ($0/token)
         │     └─ 80%+ of all traffic. 131K context, tool calling.
         │
         ├─ Priority 2: Zen / Free Opus ($0, flat-rate subscription)
         │     └─ Complex reasoning tasks that benefit from Opus-class.
         │
         ├─ Priority 3: OAuth Claude (rate-limited free tier)
         │     └─ Overflow when Zen is saturated.
         │
         └─ Priority 4: Direct API (Anthropic, Gemini, etc.)
               └─ Per-token billing. Last resort only.
```

Each tier falls through automatically on rate limit, timeout, or quality gate failure. Cost is logged per-request for tracking.

---

## Memory Pipeline

### Ingest → Embed → Store

```
New Information
     │
     ▼
 Fact Extraction ──► Importance Scoring (1-10)
     │
     ▼
 nomic-embed-text (Ollama, GPU 1)
     │
     ├──► Qdrant (dense vector)
     ├──► BM25 index (sparse vector)
     └──► FalkorDB (entity → relationship → entity)
```

### Query → Multi-Angle → Rerank → Respond

```
User Query
     │
     ▼
 Multi-Angle Expansion (5+ reformulated queries)
     │
     ├──► Qdrant dense search
     ├──► BM25 sparse search
     └──► FalkorDB graph traversal
            │
            ▼
     Result Fusion (RRF)
            │
            ▼
     bge-reranker-v2-m3 (cross-encoder)
            │
            ▼
     Top-K results injected into LLM context
```

End-to-end latency: **< 500ms** for typical queries.

---

## Cron Orchestration

30+ autonomous jobs run on local Qwen 122B at zero cost:

| Category | Jobs | Frequency |
|----------|------|-----------|
| **Memory Maintenance** | Fact extraction, enrichment, deduplication, brain cleanup | Every 1–4 hours |
| **Research** | AI frontier scanning, YouTube monitoring, competitive intel | Every 4–6 hours |
| **Monitoring** | Anomaly detection (DOW baselines), health checks, GPU monitoring | Every 15–60 min |
| **Intelligence** | Episode detection, narrative arc identification | Every 2 hours |
| **System** | Log rotation, stale session cleanup, embedding consistency | Daily |

All cron inference runs through local Qwen 122B — no API cost for autonomous operations.

---

## Service Map

| Service | Port | Process | Purpose |
|---------|------|---------|---------|
| llm-proxy | 8889 | PM2 | Multi-provider LLM routing |
| Qwen 122B | 11435 | PM2 | Local LLM inference (GPU 0) |
| Qwen Coder | 11436 | PM2 | Local code model (GPU 1) |
| Ollama | 11434 | systemd | Embeddings |
| Qdrant | 6333 | Docker | Vector search |
| FalkorDB | 6380 | Docker | Knowledge graph |
| Memory API | 7777 | PM2 | Memory search endpoint |
| Reranker | 8006 | PM2 | Cross-encoder reranking |
| TTS Server | 8880 | PM2 | Qwen3 text-to-speech |
| Dashboard | 9001 | PM2 | Web UI |

---

## Data Flow: User Message → Response

1. User sends message (Telegram / Discord / Voice)
2. **OpenClaw Gateway** routes to agent session
3. **Memory recall** — multi-angle expansion generates 5+ queries, fuses results, reranks
4. Agent constructs response with memory context
5. LLM request hits **llm-proxy** → session-affinity selects provider
6. Proxy routes to cheapest viable tier (local Qwen → Zen → OAuth → API)
7. Response is quality-gated, cost-logged, streamed back
8. Important facts **auto-committed** to memory for future recall

## Data Flow: Autonomous Operation

1. Cron triggers on schedule (PM2 / systemd timer)
2. Job runs against local Qwen 122B — **$0 inference cost**
3. Results flow into memory (Qdrant vectors + FalkorDB graph)
4. Anomaly detection compares metrics against day-of-week baselines
5. Findings stored for on-demand retrieval or morning briefing
