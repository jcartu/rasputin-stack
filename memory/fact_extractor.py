#!/usr/bin/env python3
"""
Auto Fact Extraction — Mines session transcripts for personal knowledge about the user.
Runs every 4 hours via cron. Uses local Qwen 3.5 122B MoE (free).
Extracts structured facts and stores them in Qdrant + memory/facts.jsonl

Usage:
  python3 fact_extractor.py                  # Process last 4 hours
  python3 fact_extractor.py --all            # Process ALL sessions (first run)
  python3 fact_extractor.py --hours 24       # Process last 24 hours
"""
import json
import os
import sys
import hashlib
import uuid
import requests
from datetime import datetime, timedelta
from pathlib import Path

WORKSPACE = Path.home() / '.openclaw' / 'workspace'
SESSIONS_DIR = Path.home() / '.openclaw/agents/main/sessions'
FACTS_FILE = WORKSPACE / 'memory' / 'facts.jsonl'
STATE_FILE = WORKSPACE / 'memory' / 'fact_extractor_state.json'
OLLAMA_URL = "http://localhost:11434/api/generate"
QDRANT_URL = "http://localhost:6333"
EMBED_URL = "http://localhost:11434/api/embeddings"

# Facts we've already extracted (dedup)
def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"last_run": None, "processed_lines": {}, "fact_hashes": []}

def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))

def extract_user_messages(hours=4, process_all=False):
    """Extract user messages from session transcripts"""
    cutoff = None if process_all else (datetime.utcnow() - timedelta(hours=hours)).isoformat()
    
    messages = []
    for jf in sorted(SESSIONS_DIR.glob('*.jsonl')):
        if jf.name == 'sessions.json':
            continue
        try:
            with open(jf) as f:
                for i, line in enumerate(f):
                    try:
                        d = json.loads(line.strip())
                        if d.get('type') != 'message':
                            continue
                        
                        ts = d.get('timestamp', '')
                        if cutoff and ts and ts < cutoff:
                            continue
                        
                        msg = d.get('message', {})
                        role = msg.get('role', '')
                        
                        # We want user messages AND assistant messages (facts come from both)
                        if role not in ('user', 'assistant'):
                            continue
                        
                        content = msg.get('content', '')
                        if isinstance(content, list):
                            text_parts = [c.get('text', '') for c in content 
                                        if isinstance(c, dict) and c.get('type') == 'text']
                            content = '\n'.join(text_parts)
                        
                        if not isinstance(content, str) or len(content) < 30:
                            continue
                        
                        # Skip system noise, cron outputs, tool results
                        if content.startswith('[System') or content.startswith('[cron:'):
                            continue
                        if 'Exec completed' in content[:50] or 'Exec failed' in content[:50]:
                            continue
                        
                        messages.append({
                            'role': role,
                            'text': content[:2000],  # Truncate long messages
                            'ts': ts,
                            'file': jf.name,
                            'line': i
                        })
                    except json.JSONDecodeError:
                        pass
        except Exception as e:
            print(f"  Error reading {jf.name}: {e}")
    
    return messages

def chunk_messages(messages, chunk_size=20):
    """Group messages into conversation chunks for analysis"""
    chunks = []
    for i in range(0, len(messages), chunk_size):
        chunk = messages[i:i+chunk_size]
        text = "\n".join([f"[{m['role']}] {m['text']}" for m in chunk])
        chunks.append({
            'text': text[:8000],  # Keep under Qwen context
            'ts_start': chunk[0]['ts'],
            'ts_end': chunk[-1]['ts'],
            'count': len(chunk)
        })
    return chunks

