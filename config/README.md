# Configuration Examples

Example configurations for the various services in the stack.

## LLM Inference

### llama.cpp (Qwen 3.5 122B-A10B, IQ3_XXS quantization)
```bash
# Run on GPU 0 (RTX PRO 6000 Blackwell 96GB)
./llama-server \
  --model qwen3.5-122b-a10b-iq3_xxs.gguf \
  --ctx-size 131072 \
  --n-gpu-layers 99 \
  --port 11435 \
  --parallel 4 \
  --flash-attn \
  --cont-batching
```

### Ollama (Embeddings)
```yaml
# /etc/systemd/system/ollama.service
[Service]
ExecStart=/usr/local/bin/ollama serve
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_MODELS=/path/to/models"
```

## Vector Database

### Qdrant
```yaml
# docker-compose.yml
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - ./qdrant_storage:/qdrant/storage
    environment:
      QDRANT__SERVICE__GRPC_PORT: 6334
```

## Knowledge Graph

### FalkorDB
```yaml
services:
  falkordb:
    image: falkordb/falkordb:latest
    ports:
      - "6380:6379"
    volumes:
      - ./falkordb-data:/data
```

## Process Management

### PM2 Ecosystem
```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'llm-proxy',
      script: 'proxy.py',
      interpreter: 'python3',
      env: {
        PROXY_PORT: 8889,
        OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
      }
    },
    {
      name: 'memory-server',
      script: 'memory_server.py',
      interpreter: 'python3',
    },
    {
      name: 'embed-gpu',
      script: 'embed_server.py',
      interpreter: 'python3',
    }
  ]
};
```

## Reranker

### bge-reranker-v2-m3
```python
# Simple FastAPI reranker server
from sentence_transformers import CrossEncoder
model = CrossEncoder('BAAI/bge-reranker-v2-m3', device='cuda:1')

@app.post("/rerank")
def rerank(query: str, passages: list[str]):
    pairs = [[query, p] for p in passages]
    scores = model.predict(pairs)
    return {"scores": scores.tolist()}
```
