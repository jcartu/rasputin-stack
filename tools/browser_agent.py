#!/usr/bin/env python3
"""
Browser Agent — browser-use with persistent Chrome + Opus 4.6

Uses Anthropic API directly (not through proxy) since browser-use needs 
native tool_use support and our proxy only handles /v1/messages passthrough.

Usage: 
  python3 tools/browser_agent.py --test                              
  python3 tools/browser_agent.py "Find trending repos on GitHub"
  BROWSER_MODEL=claude-sonnet-4-5 python3 tools/browser_agent.py "..."
"""

import asyncio
import sys
import os
import logging
import warnings
import json
from pydantic import ConfigDict

warnings.filterwarnings("ignore")
logging.getLogger("bubus").setLevel(logging.ERROR)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("langchain").setLevel(logging.WARNING)
os.environ["ANONYMIZED_TELEMETRY"] = "false"

VENV = os.path.expanduser("~/.venvs/browser-agent")
if os.path.exists(VENV):
    pyver = f"python{sys.version_info.major}.{sys.version_info.minor}"
    sys.path.insert(0, os.path.join(VENV, "lib", pyver, "site-packages"))

CDP_URL = os.environ.get("CDP_URL", "http://localhost:9222")
DEFAULT_MODEL = os.environ.get("BROWSER_MODEL", "claude-opus-4-6")


def _get_anthropic_key():
    """Get Anthropic API key from environment or OAuth credentials."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    # Try OAuth token from OpenClaw credentials
    creds_path = os.path.expanduser("~/.claude/.credentials.json")
    if os.path.exists(creds_path):
        with open(creds_path) as f:
            creds = json.load(f)
        token = creds.get("claudeAiOauth", {}).get("accessToken", "")
        if token:
            return token
    return None


async def test_connection():
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{CDP_URL}/json/version") as resp:
            data = await resp.json()
            print(f"✅ Chrome {data.get('Browser', '?')} running")
        async with session.get(f"{CDP_URL}/json") as resp:
            tabs = await resp.json()
            pages = [t for t in tabs if t.get("type") == "page"]
            print(f"   {len(pages)} page(s) open")
            for t in pages[:5]:
                print(f"   → {t.get('title', 'untitled')} — {t.get('url', '')[:60]}")
    key = _get_anthropic_key()
    print(f"✅ Anthropic auth: {'OAuth token' if len(key or '') > 100 else 'API key'}")
    print(f"🧠 Default model: {DEFAULT_MODEL}")
    print("✅ Browser stack ready!")


def make_llm(model: str = DEFAULT_MODEL):
    """Create an Anthropic LLM instance compatible with browser-use + Python 3.14."""
    from langchain_anthropic import ChatAnthropic

    class BrowserUseAnthropic(ChatAnthropic):
        model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)
        provider: str = "anthropic"
        model_name: str = ""

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            object.__setattr__(self, "model_name", kwargs.get("model", ""))

        def _convert_messages(self, messages):
            """Convert browser-use message types to langchain types."""
            from langchain_core.messages import (
                SystemMessage as LCS,
                HumanMessage as LCH,
                AIMessage as LCA,
            )
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
            """Shim for browser-use's token tracker + message type incompatibilities."""
            from langchain_core.messages import AIMessage as LCA
            
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
                # browser-use's token tracker checks result.usage (not usage_metadata)
                object.__setattr__(msg, 'usage', None)
                msg.usage_metadata = None
                return msg
            else:
                result = await super().ainvoke(input, config, stop=stop, **kwargs)
                # Ensure .usage exists for token tracker
                if not hasattr(result, 'usage'):
                    object.__setattr__(result, 'usage', None)
                return result

    # Route through our proxy which handles OAuth Bearer auth properly.
    # langchain-anthropic sends x-api-key which doesn't work with OAuth tokens.
    # The proxy at localhost:8080 handles /v1/messages with proper auth.
    return BrowserUseAnthropic(
        model=model,
        anthropic_api_key="proxy-handles-auth",  # Dummy - proxy adds real auth
        anthropic_api_url="http://localhost:8080",
        temperature=0.1,
        max_tokens=4096,
    )


async def run_task(task: str, model: str = DEFAULT_MODEL, max_steps: int = 10):
    from browser_use import Agent, Browser

    llm = make_llm(model)
    browser = Browser(cdp_url=CDP_URL, disable_security=True)

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        max_actions_per_step=5,
        use_vision=True,
    )

    print(f"🤖 Task: {task}")
    print(f"🧠 Model: {model} → Anthropic API direct")
    print(f"🌐 Chrome @ {CDP_URL}")
    print("─" * 50)

    result = await agent.run(max_steps=max_steps)

    final = None
    if hasattr(result, 'history'):
        for item in reversed(result.history):
            results = item.result if hasattr(item, 'result') else []
            for r in results:
                if hasattr(r, 'extracted_content') and r.extracted_content and not r.extracted_content.startswith("🔗"):
                    final = r.extracted_content
                    break
            if final:
                break
    if not final and hasattr(result, 'all_results'):
        for r in reversed(result.all_results):
            if r.extracted_content and not r.extracted_content.startswith("🔗"):
                final = r.extracted_content
                break

    print("─" * 50)
    if final:
        print(f"✅ Result: {final}")
    else:
        print(f"⚠️  No extraction. Raw: {str(result)[:300]}")

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 browser_agent.py <task>")
        print("       python3 browser_agent.py --test")
        print(f"  Default model: {DEFAULT_MODEL}")
        sys.exit(1)

    if sys.argv[1] == "--test":
        asyncio.run(test_connection())
    else:
        task = " ".join(sys.argv[1:])
        asyncio.run(run_task(task, DEFAULT_MODEL))
