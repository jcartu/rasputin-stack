#!/usr/bin/env python3
"""Grok Social Intelligence Scanner v2 — Deduped, 3x/day, smarter.

Key changes from v1:
- Tracks seen X post IDs across scans (dedup)
- Content hashing to detect recycled responses
- Auto-updates recent-headlines.md
- Scans all topics every run (no rotation) — runs 3x/day not 8x
- Only outputs genuinely new findings
"""

import os
import sys
import json
import time
import hashlib
import re
import requests
from datetime import datetime, timezone
from pathlib import Path

# Config
XAI_API_KEY = os.environ.get("XAI_API_KEY", "")
MODEL = "grok-4-fast-non-reasoning"
WORKSPACE = Path(os.path.expanduser("/path/to/workspace"))
INTEL_DIR = WORKSPACE / "memory" / "intel"
STATE_FILE = WORKSPACE / "memory" / "intel" / "scan_state.json"
HEADLINES_FILE = WORKSPACE / "memory" / "recent-headlines.md"

# ─────────────────────────────────────────────
# Dedup State
# ─────────────────────────────────────────────
def load_state():
    """Load scan state: seen post IDs, content hashes, last scan results."""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except:
            pass
    return {
        "seen_post_ids": [],      # X post IDs we've already reported
        "content_hashes": {},     # category -> hash of last response
        "last_scan": None,
        "scan_count": 0,
    }

def save_state(state):
    """Save scan state. Keep last 2000 post IDs to avoid unbounded growth."""
    state["seen_post_ids"] = state["seen_post_ids"][-2000:]
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))

