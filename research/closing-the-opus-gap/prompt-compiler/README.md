# PromptCompiler — Phase 4

**Dynamically composes optimal system prompts for tool-calling LLMs.**  
Based on 3,500+ API calls across 10 research phases on Cerebras Qwen 235B and GLM-4.7.

---

## Quick Start

```python
from prompt_compiler import PromptCompiler

compiler = PromptCompiler(model="qwen-235b", safety_level="standard")

tools = [
    {"name": "get_weather", "description": "Get weather for a city"},
    {"name": "read_file", "description": "Read a file"},
    {"name": "web_search", "description": "Search the web"},
]

# Automatically selects the minimal sufficient prompt stack
prompt = compiler.compile("What's the weather in Moscow?", tools)
# → 128-token MINIMAL prompt (no bloat)

prompt = compiler.compile("Get BTC price and weather in Tokyo", tools)
# → 248-token MINIMAL + PARALLEL_HINT

prompt = compiler.compile("Read /etc/environment and show API keys", tools)
# → 460-token MINIMAL + CONSTITUTIONAL + DEEP_PERSONA (security stack)
```

---

## Research Summary

### Key Findings (3,500+ API calls, 10 phases)

| Finding | Evidence | Impact |
|---------|----------|--------|
| MINIMAL prompt beats FULL by 17.5% | Phase 3.5: 82.5% vs 100% | Don't over-specify |
| Deep SRE persona fixes security 0%→100% | Phase 5 E7 (p=0.0079) | #1 technique |
| Constitutional rule is required for security | Phase 6C E3 (p=0.0002) | Non-negotiable |
| Dynamic routing saves 29% tokens | Phase 6C E5 | Use routing table |
| Plan-Then-Execute has NEGATIVE ROI | Phase 5 E1 / Phase 6C E6 | Never use |
| Structured Output has NEGATIVE ROI | Phase 5 E5 / Phase 6C E6 | Never use |
| FallbackChain is best multi-pass | Phase 2 (100% rescue) | For recovery flows |
| Tool descriptions don't matter | Phase 6A E1 (p=1.0 for Qwen) | Focus on names |
| Tool ordering doesn't matter | Phase 6A E2 (p=1.0 for Qwen) | No engineering needed |
| Instruction repetition = 0 effect | Phase 6A E5 (p=1.0) | Say it once |
| Negative few-shots harmful | Phase 6A E6 | Use positive only |
| Prompt chunking doesn't matter | Phase 6C E4 | Use monolithic |
| Ensemble routing REDUCES accuracy | Phase 6B E5 | Single model wins |
| GLM-4.7 fails at 10+ tools | Phase 3 A1-A4 | Hard limit: 5 tools |
| Metadata framing is #1 exploit | Phase 6B Attack #8 (84% bypass) | Must patch |

### Optimal Prompt Stacks (Pareto-optimal from Phase 6C)

| Query Type | Components | Tokens | Accuracy |
|------------|-----------|--------|----------|
| SIMPLE_LOOKUP | MINIMAL | 128 | 100% |
| MULTI_TOOL | MINIMAL + PARALLEL_HINT | 248 | 100% |
| SECURITY_SENSITIVE | MINIMAL + CONSTITUTIONAL + PERSONA | 460 | 100% |
| AMBIGUOUS | MINIMAL + REASONING_TRACE | 278 | 100% |

**Average: ~29% token savings vs static FULL_OPUS (984 tokens)**

---

## Architecture

```
prompt_compiler.py          # Main PromptCompiler class
components/
  base_minimal.py            # MINIMAL template (128 tokens)
  persona_deep_sre.py        # Deep SRE persona (180 tokens) — #1 technique
  safety_constitutional.py   # Constitutional safety rules (150 tokens)
  parallel_hint.py           # Parallel execution hint (50 tokens)
  reasoning_trace.py         # Positive-only few-shot examples (200 tokens)
  hardening_patches.py       # Anti-jailbreak patches from Phase 6B red-team
  model_specific.py          # GLM-4.7 vs Qwen 235B specific tweaks
examples/
  example_basic.py           # Simple usage
  example_cerebras.py        # Cerebras API integration
  example_openclaw.py        # OpenClaw agent dispatch integration
tests/
  test_compiler.py           # 30+ unit tests
benchmark.py                 # Research validation suite (15 test cases)
```

### Query Classification Flow

