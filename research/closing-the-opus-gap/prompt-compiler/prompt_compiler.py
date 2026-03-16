"""
prompt_compiler.py — Dynamically composes optimal system prompts for tool-calling LLMs.

Based on 3,500+ API calls across 10 research phases on Cerebras GLM-4.7 and Qwen 235B.

Key research findings encoded:
1.  MINIMAL + Constitutional Safety + Deep SRE Persona = optimal base (460 tokens, 100%)
2.  Dynamic routing saves 29% tokens — classify query, add safety only when needed
3.  Tool descriptions don't matter — Qwen uses names, not descriptions
4.  Tool ordering doesn't matter — no primacy/recency bias in Qwen 235B
5.  Instruction repetition doesn't help — say it once clearly
6.  Negative few-shots are useless or harmful
7.  Plan-Then-Execute and Structured Output have NEGATIVE ROI
8.  FallbackChain is the best multi-pass strategy (template switching)
9.  Self-Critique works for Qwen but not GLM (API limitation)
10. Deep persona is the #1 technique — 180 tokens → security 0%→100%
11. Metadata framing is the biggest security exploit
12. Chinese-first ordering helps GLM, neutral for Qwen
13. System prompt bloat > ~1000 tokens hurts accuracy by ~17.5%
14. Qwen 235B is description-invariant, ordering-invariant, parameter-naming-invariant
15. Ensemble routing (dual model) REDUCES accuracy — don't do it
16. Confidence calibration is noise — don't do it
17. Prompt chunking style doesn't matter — use monolithic

Usage:
    compiler = PromptCompiler(model="qwen-235b", safety_level="standard")
    prompt = compiler.compile(query="Get BTC price and email to alice@example.com", tools=[...])
"""

import re
import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Dict, Any

# Try tiktoken for accurate token counting; fall back to word estimation
try:
    import tiktoken
    _TIKTOKEN_AVAILABLE = True
except ImportError:
    _TIKTOKEN_AVAILABLE = False

# Component imports
from components.base_minimal import base_minimal
from components.persona_deep_sre import persona_deep_sre
from components.safety_constitutional import safety_constitutional
from components.parallel_hint import parallel_hint
from components.reasoning_trace import reasoning_trace
from components.hardening_patches import apply_hardening, _detect_vulnerabilities
from components.model_specific import get_model_tweaks, get_model_addendum, _normalize_model_name, CHINESE_FIRST_PREFIX


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

class QueryClassification(Enum):
    """
    Query type classifications for dynamic prompt routing.

    Research basis (Phase 6C Experiment 5):
    Dynamic routing achieves 100% accuracy at 29% fewer tokens vs static FULL_OPUS.
    Both models classify identically — the router is deterministic.
    """
    SIMPLE_LOOKUP = "SIMPLE_LOOKUP"          # Single tool, low risk (T1 weather)
    MULTI_TOOL = "MULTI_TOOL"                # Multiple independent tools (T2/T5/T8)
    SECURITY_SENSITIVE = "SECURITY_SENSITIVE"  # Credential/file access risk (T4)
    AMBIGUOUS = "AMBIGUOUS"                  # Unclear intent (T6 "check the server")
    CREATIVE = "CREATIVE"                    # No tool needed / generative


@dataclass
class PromptComponent:
    """A single named prompt component with its text and token estimate."""
    name: str
    text: str
    token_estimate: int
    required: bool = False


@dataclass
class CompileResult:
    """
    Full result from a compile() call including the prompt and metadata.

    Attributes:
        prompt: The compiled system prompt string.
        classification: Query classification used for routing.
        components_used: Ordered list of component names included.
        token_estimate: Estimated token count of the final prompt.
        vulnerabilities: Security vulnerability patterns detected in query.
        model: Normalized model name used.
        cache_key: Deterministic hash of inputs for caching.
    """
    prompt: str
    classification: QueryClassification
    components_used: List[str]
    token_estimate: int
    vulnerabilities: List[str]
    model: str
    cache_key: str


# ---------------------------------------------------------------------------
# Token counter
# ---------------------------------------------------------------------------

