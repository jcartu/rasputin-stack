# AI Council & Swarm Protocol

Multi-model debate, synthesis, and swarm coordination for complex decision-making.

## Components

### `council.py` — Multi-Model Council & Synthesis (v2)

Four operation modes for different complexity levels:

**Auto Mode:** Gemini Flash classifies the query complexity, then routes to the appropriate mode:
- Simple questions → fast synthesis
- Complex questions → full council debate

**Synthesis Mode:** All models answer in parallel, judge synthesizes:
```
Question ──┬── Sonnet ──► Response
           ├── GPT-5.2 ──► Response    ──► Opus Judge ──► Synthesis
           ├── Gemini Flash ──► Response
           └── Grok Fast ──► Response
```

**Council Mode:** Full multi-round debate between frontier models:
```
Round 1: All models give initial positions
Round 2: Models read others' positions, can update/rebut
Judge: Opus synthesizes with weighted scoring (Frontier=3x, Strong=2x, Fast=1x)
```

**Fractal Mode:** Spawns 4 specialized sub-agents, each researches independently:
```
Question ──┬── Researcher (200s)        ──► Deep background analysis
           ├── Counter-Argument (200s)  ──► Devil's advocate
           ├── Feasibility (200s)       ──► Practical constraints    ──► Opus Synthesis
           └── Creative (200s)          ──► Lateral thinking
```

### Features:
- **Tiered model registry**: Frontier (Opus, GPT-5.2, Gemini Pro, Grok Reasoning) → Strong → Fast → Local
- **Weighted scoring**: Tier-based weights in synthesis (3x for frontier, 0.5x for local)
- **Streaming JSONL events**: Real-time progress updates as models respond
- **Multi-provider routing**: Anthropic, OpenRouter, Ollama, Groq, Cerebras, xAI
- **Configurable panels**: Choose which models participate per mode

### `swarm_protocol.py` — Peer-to-Peer Agent Communication

Redis-backed blackboard for direct agent-to-agent communication:
- Each agent gets a unique swarm ID and role
- Agents broadcast messages, hand over tasks, and spawn shadow agents
- Shadow agents: spawn a new agent with a different profile when the current one is blocked
- Full message history persisted for debugging and visualization
- Lineage tracking for agent genealogy

## What Makes This Novel

1. **Fractal sub-agent spawning** — instead of just asking multiple models the same question, spawn specialized sub-agents that each research a different angle independently before synthesis. More expensive, but dramatically better for complex decisions.

2. **Tier-weighted synthesis** — not all model opinions are equal. A frontier model's perspective carries 3x the weight of a fast model. This prevents cheap fast models from drowning out higher-quality frontier analysis.

3. **Auto mode classification** — avoids over-engineering simple questions. A fast classifier decides whether to use synthesis (fast, cheap) or full council (slow, expensive) based on query complexity.

4. **Shadow agents** — when an agent hits a wall (blocked, rate-limited, wrong profile), spawn a new agent with different capabilities rather than failing.
