#!/usr/bin/env python3
"""
Episode Detector — Prototype
Processes session transcripts and clusters them into episodes.

Usage:
  python3 episode_detector.py                          # Process all sessions
  python3 episode_detector.py --session UUID            # Process one session
  python3 episode_detector.py --since 2026-03-01        # Process sessions since date
  python3 episode_detector.py --dry-run                 # Extract but don't store
  python3 episode_detector.py --migrate                 # Full migration from all sessions

Requires: Ollama (port 11434) for Qwen extraction + nomic-embed-text embeddings
          Qdrant (port 6333) for episode storage
"""

import json
import sys
import hashlib
import argparse
from datetime import datetime
from pathlib import Path
from typing import Optional

# --- Config ---
SESSIONS_DIR = Path.home() / ".openclaw/agents/main/sessions"
OLLAMA_URL = "http://localhost:11434"  # For embeddings only
QDRANT_URL = "http://localhost:6333"
EMBED_MODEL = "nomic-embed-text"
LLM_MODEL = "local-llm"  # llama-server on port 11435
LLM_URL = "http://localhost:11435"  # Direct llama-server (OpenAI-compatible)
COLLECTION = "episodes"
TIME_GAP_MINUTES = 30  # Gap threshold for segment splitting
MIN_USER_MESSAGES = 3  # Minimum user messages to form an episode
EMBED_DIM = 768
PROCESSED_FILE = Path.home() / ".openclaw/workspace/tools/.episode_detector_processed.jsonl"

# --- Helpers ---

def parse_session(path: Path) -> Optional[dict]:
    """Parse a session JSONL into structured data."""
    messages = []
    session_meta = {}
    
    # Skip missing files (sessions may be deleted or cleaned up)
    if not path.exists():
        return None
    
    try:
        with open(path) as f:
            for line in f:
                try:
                    d = json.loads(line.strip())
                except json.JSONDecodeError:
                    continue
                
                if d.get("type") == "session":
                    session_meta = d
                    continue
                
                if d.get("type") == "message":
                    msg = d.get("message", d)
                    role = msg.get("role", "")
                    content = msg.get("content", "")
                    ts = d.get("timestamp", "")
                    
                    # Handle content arrays
                    if isinstance(content, list):
                        text_parts = []
                        for part in content:
                            if isinstance(part, dict) and part.get("type") == "text":
                                text_parts.append(part.get("text", ""))
                            elif isinstance(part, str):
                                text_parts.append(part)
                        content = "\n".join(text_parts)
                    
                    if role in ("user", "assistant") and content and len(content) > 5:
                        messages.append({
                            "role": role,
                            "content": content[:2000],  # Truncate very long messages
                            "timestamp": ts,
                        })
    except FileNotFoundError:
        print("  ⚠️ Session file not found, skipping")
        return None
    
    return {
        "session_id": session_meta.get("id", path.stem.split(".")[0]),
        "start_ts": session_meta.get("timestamp", ""),
        "messages": messages,
    }


def segment_by_time_gap(messages: list, gap_minutes: int = TIME_GAP_MINUTES) -> list:
    """Split messages into segments by time gaps."""
    if not messages:
        return []
    
    segments = []
    current = [messages[0]]
    
    for i in range(1, len(messages)):
        prev_ts = messages[i - 1].get("timestamp", "")
        curr_ts = messages[i].get("timestamp", "")
        
        gap = _time_diff_minutes(prev_ts, curr_ts)
        if gap is not None and gap > gap_minutes:
            segments.append(current)
            current = []
        current.append(messages[i])
    
    if current:
        segments.append(current)
    
    return segments


def _time_diff_minutes(ts1: str, ts2: str) -> Optional[float]:
    """Difference in minutes between two ISO timestamps."""
    try:
        t1 = datetime.fromisoformat(ts1.replace("Z", "+00:00"))
        t2 = datetime.fromisoformat(ts2.replace("Z", "+00:00"))
        return abs((t2 - t1).total_seconds()) / 60
    except (ValueError, TypeError):
        return None


def _ts_to_epoch(ts: str) -> int:
    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
    except:
        return 0


