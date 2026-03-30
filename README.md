<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Query_Cost-$0-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
</p>

<h1 align="center">⚡ Rasputin Stack</h1>

<p align="center">
  <em>Self-hosted AI agent infrastructure with hybrid memory search, LLM routing, voice pipeline, and autonomous operations — all on local GPU inference.</em>
</p>

---

## What This Is

Rasputin Stack is the infrastructure behind a self-hosted AI agent system running on bare-metal GPUs. It combines dense vector search, sparse keyword retrieval, a knowledge graph, and a cross-encoder reranker into a hybrid search pipeline — backed by autonomous cron jobs for memory maintenance.

**Design goals:**
- **Hybrid search** — vector + BM25 + graph + reranker fusion
- **$0/query** — all inference runs on local hardware
- **Autonomous maintenance** — cron-driven enrichment, dedup, health monitoring
- **Multi-interface** — Telegram, Discord, voice (WebRTC), web dashboard

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         INTERFACES                               │
│  Telegram · Discord · Voice (WebRTC) · Browser · Web Dashboard   │
└──────────────────────┬───────────────────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │    Agent Gateway         │
          │  Sessions · Sub-Agents   │
          │  Crons · Tools · Safety  │
          └────────────┬────────────┘
                       │
          ┌────────────▼────────────┐
          │     LLM Routing Proxy    │
          │  Session Affinity        │
          │  Quality Gate · Failover │
          │  Cost Logging            │
          └──┬─────┬─────┬─────┬───┘
             │     │     │     │
         ┌───▼─┐ ┌▼───┐ ┌▼──┐ ┌▼────┐
         │Local│ │Free│ │API│ │Cloud│
         │ GPU │ │Tier│ │Key│ │ API │
         │122B │ │    │ │   │ │     │
         └─────┘ └────┘ └───┘ └─────┘

┌──────────────────────────────────────────────────────────────────┐
│                      MEMORY LAYER                                │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────┐ ┌──────────┐               │
│  │  Qdrant  │ │ FalkorDB │ │ BM25 │ │ Reranker │               │
│  │  Dense   │ │  Graph   │ │Sparse│ │ BGE v2   │               │
│  └──────────┘ └──────────┘ └──────┘ └──────────┘               │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────────┐             │
│  │ BrainBox │ │  STORM   │ │  Multi-Tenant       │             │
│  │Procedural│ │ Wiki Gen │ │  Agent Isolation     │             │
│  └──────────┘ └──────────┘ └─────────────────────┘             │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  VOICE: Whisper STT ──► LLM ──► Qwen3 TTS ──► Audio            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  AUTONOMOUS: Cron jobs — fact extraction, enrichment, research,  │
│  anomaly detection, episode detection, dedup, health monitoring  │
└──────────────────────────────────────────────────────────────────┘
```

---

## The 4-Stage Hybrid Search Pipeline

Every query passes through all four stages:

```
Query
  │
  ├─► 1. DENSE VECTORS (Qdrant, nomic-embed-text)
  │      Semantic similarity search
  │
  ├─► 2. BM25 SPARSE (keyword precision)
  │      Exact term matching for names, dates, codes
  │
  ├─► 3. KNOWLEDGE GRAPH (FalkorDB)
  │      Entity relationships and traversal
  │
  └─► 4. CROSS-ENCODER RERANKER (bge-reranker-v2-m3)
         Final relevance scoring and fusion
```

---

## Components

| Directory | What's Inside |
|-----------|---------------|
| `memory/` | Hybrid memory engine — Qdrant vectors, BM25, FalkorDB graph, reranker |
| `tools/` | Agent tools — browser automation, RAG, memory ops, AI council |
| `tools/storm-wiki/` | STORM wiki generator from memory |
| `tools/brainbox/` | BrainBox procedural memory (Hebbian learning) |
| `proxy/` | LLM routing proxy — multi-provider failover, quality gate |
| `dashboard/` | Web dashboard — sessions, playground, cost tracking |
| `ui/` | React 19 + Next.js frontend |
| `backend/` | Express API — JWT RBAC, PostgreSQL, WebSocket streaming |
| `voice/` | Voice pipeline — Qwen3 TTS server, Whisper STT, WebRTC |
| `agents/` | Multi-tenant agent workspaces |
| `crons/` | Autonomous scheduled jobs |
| `cli/` | CLI interface — chat, search, sessions |
| `browser/` | Chrome extension (Manifest V3) |
| `council/` | Multi-model debate / consensus engine |
| `selfplay/` | Self-play pipeline — task generation and evaluation |
| `research/` | Research — context compaction study, prompt compilation |
| `monitoring/` | Anomaly detection, health checks, forecasting |
| `doctor/` | System diagnostics and alerting |
| `desktop/` | Electron desktop wrapper |
| `docs/` | Architecture, deployment, and API documentation |

---

## Hardware Requirements

The system is designed for bare-metal GPU inference:

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **GPU VRAM** | 48 GB | 192+ GB across multiple GPUs |
| **CPU** | 16 cores | 32+ cores |
| **RAM** | 64 GB | 256 GB |
| **OS** | Linux | Arch Linux / Ubuntu |

All inference runs locally — no API costs for standard operations.

---

## Getting Started

This is a production system, not a turnkey install. To adapt it:

1. **Qdrant** — `docker run -p 6333:6333 qdrant/qdrant`
2. **FalkorDB** — `docker run -p 6379:6379 falkordb/falkordb`
3. **Ollama** — Install and pull `nomic-embed-text` for embeddings
4. **Memory engine** — `cd memory && python memory_engine.py`
5. **Proxy** — `cd proxy && python proxy.py`
6. **Dashboard** — `cd dashboard && npm install && node server.js`

See [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) for full setup instructions.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Search** | Qdrant, FalkorDB, BM25, bge-reranker-v2-m3 |
| **Inference** | Ollama, llama.cpp — Qwen 3.5 122B MoE |
| **Frontend** | Next.js 14, React 19, TypeScript, shadcn/ui |
| **Backend** | Node.js, Express, PostgreSQL, WebSocket |
| **Voice** | Qwen3-TTS, faster-whisper, WebRTC |
| **Proxy** | Python / aiohttp, SSE streaming |
| **Infra** | PM2, Docker, systemd |

---

## License

MIT — See [LICENSE](LICENSE)
