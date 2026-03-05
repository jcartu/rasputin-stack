# Automated Research Scanning

A suite of tools that autonomously scan multiple sources for new developments and produce concise intelligence briefings.

## Components

### `ai_scanner.py` — arXiv + Reddit + GitHub Scanner
Scrapes three sources daily for AI/ML developments:
- **arXiv**: New papers in cs.AI, cs.CL, cs.LG with keyword filtering
- **Reddit**: Top posts from r/LocalLLaMA, r/MachineLearning, etc.
- **GitHub**: Trending repos in AI/ML categories

Outputs structured Markdown reports with relevance scoring.

### `multi_engine_search.py` — Multi-Engine Search Orchestration
Combines X (via Grok), Perplexity, and Brave Search for comprehensive intelligence:
- **Deduplication**: Tracks seen post IDs across scans (no repeated findings)
- **Content hashing**: Detects recycled/identical responses between runs
- **Auto-updates**: Maintains a recent-headlines file to avoid re-reporting
- **State persistence**: JSONL state file survives restarts

The key technique: each engine has different strengths. X/Grok for real-time social sentiment, Perplexity for synthesized answers, Brave for specific page scraping. Use all three, deduplicate, and merge.

### `youtube_monitor.py` — YouTube Channel Monitoring
Monitors YouTube channels across interest categories for new content:
- Configurable channel lists per category
- Video metadata extraction (title, description, duration, publish date)
- LLM-powered content analysis and relevance scoring
- Daily digest generation

## What Makes This Novel

1. **Cross-engine deduplication** — not just "search three engines and concatenate." Post IDs and content hashes track what's already been reported, so each scan produces only genuinely new findings.

2. **Autonomous daily operation** — these run as cron jobs, producing briefings without human input. The agent reads them in the morning and already knows what happened overnight.

3. **Content hash for recycled detection** — search APIs sometimes return identical content on successive queries. Content hashing (normalized, timestamp-stripped) catches this.
