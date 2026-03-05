# Rasputin Stack

> *"Hard to kill, impossible to ignore"*

A comprehensive AI agent infrastructure stack — autonomous agent orchestration, LLM proxy routing, voice synthesis, memory systems, browser automation, and a full-stack dashboard. Built for real-world 24/7 autonomous operation on bare metal.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Dashboard (UI)                         │
│              Next.js 14 + React 19 + shadcn              │
├─────────────────────────────────────────────────────────┤
│                    Backend (API)                          │
│           Express + JWT RBAC + PostgreSQL                 │
├──────────┬──────────┬───────────┬──────────┬────────────┤
│  Proxy   │  Voice   │  Memory   │  Tools   │  Browser   │
│ (Router) │  (TTS)   │ (Qdrant)  │ (177+)   │  (Relay)   │
├──────────┴──────────┴───────────┴──────────┴────────────┤
│              Local Inference (Ollama)                     │
│         Qwen 72B (RTX PRO 6000) + Coder 30B (5090)      │
└─────────────────────────────────────────────────────────┘
```

## Components (867 files)

### [`proxy/`](proxy/) — LLM Proxy Router (15 files)
Multi-provider LLM routing proxy with intelligent failover, cost optimization, and tool-calling support. **11 versions** documenting the full evolution from simple forwarder to production-grade router with:
- 5-tier provider failover (flat-rate → free → per-token)
- Adaptive thinking budget management
- Request/response streaming with SSE
- Per-provider rate limit tracking
- Tool calling normalization across providers
- Benchmark suite for quality and latency

See [`proxy/CHANGELOG.md`](proxy/CHANGELOG.md) for the full version history.

### [`dashboard/`](dashboard/) — AI Agent Dashboard (224 files)
Full-featured web dashboard for agent monitoring and control:
- Real-time agent session viewer with WebSocket streaming
- Multi-model playground with side-by-side comparison
- AI Council — multi-model debate/consensus engine
- Memory heatmap visualization
- Cost tracking and forecasting
- Browser automation control panel
- Knowledge base management
- Template and recipe system
- Loop detection and anomaly alerting
- PWA with offline support

### [`ui/`](ui/) — React/TypeScript Frontend (263 files)
Production React 19 frontend with:
- 272+ components across 39 directories
- shadcn/ui + Tailwind CSS + Framer Motion
- Monaco editor integration
- 7-language i18n (Russian complete)
- Split-screen agent interaction UX
- Real-time WebSocket streaming

### [`backend/`](backend/) — Node.js API Server (132 files)
Express backend with:
- Full RBAC (JWT auth, roles, 20+ permissions)
- PostgreSQL schema with migrations
- 30+ route files (agents, sessions, memory, tools, etc.)
- WebSocket server for real-time streaming
- File upload/management
- API key management

### [`cli/`](cli/) — Command-Line Interface (24 files)
Full CLI for agent interaction:
- `chat` — Interactive conversation
- `search` — Semantic memory search
- `session` — Session management
- `consensus` — Multi-model consensus
- `verify` — Output verification
- `procedure` — Structured procedure execution
- Bash/Zsh completion support

### [`voice/`](voice/) — Voice Pipeline (127 files)
Complete voice synthesis stack:
- **Pipeline** — Real-time voice pipeline with STT → LLM → TTS
- **Qwen3 TTS Server** — OpenAI-compatible TTS API with multiple backends:
  - PyTorch, OpenVINO, vLLM backends
  - 12Hz/25Hz tokenizer support
  - Streaming audio generation
  - Voice design and cloning
  - Docker + ROCm support
  - Finetuning toolkit
- **Comms** — WebRTC voice communication interface

### [`tools/`](tools/) — Agent Tools (16 files)
Specialized tools for autonomous operation:
- **AI Council** (`ai_council.py`, `ai_council_v2.py`) — Multi-model debate with structured consensus
- **Browser Automation** (`browse.py`, `browser_agent.py`) — Headless Chrome control
- **Memory Ops** (`amem_*.py`) — Autocommit, episodic memory, reflection, smart query
- **RAG Pipeline** (`auto_rag.py`) — Automated retrieval-augmented generation
- **BM25 Search** (`bm25_search.py`, `bm25_sparse.py`) — Sparse vector search
- **Brain Cleanup** (`brain_cleanup.py`) — Memory deduplication and maintenance
- **Frontier Briefing** (`ai_frontier_briefing.py`) — AI model landscape scanner
- **Benchmarking** (`benchmark_qwen3.sh`) — Local model benchmarking
- **System Maintenance** (`arch-maintenance.sh`) — Automated system upkeep

### [`memory/`](memory/) — Memory System (8 files)
Qdrant-backed semantic memory with:
- Vector + sparse (BM25) hybrid search
- Episodic memory detection
- Fact extraction and enrichment
- Hot context management
- Graph brain schema for relationship tracking

### [`browser/`](browser/) — Browser Relay Extension (4 files)
Chrome extension for browser automation:
- Content script injection for page interaction
- Background service worker for message routing
- Manifest V3

### [`desktop/`](desktop/) — Desktop App (6 files)
Electron desktop application wrapper.

### [`method/`](method/) — Context Compaction Research (26 files)
Research on the "Compaction Quality Triad" — a framework for evaluating context compaction in long-running AI agent sessions:
- Academic paper on compaction quality analysis
- Benchmark suite across multiple models (Gemini, Qwen, Sonnet, Opus)
- Speed × Fidelity × Efficiency triad framework
- Stress test for failover behavior

### [`doctor/`](doctor/) — Diagnostics (3 files)
System health diagnostics and alerting.

### [`monitoring/`](monitoring/) — Infrastructure Monitoring (4 files)
- Anomaly detection for agent behavior
- Infrastructure health checks
- Forecasting for resource usage

### [`research/`](research/) — Research Tools (4 files)
- AI model scanner for frontier developments
- YouTube monitoring
- Multi-engine search aggregation

### [`docs/`](docs/) — Documentation (9 files)
- Architecture overview
- Memory system design
- Agent orchestration patterns
- Model routing strategies
- Deployment guide
- API reference

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 19, TypeScript, shadcn/ui, Tailwind, Framer Motion |
| Backend | Node.js, Express, PostgreSQL, JWT RBAC |
| AI/ML | Ollama (Qwen 72B, Coder 30B), Qdrant, LangGraph |
| Voice | Qwen3-TTS, WebRTC, Pipecat |
| Proxy | Python/aiohttp, SSE streaming, multi-provider routing |
| Desktop | Electron |
| Search | BM25 sparse vectors, Qdrant hybrid search |
| Infra | PM2, Docker, systemd, Arch Linux |

## Key Design Decisions

1. **Local-first inference** — 72B parameter models on bare metal GPUs, $0/month per-token cost
2. **Multi-provider failover** — Flat-rate subscriptions first, free tiers second, per-token last
3. **Hybrid memory** — Dense vectors (nomic-embed-text) + sparse BM25 + graph relationships
4. **Event-sourced sessions** — Full audit trail of every agent action
5. **Filesystem as coordination** — Multi-agent builds use shared files, not message passing

## Running

```bash
# Start core services
pm2 start ecosystem.config.js

# Or individual components
cd proxy && python proxy_v11.py          # LLM router
cd dashboard && node server.js            # Dashboard
cd backend && node src/index.js           # API server
cd voice/qwen3-tts-server && python -m api.main  # TTS
```

## Hardware

Built for and tested on:
- **CPU:** 112 cores, 251GB RAM
- **GPU 0:** NVIDIA RTX PRO 6000 Blackwell (96GB) — Qwen 72B
- **GPU 1:** NVIDIA RTX 5090 (32GB) — Qwen Coder 30B
- **OS:** Arch Linux
- **Storage:** NVMe SSD

## License

MIT — See [LICENSE](LICENSE)
