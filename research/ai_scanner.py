#!/usr/bin/env python3
"""
AI Research Scanner — Daily scrape of arXiv, Reddit, and GitHub for new developments.
Outputs a concise briefing of what's new and worth trying.
"""
import json, sys, os, time, re
from datetime import datetime, timedelta
from urllib.request import urlopen, Request
from urllib.parse import quote
from urllib.error import HTTPError

REPORT_DIR = os.path.expanduser("/path/to/workspace/memory/research")
os.makedirs(REPORT_DIR, exist_ok=True)

today = datetime.now().strftime("%Y-%m-%d")
report_path = os.path.join(REPORT_DIR, f"scan_{today}.md")

findings = []

def add_finding(source, category, title, url, summary, relevance="medium"):
    findings.append({
        "source": source, "category": category, "title": title,
        "url": url, "summary": summary, "relevance": relevance
    })

def fetch_json(url, headers=None):
    try:
        req = Request(url, headers=headers or {"User-Agent": "Research-Scanner/1.0"})
        return json.loads(urlopen(req, timeout=15).read())
    except Exception as e:
        print(f"  WARN: {url[:60]}... → {e}", file=sys.stderr)
        return None

def fetch_text(url):
    try:
        req = Request(url, headers={"User-Agent": "Research-Scanner/1.0"})
        return urlopen(req, timeout=15).read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  WARN: {url[:60]}... → {e}", file=sys.stderr)
        return ""

# =========================================================================
# 1. arXiv — new papers in cs.AI, cs.CL, cs.LG
# =========================================================================
print("📄 Scanning arXiv...", flush=True)

ARXIV_CATEGORIES = ["cs.AI", "cs.CL", "cs.LG"]
ARXIV_KEYWORDS = [
    "agent", "context window", "memory", "compaction", "routing",
    "inference", "cost", "multi-model", "tool use", "autonomous",
    "retrieval augmented", "RAG", "vector database", "long context",
    "reasoning", "code generation", "function calling", "MCP",
    "safety", "alignment", "benchmark", "evaluation",
    "mixture of experts", "speculative decoding", "quantization",
    "fine-tuning", "RLHF", "DPO", "distillation",
]

