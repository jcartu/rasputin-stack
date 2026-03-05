#!/usr/bin/env python3
"""
AI Frontier Briefing — Real-time intelligence for staying ahead.
Scans YouTube, web, HN, arxiv for breaking AI developments.
Outputs structured briefing with upgrade recommendations.

Usage: python3 ai_frontier_briefing.py [--morning|--evening]
"""

import json
import sys
import os
import subprocess
import re
from datetime import datetime, timedelta

WORKSPACE = os.path.expanduser("~/.openclaw/workspace")
INTEL_DIR = os.path.join(WORKSPACE, "memory/intel")
os.makedirs(INTEL_DIR, exist_ok=True)

# What we're tracking — expand as needed
SCAN_TOPICS = [
    # Models & releases
    {"query": "new AI model release today 2026", "category": "models", "label": "New Model Releases"},
    {"query": "Claude Opus GPT Gemini Grok update February 2026", "category": "models", "label": "Frontier Model Updates"},
    {"query": "MiniMax M2.5 OR Kimi K2.5 OR Mistral OR Qwen new model", "category": "models", "label": "Challenger Models"},
    
    # Agent frameworks & tools
    {"query": "AI agent framework new release 2026 OpenClaw Claude Code Codex", "category": "agents", "label": "Agent Frameworks"},
    {"query": "autonomous AI agent breakthrough memory tool-use", "category": "agents", "label": "Agent Breakthroughs"},
    {"query": "MCP protocol AI tools integration new", "category": "agents", "label": "MCP & Tool Ecosystem"},
    
    # RAG & memory
    {"query": "RAG retrieval augmented generation new technique 2026", "category": "rag", "label": "RAG Innovations"},
    {"query": "graph RAG agentic RAG knowledge graph LLM", "category": "rag", "label": "Graph RAG & Knowledge"},
    {"query": "AI memory system long-term context management", "category": "rag", "label": "Memory Systems"},
    
    # Infrastructure & optimization
    {"query": "LLM inference optimization vLLM deployment speed", "category": "infra", "label": "Inference & Speed"},
    {"query": "AI API pricing cost reduction cheap frontier model", "category": "infra", "label": "Cost & Pricing"},
    {"query": "open source LLM local deployment GPU", "category": "infra", "label": "Local/Open Source"},
    
    # Applied AI
    {"query": "AI automation business workflow agent 2026", "category": "applied", "label": "Business Automation"},
    {"query": "AI coding agent benchmark SWE-bench", "category": "applied", "label": "Coding Agents"},
    
    # YouTube specific
    {"query": "site:youtube.com AI agent autonomous coding February 2026", "category": "youtube", "label": "YouTube: Agents"},
    {"query": "site:youtube.com new AI model review test 2026", "category": "youtube", "label": "YouTube: Model Reviews"},
]

# Our current stack — for comparison/recommendations
OUR_STACK = {
    "main_model": "Claude Opus 4.6",
    "sub_agents": "Claude Sonnet 4.5",
    "heartbeats": "Gemini 3 Flash Preview",
    "social_intel": "Grok 4.1 Fast",
    "local_uncensored": "GPT-OSS 120B",
    "embeddings": "BGE-large-en-v1.5",
    "reranker": "BGE-reranker-v2-m3",
    "vector_db": "Qdrant (761K memories)",
    "retrieval": "Dense + BM25 + RRF + Neural Reranker",
    "routing": "LiteLLM 9-tier",
    "agent_platform": "OpenClaw 2026.2.13",
}


def search_brave(query, count=5, freshness="pd"):
    """Search via brave using the web_search-like approach"""
    # We'll shell out to a simple curl command
    import urllib.parse
    encoded = urllib.parse.quote(query)
    
    # Use the summarize tool or direct web search
    # For now, collect from web
    cmd = f'''curl -s "https://api.search.brave.com/res/v1/web/search?q={encoded}&count={count}&freshness={freshness}" \
        -H "X-Subscription-Token: {os.environ.get('BRAVE_API_KEY', '')}" \
        -H "Accept: application/json"'''
    
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            results = []
            for item in data.get("web", {}).get("results", []):
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "description": item.get("description", ""),
                    "published": item.get("page_age", ""),
                })
            return results
    except Exception as e:
        pass
    return []


def scan_all_topics(freshness="pd"):
    """Scan all topics and organize results"""
    all_results = {}
    
    for topic in SCAN_TOPICS:
        results = search_brave(topic["query"], count=5, freshness=freshness)
        if results:
            category = topic["category"]
            if category not in all_results:
                all_results[category] = []
            all_results[category].append({
                "label": topic["label"],
                "results": results
            })
    
    return all_results


def format_briefing(results, period="morning"):
    """Format results into a structured briefing"""
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M MSK")
    
    lines = []
    lines.append(f"# AI Frontier Briefing — {period.title()}")
    lines.append(f"**Date:** {date_str} | **Time:** {time_str}")
    lines.append(f"**Our Stack:** {json.dumps(OUR_STACK, indent=2)}")
    lines.append("")
    
    category_labels = {
        "models": "🧠 Model Releases & Updates",
        "agents": "🤖 Agent Frameworks & Tools",
        "rag": "📚 RAG & Memory Systems",
        "infra": "⚙️ Infrastructure & Optimization",
        "applied": "💼 Applied AI & Automation",
        "youtube": "📺 YouTube Coverage",
    }
    
    for category, groups in results.items():
        lines.append(f"\n## {category_labels.get(category, category)}\n")
        for group in groups:
            lines.append(f"### {group['label']}")
            for r in group["results"]:
                title = r["title"]
                url = r["url"]
                desc = r["description"][:200] if r["description"] else ""
                published = r.get("published", "")
                lines.append(f"- **[{title}]({url})** {f'({published})' if published else ''}")
                if desc:
                    lines.append(f"  {desc}")
            lines.append("")
    
    return "\n".join(lines)


def save_briefing(content, period):
    """Save to intel directory"""
    date_str = datetime.now().strftime("%Y-%m-%d")
    filepath = os.path.join(INTEL_DIR, f"frontier-{date_str}-{period}.md")
    with open(filepath, "w") as f:
        f.write(content)
    return filepath


def main():
    period = "morning"
    freshness = "pd"  # past day
    
    if "--evening" in sys.argv:
        period = "evening"
        freshness = "pd"
    elif "--morning" in sys.argv:
        period = "morning"
        freshness = "pw"  # past week for morning (catch overnight)
    
    # Check for Brave API key
    if not os.environ.get("BRAVE_API_KEY"):
        # Try loading from .env
        env_path = os.path.join(WORKSPACE, ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("BRAVE_API_KEY="):
                        os.environ["BRAVE_API_KEY"] = line.split("=", 1)[1].strip().strip('"').strip("'")
    
    print(f"Starting {period} frontier scan...", file=sys.stderr)
    results = scan_all_topics(freshness=freshness)
    
    if not results:
        print("No results found. Check BRAVE_API_KEY.", file=sys.stderr)
        # Output minimal briefing
        print(json.dumps({"status": "no_results", "period": period}))
        return
    
    briefing = format_briefing(results, period)
    filepath = save_briefing(briefing, period)
    
    print(f"Briefing saved to {filepath}", file=sys.stderr)
    
    # Output the briefing path and summary for the agent
    output = {
        "status": "ok",
        "period": period,
        "filepath": filepath,
        "categories": {k: sum(len(g["results"]) for g in v) for k, v in results.items()},
        "total_items": sum(sum(len(g["results"]) for g in v) for v in results.values()),
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
