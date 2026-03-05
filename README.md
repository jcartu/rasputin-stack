# RASPUTIN Stack

**Self-hosted AI agent infrastructure on consumer hardware.**
*Hard to kill, impossible to ignore.*

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RASPUTIN ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Telegram/Discord ──► OpenClaw Gateway ──► Agent Sessions           │
│                           │                    │                    │
│                           ▼                    ▼                    │
│                    ┌─────────────┐      ┌──────────────┐            │
│                    │ LLM Routing │      │  Sub-Agent   │            │
│                    │   Proxy     │      │  Orchestrator│            │
│                    └──────┬──────┘      └──────┬───────┘            │
│                           │                    │                    │
│            ┌──────────────┼──────────────┐     │                    │
│            ▼              ▼              ▼     ▼                    │
│     ┌──────────┐  ┌──────────┐  ┌──────────┐                       │
│     │Local Qwen│  │ Free Zen │  │  OAuth   │  ← Session Affinity   │
│     │ 122B MoE │  │  Opus 4  │  │ Opus 4   │    Load Balancer      │
│     │  (GPU×2) │  │  (free)  │  │(fallback)│                       │
│     └──────────┘  └──────────┘  └──────────┘                       │
│            │              │              │                          │
│            └──────────────┼──────────────┘                          │
│                           ▼                                         │
│     ┌─────────────────────────────────────────────┐                 │
│     │              MEMORY LAYER                    │                │
│     │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │                │
│     │  │  Qdrant  │  │FalkorDB │  │  Reranker │  │                │
│     │  │ 96K vecs │  │240K nodes│  │ bge-v2-m3 │  │                │
│     │  └──────────┘  └──────────┘  └───────────┘  │                │
│     │  Multi-angle query expansion + hybrid search │                │
│     └─────────────────────────────────────────────┘                 │
│                           │                                         │
│            ┌──────────────┼──────────────┐                          │
│            ▼              ▼              ▼                          │
│     ┌──────────┐  ┌──────────┐  ┌──────────┐                       │
│     │  Voice   │  │ Research │  │Monitoring│                       │
│     │ Pipeline │  │  Scanner │  │& Anomaly │                       │
│     │Qwen3-TTS │  │arXiv+X+GH│ │Detection │                       │
│     └──────────┘  └──────────┘  └──────────┘                       │
│                                                                     │
│     ┌──────────┐  ┌──────────┐  ┌──────────┐                       │
│     │ Browser  │  │Dashboard │  │  30+     │                       │
│     │Extension │  │  + API   │  │  Crons   │                       │
│     │MemCapture│  │WebSocket │  │Autonomous│                       │
│     └──────────┘  └──────────┘  └──────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

## What Is This

A fully autonomous AI agent stack running on a single server with dual enterprise GPUs. Everything from LLM inference to memory to voice runs locally. The system operates 24/7 with 30+ automated cron jobs, zero-dollar local inference, and a hybrid memory system spanning 96K+ vectors and 240K+ knowledge graph nodes.

Built over ~6 months by one person. No team, no VC, no cloud bills.

## What's In Here

| Directory | What | Novel Part |
|-----------|------|------------|
| [`proxy/`](proxy/) | LLM routing proxy with 7+ providers | Session-affinity load balancer, quality gate with auto-escalation, best-of-N sampling, safety layer |
| [`memory/`](memory/) | Hybrid vector + graph memory system | Multi-angle query expansion (5 search angles per query), importance scoring pipeline, episodic memory detection |
| [`monitoring/`](monitoring/) | Infrastructure + anomaly detection | Day-of-week-aware statistical anomaly detection, temporal pattern forecasting |
| [`voice/`](voice/) | Real-time voice pipeline | Browser → VAD → Whisper → LLM → TTS with memory-augmented context |
| [`dashboard/`](dashboard/) | AI agent dashboard + API | WebSocket real-time, integration registry, RAG pipeline, OpenTelemetry |
| [`browser/`](browser/) | Chrome extension for memory capture | Auto-captures browsing into vector DB with batching + dedup |
| [`research/`](research/) | Automated research scanning | Multi-engine search orchestration (X + Perplexity + Brave), arXiv/Reddit/GitHub scanning |
| [`council/`](council/) | Multi-model AI council | Fractal sub-agent spawning, tier-weighted debate, swarm protocol |
| [`selfplay/`](selfplay/) | Self-play training pipeline | Autonomous task gen → solve → validate → trajectory collection |
| [`crons/`](crons/) | Autonomous cron patterns | 30+ jobs: fact extraction, memory enrichment, research scanning, health checks |
| [`config/`](config/) | Example configs and Modelfiles | Production patterns for llama.cpp, Ollama, Docker |
| [`docs/`](docs/) | Architecture documentation | System design, memory philosophy, routing strategy |

## Hardware

```
CPU:    Intel Xeon w9-3495X (56C/112T)
RAM:    251 GB DDR5
GPU 0:  NVIDIA RTX PRO 6000 Blackwell (96GB VRAM) — inference: Qwen 3.5 122B-A10B
GPU 1:  NVIDIA RTX PRO 6000 Blackwell (96GB VRAM) — embeddings, reranker, coding models
Storage: 4TB NVMe
OS:     Arch Linux
```

## Key Metrics

- **96,000+** memory vectors in Qdrant
- **240,000+** knowledge graph nodes in FalkorDB
- **30+** autonomous cron jobs running 24/7
- **$0** inference cost for 80%+ of requests (local Qwen + free tiers)
- **7** LLM providers orchestrated through one proxy
- **<500ms** memory recall across 5 search angles
- **2,700** lines of proxy code handling routing, safety, quality, and cost tracking

## Tech Stack

**Inference:** llama.cpp, Ollama, vLLM · **Models:** Qwen 3.5 122B-A10B (IQ3_XXS), Qwen3-Coder 30B, nomic-embed-text
**Memory:** Qdrant (vectors), FalkorDB (knowledge graph), bge-reranker-v2-m3 (reranking)
**Voice:** faster-whisper (STT), Qwen3-TTS (local TTS), ElevenLabs (cloud TTS fallback)
**Orchestration:** OpenClaw (agent framework), PM2 (process management), systemd
**Dashboard:** Express.js, WebSocket, Prisma, OpenTelemetry, Grafana
**Browser:** Chrome Extension (MV3), content script injection
**Languages:** Python (70%), JavaScript/Node.js (25%), Bash (5%)

## Philosophy

1. **Local first.** If it can run on the box, it runs on the box. Cloud is a fallback, not a default.
2. **Free before paid.** Exhaust every free tier before spending a dollar. The proxy's load balancer exists for this reason.
3. **Memory is everything.** An agent without memory is a chatbot. Multi-angle search, graph traversal, importance scoring, episodic detection — memory is the moat.
4. **Autonomous by default.** The system should work when you're asleep. 30+ crons handle enrichment, monitoring, research, and self-improvement without human input.
5. **Safety as infrastructure.** Command blocklists, file protection, secret scrubbing, and response sanitization are baked into the proxy, not bolted on.

## License

MIT — do whatever you want with it.

## Author

Built on RASPUTIN — a server that earned its name.
