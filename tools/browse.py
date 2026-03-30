#!/usr/bin/env python3
"""
browse.py — Quick browser automation interface for Alfie's workflow.

Designed to be called from exec tool during conversations:
  python3 tools/browse.py "go to example.com and find the pricing"
  python3 tools/browse.py --url https://example.com "extract all product names"
  python3 tools/browse.py --steps 3 "check gmail for unread messages"
  python3 tools/browse.py --no-vision "simple task on clean page"

Output: Clean text result (no debug noise), suitable for piping back into conversation.
Exit code 0 = success, 1 = failure with error message.
"""

import asyncio
import sys
import os
import json
import logging
import warnings
from pydantic import ConfigDict

# Silence everything except our output
warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)  # Nuclear option: silence ALL library logging
os.environ["ANONYMIZED_TELEMETRY"] = "false"

VENV = os.path.expanduser("~/.venvs/browser-agent")
if os.path.exists(VENV):
    pyver = f"python{sys.version_info.major}.{sys.version_info.minor}"
    sys.path.insert(0, os.path.join(VENV, "lib", pyver, "site-packages"))

CDP_URL = os.environ.get("CDP_URL", "http://localhost:9222")
DEFAULT_MODEL = os.environ.get("BROWSER_MODEL", "claude-opus-4-6")


def _get_proxy_url():
    return "http://localhost:8080"


def _make_llm(model: str):
    from langchain_anthropic import ChatAnthropic
    from langchain_core.messages import (
        SystemMessage as LCS, HumanMessage as LCH, AIMessage as LCA,
    )

    class BrowserLLM(ChatAnthropic):
        model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)
        provider: str = "anthropic"
        model_name: str = ""

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            object.__setattr__(self, "model_name", kwargs.get("model", ""))

        def _convert_messages(self, messages):
            converted = []
            for msg in messages:
                if isinstance(msg, (LCS, LCH, LCA)):
                    converted.append(msg)
                    continue
                role = getattr(msg, 'role', 'user')
                content = getattr(msg, 'content', str(msg))
                if isinstance(content, list):
                    parts = []
                    for p in content:
                        if hasattr(p, 'type'):
                            if p.type == 'text':
                                parts.append({"type": "text", "text": p.text})
                            elif p.type == 'image_url':
                                parts.append({"type": "image_url", "image_url": {"url": p.image_url.url}})
                        elif isinstance(p, dict):
                            parts.append(p)
                        else:
                            parts.append({"type": "text", "text": str(p)})
                    content = parts
                if role == 'system':
                    converted.append(LCS(content=content))
                elif role == 'assistant':
                    converted.append(LCA(content=content))
                else:
                    converted.append(LCH(content=content))
            return converted

        async def ainvoke(self, input, config_or_format=None, *, stop=None, **kwargs):
            output_format = None
            config = None
            if config_or_format is not None:
                is_schema = (
                    isinstance(config_or_format, type) or
                    hasattr(config_or_format, 'model_fields') or
                    hasattr(config_or_format, '__fields__')
                )
                if is_schema:
                    output_format = config_or_format
                else:
                    config = config_or_format
            if 'output_format' in kwargs:
                output_format = kwargs.pop('output_format')
            kwargs.pop('session_id', None)
            if isinstance(input, list):
                input = self._convert_messages(input)
            if output_format is not None:
                structured = super().with_structured_output(output_format)
                parsed = await structured.ainvoke(input, config, stop=stop, **kwargs)
                msg = LCA(content=str(parsed) if parsed else "")
                object.__setattr__(msg, 'completion', parsed)
                object.__setattr__(msg, 'usage', None)
                msg.usage_metadata = None
                return msg
            else:
                result = await super().ainvoke(input, config, stop=stop, **kwargs)
                if not hasattr(result, 'usage'):
                    object.__setattr__(result, 'usage', None)
                return result

    return BrowserLLM(
        model=model,
        anthropic_api_key="proxy-handles-auth",
        anthropic_api_url=_get_proxy_url(),
        temperature=0.1,
        max_tokens=4096,
    )


async def browse(task: str, model: str = DEFAULT_MODEL, max_steps: int = 10,
                 use_vision: bool = True, initial_url: str = None,
                 context: str = None):
    """
    Run a browser task and return the result text.
    
    Args:
        task: What to do (natural language)
        model: LLM model to use
        max_steps: Maximum browsing steps
        use_vision: Use screenshots (True) or text-only (False)
        initial_url: Optional URL to navigate to first
        context: Optional context about why we're doing this
    
    Returns:
        str: The result text, or None on failure
    """
    from browser_use import Agent, Browser

    # Enrich task with context if provided
    full_task = task
    if context:
        full_task = f"Context: {context}\n\nTask: {task}"
    if initial_url and initial_url not in task:
        full_task = f"First navigate to {initial_url}, then: {full_task}"

    llm = _make_llm(model)
    browser = Browser(cdp_url=CDP_URL, disable_security=True)

    agent = Agent(
        task=full_task,
        llm=llm,
        browser=browser,
        max_actions_per_step=5,
        use_vision=use_vision,
    )

    result = await agent.run(max_steps=max_steps)

    # Extract final answer
    final = None
    if hasattr(result, 'history'):
        for item in reversed(result.history):
            results = item.result if hasattr(item, 'result') else []
            for r in results:
                if hasattr(r, 'extracted_content') and r.extracted_content:
                    if not r.extracted_content.startswith("🔗"):
                        final = r.extracted_content
                        break
            if final:
                break
    if not final and hasattr(result, 'all_results'):
        for r in reversed(result.all_results):
            if r.extracted_content and not r.extracted_content.startswith("🔗"):
                final = r.extracted_content
                break

    return final


async def main():
    import argparse
    parser = argparse.ArgumentParser(description="AI-powered browser automation")
    parser.add_argument("task", nargs="+", help="What to do")
    parser.add_argument("--url", help="Initial URL to navigate to")
    parser.add_argument("--steps", type=int, default=10, help="Max steps (default: 10)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="LLM model")
    parser.add_argument("--no-vision", action="store_true", help="Disable vision (text-only)")
    parser.add_argument("--context", help="Additional context for the task")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    task = " ".join(args.task)
    
    try:
        result = await browse(
            task=task,
            model=args.model,
            max_steps=args.steps,
            use_vision=not args.no_vision,
            initial_url=args.url,
            context=args.context,
        )
        
        if result:
            if args.json:
                print(json.dumps({"success": True, "result": result}))
            else:
                print(result)
            sys.exit(0)
        else:
            if args.json:
                print(json.dumps({"success": False, "error": "No result extracted"}))
            else:
                print("ERROR: Browser agent completed but no result was extracted", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        if args.json:
            print(json.dumps({"success": False, "error": str(e)}))
        else:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
