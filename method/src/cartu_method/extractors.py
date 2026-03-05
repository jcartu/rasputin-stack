"""
Parallel extraction prompts — each perspective extracts different memory types.
Uses fast/cheap models (Cerebras, Groq, local) for extraction.
"""

import json
import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import httpx

from .rescue import Memory


FACT_PROMPT = """Extract all factual information from this conversation context. Return a JSON array of objects, each with:
- "text": the factual statement (concise, self-contained)
- "importance": 1-10 score (10 = critical configuration/credential/decision that must survive context loss)
- "subcategory": one of "name", "date", "number", "url", "config", "credential", "spec", "reference"

Focus on: names of people/systems/services, dates and deadlines, URLs and endpoints, 
configuration values, technical specifications, version numbers, prices, and any concrete 
data points that would be impossible to reconstruct from a summary.

Only return the JSON array, no other text."""

DECISION_PROMPT = """Extract every decision made in this conversation and WHY it was made. Return a JSON array of objects, each with:
- "text": the decision and its rationale (e.g., "Chose Postgres over Mongo because we need ACID transactions for payment processing")
- "importance": 1-10 score (10 = architectural decision that shapes all future work)
- "subcategory": one of "architecture", "tool_choice", "strategy", "tradeoff", "rejection", "priority"

Include:
- What was chosen AND what was rejected (with reasons)
- Trade-offs that were considered
- Constraints that drove the decision
- Any "we tried X but it didn't work because Y" moments

Only return the JSON array, no other text."""

SKILL_PROMPT = """Extract procedural knowledge and lessons learned from this conversation. Return a JSON array of objects, each with:
- "text": the skill, technique, or lesson (self-contained, actionable)
- "importance": 1-10 score (10 = hard-won debugging insight that took hours to discover)
- "subcategory": one of "how_to", "debug_technique", "workaround", "pattern", "anti_pattern", "optimization", "gotcha"

Focus on:
- Step-by-step procedures that worked
- Debugging techniques that solved specific problems
- Workarounds for known issues
- Patterns that proved effective
- Anti-patterns to avoid (and why)
- Performance optimizations discovered
- "Gotchas" — non-obvious things that caused problems

Only return the JSON array, no other text."""


class BaseExtractor(ABC):
    """Base class for memory extractors."""

    def __init__(
        self,
        model: str = "cerebras/llama-3.3-70b",
        api_base: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        self.model = model
        self.api_base = api_base or self._infer_api_base(model)
        self.api_key = api_key or self._infer_api_key(model)

    @abstractmethod
    def get_prompt(self) -> str:
        """Return the extraction prompt for this perspective."""
        ...

    @abstractmethod
    def get_category(self) -> str:
        """Return the memory category name."""
        ...

    def _infer_api_base(self, model: str) -> str:
        """Infer API base URL from model name."""
        if model.startswith("cerebras/"):
            return "https://api.cerebras.ai/v1"
        elif model.startswith("groq/"):
            return "https://api.groq.com/openai/v1"
        elif model.startswith("ollama/"):
            return "http://localhost:11434/v1"
        elif model.startswith("openrouter/"):
            return "https://openrouter.ai/api/v1"
        return "https://api.openai.com/v1"

    def _infer_api_key(self, model: str) -> str:
        """Infer API key from environment."""
        if model.startswith("cerebras/"):
            return os.environ.get("CEREBRAS_API_KEY", "")
        elif model.startswith("groq/"):
            return os.environ.get("GROQ_API_KEY", "")
        elif model.startswith("ollama/"):
            return "ollama"  # Local, no key needed
        elif model.startswith("openrouter/"):
            return os.environ.get("OPENROUTER_API_KEY", "")
        return os.environ.get("OPENAI_API_KEY", "")

    def _clean_model_name(self, model: str) -> str:
        """Strip provider prefix from model name."""
        if "/" in model:
            parts = model.split("/", 1)
            if parts[0] in ("cerebras", "groq", "ollama", "openrouter"):
                return parts[1]
        return model

    async def extract(self, context: str) -> List[Memory]:
        """Extract memories from context using the fast model."""
        prompt = self.get_prompt()
        category = self.get_category()

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.api_base}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self._clean_model_name(self.model),
                        "messages": [
                            {"role": "system", "content": prompt},
                            {"role": "user", "content": f"Context to extract from:\n\n{context}"},
                        ],
                        "temperature": 0.2,
                        "max_tokens": 4096,
                    },
                )
                response.raise_for_status()
                data = response.json()

            text = data["choices"][0]["message"]["content"]
            
            # Parse JSON from response (handle markdown code blocks)
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                if text.endswith("```"):
                    text = text[:-3]
                text = text.strip()

            items = json.loads(text)
            
            memories = []
            for item in items:
                if isinstance(item, dict) and "text" in item:
                    memories.append(Memory(
                        text=item["text"],
                        category=category,
                        importance=int(item.get("importance", 5)),
                        metadata={
                            "subcategory": item.get("subcategory", ""),
                        },
                    ))
            return memories

        except Exception as e:
            # Don't crash on extraction failure — return empty
            return []


class FactExtractor(BaseExtractor):
    def get_prompt(self) -> str:
        return FACT_PROMPT
    def get_category(self) -> str:
        return "fact"


class DecisionExtractor(BaseExtractor):
    def get_prompt(self) -> str:
        return DECISION_PROMPT
    def get_category(self) -> str:
        return "decision"


class SkillExtractor(BaseExtractor):
    def get_prompt(self) -> str:
        return SKILL_PROMPT
    def get_category(self) -> str:
        return "skill"