def extract_facts_from_chunk(chunk_text):
    """Use local Qwen 3.5 122B MoE to extract personal facts"""
    prompt = f"""You are analyzing a conversation between the user and his AI assistant. Extract ONLY personal facts about the user — things that would be useful for a personal assistant to remember long-term.

Focus on:
- Family members (names, relationships, details about them)
- Personal preferences (food, music, style, habits)
- Health information (medications, conditions, supplements)
- Life events (dates, places, milestones)
- Business details (companies, roles, decisions)
- Relationships (friends, colleagues, partners)
- Locations (where he lives, travels, frequents)
- Opinions and values (what he cares about, what annoys him)
- Hobbies, interests, possessions (cars, gadgets, pets)

DO NOT extract:
- Technical commands or code
- System status messages
- Generic AI/tech news discussed
- Anything about the AI assistant itself

Output as JSON array of objects with "category" and "fact" fields.
If no personal facts found, output: []

Conversation:
{chunk_text}

JSON facts:"""
    
    try:
        resp = requests.post(OLLAMA_URL, json={
            "model": "qwen3.5-122b-a10b",
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 2000}
        }, timeout=120)
        
        if resp.status_code == 200:
            text = resp.json().get('response', '')
            # Try to parse JSON from response
            text = text.strip()
            if text.startswith('```'):
                text = text.split('```')[1]
                if text.startswith('json'):
                    text = text[4:]
            
            try:
                facts = json.loads(text)
                if isinstance(facts, list):
                    return facts
            except json.JSONDecodeError:
                # Try to find JSON array in the response
                start = text.find('[')
                end = text.rfind(']') + 1
                if start >= 0 and end > start:
                    try:
                        facts = json.loads(text[start:end])
                        if isinstance(facts, list):
                            return facts
                    except:
                        pass
        return []
    except Exception as e:
        print(f"  Qwen error: {e}")
        return []

def dedup_fact(fact_text, existing_hashes):
    """Check if we already have this fact"""
    h = hashlib.md5(fact_text.lower().strip().encode()).hexdigest()
    return h in existing_hashes, h

def store_fact(fact, state):
    """Store fact to JSONL file and Qdrant"""
    fact_text = fact.get('fact', '')
    category = fact.get('category', 'unknown')
    
    is_dup, fact_hash = dedup_fact(fact_text, set(state.get('fact_hashes', [])))
    if is_dup:
        return False
    
    # Append to JSONL
    entry = {
        'ts': datetime.now().isoformat(),
        'category': category,
        'fact': fact_text,
        'hash': fact_hash
    }
    with open(FACTS_FILE, 'a') as f:
        f.write(json.dumps(entry) + '\n')
    
    # Store in Qdrant
    try:
        emb_resp = requests.post(EMBED_URL, json={
            "model": "nomic-embed-text",
            "prompt": f"Personal fact about user: {fact_text}"
        }, timeout=30)
        
        if emb_resp.status_code == 200:
            embedding = emb_resp.json()["embedding"]
            point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"fact-{fact_hash}"))
            
            requests.put(f"{QDRANT_URL}/collections/second_brain/points", json={
                "points": [{
                    "id": point_id,
                    "vector": embedding,
                    "payload": {
                        "text": f"Personal fact [{category}]: {fact_text}",
                        "type": "personal_fact",
                        "category": category,
                        "source": "fact_extractor",
                        "timestamp": datetime.now().isoformat()
                    }
                }]
            }, timeout=10)
    except Exception as e:
        print(f"  Qdrant store error: {e}")
    
    state.setdefault('fact_hashes', []).append(fact_hash)
    return True

def main():
    process_all = '--all' in sys.argv
    hours = 4
    for i, arg in enumerate(sys.argv):
        if arg == '--hours' and i + 1 < len(sys.argv):
            hours = int(sys.argv[i + 1])
    
    state = load_state()
    
    print(f"🧠 Fact Extractor — {'ALL sessions' if process_all else f'last {hours}h'}")
    print(f"  Existing facts: {len(state.get('fact_hashes', []))}")
    
    # Extract messages
    messages = extract_user_messages(hours=hours, process_all=process_all)
    print(f"  Messages found: {len(messages)}")
    
    if not messages:
        print("  Nothing to process")
        state['last_run'] = datetime.now().isoformat()
        save_state(state)
        return
    
    # Chunk and process
    chunks = chunk_messages(messages, chunk_size=15)
    print(f"  Chunks to analyze: {len(chunks)}")
    
    total_new = 0
    total_dup = 0
    
    for i, chunk in enumerate(chunks):
        print(f"\n  [{i+1}/{len(chunks)}] Processing {chunk['count']} messages...")
        facts = extract_facts_from_chunk(chunk['text'])
        
        for fact in facts:
            if not fact.get('fact'):
                continue
            stored = store_fact(fact, state)
            if stored:
                total_new += 1
                print(f"    ✅ [{fact.get('category','?')}] {fact['fact'][:100]}")
            else:
                total_dup += 1
    
    state['last_run'] = datetime.now().isoformat()
    save_state(state)
    
    print(f"\n📊 Results: {total_new} new facts, {total_dup} duplicates skipped")
    print(f"  Total facts in store: {len(state.get('fact_hashes', []))}")

if __name__ == '__main__':
    main()
