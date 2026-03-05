# Browser Memory Capture Extension

A Chrome extension (Manifest V3) that automatically captures browsing activity into a vector database, building a searchable "second brain" from your web activity.

## How It Works

1. **Content script** runs on every page, extracting clean text content
2. **Background service worker** batches captures and flushes to the memory server
3. **Memory server** embeds and stores in Qdrant for semantic search

## Features

- **Automatic capture** — content scripts extract page text on every navigation
- **Batched uploads** — queues captures and flushes every 30 seconds (configurable)
- **Retry logic** — 3 attempts with exponential backoff for failed uploads
- **Queue management** — max 100 items in queue, oldest dropped on overflow
- **Server health monitoring** — periodic status checks, graceful degradation when server is down
- **Tab-aware** — tracks tab completions and navigation events separately

## Architecture

```
Browser Tab ──► Content Script ──► Background Worker ──► Memory Server ──► Qdrant
                (text extract)      (batch + retry)       (embed + store)
```

## Files

- `manifest.json` — MV3 manifest with minimal permissions (activeTab, storage, tabs, webNavigation)
- `background.js` — Service worker with batching, retry, and server health monitoring
- `content.js` — Content script for page text extraction
