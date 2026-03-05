# ALFIE System Architecture

**Version:** 1.0.0  
**Last Updated:** February 6, 2026  
**Status:** Production Ready

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [Component Architecture](#component-architecture)
4. [Data Flow](#data-flow)
5. [Core Subsystems](#core-subsystems)
6. [Integration Layer](#integration-layer)
7. [Technology Stack](#technology-stack)
8. [Security Architecture](#security-architecture)
9. [Scalability & Performance](#scalability--performance)
10. [Deployment Architecture](#deployment-architecture)

---

## Executive Summary

ALFIE (Autonomous Learning & Functional Intelligence Engine) is a comprehensive AI assistant system designed for continuous learning, multi-model consensus, and autonomous operation. The architecture prioritizes:

- **Reliability** - Multi-provider fallbacks, error recovery
- **Privacy** - Local GPU inference, data ownership
- **Learning** - Continuous improvement from interactions
- **Performance** - Parallel processing, caching, optimization
- **Extensibility** - Modular design, plugin architecture

---

## System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACES                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │   ALFIE UI      │  │   CLI Tools     │  │   API Clients   │              │
│  │   (Next.js)     │  │   (Python/Bash) │  │   (REST/WS)     │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
└───────────┼─────────────────────┼─────────────────────┼──────────────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ALFIE BACKEND (Express.js)                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         API Gateway Layer                             │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐ │   │
│  │  │ REST    │ │ WebSocket│ │ Auth    │ │ Rate    │ │ Request         │ │   │
│  │  │ Routes  │ │ Server  │ │ Middleware│ │ Limiter │ │ Logging         │ │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         Service Layer                                 │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐            │   │
│  │  │ Session   │ │ Search    │ │ File      │ │ Analytics │            │   │
│  │  │ Manager   │ │ Service   │ │ Service   │ │ Service   │            │   │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘            │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐                          │   │
│  │  │ GPU       │ │ Second    │ │ Gateway   │                          │   │
│  │  │ Monitor   │ │ Brain     │ │ Bridge    │                          │   │
│  │  └───────────┘ └───────────┘ └───────────┘                          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│   AI ENGINE LAYER    │ │   MEMORY LAYER       │ │   INTEGRATION LAYER  │
│                      │ │                      │ │                      │
│  ┌────────────────┐  │ │  ┌────────────────┐  │ │  ┌────────────────┐  │
│  │ Consensus      │  │ │  │ Second Brain   │  │ │  │ Rasputin       │  │
│  │ Engine         │  │ │  │ (Qdrant)       │  │ │  │ Bridge         │  │
│  └────────────────┘  │ │  │ 438K+ memories │  │ │  └────────────────┘  │
│  ┌────────────────┐  │ │  └────────────────┘  │ │  ┌────────────────┐  │
│  │ Multi-Search   │  │ │  ┌────────────────┐  │ │  │ OpenClaw       │  │
│  │ Engine         │  │ │  │ Procedural     │  │ │  │ Gateway        │  │
│  └────────────────┘  │ │  │ Memory         │  │ │  └────────────────┘  │
│  ┌────────────────┐  │ │  └────────────────┘  │ │  ┌────────────────┐  │
│  │ Verification   │  │ │  ┌────────────────┐  │ │  │ External       │  │
│  │ System         │  │ │  │ Learning       │  │ │  │ APIs           │  │
│  └────────────────┘  │ │  │ System         │  │ │  └────────────────┘  │
│  ┌────────────────┐  │ │  └────────────────┘  │ │                      │
│  │ Desktop        │  │ │                      │ │                      │
│  │ Controller     │  │ │                      │ │                      │
│  └────────────────┘  │ │                      │ │                      │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
            │                       │                       │
            ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           INFRASTRUCTURE LAYER                               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                 │
│  │ VLLM (GPU)     │  │ PostgreSQL     │  │ Redis          │                 │
│  │ 120B + 20B     │  │ (Primary DB)   │  │ (Cache)        │                 │
│  └────────────────┘  └────────────────┘  └────────────────┘                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                 │
│  │ Qdrant         │  │ File System    │  │ External APIs  │                 │
│  │ (Vector DB)    │  │ (Workspace)    │  │ (OpenRouter)   │                 │
│  └────────────────┘  └────────────────┘  └────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Architecture

### 1. Frontend Layer (ALFIE UI)

```
alfie-ui/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx           # Main chat interface
│   │   ├── layout.tsx         # Root layout
│   │   └── api/               # API routes (if any)
│   │
│   ├── components/             # React Components
│   │   ├── chat/              # Chat interface components
│   │   ├── editor/            # Monaco editor integration
│   │   ├── files/             # File browser components
│   │   ├── gpu/               # GPU monitoring widgets
│   │   ├── search/            # Search interface
│   │   └── ui/                # Shared UI components (Radix)
│   │
│   ├── hooks/                  # Custom React hooks
│   │   ├── useWebSocket.ts    # WebSocket connection
│   │   └── useSession.ts      # Session management
│   │
│   ├── stores/                 # Zustand state stores
│   │   └── sessionStore.ts    # Global session state
│   │
│   ├── lib/                    # Utilities
│   │   ├── api.ts             # API client
│   │   └── utils.ts           # Helper functions
│   │
│   └── types/                  # TypeScript definitions
│       └── index.ts           # Type definitions
```

**Key Technologies:**

- **Next.js 14** - React framework with App Router
- **Radix UI** - Accessible component primitives
- **Tailwind CSS** - Utility-first styling
- **Zustand** - Lightweight state management
- **Yjs** - Real-time collaboration
- **Monaco Editor** - Code editing
- **Recharts** - Data visualization

### 2. Backend Layer (ALFIE Backend)

```
alfie-backend/
├── src/
│   ├── index.js                # Application entry point
│   ├── config.js               # Configuration management
│   │
│   ├── middleware/             # Express middleware
│   │   ├── auth.js            # Authentication
│   │   ├── rateLimit.js       # Rate limiting
│   │   └── errorHandler.js    # Error handling
│   │
│   ├── routes/                 # API route handlers
│   │   ├── sessions.js        # Session management
│   │   ├── chat.js            # Chat endpoints
│   │   ├── files.js           # File operations
│   │   ├── search.js          # Search endpoints
│   │   ├── analytics.js       # Analytics endpoints
│   │   └── system.js          # System monitoring
│   │
│   ├── services/               # Business logic
│   │   ├── sessionManager.js  # Session state management
│   │   ├── sessionBridge.js   # Gateway communication
│   │   ├── openclawGateway.js # OpenClaw client
│   │   ├── searchService.js   # Universal search
│   │   ├── secondBrain.js     # Memory integration
│   │   ├── gpuMonitor.js      # GPU monitoring
│   │   └── websocket.js       # WebSocket server
│   │
│   ├── db/                     # Database layer
│   │   ├── client.js          # Prisma client
│   │   └── migrate.js         # Migration runner
│   │
│   ├── docs/                   # API documentation
│   │   └── swagger.js         # OpenAPI spec
│   │
│   └── observability/          # Monitoring
│       └── tracing.cjs        # OpenTelemetry setup
```

**Key Technologies:**

- **Express.js** - HTTP server
- **ws** - WebSocket server
- **Prisma** - Database ORM
- **Pino** - Structured logging
- **OpenTelemetry** - Distributed tracing
- **Swagger** - API documentation

### 3. AI Engine Layer

```
workspace/
├── alfie_consensus.py          # Multi-model consensus engine
│   ├── ModelConfig            # Model configuration
│   ├── ConsensusResult        # Result data class
│   └── AlfieConsensus         # Main consensus class
│       ├── query_model()      # Query single model
│       ├── get_consensus()    # Run consensus
│       ├── synthesize()       # Synthesize answers
│       └── detect_contradictions()
│
├── alfie_multisearch.py        # Multi-provider search
│   ├── SearchConfig           # Search configuration
│   ├── SearchProvider         # Provider enum
│   ├── MultiSearchEngine      # Main search class
│   │   ├── search()           # Synchronous search
│   │   ├── search_async()     # Async search
│   │   └── _try_provider()    # Provider fallback
│   └── Provider implementations
│       ├── PerplexityProvider
│       ├── BraveProvider
│       ├── DuckDuckGoProvider
│       ├── SearXNGProvider
│       └── GoogleProvider
│
├── alfie_verify.py             # Verification system
│   ├── VerificationResult     # Result data class
│   ├── SourceCheck            # Source validation
│   └── AlfieVerifier          # Verification engine
│       ├── verify()           # Main verification
│       ├── check_sources()    # Source credibility
│       └── detect_issues()    # Issue detection
│
├── alfie_desktop.py            # Desktop automation
│   └── DesktopController      # Desktop control
│       ├── screenshot()       # Screen capture
│       ├── click()            # Mouse click
│       ├── type_text()        # Keyboard input
│       ├── hotkey()           # Key combinations
│       └── list_windows()     # Window management
│
├── alfie_procedures.py         # Procedural memory
│   ├── Procedure              # Procedure data class
│   ├── ProcedureStep          # Step definition
│   └── ProceduralMemory       # Memory manager
│       ├── save_procedure()   # Store procedure
│       ├── find_procedure()   # Search procedures
│       ├── execute()          # Run procedure
│       └── optimize()         # Improve procedure
│
└── alfie_learning_loops.py     # Continuous learning
    ├── EventType              # Event categories
    ├── LearningLevel          # Learning types
    └── ContinuousLearning     # Learning system
        ├── capture_event()    # Log events
        ├── extract_learning() # Derive lessons
        ├── detect_patterns()  # Find patterns
        └── generate_report()  # Status report
```

---

## Data Flow

### 1. Chat Request Flow

```
User Message → ALFIE UI → WebSocket/REST → ALFIE Backend
                                               │
                         ┌─────────────────────┼─────────────────────┐
                         ▼                     ▼                     ▼
                  Session Manager      Second Brain          Gateway Bridge
                         │              (Context)            (AI Model)
                         │                     │                     │
                         └─────────────────────┴─────────────────────┘
                                               │
                                               ▼
                                      Response Assembly
                                               │
                                               ▼
                              AI Response → ALFIE UI → User
```

### 2. Consensus Query Flow

```
Query → Consensus Engine
              │
              ├──────────────────┬──────────────────┬──────────────────┐
              ▼                  ▼                  ▼                  ▼
        Local 120B          Local 20B          Claude-4           GPT-5
         (VLLM)              (VLLM)          (OpenRouter)      (OpenRouter)
              │                  │                  │                  │
              └──────────────────┴──────────────────┴──────────────────┘
                                        │
                                        ▼
                              Response Comparison
                                        │
                         ┌──────────────┼──────────────┐
                         ▼              ▼              ▼
                  Similarity     Contradiction    Confidence
                   Analysis       Detection        Scoring
                         │              │              │
                         └──────────────┴──────────────┘
                                        │
                                        ▼
                              Consensus Synthesis
                                        │
                                        ▼
                              Final Response + Score
```

### 3. Search Flow

```
Search Query → Multi-Search Engine
                     │
                     ├─── Try Primary (Brave)
                     │         │
                     │    ┌────┴────┐
                     │    │ Success │──────────────────────────────┐
                     │    └────┬────┘                              │
                     │         │ Failure                           │
                     │         ▼                                   │
                     ├─── Try Fallback 1 (DuckDuckGo)              │
                     │         │                                   │
                     │    ┌────┴────┐                              │
                     │    │ Success │──────────────────────────────┤
                     │    └────┬────┘                              │
                     │         │ Failure                           │
                     │         ▼                                   │
                     ├─── Try Fallback 2 (Perplexity)              │
                     │         │                                   │
                     │         ... (continue until success)        │
                     │                                             │
                     └─────────────────────────────────────────────┘
                                                                   │
                                                                   ▼
                                                          Unified Results
```

### 4. Learning Flow

```
Task Execution → Event Capture
                      │
                      ▼
              Significance Filter
                      │
            ┌─────────┴─────────┐
            │ Not Significant   │
            │    (discard)      │
            └───────────────────┘
                      │ Significant
                      ▼
              Learning Extraction
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
     Episodic     Semantic    Procedural
         │            │            │
         ▼            ▼            ▼
    Second Brain  Second Brain  Procedures
     (Qdrant)      (Qdrant)      (JSON)
```

---

## Core Subsystems

### 1. Consensus Engine

**Purpose:** Query multiple AI models and synthesize responses

**Components:**

- **Model Manager** - Configure and manage model connections
- **Query Dispatcher** - Parallel query execution
- **Response Analyzer** - Compare and analyze responses
- **Synthesizer** - Generate consensus answer
- **Confidence Calculator** - Score confidence

**Algorithm:**

```
1. Parse query and determine query type (factual/analytical/creative)
2. Dispatch query to all configured models in parallel
3. Collect responses with timing metadata
4. Calculate pairwise similarity scores
5. Detect contradictions using pattern matching
6. Select synthesis strategy based on query type:
   - Factual: Choose response with highest average similarity
   - Analytical: Choose longest/most comprehensive
   - Creative: Choose most interesting/unique
7. Calculate confidence score from similarity distribution
8. Return consensus result with metadata
```

### 2. Memory System

**Three-Tier Memory Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY SYSTEM                             │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              EPISODIC MEMORY (Qdrant)                  │ │
│  │  - Specific events and interactions                    │ │
│  │  - Timestamped, searchable by semantic similarity      │ │
│  │  - 438K+ indexed memories                              │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                 │
│                            │ Aggregation                     │
│                            │                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              SEMANTIC MEMORY (Qdrant)                  │ │
│  │  - General facts and knowledge                         │ │
│  │  - User preferences and patterns                       │ │
│  │  - Domain expertise                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                 │
│                            │ Abstraction                     │
│                            │                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            PROCEDURAL MEMORY (JSON + Qdrant)           │ │
│  │  - How-to knowledge (workflows, procedures)            │ │
│  │  - Step-by-step instructions                           │ │
│  │  - Success metrics and optimizations                   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3. Search System

**Multi-Provider Search with Fallback:**

| Provider   | Priority    | Type       | Rate Limit         |
| ---------- | ----------- | ---------- | ------------------ |
| Brave      | 1 (Primary) | API        | 15 req/s           |
| DuckDuckGo | 2           | Scraping   | Soft limit         |
| Perplexity | 3           | API        | 20 req/min         |
| SearXNG    | 4           | Metasearch | Instance-dependent |
| Google     | 5           | Scraping   | Aggressive         |

**Retry Strategy:**

- Per-provider: 2 attempts with exponential backoff
- Full cycle: 3 retry cycles with 60s delay
- Total maximum attempts: 30 (5 providers × 2 × 3)

### 4. Verification System

**Verification Pipeline:**

```
Claim Input → Parse Claim
                  │
                  ▼
          Source Collection
          (multiple sources)
                  │
                  ▼
         Credibility Scoring
         (per source 0-100)
                  │
                  ▼
          Cross-Reference
          (detect agreement)
                  │
                  ▼
        Contradiction Detection
        (flag conflicts)
                  │
                  ▼
         Confidence Calculation
         (aggregate scores)
                  │
                  ▼
          Issue Generation
          (severity levels)
                  │
                  ▼
        Verification Result
```

---

## Integration Layer

### 1. Rasputin Bridge

**Purpose:** Access Rasputin's 182+ tools

**Communication:**

- Protocol: HTTP/tRPC
- Authentication: Cookie-based session
- Fallback: File-based queue

**Key Integrations:**

```python
bridge = RasputinBridge(base_url="http://localhost:3000")

# Execute tool
result = bridge.execute_tool(
    tool_name="web_search",
    params={"query": "AI news"},
    context={"userId": 1}
)

# Run JARVIS task
result = bridge.execute_jarvis_task(
    task="Research and summarize quantum computing developments",
    callbacks={"on_progress": callback_fn}
)
```

### 2. OpenClaw Gateway

**Purpose:** Route AI model requests

**Features:**

- Model routing and load balancing
- Token counting and cost tracking
- Response streaming
- Error handling and retry

### 3. External API Integrations

| API        | Purpose          | Authentication |
| ---------- | ---------------- | -------------- |
| OpenRouter | Cloud models     | API Key        |
| Perplexity | Real-time search | API Key        |
| Brave      | Web search       | API Key        |
| Qdrant     | Vector storage   | None (local)   |

---

## Technology Stack

### Frontend

| Technology   | Version | Purpose          |
| ------------ | ------- | ---------------- |
| Next.js      | 14.x    | React framework  |
| React        | 18.x    | UI library       |
| TypeScript   | 5.x     | Type safety      |
| Tailwind CSS | 3.x     | Styling          |
| Radix UI     | Latest  | Components       |
| Zustand      | 5.x     | State management |
| Yjs          | 13.x    | Collaboration    |

### Backend

| Technology | Version | Purpose     |
| ---------- | ------- | ----------- |
| Node.js    | 18.x    | Runtime     |
| Express.js | 4.x     | HTTP server |
| ws         | 8.x     | WebSocket   |
| Prisma     | 5.x     | ORM         |
| PostgreSQL | 15.x    | Database    |
| Redis      | 7.x     | Cache       |
| Pino       | 8.x     | Logging     |

### AI/ML

| Technology | Version | Purpose         |
| ---------- | ------- | --------------- |
| Python     | 3.11+   | Runtime         |
| VLLM       | Latest  | Local inference |
| Qdrant     | Latest  | Vector DB       |
| tenacity   | Latest  | Retry logic     |
| aiohttp    | Latest  | Async HTTP      |

### Infrastructure

| Technology    | Purpose            |
| ------------- | ------------------ |
| Docker        | Containerization   |
| systemd       | Service management |
| nginx         | Reverse proxy      |
| Let's Encrypt | SSL/TLS            |

---

## Security Architecture

### Authentication Flow

```
Client Request → API Gateway
                     │
                     ▼
              Token Validation
                     │
            ┌────────┴────────┐
            ▼                 ▼
        Valid Token      Invalid Token
            │                 │
            ▼                 ▼
      Process Request    401 Unauthorized
```

### Security Layers

1. **Transport Security**
   - TLS 1.3 for all connections
   - Certificate validation
   - HSTS headers

2. **Authentication**
   - Bearer token authentication
   - Token rotation support
   - Session management

3. **Authorization**
   - Role-based access control
   - Resource-level permissions
   - API scope restrictions

4. **Data Protection**
   - Encrypted at rest (database)
   - Encrypted in transit (TLS)
   - Secure credential storage

5. **Input Validation**
   - Request schema validation
   - SQL injection prevention
   - XSS protection

---

## Scalability & Performance

### Horizontal Scaling

```
                    Load Balancer
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    Backend 1       Backend 2       Backend 3
         │               │               │
         └───────────────┴───────────────┘
                         │
                    Shared State
              ┌──────────┴──────────┐
              ▼                     ▼
          PostgreSQL             Redis
         (Primary DB)           (Cache)
```

### Performance Optimizations

1. **Caching Strategy**
   - Redis for session cache
   - Memory cache for hot data
   - Result caching with TTL

2. **Database Optimization**
   - Connection pooling
   - Query optimization
   - Proper indexing

3. **GPU Optimization**
   - 85% memory utilization target
   - Tensor parallelism
   - Batch processing

4. **Network Optimization**
   - Response compression
   - Connection keep-alive
   - CDN for static assets

### Metrics to Monitor

| Metric           | Target | Alert Threshold |
| ---------------- | ------ | --------------- |
| Response latency | <2s    | >5s             |
| Error rate       | <1%    | >5%             |
| GPU utilization  | 85%    | <50% or >95%    |
| Memory usage     | <80%   | >90%            |
| CPU usage        | <70%   | >85%            |

---

## Deployment Architecture

### Single Server Deployment

```
┌─────────────────────────────────────────────────────────────┐
│                     SINGLE SERVER                            │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   nginx     │  │  ALFIE UI   │  │  Backend    │         │
│  │   (proxy)   │  │  (Next.js)  │  │  (Express)  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  PostgreSQL │  │   Qdrant    │  │    VLLM     │         │
│  │             │  │             │  │   (GPU)     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Multi-Server Deployment

```
┌────────────────┐
│ Load Balancer  │
└───────┬────────┘
        │
        ├─────────────────┬─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   Web Server  │ │   Web Server  │ │   Web Server  │
│  (UI + API)   │ │  (UI + API)   │ │  (UI + API)   │
└───────────────┘ └───────────────┘ └───────────────┘
        │                 │                 │
        └─────────────────┴─────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  PostgreSQL   │ │    Qdrant     │ │     VLLM      │
│   Primary     │ │   Cluster     │ │  GPU Cluster  │
└───────────────┘ └───────────────┘ └───────────────┘
```

---

## Future Architecture Considerations

### Planned Enhancements

1. **Microservices Migration**
   - Split backend into focused services
   - Service mesh for communication
   - Independent scaling

2. **Kubernetes Deployment**
   - Container orchestration
   - Auto-scaling
   - Self-healing

3. **Multi-Region Support**
   - Geographic distribution
   - Data replication
   - Latency optimization

4. **Enhanced Observability**
   - Distributed tracing
   - Centralized logging
   - Metrics aggregation

---

**Document Maintained By:** ALFIE Documentation System  
**Version:** 1.0.0  
**Status:** Production Ready
