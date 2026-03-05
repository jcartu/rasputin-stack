# LLM Routing Proxy

A single-endpoint Anthropic-compatible proxy that routes requests across 7+ LLM providers with session-affinity load balancing, quality gating, safety enforcement, and cost tracking.

## Why This Exists

When you run local inference alongside cloud APIs alongside free tiers, you need something to:

1. **Route intelligently** — local models for routine work, free cloud for complex reasoning, paid API as last resort
2. **Maintain session affinity** — once a session lands on a provider, keep it there for cache coherence
3. **Gate quality** — cheap models sometimes produce garbage; detect it and auto-escalate
4. **Enforce safety** — block dangerous commands, scrub leaked secrets, protect critical files
5. **Track costs** — know exactly what you're spending per provider per hour

This proxy does all of that in ~2,700 lines of Python.

## Architecture

```
Client Request (Anthropic format)
        │
        ▼
┌─────────────────┐
│  Safety Layer   │ ← Block dangerous commands, protect files
│  (pre-routing)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Session Affinity │ ← Extract session ID from system prompt hash
│ Load Balancer   │    Assign provider by priority + availability
└────────┬────────┘    Re-migrate sessions when better providers recover
         │
    ┌────┴────┬────────┬────────┬────────┐
    ▼         ▼        ▼        ▼        ▼
┌───────┐ ┌──────┐ ┌──────┐ ┌───────┐ ┌──────┐
│Local  │ │ Free │ │OAuth │ │MiniMax│ │Gemini│
│Qwen   │ │ Zen  │ │Opus  │ │BoN   │ │ Pro  │
│122B   │ │Opus 4│ │Opus 4│ │best5  │ │      │
└───┬───┘ └──┬───┘ └──┬───┘ └───┬───┘ └──┬───┘
    │        │        │         │        │
    └────────┴────────┴─────────┴────────┘
                      │
                      ▼
              ┌───────────────┐
              │ Quality Gate  │ ← Score response (0-1), auto-escalate if < 0.5
              │ + Sanitizer   │    Strip XML hallucinations, scrub secrets
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐
              │  Cost Logger  │ ← Per-token pricing, JSONL audit log
              └───────────────┘
```

## Key Features

### Session-Affinity Load Balancer
- Extracts session fingerprints from system prompt hashes
- Assigns sessions to providers by priority (free → cheap → paid)
- Automatic failover with circuit breaking (3 consecutive failures → 2min cooldown)
- Zen re-migration: periodically attempts to move OAuth-stuck sessions back to free tier
- Session eviction with TTL (4h) and max cap (500 sessions)
- OAuth utilization tracking with skip thresholds (>70% 5h window → skip)

### Quality Gate
- Scores every response on: formatting, emoji usage, XML hallucinations, CJK leakage, markdown tables, corporate speak, length
- XML hallucinations auto-fail (score → 0.1)
- Auto-escalation to Opus for scores below 0.5
- Special handling for exact-response patterns (HEARTBEAT_OK, NO_REPLY)

### Best-of-N Sampling (MiniMax)
- Fires N parallel requests to MiniMax
- Scores each response independently
- Returns the highest-quality one
- Configurable N (default: 5 for sync, 1 for stream)

### Safety Layer
- **Command blocklist:** rm -rf, dd, mkfs, fork bombs, curl|sh, shutdown, critical service stops
- **File protection:** Prevents writes to credentials, SSH keys, system files
- **Secret scrubbing:** Regex patterns catch leaked API keys in responses (Anthropic, OpenAI, xAI, Google, GitHub)
- **MiniMax hallucination stripping:** Removes fake XML tool calls that MiniMax loves to generate

### Protocol Translation
- Anthropic ↔ OpenAI format translation for local models (llama.cpp, Ollama)
- Tool calling schema conversion (Anthropic tool_use → OpenAI function calling)
- Streaming delta accumulation for tool call fragments
- System prompt injection for provider-specific quirks

### Cost Tracking
- Per-token pricing tables for all providers
- JSONL cost log with provider, model, token counts, timestamps
- REST endpoint for cost aggregation by time window
- Tracks cache read/write tokens separately

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/messages` | Main proxy — Anthropic Messages API format |
| `GET /health` | Health check |
| `GET /status` | Full system status (providers, sessions, quotas) |
| `GET /lb-status` | Load balancer state (session assignments, failures) |
| `GET /costs?hours=24` | Cost breakdown by provider |
| `GET /safety` | Safety configuration |
| `GET /quality` | Quality gate statistics |
| `GET /providers` | Provider availability and configuration |

## What Makes This Novel

1. **Session affinity for LLMs** — most proxy projects do round-robin or random routing. This tracks sessions and keeps them on one provider for cache coherence, with intelligent re-migration when cheaper providers recover.

2. **Quality scoring as infrastructure** — not just "did it 200?" but "is this response actually good?" with a multi-signal scoring system that catches hallucinations, formatting failures, and corporate speak.

3. **Protocol translation** — single Anthropic-format endpoint that transparently routes to OpenAI-format models (local Qwen, Cerebras) with full tool calling support.

4. **Free-tier orchestration** — the entire load balancer exists to maximize usage of free tiers before spending money. Most people just pick one provider; this system squeezes value from every free API available.

## Running

```bash
pip install fastapi httpx uvicorn
# Set environment variables for each provider
export OPENCODE_API_KEY=...
export MINIMAX_API_KEY=...
export CEREBRAS_API_KEY=...

python proxy.py  # Starts on port 8889
```

## File

- `proxy.py` — The full proxy (~2,700 lines, single file by design for easy deployment)
