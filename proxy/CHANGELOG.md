# operator Proxy Evolution Changelog

## Overview
This document tracks the architectural evolution of the operator-proxy from v1 through v11,
detailing key features added at each version milestone.

---

## Version 1 (proxy.py) — Initial Release
**Core Architecture:**
- FastAPI-based proxy server sitting between OpenClaw and Anthropic API
- Compaction detection using keyword markers in requests
- Routes compaction requests to Cerebras GLM-4.7 for 30-60x faster processing
- All other requests pass through transparently to api.anthropic.com
- OAuth token caching from Claude CLI credentials

**Key Components:**
- Compaction marker detection (9 patterns)
- HTTPX async client with 20 connection pool
- Cost logging to cost.jsonl

---

## Version 2 — OAuth Caching & Token Management
**New Features:**
- Persistent OAuth token cache with 5-minute TTL
- Fallback to ANTHROPIC_API_KEY env var when OAuth fails
- Proper Authorization header construction with Anthropic beta flags
- Improved error handling for credential read failures

**Changes from v1:**
- Added `_oauth_cache` dictionary for token caching
- `OAUTH_CACHE_TTL = 300` configuration
- Enhanced `get_anthropic_auth()` function with cache logic

---

## Version 3 — Cost Intelligence & Provider Monitoring
**New Features:**
- **Token usage tracking** on ALL passthrough requests via SSE stream parsing
- **Real-time cost calculation** using provider-specific pricing
- `/costs` endpoint for aggregated dashboard data
- `/providers` endpoint showing real-time health + rate limit headroom
- Rate limit header capture from Anthropic responses

**Pricing Model Added:**
```python
PRICING = {
    "anthropic-oauth": {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_write": 3.75},
    "cerebras": {"input": 0.60, "output": 0.60},
    "opencode-zen": {"input": 0, "output": 0},
}
```

**New Tracking Structures:**
- `_rate_limits` dictionary for provider rate limit state
- `collections.defaultdict` for cost aggregation
- Time delta calculations for reset timestamps

---

## Version 4 — MiniMax M2.5 Integration
**New Features:**
- **Direct MiniMax M2.5 API integration** via api.minimax.io/anthropic/v1/messages
- **Model-based routing**: minimax-* models → MiniMax API, others → Anthropic
- Full cost tracking for MiniMax provider (input: $0.15M, output: $1.20M)
- Multiple MiniMax model variants supported:
  - minimax-m2.5, minimax-m2.5-highspeed
  - minimax-m2.1, minimax-m2.1-highspeed
  - minimax-m2

**Architectural Changes:**
- Added `MINIMAX_URL` and `MINIMAX_API_KEY` config
- Extended `PRICING` dictionary with MiniMax tiers
- Model routing logic in request handler

---

## Version 5 — Safety Layer Implementation
**New Features:**
- **Command blocklist**: Intercepts dangerous exec commands before forwarding
- **Response sanitization**: Strips CJK leakage and XML hallucinations
- **API key scrubbing**: Removes sk-* patterns from responses
- All safety checks applied to MiniMax responses

**Dangerous Patterns Blocked:**
- `rm -rf` on root/system paths
- `dd` from device (disk wipe)
- Filesystem format commands
- `chmod 777` recursive on root
- `curl/wget | sh` pipe to shell
- Fork bombs
- System shutdown/reboot commands
- Critical service stops (ollama, openclaw, sshd)

**Response Sanitization:**
- Pattern: `<minimax:tool_call>...</minimax:tool_call>` XML removal
- CJK character leakage detection
- API key pattern scrubbing (`sk-[A-Za-z0-9]+`)

---

## Version 6 — Quality Gate & Auto-Escalation
**New Features:**
- **Quality scoring system**: Evaluates MiniMax response quality
- **Auto-escalation**: Routes low-quality responses to Opus automatically
- **MiniMax-specific system prompt injection**: Extra formatting rules
- **Post-processing enhancement**: Adds missing bold/emoji, truncates verbose output
- **Escalation logging and statistics tracking**

**Quality Gate Logic:**
1. Score MiniMax response on completeness, formatting, tool usage
2. If score < threshold → escalate to Opus with context
3. Log escalation reason and results
4. Track per-provider quality metrics

**All v5 safety features preserved** (blocklist, sanitization, scrubbing)

---

## Version 7 — Cerebras Fixes & OpenCode Zen Fallback
**New Features:**
- **Fixed anthropic_to_openai conversion**: Tool blocks preserved as text summaries
- **Fixed consecutive same-role merging**: Cerebras rejection issue resolved
- **Increased max_completion_tokens**: 32768 for GLM-4.7 reasoning headroom
- **Detailed Cerebras error logging**: HTTP status + response body
- **Compaction fallback chain**: Cerebras → OpenCode Zen → Anthropic OAuth

