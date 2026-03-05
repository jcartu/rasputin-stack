# Agent Orchestration

## Session Architecture

The main session is a **command center**, not a workbench. It handles conversation, quick lookups, and delegation. Everything else goes to sub-agents.

### The Golden Rule
**If a task takes more than 3-4 tool calls, spawn a sub-agent.**

### What Stays in Main Session
- Quick lookups (1-2 tool calls)
- Status checks
- Conversation with the user
- Spawning and monitoring sub-agents

### What Gets Delegated
- Debugging/investigating (reading logs, grepping, testing)
- Multi-step infrastructure changes
- Research (web searches, reading files, comparing data)
- Source code reading and analysis
- Building/deploying anything
- Data analysis

### Sub-Agent Model Selection
- **Local Qwen ($0)** — default for everything. Free, fast, 131K context.
- **Opus** — complex/high-stakes tasks only. Architecture decisions, multi-file refactoring, quality writing.

Rule: Start cheap. Escalate only when the task genuinely needs it.

## Cron Orchestration

30+ cron jobs run autonomously. Design principles:

1. **Cheap by default** — local LLM or heuristics, never paid API unless essential
2. **Idempotent** — safe to re-run; state tracking prevents duplicate work
3. **Fail-safe** — log errors, never crash the main agent
4. **Progressive** — heavy work split into small batches across runs

### Cron Categories
- **Memory maintenance** — fact extraction, enrichment, cleanup, graph deepening
- **Research** — AI scanning, multi-engine search, YouTube monitoring
- **Monitoring** — infrastructure health, anomaly detection, GPU tracking
- **Self-improvement** — self-play training, weekly synthesis

## Context Management

With a 200K token context window and complex multi-turn sessions:

| Threshold | Action |
|-----------|--------|
| 50% | Proactive warning |
| 70% | Save state, recommend new session |
| 80% | Hard stop — refuse new work |
| 90% | Emergency — only respond with "start new session" |

### Working Scratchpad
For complex multi-step tasks, a `working-context.md` file persists state across context compactions:
- Current task and key files
- Decisions made this session
- Important values/paths/states that would be lost

## Safety Rules

- **Risk scoring** — operations rated 1-10; ≥5 requires user confirmation
- **Trash before delete** — never `rm`, always `trash`
- **Backup before config** — snapshot configs before modifying
- **Protected infrastructure** — LLM proxy, agent gateway, Ollama, PM2 daemon are critical; mandatory change protocol (new version → temp port → verify → swap → verify → done)
- **Never overwrite running services** — always deploy to new file/port first
