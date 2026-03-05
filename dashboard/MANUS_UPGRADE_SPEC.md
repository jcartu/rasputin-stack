# Manus-Style Dashboard Upgrade Spec

## Goal
Transform the Nexus dashboard (manus-v2.html) into a full Manus-style workspace where you can watch the AI agent think and work in real-time — see shell commands execute, files being read/written, browser actions, coding agent output, all live.

## Current State
- `manus-v2.html` exists (2940 lines, cyberpunk theme) with basic panels
- Gateway WebSocket bridge in `server.js` (line 1340+) streams agent events
- Bridge currently handles: `token_stream`, `thinking`, `tool_call` (start only), `streaming_end`, `chat_final`, `openclaw:health`
- Bridge MISSES: tool `update`, `result`, `end`, `error` phases (only catches `start`)

## Architecture

### Backend Changes (server.js, gateway bridge section ~line 1340)

The gateway sends `agent` events with `stream: "tool"` and `data.phase`:
- `start` — tool call begins (has `data.name`, `data.args`, `data.toolCallId`)
- `update` — partial result streaming (has `data.partialResult`)
- `result` — final tool result (has `data.result` or `data.meta`)
- `end` — tool call complete
- `error` — tool call failed (has `data.isError`)

**Required bridge changes:**

1. Forward ALL tool phases to dashboard clients:
```javascript
// In the gateway message handler, replace the current tool handling:
else if (stream === 'tool') {
  const phase = data.phase || 'start';
  const toolCallId = data.toolCallId;
  
  if (phase === 'start' && data.name) {
    broadcast({
      type: 'tool_start',
      tool: data.name,
      input: data.args || data.input || {},
      id: toolCallId,
      description: smartToolDescription(data.name, data.args || data.input || {}),
      ts,
    });
    // Track file modifications
    if (data.name === 'write' || data.name === 'edit') {
      const fp = (data.args || data.input || {})?.file_path || (data.args || data.input || {})?.path || '';
      if (fp) broadcast({ type: 'file_modified', path: fp, action: data.name, ts });
    }
  }
  
  if (phase === 'update' && data.partialResult) {
    broadcast({
      type: 'tool_output',
      id: toolCallId,
      text: typeof data.partialResult === 'string' ? data.partialResult : JSON.stringify(data.partialResult).slice(0, 2000),
      partial: true,
      ts,
    });
  }
  
  if (phase === 'result') {
    const resultText = data.meta || data.result || '';
    broadcast({
      type: 'tool_result', 
      id: toolCallId,
      text: typeof resultText === 'string' ? resultText : JSON.stringify(resultText).slice(0, 4000),
      ts,
    });
  }
  
  if (phase === 'end') {
    broadcast({ type: 'tool_end', id: toolCallId, ts });
  }
  
  if (phase === 'error' || data.isError) {
    broadcast({
      type: 'tool_error',
      id: toolCallId,
      text: data.error || data.meta || 'Tool call failed',
      ts,
    });
  }
}
```

### Frontend Changes (manus-v2.html)

Redesign to mirror Manus AI's layout:

#### Layout (3-column on desktop, stack on mobile)
```
┌──────────────────────────────────────────────────────────────┐
│ HEADER: Rasputin Nexus • Status indicators • Connection      │
├────────────┬─────────────────────────────┬───────────────────┤
│            │                             │                   │
│  STEPS     │     MAIN VIEWPORT           │   DETAILS         │
│  TIMELINE  │                             │   PANEL           │
│            │  Tabs:                      │                   │
│  - Each    │  [Terminal] [Code] [Browser]│  - System status  │
│    tool    │  [Output]                   │  - GPU metrics    │
│    call    │                             │  - Sub-agents     │
│    as a    │  Shows live content based   │  - Files modified │
│    step    │  on current active tab      │  - Session info   │
│            │                             │                   │
│  Scrolls   │  Terminal: live exec output │                   │
│  auto      │  Code: file content + diffs │                   │
│            │  Browser: screenshots       │                   │
│            │  Output: assistant text     │                   │
│            │                             │                   │
└────────────┴─────────────────────────────┴───────────────────┘
```

