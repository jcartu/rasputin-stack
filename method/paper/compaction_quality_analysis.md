# Compaction Quality Analysis: Sonnet 4.6 vs Opus 4.6

## Raw Metrics

| Metric | Sonnet 4.6 | Opus 4.6 (Test) | Opus 4.6 (OpenClaw Actual) |
|---|---|---|---|
| Total time | 227.1s (3.8 min) | 379.2s (6.3 min) | ~368s (6.1 min) |
| First text | 23.3s | 29.2s | N/A |
| Summary length | 25,856 chars | 42,662 chars | 45,870 chars |
| Thinking length | 2,275 chars | 2,380 chars | N/A |
| Output tokens | 8,908 | 14,325 | N/A |
| Input tokens | 35,260 | 35,260 | N/A |
| Stop reason | end_turn | end_turn | N/A |

## Structural Comparison

### Goals Section
- Sonnet: 22 goals listed
- Opus: 23 goals listed (adds "Fix OpenCode Black as OpenClaw provider/fallback" and "Run full 20-category Grok social intel scan")
- **Winner: Opus** — captures 1 additional goal

### Constraints & Preferences
- Sonnet: 17 constraints
- Opus: 17 constraints (nearly identical, Opus adds ".env keys are STALE/DIFFERENT" note)
- **Winner: Tie** — both capture the same key constraints

### Progress - Done Items
- Sonnet: 36 done items
- Opus: 42 done items (adds: gog keyring config, translated Russian audio, pipeline/rate-limit investigation, security postponement, OpenCode Zen verified, Antigravity confirmed not running, system status retrieved, config retrieved, provider misconfiguration confirmed)
- **Winner: Opus** — 6 additional completed items preserved

### Progress - In Progress
- Sonnet: 11 items
- Opus: 14 items (adds: Rivalry Corp acquisition, platform market analysis, Phase 2/3 server hardening details)
- **Winner: Opus** — more granular tracking

### Key Decisions
- Sonnet: 18 decisions
- Opus: 24 decisions (adds: lawyer-us recommendation, sandbox mode decision, security postponement, manual OAuth decision, Gmail-only initial auth, Manus competitor stack details, strip enterprise bloat, sequential build rationale, filesystem-as-memory, local inference, per-user Qdrant, $20-35 cost, Ashley repo decision, Rasputin Production ≠ Manus, OpenCode Black as fallback correction)
- **Winner: Opus** — significantly more decisions preserved, including critical corrections

### Next Steps
- Sonnet: 18 items
- Opus: 24 items (adds: partner baseline bloods, cron lane 403 investigation, get Ashley access, pipeline monitoring focus areas)
- **Winner: Opus** — more comprehensive

### Critical Context
- Sonnet: ~237 lines, 10,800 chars
- Opus: ~336 lines, 16,000+ chars
- Key differences:
  - Opus includes: Rival Powered (separate company) note, full ELF details (ISO 9001, FCDO directory), admin's full legal name, Antigravity endpoint URL and OAuth client details, Google Cloud project number, Dad's family situation (Barbara separation, Lauren threats, property liquidation), ALFIE/Rasputin/JARVIS architecture details, GPU model details
  - Sonnet misses: Several of these granular details
- **Winner: Opus** — significantly more context preserved

## Quality Assessment

### Information Retention Score (estimated)
- Sonnet: ~85% of key information retained
- Opus: ~95% of key information retained

### Critical Omissions by Sonnet
1. Missing "Rival Powered" disambiguation (could cause confusion)
2. Missing Dad's family situation details (Barbara separation, Lauren threats)
3. Missing ALFIE/Rasputin architecture audit details (line counts, component counts)
4. Missing Antigravity endpoint URL and OAuth client details
5. Missing Google Cloud project number
6. Missing cron lane 403 investigation next step
7. Missing several key decisions (sequential build rationale, filesystem-as-memory)

### Sonnet Advantages
1. 40% faster (227s vs 379s)
2. 40% fewer output tokens (8,908 vs 14,325) = lower cost
3. More concise — easier to fit in context window
4. All critical operational info preserved (pipeline config, API keys, fallback order)

## Verdict

Opus produces a measurably better compaction — ~10% more information retained, with the extra detail concentrated in:
- Historical decisions and their rationale
- Architecture/infrastructure details
- Family/personal context
- Error corrections and their explanations

However, Sonnet's summary is NOT bad. It captures all operational essentials. The missing items are mostly "nice to have" context that could be reconstructed from memory files.

For a CHAT ASSISTANT where context window space is precious, Sonnet's more concise summary (25K vs 42K chars) actually leaves MORE room for the actual conversation. Opus's 42K summary eats 65% more context window.

**The real question is: does the extra 10% information retention justify 65% more context window usage and 67% more latency?**
