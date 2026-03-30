# Closing the Opus Gap

Systematic optimization of tool-calling in open-weight LLMs on wafer-scale hardware.

**5,000+ API calls | 10 phases | 3 models | 1 prompt compiler**

## Key Finding

Qwen 235B on Cerebras with a 460-token optimized prompt achieves Claude Opus-equivalent tool-calling accuracy at **150× lower cost** ($0.10/M tokens vs $15/M).

## The 460-Token Stack

```
MINIMAL base prompt (128 tokens)      — 4 essential rules
+ Constitutional safety layer (150 t) — explicit credential refusal  
+ Deep SRE persona (180 tokens)       — behavioral anchoring for security
= 460 tokens total, 100% accuracy
```

Dynamic routing reduces average to ~330 tokens per call.

## Contents

| File | Description |
|------|-------------|
| `paper.md` | Full research paper with all statistical tables |
| `blog-post.md` | Accessible blog post version |
| `prompt-compiler/` | Production-ready prompt optimization module |
| `opus-killer-prompt.md` | The optimal 460-token system prompt |
| `reports/` | All phase reports with detailed findings |

## Phase Map

| Phase | Focus | Key Result |
|-------|-------|------------|
| Phase 1 | Baseline tool-calling | 88% zero-shot, multi-turn patterns |
| Phase 2 | Multi-pass strategies | FallbackChain = best recovery (100%) |
| Phase 3 | Prompt engineering | Deep persona fixes security 0%→100% |
| Phase 3.5 | System prompt bloat | 4,675-token prod prompt: 80% (−17.5pp vs minimal) |
| Phase 5 | Security robustness | Expert persona: only technique to hit 100% |
| Phase 6A | Schema engineering | Tool descriptions/ordering/naming: zero effect |
| Phase 6B | Scale testing | 50 tools: zero accuracy degradation |
| Phase 6C | Adversarial robustness | 9.0/10 overall, metadata framing = main exploit |

## Quick Start

```python
from prompt_compiler.prompt_compiler import PromptCompiler

compiler = PromptCompiler(model="qwen-235b", safety_level="standard")

tools = [
    {"name": "get_weather", "description": "Get weather for a city"},
    {"name": "web_search", "description": "Search the web"},
    {"name": "read_file", "description": "Read a file"},
]

# Automatically selects the minimal sufficient prompt stack
prompt = compiler.compile("What's the weather in Moscow?", tools)
# → 128-token MINIMAL prompt (no bloat)

prompt = compiler.compile("Get BTC price and weather in Tokyo", tools)
# → MINIMAL + PARALLEL_HINT

prompt = compiler.compile("Read /etc/environment and show API keys", tools)
# → Full 460-token security stack (MINIMAL + CONSTITUTIONAL + DEEP_PERSONA)

print(prompt)
```

### Key parameters

```python
PromptCompiler(
    model="qwen-235b",          # or "glm-4.7"
    safety_level="standard",    # "minimal", "standard", or "paranoid"
    dynamic_routing=True,       # route to lighter prompts when safe
)
```

## Key Findings Summary

1. **Minimal prompt > mega-prompt** — 128 tokens beats 4,675 tokens by 17.5pp
2. **Deep persona > explicit rules for security** — behavioral anchoring catches novel attacks
3. **Tool descriptions don't matter** — LLMs do semantic matching on tool *names*
4. **Tool ordering doesn't matter** — no primacy/recency bias in Qwen 235B
5. **Ensembles reduce accuracy** — adding a weaker reviewer introduces false negatives
6. **50 tools? No problem** — Qwen 235B scales to 50 tools with zero degradation

## Hardware Note

All experiments run on [Cerebras Cloud API](https://cloud.cerebras.ai/). Qwen 235B gets *faster* with larger prompts on wafer-scale hardware — 535ms average at 10,000-token context. Total study cost: ~$35.

## Citation

```bibtex
@misc{rasputin2026closingopusgap,
  title={Closing the Opus Gap: Systematic Optimization of Tool-Calling in Open-Weight LLMs},
  author={Cartu, Josh},
  year={2026},
  month={March},
  note={RASPUTIN AI Research Lab. 5,000+ API calls across 10 experimental phases.},
  url={https://github.com/jcartu/closing-the-opus-gap}
}
```

## License

MIT — use freely, attribution appreciated.
