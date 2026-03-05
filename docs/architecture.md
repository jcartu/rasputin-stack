# System Architecture

## Overview

RASPUTIN is a self-hosted AI agent infrastructure running on a single server with dual enterprise GPUs. The system handles LLM inference, memory management, voice communication, autonomous research, and monitoring — all locally.

## Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│                   INTERFACE LAYER                    │
│  Telegram · Discord · Voice WebSocket · Dashboard   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────┐
│                 AGENT FRAMEWORK                      │
│  OpenClaw Gateway → Session Management → Sub-Agents │
│  Cron Orchestration · Tool Dispatch · Safety Rules   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────┐
│                  LLM ROUTING PROXY                   │
│  Session Affinity · Quality Gate · Safety · Cost Log │
│  Providers: Local Qwen · Zen · OAuth · MiniMax ·    │
│             Gemini · Cerebras · Anthropic API        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────┐
│                   MEMORY LAYER                       │
│  Qdrant (96K vectors) · FalkorDB (240K nodes)       │
│  BM25 Sparse · nomic-embed-text · bge-reranker-v2   │
│  Multi-angle query expansion · Importance scoring    │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────┐
│                 AUTONOMOUS LAYER                     │
│  30+ Crons: Fact extraction · Enrichment ·           │
│  Research scanning · Anomaly detection ·             │
│  Episode detection · Health monitoring               │
└─────────────────────────────────────────────────────┘
```

## Data Flow

### User Message → Response
1. User sends message via Telegram/Discord
2. OpenClaw Gateway routes to appropriate agent session
3. Memory engine runs multi-angle recall (5+ search queries, <500ms)
4. Agent decides on response using memory context
5. LLM request goes through proxy → session-affinity load balancer
6. Proxy selects provider (local Qwen for routine, Zen/OAuth for complex)
7. Response quality-gated, sanitized, cost-logged
8. Important facts auto-committed to memory

### Autonomous Operation (No Human Input)
1. Crons trigger on schedule (fact extraction, research scanning, etc.)
2. Each cron runs independently with its own state tracking
3. Results flow into memory (Qdrant + FalkorDB)
4. Anomaly detection alerts if metrics deviate from DOW baselines
5. Research findings stored for morning briefing retrieval

## Hardware Allocation

```
GPU 0 (RTX PRO 6000 Blackwell 96GB):
  - Qwen 3.5 122B-A10B (IQ3_XXS, 131K context)
  - Primary inference for all agent conversations

GPU 1 (RTX PRO 6000 Blackwell 96GB):
  - Qwen3-Coder 30B (dedicated coding model)
  - Qwen3-TTS (text-to-speech)
  - faster-whisper (speech-to-text)
  - Reranker model (bge-reranker-v2-m3)

CPU:
  - Ollama (nomic-embed-text embeddings)
  - Qdrant vector search
  - FalkorDB graph queries
  - All web services (proxy, dashboard, etc.)
```

## Service Map

| Service | Port | Process Manager | Purpose |
|---------|------|----------------|---------|
| LLM Proxy | 8889 | PM2 | Multi-provider routing |
| Qwen 122B | 11435 | PM2 | Local LLM inference |
| Qwen Coder | 11436 | PM2 | Local code model |
| Ollama | 11434 | systemd | Embeddings |
| Qdrant | 6333 | Docker | Vector search |
| FalkorDB | 6380 | Docker | Knowledge graph |
| Memory API | 7777 | PM2 | Memory search endpoint |
| Reranker | 8006 | PM2 | Cross-encoder reranking |
| TTS Server | 8880 | PM2 | Text-to-speech |
| Dashboard | 9001 | PM2 | Web UI |
