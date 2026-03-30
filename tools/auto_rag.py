#!/usr/bin/env python3
"""
Auto-RAG v2: Tiered memory recall with source priority.

TIER 1 (gold): chatgpt, perplexity, conversation — 1.3x boost
TIER 2 (silver): email/gmail with known contacts — 1.0x
TIER 3 (bronze): bulk email/gmail — 0.7x penalty

Usage: python3 auto_rag.py "user message" [--top-k 5] [--threshold 0.55] [--force]
"""

import sys
import json
import requests
import argparse
import re

QDRANT_URL = "http://localhost:6333"
EMBED_URL = "http://localhost:8003/embed"
COLLECTION = "second_brain"
DEFAULT_TOP_K = 8
DEFAULT_THRESHOLD = 0.55

# Source tiers — gold sources get boosted, bulk email gets penalized
SOURCE_BOOST = {
    "chatgpt": 1.30,
    "perplexity": 1.25,
    "conversation": 1.35,
    "email": 0.70,
    "gmail": 0.70,
}

# Known important contacts — emails from these get tier 2 (no penalty)
IMPORTANT_CONTACTS = {
    "partner", "alexandra", "family-member", "john", "david", "ozias",
    "oren", "lukas", "elizabeth", "durandin",
    "operator", "shuhari", "platform-beta", "platform-alpha",
}

def should_query(message: str) -> dict:
    """Determine if a message warrants memory lookup."""
    msg_lower = message.lower()
    
    # Always trigger
    always = ["remember", "did i", "did we", "have i", "have we", "when did",
              "last time", "previously", "what happened", "what was", "who is",
              "who was", "tell me about", "remind me", "my doctor", "my car",
              "my health", "appointment", "email from", "email about",
              "searched for", "looked into", "researched", "how much did",
              "how many", "what do i think", "what did i", "preference"]
    
    for trigger in always:
        if trigger in msg_lower:
            return {"should_query": True, "reason": f"trigger: '{trigger}'", "query": message}
    
    # Proper nouns (names, places, companies)
    skip = {"The", "This", "That", "What", "When", "Where", "How", "Why", "Can",
            "Could", "Would", "Should", "Will", "Do", "Does", "Did", "Is", "Are",
            "Was", "Were", "Have", "Has", "Had", "I", "My", "We", "Our", "Yes",
            "No", "Ok", "Hey", "Hi", "Hello", "Set", "Make", "Run", "Get", "Let",
            "Put", "Give", "Take", "Check", "Look", "Find", "Show", "Tell", "Ask",
            "Try", "Write", "Read", "Send", "Add", "Use", "Also", "Just", "Sure",
            "Yeah", "Please", "Thanks", "Good", "Great", "Nice", "Cool", "Right", "Well"}
    proper_nouns = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', message)
    real_nouns = [n for n in proper_nouns if n not in skip]
    if real_nouns:
        return {"should_query": True, "reason": f"proper nouns: {real_nouns}",
                "query": " ".join(real_nouns) + " " + message[:100]}
    
    # Personal questions
    personal = ["i ", "my ", "we ", "our ", "admin", "partner", "alexandra",
                "platform", "platform-beta", "platform-alpha", "car", "health", "medical",
                "porsche", "ferrari", "apartment", "house", "dad", "father",
                "brother", "wedding", "medical-procedure", "health-goal", "peptide", "surgery"]
    if any(q in msg_lower for q in ["?", "what", "when", "where", "who", "how"]):
        if any(k in msg_lower for k in personal):
            return {"should_query": True, "reason": "personal question", "query": message}
    
    return {"should_query": False, "reason": "no trigger", "query": message}