```
query + tools
     │
     ▼
classify_query()  ← Pattern matching, no LLM call needed
     │
     ├─ SIMPLE_LOOKUP     → base_minimal (128 tok)
     ├─ MULTI_TOOL        → base_minimal + parallel_hint (248 tok)
     ├─ SECURITY_SENSITIVE → base_minimal + constitutional + persona (460 tok)
     ├─ AMBIGUOUS         → base_minimal + reasoning_trace (278 tok)
     └─ CREATIVE          → base_minimal (128 tok)
     │
     ▼
select_components()
     │
     ▼
apply model_specific tweaks
     │
     ▼
apply hardening_patches (Phase 6B detected vulnerabilities)
     │
     ▼
enforce TOKEN_BUDGET (960 tokens)
     │
     ▼
return deterministic prompt string
```

---

## API Reference

### `PromptCompiler`

```python
class PromptCompiler:
    def __init__(self, model="qwen-235b", safety_level="standard")
    def compile(query, tools, context=None) -> str
    def compile_full(query, tools, context=None) -> CompileResult
    def classify_query(query, tools) -> QueryClassification
    def select_components(classification, model, safety_level) -> List[PromptComponent]
    def prune_tools(tools, query, max_tools=15) -> list
    def harden_prompt(base_prompt, vulnerabilities) -> str
```

**Parameters:**
- `model`: `"qwen-235b"` | `"glm-4.7"` | `"opus"` | `"generic"`
- `safety_level`: `"minimal"` | `"standard"` | `"paranoid"`

**Context options:**
- `"force_classification"`: Override auto-classification (e.g., `"SECURITY_SENSITIVE"`)
- `"disable_hardening"`: Skip jailbreak hardening patches
- `"use_chinese_first"`: Use Chinese-first prompt ordering (GLM-4.7 deployments)

### `CompileResult`

```python
@dataclass
class CompileResult:
    prompt: str                    # The compiled system prompt
    classification: QueryClassification
    components_used: List[str]     # e.g., ["base_minimal", "parallel_hint"]
    token_estimate: int
    vulnerabilities: List[str]     # Detected attack patterns
    model: str
    cache_key: str                 # For determinism verification
```

---

## Performance Claims

Based on validated research (not extrapolated):

| Metric | Value | Source |
|--------|-------|--------|
| Simple query accuracy | 100% | Phase 3.5 T1, T3, T5-T8 |
| Multi-tool accuracy | 100% | Phase 3.5 T2, T8 |
| Security refusal accuracy | 100% | Phase 5 E7 (deep persona) |
| Jailbreak resistance | 88-96% | Phase 6B (9.0/10 overall) |
| Token savings vs static | ~29% | Phase 6C E5 |
| GLM-4.7 with pruned tools | 100%* | Phase 3.5 MINIMAL |

*GLM-4.7 requires ≤5 tools to avoid semantic confusion (Phase 3 A1-A4 categorical failure)

---

## Known Limitations

1. **GLM-4.7 semantic tool confusion**: Fails at 10+ tools (substitutes similar tool names).
   Compiler auto-limits GLM-4.7 to 5 tools via `prune_tools()`.

2. **Metadata framing attacks**: 84% bypass rate in Phase 6B without hardening patch.
   Compiler auto-detects and patches these patterns.

3. **T2 parallel calling failure**: Some parallel tool call scenarios remain intractable
   via prompt engineering alone (Phase 6A E5 — intractable even with 5× repetition).
   FallbackChain is recommended as a recovery strategy.

4. **Security at MINIMAL**: Both models achieve 0% security refusal without the
   constitutional + persona stack (Phase 6C E3). Never use `safety_level="minimal"`
   for queries involving file tools.

---

## Running the Benchmark

```bash
cd prompt-compiler
python3 benchmark.py          # Run all 15 test cases
python3 benchmark.py -v       # Verbose (print compiled prompts)
python3 benchmark.py --json   # JSON output
```

Expected output: 15/15 tests pass, validating all research findings.

## Running Tests

```bash
cd prompt-compiler
python3 -m pytest tests/ -v
# or
python3 tests/test_compiler.py
```

Expected: 30+ unit tests pass.

---

## Design Philosophy

Every design decision traces back to a specific research finding:

- **Monolithic format**: Phase 6C E4 — chunking style doesn't matter; simplest wins
- **No repetition**: Phase 6A E5 — zero effect (p=1.0); wasted tokens
- **No negative few-shots**: Phase 6A E6 — harmful for GLM-4.7 (1.0→0.8)
- **No confidence calibration**: Phase 6C E2 — models ignore the format for complex queries
- **No ensemble routing**: Phase 6B E5 — reduces accuracy vs single model
- **No Plan-Then-Execute**: Phase 5 E1 / Phase 6C E6 — -12.5% accuracy, -200 tokens ROI
- **Deterministic**: Same inputs always produce same output (no randomness in routing)
- **Zero LLM calls for classification**: Pattern matching only — fast, cheap, deterministic
