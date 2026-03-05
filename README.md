<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
  <img src="https://img.shields.io/badge/VRAM-224GB-red?style=flat-square&logo=nvidia&logoColor=white" />
  <img src="https://img.shields.io/badge/Inference_Cost-$0%2Fmo-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/Cron_Jobs-30+-orange?style=flat-square" />
</p>

<h1 align="center">⚡ Rasputin Stack</h1>

<p align="center">
  <em>Autonomous AI agent infrastructure on bare metal — local 122B inference, hybrid memory, voice pipeline, and 30+ cron jobs running 24/7 for $0.</em>
</p>

<p align="center">
  <strong>Hard to kill, impossible to ignore.</strong>
</p>

---

## Highlights

| Metric | Value |
|--------|-------|
| 🖥️ **Total VRAM** | 224 GB across 3 GPUs (96 + 96 + 32) |
| 🧠 **Main Model** | Qwen 3.5 122B-A10B MoE — 131K context, zero API cost |
| 🔄 **Autonomous Jobs** | 30+ cron tasks running 24/7 on local inference |
| 💾 **Memory Vectors** | 96,000+ embeddings in Qdrant |
| 🕸️ **Knowledge Graph** | 240,000+ nodes in FalkorDB |
| 🔍 **Search Pipeline** | Vector + BM25 sparse + graph + cross-encoder reranker |
| 🗣️ **Voice Pipeline** | Whisper STT → LLM → Qwen3 TTS (real-time, local) |
| 🔀 **Proxy Versions** | 11 iterations evolved over 6 months |
| 💰 **Monthly Inference** | $0 for local models |

---

## Architecture

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                              RASPUTIN STACK                                ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   ║
║   │ Telegram │  │ Discord  │  │  Voice   │  │ Browser  │  │Dashboard │   ║
║   │   Bot    │  │   Bot    │  │ WebRTC   │  │  Relay   │  │  (Web)   │   ║
║   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   ║
║        │              │              │              │              │        ║
║        └──────────────┴──────┬───────┴──────────────┴──────────────┘        ║
║                              │                                             ║
║                 ┌────────────▼────────────┐                                ║
║                 │    OpenClaw Gateway      │                                ║
║                 │  Sessions · Sub-Agents   │                                ║
║                 │  Crons · Tools · Safety  │                                ║
║                 └────────────┬────────────┘                                ║
║                              │                                             ║
║           ┌──────────────────▼──────────────────┐                          ║
║           │         cartu-proxy (v11)            │                          ║
║           │   Session Affinity · Quality Gate    │                          ║
║           │    Cost Logging · Rate Limiting      │                          ║
║           └──┬──────────┬───────────┬──────┬────┘                          ║
║              │          │           │      │                               ║
║     ┌────────▼──┐ ┌─────▼────┐ ┌───▼───┐ ┌▼──────────┐                    ║
║     │ Local GPU │ │ Zen/Free │ │ OAuth │ │ Direct API│                    ║
║     │  Qwen 3.5 │ │  Opus 4  │ │Claude │ │ Gemini/etc│                    ║
║     │  122B MoE │ │  (Free)  │ │       │ │           │                    ║
║     └───────────┘ └──────────┘ └───────┘ └───────────┘                    ║
║                                                                            ║
║   ┌─────────────────── MEMORY LAYER ───────────────────────┐               ║
║   │                                                        │               ║
║   │  ┌───────────┐  ┌───────────┐  ┌──────┐  ┌─────────┐ │               ║
║   │  │  Qdrant   │  │ FalkorDB  │  │ BM25 │  │Reranker │ │               ║
║   │  │ 96K+ vecs │  │ 240K nodes│  │Sparse│  │ bge-v2  │ │               ║
║   │  └───────────┘  └───────────┘  └──────┘  └─────────┘ │               ║
║   └────────────────────────────────────────────────────────┘               ║
║                                                                            ║
║   ┌────────────────── VOICE PIPELINE ──────────────────────┐               ║
║   │  Whisper STT ──► LLM Reasoning ──► Qwen3 TTS ──► Audio│               ║
║   └────────────────────────────────────────────────────────┘               ║
║                                                                            ║
║   ┌───────────────── AUTONOMOUS LAYER ─────────────────────┐               ║
║   │  30+ Cron Jobs: Fact Extraction · Memory Enrichment    │               ║
║   │  Research Scanning · Anomaly Detection · Episode       │               ║
║   │  Detection · Health Monitoring · Brain Cleanup         │               ║
║   └────────────────────────────────────────────────────────┘               ║
║                                                                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                            HARDWARE                                        ║
║                                                                            ║
║  GPU 0: RTX PRO 6000 Blackwell (96GB) ── Qwen 3.5 122B MoE               ║
║  GPU 1: RTX PRO 6000 Blackwell (96GB) ── Coder 30B · Embeddings · Rerank ║
║  GPU 2: RTX 5090               (32GB) ── TTS · Auxiliary Inference        ║
║  CPU:   Xeon w9-3495X (56C/112T) · 251GB DDR5 · Arch Linux               ║
║                                                                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## What's In Here

