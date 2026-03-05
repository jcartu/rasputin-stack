#!/usr/bin/env python3
"""
A-MEM Smart Query Decomposition
Better than simple vector search: multi-query, re-ranking, source filtering
"""
import json
import subprocess
import sys
import argparse
from datetime import datetime
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

def decompose_query(query):
    """Break down complex query into sub-queries"""
    sub_queries = [query]  # Always include original
    
    query_lower = query.lower()
    
    # Extract key concepts
    # Look for "and" conjunctions
    if ' and ' in query_lower:
        parts = query_lower.split(' and ')
        sub_queries.extend([p.strip() for p in parts if len(p.strip()) > 5])
    
    # Extract quoted phrases
    quoted = re.findall(r'"([^"]+)"', query)
    sub_queries.extend(quoted)
    
    # Extract questions within questions
    question_words = ['what', 'when', 'where', 'who', 'why', 'how']
    for qword in question_words:
        if qword in query_lower:
            # Extract the question part
            pattern = f'{qword}[^?.]+'
            matches = re.findall(pattern, query_lower, re.IGNORECASE)
            sub_queries.extend([m.strip() for m in matches if len(m.strip()) > 10])
    
    # Add perspective variations
    if 'admin' in query_lower:
        # Also search without name
        sub_queries.append(query_lower.replace('admin', '').replace("'s", '').strip())
    
    # Add keyword extraction
    keywords = extract_keywords(query)
    if keywords:
        sub_queries.append(' '.join(keywords))
    
    # Deduplicate and limit
    unique = []
    seen = set()
    for sq in sub_queries:
        normalized = sq.lower().strip()
        if normalized and normalized not in seen and len(normalized) > 3:
            unique.append(sq)
            seen.add(normalized)
    
    return unique[:5]  # Max 5 sub-queries

def extract_keywords(text):
    """Extract important keywords from query"""
    # Remove common words
    stopwords = {'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
                 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
                 'could', 'should', 'may', 'might', 'must', 'can', 'a', 'an',
                 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
                 'by', 'from', 'about', 'what', 'when', 'where', 'who', 'how'}
    
    words = re.findall(r'\b[a-z]+\b', text.lower())
    keywords = [w for w in words if w not in stopwords and len(w) > 3]
    return keywords[:5]

