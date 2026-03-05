# ALFIE Nexus Dashboard - New System Panel Sections

## Summary
Added 3 new sub-panels to the SYSTEM panel (#nvtop-card) below the existing GPU stats and TOP processes.

## Changes Made

### 1. Activity Timeline
**Location:** Bottom section of SYSTEM panel  
**Purpose:** Real-time scrolling feed of today's events with colored indicators

**Features:**
- 🟣 Purple dot = AI response
- 🟡 Amber dot = User message (shows first 40 chars)
- 🔵 Cyan dot = Tool call (with smart descriptions)
- 🟢 Green dot = Sub-agent spawned
- Format: `HH:MM ● description`
- Shows last 15 events, max 100 stored
- Auto-scrolls to newest (top)
- Compact: 0.58rem font, tight line spacing

**Implementation:**
- Frontend: `state.timeline[]` array tracks events
- `addTimelineEvent(dot, description, ts)` function
- `renderTimeline()` function updates display
- Listens to: `streaming_end`, `tool_call`, `user_message`, `agent_update`

### 2. Docker/Services Status
**Location:** Above Cost Burn Rate in SYSTEM panel  
**Purpose:** Show all Docker containers + PM2 services as colored status grid

**Features:**
- 🟢 Green dot = running/healthy
- 🔴 Red dot = stopped/error
- 🟡 Amber dot = restarting
- 3-column grid layout
- Names truncated to 15 chars
- Font: 0.58rem mono
- Refreshes every 10s via telemetry

**Implementation:**
- Backend: New `/api/services` endpoint in `server.js`
- `getServicesStatus()` function runs:
  - `docker ps --all --format '{{.Names}}\t{{.Status}}'`
  - `pm2 jlist`
- Returns: `{ docker: [{name, status, healthy}], pm2: [{name, status, uptime}] }`
- Frontend: `renderServices(services)` renders compact grid
- Integrated into telemetry broadcast (cached 10s)

### 3. Cost Burn Rate
**Location:** Above Activity Timeline in SYSTEM panel  
**Purpose:** Mini sparkline chart showing session cost accumulation over time

**Features:**
- Tracks `state.costHistory[]` — pushes `{ts, cost}` on every telemetry update
- SVG sparkline (height: 30px, width: 100%)
- Line color: green (steady), amber (accelerating), red (>$5/hr)
- Text display: `$X.XX/hr · $XX.XX projected today`
- Calculates rate from last 10 minutes of data points
- Color-coded acceleration detection

**Implementation:**
- Frontend: `updateCostBurnRate()` calculates hourly rate and projection
- `renderCostSparkline(history)` draws SVG polyline
- Stores last 30 data points (~1 minute at 2s intervals)
- Updates on every `token_usage` event

## Layout Structure
```
[GPU Stats - existing]
[Divider]
[TOP Processes - existing]
[Divider]
[Services Status - NEW, compact grid]
[Divider]
[Cost Burn Rate - NEW, sparkline + text]
[Divider]
[Activity Timeline - NEW, scrolling feed, takes remaining space]
```

## Files Modified

### Backend (server.js)
- Added `getServicesStatus()` function
- Added `/api/services` endpoint
- Integrated services into telemetry broadcast
- Added services caching (10s interval)

### Frontend (index.html)
- Added HTML structure for 3 new sections inside `#nvtop-card`
- Added `state.timeline[]` and `state.costHistory[]` arrays
- Added `addTimelineEvent()`, `renderTimeline()` functions
- Added `fetchServices()`, `renderServices()` functions
- Added `updateCostBurnRate()`, `renderCostSparkline()` functions
- Updated `handleMessage()` to track timeline events
- Updated `handleTelemetry()` to render services
- Updated `handleTokenUsage()` to track cost history
- Updated `startDataRefresh()` to fetch services every 10s

## Testing

### 1. Check Services Status
```bash
curl http://localhost:9001/api/services | jq
```
Should return Docker containers and PM2 processes.

### 2. Access Dashboard
```bash
# Dashboard is running on:
http://localhost:9001
```

### 3. Verify Real-Time Updates
- Open dashboard in browser
- Scroll to SYSTEM panel (right side)
- Check that:
  - Services grid shows running containers/processes with colored dots
  - Cost burn rate displays hourly rate and sparkline
  - Activity timeline populates with events as they occur

### 4. Test Timeline Events
- Send a message to ALFIE (should show 🟡 amber dot)
- Wait for AI response (should show 🟣 purple dot)
- Tool calls should show 🔵 cyan dots with descriptions
- Sub-agent spawns should show 🟢 green dots

## Style Guidelines
- Matches existing dashboard: oklch colors, var(--font-mono), var(--text-1/2/3)
- Compact fonts: 0.55-0.65rem
- Tight gaps (4-6px)
- Section dividers: `border-top: 1px solid oklch(0.25 0.02 270 / 0.3)`
- Each section has tiny header label in var(--text-3) uppercase

## Deployment
```bash
pm2 restart alfie-nexus
```

Server restarted successfully at 2026-02-11 08:12:52 UTC.

## Status
✅ **COMPLETE** - All three sections implemented and tested.
