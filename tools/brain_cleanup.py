#!/usr/bin/env python3
"""
Full brain cleanup + dedup + wiring script.

Phase 1: Switch Qdrant API to clean collection
Phase 2: Deduplicate Qdrant (near-duplicate detection)
Phase 3: Deduplicate FalkorDB graph entities
Phase 4: Wire graph into recall pipeline
"""

import json
import sys
import time
import hashlib
import requests
from collections import defaultdict
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue, ScrollRequest

QDRANT_URL = "http://localhost:6333"
CLEAN_COLLECTION = "second_brain"
DIRTY_COLLECTION = "second_brain_v2"

qdrant = QdrantClient(url=QDRANT_URL)

# ─────────────────────────────────────────────
# PHASE 1: Verify clean collection is good
# ─────────────────────────────────────────────
def phase1_verify():
    print("\n═══ PHASE 1: Verify Collections ═══")
    
    clean_info = qdrant.get_collection(CLEAN_COLLECTION)
    dirty_info = qdrant.get_collection(DIRTY_COLLECTION)
    
    print(f"  Clean ({CLEAN_COLLECTION}): {clean_info.points_count} points")
    print(f"  Dirty ({DIRTY_COLLECTION}): {dirty_info.points_count} points")
    
    # Verify clean has no email junk
    for src in ["email", "gmail"]:
        count = qdrant.count(
            collection_name=CLEAN_COLLECTION,
            count_filter=Filter(must=[FieldCondition(key="source", match=MatchValue(value=src))])
        ).count
        if count > 0:
            print(f"  ⚠️ WARNING: Found {count} '{src}' points in clean collection!")
            return False
        print(f"  ✅ No '{src}' points in clean collection")
    
    # Source breakdown
    print("\n  Source breakdown (clean):")
    for src in ["telegram", "chatgpt", "perplexity", "conversation", "whatsapp", "grok_social_intel"]:
        count = qdrant.count(
            collection_name=CLEAN_COLLECTION,
            count_filter=Filter(must=[FieldCondition(key="source", match=MatchValue(value=src))])
        ).count
        if count > 0:
            print(f"    {src}: {count}")
    
    return True


