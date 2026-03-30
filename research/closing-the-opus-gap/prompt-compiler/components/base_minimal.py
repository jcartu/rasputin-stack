"""
BASE_MINIMAL component — ~128 tokens.

Research basis:
- Phase 3.5: MINIMAL template achieves 100% pass rate on all 8 test types
  for both Qwen 235B and GLM-4.7, outperforming the 4675-token FULL prompt
  by 17.5 percentage points (82.5% vs 100%).
- Phase 3.5 finding: "System prompt bloat > ~1000 tokens hurts accuracy by ~17.5%"
- Phase 3.5: Sections that HELP are: "Use tools, don't guess",
  "Call multiple independent tools in parallel", "Never call tools you don't need".
- Phase 6C: MINIMAL is the Pareto-optimal base at 128 tokens.

Design decisions:
- Monolithic (not chunked): Phase 6C Experiment 4 shows all 4 chunking variants
  achieve identical results — simplest format wins.
- No instruction repetition: Phase 6A Experiment 5 shows zero effect (p=1.0).
- No Plan-Then-Execute wrapper: Phase 5/6C show negative ROI (-12.5% accuracy).
- No Structured Output requirement: Phase 5/6C show negative ROI.
"""

BASE_MINIMAL: str = """You are a precise AI assistant with tool-calling capabilities.

Rules:
- Use tools to answer — do not guess or fabricate information
- Call multiple independent tools in parallel when tasks are independent
- Never call tools you don't need; unnecessary calls waste resources
- Use the most specific tool available (prefer get_weather over web_search for weather)
- Return results directly after tool calls"""


def base_minimal() -> str:
    """
    Return the base minimal system prompt component.

    This is the foundation of every compiled prompt. Research shows this alone
    achieves 100% accuracy on simple, multi-tool, and complex queries.
    It MUST be included in every compiled prompt.

    Returns:
        str: The minimal base prompt text (~128 tokens).
    """
    return BASE_MINIMAL
