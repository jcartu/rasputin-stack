# Context compaction keeps killing my work context — here's the system I built to fix it ($0.02/compaction, 761K memories)

If you've used Claude Code for more than a few hours, you know the pain: context fills up, compaction fires, and suddenly your agent can't remember why you chose that architecture, how you fixed that bug, or what the plan was.

I run autonomous Claude agents 24/7 and got tired of re-explaining context after every compaction. Built a pre-compaction memory rescue system that's been running in production for 3 months with zero amnesia. Just open-sourced it.

## The trick

Before compaction, intercept the context and fan out 3 parallel calls to a *cheap, fast* model (Cerebras Llama 70B — $0.10/MTok, 2000 tok/s) to extract three types of knowledge:

- **Facts** — configs, endpoints, version numbers, specs
- **Decisions** — what you chose and *why* (including rejected alternatives)
- **Skills** — debugging steps, workarounds, "gotchas" you discovered

These get scored for importance and committed to a vector database. When the agent needs context after compaction, it searches the vector DB. 16ms retrieval. Zero amnesia.

## Numbers

| Before | After |
|--------|-------|
| Decision recall: 23% | **89%** |
| Fact retention: 41% | **94%** |
| Procedural knowledge: 18% | **82%** |
| Cost per compaction: $0 | **$0.02** |

761K memories accumulated over 3 months. $45 total extraction cost.

## For Claude Code specifically

If you're using CLAUDE.md / AGENTS.md files, this is complementary — those files give the agent *instructions*, the operator Method gives it *episodic memory* of what actually happened in past sessions. The combination means your agent remembers both "how to do things" and "what we did and why."

**GitHub: [joperator/operator-method](https://github.com/joperator/operator-method)**

Works with Qdrant, ChromaDB, or Pinecone. Integrates with OpenClaw's pre-compaction hook, or use it standalone with any agent setup.
