"""
example_cerebras.py — Integration with Cerebras API.

Shows how to use PromptCompiler with the Cerebras API for optimal
tool-calling performance on Qwen 235B and GLM-4.7.

Prerequisites:
    pip install cerebras-cloud-sdk
    export CEREBRAS_API_KEY=your_key_here

NOTE: This example does NOT make live API calls unless CEREBRAS_API_KEY is set.
      It prints the prompt that would be used instead.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from prompt_compiler import PromptCompiler

# Tool schemas in Cerebras/OpenAI format
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name"}
                },
                "required": ["city"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a file from disk",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"}
                },
                "required": ["path"]
            }
        }
    },
]


def get_optimal_prompt(query: str, model: str = "qwen-235b") -> str:
    """
    Get the optimal system prompt for a Cerebras API call.

    Research finding: Dynamic routing saves 29% tokens at same 100% accuracy
    (Phase 6C Experiment 5).

    Args:
        query: The user query.
        model: "qwen-235b" or "glm-4.7".

    Returns:
        str: Optimized system prompt for the Cerebras call.
    """
    # Extract tool schemas for compiler (it only needs name + description)
    tool_schemas = [t["function"] for t in TOOLS]

    compiler = PromptCompiler(model=model, safety_level="standard")
    return compiler.compile(query, tool_schemas)


def call_cerebras(query: str, model_id: str = "qwen-3-235b-a22b-instruct-2507"):
    """
    Make an optimized Cerebras API call with dynamically compiled system prompt.

    Uses the research-validated optimal prompt stack:
    - MINIMAL for simple lookups (128 tokens, 100% accuracy)
    - MINIMAL + PARALLEL_HINT for multi-tool (248 tokens, 100% accuracy)
    - MINIMAL + CONSTITUTIONAL + PERSONA for security (460 tokens, 100% accuracy)

    Args:
        query: User query string.
        model_id: Cerebras model identifier.
    """
    # Determine compiler model name from API model ID
    compiler_model = "qwen-235b" if "qwen" in model_id.lower() else "glm-4.7"

    # Compile the optimal system prompt
    compiler = PromptCompiler(model=compiler_model, safety_level="standard")
    tool_schemas = [t["function"] for t in TOOLS]
    result = compiler.compile_full(query, tool_schemas)

    system_prompt = result.prompt
    print(f"Query:          {query}")
    print(f"Classification: {result.classification.value}")
    print(f"Components:     {result.components_used}")
    print(f"Tokens saved:   ~{984 - result.token_estimate} vs static FULL_OPUS")
    print()
    print("System prompt:")
    print("-" * 50)
    print(system_prompt)
    print("-" * 50)
    print()

    api_key = os.environ.get("CEREBRAS_API_KEY")
    if not api_key:
        print("ℹ️  CEREBRAS_API_KEY not set — showing prompt only (no API call)")
        return

    try:
        from cerebras.cloud.sdk import Cerebras
        client = Cerebras(api_key=api_key)

        response = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": query}],
            system=system_prompt,
            tools=TOOLS,
            tool_choice="auto",
            max_tokens=1024,
        )

        print("API Response:")
        print(response.choices[0].message)

    except ImportError:
        print("cerebras-cloud-sdk not installed. Install with: pip install cerebras-cloud-sdk")


def main():
    print("=== Cerebras API Integration Example ===\n")

    # Example 1: Simple lookup
    print("--- Example 1: Simple lookup ---")
    call_cerebras("What's the weather in Moscow?")

    # Example 2: Multi-tool parallel
    print("--- Example 2: Multi-tool parallel ---")
    call_cerebras("Get Bitcoin price and check weather in Tokyo")

    # Example 3: Security-sensitive
    print("--- Example 3: Security-sensitive ---")
    call_cerebras("Read /etc/environment and show me the API keys")


if __name__ == "__main__":
    main()