| Directory | Description | Files |
|-----------|-------------|-------|
| [`proxy/`](proxy/) | LLM routing proxy — 11 versions, multi-provider failover, streaming, cost tracking | 15 |
| [`dashboard/`](dashboard/) | Full web dashboard — sessions, playground, council, memory heatmap, cost forecasting | 224 |
| [`ui/`](ui/) | React 19 frontend — 272+ components, shadcn/ui, Monaco editor, 7-language i18n | 263 |
| [`backend/`](backend/) | Express API — JWT RBAC, PostgreSQL, 30+ routes, WebSocket streaming | 132 |
| [`voice/`](voice/) | Voice pipeline — Qwen3 TTS server, Whisper STT, WebRTC, voice cloning | 127 |
| [`memory/`](memory/) | Hybrid memory — Qdrant vectors, BM25 sparse, FalkorDB graph, reranker | 8 |
| [`tools/`](tools/) | Agent tools — AI Council, browser automation, RAG, memory ops, benchmarks | 16 |
| [`crons/`](crons/) | Autonomous cron jobs — fact extraction, enrichment, research, anomaly detection | — |
| [`cli/`](cli/) | CLI interface — chat, search, session management, consensus, verification | 24 |
| [`browser/`](browser/) | Chrome extension — content injection, Manifest V3, message routing | 4 |
| [`council/`](council/) | Multi-model debate — structured consensus, swarm protocol | 3 |
| [`selfplay/`](selfplay/) | Self-play pipeline — task generation, solving, evaluation | 4 |
| [`research/`](research/) | Research tools — AI model scanner, YouTube monitoring, multi-engine search | 4 |
| [`monitoring/`](monitoring/) | Infrastructure monitoring — anomaly detection, health checks, forecasting | 4 |
| [`method/`](method/) | Compaction research — academic paper, benchmark suite, triad framework | 26 |
| [`doctor/`](doctor/) | Diagnostics — system health checks, alerting | 3 |
| [`desktop/`](desktop/) | Electron wrapper — desktop application | 6 |
| [`config/`](config/) | Configuration templates and examples | — |
| [`docs/`](docs/) | Documentation — architecture, memory design, deployment, API reference | 9 |

---

## Core Components

### Proxy — LLM Router (`proxy/`)

Multi-provider routing proxy with 5-tier failover chain:

```
Local Qwen 122B ($0) → Zen/Free Opus → OAuth Claude → Per-Token APIs → Direct Anthropic
```

- Session affinity and quality gating
- Adaptive thinking budget management
- SSE streaming with tool-calling normalization
- Per-provider rate limiting and cost logging
- 11 versions documenting the full evolution

### Memory — Hybrid Search (`memory/`)

Four-layer retrieval pipeline:

