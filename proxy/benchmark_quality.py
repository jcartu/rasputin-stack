#!/usr/bin/env python3
"""Quality Benchmark: Compare output quality between models.

12 tests covering actual cron/subagent workloads:
- Intel analysis & summarization
- System health interpretation
- Writing quality & formatting
- Instruction following
- Reasoning & analysis
- Conciseness vs completeness

Captures full outputs from both models for manual evaluation.
"""

import json
import sys
import time
import httpx

PROXY_URL = "http://127.0.0.1:${operator_PROXY_PORT}/v1/messages"
HEADERS = {"content-type": "application/json", "anthropic-version": "2023-06-01"}
TIMEOUT = 180

TESTS = [
    {
        "id": "Q01",
        "name": "Intel Report Writing",
        "category": "writing",
        "description": "Write a concise intel briefing from raw data",
        "system": "You are an intelligence analyst for an digital-platform company. Write concise, actionable briefings. Use bold headers and emoji bullets. No markdown tables. Keep it under 20 lines.",
        "messages": [{"role": "user", "content": """Summarize these findings into a briefing:
- jurisdiction-offshore Gaming Authority published new framework draft on Feb 28, requiring all licensees to implement enhanced KYC by Oct 2026
- Brazil's SIGAP system went live March 1, all operators must register by June 2026 or face blocking
- India's GST council considering 28% tax on online gaming deposits (up from current 18% on GGR)
- Philippines PAGCOR announced ban on all offshore gaming operators effective immediately
- Malta MGA issued warning about AI-powered responsible gaming tools needing human oversight
- Colombia Coljuegos reported 23% YoY growth in regulated online operations market"""}],
    },
    {
        "id": "Q02",
        "name": "System Health Interpretation",
        "category": "ops",
        "description": "Interpret system metrics and identify issues",
        "system": "You are a DevOps assistant monitoring a home server (RASPUTIN). Be direct, flag critical issues first. Use emoji severity markers.",
        "messages": [{"role": "user", "content": """Interpret these system metrics and flag any issues:

CPU: 12.3% avg (48 cores), load average 3.2 2.1 1.8
Memory: 184.6GB / 251GB used (73.5%), 42GB cached, 2.1GB swap used
Disk /: 78% used (1.2TB / 1.5TB)
Disk /data: 92% used (3.7TB / 4.0TB)
GPU0 (RTX PRO 6000): 76.2GB/96GB VRAM, temp 71°C, utilization 45%
GPU1 (RTX 5090): 28.1GB/32GB VRAM, temp 63°C, utilization 12%
Network: 142Mbps in, 23Mbps out
Ollama: 3 models loaded, 2 pending requests
PM2: 14 online, 0 errored, 2 stopped
Uptime: 47 days

Last errors (24h):
- openclaw-gateway: 3 restarts (OOM at 02:41, 04:15, 06:30)
- hybrid-brain: connection refused to Qdrant (3 occurrences)
- embed-gpu1: CUDA OOM at 03:22, auto-recovered"""}],
    },
    {
        "id": "Q03",
        "name": "Telegram-Formatted Summary",
        "category": "formatting",
        "description": "Format information for Telegram (no markdown tables, bold, emoji)",
        "system": "You are a personal AI assistant communicating via Telegram. NEVER use markdown tables or ### headers. Use **bold** for headers, emoji bullets, keep it scannable. Under 15 lines.",
        "messages": [{"role": "user", "content": "Summarize this week's AI news highlights: GPT-5 rumored for Q2 release with native multimodal, Anthropic released Claude Opus 4.6 with 1M context, Google Gemini 3.1 Pro beats benchmarks, Meta open-sourced Llama 4 Scout, DeepSeek V4 claims SOTA on math reasoning, Apple Intelligence getting major overhaul in iOS 20, xAI's Grok 4.1 tops coding benchmarks."}],
    },
    {
        "id": "Q04",
        "name": "Concise Yes/No with Reasoning",
        "category": "reasoning",
        "description": "Answer a business decision question concisely",
        "system": "You are a business advisor. Be direct. Give your recommendation first, then brief reasoning. Max 5 sentences.",
        "messages": [{"role": "user", "content": "Should we pursue a gaming license in Brazil given our current jurisdiction-offshore setup? We do ~$300K/mo revenue from Brazilian players, new SIGAP regulations require local entity registration by June 2026, cost of compliance estimated at $150K setup + $50K/year ongoing. We currently operate grey-market there."}],
    },
    {
        "id": "Q05",
        "name": "Error Analysis & Root Cause",
        "category": "reasoning",
        "description": "Analyze an error log and identify root cause",
        "system": "You are a senior systems engineer. Identify the root cause, don't just describe symptoms. Be specific about the fix.",
        "messages": [{"role": "user", "content": """Analyze this error pattern and give me the root cause + fix:

[02:41:03] openclaw-gateway: heap_limit reached 1887MB, forcing GC
[02:41:04] openclaw-gateway: GC freed 12MB, heap still at 1875MB
[02:41:05] openclaw-gateway: FATAL: JavaScript heap out of memory
[02:41:05] openclaw-gateway: process exited status=134 (SIGABRT)
[02:41:06] systemd: openclaw-gateway.service: Restart=always, restarting
[04:15:01] openclaw-gateway: heap_limit reached 1891MB, forcing GC
[04:15:02] openclaw-gateway: FATAL: JavaScript heap out of memory
[06:30:44] openclaw-gateway: heap_limit reached 1884MB, forcing GC
[06:30:45] openclaw-gateway: FATAL: JavaScript heap out of memory

Additional context: The gateway runs Node.js 25, handles 12 cron jobs, ~50 tool calls/hour. Memory was stable at ~800MB for weeks before this started. It correlates with adding 5 new isolated agent sessions 2 days ago."""}],
    },
    {
        "id": "Q06",
        "name": "HEARTBEAT_OK / NO_REPLY Exact Response",
        "category": "instruction-following",
        "description": "Return exact HEARTBEAT_OK when nothing needs attention",
        "system": "Heartbeat prompt: Read HEARTBEAT.md if it exists. Follow it strictly. Do not infer or repeat old tasks. If nothing needs attention, reply exactly: HEARTBEAT_OK",
        "messages": [{"role": "user", "content": "# HEARTBEAT.md\n\n# Add tasks below when you want the agent to check something periodically.\n\n## Session Model Audit — FALSE ALARM (fully investigated)\nBare model names in sessions.json are normal and harmless. Closed."}],
    },
    {
        "id": "Q07",
        "name": "YouTube Intel Extraction",
        "category": "analysis",
        "description": "Extract actionable intel from YouTube channel descriptions",
        "system": "You are monitoring digital-platform industry YouTube channels. Extract ONLY new, actionable business intelligence. Skip general news. Be concise — bullet points only. If nothing actionable, say so in one line.",
        "messages": [{"role": "user", "content": """Recent videos from monitored channels:

1. "IndustryReview" - "Top 10 platforms March 2026" (2 days ago) - Monthly ranking, provider-a not mentioned, platform-alpha ranked #47
2. "CalvinAyre" - "Brazil SIGAP Launch: What Operators Need to Know" (1 day ago) - Deep dive on compliance requirements, mentions $500K minimum capital requirement
3. "digital-platform Next" - "jurisdiction-offshore License Reform: The Real Timeline" (3 days ago) - Claims Oct 2026 deadline likely pushed to Q1 2027
4. "SBC News" - "LatAm Market Report Q1 2026" (5 hours ago) - Chile regulated market growing 34% YoY, mentions gap in local payment processors
5. "platform Guru" - "provider-a Complaint Analysis" (4 days ago) - 47 unresolved complaints, safety score dropped to 1.3/10"""}],
    },
    {
        "id": "Q08",
        "name": "Memory Consolidation Summary",
        "category": "analysis",
        "description": "Consolidate scattered facts into a coherent summary",
        "system": "You are consolidating fragmented memory entries into a coherent summary. Merge duplicates, resolve contradictions, flag gaps. Output clean bullet points grouped by topic.",
        "messages": [{"role": "user", "content": """Consolidate these memory fragments:

Fragment 1 (Feb 15): "user's dad family-member had emergency in coastal-city, at Broward hospital"
Fragment 2 (Feb 18): "family-member platform - double lung transplant, north-american-city General Hospital"
Fragment 3 (Feb 20): "user's father had health emergency, considering transfer to Mount Sinai"
Fragment 4 (Feb 22): "family-member's surgeon is Indian, leads the transplant program at north-american-city General"
Fragment 5 (Feb 14): "user researching IPF drug treatments for his father"
Fragment 6 (Feb 25): "Dad doing better, back in north-american-city. IPF = idiopathic pulmonary fibrosis"
Fragment 7 (Feb 16): "user couldn't remember surgeon's name during emergency"
Fragment 8 (Feb 19): "Considered CMO meeting at Broward hospital for dad"

Also consolidate:
Fragment 9 (Feb 28): "user married admin (Alexandra) on Jan 14, 2026"
Fragment 10 (Feb 28): "medical-procedure planning — both taking health-goal supplements"
Fragment 11 (Mar 1): "admin takes Orthomol Natal pre, user takes Fertil Plus"
Fragment 12 (Feb 27): "user and admin exploring Canadian passport for her"
Fragment 13 (Feb 28): "Also looking into Israeli passport option for admin (she's not Jewish)"
"""}],
    },
    {
        "id": "Q09",
        "name": "Competitive Intel Analysis",
        "category": "analysis",
        "description": "Analyze competitive data and identify threats/opportunities",
        "system": "You are a competitive intelligence analyst for an digital-platform group (brands: platform-alpha, provider-a, provider-b). Identify actionable threats and opportunities. Prioritize by urgency.",
        "messages": [{"role": "user", "content": """Analyze this competitive data:

Market data:
- Global online operations market grew 11.2% in 2025 to $97.3B
- LatAm fastest growing at 28% YoY
- Player acquisition costs up 18% across industry
- Average player LTV declining 7% (attributed to regulatory friction)

Competitor moves:
- Stake.com launched dedicated Brazil portal with PIX integration
- 1xBet expanded into 5 new African markets
- Bet365 obtained Brazilian federal license (one of first 15 approved)
- Pin-Up platform running $2M influencer campaign targeting LatAm
- Betway partnered with local Brazilian payment processor Pix4Fun

Our metrics:
- Revenue: $2.4M/mo (+12% MoM)
- Brazil revenue: $310K/mo (13% of total)
- Player complaints trending up (34 → 47 in 60 days on platform Guru)
- provider-a safety score: 1.3/10 (was 1.5)
- Player acquisition cost: $85 (industry avg $72)"""}],
    },
    {
        "id": "Q10",
        "name": "Step-by-Step Technical Instructions",
        "category": "instruction-following",
        "description": "Give clear, executable technical instructions",
        "system": "You are a Linux sysadmin. Give exact commands, no hand-waving. Each step must be copy-pasteable.",
        "messages": [{"role": "user", "content": "How do I set up a new llama-server instance on GPU1 (RTX 5090, 32GB VRAM) for Qwen3-Coder 30B with 4 concurrent slots, 16K context each, on port 11437? The model GGUF is at /data/models/qwen3-coder-30b-Q4_K_M.gguf. I want it managed by PM2 and auto-restart on crash."}],
    },
    {
        "id": "Q11",
        "name": "Morning Briefing",
        "category": "writing",
        "description": "Compose a morning briefing from multiple data sources",
        "system": "You are composing user's morning briefing. Be concise but complete. Telegram formatting: bold headers, emoji bullets. Lead with anything urgent. Max 25 lines.",
        "messages": [{"role": "user", "content": """Compose morning briefing from this data:

Weather metro-city: -3°C, cloudy, snow expected afternoon. High -1°C.

Overnight system events:
- Gateway restarted 3x (OOM, see earlier analysis)
- Disk /data at 92% — needs cleanup
- All crons ran successfully
- Qwen 122B inference server stable (47d uptime)

Business alerts:
- provider-a player complaint count hit 47 (threshold was 40)
- Brazil SIGAP registration deadline confirmed June 2026
- Revenue yesterday: $82K (above $77K daily avg)

AI/Tech news overnight:
- Meta released Llama 4 Scout (open source)
- No major model releases affecting our stack

Pending tasks from yesterday:
- Fix proxy tool calling for Qwen ← DONE
- Benchmark Qwen vs MiniMax ← IN PROGRESS
- Clean orphan transcript files
- Update platform-proxy routing after benchmarks"""}],
    },
    {
        "id": "Q12",
        "name": "Nuanced Decision with Tradeoffs",
        "category": "reasoning",
        "description": "Present a balanced analysis of a complex decision",
        "system": "You are a strategic advisor. Present tradeoffs clearly. Don't be wishy-washy — give a clear recommendation at the end.",
        "messages": [{"role": "user", "content": "I'm considering buying a second RTX PRO 6000 (96GB, ~$5,000) to run larger/better quantized local models. Currently running Qwen 3.5 122B at IQ3_XXS on one GPU (76GB VRAM used). The alternative is just paying for API calls — roughly $200-400/month for MiniMax or Anthropic. What should I do? Consider: I'm stuck in Russia (import challenges), I value independence from API providers, I run ~20 cron jobs and sub-agents 24/7, and I want the best possible local inference quality."}],
    },
]


