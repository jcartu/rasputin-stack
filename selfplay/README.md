# Self-Play Training Pipeline

Autonomous self-improvement loop: generate tasks → solve them → validate solutions → collect training trajectories.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Task Gen   │ ──► │   Solver     │ ──► │  Validator   │ ──► │  Trajectory  │
│  (taskgen.py)│     │ (solver.py)  │     │  (in solver) │     │  Collector   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
      │                     │                     │                     │
      ▼                     ▼                     ▼                     ▼
  Diverse tasks        Solutions with        Pass/fail with        JSONL training
  at calibrated        step-by-step          error analysis        data ready for
  difficulty           reasoning                                   fine-tuning
```

## Components

### `taskgen.py` — Procedural Task Generation
- Generates diverse tasks across domains: coding, reasoning, creativity, analysis
- Difficulty calibration: easy → medium → hard → expert
- Automatic success criteria definition for each task
- Avoids repetitive patterns through domain rotation

### `solver.py` — Self-Play Problem Solver
- Solves generated tasks using local LLM
- Step-by-step reasoning traces captured
- Cross-validation between different model sizes
- Automatic failure analysis and retry with adjusted approach
- Difficulty escalation: if model consistently solves at current level, increase difficulty

### `pipeline.py` — Full Orchestration
- Ties together task generation → solving → trajectory collection
- Configurable batch sizes and difficulty distribution
- Progress tracking and metrics (solve rate, avg difficulty, domain coverage)
- Output: JSONL trajectories ready for fine-tuning or DPO

## What Makes This Novel

1. **Zero-cost training data** — all task generation and solving runs on local models. Produces training trajectories that can be used for fine-tuning without API costs.

2. **Difficulty calibration** — the system adapts difficulty based on solve rates. Too easy? Ramp up. Too hard? Back off. This keeps the training signal useful.

3. **Full trajectory capture** — not just final answers, but the complete reasoning trace: initial approach, tool calls, corrections, final solution. This is what makes self-play data valuable for training.