def build_transcript(segment: list) -> str:
    """Build a readable transcript from messages."""
    lines = []
    for m in segment:
        role = "User" if m["role"] == "user" else "Rasputin"
        text = m["content"][:500]
        # Strip cron prefixes and system noise
        if text.startswith("[cron:") or text.startswith("[Subagent"):
            text = text.split("]", 1)[-1].strip() if "]" in text else text
        lines.append(f"{role}: {text}")
    return "\n".join(lines)


def extract_episode_llm(transcript: str, session_id: str, start_ts: str, end_ts: str) -> Optional[dict]:
    """Use local LLM to extract episode metadata from transcript."""
    import urllib.request
    
    prompt = f"""Analyze this conversation transcript and extract episode metadata.

TRANSCRIPT:
{transcript[:4000]}

Extract the following as JSON (no markdown, just raw JSON):
{{
  "title": "Short descriptive title (5-8 words)",
  "summary": "2-3 sentence summary of what happened",
  "topics": ["topic1", "topic2"],
  "type": "one of: debugging, deployment, configuration, research, conversation, planning, monitoring, creation",
  "decisions": ["decision 1", "decision 2"],
  "outcome": "one of: success, failure, partial, ongoing, abandoned, informational",
  "outcome_detail": "Brief outcome description",
  "importance": 0.0-1.0
}}

Rules:
- Title should be specific (e.g., "Fix Enrichment Pipeline Timeouts" not "Debug Issue")
- Topics are lowercase single words or short phrases
- Decisions are explicit choices made during the conversation
- Importance: 0.3=routine, 0.5=notable, 0.7=significant, 0.9=critical
- If this is a cron/automated check with no real conversation, set importance to 0.1"""

    body = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": "Output ONLY JSON. No thinking process, no explanations, just the JSON object."},
            {"role": "user", "content": prompt}
        ],
        "stream": False,
        "temperature": 0.1,
        "max_tokens": 2000
    }).encode()
    
    req = urllib.request.Request(
        f"{LLM_URL}/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            msg = result.get("choices", [{}])[0].get("message", {})
            text = msg.get("content") or msg.get("reasoning_content") or ""
            # Extract JSON from response - try multiple strategies
            text = text.strip()
            
            # Strategy 1: Look for code block
            if "```" in text:
                parts = text.split("```")
                for i in range(1, len(parts), 2):
                    block = parts[i].strip()
                    if block.startswith("json"):
                        block = block[4:].strip()
                    # Try to find JSON object in this block
                    try:
                        # Find the outermost braces
                        start = block.find('{')
                        if start >= 0:
                            depth = 0
                            end = -1
                            for i, c in enumerate(block[start:], start):
                                if c == '{': depth += 1
                                elif c == '}': depth -= 1
                                if depth == 0:
                                    end = i
                                    break
                            if end >= 0:
                                episode = json.loads(block[start:end+1])
                                print(f"  DEBUG Parsed episode (code block): {episode.get('title', 'NO TITLE')}")
                                return episode
                    except:
                        pass
            
            # Strategy 2: Find last JSON-like pattern with nested braces/arrays
            start = text.rfind('{')
            if start >= 0:
                depth = 0
                end = -1
                for i, c in enumerate(text[start:], start):
                    if c == '{' or c == '[': depth += 1
                    elif c == '}' or c == ']': depth -= 1
                    if depth == 0 and (c == '}' or c == ']'):
                        end = i
                        break
                if end >= 0:
                    try:
                        candidate = text[start:end+1]
                        # Clean up any trailing content
                        episode = json.loads(candidate)
                        return episode
                    except:
                        pass
            
            return None
    except Exception as e:
        print(f"  LLM extraction failed: {e}", file=sys.stderr)
    
    return None


def get_embedding(text: str) -> Optional[list]:
    """Get nomic-embed-text embedding via Ollama."""
    import urllib.request
    
    body = json.dumps({
        "model": EMBED_MODEL,
        "prompt": text,
    }).encode()
    
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/embeddings",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            return result.get("embedding")
    except Exception as e:
        print(f"  Embedding failed: {e}", file=sys.stderr)
    return None


def ensure_collection():
    """Create episodes collection in Qdrant if it doesn't exist."""
    import urllib.request
    
    # Check if exists
    try:
        req = urllib.request.Request(f"{QDRANT_URL}/collections/{COLLECTION}")
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status == 200:
                return True
    except:
        pass
    
    # Create
    body = json.dumps({
        "vectors": {"size": EMBED_DIM, "distance": "Cosine"},
    }).encode()
    
    req = urllib.request.Request(
        f"{QDRANT_URL}/collections/{COLLECTION}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"Created collection '{COLLECTION}'")
        
        # Create payload indexes
        for field, schema in {
            "date": "keyword",
            "week": "keyword", 
            "month": "keyword",
            "topics": "keyword",
            "outcome": "keyword",
            "type": "keyword",
            "importance": "float",
            "start_ts": "integer",
            "end_ts": "integer",
        }.items():
            idx_body = json.dumps({
                "field_name": field,
                "field_schema": schema,
            }).encode()
            idx_req = urllib.request.Request(
                f"{QDRANT_URL}/collections/{COLLECTION}/index",
                data=idx_body,
                headers={"Content-Type": "application/json"},
                method="PUT",
            )
            urllib.request.urlopen(idx_req, timeout=10)
        
        print("Created payload indexes")
        return True
    except Exception as e:
        print(f"Failed to create collection: {e}", file=sys.stderr)
        return False


def store_episode(episode: dict, vector: list) -> bool:
    """Store episode in Qdrant."""
    import urllib.request
    
    # Get session_id from session_ids list (handle both formats)
    sess_id = episode.get('session_id') or episode.get('session_ids', ['unknown'])[0]
    
    # Generate deterministic ID from content
    ep_hash = hashlib.md5(
        f"{sess_id}_{episode['start_ts']}_{episode['title']}".encode()
    ).hexdigest()
    # Qdrant needs UUID-like or integer ID; use integer from hash
    ep_id = int(ep_hash[:16], 16) % (2**63)
    
    body = json.dumps({
        "points": [{
            "id": ep_id,
            "vector": vector,
            "payload": episode,
        }]
    }).encode()
    
    req = urllib.request.Request(
        f"{QDRANT_URL}/collections/{COLLECTION}/points",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"  Store failed: {e}", file=sys.stderr)
        return False


def process_session(path: Path, dry_run: bool = False) -> list:
    """Process a single session file into episodes."""
    session = parse_session(path)
    if session is None:
        return []  # File was deleted or couldn't be read
    
    messages = session["messages"]
    
    if not messages:
        return []
    
    # Filter out very short sessions
    user_msgs = [m for m in messages if m["role"] == "user"]
    if len(user_msgs) < MIN_USER_MESSAGES:
        return []
    
    # Segment by time gaps
    segments = segment_by_time_gap(messages)
    
    episodes = []
    for seg in segments:
        user_count = sum(1 for m in seg if m["role"] == "user")
        if user_count < MIN_USER_MESSAGES:
            continue
        
        transcript = build_transcript(seg)
        if len(transcript) < 100:
            continue
        
        start_ts = seg[0].get("timestamp", "")
        end_ts = seg[-1].get("timestamp", "")
        
        # Extract episode metadata via LLM
        ep_data = extract_episode_llm(transcript, session["session_id"], start_ts, end_ts)
        if not ep_data:
            continue
        
        # Compute temporal fields
        try:
            dt = datetime.fromisoformat(start_ts.replace("Z", "+00:00"))
            date_str = dt.strftime("%Y-%m-%d")
            iso_cal = dt.isocalendar()
            week_str = f"{iso_cal[0]}-W{iso_cal[1]:02d}"
            month_str = dt.strftime("%Y-%m")
        except:
            date_str = week_str = month_str = ""
        
        duration = _time_diff_minutes(start_ts, end_ts) or 0
        
        episode = {
            "title": ep_data.get("title", "Untitled Episode"),
            "summary": ep_data.get("summary", ""),
            "topics": ep_data.get("topics", []),
            "type": ep_data.get("type", "conversation"),
            "decisions": ep_data.get("decisions", []),
            "outcome": ep_data.get("outcome", "informational"),
            "outcome_detail": ep_data.get("outcome_detail", ""),
            "importance": ep_data.get("importance", 0.5),
            "date": date_str,
            "week": week_str,
            "month": month_str,
            "start_ts": _ts_to_epoch(start_ts),
            "end_ts": _ts_to_epoch(end_ts),
            "duration_minutes": round(duration),
            "session_ids": [session["session_id"]],
            "participants": ["user", "assistant"],
            "message_count": len(seg),
            "user_message_count": user_count,
            "source_type": "session_transcript",
            "created_at": datetime.utcnow().isoformat() + "Z",
        }
        
        if dry_run:
            episodes.append(episode)
            print(f"  [DRY RUN] Episode: {episode['title']} ({date_str}, {round(duration)}min, importance={episode['importance']})")
            continue
        
        # Get embedding
        embed_text = f"{episode['title']}. {episode['summary']}"
        vector = get_embedding(embed_text)
        if not vector:
            print(f"  Skipping (no embedding): {episode['title']}")
            continue
        
        # Store in Qdrant
        if store_episode(episode, vector):
            episodes.append(episode)
            print(f"  ✅ {episode['title']} ({date_str}, {round(duration)}min)")
        else:
            print(f"  ❌ Failed to store: {episode['title']}")
    
    return episodes


def main():
    parser = argparse.ArgumentParser(description="Episode Detector — Extract episodes from session transcripts")
    parser.add_argument("--session", help="Process a specific session UUID")
    parser.add_argument("--since", help="Process sessions since date (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="Extract but don't store")
    parser.add_argument("--migrate", action="store_true", help="Process ALL sessions")
    parser.add_argument("--limit", type=int, default=0, help="Max sessions to process")
    args = parser.parse_args()
    
    if not args.dry_run:
        if not ensure_collection():
            print("Failed to ensure Qdrant collection. Aborting.")
            sys.exit(1)
    
    # Collect session files
    if args.session:
        # Find specific session
        matches = list(SESSIONS_DIR.glob(f"{args.session}*"))
        if not matches:
            print(f"Session not found: {args.session}")
            sys.exit(1)
        session_files = matches[:1]
    else:
        # Get all active (non-deleted) session files
        session_files = sorted(
            [f for f in SESSIONS_DIR.glob("*.jsonl") if ".deleted." not in f.name],
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
    
    # Filter by date if --since
    if args.since:
        try:
            since_dt = datetime.fromisoformat(args.since)
            since_epoch = since_dt.timestamp()
            session_files = [f for f in session_files if f.stat().st_mtime >= since_epoch]
        except ValueError:
            print(f"Invalid date: {args.since}")
            sys.exit(1)
    
    if args.limit:
        session_files = session_files[:args.limit]
    
    print(f"Processing {len(session_files)} session files...")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    
    # Load already-processed sessions (if --migrate)
    processed_hashes = set()
    skipped_count = 0
    
    if args.migrate and PROCESSED_FILE.exists():
        try:
            with open(PROCESSED_FILE) as f:
                for line in f:
                    try:
                        processed_hashes.add(line.strip())
                    except:
                        pass
        except:
            pass
        print(f"Found {len(processed_hashes)} previously processed session(s)")
    
    print()
    
    total_episodes = 0
    for i, path in enumerate(session_files):
        # Compute session hash (filename + mtime for change detection)
        stat = path.stat()
        session_hash = hashlib.md5(f"{path.name}:{stat.st_mtime:.2f}".encode()).hexdigest()
        
        # Skip if already processed (only in migrate mode)
        if args.migrate and session_hash in processed_hashes:
            skipped_count += 1
            continue
        
        session_id = path.stem.split(".")[0]
        print(f"[{i+1}/{len(session_files)}] {session_id}")
        
        episodes = process_session(path, dry_run=args.dry_run)
        total_episodes += len(episodes)
        
        # Mark as processed if in LIVE mode
        if not args.dry_run and args.migrate:
            try:
                with open(PROCESSED_FILE, "a") as f:
                    f.write(session_hash + "\n")
            except Exception as e:
                print(f"  Warning: Could not save progress: {e}", file=sys.stderr)
        
        if not episodes:
            print("  (no episodes detected)")
    
    print(f"\nDone. Total episodes: {total_episodes}, Skipped: {skipped_count}")


if __name__ == "__main__":
    main()