def run_test(test: dict, model: str) -> dict:
    """Run a single test and capture full output."""
    body = {
        "model": model,
        "max_tokens": 2048,
        "stream": False,
        "system": test["system"],
        "messages": test["messages"],
    }

    t0 = time.time()
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            resp = client.post(PROXY_URL, json=body, headers=HEADERS)
            elapsed = time.time() - t0

            if resp.status_code != 200:
                return {"test_id": test["id"], "model": model, "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
                        "elapsed": elapsed, "output": "", "usage": {}}

            data = resp.json()
            text_blocks = [c.get("text", "") for c in data.get("content", []) if c.get("type") == "text"]
            full_text = "\n".join(text_blocks)
            usage = data.get("usage", {})

            return {
                "test_id": test["id"],
                "test_name": test["name"],
                "category": test["category"],
                "model": model,
                "output": full_text,
                "elapsed": round(elapsed, 1),
                "usage": usage,
                "stop_reason": data.get("stop_reason"),
            }
    except Exception as e:
        return {"test_id": test["id"], "model": model, "error": str(e),
                "elapsed": time.time() - t0, "output": "", "usage": {}}


def main():
    models = ["qwen3.5-122b-a10b", "minimax-m2.5"]
    all_results = {}

    for model in models:
        print(f"\n🧪 Running quality tests: {model}")
        print(f"   {len(TESTS)} tests\n")
        results = []
        for i, test in enumerate(TESTS):
            print(f"  [{i+1}/{len(TESTS)}] {test['id']}: {test['name']}...", end=" ", flush=True)
            result = run_test(test, model)
            if result.get("error"):
                print(f"❌ {result['error'][:60]}")
            else:
                print(f"✅ {result['elapsed']}s, {result['usage'].get('output_tokens', 0)} tokens")
            results.append(result)
        all_results[model] = results

    # Save raw outputs for evaluation
    output_path = "/tmp/quality_benchmark_outputs.json"
    with open(output_path, "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    print(f"\nFull outputs saved to {output_path}")

    # Print side-by-side preview
    print(f"\n{'='*80}")
    print("SIDE-BY-SIDE OUTPUT COMPARISON")
    print(f"{'='*80}")

    for test in TESTS:
        tid = test["id"]
        print(f"\n{'��'*80}")
        print(f"  {tid}: {test['name']} ({test['category']})")
        print(f"{'─'*80}")

        for model in models:
            results = all_results[model]
            r = next((x for x in results if x["test_id"] == tid), None)
            if not r:
                continue
            short_model = model.split("-")[0] if "-" in model else model[:10]
            print(f"\n  ◆ {model} ({r['elapsed']}s, {r['usage'].get('output_tokens', 0)} tok):")
            # Print output, indented
            output = r.get("output", r.get("error", "NO OUTPUT"))
            for line in output.split("\n")[:25]:  # Cap at 25 lines
                print(f"    {line}")
            if output.count("\n") > 25:
                print(f"    ... ({output.count(chr(10)) - 25} more lines)")

    # Token/speed summary
    print(f"\n{'='*80}")
    print("SPEED & TOKEN SUMMARY")
    print(f"{'='*80}")
    for model in models:
        results = all_results[model]
        total_time = sum(r["elapsed"] for r in results)
        total_out = sum(r.get("usage", {}).get("output_tokens", 0) for r in results)
        total_in = sum(r.get("usage", {}).get("input_tokens", 0) for r in results)
        errors = sum(1 for r in results if r.get("error"))
        print(f"  {model}: {total_time:.1f}s total, {total_in:,} in / {total_out:,} out, {errors} errors")


if __name__ == "__main__":
    main()
