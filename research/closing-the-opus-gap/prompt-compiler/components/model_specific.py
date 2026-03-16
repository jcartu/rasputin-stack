"""
MODEL_SPECIFIC component — model-aware prompt tweaks.

Research basis:
- Phase 6A Experiment 1: Qwen 235B is description-invariant (always 1.0 regardless
  of description richness). GLM-4.7 DEGRADES with richer descriptions (1.0 → 0.33,
  p=0.0002). Use bare/terse descriptions for GLM-4.7.

- Phase 6C Experiment 1 (cross-lingual):
  * GLM-4.7: Achieves 100% across ALL language variants (A-E) — Chinese-native model.
  * Qwen 235B: English-only (A) and Chinese-first (D) achieve 100%.
    Chinese-safety (B), bilingual (C), Chinese-terms (E) drop to 89%.
  → For GLM-4.7: Chinese-first ordering is safe and may help.
  → For Qwen 235B: English-only is the default; Chinese-first optional.

- Phase 3: GLM-4.7 fails catastrophically on tool selection with 50 tools
  (calendar_check → get_time substitution bug). Qwen 235B: perfect at all counts.
  → For GLM-4.7: Recommend keeping tool count ≤ 5 distinct tools.

- Phase 6A Experiment 4: GLM-4.7 completely refuses to call send_email (0/5).
  → Document this as a known limitation.

- Phase 2: FallbackChain rescues GLM-4.7 T2 (100%). Self-verify rescues Qwen T4.
  → Multi-pass strategy recommendations are model-dependent.

- Phase 6A Experiment 2 (ordering): Qwen 235B is ordering-invariant (all 1.0).
  GLM-4.7 shows extreme position sensitivity — recommend bare tool lists.

Design decisions:
- Model tweaks are returned as additional text appended AFTER the base prompt.
- GLM-4.7 gets a bare-description reminder (tool descriptions → names only).
- Qwen 235B gets no special treatment (already optimal with base components).
- Generic/Opus models get neutral defaults.
"""

from typing import Optional

# Model-specific addendum text
MODEL_TWEAKS: dict = {
    "glm-4.7": {
        "description_guidance": """Note: Select tools by name semantics, not description text. When uncertain between two similar tools, prefer the one whose NAME most closely matches the action required.""",
        "max_recommended_tools": 5,
        "use_chinese_first": False,  # Can be set True for Chinese deployments
        "known_limitations": ["send_email", "email"],
        "fallback_strategy": "FallbackChain",
    },
    "qwen-235b": {
        "description_guidance": None,  # Description-invariant — no guidance needed
        "max_recommended_tools": 50,   # Perfect at all tool counts (Phase 3)
        "use_chinese_first": False,    # English-only default; Chinese-first equivalent
        "known_limitations": [],
        "fallback_strategy": "FallbackChain",
    },
    "opus": {
        "description_guidance": None,
        "max_recommended_tools": 50,
        "use_chinese_first": False,
        "known_limitations": [],
        "fallback_strategy": "SelfVerify",
    },
    "generic": {
        "description_guidance": None,
        "max_recommended_tools": 15,
        "use_chinese_first": False,
        "known_limitations": [],
        "fallback_strategy": "FallbackChain",
    },
}

# Chinese-first prefix for GLM-4.7 deployments (Phase 6C Variant D)
CHINESE_FIRST_PREFIX: str = """重要规则：
- 精确使用工具，不要猜测
- 独立任务并行调用工具
- 拒绝访问敏感凭证文件

Important rules (English):"""


def get_model_tweaks(model: str) -> dict:
    """
    Return model-specific configuration and prompt tweaks.

    Args:
        model: Model identifier — "qwen-235b", "glm-4.7", "opus", or "generic".

    Returns:
        dict with keys:
            - description_guidance (Optional[str]): Additional text for description handling.
            - max_recommended_tools (int): Maximum tools before pruning is recommended.
            - use_chinese_first (bool): Whether to use Chinese-first ordering.
            - known_limitations (List[str]): Tool categories to avoid with this model.
            - fallback_strategy (str): Recommended multi-pass strategy.

    Research basis:
        Phase 6A E1: GLM-4.7 description sensitivity (p=0.0002).
        Phase 6C E1: Cross-lingual analysis — Chinese-first helps GLM, neutral for Qwen.
        Phase 3: GLM-4.7 tool scaling failures at 10+ tools.
    """
    # Normalize model name
    model_key = _normalize_model_name(model)
    return MODEL_TWEAKS.get(model_key, MODEL_TWEAKS["generic"])


def get_model_addendum(model: str, use_chinese_first: bool = False) -> Optional[str]:
    """
    Return any model-specific text to append to the compiled prompt.

    Args:
        model: Model identifier.
        use_chinese_first: Override to force Chinese-first ordering.

    Returns:
        Optional[str]: Additional text for model-specific behavior, or None.
    """
    model_key = _normalize_model_name(model)
    tweaks = MODEL_TWEAKS.get(model_key, MODEL_TWEAKS["generic"])

    parts = []

    if tweaks.get("description_guidance"):
        parts.append(tweaks["description_guidance"])

    should_chinese = use_chinese_first or tweaks.get("use_chinese_first", False)
    if should_chinese:
        # Chinese-first prefix goes at the TOP, not bottom — return special marker
        # Caller handles this case by prepending CHINESE_FIRST_PREFIX
        pass

    return "\n\n".join(parts) if parts else None


def _normalize_model_name(model: str) -> str:
    """
    Normalize various model name formats to internal keys.

    Args:
        model: Raw model name string.

    Returns:
        str: Normalized model key.
    """
    model_lower = model.lower()
    if "glm" in model_lower:
        return "glm-4.7"
    if "qwen" in model_lower or "235b" in model_lower:
        return "qwen-235b"
    if "opus" in model_lower or "claude" in model_lower:
        return "opus"
    return "generic"