def get_embedding(text: str) -> list:
    try:
        resp = requests.post(EMBED_URL, json={"inputs": text[:8000]}, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return data[0] if isinstance(data, list) and len(data) > 0 else data
    except Exception as e:
        print(f"Embedding error: {e}", file=sys.stderr)
        return None

def is_important_sender(payload: dict) -> bool:
    """Check if email is from an important contact."""
    sender = (payload.get("from", "") + payload.get("to", "")).lower()
    return any(c in sender for c in IMPORTANT_CONTACTS)

def tiered_search(query: str, top_k: int = 8, threshold: float = 0.55, include_email: bool = False) -> list:
    """Search with source-based score boosting."""
    embedding = get_embedding(query)
    if not embedding:
        return []
    
    # PHASE 1: Search gold sources first (chatgpt + perplexity + conversation)
    gold_results = []
    for source in ["chatgpt", "perplexity", "conversation"]:
        try:
            resp = requests.post(
                f"{QDRANT_URL}/collections/{COLLECTION}/points/search",
                json={
                    "vector": embedding,
                    "limit": top_k,
                    "score_threshold": threshold,
                    "with_payload": True,
                    "filter": {"must": [{"key": "source", "match": {"value": source}}]}
                },
                timeout=10
            )
            resp.raise_for_status()
            results = resp.json().get("result", [])
            for r in results:
                r["_boosted_score"] = r["score"] * SOURCE_BOOST.get(source, 1.0)
                r["_tier"] = "gold"
            gold_results.extend(results)
        except Exception as e:
            print(f"Search error ({source}): {e}", file=sys.stderr)
    
    # PHASE 2: Search email ONLY if explicitly requested
    # 630K email points are mostly noise — skip by default
    all_results = []
    if include_email:
        try:
            for src in ["email", "gmail"]:
                resp = requests.post(
                    f"{QDRANT_URL}/collections/{COLLECTION}/points/search",
                    json={
                        "vector": embedding,
                        "limit": top_k,
                        "score_threshold": threshold + 0.05,  # higher bar for email
                        "with_payload": True,
                        "filter": {"must": [{"key": "source", "match": {"value": src}}]}
                    },
                    timeout=10
                )
                resp.raise_for_status()
                for r in resp.json().get("result", []):
                    if is_important_sender(r.get("payload", {})):
                        r["_boosted_score"] = r["score"] * 1.0
                        r["_tier"] = "silver"
                    else:
                        r["_boosted_score"] = r["score"] * 0.7
                        r["_tier"] = "bronze"
                    all_results.append(r)
        except Exception as e:
            print(f"Email search error: {e}", file=sys.stderr)
    
    # Merge and deduplicate
    combined = {}
    for r in gold_results + all_results:
        pid = r.get("id")
        if pid not in combined or r["_boosted_score"] > combined[pid]["_boosted_score"]:
            combined[pid] = r
    
    # Sort by boosted score
    sorted_results = sorted(combined.values(), key=lambda x: x["_boosted_score"], reverse=True)
    return sorted_results[:top_k]

def format_result(r: dict) -> dict:
    payload = r.get("payload", {})
    text = payload.get("text", payload.get("content", payload.get("body", "")))
    source = payload.get("source", "unknown")
    date = payload.get("date", payload.get("timestamp", ""))
    subject = payload.get("subject", "")
    sender = payload.get("from", "")
    title = payload.get("title", "")
    question = payload.get("question", "")
    
    if len(text) > 500:
        text = text[:500] + "..."
    
    return {
        "source": source,
        "tier": r.get("_tier", "unknown"),
        "date": str(date)[:20] if date else "",
        "subject": subject or title or question,
        "from": sender,
        "text": text,
        "raw_score": round(r.get("score", 0), 3),
        "boosted_score": round(r.get("_boosted_score", 0), 3),
    }

def main():
    parser = argparse.ArgumentParser(description="Auto-RAG v2 — tiered memory recall")
    parser.add_argument("message", help="User message")
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--include-email", action="store_true", help="Also search email (630K points, noisy)")
    parser.add_argument("--json", action="store_true", help="JSON output only")
    args = parser.parse_args()
    
    decision = should_query(args.message)
    
    if args.check_only:
        print(json.dumps(decision, indent=2))
        return
    
    if not decision["should_query"] and not args.force:
        if args.json:
            print(json.dumps({"enriched": False, "reason": decision["reason"]}))
        else:
            print(f"No recall needed: {decision['reason']}")
        return
    
    include_email = getattr(args, 'include_email', False)
    # Auto-include email if query explicitly mentions email
    if any(w in decision["query"].lower() for w in ["email", "mail", "inbox", "sent me", "wrote me"]):
        include_email = True
    results = tiered_search(decision["query"], args.top_k, args.threshold, include_email)
    formatted = [format_result(r) for r in results]
    
    if args.json:
        print(json.dumps({"enriched": True, "count": len(formatted), "results": formatted}))
    else:
        # Human-readable output
        gold = [r for r in formatted if r["tier"] == "gold"]
        silver = [r for r in formatted if r["tier"] == "silver"]
        bronze = [r for r in formatted if r["tier"] == "bronze"]
        
        print(f"🧠 Memory Recall — {len(formatted)} results (query: {decision['query'][:60]})")
        print()
        
        if gold:
            print(f"⭐ HIGH-VALUE ({len(gold)} results):")
            for r in gold:
                label = r["subject"] or r["text"][:60]
                print(f"  [{r['source']}] {label} (score: {r['boosted_score']})")
                if r["text"] and r["text"] != label:
                    print(f"    → {r['text'][:120]}")
                print()
        
        if silver:
            print(f"📧 IMPORTANT EMAIL ({len(silver)} results):")
            for r in silver:
                print(f"  From: {r['from'][:40]} | {r['subject'][:50]} (score: {r['boosted_score']})")
                print()
        
        if bronze:
            print(f"📬 Other ({len(bronze)} results):")
            for r in bronze:
                print(f"  {r['source']}: {r['subject'][:50] or r['text'][:50]} (score: {r['boosted_score']})")
                print()

if __name__ == "__main__":
    main()
