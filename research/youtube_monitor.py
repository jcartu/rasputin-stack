#!/usr/bin/env python3
"""
YouTube Daily Intelligence — Daily Intelligence Briefing
Scans 40+ channels across all interests, analyzes with Opus via Zen (free),
produces beautifully formatted Telegram-ready reports.

Usage:
    python3 youtube_daily_intel.py                  # Full scan + analysis
    python3 youtube_daily_intel.py --report-only    # Just format last scan
    python3 youtube_daily_intel.py --channels       # List all channels
    python3 youtube_daily_intel.py --category AI    # Scan one category only
"""

import json
import subprocess
import sys
import os
import time
import argparse
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Set, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = Path("/path/to/workspace")
INTEL_DIR = BASE_DIR / "youtube_intel"
INTEL_DIR.mkdir(exist_ok=True)
STATE_FILE = INTEL_DIR / "state.json"
REPORT_DIR = INTEL_DIR / "reports"
REPORT_DIR.mkdir(exist_ok=True)
ANALYSIS_DIR = INTEL_DIR / "analyses"
ANALYSIS_DIR.mkdir(exist_ok=True)

# ── API Config ─────────────────────────────────────────────────────────────
# Use OpenCode Zen (free Opus 4.6) for analysis — unlimited, no rate limits
ZEN_URL = "https://opencode.ai/zen/v1/messages"
ZEN_KEY = os.environ.get("OPENCODE_API_KEY", "") or os.environ.get("ZEN_OPENCODE_API_KEY", "")
if not ZEN_KEY:
    # Try loading from env files
    for env_file in [BASE_DIR / ".env", BASE_DIR / "api_keys.env"]:
        if env_file.exists():
            for line in open(env_file):
                line = line.strip()
                for prefix in ["OPENCODE_API_KEY=", "ZEN_OPENCODE_API_KEY="]:
                    if line.startswith(prefix):
                        ZEN_KEY = line.split("=", 1)[1].strip()
                        break
        if ZEN_KEY:
            break

# Also try Gemini as fallback for native YouTube analysis
# Always load Gemini key from file (env var may be stale/leaked)
GEMINI_KEY = ""
for env_file in [BASE_DIR / ".env", BASE_DIR / "api_keys.env"]:
    if env_file.exists():
        for line in open(env_file):
            line = line.strip()
            if line.startswith("GEMINI_API_KEY="):
                GEMINI_KEY = line.split("=", 1)[1].strip()
                break
    if GEMINI_KEY:
        break
if not GEMINI_KEY:
    GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