def search_single_query(query, limit=10):
    """Execute single vector search"""
    try:
        embedding = get_embedding(query)
        if not embedding:
            return []
        
        search_payload = {
            "vector": embedding,
            "limit": limit,
            "with_payload": True,
            "score_threshold": 0.3
        }
        
        cmd = ['curl', '-s', f'{QDRANT_ENDPOINT}/collections/{COLLECTION}/points/search',
               '-H', 'Content-Type: application/json', '-d', json.dumps(search_payload)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        data = json.loads(result.stdout)
        
        return data.get('result', [])
    except Exception as e:
        print(f"⚠️  Search error for '{query[:50]}': {e}", file=sys.stderr)
        return []

def multi_query_search(query, limit_per_query=8):
    """Search from multiple query angles"""
    sub_queries = decompose_query(query)
    
    print(f"🔍 Decomposed into {len(sub_queries)} sub-queries:")
    for i, sq in enumerate(sub_queries, 1):
        print(f"   {i}. {sq}")
    print()
    
    # Search each sub-query
    all_results = []
    seen_ids = set()
    
    for sq in sub_queries:
        results = search_single_query(sq, limit=limit_per_query)
        for hit in results:
            hit_id = hit.get('id')
            if hit_id not in seen_ids:
                hit['_sub_query'] = sq  # Track which query found this
                all_results.append(hit)
                seen_ids.add(hit_id)
    
    return all_results

def calculate_recency_score(date_str):
    """Calculate recency bonus (0-1, newer = higher)"""
    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        now = datetime.now()
        days_old = (now - dt).days
        
        # Decay function: recent memories get higher scores
        if days_old <= 1:
            return 1.0
        elif days_old <= 7:
            return 0.8
        elif days_old <= 30:
            return 0.6
        elif days_old <= 90:
            return 0.4
        else:
            return 0.2
    except:
        return 0.3  # Default for unparseable dates

def should_filter_source(payload):
    """Filter out low-value sources"""
    source = payload.get('source', '').lower()
    text = payload.get('text', '').lower()
    
    # Filter email newsletters
    if source == 'email' and any(word in text for word in ['unsubscribe', 'newsletter', 'promotional']):
        return True
    
    # Filter automated status messages
    if any(word in text for word in ['heartbeat_ok', 'status: ok', 'checking', 'monitoring']):
        return True
    
    # Filter very low importance
    if payload.get('importance', 50) < 30:
        return True
    
    return False

def re_rank_results(results, original_query):
    """Re-rank results by relevance + recency + importance"""
    scored_results = []
    
    for hit in results:
        payload = hit.get('payload', {})
        
        # Skip filtered sources
        if should_filter_source(payload):
            continue
        
        # Base score from vector similarity
        base_score = hit.get('score', 0.5)
        
        # Recency bonus
        recency = calculate_recency_score(payload.get('date', ''))
        
        # Importance bonus (normalize to 0-1)
        importance = payload.get('importance', 50) / 100.0
        
        # Category bonus
        category_weights = {
            'decision': 1.2,
            'preference': 1.1,
            'lesson': 1.15,
            'person': 1.0,
            'fact': 0.95,
            'event': 1.0,
            'todo': 1.05
        }
        category_bonus = category_weights.get(payload.get('category', 'fact'), 1.0)
        
        # Source bonus (prioritize conversations)
        source_weights = {
            'telegram': 1.2,
            'conversation': 1.2,
            'manual': 1.1,
            'email': 0.8,
            'web': 0.9
        }
        source_bonus = source_weights.get(payload.get('source', 'unknown'), 1.0)
        
        # Combined score
        # Formula: (relevance * 2 + recency + importance) * category * source
        final_score = (base_score * 2 + recency * 0.5 + importance * 0.5) * category_bonus * source_bonus
        
        scored_results.append({
            'hit': hit,
            'final_score': final_score,
            'base_score': base_score,
            'recency': recency,
            'importance': importance
        })
    
    # Sort by final score
    scored_results.sort(key=lambda x: x['final_score'], reverse=True)
    return scored_results

def format_result(scored_result, rank):
    """Format a search result for display"""
    hit = scored_result['hit']
    payload = hit.get('payload', {})
    
    # Header
    date_str = payload.get('date', '')
    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        date_display = dt.strftime('%Y-%m-%d')
    except:
        date_display = 'Unknown'
    
    category = payload.get('category', 'fact')
    emoji_map = {
        'decision': '🎯',
        'preference': '💡',
        'fact': '📌',
        'event': '🎬',
        'lesson': '📚',
        'todo': '✅',
        'person': '👤'
    }
    emoji = emoji_map.get(category, '📝')
    
    # Build result
    lines = []
    lines.append(f"\n{'=' * 70}")
    lines.append(f"#{rank} | {emoji} {category.upper()} | {date_display} | Score: {scored_result['final_score']:.2f}")
    
    # Sub-query that found this
    sub_query = hit.get('_sub_query')
    if sub_query:
        lines.append(f"Found via: \"{sub_query[:60]}{'...' if len(sub_query) > 60 else ''}\"")
    
    # Score breakdown
    lines.append(f"└─ Relevance: {scored_result['base_score']:.2f} | Recency: {scored_result['recency']:.2f} | Importance: {scored_result['importance']:.2f}")
    
    # Content
    text = payload.get('text', '')
    lines.append(f"\n{text}")
    
    # Metadata
    meta_parts = []
    if payload.get('topics'):
        meta_parts.append(f"Topics: {', '.join(payload['topics'][:3])}")
    if payload.get('people_mentioned'):
        meta_parts.append(f"People: {', '.join(payload['people_mentioned'][:3])}")
    if payload.get('source'):
        meta_parts.append(f"Source: {payload['source']}")
    
    if meta_parts:
        lines.append(f"\n📎 {' | '.join(meta_parts)}")
    
    return '\n'.join(lines)

def smart_query(query, max_results=10):
    """Main smart query function"""
    print(f"🧠 A-MEM Smart Query: '{query}'\n")
    
    # Multi-query search
    all_results = multi_query_search(query, limit_per_query=8)
    
    if not all_results:
        print("❌ No results found")
        return
    
    print(f"✅ Found {len(all_results)} unique memories across all queries\n")
    print("🔄 Re-ranking by relevance + recency + importance...\n")
    
    # Re-rank
    scored_results = re_rank_results(all_results, query)
    
    # Display top results
    print(f"📊 TOP {min(max_results, len(scored_results))} RESULTS")
    
    for i, scored_result in enumerate(scored_results[:max_results], 1):
        print(format_result(scored_result, i))
    
    print(f"\n{'=' * 70}")
    print(f"\n✅ Displayed {min(max_results, len(scored_results))} of {len(scored_results)} total results")

def main():
    parser = argparse.ArgumentParser(description='A-MEM Smart Query Decomposition')
    parser.add_argument('query', nargs='+', help='Complex query to decompose and search')
    parser.add_argument('--limit', type=int, default=10, help='Maximum results to display')
    
    args = parser.parse_args()
    query = ' '.join(args.query)
    
    smart_query(query, max_results=args.limit)

if __name__ == "__main__":
    main()
