# AI Agent Dashboard

A full-stack dashboard for monitoring and interacting with AI agent infrastructure.

## Architecture

**Backend** (Node.js/Express):
- RESTful API with WebSocket real-time updates
- Prisma ORM with SQLite (migrations, rollback support)
- Integration registry (Slack, Discord, GitHub, GitLab, Linear, Notion, Google Drive, Jira, Dropbox)
- RAG pipeline for document search
- OpenTelemetry observability (traces, metrics, logs → Grafana)
- Rate limiting (per-user + global), request sanitization, CORS, Helmet security
- Backup service with automated scheduling
- Webhook ingestion and routing

**Key Services:**
- `gpuMonitor` — real-time GPU utilization tracking
- `websocket` — bidirectional agent communication
- `openclawGateway` — agent framework integration
- `secondBrain` — Qdrant vector search integration
- `searchService` — unified search across all data sources
- `collaboration` — multi-user presence and comments
- `performanceMonitor` — alerting on latency/error spikes

**API Routes:** Files, workflows, analytics, templates, collaboration, backup, execute, shares, webhooks, fine-tune, integrations, auth, users, API keys, email, notebooks, RAG, models, meetings

## What Makes This Novel

A single backend that integrates AI agent management, vector search, multi-provider integrations, and real-time WebSocket communication — all with production-grade observability and security. Most AI dashboards are read-only monitoring; this one is a full control plane.