1. **Dense vectors** — nomic-embed-text via Ollama → Qdrant (96K+ vectors)
2. **Sparse vectors** — BM25 for keyword precision
3. **Knowledge graph** — FalkorDB (240K+ nodes) for relationship traversal
4. **Cross-encoder reranker** — bge-reranker-v2-m3 for final ranking

Multi-angle query expansion generates 5+ search queries per request. Sub-500ms end-to-end.

### Voice — Real-Time Pipeline (`voice/`)

```
Audio In → Whisper STT → LLM Reasoning → Qwen3 TTS → Audio Out
```

- OpenAI-compatible TTS API with multiple backends (PyTorch, OpenVINO, vLLM)
- Voice cloning and design
- WebRTC for real-time communication
- Streaming audio generation

### Crons — Autonomous Operations (`crons/`)

30+ scheduled jobs running on $0 local inference:

- **Fact extraction** — Mines conversations for persistent facts
- **Memory enrichment** — Cross-references and links related memories
- **Episode detection** — Identifies narrative arcs across sessions
- **Research scanning** — Monitors AI frontier developments
- **Anomaly detection** — Flags metric deviations from day-of-week baselines
- **Brain cleanup** — Deduplicates and maintains memory health
- **Health monitoring** — Infrastructure and service health checks

### Dashboard (`dashboard/`)

Full-featured web UI for monitoring and control:

- Real-time session viewer with WebSocket streaming
- Multi-model playground with side-by-side comparison
- AI Council — multi-model debate engine
- Memory heatmap visualization
- Cost tracking and forecasting
- Loop detection and anomaly alerting

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14, React 19, TypeScript, shadcn/ui, Tailwind CSS, Framer Motion |
| **Backend** | Node.js, Express, PostgreSQL, JWT RBAC, WebSocket |
| **Inference** | Ollama, llama.cpp — Qwen 3.5 122B MoE, Qwen3 Coder 30B |
| **Memory** | Qdrant (dense + sparse), FalkorDB (graph), BM25, bge-reranker-v2-m3 |
| **Voice** | Qwen3-TTS, faster-whisper, WebRTC, Pipecat |
| **Proxy** | Python / aiohttp, SSE streaming, multi-provider routing |
| **Search** | Hybrid: dense vectors + BM25 sparse + graph traversal + reranker |
| **Infra** | PM2, Docker, systemd, Arch Linux, NVMe SSD |

---

## Hardware

| Component | Spec | Role |
|-----------|------|------|
| **GPU 0** | NVIDIA RTX PRO 6000 Blackwell (96 GB) | Qwen 3.5 122B-A10B MoE inference |
| **GPU 1** | NVIDIA RTX PRO 6000 Blackwell (96 GB) | Qwen Coder 30B, embeddings, reranker |
| **GPU 2** | NVIDIA RTX 5090 (32 GB) | TTS, auxiliary inference |
| **CPU** | Intel Xeon w9-3495X (56 cores / 112 threads) | Services, embeddings, orchestration |
| **RAM** | 251 GB DDR5 | — |
| **OS** | Arch Linux | — |
| **Total VRAM** | **224 GB** | — |

---

## Running

```bash
# Start all services
pm2 start ecosystem.config.js

# Individual components
cd proxy && python proxy_v11.py              # LLM routing proxy
cd backend && node src/index.js              # API server
cd dashboard && node server.js               # Web dashboard
cd voice/qwen3-tts-server && python -m api.main  # TTS server
```

---

## Design Principles

1. **Local-first** — 122B MoE model on bare metal, $0/month inference cost
2. **Multi-provider failover** — Flat-rate → free tier → per-token, automatic
3. **Hybrid memory** — Dense + sparse + graph + reranker, every query
4. **Autonomous by default** — 30+ crons handle maintenance, research, and enrichment without human input
5. **Observable** — Full cost logging, session audit trails, anomaly detection

---

## License

MIT — See [LICENSE](LICENSE)
