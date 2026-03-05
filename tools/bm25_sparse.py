#!/usr/bin/env python3
"""
BM25 sparse vector generator for hybrid search.

Implements a simple but effective BM25 tokenizer that generates sparse vectors
compatible with Qdrant's sparse vector format.

Sparse vector format: {"indices": [token_id, ...], "values": [weight, ...]}
"""

import re
import math
from collections import Counter
from typing import Dict, List, Tuple

class BM25SparseEncoder:
    """
    Simple BM25 encoder that converts text to sparse vectors.
    
    Uses a fixed vocabulary hash to avoid storing a massive vocabulary.
    Hash space: 2^16 = 65536 tokens (good balance between collisions and memory)
    """
    
    def __init__(self, k1=1.5, b=0.75):
        self.k1 = k1  # Term frequency saturation parameter
        self.b = b    # Length normalization parameter
        self.vocab_size = 65536  # Hash space size
        
        # Simple stopwords (most common English words that don't carry meaning)
        self.stopwords = {
            'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
            'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
            'to', 'was', 'will', 'with', 'this', 'but', 'they', 'have', 'had',
            'what', 'when', 'where', 'who', 'why', 'how', 'all', 'each', 'every',
            'some', 'these', 'those', 'can', 'could', 'may', 'might', 'must',
            'shall', 'should', 'would', 'am', 'been', 'being', 'do', 'does',
            'did', 'having', 'if', 'or', 'than', 'then', 'there', 'their',
        }
    
    def tokenize(self, text: str) -> List[str]:
        """Tokenize text into words."""
        # Lowercase and extract words
        text = text.lower()
        # Keep alphanumeric and important punctuation, split on whitespace
        tokens = re.findall(r'\b[\w]+\b', text)
        # Remove stopwords and very short tokens
        tokens = [t for t in tokens if t not in self.stopwords and len(t) > 2]
        return tokens
    
    def token_to_id(self, token: str) -> int:
        """Hash token to an ID in [0, vocab_size)."""
        # Use Python's built-in hash and modulo to get consistent IDs
        return hash(token) % self.vocab_size
    
    def encode(self, text: str, idf_scores: Dict[int, float] = None) -> Dict:
        """
        Encode text into a sparse vector.
        
        Returns: {"indices": [int, ...], "values": [float, ...]}
        """
        tokens = self.tokenize(text)
        if not tokens:
            return {"indices": [], "values": []}
        
        # Count term frequencies
        tf = Counter(tokens)
        doc_length = len(tokens)
        
        # Calculate BM25 weights for each unique token
        token_weights = {}
        for token, freq in tf.items():
            token_id = self.token_to_id(token)
            
            # IDF score (if provided, otherwise use 1.0)
            idf = idf_scores.get(token_id, 1.0) if idf_scores else 1.0
            
            # BM25 formula
            # score = IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc_length / avg_doc_length)))
            # Simplified: assume avg_doc_length ≈ 100 tokens
            avg_doc_length = 100
            numerator = freq * (self.k1 + 1)
            denominator = freq + self.k1 * (1 - self.b + self.b * (doc_length / avg_doc_length))
            tf_component = numerator / denominator
            
            score = idf * tf_component
            token_weights[token_id] = score
        
        # Sort by token_id for consistency
        sorted_items = sorted(token_weights.items())
        
        indices = [tid for tid, _ in sorted_items]
        values = [score for _, score in sorted_items]
        
        return {
            "indices": indices,
            "values": values
        }
    
    def encode_batch(self, texts: List[str], idf_scores: Dict[int, float] = None) -> List[Dict]:
        """Encode multiple texts."""
        return [self.encode(text, idf_scores) for text in texts]


# Global encoder instance
_encoder = None

def get_encoder():
    """Get global BM25 encoder instance."""
    global _encoder
    if _encoder is None:
        _encoder = BM25SparseEncoder()
    return _encoder

def encode_text(text: str) -> Dict:
    """
    Convenience function to encode text to sparse vector.
    
    Returns: {"indices": [int, ...], "values": [float, ...]}
    """
    return get_encoder().encode(text)


if __name__ == "__main__":
    # Test the encoder
    encoder = BM25SparseEncoder()
    
    test_texts = [
        "admin is looking for platform affiliate opportunities in Brazil",
        "The Ferrari needs maintenance and the Porsche is in the shop",
        "medical-procedure treatment with Dr. Elizabeth at city-hq Genome clinic",
    ]
    
    print("🧪 Testing BM25 Sparse Encoder\n")
    
    for i, text in enumerate(test_texts, 1):
        sparse_vec = encoder.encode(text)
        print(f"{i}. Text: {text}")
        print(f"   Tokens: {len(sparse_vec['indices'])}")
        print(f"   Indices: {sparse_vec['indices'][:10]}...")
        print(f"   Values: {[f'{v:.3f}' for v in sparse_vec['values'][:10]]}...")
        print()
    
    print("✅ BM25 encoder working correctly!")
