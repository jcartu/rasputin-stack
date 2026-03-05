# Autonomous Cron Patterns

The system runs 30+ automated cron jobs that handle memory enrichment, research scanning, health monitoring, and self-improvement — all without human intervention.

## Philosophy

Crons are the backbone of autonomous operation. While the agent sleeps (or while the user is away), crons keep the system learning, monitoring, and improving.

## Categories

### Memory Maintenance
| Job | Schedule | What It Does |
|-----|----------|-------------|
| Fact Extractor | Every 4h | Mines session transcripts for personal knowledge using local LLM |
| Hot Commit | Every 30min | Heuristic-based fact extraction (no LLM, <100ms) |
| Memory Enrichment | Nightly | Importance scoring pipeline (batches of 10, 500 chunks/run) |
| Episode Detector | Daily | Clusters conversations into episodic memories |
| Brain Cleanup | Weekly | Deduplication, stale memory removal, graph consistency |
| Graph Deepening | Weekly | Adds new entity relationships discovered in recent memories |

### Research & Intelligence
| Job | Schedule | What It Does |
|-----|----------|-------------|
| AI Research Scanner | Daily | arXiv + Reddit + GitHub scanning for AI developments |
| Multi-Engine Intel | 3x/day | X + Perplexity + Brave search with cross-engine dedup |
| YouTube Monitor | Daily | Channel monitoring across interest categories |

### Infrastructure Monitoring
| Job | Schedule | What It Does |
|-----|----------|-------------|
| Infra Health | Every 5min | Service availability (proxy, Ollama, Qdrant, embeddings) |
| Anomaly Detection | Hourly | DOW-aware statistical anomaly detection on business metrics |
| Memory Health | Daily | Vector DB consistency, embedding dimension checks |
| GPU Monitor | Continuous | VRAM usage, temperature, utilization tracking |

### Self-Improvement
| Job | Schedule | What It Does |
|-----|----------|-------------|
| Self-Play Pipeline | Weekly | Task generation → solving → trajectory collection for training data |
| Weekly Synthesis | Weekly | Consolidates week's memories into higher-level observations |

## Example Cron Configuration

```bash
# Memory maintenance
*/30 * * * * python3 /path/to/memory/hot_commit.py
0 */4 * * *  python3 /path/to/memory/fact_extractor.py
0 2 * * *    python3 /path/to/memory/enrich.py --batch-size 500
0 3 * * *    python3 /path/to/memory/episode_detector.py

# Research
0 8 * * *    python3 /path/to/research/ai_scanner.py
0 6,14,22 * * * python3 /path/to/research/multi_engine_search.py
0 7 * * *    python3 /path/to/research/youtube_monitor.py

# Monitoring
*/5 * * * *  python3 /path/to/monitoring/infra_health.py
0 * * * *    python3 /path/to/monitoring/anomaly_detector.py
```

## Design Principles

1. **Cheap by default** — most crons use local LLM ($0) or heuristics (no LLM at all)
2. **Idempotent** — every cron can be re-run safely; state tracking prevents duplicate work
3. **Fail-safe** — crons log errors but never crash the main agent; retry logic where needed
4. **Progressive** — heavy work split into small batches across multiple runs (enrichment: 500 chunks/run × 4 runs/night)