# ── Channel Database ───────────────────────────────────────────────────────
# Organized by user interest categories
CHANNELS = {
    # ═══════════════════════════════════════════════════════════════════
    # 🤖 AI/ML — Model releases, agent building, infrastructure
    # ═══════════════════════════════════════════════════════════════════
    "Matthew Berman":     {"handle": "@matthew_berman",    "cat": "AI", "tier": 1, "focus": "First to cover model drops, AI product reviews"},
    "Fireship":           {"handle": "@Fireship",          "cat": "AI", "tier": 1, "focus": "Fastest AI/dev news turnaround, viral format"},
    "AI Explained":       {"handle": "@AIExplained-",      "cat": "AI", "tier": 1, "focus": "Deep technical analysis of research papers"},
    "Wes Roth":           {"handle": "@WesRoth",           "cat": "AI", "tier": 1, "focus": "AI news, AGI discourse, industry moves"},
    "NetworkChuck":       {"handle": "@NetworkChuck",      "cat": "AI", "tier": 1, "focus": "AI infra, Claude Code, self-hosting, networking"},
    "Two Minute Papers":  {"handle": "@TwoMinutePapers",   "cat": "AI", "tier": 1, "focus": "Research paper summaries with demos"},
    "AllAboutAI":         {"handle": "@AllAboutAI",        "cat": "AI", "tier": 2, "focus": "Agent demos, browser automation, Claude Code"},
    "IndyDevDan":         {"handle": "@indydevdan",        "cat": "AI", "tier": 2, "focus": "Advanced Claude Code, agent teams, orchestration"},
    "Cole Medin":         {"handle": "@ColeMedin",         "cat": "AI", "tier": 2, "focus": "OpenClaw ecosystem, agents, MCP, skills"},
    "AI Jason":           {"handle": "@AIJasonZ",          "cat": "AI", "tier": 2, "focus": "Agent architectures, RAG, memory systems"},
    "Sam Witteveen":      {"handle": "@samwitteveenai",    "cat": "AI", "tier": 2, "focus": "Gemini API, Google AI, model comparisons"},
    "Dave Ebbelaar":      {"handle": "@daveebbelaar",      "cat": "AI", "tier": 2, "focus": "AI engineering, production deployments"},
    "Matt Williams":      {"handle": "@techabortwilliams", "cat": "AI", "tier": 2, "focus": "Ollama internals, local LLM hosting"},
    "David Ondrej":       {"handle": "@davidondrej",       "cat": "AI", "tier": 2, "focus": "OpenClaw power-user, 10x productivity"},
    "Yannic Kilcher":     {"handle": "@YannicKilcher",     "cat": "AI", "tier": 3, "focus": "ML research papers, academic rigor"},
    "David Shapiro":      {"handle": "@DaveShap",          "cat": "AI", "tier": 3, "focus": "AI philosophy, autonomous agents, AGI"},
    "Latent Space":       {"handle": "@LatentSpaceTV",     "cat": "AI", "tier": 3, "focus": "AI engineering podcast, deep technical"},
    "Anthropic":          {"handle": "@anthropic-ai",      "cat": "AI", "tier": 3, "focus": "Official Claude releases, safety research"},
    "Google DeepMind":    {"handle": "@Google_DeepMind",   "cat": "AI", "tier": 3, "focus": "Gemini updates, research breakthroughs"},
    "OpenAI":             {"handle": "@OpenAI",            "cat": "AI", "tier": 3, "focus": "GPT/Codex updates, agent features"},
    "Theo - t3.gg":       {"handle": "@t3dotgg",           "cat": "AI", "tier": 3, "focus": "Web dev + AI hot takes, dev tooling"},
    "3Blue1Brown":        {"handle": "@3blue1brown",       "cat": "AI", "tier": 3, "focus": "Math/ML fundamentals — rare but gold"},
    "Andrej Karpathy":    {"handle": "@AndrejKarpathy",    "cat": "AI", "tier": 3, "focus": "Former Tesla/OpenAI — always must-watch"},

    # ═══════════════════════════════════════════════════════════════════
    # 📱 TECH/GADGETS — Biggest interest category (47.9%)
    # ═══════════════════════════════════════════════════════════════════
    "MKBHD":              {"handle": "@mkbhd",              "cat": "Tech", "tier": 1, "focus": "Flagship reviews, new product launches"},
    "Linus Tech Tips":    {"handle": "@LinusTechTips",      "cat": "Tech", "tier": 1, "focus": "PC hardware, GPUs, networking, builds"},
    "Dave2D":             {"handle": "@Dave2D",             "cat": "Tech", "tier": 2, "focus": "Laptop/phone reviews, clean analysis"},
    "Unbox Therapy":      {"handle": "@UnboxTherapy",       "cat": "Tech", "tier": 2, "focus": "New gadgets, first looks, accessories"},
    "JerryRigEverything": {"handle": "@JerryRigEverything", "cat": "Tech", "tier": 2, "focus": "Teardowns, durability tests"},
    "Gamers Nexus":       {"handle": "@GamersNexus",        "cat": "Tech", "tier": 2, "focus": "GPU/CPU benchmarks, thermals, PC hardware"},
    "JayzTwoCents":       {"handle": "@JayzTwoCents",       "cat": "Tech", "tier": 3, "focus": "PC builds, water cooling, GPU mods"},
    "SuperSaf":           {"handle": "@SuperSaf",           "cat": "Tech", "tier": 3, "focus": "Phone comparisons, camera shootouts"},

    # ═══════════════════════════════════════════════════════════════════
    # 🏎️ CARS — Ferrari/Porsche/BMW focus (11.1%)
    # ═══════════════════════════════════════════════════════════════════
    "Doug DeMuro":        {"handle": "@DougDeMuro",         "cat": "Cars", "tier": 1, "focus": "Quirks & features, exotic car reviews"},
    "savagegeese":        {"handle": "@savagegeese",        "cat": "Cars", "tier": 2, "focus": "In-depth car engineering analysis"},
    "AutoTopNL":          {"handle": "@AutoTopNL",          "cat": "Cars", "tier": 2, "focus": "Autobahn top speed runs, POV drives"},
    "Car Throttle":       {"handle": "@CarThrottle",        "cat": "Cars", "tier": 3, "focus": "Car culture, challenges, entertainment"},

    # ═══════════════════════════════════════════════════════════════════
    # 🌍 GEOPOLITICS — Second biggest interest (26.7%)
    # ═══════════════════════════════════════════════════════════════════
    "RealLifeLore":       {"handle": "@RealLifeLore",              "cat": "Geopolitics", "tier": 1, "focus": "Geopolitical explainers, maps, conflict analysis"},
    "CaspianReport":      {"handle": "@CaspianReport",            "cat": "Geopolitics", "tier": 1, "focus": "Deep geopolitical analysis, Russia/Central Asia"},
    "PolyMatter":         {"handle": "@PolyMatter",               "cat": "Geopolitics", "tier": 2, "focus": "Economics, business strategy, country analysis"},
    "Patrick Boyle":      {"handle": "@PBoyle",                   "cat": "Geopolitics", "tier": 2, "focus": "Finance, markets, geopolitical economics"},

    # ═══════════════════════════════════════════════════════════════════
    # 💪 HEALTH/BIOHACKING
    # ═══════════════════════════════════════════════════════════════════
    "Huberman Lab":       {"handle": "@hubabortwilliams",  "cat": "Health", "tier": 2, "focus": "Neuroscience, sleep, hormones, protocols"},
    "More Plates More Dates": {"handle": "@moreplatesmoredates", "cat": "Health", "tier": 2, "focus": "Hormones, peptides, body composition, TRT"},

    # ═══════════════════════════════════════════════════════════════════
    # 💰 CRYPTO
    # ═══════════════════════════════════════════════════════════════════
    "Coin Bureau":        {"handle": "@CoinBureau",        "cat": "Crypto", "tier": 2, "focus": "Crypto analysis, market trends, DeFi"},
}

