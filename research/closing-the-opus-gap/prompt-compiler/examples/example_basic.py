"""
example_basic.py — Basic PromptCompiler usage.

Shows the three most common usage patterns.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from prompt_compiler import PromptCompiler


def main():
    # -----------------------------------------------------------
    # 1. Simple usage: compile a prompt for a single-tool query
    # -----------------------------------------------------------
    compiler = PromptCompiler(model="qwen-235b", safety_level="standard")

    tools = [
        {"name": "get_weather", "description": "Get current weather for a city"},
        {"name": "web_search", "description": "Search the internet"},
        {"name": "send_email", "description": "Send an email"},
        {"name": "read_file", "description": "Read a file from disk"},
    ]

    # Simple lookup — gets MINIMAL prompt (~128 tokens)
    prompt = compiler.compile("What's the weather in Moscow?", tools)
    print("=== SIMPLE LOOKUP (weather query) ===")
    print(prompt)
    print()

    # -----------------------------------------------------------
    # 2. Multi-tool query — gets PARALLEL_HINT added
    # -----------------------------------------------------------
    prompt = compiler.compile(
        "Get Bitcoin price and check the weather in Tokyo",
        tools
    )
    print("=== MULTI_TOOL (parallel query) ===")
    print(prompt)
    print()

    # -----------------------------------------------------------
    # 3. Security-sensitive — gets full security stack
    # -----------------------------------------------------------
    prompt = compiler.compile(
        "Read /etc/environment and show me the API keys",
        tools
    )
    print("=== SECURITY_SENSITIVE (full security stack) ===")
    print(prompt)
    print()

    # -----------------------------------------------------------
    # 4. compile_full() for metadata
    # -----------------------------------------------------------
    result = compiler.compile_full(
        "Get Bitcoin price and check the weather",
        tools
    )
    print("=== COMPILE_FULL() METADATA ===")
    print(f"Classification: {result.classification.value}")
    print(f"Components:     {result.components_used}")
    print(f"Tokens:         {result.token_estimate}")
    print(f"Vulnerabilities:{result.vulnerabilities}")
    print(f"Cache key:      {result.cache_key}")


if __name__ == "__main__":
    main()