for cat in ARXIV_CATEGORIES:
    try:
        # arXiv API: get recent papers
        url = f"http://export.arxiv.org/api/query?search_query=cat:{cat}&sortBy=submittedDate&sortOrder=descending&max_results=15"
        xml = fetch_text(url)
        
        # Parse entries (simple regex, no lxml needed)
        entries = re.findall(r'<entry>(.*?)</entry>', xml, re.DOTALL)
        
        for entry in entries:
            title = re.search(r'<title>(.*?)</title>', entry, re.DOTALL)
            summary = re.search(r'<summary>(.*?)</summary>', entry, re.DOTALL)
            link = re.search(r'<id>(.*?)</id>', entry)
            published = re.search(r'<published>(.*?)</published>', entry)
            
            if not all([title, summary, link]): continue
            
            title_text = ' '.join(title.group(1).strip().split())
            summary_text = ' '.join(summary.group(1).strip().split())[:300]
            url_text = link.group(1).strip()
            pub_date = published.group(1)[:10] if published else ""
            
            # Check if published in last 2 days
            if pub_date and pub_date < (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d"):
                continue
            
            # Check relevance
            combined = (title_text + " " + summary_text).lower()
            matched_keywords = [kw for kw in ARXIV_KEYWORDS if kw.lower() in combined]
            
            if len(matched_keywords) >= 2:
                relevance = "high" if len(matched_keywords) >= 4 else "medium"
                add_finding(
                    "arXiv", cat, title_text, url_text,
                    f"{summary_text}... [Keywords: {', '.join(matched_keywords[:5])}]",
                    relevance
                )
                print(f"  ✓ [{cat}] {title_text[:70]}...", flush=True)
    except Exception as e:
        print(f"  ERR scanning {cat}: {e}", file=sys.stderr)
    
    time.sleep(1)  # Rate limit

# =========================================================================
# 2. Reddit — r/LocalLLaMA, r/MachineLearning, r/ClaudeAI, r/OpenAI
# =========================================================================
print("\n📌 Scanning Reddit...", flush=True)

SUBREDDITS = [
    ("LocalLLaMA", ["model", "benchmark", "quantization", "inference", "agent", "tool", "memory", "context", "open source", "release"]),
    ("MachineLearning", ["paper", "research", "benchmark", "SOTA", "agent", "reasoning", "architecture"]),
    ("ClaudeAI", ["update", "release", "feature", "API", "tool", "MCP", "agent", "context", "memory"]),
    ("OpenAI", ["GPT", "release", "API", "update", "model", "o1", "o3", "agent"]),
    ("singularity", ["AGI", "breakthrough", "release", "benchmark", "frontier"]),
]

for sub, keywords in SUBREDDITS:
    try:
        url = f"https://www.reddit.com/r/{sub}/hot.json?limit=15"
        data = fetch_json(url, {"User-Agent": "Research-Scanner/1.0"})
        if not data or "data" not in data: continue
        
        for post in data["data"]["children"]:
            p = post["data"]
            title = p.get("title", "")
            score = p.get("ups", 0)
            comments = p.get("num_comments", 0)
            url_post = f"https://reddit.com{p.get('permalink', '')}"
            selftext = p.get("selftext", "")[:200]
            created = p.get("created_utc", 0)
            
            # Only last 24 hours
            if time.time() - created > 86400: continue
            
            # Minimum engagement
            if score < 20: continue
            
            combined = (title + " " + selftext).lower()
            matched = [kw for kw in keywords if kw.lower() in combined]
            
            if matched or score >= 100:
                relevance = "high" if score >= 200 or len(matched) >= 3 else "medium"
                add_finding(
                    "Reddit", f"r/{sub}", title[:100], url_post,
                    f"⬆️ {score} | 💬 {comments} | {selftext[:150]}...",
                    relevance
                )
                print(f"  ✓ [r/{sub}] ({score}⬆️) {title[:60]}...", flush=True)
    except Exception as e:
        print(f"  ERR r/{sub}: {e}", file=sys.stderr)
    
    time.sleep(1)

# =========================================================================
# 3. GitHub — trending repos in AI/ML
# =========================================================================
print("\n🐙 Scanning GitHub trending...", flush=True)

GITHUB_SEARCHES = [
    "language:python stars:>50 created:>{} topic:llm".format((datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")),
    "language:python stars:>50 created:>{} topic:agent".format((datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")),
    "language:python stars:>100 created:>{} topic:ai".format((datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")),
]

seen_repos = set()
for query in GITHUB_SEARCHES:
    try:
        url = f"https://api.github.com/search/repositories?q={quote(query)}&sort=stars&order=desc&per_page=10"
        data = fetch_json(url, {"Accept": "application/vnd.github.v3+json", "User-Agent": "RASPUTIN"})
        if not data or "items" not in data: continue
        
        for repo in data["items"]:
            name = repo["full_name"]
            if name in seen_repos: continue
            seen_repos.add(name)
            
            stars = repo["stargazers_count"]
            desc = repo.get("description", "")[:200] or "No description"
            url_repo = repo["html_url"]
            topics = repo.get("topics", [])
            
            relevance = "high" if stars >= 500 else "medium"
            add_finding(
                "GitHub", "trending", f"{name} ⭐{stars}", url_repo,
                f"{desc} | Topics: {', '.join(topics[:5])}",
                relevance
            )
            print(f"  ✓ {name} ({stars}⭐) {desc[:50]}...", flush=True)
    except Exception as e:
        print(f"  ERR GitHub: {e}", file=sys.stderr)
    
    time.sleep(2)

# =========================================================================
# 4. Hugging Face — new models
# =========================================================================
print("\n🤗 Scanning Hugging Face...", flush=True)

try:
    url = "https://huggingface.co/api/models?sort=lastModified&direction=-1&limit=20"
    data = fetch_json(url)
    if data:
        for model in data:
            model_id = model.get("modelId", "")
            downloads = model.get("downloads", 0)
            likes = model.get("likes", 0)
            tags = model.get("tags", [])
            
            # Only notable models
            if downloads < 1000 and likes < 50: continue
            
            # Filter for relevant tags
            relevant_tags = [t for t in tags if any(kw in t.lower() for kw in ["text-generation", "chat", "code", "instruct", "agent"])]
            if not relevant_tags and likes < 100: continue
            
            url_model = f"https://huggingface.co/{model_id}"
            relevance = "high" if likes >= 200 or downloads >= 50000 else "medium"
            add_finding(
                "HuggingFace", "models", f"{model_id} (❤️{likes}, ⬇️{downloads:,})", url_model,
                f"Tags: {', '.join(tags[:8])}",
                relevance
            )
            print(f"  ✓ {model_id} ({likes}❤️)", flush=True)
except Exception as e:
    print(f"  ERR HuggingFace: {e}", file=sys.stderr)

# =========================================================================
# Generate Report
# =========================================================================
print(f"\n📊 Generating report ({len(findings)} findings)...", flush=True)

# Sort by relevance (high first) then source
findings.sort(key=lambda x: (0 if x["relevance"] == "high" else 1, x["source"]))

report = [f"# AI Research Scan — {today}\n"]
report.append(f"**{len(findings)} findings** across arXiv, Reddit, GitHub, HuggingFace\n")

# Group by source
for source in ["arXiv", "Reddit", "GitHub", "HuggingFace"]:
    source_findings = [f for f in findings if f["source"] == source]
    if not source_findings: continue
    
    icon = {"arXiv": "📄", "Reddit": "📌", "GitHub": "🐙", "HuggingFace": "🤗"}[source]
    report.append(f"\n## {icon} {source} ({len(source_findings)} items)\n")
    
    for f in source_findings:
        marker = "🔥" if f["relevance"] == "high" else "•"
        report.append(f"{marker} **[{f['category']}]** [{f['title']}]({f['url']})")
        report.append(f"  {f['summary']}\n")

# =========================================================================
# Actionable Recommendations — What we should do about it
# =========================================================================

# Define what's "relevant to us" — keywords/patterns for our stack
OUR_STACK_KEYWORDS = [
    "ollama", "ggml", "llama.cpp", "gguf", "quantization", "qwen",
    "kimi", "moonshot", "minimax", "openclaw", "claude", "opus", "anthropic",
    "proxy", "routing", "multi-model", "cost", "inference", "safety",
    "agent", "autonomous", "memory", "context window", "compaction",
    "qdrant", "embedding", "reranker", "arxiv", "benchmark",
    "security", "tool use", "function calling", "mcp",
    "huggingface", "local", "self-hosted", "gpu", "rtx",
]

def classify_action(finding):
    """Classify what kind of action a finding warrants."""
    text = (finding["title"] + " " + finding["summary"]).lower()
    
    # Direct infrastructure impact
    if any(kw in text for kw in ["ggml", "llama.cpp", "ollama", "gguf"]):
        return "infra", "Affects our inference stack"
    if any(kw in text for kw in ["openclaw", "anthropic subscription", "max 20", "max20", "lockdown", "lock-down"]):
        return "platform", "Affects our OpenClaw/Anthropic setup"
    
    # Model evaluation candidates
    if any(kw in text for kw in ["kimi", "minimax", "qwen", "deepseek"]) and any(kw in text for kw in ["benchmark", "better", "beats", "outperform"]):
        return "eval", "New model to evaluate for HYDRA routing"
    
    # Cost/efficiency improvements
    if any(kw in text for kw in ["cost", "cheaper", "efficient", "pruning", "quantiz"]):
        return "cost", "Potential cost reduction"
    
    # Security relevant
    if any(kw in text for kw in ["security", "safety", "vulnerability", "jailbreak"]):
        return "security", "Security-relevant update"
    
    # Context/memory improvements
    if any(kw in text for kw in ["context window", "memory", "compaction", "long context"]):
        return "memory", "Relevant to our memory/context work"
    
    # New tools/capabilities
    if any(kw in text for kw in ["agent", "tool use", "function call", "mcp", "autonomous"]):
        return "capability", "New agent capability"
    
    # Hardware/inference
    if any(kw in text for kw in ["hardware", "silicon", "gpu", "inference speed", "tok/s"]):
        return "hardware", "Hardware/inference development"
    
    return None, None

actions = []
for f in findings:
    if f["relevance"] != "high":
        continue
    action_type, reason = classify_action(f)
    if action_type:
        actions.append({**f, "action_type": action_type, "action_reason": reason})

# Generate action options
ACTION_TEMPLATES = {
    "infra": [
        "A) Monitor & wait — track updates, no action yet",
        "B) Test impact — check if our Ollama/GGUF setup needs changes",
        "C) Migrate/update — pull latest and integrate now",
    ],
    "platform": [
        "A) Monitor — read thread, watch for Anthropic announcements",
        "B) Prepare contingency — test alternative auth/billing paths",
        "C) Engage — comment on thread with our experience",
    ],
    "eval": [
        "A) Skip — current HYDRA routing is working fine",
        "B) Quick test — run our murder test suite against it",
        "C) Full eval — add to HYDRA as new routing head",
    ],
    "cost": [
        "A) Bookmark — interesting but not urgent",
        "B) Prototype — test with our workload to measure savings",
        "C) Deploy — integrate into our pipeline now",
    ],
    "security": [
        "A) Note it — file in memory for awareness",
        "B) Audit — check if our safety layer covers this",
        "C) Patch — update our proxy/safety config immediately",
    ],
    "memory": [
        "A) Watch — interesting research, no action needed",
        "B) Experiment — test approach with our Qdrant/compaction",
        "C) Implement — build into our memory pipeline",
    ],
    "capability": [
        "A) Bookmark — interesting but not needed now",
        "B) Evaluate — test if it improves our agent workflow",
        "C) Integrate — add to our tool stack",
    ],
    "hardware": [
        "A) Track — note for future reference",
        "B) Benchmark — test on our RTX setup if applicable",
        "C) Invest — worth hardware/infra changes",
    ],
}

# Add action items to report
if actions:
    report.append("\n## ⚡ Action Items — What We Should Do\n")
    for i, a in enumerate(actions, 1):
        report.append(f"### {i}. {a['title'][:80]}")
        report.append(f"**Why it matters:** {a['action_reason']}")
        report.append(f"**Source:** [{a['source']}] {a['url']}")
        opts = ACTION_TEMPLATES.get(a["action_type"], ACTION_TEMPLATES["capability"])
        for opt in opts:
            report.append(f"  {opt}")
        report.append("")

# Telegram summary (concise)
high_priority = [f for f in findings if f["relevance"] == "high"]
telegram_summary = [f"**🔬 AI Research Scan — {today}**\n"]
telegram_summary.append(f"Found **{len(findings)}** items ({len(high_priority)} high-priority)\n")

if high_priority:
    telegram_summary.append("**🔥 Must-See:**")
    for f in high_priority[:8]:
        telegram_summary.append(f"• [{f['source']}] {f['title'][:80]}")
        telegram_summary.append(f"  {f['url']}")
    telegram_summary.append("")

# Skip hardcoded action items — the cron model will generate
# context-aware recommendations using our infra context

if not findings:
    telegram_summary.append("Nothing notable today. Quiet news cycle.")

telegram_summary.append(f"\n📄 Full report: `memory/research/scan_{today}.md`")

# Save report
with open(report_path, "w") as fp:
    fp.write("\n".join(report))

# Save telegram summary  
telegram_path = os.path.join(REPORT_DIR, f"telegram_{today}.txt")
with open(telegram_path, "w") as fp:
    fp.write("\n".join(telegram_summary))

# Print telegram version for cron delivery
print("\n" + "=" * 60)
print("TELEGRAM BRIEFING:")
print("=" * 60)
print("\n".join(telegram_summary))

print(f"\n✅ Reports saved to {REPORT_DIR}/")
