#!/usr/bin/env python3
"""
A-MEM Auto-Commit System
Automatically commits significant events to Qdrant with rich metadata
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

# Category definitions
CATEGORIES = ['decision', 'preference', 'fact', 'event', 'lesson', 'todo', 'person']

def get_embedding(text):
    """Get embedding from local embedding service"""
    try:
        payload = {"inputs": text[:8000]}
        cmd = ['curl', '-s', EMBEDDING_ENDPOINT, '-H', 'Content-Type: application/json',
               '-d', json.dumps(payload)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        data = json.loads(result.stdout)
        
        # Server returns flat array
        if isinstance(data, list):
            return data
        else:
            print(f"❌ Unexpected embedding format: {type(data)}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"❌ Embedding error: {e}", file=sys.stderr)
        return None

def extract_metadata(text, category=None):
    """Extract structured metadata from text using pattern matching"""
    metadata = {
        'topics': [],
        'people_mentioned': [],
        'sentiment': 'neutral',
        'action_items': []
    }
    
    # Extract people (capitalized names, common names)
    people_pattern = r'\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b'
    people = re.findall(people_pattern, text)
    common_names = ['admin', 'Rasputin', 'Rudyak', 'Matthew', 'Berman']
    metadata['people_mentioned'] = list(set([p for p in people if p in common_names or len(p) > 3]))
    
    # Detect sentiment
    positive_words = ['love', 'great', 'excellent', 'prefer', 'like', 'happy', 'good']
    negative_words = ['hate', 'bad', 'avoid', 'dislike', 'terrible', 'wrong', 'problem']
    
    text_lower = text.lower()
    pos_count = sum(1 for word in positive_words if word in text_lower)
    neg_count = sum(1 for word in negative_words if word in text_lower)
    
    if pos_count > neg_count:
        metadata['sentiment'] = 'positive'
    elif neg_count > pos_count:
        metadata['sentiment'] = 'negative'
    
    # Extract action items
    action_patterns = [
        r'(?:need to|should|must|todo:|remember to) ([^.!?\n]+)',
        r'(?:will|going to) ([^.!?\n]+)',
    ]
    for pattern in action_patterns:
        actions = re.findall(pattern, text_lower, re.IGNORECASE)
        metadata['action_items'].extend([a.strip() for a in actions if len(a.strip()) > 5])
    
    # Extract topics (keywords)
    keywords = []
    tech_keywords = ['GPU', 'CPU', 'API', 'server', 'database', 'Qdrant', 'embedding', 
                     'model', 'LLM', 'agent', 'dashboard', 'platform', 'Rasputin']
    for kw in tech_keywords:
        if kw.lower() in text_lower or kw in text:
            keywords.append(kw)
    
    metadata['topics'] = keywords[:5]  # Max 5 topics
    
    # Infer category if not provided
    if not category:
        if any(word in text_lower for word in ['decided', 'choose', 'decision', 'went with']):
            category = 'decision'
        elif any(word in text_lower for word in ['prefer', 'like', 'favorite', 'always']):
            category = 'preference'
        elif any(word in text_lower for word in ['learned', 'lesson', 'mistake', 'realized']):
            category = 'lesson'
        elif any(word in text_lower for word in ['todo', 'need to', 'should', 'must']):
            category = 'todo'
        elif len(metadata['people_mentioned']) > 0 and 'is' in text_lower:
            category = 'person'
        elif any(word in text_lower for word in ['happened', 'event', 'meeting', 'talked']):
            category = 'event'
        else:
            category = 'fact'
    
    metadata['category'] = category
    return metadata

def check_duplicate(text, embedding, threshold=0.92):
    """Check if similar memory already exists"""
    try:
        search_payload = {
            "vector": embedding,
            "limit": 3,
            "with_payload": True,
            "score_threshold": threshold
        }
        cmd = ['curl', '-s', f'{QDRANT_ENDPOINT}/collections/{COLLECTION}/points/search',
               '-H', 'Content-Type: application/json', '-d', json.dumps(search_payload)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        data = json.loads(result.stdout)
        
        results = data.get('result', [])
        if results:
            # Check if any result is very similar
            for hit in results:
                if hit.get('score', 0) > threshold:
                    similar_text = hit.get('payload', {}).get('text', '')
                    return True, similar_text
        return False, None
    except Exception as e:
        print(f"⚠️  Dedup check failed: {e}", file=sys.stderr)
        return False, None

def auto_commit(text, importance=None, category=None, source='manual', skip_dedup=False):
    """Auto-commit with metadata extraction and deduplication"""
    
    # Extract metadata
    metadata = extract_metadata(text, category)
    
    # Auto-calculate importance if not provided
    if importance is None:
        importance = 50  # baseline
        
        # Boost by category
        category_weights = {
            'decision': 20,
            'lesson': 15,
            'preference': 15,
            'todo': 10,
            'person': 10,
            'event': 5,
            'fact': 0
        }
        importance += category_weights.get(metadata['category'], 0)
        
        # Boost by sentiment
        if metadata['sentiment'] == 'positive':
            importance += 5
        elif metadata['sentiment'] == 'negative':
            importance += 10  # Problems are important!
        
        # Boost by people mentions
        importance += min(len(metadata['people_mentioned']) * 5, 15)
        
        # Boost by action items
        importance += min(len(metadata['action_items']) * 10, 20)
        
        # Length factor
        if len(text) > 200:
            importance += 10
        
        importance = max(1, min(100, importance))
    
    print(f"📝 Committing: {text[:80]}{'...' if len(text) > 80 else ''}")
    print(f"   Category: {metadata['category']}, Importance: {importance}")
    
    # Get embedding
    embedding = get_embedding(text)
    if not embedding:
        print("❌ Failed to get embedding")
        return False
    
    # Check for duplicates
    if not skip_dedup:
        is_dup, similar_text = check_duplicate(text, embedding)
        if is_dup:
            print(f"⏭️  Duplicate detected (similar: '{similar_text[:60]}...')")
            return False
    
    # Generate point ID
    point_id = abs(hash(text + str(datetime.now()))) % (10**15)
    
    # Build payload
    payload = {
        "text": text,
        "date": datetime.now().isoformat(),
        "source": source,
        "importance": importance,
        "category": metadata['category'],
        "topics": metadata['topics'],
        "people_mentioned": metadata['people_mentioned'],
        "sentiment": metadata['sentiment'],
        "action_items": metadata['action_items'],
        "type": "amem_auto"
    }
    
    # Commit to Qdrant
    point_data = {
        "points": [{
            "id": point_id,
            "vector": embedding,
            "payload": payload
        }]
    }
    
    try:
        cmd = ['curl', '-s', f'{QDRANT_ENDPOINT}/collections/{COLLECTION}/points',
               '-H', 'Content-Type: application/json',
               '-X', 'PUT',
               '-d', json.dumps(point_data)]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        response = json.loads(result.stdout)
        
        if response.get('status') == 'ok':
            print(f"✅ Committed to memory (ID: {point_id})")
            if metadata['topics']:
                print(f"   Topics: {', '.join(metadata['topics'])}")
            if metadata['people_mentioned']:
                print(f"   People: {', '.join(metadata['people_mentioned'])}")
            if metadata['action_items']:
                print(f"   Actions: {len(metadata['action_items'])}")
            return True
        else:
            print(f"❌ Failed to commit: {response}")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        return False

def main():
    parser = argparse.ArgumentParser(description='A-MEM Auto-Commit System')
    parser.add_argument('text', help='Text to commit to memory')
    parser.add_argument('--importance', type=int, help='Importance score (1-100)', default=None)
    parser.add_argument('--category', choices=CATEGORIES, help='Memory category')
    parser.add_argument('--source', default='manual', help='Source of the memory')
    parser.add_argument('--skip-dedup', action='store_true', help='Skip deduplication check')
    
    args = parser.parse_args()
    
    success = auto_commit(
        args.text,
        importance=args.importance,
        category=args.category,
        source=args.source,
        skip_dedup=args.skip_dedup
    )
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