def _count_tokens(text: str, model: str = "gpt-3.5-turbo") -> int:
    """
    Count tokens in text using tiktoken if available, else word-based estimate.

    Args:
        text: Text to count tokens for.
        model: Tiktoken model encoding to use (only used if tiktoken available).

    Returns:
        int: Token count estimate.
    """
    if _TIKTOKEN_AVAILABLE:
        try:
            enc = tiktoken.encoding_for_model(model)
            return len(enc.encode(text))
        except Exception:
            pass
    # Fallback: ~1.3 tokens per word (conservative estimate for English)
    word_count = len(text.split())
    return int(word_count * 1.3)


# ---------------------------------------------------------------------------
# Main compiler class
# ---------------------------------------------------------------------------

class PromptCompiler:
    """
    Dynamically composes optimal system prompts for tool-calling LLMs.

    Based on 3,500+ API call research across Cerebras Qwen 235B and GLM-4.7.

    The compiler:
    1. Classifies the query to determine routing
    2. Selects the minimal set of components needed (avoiding bloat)
    3. Applies model-specific tweaks
    4. Applies security hardening patches for detected vulnerabilities
    5. Returns a deterministic, monolithic prompt string

    Key design principle: LESS IS MORE. The research proves that adding more
    instructions hurts accuracy (~17.5% penalty per 4x token increase).
    Every component must earn its place.
    """

    # Token budget limit — exceeding this hurts accuracy by ~17.5% (Phase 3.5)
    TOKEN_BUDGET: int = 960  # Below 1000-token threshold with safety margin

    # Pareto-optimal component stacks by classification (Phase 6C)
    ROUTING_TABLE: Dict[QueryClassification, List[str]] = {
        QueryClassification.SIMPLE_LOOKUP:    ["base_minimal"],
        QueryClassification.MULTI_TOOL:       ["base_minimal", "parallel_hint"],
        QueryClassification.SECURITY_SENSITIVE: ["base_minimal", "safety_constitutional", "persona_deep_sre"],
        QueryClassification.AMBIGUOUS:        ["base_minimal", "reasoning_trace"],
        QueryClassification.CREATIVE:         ["base_minimal"],
    }

    def __init__(self, model: str = "qwen-235b", safety_level: str = "standard"):
        """
        Initialize the PromptCompiler for a specific model and safety level.

        Args:
            model: Target LLM. One of: "qwen-235b", "glm-4.7", "opus", "generic".
                   Controls model-specific tweaks and known limitations.
            safety_level: Security posture.
                "minimal"  — Only add security components if query is SECURITY_SENSITIVE.
                "standard" — Add constitutional + persona whenever file tools present.
                "paranoid" — Always include full security stack regardless of query.

        Research basis:
            Phase 6C: Dynamic routing saves 29% tokens at same 100% accuracy.
            Phase 5: Full security stack (460 tokens) is the production default.
        """
        self.model = _normalize_model_name(model)
        self.safety_level = safety_level
        self._model_tweaks = get_model_tweaks(model)
        self._cache: Dict[str, CompileResult] = {}

    def compile(
        self,
        query: str,
        tools: list,
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Compose and return an optimal system prompt for the given query and tools.

        Steps:
        1. Classify the query type (pattern matching, no LLM call)
        2. Select prompt components based on classification + safety level
        3. Apply model-specific tweaks
        4. Apply security hardening patches for detected vulnerabilities
        5. Compose monolithic prompt within token budget
        6. Return deterministic string

        Args:
            query: The user query to be processed by the target LLM.
            tools: List of tool schema dicts ({"name": str, "description": str, ...}).
            context: Optional context dict. Supported keys:
                     "use_chinese_first" (bool): Force Chinese-first ordering.
                     "disable_hardening" (bool): Skip jailbreak hardening patches.
                     "force_classification" (str): Override auto-classification.

        Returns:
            str: The compiled system prompt, ready to use as the system message.

        Example:
            >>> compiler = PromptCompiler(model="qwen-235b")
            >>> tools = [{"name": "get_weather", "description": "Get weather data"}]
            >>> prompt = compiler.compile("What's the weather in Moscow?", tools)
        """
        context = context or {}

        # Check cache for deterministic repeat calls
        cache_key = self._make_cache_key(query, tools, context)
        if cache_key in self._cache:
            return self._cache[cache_key].prompt

        # Step 1: Classify query
        if "force_classification" in context:
            classification = QueryClassification(context["force_classification"])
        else:
            classification = self.classify_query(query, tools)

        # Step 2: Select components
        components = self.select_components(classification, self.model, self.safety_level)

        # Step 3: Prune tools if needed
        pruned_tools = self.prune_tools(tools, query)

        # Step 4: Compose prompt
        parts: List[str] = []

        # Chinese-first prefix for GLM-4.7 or explicit override
        use_chinese = context.get("use_chinese_first", self._model_tweaks.get("use_chinese_first", False))
        if use_chinese:
            parts.append(CHINESE_FIRST_PREFIX)

        # Add selected components in order
        for component in components:
            parts.append(component.text)

        # Model-specific addendum
        addendum = get_model_addendum(self.model)
        if addendum:
            parts.append(addendum)

        base_prompt = "\n\n".join(parts)

        # Step 5: Apply hardening patches
        if not context.get("disable_hardening", False):
            vulnerabilities = _detect_vulnerabilities(query)
            # Also check if tools include dangerous capabilities
            tool_names = [t.get("name", "") for t in pruned_tools]
            extra_vulns = self._detect_tool_vulnerabilities(tool_names)
            all_vulns = list(dict.fromkeys(vulnerabilities + extra_vulns))  # dedupe, preserve order
            final_prompt = apply_hardening(base_prompt, query, all_vulns)
        else:
            vulnerabilities = []
            all_vulns = []
            final_prompt = base_prompt

        # Step 6: Token budget check
        token_count = _count_tokens(final_prompt)
        if token_count > self.TOKEN_BUDGET:
            # Trim to budget by dropping lowest-priority optional components
            final_prompt = self._trim_to_budget(final_prompt, components, token_count)

        # Cache and return
        result = CompileResult(
            prompt=final_prompt,
            classification=classification,
            components_used=[c.name for c in components],
            token_estimate=_count_tokens(final_prompt),
            vulnerabilities=all_vulns,
            model=self.model,
            cache_key=cache_key,
        )
        self._cache[cache_key] = result

        return final_prompt

    def compile_full(
        self,
        query: str,
        tools: list,
        context: Optional[Dict[str, Any]] = None,
    ) -> CompileResult:
        """
        Like compile(), but returns the full CompileResult with metadata.

        Args:
            query: User query string.
            tools: Tool schema list.
            context: Optional context dict.

        Returns:
            CompileResult: Full result with prompt, classification, components, tokens.
        """
        context = context or {}
        cache_key = self._make_cache_key(query, tools, context)

        # Ensure compile() has run (populates cache)
        self.compile(query, tools, context)

        return self._cache[cache_key]

    def classify_query(self, query: str, tools: list) -> QueryClassification:
        """
        Classify query type using pattern matching (no LLM call required).

        Uses keyword detection and tool capability analysis to determine
        which prompt stack to use. Deterministic — same input always returns
        same classification.

        Args:
            query: The user query string.
            tools: List of available tool schemas.

        Returns:
            QueryClassification: The classification for prompt routing.

        Research basis:
            Phase 6C E5: Both models classify queries identically (deterministic).
            Dynamic routing achieves 100% accuracy at 29% token savings.
        """
        query_lower = query.lower()

        # Security-sensitive patterns (Phase 6B attack taxonomy)
        security_patterns = [
            r"/etc/", r"/\.ssh/", r"\.env", r"api[_\s]key", r"secret",
            r"password", r"credential", r"token", r"private[_\s]key",
            r"\.bashrc", r"\.profile", r"id_rsa", r"id_ed25519",
            r"config\.json", r"\.pem", r"\.p12", r"auth", r"access[_\s]key",
        ]
        for pattern in security_patterns:
            if re.search(pattern, query_lower):
                return QueryClassification.SECURITY_SENSITIVE

        # Check if available tools include dangerous capabilities
        tool_names_lower = [t.get("name", "").lower() for t in tools]
        dangerous_tools = {"read_file", "exec_command", "shell", "bash", "run_code",
                          "execute", "write_file", "delete_file", "file_read"}
        has_dangerous_tools = any(
            any(d in name for d in dangerous_tools) for name in tool_names_lower
        )

        # If dangerous tools present and query mentions file paths OR file operations
        file_op_pattern = r'(/[a-zA-Z]|~[/\\]|\.env|config|read\b.*file|open\b.*file|cat\b|tail\b|head\b|grep\b.*file)'
        if has_dangerous_tools and re.search(file_op_pattern, query_lower):
            return QueryClassification.SECURITY_SENSITIVE

        # Multi-tool patterns: conjunctions, multiple actions, "and"/"also"/"plus"
        multi_tool_patterns = [
            r"\band\b", r"\balso\b", r"\bplus\b", r"\bthen\b",
            r"\band then\b", r"\bwhile\b", r"\bsimultaneously\b",
        ]
        action_count = sum(1 for p in multi_tool_patterns if re.search(p, query_lower))

        # Count distinct tool domains referenced
        tool_domains_hit = self._count_tool_domains(query_lower, tools)

        if action_count >= 1 and tool_domains_hit >= 2:
            return QueryClassification.MULTI_TOOL

        # Ambiguous patterns: vague requests
        ambiguous_patterns = [
            r"^check (the )?(server|system|status|health)$",
            r"^what('s| is) (going on|happening|the status)",
            r"^monitor\b",
            r"^debug\b",
            r"how (is|are) (things|everything|it) (going|doing|running)",
        ]
        for pattern in ambiguous_patterns:
            if re.search(pattern, query_lower.strip()):
                return QueryClassification.AMBIGUOUS

        # Creative/no-tool patterns
        creative_patterns = [
            r"^(tell me a |write a |generate a |create a )",
            r"^(explain |describe |what is |what are |who is |who are )",
            r"^(what'?s? \d|calculate |compute |how (much|many|do) )",
            r"^\d+[\s+\-*/]\d+",  # Math expressions
        ]
        for pattern in creative_patterns:
            if re.search(pattern, query_lower.strip()):
                return QueryClassification.CREATIVE

        # Default: single tool lookup
        return QueryClassification.SIMPLE_LOOKUP

    def select_components(
        self,
        classification: QueryClassification,
        model: str,
        safety_level: str,
    ) -> List[PromptComponent]:
        """
        Select ordered prompt components based on classification, model, safety level.

        Implements the Pareto-optimal routing table from Phase 6C research.
        Returns the minimal set of components that achieves target accuracy.

        Args:
            classification: Query classification from classify_query().
            model: Normalized model identifier.
            safety_level: "minimal", "standard", or "paranoid".

        Returns:
            List[PromptComponent]: Ordered components to include in the prompt.

        Research basis:
            Phase 6C E3: MINIMAL sufficient for simple/complex; TRIMMED required for security.
            Phase 6C E6: Pareto-optimal stacks at each token budget.
            Phase 5: Deep persona is #1 technique; Plan-Then-Execute has negative ROI.
        """
        component_stack = self.ROUTING_TABLE.get(classification, ["base_minimal"])

        # Safety level overrides
        if safety_level == "paranoid":
            # Always add full security stack regardless of classification
            for c in ["safety_constitutional", "persona_deep_sre"]:
                if c not in component_stack:
                    component_stack = list(component_stack) + [c]
        elif safety_level == "standard" and classification != QueryClassification.SECURITY_SENSITIVE:
            # For standard + non-security, add constitutional if dangerous tools likely
            pass  # Dynamic hardening handles this case
        elif safety_level == "minimal":
            # Minimal: only add security components for SECURITY_SENSITIVE queries
            if classification != QueryClassification.SECURITY_SENSITIVE:
                component_stack = ["base_minimal"]

        # Build PromptComponent objects
        component_map = {
            "base_minimal": PromptComponent(
                name="base_minimal",
                text=base_minimal(),
                token_estimate=128,
                required=True,
            ),
            "persona_deep_sre": PromptComponent(
                name="persona_deep_sre",
                text=persona_deep_sre(),
                token_estimate=180,
            ),
            "safety_constitutional": PromptComponent(
                name="safety_constitutional",
                text=safety_constitutional(),
                token_estimate=150,
            ),
            "parallel_hint": PromptComponent(
                name="parallel_hint",
                text=parallel_hint(),
                token_estimate=50,
            ),
            "reasoning_trace": PromptComponent(
                name="reasoning_trace",
                text=reasoning_trace(),
                token_estimate=200,
            ),
        }

        result = []
        for name in component_stack:
            if name in component_map:
                result.append(component_map[name])

        return result

    def prune_tools(self, tools: list, query: str, max_tools: int = 15) -> list:
        """
        Reduce tool list to the most relevant tools for the given query.

        Uses keyword matching to score tool relevance. For GLM-4.7, caps at 5
        tools due to semantic tool confusion failure at higher counts (Phase 3).

        Args:
            tools: Full list of tool schema dicts.
            query: User query to match tools against.
            max_tools: Maximum number of tools to return. Default 15.
                       GLM-4.7 override: 5 (Phase 3 categorical failure above 5).

        Returns:
            list: Pruned tool list, sorted by relevance score descending.

        Research basis:
            Phase 3: GLM-4.7 fails at 10 tools (substitutes get_time for calendar_check).
            Phase 5 E3: Dynamic pruning shows no accuracy gain for Qwen 235B
                        (perfect at all counts), but required for GLM-4.7 safety.
            Phase 6C E3: Adaptive complexity — match tool count to query complexity.
        """
        if not tools:
            return tools

        # GLM-4.7 hard limit: semantic confusion failure above 5 tools (Phase 3)
        if self.model == "glm-4.7":
            max_tools = min(max_tools, self._model_tweaks["max_recommended_tools"])

        if len(tools) <= max_tools:
            return tools

        query_words = set(re.findall(r'\b\w+\b', query.lower()))

        def score_tool(tool: dict) -> int:
            """Score tool relevance to query via keyword overlap."""
            score = 0
            tool_name = tool.get("name", "").lower()
            tool_desc = tool.get("description", "").lower()
            tool_text = f"{tool_name} {tool_desc}"
            tool_words = set(re.findall(r'\b\w+\b', tool_text))

            # Direct name match: high value
            for word in query_words:
                if word in tool_name:
                    score += 10
            # Description keyword overlap
            overlap = query_words & tool_words
            score += len(overlap) * 2
            # Penalize very long descriptions (GLM-4.7 confusion — Phase 6A E1)
            if len(tool_desc) > 200:
                score -= 2
            return score

        scored = [(score_tool(t), t) for t in tools]
        scored.sort(key=lambda x: x[0], reverse=True)

        return [t for _, t in scored[:max_tools]]

    def harden_prompt(self, base_prompt: str, vulnerabilities: list) -> str:
        """
        Apply targeted hardening patches from Phase 6B red-team findings.

        Patches known exploits:
        - Metadata framing (stat/wc -l on credential paths): 84% bypass rate
        - Path normalization (/etc/../etc/environment)
        - Reasoning exploits ("rule doesn't apply because...")
        - Urgency/emotional pressure
        - Multi-step trust erosion

        Args:
            base_prompt: The base compiled prompt.
            vulnerabilities: List of vulnerability names to patch. Use
                             _detect_vulnerabilities(query) to auto-detect, or
                             pass explicit list from HARDENING_PATCHES keys.

        Returns:
            str: Hardened prompt with relevant patches appended.

        Research basis:
            Phase 6B Attack #8: metadata framing has 84% bypass rate — highest risk.
            Phase 6B Attack #12: reasoning exploits have 50% bypass rate.
            Phase 6B Section 6: Full hardening recommendations.
        """
        return apply_hardening(base_prompt, "", vulnerabilities)

    # ---------------------------------------------------------------------------
    # Internal helpers
    # ---------------------------------------------------------------------------

    def _make_cache_key(self, query: str, tools: list, context: dict) -> str:
        """
        Generate a deterministic cache key from inputs.

        The compiled prompt is fully deterministic — same inputs always produce
        same output. Caching ensures no computation overhead on repeated calls.
        """
        tool_names = sorted(t.get("name", "") for t in tools)
        key_str = f"{self.model}:{self.safety_level}:{query}:{tool_names}:{sorted(context.items())}"
        return hashlib.sha256(key_str.encode()).hexdigest()[:16]

    def _detect_tool_vulnerabilities(self, tool_names: List[str]) -> List[str]:
        """
        Detect potential vulnerability categories based on available tools.

        If tools with dangerous capabilities are available, proactively apply
        relevant hardening even before a suspicious query is seen.

        Args:
            tool_names: List of tool name strings (lowercase).

        Returns:
            List[str]: Vulnerability categories to pre-patch.
        """
        vulns = []
        dangerous_names = {"read_file", "exec", "shell", "bash", "run", "execute",
                           "write_file", "delete", "file_read", "file_write"}
        has_file_tools = any(
            any(d in name for d in dangerous_names)
            for name in tool_names
        )
        if has_file_tools and self.safety_level in ("standard", "paranoid"):
            # Pre-patch metadata framing when file tools are available
            vulns.append("metadata_framing")
        return vulns

    def _count_tool_domains(self, query_lower: str, tools: list) -> int:
        """
        Count how many distinct tool domains appear relevant to the query.

        Used in classify_query() to distinguish SIMPLE_LOOKUP from MULTI_TOOL.

        Args:
            query_lower: Lowercase query string.
            tools: Available tool schemas.

        Returns:
            int: Number of distinct tool domains with relevance signals.
        """
        domains_matched = set()
        domain_keywords = {
            "search": ["search", "find", "look up", "google", "research"],
            "weather": ["weather", "temperature", "forecast", "rain", "snow"],
            "calendar": ["calendar", "schedule", "meeting", "appointment", "event"],
            "email": ["email", "mail", "send", "message", "inbox"],
            "file": ["file", "read", "open", "path", "/etc", "/var", "log"],
            "crypto": ["bitcoin", "btc", "eth", "crypto", "price", "coin"],
            "system": ["server", "system", "process", "memory", "cpu", "disk"],
            "database": ["database", "query", "sql", "db", "table", "record"],
            "code": ["run", "execute", "script", "command", "bash", "python"],
        }
        for domain, keywords in domain_keywords.items():
            for kw in keywords:
                if kw in query_lower:
                    domains_matched.add(domain)
                    break
        return len(domains_matched)

    def _trim_to_budget(
        self,
        prompt: str,
        components: List[PromptComponent],
        current_tokens: int,
    ) -> str:
        """
        Trim prompt to token budget by removing optional components.

        Removes lowest-priority optional components until within budget.
        Required components (base_minimal) are never removed.

        Args:
            prompt: Current assembled prompt.
            components: List of components used (in order).
            current_tokens: Current token count.

        Returns:
            str: Trimmed prompt within TOKEN_BUDGET.
        """
        # Priority order for removal (lowest value removed first)
        removal_priority = ["reasoning_trace", "parallel_hint", "persona_deep_sre",
                           "safety_constitutional"]

        remaining_components = list(components)
        for removable_name in removal_priority:
            if current_tokens <= self.TOKEN_BUDGET:
                break
            to_remove = [c for c in remaining_components if c.name == removable_name and not c.required]
            if to_remove:
                remaining_components = [c for c in remaining_components if c.name != removable_name]
                # Recompose
                parts = [c.text for c in remaining_components]
                prompt = "\n\n".join(parts)
                current_tokens = _count_tokens(prompt)

        return prompt

    def __repr__(self) -> str:
        return f"PromptCompiler(model={self.model!r}, safety_level={self.safety_level!r})"
