"""
PARALLEL_HINT component — ~50 tokens.

Research basis:
- Phase 1: PARALLEL_HINT template is the #1 ranked template (88.9% overall),
  specifically winning on test2_multi (100% for both models) and test4_parallel
  where Qwen 235B fails with BASELINE (0%) but succeeds with PARALLEL_HINT (100%).

- Phase 3.5 Section Analysis: "Call multiple independent tools in parallel"
  identified as one of the key directives that HELPS tool calling.
  Already included in BASE_MINIMAL, but this component adds a concrete example.

- Phase 5 Opus-Killer prompt: Explicit parallel example in reasoning trace
  shows the model calling two tools simultaneously with explicit justification.

- Phase 6C Experiment 1 (cross-lingual): MULTI_TOOL queries route to
  MINIMAL + PARALLEL_INSTRUCTION (~248 tokens) in the dynamic router.

Design decisions:
- Concrete example included: The example format from the Opus-Killer prompt
  (showing simultaneous tool calls) is more effective than the abstract instruction.
- Kept minimal: Phase 3.5 shows the instruction itself works; no need to over-explain.
- Note: The T2 parallel calling failure (Phase 6A Experiment 5) persists under
  all repetition conditions. This component helps for native parallel-capable
  scenarios but cannot force parallel calling when the model doesn't natively
  emit simultaneous tool calls in a single response.
"""

PARALLEL_HINT: str = """For requests requiring multiple independent pieces of information, call all relevant tools simultaneously in a single response batch. Do not wait for one result before requesting another if the calls are independent.

Example: "Get Bitcoin price and check the weather in Moscow" → call get_crypto_price AND get_weather in the same response, not sequentially."""


def parallel_hint() -> str:
    """
    Return the parallel execution hint component.

    Adds an explicit instruction and concrete example for parallel tool execution.
    Most effective for MULTI_TOOL classified queries where the model needs a hint
    to batch independent tool calls.

    Phase 1 finding: PARALLEL_HINT is the top-ranked template overall (88.9%),
    specifically rescuing Qwen 235B on parallel queries from 0% → 100%.

    Returns:
        str: The parallel execution hint text (~50 tokens).
    """
    return PARALLEL_HINT
