# LLM Model Routing Philosophy

## The Problem

Running 7+ LLM providers (local inference, free tiers, paid APIs) creates a routing problem: which provider should handle which request?

Naive approaches:
- **Fixed routing** — always use the same provider. Wastes free tiers, overpays for simple tasks.
- **Round-robin** — breaks cache coherence. Provider A cached your system prompt; now Provider B starts cold.
- **Cost-only** — cheapest first. Ignores quality differences and rate limits.

## The Solution: Session-Affinity Load Balancing

### Core Idea
Once a session lands on a provider, keep it there. This preserves cache coherence (system prompt caching, KV cache) and provides consistent quality within a conversation.

### Provider Priority
```
1. Local Qwen (122B MoE, $0)     ← 80%+ of requests
2. Free Zen (Opus 4, $0)         ← complex reasoning
3. OAuth (Opus 4, $0 quota)      ← fallback when Zen is rate-limited
4. Gemini Pro ($2/Mtok in)       ← 1M context window tasks
5. MiniMax ($0.15/Mtok in)       ← budget cloud reasoning
6. Cerebras (fast inference)     ← compaction/summarization
7. Anthropic API ($15/Mtok in)   ← last resort
```

### Session Fingerprinting
Sessions are identified by hashing the first 200 characters of the system prompt (MD5, 12 chars). This is stable across messages within a session and unique enough to distinguish different agent sessions.

### Failover Cascade
```
Assigned Provider fails (429/5xx)
    │
    ├─ Increment failure counter
    ├─ If 3+ consecutive failures → circuit break (2min cooldown)
    └─ Reassign to next available provider in priority order
```

### Zen Re-Migration
Sessions stuck on OAuth (because Zen was rate-limited) periodically attempt to migrate back to Zen. This is checked every 5 minutes per session:

```python
if session.provider == OAUTH:
    if zen.is_available() and time_since_last_check > 5min:
        session.provider = ZEN  # Try Zen again
        # If Zen 429s, failover puts us back on OAuth
```

### OAuth Utilization Tracking
OAuth has rolling quotas (5-hour and 7-day windows). The proxy tracks utilization from response headers and skips OAuth when:
- 5-hour window > 70% utilized
- 7-day window > 60% utilized

This prevents burning the entire quota on one busy session.

## Quality Gate

Not all providers produce equal quality. The proxy scores every response:

```
Score Components (weighted):
├── Bold formatting present?      (weight: 2)
├── Emoji usage?                  (weight: 1)
├── XML hallucinations?           (weight: 6, auto-fail)
├── Markdown tables?              (weight: 2)
├── CJK character leakage?       (weight: 2)
├── Unnecessary code blocks?      (weight: 1)
├── Reasonable length?            (weight: 1)
├── Markdown headers?             (weight: 1)
└── Corporate speak detected?     (weight: 1)
```

Score < 0.5 → auto-escalate to Opus.

## Best-of-N Sampling

For providers with variable quality (e.g., MiniMax), fire N parallel requests and return the best:

```
Request ──┬── Attempt 1 ──► Score: 0.7
          ├── Attempt 2 ──► Score: 0.3  (XML hallucination)
          ├── Attempt 3 ──► Score: 0.8  ← Winner
          ├── Attempt 4 ──► Score: 0.6
          └── Attempt 5 ──► Score: 0.4

Return: Attempt 3 (highest score)
```

Default: 5 parallel attempts for sync requests, 1 for streaming.

## Cost Optimization Results

With this routing strategy:
- **80%+** of requests handled by local Qwen ($0)
- **15%** handled by free tiers (Zen, OAuth)
- **<5%** hits paid APIs
- Total daily cost: typically under $1 for heavy usage
