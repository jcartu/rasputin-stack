"""
REASONING_TRACE component — ~200 tokens.

Research basis:
- Phase 5 Experiment 4 (Reasoning Trace Few-Shots): Overall 100% pass rate
  on T2 (parallel), T3 (tool selection), T5 (sequential). Matches MINIMAL
  baseline with no degradation — the reasoning trace is neutral-to-positive.

- Phase 6C: AMBIGUOUS queries route to MINIMAL + REASONING_TRACE (~278 tokens).
  Provides context for tool selection decisions without the security overhead.

- Phase 5 Opus-Killer prompt: Three concrete reasoning examples covering
  parallel, sequential, and security scenarios.

- Phase 6A Experiment 6: "good_only" few-shots achieve parity with complex styles.
  Negative examples are useless or slightly harmful (bad_good_bad degrades GLM-4.7).
  → Only POSITIVE examples included here.

Design decisions:
- Positive examples only: Phase 6A proves negative few-shots don't help and
  can hurt (GLM-4.7 T3 degraded from 1.0 → 0.8 with bad_good_bad sandwich).
- Three examples cover: parallel, sequential-dependency, and security refusal.
- Chain-of-thought format: Phase 1 CHAIN_OF_THOUGHT template ranked #8 (83.3%)
  but the Reasoning Trace format from Opus-Killer achieves 100% — the difference
  is inline thinking notation, not separate <think> tags.
- Excluded from SECURITY path: Constitutional + Persona already handle security.
  This component is for AMBIGUOUS and MULTI_TOOL where reasoning clarity helps.
"""

REASONING_TRACE: str = """Examples of correct tool selection reasoning:

<example>
User: Check the weather in Paris and search for restaurant reviews
Thinking: Two independent tasks. Weather → get_weather(city='Paris'). Reviews → web_search(query='Paris restaurant reviews'). Independent → call both simultaneously.
Action: [calls get_weather AND web_search in parallel]
</example>

<example>
User: Get Bitcoin price and email it to alice@example.com
Thinking: Sequential dependency — need the price before composing the email. get_crypto_price first, then send_email with the price in the body.
Action: [calls get_crypto_price, then send_email with price data]
</example>

<example>
User: Check the server
Thinking: Ambiguous but context implies monitoring. Relevant tools: system_stats, process_list. Call both to get a complete picture. web_search is not appropriate here.
Action: [calls system_stats AND process_list]
</example>"""


def reasoning_trace() -> str:
    """
    Return the reasoning trace few-shot examples component.

    Provides positive-only examples of correct tool selection reasoning.
    Useful for AMBIGUOUS queries and MULTI_TOOL scenarios where the model
    benefits from seeing the decision process modeled explicitly.

    Phase 5 Experiment 4: Reasoning trace achieves 100% on T2/T3/T5.
    Phase 6A Experiment 6: Negative examples harmful — only positive included.

    Returns:
        str: Reasoning trace examples (~200 tokens).
    """
    return REASONING_TRACE
