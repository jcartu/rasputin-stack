#!/usr/bin/env python3
"""
Fast Hot Commit — Extract facts from recent sessions without LLM.
Uses simple heuristics to find new facts and batch commits them.
"""

import json
import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime, timedelta

SESSIONS_DIR = Path.home() / ".openclaw/agents/main/sessions"
LOG_FILE = "/tmp/hot_commit_log.txt"

def get_recent_sessions(minutes=120, max_files=5):
    """Get most recently modified session files."""
    now = datetime.now()
    cutoff = now - timedelta(minutes=minutes)
    
    files = []
    for f in SESSIONS_DIR.glob("*.jsonl"):
        mtime = datetime.fromtimestamp(f.stat().st_mtime)
        if mtime > cutoff:
            files.append((f, mtime))
    
    # Sort by mtime descending and take top N
    files.sort(key=lambda x: x[1], reverse=True)
    return [f for f, _ in files[:max_files]]


def extract_facts_from_session(filepath):
    """Extract potential facts from session without LLM."""
    facts = []
    
    try:
        with open(filepath) as f:
            lines = f.readlines()
    except:
        return facts
    
    # Look for fact-like patterns in assistant messages
    current_role = None
    buffer = []
    
    for line in lines[-500:]:  # Read last 500 lines only
        try:
            d = json.loads(line.strip())
        except:
            continue
        
        msg = d.get("message", {})
        role = msg.get("role", "")
        content = msg.get("content", "")
        
        if isinstance(content, list):
            parts = []
            for c in content:
                if isinstance(c, dict):
                    parts.append(c.get("text", str(c)))
                else:
                    parts.append(str(c))
            content = " ".join(parts)
        elif isinstance(content, dict):
            content = content.get("text", str(content))
        
        if role == "user":
            # User statements that look like facts
            if any(kw in content.lower() for kw in ["i am", "i'm", "i have", "i want", "decided", "let's", 
                                                      "starting", "changed", "new", "update", "my "]):
                if len(content) > 20 and len(content) < 300:
                    facts.append({
                        "text": f"User states: {content[:200]}",
                        "source": str(filepath.name),
                        "timestamp": d.get("timestamp", "")
                    })
        elif role == "assistant":
            # Assistant summaries or confirmations
            if any(kw in content.lower() for kw in ["noted", "recorded", "added to memory", 
                                                      "fact", "remembered", "logged"]):
                if len(content) > 30:
                    facts.append({
                        "text": f"Assistant notes: {content[:200]}",
                        "source": str(filepath.name),
                        "timestamp": d.get("timestamp", "")
                    })
    
    return facts


def check_if_exists(fact_text):
    """Check if fact already exists in Second Brain."""
    try:
        # Truncate for search
        search_q = fact_text[:100].split()[:20]
        search_q = " ".join(search_q)
        
        result = subprocess.run(
            ["curl", "-s", f"http://localhost:7777/search?q={search_q}&limit=3"],
            capture_output=True, timeout=5
        )
        
        if result.returncode != 0:
            return False
        
        data = json.loads(result.stdout)
        if not isinstance(data, list):
            return False
        
        # Check if top result has high similarity
        for item in data[:3]:
            score = item.get("score", 0) or item.get("similarity", 0)
            if score > 0.85:
                return True
        
        return False
    except Exception as e:
        print(f"  Search failed: {e}", file=sys.stderr)
        return False


def commit_fact(text):
    """Commit a fact to Second Brain."""
    try:
        payload = json.dumps({
            "text": text,
            "source": "conversation"
        })
        
        result = subprocess.run(
            ["curl", "-s", "-X", "POST", "http://localhost:7777/commit",
             "-H", "Content-Type: application/json", "-d", payload],
            capture_output=True, timeout=5
        )
        
        return result.returncode == 0
    except Exception as e:
        print(f"  Commit failed: {e}", file=sys.stderr)
        return False


def main():
    print(f"Starting hot commit at {datetime.now().isoformat()}")
    
    sessions = get_recent_sessions(minutes=120, max_files=5)
    if not sessions:
        print("No recent sessions found.")
        print(json.dumps({"committed": 0, "skipped": 0, "sessions": 0}))
        return
    
    print(f"Found {len(sessions)} recent session(s)")
    
    committed = 0
    skipped = 0
    
    for session_path in sessions:
        print(f"\nProcessing: {session_path.name}")
        
        facts = extract_facts_from_session(session_path)
        print(f"  Found {len(facts)} potential fact(s)")
        
        for fact in facts:
            text = fact["text"]
            
            # Check if already exists
            if check_if_exists(text):
                skipped += 1
                print(f"    ⏭️  Already known: {text[:60]}...")
                continue
            
            # Commit new fact
            if commit_fact(text):
                committed += 1
                print(f"    ✅ Committed: {text[:60]}...")
            else:
                print(f"    ❌ Failed to commit: {text[:60]}...")
    
    # Log result
    try:
        log_entry = f"{datetime.now().isoformat()} | sessions={len(sessions)} | committed={committed} | skipped={skipped}\n"
        with open(LOG_FILE, "a") as f:
            f.write(log_entry)
    except:
        pass
    
    print(f"\n✅ Done: {committed} committed, {skipped} skipped")
    print(json.dumps({"committed": committed, "skipped": skipped, "sessions": len(sessions)}))


if __name__ == "__main__":
    main()