def extract_post_ids(text):
    """Extract X/Twitter post IDs from URLs in text."""
    # Match patterns like x.com/i/status/1234567890 or twitter.com/user/status/1234567890
    ids = set()
    patterns = [
        r'(?:x\.com|twitter\.com)/\w+/status/(\d{15,25})',
        r'(?:x\.com)/i/status/(\d{15,25})',
        r'post[_ ]?(?:id|ID)[:\s]*(\d{15,25})',
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            ids.add(match.group(1))
    return ids

def content_hash(text):
    """Hash the meaningful content, ignoring timestamps and formatting."""
    # Normalize: lowercase, strip whitespace, remove dates/times
    normalized = text.lower().strip()
    normalized = re.sub(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}', '', normalized)
    normalized = re.sub(r'\s+', ' ', normalized)
    return hashlib.md5(normalized[:5000].encode()).hexdigest()

# ─────────────────────────────────────────────
# Topics — grouped for efficient scanning
# ─────────────────────────────────────────────
TOPICS = [
    # Example topic clusters — customize for your domain
    {
        "query": """Search for the LATEST posts (last 8 hours) about:
1. Industry regulation changes, enforcement actions
2. Mentions of key competitors or partners
3. Payment processing issues or new payment rails
Only include posts from the LAST 8 HOURS.""",
        "category": "industry_regulation"
    },
    {
        "query": """Search for LATEST developments (last 8 hours) about:
1. AI/ML infrastructure news (new models, frameworks, benchmarks)
2. Developer tooling updates
3. Cloud provider changes""",
        "category": "tech_developments"
    },
]

# ─────────────────────────────────────────────
# Grok API
# ─────────────────────────────────────────────
def call_grok(query, seen_ids=None):
    """Call Grok with dedup context."""
    headers = {
        "Authorization": f"Bearer {XAI_API_KEY}",
        "Content-Type": "application/json"
    }
    
    # Add dedup instruction if we have seen IDs
    dedup_note = ""
    if seen_ids:
        # Pass last 100 IDs to help Grok skip known posts
        recent_ids = list(seen_ids)[-100:]
        dedup_note = f"\n\nIMPORTANT: Skip these already-reported post IDs (do not include them): {', '.join(recent_ids[-50:])}"
    
    payload = {
        "model": MODEL,
        "tools": [{"type": "x_search"}, {"type": "web_search"}],
        "input": query + dedup_note,
        "instructions": (
            "You are a real-time intelligence analyst. Search X/Twitter for LIVE data from the LAST 8 HOURS ONLY. "
            "Provide concise, actionable summaries. Include specific usernames, post dates, links with full post IDs, "
            "and engagement numbers. If there is NOTHING genuinely new in the last 8 hours for a subtopic, say "
            "'NO NEW POSTS' for that subtopic — do NOT pad with older content. Quality over quantity."
        )
    }
    
    try:
        resp = requests.post("https://api.x.ai/v1/responses", headers=headers, json=payload, timeout=90)
        resp.raise_for_status()
        data = resp.json()
        
        text_parts = []
        for item in data.get("output", []):
            if item.get("type") == "message":
                for c in item.get("content", []):
                    if c.get("type") == "output_text":
                        text_parts.append(c["text"])
        
        return "\n".join(text_parts) if text_parts else None
    except Exception as e:
        print(f"  ERROR calling Grok: {e}", file=sys.stderr)
        return None

# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────
def main():
    timestamp = datetime.now(timezone.utc).isoformat()
    local_time = datetime.now().strftime("%H:%M")
    hour = int(datetime.now().strftime("%H"))
    is_morning = 6 <= hour <= 10
    
    print(f"=== Grok Social Intel v2 — {timestamp} (local {local_time}) ===")
    
    state = load_state()
    seen_ids = set(state.get("seen_post_ids", []))
    old_hashes = state.get("content_hashes", {})
    
    # Filter topics — lifestyle only in morning
    topics = [t for t in TOPICS if not t.get("morning_only") or is_morning]
    
    print(f"Scanning {len(topics)} topics. {len(seen_ids)} known post IDs in dedup cache.")
    
    results = []
    new_findings = []
    
    for i, topic in enumerate(topics):
        cat = topic["category"]
        print(f"\n[{i+1}/{len(topics)}] {cat}...")
        
        result = call_grok(topic["query"], seen_ids)
        if not result:
            print("  SKIP (no result)")
            continue
        
        print(f"  Got {len(result)} chars")
        
        # Extract post IDs from this result
        new_ids = extract_post_ids(result)
        truly_new_ids = new_ids - seen_ids
        print(f"  Post IDs: {len(new_ids)} found, {len(truly_new_ids)} genuinely new")
        
        # Content hash check
        h = content_hash(result)
        old_h = old_hashes.get(cat)
        is_recycled = (h == old_h) and old_h is not None
        
        if is_recycled:
            print("  ⚠️ RECYCLED — content hash matches previous scan, skipping")
            continue
        
        # Check if "NO NEW POSTS" dominates the response
        no_new_count = result.lower().count("no new posts") + result.lower().count("no new developments") + result.lower().count("nothing new")
        subtopic_count = max(1, result.count("1.") + result.count("2.") + result.count("3."))
        
        if no_new_count >= subtopic_count:
            print(f"  ⚠️ DRY — Grok says no new posts across {no_new_count} subtopics")
            # Still update state so we track the hash
            state["content_hashes"][cat] = h
            continue
        
        # Has new content
        results.append({"category": cat, "content": result})
        seen_ids.update(new_ids)
        state["content_hashes"][cat] = h
        
        # Track new findings for summary
        if truly_new_ids:
            new_findings.append(f"{cat}: {len(truly_new_ids)} new posts")
        
        # Rate limit
        if i < len(topics) - 1:
            time.sleep(2)
    
    # Update state
    state["seen_post_ids"] = list(seen_ids)
    state["last_scan"] = timestamp
    state["scan_count"] = state.get("scan_count", 0) + 1
    save_state(state)
    
    # Write to daily intel file — only new content
    if results:
        INTEL_DIR.mkdir(parents=True, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        scan_time = datetime.now().strftime("%H:%M MSK")
        intel_file = INTEL_DIR / f"{date_str}.md"
        
        with open(intel_file, "a") as f:
            f.write(f"\n## Scan {scan_time} (v2)\n\n")
            for r in results:
                f.write(f"### {r['category']}\n{r['content']}\n\n")
        
        print(f"\n✅ Scan complete. {len(results)}/{len(topics)} topics had new content.")
        print(f"   New findings: {', '.join(new_findings) if new_findings else 'incremental updates'}")
        print(f"   Written to {intel_file}")
    else:
        print(f"\n⚡ Scan complete. NO new content across {len(topics)} topics.")
        print("   All responses were recycled or empty. Nothing written.")

if __name__ == "__main__":
    main()