**OpenCode Zen Integration:**
- Free Opus 4.6 access via opencode.ai/zen/v1/messages
- Used as compaction fallback when Cerebras fails
- Added `OPENCODE_ZEN_URL` and `ZEN_OPENCODE_API_KEY` config
- New pricing entry: `"opencode-zen": {"input": 0, "output": 0}`

**Error Handling Improvements:**
- Log detailed error info on Cerebras failures
- Graceful fallback to next provider in chain
- Preserve all v6 features (quality gate, safety, sanitization)

---

## Version 8 — Backup Version
**Note**: This version was marked as backup and skipped from distribution.
No changelog entry for proxy_v8_backup_*.

---

## Version 9 — Session-Affinity Load Balancing
**New Features:**
- **Session-affinity load balancer**: Opus requests distributed across Zen/OAuth/Gemini
- **Provider priority system**: Zen (primary, free) → OAuth (secondary) → Gemini (overflow, cheap)
- **Session stickiness**: Sessions remain on assigned provider for cache coherence
- **OAuth utilization monitoring**: Auto-skip when 5h > 70% or 7d > 60% utilization
- **Automatic failover**: Cascade to next provider + reassign session on failure

**New Local Models Added:**
```python
# Local Qwen 3.5 122B-A10B (llama.cpp, IQ3_XXS)
LOCAL_QWEN_URL = "http://127.0.0.1:11435/v1/chat/completions"

# Local Qwen3-Coder 30B (GPU1/RTX 5090)
LOCAL_CODER_URL = "http://127.0.0.1:11436/v1/chat/completions"

# Gemini via gemini-cli-anthropic proxy
GEMINI_PROXY_URL = "http://127.0.0.1:4000/v1/messages"
```

**Pricing Updates:**
- `local-qwen`: Free (local inference)
- `gemini-pro`: input $2.0M, output $12.0M
- `gemini-flash`: input $0.15M, output $0.60M

**Quota Tracking System:**
- Tracks reset times for free providers
- Utilization windows: 5h and 7d rolling averages

**All v8 features preserved** (best-of-5 MiniMax, compaction, safety)

---

## Version 10 — Tool Calling Support
**New Features:**
- **Full tool calling support for Qwen/Ollama/llama.cpp path**:
  - Anthropic tool schemas → OpenAI function calling format
  - `tool_use`/`tool_result` message history translation
  - OpenAI function responses → Anthropic `tool_use` blocks
  - Streaming tool call delta accumulation
  - `tool_choice` translation (auto/any/none/specific)

**Architecture:**
- Cerebras compaction path unchanged (text-summary mode)
- New translation layer for local model tool support
- Preserves all v9 features (session-affinity LB, best-of-5 MiniMax, safety)

**Key Transformations:**
1. `anthropic_tool_to_openai_function()` schema converter
2. `message_history_translate()` for tool_use/tool_result blocks
3. `openai_function_call_to_anthropic()` response formatter
4. Streaming delta accumulation with proper block closing

---

## Version 11 — Model Variant Handling & Enhancements
**New Features:**
- **Model name variant handling**: PascalCase support (MiniMax-M2.5 vs minimax-m2.5)
- **Extended model list**: Additional MiniMax variants and Lightning models
- **Local model enhancements**: Better Qwen and Gemini model detection

**Model Name Variants Added:**
```python
MINIMAX_MODELS = {
    "minimax-m2.5", "minimax-m2.5-highspeed",
    "minimax-m2.1", "minimax-m2.1-highspeed", "minimax-m2",
    # PascalCase variants (OpenClaw 2026.3.2+ native)
    "MiniMax-M2.5", "MiniMax-M2.5-highspeed",
    "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2.1-Lightning",
}
```

**All v10 features preserved** with improved model name normalization

---

## Architecture Summary

| Version | Key Addition | Primary Use Case |
|---------|-------------|------------------|
| v1 | Cerebras compaction + Anthropic passthrough | Initial routing |
| v2 | OAuth caching | Token management |
| v3 | Cost intelligence + provider monitoring | Visibility |
| v4 | MiniMax M2.5 integration | Alternative provider |
| v5 | Safety layer (blocklist + sanitization) | Security |
| v6 | Quality gate + auto-escalation | Quality assurance |
| v7 | Cerebras fixes + Zen fallback | Reliability |
| v9 | Session-affinity load balancing | Multi-provider distribution |
| v10 | Tool calling support | Local model integration |
| v11 | Model variant handling | Compatibility |

## Design Principles

1. **Compaction optimization**: Use cheap/fast models (Cerebras) for summarization
2. **Quality assurance**: Escalate low-quality responses to premium models
3. **Cost efficiency**: Free providers first, paid only when necessary
4. **Safety first**: Block dangerous commands, sanitize all responses
5. **Session coherence**: Keep sessions on same provider for cache benefits
6. **Graceful degradation**: Multi-tier fallback chain on failures
7. **Full observability**: Cost tracking, rate limits, utilization metrics

---

*Generated by sanitize_and_copy.py - operator Proxy Evolution Documentation*