#### Steps Timeline (Left Panel)
Each tool call becomes a step:
- Icon based on tool type (terminal icon for exec, file icon for read/write, globe for web, brain for thinking)
- Short description (from `smartToolDescription`)
- Timestamp
- Status indicator: spinning = in progress, check = done, X = error
- Expandable to show tool input/output
- Auto-scrolls to latest step
- Clicking a step switches the main viewport to show its content

**Step grouping:**
- `exec` → Terminal tab
- `read`/`write`/`edit` → Code tab  
- `browser`/`web_search`/`web_fetch` → Browser tab
- `thinking` → Shows inline in steps with dimmed text
- `token_stream` → Output tab

#### Main Viewport (Center Panel)

**Terminal Tab:**
- Dark terminal background (JetBrains Mono font)
- Shows command being executed (green prompt)
- Streams stdout in white, stderr in red
- Supports ANSI color codes (use a simple ANSI→HTML converter)
- Auto-scrolls
- Shows "Running..." spinner while command executes
- When a new exec tool starts, adds a separator with the command

**Code Tab:**
- Shows file content when `read` tool is used
- Shows diff when `edit` tool is used (old → new with red/green highlighting)
- Shows file path in a breadcrumb bar at top
- Basic syntax highlighting (at minimum, different colors for strings, comments, keywords)
- Line numbers

**Browser Tab:**
- When `browser` tool with `screenshot` action → show the image
- When `web_search` → show search query and results
- When `web_fetch` → show fetched content in a reader view

**Output Tab:**
- Live streaming assistant text (token by token)
- Thinking blocks shown in a dimmed/italic style
- Final formatted message with markdown rendering

#### Details Panel (Right, collapsible)
- System metrics (CPU, RAM, GPU) — already exists in telemetry
- Active sub-agents with status
- Files modified during this session
- Session info (model, tokens used)
- Connection status to gateway

#### Auto-Tab Switching
When a new tool event comes in, automatically switch the main viewport tab:
- `exec` → switch to Terminal
- `read`/`write`/`edit` → switch to Code
- `browser` screenshot → switch to Browser
- `token_stream` (assistant) → switch to Output

This gives the "watching the agent work" effect like Manus.

### Visual Design
Keep the existing cyberpunk theme from manus-v2.html (yellow/cyan neon, dark background, angular panels). The aesthetic is good — we're just restructuring the layout and adding real content to the panels.

### Key CSS Requirements
- Use CSS Grid for the 3-column layout
- Steps timeline: max-width 280px, scrollable
- Main viewport: flex-grow, min-height 500px
- Details panel: max-width 300px, collapsible
- All panels should have the existing `cyber-panel` glass effect
- Terminal should use the existing `terminal-body` styles
- Responsive: on mobile, stack vertically (steps → viewport → details)

### WebSocket Message Types to Handle

From gateway bridge:
- `tool_start` — new step in timeline, switch tab based on tool
- `tool_output` — stream output to appropriate tab (terminal stdout for exec)
- `tool_result` — final result, mark step as complete
- `tool_end` — cleanup
- `tool_error` — mark step as failed, show error
- `token_stream` — stream to Output tab
- `thinking` — show in steps timeline + Output tab (dimmed)
- `streaming_start` / `streaming_end` — lifecycle
- `telemetry` — update details panel
- `user_message` — show in Output tab as user input

### Files to Modify
1. `server.js` — Update gateway bridge tool handling (lines ~1461-1475)
2. `public/manus-v2.html` — Complete redesign of layout and JS handlers

### Testing
After changes:
1. `pm2 restart alfie-nexus --update-env`
2. Open `dash.rasputin.to/manus-v2.html`
3. Send a message to the agent in Telegram
4. Verify: steps appear in timeline, terminal shows exec output, code shows file reads, output streams text

### Important Notes
- Keep the existing auth system (token-based WebSocket auth)
- Keep the existing telemetry/metrics infrastructure
- Don't break the main index.html dashboard
- manus-v2.html is a SEPARATE page, standalone
- All in a single HTML file (inline CSS + JS, no build step)
- The file is already ~2940 lines — keep it manageable, replace rather than append