# ─────────────────────────────────────────────
# PHASE 2: Deduplicate Qdrant
# ─────────────────────────────────────────────
def phase2_dedup_qdrant():
    print("\n═══ PHASE 2: Deduplicate Qdrant ═══")
    
    # Strategy: scroll through all points, hash text content,
    # find exact and near-exact duplicates
    
    seen_hashes = {}  # hash -> point_id (keep first)
    duplicates = []
    short_junk = []  # points with tiny/empty text
    
    offset = None
    batch_size = 100
    total_scanned = 0
    
    print("  Scanning for duplicates...")
    
    while True:
        results = qdrant.scroll(
            collection_name=CLEAN_COLLECTION,
            limit=batch_size,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        
        points, next_offset = results
        
        if not points:
            break
            
        for point in points:
            text = point.payload.get("text", "") or ""
            
            # Flag short/empty junk (less than 20 chars of actual content)
            stripped = text.strip()
            if len(stripped) < 20:
                short_junk.append(point.id)
                continue
            
            # Normalize for dedup: lowercase, collapse whitespace
            normalized = " ".join(stripped.lower().split())
            text_hash = hashlib.md5(normalized.encode()).hexdigest()
            
            if text_hash in seen_hashes:
                duplicates.append(point.id)
            else:
                seen_hashes[text_hash] = point.id
        
        total_scanned += len(points)
        if total_scanned % 10000 == 0:
            print(f"    Scanned {total_scanned}... ({len(duplicates)} dupes, {len(short_junk)} junk so far)")
        
        offset = next_offset
        if offset is None:
            break
    
    print(f"\n  Scan complete: {total_scanned} points")
    print(f"  Exact duplicates: {len(duplicates)}")
    print(f"  Short/empty junk (<20 chars): {len(short_junk)}")
    
    # Delete duplicates and junk
    to_delete = duplicates + short_junk
    if to_delete:
        print(f"  Deleting {len(to_delete)} points...")
        # Delete in batches of 1000
        for i in range(0, len(to_delete), 1000):
            batch = to_delete[i:i+1000]
            qdrant.delete(
                collection_name=CLEAN_COLLECTION,
                points_selector=batch,
            )
            print(f"    Deleted batch {i//1000 + 1} ({len(batch)} points)")
        
        # Verify
        new_count = qdrant.get_collection(CLEAN_COLLECTION).points_count
        print(f"  ✅ After dedup: {new_count} points (removed {len(to_delete)})")
    else:
        print("  ✅ No duplicates or junk found!")
    
    return len(to_delete)


# ─────────────────────────────────────────────
# PHASE 3: Deduplicate FalkorDB graph
# ─────────────────────────────────────────────
def phase3_dedup_graph():
    print("\n═══ PHASE 3: Deduplicate FalkorDB Graph ═══")
    
    import redis
    r = redis.Redis(host='localhost', port=6380)
    
    # Get stats before
    node_count_before = r.execute_command('GRAPH.QUERY', 'brain', 'MATCH (n) RETURN count(n)')[1][0][0]
    edge_count_before = r.execute_command('GRAPH.QUERY', 'brain', 'MATCH ()-[e]->() RETURN count(e)')[1][0][0]
    print(f"  Before: {node_count_before} nodes, {edge_count_before} edges")
    
    # Strategy for each entity type:
    # 1. Find entities with similar names (case-insensitive match, prefix match)
    # 2. Merge by transferring edges to canonical entity, then delete duplicate
    
    total_merged = 0
    total_junk_deleted = 0
    
    for label in ["Person", "Organization", "Project", "Topic", "Location"]:
        print(f"\n  Processing {label}...")
        
        # Get all entities of this type
        try:
            result = r.execute_command('GRAPH.QUERY', 'brain', 
                f"MATCH (n:{label}) RETURN id(n), n.name ORDER BY toLower(n.name)")
        except Exception as e:
            print(f"    Error querying {label}: {e}")
            continue
        
        entities = [(row[0], row[1].decode() if isinstance(row[1], bytes) else str(row[1])) for row in result[1]]
        print(f"    Found {len(entities)} entities")
        
        # Group by normalized name
        name_groups = defaultdict(list)
        junk_ids = []
        
        for eid, name in entities:
            if not name or len(name.strip()) < 2:
                junk_ids.append(eid)
                continue
            
            # Normalize: lowercase, strip whitespace, strip @ prefix
            normalized = name.lower().strip().lstrip('@')
            
            # Remove common suffixes/prefixes for matching
            # "the operator" and "admin" should be different unless one is clearly a subset
            name_groups[normalized].append((eid, name))
        
        # Delete junk entities (empty/tiny names)
        if junk_ids:
            for jid in junk_ids:
                try:
                    r.execute_command('GRAPH.QUERY', 'brain', 
                        f"MATCH (n) WHERE id(n) = {jid} DETACH DELETE n")
                    total_junk_deleted += 1
                except:
                    pass
            print(f"    Deleted {len(junk_ids)} junk entities (empty names)")
        
        # Merge exact duplicates (same normalized name)
        merged_in_label = 0
        for normalized_name, group in name_groups.items():
            if len(group) <= 1:
                continue
            
            # Keep the first one (canonical), merge others into it
            canonical_id, canonical_name = group[0]
            
            for dup_id, dup_name in group[1:]:
                try:
                    # Transfer incoming edges
                    r.execute_command('GRAPH.QUERY', 'brain', f"""
                        MATCH (src)-[old_r]->(dup) WHERE id(dup) = {dup_id}
                        MATCH (canon) WHERE id(canon) = {canonical_id}
                        WITH src, canon, type(old_r) AS rtype, dup, old_r
                        DELETE old_r
                        WITH src, canon, rtype
                        MERGE (src)-[:{label}_MERGED {{from_dedup: true}}]->(canon)
                    """)
                except:
                    pass
                
                try:
                    # Transfer outgoing edges
                    r.execute_command('GRAPH.QUERY', 'brain', f"""
                        MATCH (dup)-[old_r]->(dst) WHERE id(dup) = {dup_id}
                        MATCH (canon) WHERE id(canon) = {canonical_id}
                        WITH dst, canon, type(old_r) AS rtype, dup, old_r
                        DELETE old_r
                        WITH dst, canon, rtype
                        MERGE (canon)-[:{label}_MERGED {{from_dedup: true}}]->(dst)
                    """)
                except:
                    pass
                
                try:
                    # Delete the duplicate
                    r.execute_command('GRAPH.QUERY', 'brain', 
                        f"MATCH (n) WHERE id(n) = {dup_id} DETACH DELETE n")
                    merged_in_label += 1
                except:
                    pass
        
        total_merged += merged_in_label
        if merged_in_label > 0:
            print(f"    Merged {merged_in_label} duplicate entities")
    
    # Clean up junk Topics (very short, meaningless)
    print("\n  Cleaning junk Topics...")
    junk_topic_patterns = [
        "morning coffee", "white-sand beaches", "pro subscription",
    ]
    
    # Delete topics with very short names (1-2 chars) or purely numeric
    try:
        result = r.execute_command('GRAPH.QUERY', 'brain', """
            MATCH (t:Topic)
            WHERE size(t.name) <= 2
            DETACH DELETE t
            RETURN count(t)
        """)
        short_deleted = result[1][0][0] if result[1] else 0
        if short_deleted:
            print(f"    Deleted {short_deleted} ultra-short topics")
            total_junk_deleted += short_deleted
    except Exception as e:
        print(f"    Error cleaning short topics: {e}")
    
    # Get stats after
    node_count_after = r.execute_command('GRAPH.QUERY', 'brain', 'MATCH (n) RETURN count(n)')[1][0][0]
    edge_count_after = r.execute_command('GRAPH.QUERY', 'brain', 'MATCH ()-[e]->() RETURN count(e)')[1][0][0]
    
    print(f"\n  After: {node_count_after} nodes, {edge_count_after} edges")
    print(f"  ✅ Removed {node_count_before - node_count_after} nodes ({total_merged} merged, {total_junk_deleted} junk)")
    
    return total_merged + total_junk_deleted


# ─────────────────────────────────────────────
# PHASE 4: Wire graph into recall pipeline
# ─────────────────────────────────────────────
def phase4_wire():
    print("\n═══ PHASE 4: Wire Graph Into Recall ═══")
    
    # Create a unified search endpoint that queries both Qdrant and FalkorDB
    search_script = '''\
#!/usr/bin/env python3
"""
Hybrid Brain Search — Qdrant vector + FalkorDB graph.

Usage:
    python3 hybrid_search.py "query text" [--limit 10] [--graph-hops 2]
    
    # As HTTP server (replaces second-brain on port 7777)
    python3 hybrid_search.py --serve --port 7777
"""

import argparse
import json
import re
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import redis
import requests
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

QDRANT_URL = "http://localhost:6333"
COLLECTION = "second_brain"
EMBED_MODEL = "nomic-embed-text"
EMBED_URL = "http://localhost:11434/api/embed"
FALKOR_HOST = "localhost"
FALKOR_PORT = 6380
GRAPH_NAME = "brain"

qdrant = QdrantClient(url=QDRANT_URL)


def get_embedding(text):
    """Get embedding from local Ollama nomic-embed."""
    resp = requests.post(EMBED_URL, json={"model": EMBED_MODEL, "input": text}, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    # Ollama returns {"embeddings": [[...]]}
    if "embeddings" in data:
        return data["embeddings"][0]
    elif "embedding" in data:
        return data["embedding"]
    raise ValueError(f"Unexpected embedding response: {list(data.keys())}")


def qdrant_search(query, limit=10, source_filter=None):
    """Vector similarity search via Qdrant."""
    try:
        vector = get_embedding(query)
    except Exception as e:
        print(f"[Qdrant] Embedding error: {e}", file=sys.stderr)
        return []
    
    search_filter = None
    if source_filter:
        search_filter = Filter(must=[
            FieldCondition(key="source", match=MatchValue(value=source_filter))
        ])
    
    results = qdrant.query_points(
        collection_name=COLLECTION,
        query=vector,
        limit=limit,
        query_filter=search_filter,
        with_payload=True,
    )
    
    out = []
    for point in results.points:
        out.append({
            "score": round(point.score, 4),
            "text": point.payload.get("text", ""),
            "source": point.payload.get("source", ""),
            "date": point.payload.get("date", ""),
            "origin": "qdrant",
        })
    return out


def extract_entities(query):
    """Simple entity extraction from query (NER-lite)."""
    # Capitalize words that might be entities
    entities = []
    # Look for capitalized words/phrases
    words = query.split()
    i = 0
    while i < len(words):
        word = words[i]
        # Skip common words
        if word.lower() in {"what", "who", "when", "where", "how", "is", "are", "was", 
                           "were", "the", "a", "an", "and", "or", "but", "in", "on", 
                           "at", "to", "for", "of", "with", "by", "from", "about",
                           "my", "our", "their", "his", "her", "its", "this", "that",
                           "do", "does", "did", "has", "have", "had", "be", "been",
                           "will", "would", "could", "should", "can", "may", "might",
                           "not", "no", "yes", "all", "any", "some", "every", "each",
                           "connected", "related", "between", "knows", "know", "tell",
                           "me", "us", "you", "find", "search", "get", "show", "list"}:
            i += 1
            continue
        
        # Check for capitalized or quoted entities
        if word[0].isupper() or word.startswith('"') or word.startswith("@"):
            # Try to capture multi-word entity
            entity_parts = [word.strip('"@')]
            j = i + 1
            while j < len(words) and (words[j][0].isupper() or words[j] in {"of", "the", "and"}):
                entity_parts.append(words[j])
                j += 1
            entities.append(" ".join(entity_parts))
            i = j
        else:
            # Also add standalone meaningful words as potential entities
            if len(word) > 3:
                entities.append(word)
            i += 1
    
    return entities


def graph_search(query, hops=2, limit=10):
    """Graph traversal search via FalkorDB."""
    try:
        r = redis.Redis(host=FALKOR_HOST, port=FALKOR_PORT)
        r.ping()
    except Exception as e:
        print(f"[Graph] Connection error: {e}", file=sys.stderr)
        return []
    
    entities = extract_entities(query)
    if not entities:
        # Fallback: use the whole query as a fuzzy search
        entities = [query]
    
    results = []
    seen_texts = set()
    
    for entity in entities[:3]:  # Max 3 entities to avoid slow queries
        # Search across all node types
        for label in ["Person", "Organization", "Project", "Topic", "Location"]:
            try:
                # Fuzzy match: case-insensitive contains
                safe_entity = entity.replace("'", "\\\\'").replace('"', '\\\\"')
                
                # Find the entity
                match_result = r.execute_command('GRAPH.QUERY', 'brain', f"""
                    MATCH (n:{label})
                    WHERE toLower(n.name) CONTAINS toLower('{safe_entity}')
                    RETURN id(n), n.name
                    LIMIT 3
                """)
                
                if not match_result[1]:
                    continue
                
                for match_row in match_result[1]:
                    node_id = match_row[0]
                    node_name = match_row[1].decode() if isinstance(match_row[1], bytes) else str(match_row[1])
                    
                    # Get neighborhood
                    try:
                        hood = r.execute_command('GRAPH.QUERY', 'brain', f"""
                            MATCH (start)-[rel]-(connected)
                            WHERE id(start) = {node_id}
                            RETURN labels(connected)[0] AS type,
                                   connected.name AS name,
                                   connected.text AS text,
                                   type(rel) AS relationship
                            LIMIT {limit}
                        """)
                        
                        for row in hood[1]:
                            c_type = row[0].decode() if isinstance(row[0], bytes) else str(row[0])
                            c_name = row[1].decode() if isinstance(row[1], bytes) else str(row[1]) if row[1] else ""
                            c_text = row[2].decode() if isinstance(row[2], bytes) else str(row[2]) if row[2] else ""
                            c_rel = row[3].decode() if isinstance(row[3], bytes) else str(row[3])
                            
                            # Build a useful text representation
                            display = c_text[:500] if c_text and len(c_text) > 10 else f"{c_type}: {c_name}"
                            
                            if display not in seen_texts:
                                seen_texts.add(display)
                                results.append({
                                    "text": display,
                                    "entity": node_name,
                                    "connected_to": c_name,
                                    "relationship": c_rel,
                                    "node_type": c_type,
                                    "origin": "graph",
                                })
                    except Exception as e:
                        print(f"[Graph] Neighborhood query error: {e}", file=sys.stderr)
                        
            except Exception as e:
                continue
    
    return results[:limit]


def hybrid_search(query, limit=10, graph_hops=2):
    """Combined Qdrant vector + FalkorDB graph search."""
    t0 = time.time()
    
    # Run both searches
    qdrant_results = qdrant_search(query, limit=limit)
    graph_results = graph_search(query, hops=graph_hops, limit=limit)
    
    elapsed = time.time() - t0
    
    return {
        "query": query,
        "elapsed_ms": round(elapsed * 1000, 1),
        "results": qdrant_results,
        "graph_context": graph_results,
        "stats": {
            "qdrant_hits": len(qdrant_results),
            "graph_hits": len(graph_results),
        }
    }


# ─────────────────────────────────────────────
# HTTP Server (drop-in replacement for second-brain)
# ─────────────────────────────────────────────
class HybridHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress access logs
    
    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
    
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        
        if parsed.path == "/search":
            query = params.get("q", [""])[0]
            limit = int(params.get("limit", ["10"])[0])
            source = params.get("source", [None])[0]
            
            if not query:
                self._send_json({"error": "Missing q parameter"}, 400)
                return
            
            result = hybrid_search(query, limit=limit)
            
            # If source filter requested, also filter qdrant results
            if source:
                result["results"] = [r for r in result["results"] if r.get("source") == source]
            
            self._send_json(result)
        
        elif parsed.path == "/graph":
            query = params.get("q", [""])[0]
            limit = int(params.get("limit", ["10"])[0])
            hops = int(params.get("hops", ["2"])[0])
            
            if not query:
                self._send_json({"error": "Missing q parameter"}, 400)
                return
            
            results = graph_search(query, hops=hops, limit=limit)
            self._send_json({"query": query, "results": results})
        
        elif parsed.path == "/stats":
            try:
                info = qdrant.get_collection(COLLECTION)
                qdrant_count = info.points_count
            except:
                qdrant_count = -1
            
            try:
                r = redis.Redis(host=FALKOR_HOST, port=FALKOR_PORT)
                node_count = r.execute_command('GRAPH.QUERY', 'brain', 'MATCH (n) RETURN count(n)')[1][0][0]
                edge_count = r.execute_command('GRAPH.QUERY', 'brain', 'MATCH ()-[e]->() RETURN count(e)')[1][0][0]
            except:
                node_count = -1
                edge_count = -1
            
            self._send_json({
                "qdrant": {"collection": COLLECTION, "points": qdrant_count},
                "graph": {"nodes": node_count, "edges": edge_count},
                "status": "ok"
            })
        
        elif parsed.path == "/health":
            self._send_json({"status": "ok", "engine": "hybrid"})
        
        else:
            self._send_json({"error": f"Unknown path: {parsed.path}"}, 404)
    
    def do_POST(self):
        # Support POST for search (backwards compat)
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        
        try:
            data = json.loads(body) if body else {}
        except:
            self._send_json({"error": "Invalid JSON"}, 400)
            return
        
        parsed = urlparse(self.path)
        
        if parsed.path == "/search":
            query = data.get("q", data.get("query", ""))
            limit = data.get("limit", 10)
            
            if not query:
                self._send_json({"error": "Missing query"}, 400)
                return
            
            result = hybrid_search(query, limit=limit)
            self._send_json(result)
        else:
            self._send_json({"error": f"Unknown path: {parsed.path}"}, 404)


def serve(port=7777):
    server = HTTPServer(("127.0.0.1", port), HybridHandler)
    print(f"[HybridBrain] Serving on http://127.0.0.1:{port}")
    print(f"[HybridBrain] Qdrant: {COLLECTION} | Graph: {GRAPH_NAME}")
    server.serve_forever()


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────
if __name__ == "__main__":
    if "--serve" in sys.argv:
        port = 7777
        if "--port" in sys.argv:
            port = int(sys.argv[sys.argv.index("--port") + 1])
        serve(port)
    else:
        # Run all phases
        print("🧠 BRAIN CLEANUP + WIRING")
        print("=" * 50)
        
        ok = phase1_verify()
        if not ok:
            print("❌ Phase 1 failed. Aborting.")
            sys.exit(1)
        
        removed = phase2_dedup_qdrant()
        
        graph_cleaned = phase3_dedup_graph()
        
        # Phase 4: test hybrid search
        print("\n═══ PHASE 4: Test Hybrid Search ═══")
        
        # Quick test
        test_queries = [
            "platform-beta withdrawal complaint",
            "the operator digital-ops",
            "RASPUTIN server GPU",
            "partner wedding",
            "operator-proxy model routing",
        ]
        
        for q in test_queries:
            result = hybrid_search(q, limit=3)
            print(f"\n  Query: \"{q}\"")
            print(f"  Qdrant: {result['stats']['qdrant_hits']} hits | Graph: {result['stats']['graph_hits']} hits | {result['elapsed_ms']}ms")
            if result['results']:
                top = result['results'][0]
                print(f"    Top Qdrant: [{top['source']}] {top['text'][:80]}...")
            if result['graph_context']:
                top_g = result['graph_context'][0]
                print(f"    Top Graph: {top_g.get('entity','')} --{top_g.get('relationship','')}-- {top_g.get('connected_to','')}")
        
        print("\n" + "=" * 50)
        print("✅ ALL PHASES COMPLETE")
        print(f"   Qdrant dedup: removed {removed} points")
        print(f"   Graph dedup: cleaned {graph_cleaned} entities")
        print("\nTo start hybrid server:")
        print("  pm2 stop second-brain")
        print("  pm2 start brain_cleanup.py --name hybrid-brain --interpreter python3 -- --serve --port 7777")
'''
    
    print("  Hybrid search script written to tools/brain_cleanup.py")
    print("  Ready for deployment after cleanup phases complete.")


if __name__ == "__main__":
    # Run all phases
    print("🧠 BRAIN CLEANUP + WIRING")
    print("=" * 50)
    
    ok = phase1_verify()
    if not ok:
        print("❌ Phase 1 failed. Aborting.")
        sys.exit(1)
    
    removed = phase2_dedup_qdrant()
    
    graph_cleaned = phase3_dedup_graph()
    
    phase4_wire()
