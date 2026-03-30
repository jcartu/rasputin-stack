#!/usr/bin/env python3
"""
A-MEM Episodic Memory Query
Answer "when did..." and "what happened with..." questions
Time-aware, person-aware search with timeline reconstruction
"""
import json
import subprocess
import sys
import argparse
from datetime import datetime, timedelta
from collections import defaultdict
import re

EMBEDDING_ENDPOINT = "http://localhost:8004/embed"
QDRANT_ENDPOINT = "http://localhost:6333"
COLLECTION = "second_brain"

def get_embedding(text):
    """Get embedding from local embedding service"""
    try:
        payload = {"inputs": text[:8000]}
        cmd = ['curl', '-s', EMBEDDING_ENDPOINT, '-H', 'Content-Type: application/json',
               '-d', json.dumps(payload)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        data = json.loads(result.stdout)
        
        if isinstance(data, list):
            return data
        else:
            print(f"❌ Unexpected embedding format: {type(data)}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"❌ Embedding error: {e}", file=sys.stderr)
        return None

def parse_time_reference(query):
    """Extract time reference from query"""
    query_lower = query.lower()
    now = datetime.now()
    
    # Specific days
    if 'today' in query_lower:
        return now.replace(hour=0, minute=0, second=0), now
    if 'yesterday' in query_lower:
        start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0)
        end = start + timedelta(days=1)
        return start, end
    
    # Last X days/weeks/months
    last_match = re.search(r'last (\d+) (day|week|month)s?', query_lower)
    if last_match:
        num = int(last_match.group(1))
        unit = last_match.group(2)
        if unit == 'day':
            start = now - timedelta(days=num)
        elif unit == 'week':
            start = now - timedelta(weeks=num)
        elif unit == 'month':
            start = now - timedelta(days=num*30)
        return start, now
    
    # Days of week
    days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    for i, day in enumerate(days):
        if day in query_lower:
            # Find most recent occurrence
            days_ago = (now.weekday() - i) % 7
            if days_ago == 0:
                days_ago = 7  # Last week if same day
            target = now - timedelta(days=days_ago)
            start = target.replace(hour=0, minute=0, second=0)
            end = start + timedelta(days=1)
            return start, end
    
    return None, None

def extract_person(query):
    """Extract person name from query"""
    # Common names
    names = ['admin', 'Rasputin', 'Rudyak', 'Matthew', 'Berman']
    query_words = query.split()
    
    for name in names:
        if name.lower() in query.lower():
            return name
    
    # Look for capitalized words after "with", "about", "said"
    pattern = r'(?:with|about|said|told) ([A-Z][a-z]+)'
    match = re.search(pattern, query)
    if match:
        return match.group(1)
    
    return None

def search_with_filters(query, time_start=None, time_end=None, person=None, limit=20):
    """Search with temporal and person filters"""
    try:
        embedding = get_embedding(query)
        if not embedding:
            return []
        
        # Build filter
        filters = {"must": []}
        
        if time_start and time_end:
            filters["must"].append({
                "key": "date",
                "range": {
                    "gte": time_start.isoformat(),
                    "lt": time_end.isoformat()
                }
            })
        
        if person:
            filters["must"].append({
                "key": "people_mentioned",
                "match": {"any": [person]}
            })
        
        search_payload = {
            "vector": embedding,
            "limit": limit,
            "with_payload": True,
            "score_threshold": 0.3
        }
        
        if filters["must"]:
            search_payload["filter"] = filters
        
        cmd = ['curl', '-s', f'{QDRANT_ENDPOINT}/collections/{COLLECTION}/points/search',
               '-H', 'Content-Type: application/json', '-d', json.dumps(search_payload)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        data = json.loads(result.stdout)
        
        return data.get('result', [])
    except Exception as e:
        print(f"❌ Search error: {e}", file=sys.stderr)
        return []

def cluster_by_topic(results):
    """Group memories by topics"""
    clusters = defaultdict(list)
    
    for hit in results:
        payload = hit.get('payload', {})
        topics = payload.get('topics', [])
        
        if topics:
            # Use first topic as primary cluster
            clusters[topics[0]].append(hit)
        else:
            clusters['Other'].append(hit)
    
    return clusters

def build_timeline(results):
    """Sort memories chronologically"""
    sorted_results = sorted(results, key=lambda x: x.get('payload', {}).get('date', ''))
    return sorted_results

def format_memory(hit, show_score=True):
    """Format a memory hit for display"""
    score = hit.get('score', 0)
    p = hit.get('payload', {})
    
    # Parse date
    date_str = p.get('date', '')
    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        date_display = dt.strftime('%Y-%m-%d %H:%M')
    except:
        date_display = date_str[:16] if date_str else 'Unknown'
    
    # Build header
    parts = [f"📅 {date_display}"]
    
    if p.get('category'):
        emoji_map = {
            'decision': '🎯',
            'preference': '💡',
            'fact': '📌',
            'event': '🎬',
            'lesson': '📚',
            'todo': '✅',
            'person': '👤'
        }
        emoji = emoji_map.get(p['category'], '📝')
        parts.append(f"{emoji} {p['category']}")
    
    if p.get('people_mentioned'):
        parts.append(f"👥 {', '.join(p['people_mentioned'][:3])}")
    
    header = " | ".join(parts)
    text = p.get('text', '')
    
    result = f"{header}\n   {text[:200]}{'...' if len(text) > 200 else ''}"
    
    if show_score:
        result += f"\n   (relevance: {score:.2f})"
    
    return result

def episodic_query(query, limit=15, group_by_topic=False, timeline=True):
    """Main episodic query function"""
    print(f"🔍 Searching memories: '{query}'\n")
    
    # Parse temporal and person context
    time_start, time_end = parse_time_reference(query)
    person = extract_person(query)
    
    if time_start and time_end:
        print(f"⏰ Time filter: {time_start.strftime('%Y-%m-%d')} to {time_end.strftime('%Y-%m-%d')}")
    if person:
        print(f"👤 Person filter: {person}")
    print()
    
    # Search
    results = search_with_filters(query, time_start, time_end, person, limit)
    
    if not results:
        print("❌ No memories found")
        return
    
    print(f"✅ Found {len(results)} relevant memories\n")
    print("=" * 70)
    
    if timeline:
        # Timeline reconstruction
        sorted_results = build_timeline(results)
        print("\n📜 TIMELINE VIEW\n")
        for hit in sorted_results:
            print(format_memory(hit, show_score=False))
            print()
    
    if group_by_topic:
        # Topic clustering
        clusters = cluster_by_topic(results)
        print("\n🏷️  TOPIC CLUSTERS\n")
        for topic, hits in sorted(clusters.items(), key=lambda x: len(x[1]), reverse=True):
            print(f"## {topic} ({len(hits)} memories)")
            for hit in hits[:3]:  # Show top 3 per topic
                print(format_memory(hit))
                print()

def main():
    parser = argparse.ArgumentParser(description='A-MEM Episodic Memory Query')
    parser.add_argument('query', nargs='+', help='Search query (e.g., "when did we set up the GPU?")')
    parser.add_argument('--limit', type=int, default=15, help='Maximum results')
    parser.add_argument('--topics', action='store_true', help='Group by topics')
    parser.add_argument('--no-timeline', action='store_true', help='Skip timeline view')
    
    args = parser.parse_args()
    query = ' '.join(args.query)
    
    episodic_query(
        query,
        limit=args.limit,
        group_by_topic=args.topics,
        timeline=not args.no_timeline
    )

if __name__ == "__main__":
    main()