# Total: ~45 channels

# ── State Management ───────────────────────────────────────────────────────

INSIGHTS_FILE = INTEL_DIR / "delivered_insights.json"

def load_state() -> Dict:
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"seen": {}, "last_scan": None, "total_analyzed": 0}

def save_state(state: Dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def load_delivered_insights() -> List[str]:
    """Load previously delivered insights to avoid repetition."""
    if INSIGHTS_FILE.exists():
        with open(INSIGHTS_FILE) as f:
            data = json.load(f)
        # Keep last 7 days of insights (rolling window)
        cutoff = (datetime.now() - timedelta(days=7)).isoformat()
        fresh = [i for i in data if i.get("date", "") >= cutoff]
        return [i["insight"] for i in fresh]
    return []

def save_delivered_insights(new_insights: List[str]):
    """Append new insights and prune old ones (>7 days)."""
    existing = []
    if INSIGHTS_FILE.exists():
        with open(INSIGHTS_FILE) as f:
            existing = json.load(f)
    cutoff = (datetime.now() - timedelta(days=7)).isoformat()
    existing = [i for i in existing if i.get("date", "") >= cutoff]
    today = datetime.now().isoformat()
    for insight in new_insights:
        existing.append({"insight": insight, "date": today})
    with open(INSIGHTS_FILE, "w") as f:
        json.dump(existing, f, indent=2)

# ── Video Discovery ────────────────────────────────────────────────────────

def discover_channel(name: str, info: Dict, max_videos: int = 3) -> List[Dict]:
    """Fetch recent videos from a channel using yt-dlp."""
    handle = info["handle"]
    url = f"https://www.youtube.com/{handle}/videos"
    try:
        result = subprocess.run(
            ["yt-dlp", "--flat-playlist", "--playlist-end", str(max_videos),
             "--dump-json", "--no-warnings", url],
            capture_output=True, text=True, timeout=30
        )
        videos = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                data = json.loads(line)
                videos.append({
                    "id": data.get("id", ""),
                    "title": data.get("title", "Unknown"),
                    "channel": name,
                    "category": info["cat"],
                    "tier": info["tier"],
                    "url": f"https://www.youtube.com/watch?v={data.get('id', '')}",
                    "duration": data.get("duration"),
                    "upload_date": data.get("upload_date", ""),
                })
            except json.JSONDecodeError:
                continue
        return videos
    except subprocess.TimeoutExpired:
        return []
    except Exception as e:
        print(f"  ⚠️ {name}: {e}")
        return []

def get_transcript(video_id: str) -> Optional[str]:
    """Get video transcript using yt-dlp auto-subtitles."""
    try:
        tmp_base = f"/tmp/yt_intel_{video_id}"
        result = subprocess.run(
            ["yt-dlp", "--write-auto-sub", "--sub-lang", "en",
             "--skip-download", "--sub-format", "vtt", "--no-warnings",
             "-o", tmp_base, f"https://www.youtube.com/watch?v={video_id}"],
            capture_output=True, text=True, timeout=60
        )
        # Find the subtitle file
        for ext in [".en.vtt", ".en.json3", ".en.srt"]:
            sub_file = f"{tmp_base}{ext}"
            if os.path.exists(sub_file):
                with open(sub_file) as f:
                    content = f.read()
                os.remove(sub_file)
                # Clean VTT format — strip timestamps and tags
                lines = []
                for line in content.split("\n"):
                    line = line.strip()
                    if not line or line.startswith("WEBVTT") or "-->" in line:
                        continue
                    if line.startswith("NOTE") or line.startswith("Kind:") or line.startswith("Language:"):
                        continue
                    # Strip HTML tags
                    import re
                    line = re.sub(r"<[^>]+>", "", line)
                    if line and line not in lines[-1:]:  # Dedup consecutive
                        lines.append(line)
                text = " ".join(lines)
                # Limit to ~15K chars (~4K tokens) to keep analysis focused
                return text[:15000]
        return None
    except Exception:
        return None

# ── Analysis via Gemini native video URL ───────────────────────────────────

GEMINI_MODEL = "gemini-3-flash-preview"  # Latest Flash — native video analysis
GEMINI_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

ANALYSIS_PROMPT = """Analyze this YouTube video for the daily intelligence briefing.

**Context about us:**
- We run an autonomous AI agent (RASPUTIN) on a server with RTX PRO 6000 96GB + RTX 5090 32GB, 251GB RAM
- Running Ollama with Qwen 72B + Qwen Coder 30B locally, Claude Opus 4.6 via API proxy
- We use OpenClaw agent framework, Qdrant vector DB + FalkorDB graph DB for memory (133K memories)
- User runs a technology-focused business
- We care about: local LLM inference speedups, new open-source models, agent frameworks, vLLM/inference optimization, GPU utilization, MCP servers, AI coding tools, crypto/DeFi, health/biohacking, supercars, home theater

Provide a structured analysis:

1. **TL;DR** (1-2 sentences — the core takeaway)
2. **Key Points** (3-5 bullet points of the most important information)
3. **Relevance to Us** (Be SPECIFIC: name the exact tool/model/technique and how it applies to our setup. "This is interesting" is NOT acceptable — say "We should pull model X because it would replace Y and give us Z improvement" or "Not relevant to us.")
4. **Action Items** (Concrete next steps: "Pull model X", "Switch from Ollama to vLLM", "Test tool Y", "Add channel Z to monitoring". If nothing actionable: "None — informational only")
5. **Priority** (🔴 Act today | 🟡 This week | ⚪ Informational)

**ANTI-REPETITION RULES — CRITICAL:**
These insights have ALREADY been reported in recent briefings. DO NOT repeat them:
{already_reported}

If this video covers the same ground as an already-reported insight, your "Relevance to Us" should say "Covered in previous briefing — [topic]" and your Action Items should say "None — already actioned."
Only flag NEW, SPECIFIC, UNREPORTED insights. Generic advice like "use Opus for complex tasks" or "keep Qwen for speed" is BANNED.

Be concise and direct. No filler. Think like a CTO advising on infrastructure upgrades."""


def analyze_video_native(video: Dict, already_reported: str = "") -> Optional[Dict]:
    """Analyze a video using Gemini's native YouTube URL support — watches the actual video."""
    if not GEMINI_KEY:
        print("  ❌ No GEMINI_API_KEY — can't analyze")
        return None

    import urllib.request

    video_url = video["url"]
    filled_prompt = ANALYSIS_PROMPT.replace("{already_reported}", already_reported or "None yet — this is the first scan.")
    prompt = f"Video: {video['title']} by {video['channel']} ({video['category']})\n\n{filled_prompt}"

    body = json.dumps({
        "contents": [{
            "parts": [
                {"fileData": {"fileUri": video_url}},
                {"text": prompt}
            ]
        }],
        "generationConfig": {"maxOutputTokens": 2000, "temperature": 0.3}
    }).encode()

    req = urllib.request.Request(
        f"{GEMINI_API_URL}?key={GEMINI_KEY}",
        data=body,
        headers={"content-type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
            candidates = data.get("candidates", [])
            if not candidates:
                print(f"  ❌ Gemini returned no candidates")
                return None
            parts = candidates[0].get("content", {}).get("parts", [])
            analysis = "\n".join(p.get("text", "") for p in parts)
            usage = data.get("usageMetadata", {})
            return {
                "video_id": video["id"],
                "title": video["title"],
                "channel": video["channel"],
                "category": video["category"],
                "tier": video["tier"],
                "url": video["url"],
                "analysis": analysis,
                "analyzed_at": datetime.now().isoformat(),
                "model": GEMINI_MODEL,
                "tokens": {
                    "input": usage.get("promptTokenCount", 0),
                    "output": usage.get("candidatesTokenCount", 0),
                },
            }
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:300]
        print(f"  ❌ Gemini HTTP {e.code}: {err_body[:120]}")
        # Fallback to transcript-based analysis if native URL fails
        return analyze_video_transcript_fallback(video)
    except Exception as e:
        print(f"  ❌ Gemini native failed: {e}")
        return analyze_video_transcript_fallback(video)


def analyze_video_transcript_fallback(video: Dict) -> Optional[Dict]:
    """Fallback: analyze via transcript if native video URL fails."""
    import urllib.request

    transcript = get_transcript(video["id"])
    if not transcript:
        print(f"    ⚠️ No transcript either — skipping")
        return None

    print(f"    📝 Falling back to transcript ({len(transcript)} chars)")
    prompt = f"Video: {video['title']} by {video['channel']} ({video['category']})\n\nTranscript:\n{transcript[:15000]}\n\n{ANALYSIS_PROMPT}"

    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 2000, "temperature": 0.3}
    }).encode()

    req = urllib.request.Request(
        f"{GEMINI_API_URL}?key={GEMINI_KEY}",
        data=body,
        headers={"content-type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read())
            candidates = data.get("candidates", [])
            if not candidates:
                return None
            parts = candidates[0].get("content", {}).get("parts", [])
            analysis = "\n".join(p.get("text", "") for p in parts)
            usage = data.get("usageMetadata", {})
            return {
                "video_id": video["id"],
                "title": video["title"],
                "channel": video["channel"],
                "category": video["category"],
                "tier": video["tier"],
                "url": video["url"],
                "analysis": analysis + "\n\n_[Analyzed from transcript — native video URL unavailable]_",
                "analyzed_at": datetime.now().isoformat(),
                "model": f"{GEMINI_MODEL} (transcript fallback)",
                "tokens": {
                    "input": usage.get("promptTokenCount", 0),
                    "output": usage.get("candidatesTokenCount", 0),
                },
            }
    except Exception as e:
        print(f"    ❌ Transcript fallback also failed: {e}")
        return None

# ── Report Generation ──────────────────────────────────────────────────────

def generate_report(analyses: List[Dict], scan_stats: Dict) -> str:
    """Generate beautifully formatted Telegram-ready report."""
    today = datetime.now().strftime("%A, %B %d")
    
    report = f"""🎬 **YouTube Intelligence Briefing**
📅 {today} | 📺 {scan_stats['channels_scanned']} channels | 🆕 {scan_stats['new_videos']} new | 🧠 {scan_stats['analyzed']} analyzed

"""
    
    # Group by category
    by_cat: Dict[str, List[Dict]] = {}
    for a in analyses:
        cat = a["category"]
        by_cat.setdefault(cat, []).append(a)
    
    cat_emoji = {
        "AI": "🤖", "Tech": "📱", "Cars": "🏎️", 
        "Geopolitics": "🌍", "Health": "💪", "Crypto": "💰",
    }
    
    # Sort categories: AI first, then by number of videos
    cat_order = ["AI", "Tech", "Cars", "Geopolitics", "Health", "Crypto"]
    
    for cat in cat_order:
        if cat not in by_cat:
            continue
        items = by_cat[cat]
        emoji = cat_emoji.get(cat, "📌")
        report += f"\n{'═' * 40}\n{emoji} **{cat.upper()}** ({len(items)} videos)\n{'═' * 40}\n\n"
        
        # Sort by tier (most important first)
        items.sort(key=lambda x: x["tier"])
        
        for a in items:
            tier_badge = "🔴" if a["tier"] == 1 else "🟡" if a["tier"] == 2 else "⚪"
            report += f"{tier_badge} **{a['title']}**\n"
            report += f"📺 {a['channel']} | [Watch]({a['url']})\n\n"
            report += f"{a['analysis']}\n\n"
            report += f"{'─' * 30}\n\n"
    
    if not analyses:
        report += "No new videos found across all channels. Quiet day.\n"
    
    return report

# ── Main Scan ──────────────────────────────────────────────────────────────

def run_scan(category_filter: Optional[str] = None, max_videos_per_channel: int = 3,
             force: bool = False, report_only: bool = False):
    """Main scan + analyze + report pipeline."""
    
    state = load_state()
    seen = set(state.get("seen", {}).keys()) if isinstance(state.get("seen"), dict) else set(state.get("seen", []))
    
    if report_only:
        # Just load today's analyses and regenerate report
        today = datetime.now().strftime("%Y-%m-%d")
        analyses = []
        for f in ANALYSIS_DIR.glob(f"{today}_*.json"):
            with open(f) as fh:
                analyses.append(json.load(fh))
        stats = {"channels_scanned": len(CHANNELS), "new_videos": len(analyses), "analyzed": len(analyses)}
        report = generate_report(analyses, stats)
        report_file = REPORT_DIR / f"{today}_briefing.md"
        with open(report_file, "w") as f:
            f.write(report)
        print(report)
        return report
    
    print("=" * 60)
    print(f"🎬 YouTube Daily Intelligence Scanner")
    print(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"📺 {len(CHANNELS)} channels | Categories: {', '.join(set(c['cat'] for c in CHANNELS.values()))}")
    print("=" * 60)
    
    # Filter channels if category specified
    channels = CHANNELS
    if category_filter:
        channels = {k: v for k, v in CHANNELS.items() if v["cat"].lower() == category_filter.lower()}
        print(f"🔍 Filtered to {len(channels)} channels in '{category_filter}'")
    
    # Phase 1: Discover new videos (parallel)
    all_new_videos = []
    
    print(f"\n📡 Phase 1: Discovering videos...")
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {}
        for name, info in channels.items():
            futures[executor.submit(discover_channel, name, info, max_videos_per_channel)] = name
        
        for future in as_completed(futures):
            name = futures[future]
            try:
                videos = future.result()
                new = [v for v in videos if v["id"] not in seen or force]
                if new:
                    print(f"  🟢 {name}: {len(new)} new")
                    all_new_videos.extend(new)
                else:
                    print(f"  ⚪ {name}: up to date")
            except Exception as e:
                print(f"  ❌ {name}: {e}")
    
    print(f"\n📊 Found {len(all_new_videos)} new videos across {len(channels)} channels")
    
    if not all_new_videos:
        print("Nothing new. Done.")
        state["last_scan"] = datetime.now().isoformat()
        save_state(state)
        return "No new videos found."
    
    # Phase 2: Get transcripts + analyze (sequential to avoid rate limits)
    print(f"\n🧠 Phase 2: Analyzing videos...")
    analyses = []
    
    # Prioritize: Tier 1 first, then 2, then 3
    all_new_videos.sort(key=lambda v: v["tier"])
    
    # Cap at 40 videos per scan — we want ALL videos analyzed
    scan_batch = all_new_videos[:40]
    if len(all_new_videos) > 40:
        print(f"  ⚠️ Capping at 40 videos (skipping {len(all_new_videos) - 40} lower-priority)")
    
    MAX_RUNTIME = 900  # 15-minute wall-clock limit — give Gemini time to analyze everything
    phase2_start = time.time()

    # Load previously delivered insights for anti-repetition
    prev_insights = load_delivered_insights()
    already_reported_str = "\n".join(f"- {ins}" for ins in prev_insights[-30:]) if prev_insights else ""

    def analyze_one(video):
        """Analyze a single video via Gemini native video URL; returns (video, result_or_None)."""
        if time.time() - phase2_start > MAX_RUNTIME:
            print(f"  ⏱️ Time limit reached — skipping {video['channel']}: {video['title'][:40]}")
            return video, None
        print(f"\n  🎥 {video['channel']}: {video['title'][:60]}...")
        result = analyze_video_native(video, already_reported=already_reported_str)
        if result:
            analysis_file = ANALYSIS_DIR / f"{datetime.now().strftime('%Y-%m-%d')}_{video['id']}.json"
            with open(analysis_file, "w") as f:
                json.dump(result, f, indent=2)
            print(f"    ✅ {video['channel']} done ({result.get('model', 'unknown')})")
        return video, result

    # Run analysis in parallel (6 workers — Gemini Flash has generous rate limits)
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(analyze_one, video): video for video in scan_batch}
        for future in as_completed(futures):
            try:
                video, result = future.result()
                if result:
                    analyses.append(result)
                # Mark as seen regardless (avoid re-processing failed videos)
                if isinstance(state.get("seen"), dict):
                    state["seen"][video["id"]] = {"title": video["title"], "date": datetime.now().isoformat()}
                elif isinstance(state.get("seen"), list):
                    state["seen"] = {vid: {} for vid in state["seen"]}
                    state["seen"][video["id"]] = {"title": video["title"], "date": datetime.now().isoformat()}
            except Exception as e:
                print(f"    ❌ Analysis error: {e}")
    
    # Phase 3: Generate report — ONLY this run's new analyses (no repeating earlier scans)
    print(f"\n📝 Phase 3: Generating report...")
    today = datetime.now().strftime("%Y-%m-%d")

    print(f"   📊 This run: {len(analyses)} new videos analyzed")

    if not analyses:
        print("   ℹ️ No new videos to report.")
        state["last_scan"] = datetime.now().isoformat()
        save_state(state)
        report = f"🎬 YouTube Intel — {today}\n\nNo new videos since last scan. All {len(CHANNELS)} channels checked."
        report_file = REPORT_DIR / f"{today}_briefing.md"
        with open(report_file, "w") as f:
            f.write(report)
        print("\n" + report)
        return report

    stats = {
        "channels_scanned": len(channels),
        "new_videos": len(all_new_videos),
        "analyzed": len(analyses),
    }

    report = generate_report(analyses, stats)

    report_file = REPORT_DIR / f"{today}_briefing.md"
    with open(report_file, "w") as f:
        f.write(report)

    # Extract and save key insights for anti-repetition in future scans
    new_insights = []
    for a in analyses:
        analysis_text = a.get("analysis", "")
        # Extract action items and relevance lines as "insights"
        for line in analysis_text.split("\n"):
            line = line.strip().lstrip("*- ")
            if any(kw in line.lower() for kw in ["we should", "pull model", "switch to", "update openclaw", 
                    "configure rasputin", "act today", "this week", "route.*task", "escalate"]):
                if len(line) > 20 and "already" not in line.lower():
                    new_insights.append(line[:200])
    # Also add video titles as "covered topics"
    for a in analyses:
        new_insights.append(f"Video covered: {a.get('title', '')[:100]} by {a.get('channel', '')}")
    if new_insights:
        save_delivered_insights(new_insights)
        print(f"   💾 Saved {len(new_insights)} insights for anti-repetition")
    
    # Update state
    state["last_scan"] = datetime.now().isoformat()
    state["total_analyzed"] = state.get("total_analyzed", 0) + len(analyses)  # only count new ones
    save_state(state)
    
    print(f"\n{'=' * 60}")
    print(f"✅ Scan complete!")
    print(f"   📺 {len(channels)} channels scanned")
    print(f"   🆕 {len(all_new_videos)} new videos found")
    print(f"   🧠 {len(analyses)} analyzed with Opus")
    print(f"   📄 Report: {report_file}")
    print(f"{'=' * 60}")
    
    # Print the report
    print("\n" + report)
    
    return report

# ── CLI ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YouTube Daily Intelligence")
    parser.add_argument("--report-only", action="store_true", help="Regenerate report from today's analyses")
    parser.add_argument("--channels", action="store_true", help="List all monitored channels")
    parser.add_argument("--category", type=str, help="Scan one category only (AI, Tech, Cars, etc.)")
    parser.add_argument("--max-videos", type=int, default=3, help="Max videos per channel (default: 3)")
    parser.add_argument("--force", action="store_true", help="Re-analyze already-seen videos")
    args = parser.parse_args()
    
    if args.channels:
        cats = {}
        for name, info in CHANNELS.items():
            cats.setdefault(info["cat"], []).append((name, info))
        for cat, channels in sorted(cats.items()):
            print(f"\n{'═' * 40}")
            print(f"  {cat} ({len(channels)} channels)")
            print(f"{'═' * 40}")
            for name, info in sorted(channels, key=lambda x: x[1]["tier"]):
                tier_badge = "🔴T1" if info["tier"] == 1 else "🟡T2" if info["tier"] == 2 else "⚪T3"
                print(f"  {tier_badge} {name} ({info['handle']}) — {info['focus']}")
        print(f"\nTotal: {len(CHANNELS)} channels")
        sys.exit(0)
    
    run_scan(
        category_filter=args.category,
        max_videos_per_channel=args.max_videos,
        force=args.force,
        report_only=args.report_only,
    )
