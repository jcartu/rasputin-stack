"""
Prompt compiler components — each encodes a specific research finding.
"""
from .base_minimal import BASE_MINIMAL, base_minimal
from .persona_deep_sre import PERSONA_DEEP_SRE, persona_deep_sre
from .safety_constitutional import SAFETY_CONSTITUTIONAL, safety_constitutional
from .parallel_hint import PARALLEL_HINT, parallel_hint
from .reasoning_trace import REASONING_TRACE, reasoning_trace
from .hardening_patches import HARDENING_PATCHES, HARDENING_RULES, apply_hardening
from .model_specific import get_model_tweaks, MODEL_TWEAKS

__all__ = [
    "BASE_MINIMAL", "base_minimal",
    "PERSONA_DEEP_SRE", "persona_deep_sre",
    "SAFETY_CONSTITUTIONAL", "safety_constitutional",
    "PARALLEL_HINT", "parallel_hint",
    "REASONING_TRACE", "reasoning_trace",
    "HARDENING_PATCHES", "HARDENING_RULES", "apply_hardening",
    "get_model_tweaks", "MODEL_TWEAKS",
]
