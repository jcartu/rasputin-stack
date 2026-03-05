# ALFIE API Reference

**Version:** 1.0.0  
**Last Updated:** February 6, 2026  
**Base URL:** `http://localhost:3001`  
**WebSocket:** `ws://localhost:3001/ws`

---

## Table of Contents

1. [Authentication](#authentication)
2. [Health & System](#health--system)
3. [Sessions](#sessions)
4. [Chat](#chat)
5. [Files](#files)
6. [Search](#search)
7. [Analytics](#analytics)
8. [Memory](#memory)
9. [WebSocket](#websocket)
10. [Python APIs](#python-apis)
11. [Error Handling](#error-handling)

---

## Authentication

### Bearer Token Authentication

All API endpoints (except health check) require authentication.

**Header:**

```
Authorization: Bearer <your-api-token>
```

**Configuration:**

```bash
# Set in alfie-backend/.env
API_TOKEN=your-secure-token-here
```

**Example:**

```bash
curl -H "Authorization: Bearer your-token" \
     http://localhost:3001/api/sessions
```

---

## Health & System

### GET /api/health

Health check endpoint (no authentication required).

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2026-02-06T04:00:00.000Z",
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "gateway": "connected",
    "qdrant": "connected"
  }
}
```

---

### GET /api/system/stats

Get system statistics (CPU, memory, uptime).

**Response:**

```json
{
  "cpu": {
    "usage": 45.2,
    "cores": 16,
    "model": "AMD Ryzen 9 5950X"
  },
  "memory": {
    "total": 64424509440,
    "used": 32212254720,
    "free": 32212254720,
    "usagePercent": 50.0
  },
  "disk": {
    "total": 500000000000,
    "used": 250000000000,
    "free": 250000000000,
    "usagePercent": 50.0
  },
  "uptime": 86400,
  "loadAverage": [2.5, 2.0, 1.8]
}
```

---

### GET /api/system/gpu

Get GPU statistics (requires NVIDIA GPU).

**Response:**

```json
{
  "available": true,
  "gpus": [
    {
      "index": 0,
      "name": "NVIDIA RTX 4090",
      "utilization": 85,
      "memoryUsed": 20480,
      "memoryTotal": 24576,
      "temperature": 72,
      "powerDraw": 350,
      "powerLimit": 450
    }
  ]
}
```

---

## Sessions

### GET /api/sessions

List all sessions.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Maximum sessions to return |
| `offset` | integer | 0 | Pagination offset |
| `status` | string | all | Filter by status (active, archived) |

**Response:**

```json
{
  "sessions": [
    {
      "id": "session-uuid-1234",
      "name": "Research Project",
      "createdAt": "2026-02-06T00:00:00.000Z",
      "updatedAt": "2026-02-06T04:00:00.000Z",
      "messageCount": 42,
      "status": "active"
    }
  ],
  "total": 15,
  "limit": 20,
  "offset": 0
}
```

---

### POST /api/sessions

Create a new session.

**Request Body:**

```json
{
  "name": "New Research Session",
  "model": "claude-4",
  "systemPrompt": "You are a helpful research assistant."
}
```

**Response:**

```json
{
  "id": "session-uuid-5678",
  "name": "New Research Session",
  "createdAt": "2026-02-06T04:00:00.000Z",
  "status": "active",
  "model": "claude-4"
}
```

---

### GET /api/sessions/:id

Get session details.

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session UUID |

**Response:**

```json
{
  "id": "session-uuid-1234",
  "name": "Research Project",
  "createdAt": "2026-02-06T00:00:00.000Z",
  "updatedAt": "2026-02-06T04:00:00.000Z",
  "status": "active",
  "model": "claude-4",
  "systemPrompt": "You are a helpful assistant.",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "content": "Hello!",
      "timestamp": "2026-02-06T00:01:00.000Z"
    },
    {
      "id": "msg-2",
      "role": "assistant",
      "content": "Hello! How can I help you today?",
      "timestamp": "2026-02-06T00:01:05.000Z"
    }
  ],
  "metadata": {
    "tokenCount": 150,
    "cost": 0.003
  }
}
```

---

### DELETE /api/sessions/:id

Delete a session.

**Response:**

```json
{
  "success": true,
  "message": "Session deleted successfully"
}
```

---

## Chat

### POST /api/chat

Send a message and receive AI response.

**Request Body:**

```json
{
  "sessionId": "session-uuid-1234",
  "message": "What is quantum computing?",
  "stream": false,
  "model": "claude-4",
  "temperature": 0.7,
  "maxTokens": 2000
}
```

**Response (non-streaming):**

```json
{
  "id": "msg-uuid-5678",
  "role": "assistant",
  "content": "Quantum computing is a type of computation...",
  "model": "claude-4",
  "usage": {
    "promptTokens": 50,
    "completionTokens": 200,
    "totalTokens": 250
  },
  "timestamp": "2026-02-06T04:00:00.000Z"
}
```

**Streaming Response:**
When `stream: true`, returns Server-Sent Events:

```
event: chunk
data: {"content": "Quantum "}

event: chunk
data: {"content": "computing "}

event: chunk
data: {"content": "is..."}

event: done
data: {"usage": {"totalTokens": 250}}
```

---

### POST /api/chat/consensus

Query with multi-model consensus.

**Request Body:**

```json
{
  "query": "What is the capital of France?",
  "queryType": "factual",
  "models": ["claude-4", "gpt-5", "gemini-pro", "local-120b"],
  "temperature": 0.3
}
```

**Response:**

```json
{
  "consensusAnswer": "The capital of France is Paris.",
  "confidenceScore": 0.95,
  "agreementLevel": "high",
  "individualResponses": [
    {
      "model": "claude-4",
      "answer": "The capital of France is Paris.",
      "latencyMs": 1200
    },
    {
      "model": "gpt-5",
      "answer": "Paris is the capital of France.",
      "latencyMs": 1100
    }
  ],
  "contradictions": [],
  "timestamp": "2026-02-06T04:00:00.000Z"
}
```

---

## Files

### GET /api/files

List directory contents.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | `/` | Directory path |
| `recursive` | boolean | false | Include subdirectories |

**Response:**

```json
{
  "path": "/home/admin/.openclaw/workspace",
  "files": [
    {
      "name": "alfie_consensus.py",
      "type": "file",
      "size": 19942,
      "modified": "2026-02-06T02:29:00.000Z",
      "extension": ".py"
    },
    {
      "name": "docs",
      "type": "directory",
      "modified": "2026-02-06T04:00:00.000Z"
    }
  ]
}
```

---

### GET /api/files/read

Read file contents.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | File path |
| `encoding` | string | No | Encoding (utf-8, base64) |

**Response:**

```json
{
  "path": "/home/admin/.openclaw/workspace/README.md",
  "content": "# ALFIE Consensus System\n...",
  "size": 10234,
  "modified": "2026-02-06T02:29:00.000Z",
  "encoding": "utf-8"
}
```

---

### POST /api/files/write

Write file contents.

**Request Body:**

```json
{
  "path": "/home/admin/.openclaw/workspace/test.txt",
  "content": "Hello, World!",
  "encoding": "utf-8",
  "createDirectories": true
}
```

**Response:**

```json
{
  "success": true,
  "path": "/home/admin/.openclaw/workspace/test.txt",
  "size": 13
}
```

---

### POST /api/files/delete

Delete a file.

**Request Body:**

```json
{
  "path": "/home/admin/.openclaw/workspace/test.txt"
}
```

**Response:**

```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

---

## Search

### POST /api/search

Universal search across sessions, files, and memories.

**Request Body:**

```json
{
  "query": "quantum computing research",
  "scope": ["sessions", "files", "memories"],
  "limit": 20,
  "filters": {
    "dateFrom": "2026-01-01",
    "dateTo": "2026-02-06"
  }
}
```

**Response:**

```json
{
  "results": [
    {
      "type": "session",
      "id": "session-uuid",
      "title": "Quantum Research",
      "snippet": "...quantum computing applications...",
      "score": 0.95,
      "timestamp": "2026-02-05T12:00:00.000Z"
    },
    {
      "type": "file",
      "path": "/docs/quantum.md",
      "snippet": "...quantum algorithms...",
      "score": 0.88,
      "modified": "2026-02-04T15:00:00.000Z"
    },
    {
      "type": "memory",
      "id": "memory-uuid",
      "content": "Discussed quantum supremacy...",
      "score": 0.82
    }
  ],
  "total": 42,
  "searchTime": 156
}
```

---

### GET /api/search/quick

Quick search (for command palette).

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search query |
| `limit` | integer | Max results (default: 10) |

**Response:**

```json
{
  "results": [
    {
      "type": "file",
      "title": "quantum.md",
      "path": "/docs/quantum.md"
    },
    {
      "type": "session",
      "title": "Quantum Research",
      "id": "session-uuid"
    }
  ]
}
```

---

### POST /api/search/deep

Deep search with semantic memory.

**Request Body:**

```json
{
  "query": "What did we discuss about machine learning last week?",
  "includeMemories": true,
  "semanticSearch": true,
  "limit": 50
}
```

**Response:**

```json
{
  "results": [...],
  "memories": [
    {
      "content": "On Feb 1, discussed neural network architectures...",
      "similarity": 0.92,
      "timestamp": "2026-02-01T10:00:00.000Z"
    }
  ],
  "synthesis": "Last week you discussed neural networks, focusing on transformer architectures..."
}
```

---

## Analytics

### GET /api/analytics

Get usage analytics.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `period` | string | day, week, month, year |
| `metric` | string | messages, tokens, sessions, cost |

**Response:**

```json
{
  "period": "week",
  "metrics": {
    "totalMessages": 1542,
    "totalTokens": 450000,
    "totalSessions": 23,
    "estimatedCost": 12.5,
    "averageResponseTime": 1.8
  },
  "breakdown": [
    {
      "date": "2026-02-01",
      "messages": 200,
      "tokens": 60000
    }
  ],
  "topModels": [
    { "model": "claude-4", "usage": 60 },
    { "model": "gpt-5", "usage": 25 },
    { "model": "local-120b", "usage": 15 }
  ]
}
```

---

### POST /api/analytics/track

Track custom event.

**Request Body:**

```json
{
  "event": "feature_used",
  "properties": {
    "feature": "consensus_query",
    "models": 4,
    "success": true
  }
}
```

**Response:**

```json
{
  "success": true,
  "eventId": "event-uuid"
}
```

---

### GET /api/analytics/export

Export analytics data.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `format` | string | json, csv |
| `period` | string | day, week, month, year, all |

**Response:**
Returns JSON or CSV file download.

---

## Memory

### POST /api/memories/search

Search Second Brain semantic memory.

**Request Body:**

```json
{
  "query": "previous discussions about AI ethics",
  "limit": 20,
  "minScore": 0.5,
  "filters": {
    "tags": ["ethics", "AI"],
    "dateRange": {
      "from": "2026-01-01",
      "to": "2026-02-06"
    }
  }
}
```

**Response:**

```json
{
  "memories": [
    {
      "id": "memory-uuid-1",
      "content": "Discussed AI ethics principles including fairness...",
      "score": 0.94,
      "tags": ["ethics", "AI", "fairness"],
      "timestamp": "2026-01-15T14:30:00.000Z",
      "source": "session:session-uuid"
    }
  ],
  "total": 15,
  "searchTime": 45
}
```

---

### POST /api/memories/add

Add a memory to Second Brain.

**Request Body:**

```json
{
  "content": "Important insight about neural network optimization...",
  "tags": ["neural-networks", "optimization"],
  "metadata": {
    "source": "research",
    "importance": "high"
  }
}
```

**Response:**

```json
{
  "id": "memory-uuid-new",
  "success": true
}
```

---

## WebSocket

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

// Authentication
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: 'auth',
      token: 'your-api-token',
    })
  );
};
```

### Event Types

#### Server → Client

| Event            | Description             |
| ---------------- | ----------------------- |
| `connected`      | Connection established  |
| `gpu_stats`      | GPU monitoring update   |
| `session_update` | Session state change    |
| `message_chunk`  | Streaming message chunk |
| `heartbeat`      | Keep-alive ping         |
| `error`          | Error notification      |

**Example Events:**

```json
// GPU Stats
{
  "type": "gpu_stats",
  "payload": {
    "gpus": [
      {
        "index": 0,
        "utilization": 85,
        "temperature": 72,
        "memoryUsed": 20480
      }
    ]
  }
}

// Message Chunk (streaming)
{
  "type": "message_chunk",
  "payload": {
    "sessionId": "session-uuid",
    "content": "Quantum computing is...",
    "done": false
  }
}

// Session Update
{
  "type": "session_update",
  "payload": {
    "sessionId": "session-uuid",
    "event": "message_added",
    "data": {...}
  }
}
```

#### Client → Server

| Event         | Description             |
| ------------- | ----------------------- |
| `auth`        | Authentication          |
| `subscribe`   | Subscribe to events     |
| `unsubscribe` | Unsubscribe from events |
| `ping`        | Keep-alive              |

**Example Messages:**

```json
// Subscribe to session
{
  "type": "subscribe",
  "channel": "session:session-uuid"
}

// Subscribe to GPU monitoring
{
  "type": "subscribe",
  "channel": "gpu"
}
```

### GET /api/ws/clients

List connected WebSocket clients.

**Response:**

```json
{
  "clients": [
    {
      "id": "client-uuid",
      "connectedAt": "2026-02-06T03:00:00.000Z",
      "subscriptions": ["gpu", "session:session-uuid"]
    }
  ],
  "count": 3
}
```

---

## Python APIs

### Consensus Engine

```python
from alfie_consensus import AlfieConsensus, load_default_models

async def query_consensus():
    models = load_default_models()
    engine = AlfieConsensus(models)

    result = await engine.get_consensus(
        query="What is quantum computing?",
        query_type="factual",  # factual | analytical | creative
        temperature=0.3
    )

    print(f"Answer: {result.consensus_answer}")
    print(f"Confidence: {result.confidence_score:.1%}")
    print(f"Agreement: {result.agreement_level}")
```

---

### Multi-Search

```python
from alfie_multisearch import MultiSearchEngine, SearchConfig, SearchProvider

def search_web():
    config = SearchConfig(
        primary_provider=SearchProvider.BRAVE,
        fallback_providers=[
            SearchProvider.DUCKDUCKGO,
            SearchProvider.PERPLEXITY
        ],
        max_retries=3
    )

    engine = MultiSearchEngine(config)
    response = engine.search("Python tutorials", num_results=10)

    for result in response.results:
        print(f"{result.title}: {result.url}")
```

---

### Verification System

```python
from alfie_verify import AlfieVerifier

async def verify_claim():
    verifier = AlfieVerifier()

    result = await verifier.verify(
        claim="The Eiffel Tower is 330 meters tall",
        sources=["wikipedia", "britannica"]
    )

    print(f"Confidence: {result.confidence_score}%")
    print(f"Issues: {len(result.issues)}")
    for issue in result.issues:
        print(f"  - {issue.severity}: {issue.message}")
```

---

### Procedural Memory

```python
from alfie_procedures import ProceduralMemory, Procedure, ProcedureStep

def create_procedure():
    memory = ProceduralMemory()

    procedure = Procedure(
        id="proc-uuid",
        name="Deploy Application",
        description="Steps to deploy the application",
        trigger_conditions=["deploy", "release"],
        prerequisites=["tests passing"],
        steps=[
            ProcedureStep(
                action="Build Docker image",
                tool="bash",
                params={"command": "docker build -t app ."}
            ),
            ProcedureStep(
                action="Push to registry",
                tool="bash",
                params={"command": "docker push app"}
            )
        ],
        post_conditions=["application running"],
        tags=["deployment", "docker"]
    )

    memory.save_procedure(procedure)
```

---

### Desktop Control

```python
from alfie_desktop import DesktopController

def automate_desktop():
    desktop = DesktopController()

    # Screenshot
    desktop.screenshot("/tmp/screen.png")

    # Click at position
    desktop.click(500, 300, button="left")

    # Type text
    desktop.type_text("Hello, World!")

    # Key combination
    desktop.hotkey("ctrl", "s")  # Save

    # Launch application
    desktop.launch_app("firefox")

    # Window management
    windows = desktop.list_windows()
    desktop.focus_window("Firefox")
```

---

### Learning System

```python
from alfie_learning_loops import ContinuousLearning, EventType

def track_learning():
    learning = ContinuousLearning()

    # Capture event
    learning.capture_event(
        event_type=EventType.TASK_SUCCESS,
        description="Generated report",
        context={"report_type": "analytics"},
        outcome="Report generated successfully",
        success=True,
        duration_ms=2500,
        tags=["reporting", "analytics"]
    )

    # Capture user feedback
    learning.capture_user_feedback(
        task_description="Morning briefing",
        feedback="Too long, prefer bullet points",
        sentiment="negative",
        rating=2
    )

    # Detect patterns
    patterns = learning.detect_patterns(window_hours=24)

    # Generate recommendations
    recommendations = learning.generate_improvement_recommendations()
```

---

## Error Handling

### Error Response Format

All errors return consistent JSON:

```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": "Additional context (optional)",
  "timestamp": "2026-02-06T04:00:00.000Z"
}
```

### HTTP Status Codes

| Code  | Meaning             | When Used              |
| ----- | ------------------- | ---------------------- |
| `200` | OK                  | Successful request     |
| `201` | Created             | Resource created       |
| `400` | Bad Request         | Invalid parameters     |
| `401` | Unauthorized        | Missing authentication |
| `403` | Forbidden           | Invalid token          |
| `404` | Not Found           | Resource not found     |
| `429` | Too Many Requests   | Rate limited           |
| `500` | Internal Error      | Server error           |
| `503` | Service Unavailable | Dependency down        |

### Error Codes

| Code                | Description                 |
| ------------------- | --------------------------- |
| `AUTH_REQUIRED`     | Authentication required     |
| `INVALID_TOKEN`     | Token is invalid or expired |
| `SESSION_NOT_FOUND` | Session does not exist      |
| `FILE_NOT_FOUND`    | File does not exist         |
| `PERMISSION_DENIED` | No permission for operation |
| `RATE_LIMITED`      | Too many requests           |
| `GATEWAY_ERROR`     | OpenClaw gateway error      |
| `GPU_UNAVAILABLE`   | No GPU available            |
| `MEMORY_ERROR`      | Qdrant connection error     |

---

## Rate Limiting

| Endpoint Category | Limit | Window   |
| ----------------- | ----- | -------- |
| Chat              | 60    | 1 minute |
| Search            | 30    | 1 minute |
| Files             | 100   | 1 minute |
| Analytics         | 10    | 1 minute |
| WebSocket         | N/A   | N/A      |

**Rate Limit Headers:**

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1707192000
```

---

## Interactive Documentation

OpenAPI/Swagger documentation available at:

- **Swagger UI:** `http://localhost:3001/api/docs`
- **OpenAPI JSON:** `http://localhost:3001/api/docs/openapi.json`
- **OpenAPI YAML:** `http://localhost:3001/api/docs/openapi.yaml`

---

**Document Maintained By:** ALFIE Documentation System  
**Version:** 1.0.0  
**Status:** Production Ready
