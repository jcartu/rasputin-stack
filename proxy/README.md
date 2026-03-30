# LLM Routing Proxy

Multi-provider LLM proxy with session affinity, quality gating, failover, and cost logging.

## Files

- `proxy.py` — Current proxy implementation
- `benchmark_quality.py` — Quality benchmarking tools
- `benchmark_tools.py` — Performance benchmarking utilities
- `ecosystem.config.js` — PM2 ecosystem configuration

## Features

- Multi-provider routing (local GPU, Cerebras, Anthropic, OpenAI)
- Compaction detection — routes context compaction to fast inference
- Session affinity and quality gate
- SSE streaming passthrough
- Cost logging to `cost.jsonl`
- Credential scrubbing for safe logging
