#!/usr/bin/env python3
"""
Add sparse vector configuration to second_brain collection for hybrid search.
This is a one-time operation that adds a named sparse vector field without touching existing dense vectors.
"""

from qdrant_client import QdrantClient
from qdrant_client.models import SparseVectorParams, SparseIndexParams
import json

QDRANT_URL = "localhost"
QDRANT_PORT = 6333
COLLECTION = "second_brain"

def add_sparse_vectors():
    """Add sparse vector configuration to existing collection."""
    
    client = QdrantClient(host=QDRANT_URL, port=QDRANT_PORT)
    
    # Check current configuration
    print("📋 Checking current collection configuration...")
    collection_info = client.get_collection(COLLECTION)
    
    print(f"✓ Collection exists with {collection_info.config.params.vectors.size}d dense vectors")
    print(f"  Points count: {collection_info.points_count}")
    
    # Check if sparse vectors already exist
    if collection_info.config.params.sparse_vectors:
        print("⚠️  Sparse vectors already configured:")
        print(json.dumps({k: str(v) for k, v in collection_info.config.params.sparse_vectors.items()}, indent=2))
        return True
    
    # Add sparse vector configuration using update_collection
    print("\n🔧 Adding sparse vector field 'bm25'...")
    
    try:
        client.update_collection(
            collection_name=COLLECTION,
            sparse_vectors_config={
                "bm25": SparseVectorParams(
                    index=SparseIndexParams()
                )
            }
        )
        
        print("✅ Successfully added sparse vector field 'bm25'")
        
        # Verify
        collection_info = client.get_collection(COLLECTION)
        print("\n📋 Updated configuration:")
        if collection_info.config.params.sparse_vectors:
            print(json.dumps({k: str(v) for k, v in collection_info.config.params.sparse_vectors.items()}, indent=2))
        return True
        
    except Exception as e:
        print(f"❌ Failed to add sparse vectors: {e}")
        return False

if __name__ == "__main__":
    success = add_sparse_vectors()
    exit(0 if success else 1)
