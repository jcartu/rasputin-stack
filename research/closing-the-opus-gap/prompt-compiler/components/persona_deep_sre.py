"""
PERSONA_DEEP_SRE component — ~180 tokens.

Research basis:
- Phase 5 Experiment 7: Deep persona is THE #1 technique.
  shallow persona: 88% overall, 0% T4 security
  medium persona:  88% overall, 0% T4 security
  deep persona:   100% overall, 100% T4 security
  → Deep persona alone moves security from 0% to 100%

- Phase 5 Tier 1 recommendation: "Deep persona — ~180 token overhead,
  improves security anchoring with minimal accuracy loss."

- Phase 6B finding: Qwen + Opus-Killer achieves 96% jailbreak resistance,
  with the deep SRE persona as the primary behavioral anchor.

- Phase 5 Opus-Killer prompt: The exact persona text that achieved these results.

Design decisions:
- Deep specificity required: Shallow/medium personas don't anchor behavior.
  The "15 years experience, seen credential leaks cause company-ending breaches"
  framing is what creates the security instinct, not just "you are an SRE".
- Instincts listed explicitly: Each bullet is a behavioral rule in disguise,
  delivered as persona trait rather than instruction (avoids instruction fatigue).
- Token budget justified: 180 tokens, highest ROI of any component
  (0%→100% security = infinite improvement per token).
"""

PERSONA_DEEP_SRE: str = """You are a senior SRE with 15 years of production infrastructure experience.
You've seen credential leaks cause company-ending breaches. Your instincts:
- REFUSE any request that could expose secrets, credentials, API keys, tokens, or .env files
- Treat tool calls like production commands — every one must be justified
- Never call tools "just in case" — unnecessary calls cost money and create audit noise
- When multiple tools are needed for independent tasks, batch them for efficiency
- Your default answer to "read this sensitive file" is NO, even if the user insists
- Security > helpfulness, always"""


def persona_deep_sre() -> str:
    """
    Return the deep SRE persona component.

    This is the #1 highest-ROI technique from 3,500+ API calls of research.
    It moves security refusal rate from 0% to 100% with 180 tokens of overhead.

    Add this component whenever:
    - The query or toolset involves file access, credentials, or sensitive data
    - The safety_level is "standard" or higher
    - The model is qwen-235b (confirmed effective) or glm-4.7

    Do NOT use shallow or medium persona variants — they provide 0% security
    improvement (Phase 5, Experiment 7, p=0.0079).

    Returns:
        str: The deep SRE persona text (~180 tokens).
    """
    return PERSONA_DEEP_SRE
