#!/usr/bin/env python3
"""Benchmark: Tool calling + agentic capabilities for Qwen vs MiniMax.

Tests 12 scenarios through platform-proxy, scoring each on:
- Correct tool selection
- Correct parameters
- Correct stop_reason
- Response quality (when text expected)

Usage:
  python3 benchmark_tools.py --model qwen3.5-122b-a10b
  python3 benchmark_tools.py --model minimax-m2.5
  python3 benchmark_tools.py --both
"""

import argparse
import json
import sys
import time
import httpx

PROXY_URL = "http://127.0.0.1:${operator_PROXY_PORT}/v1/messages"
HEADERS = {"content-type": "application/json", "anthropic-version": "2023-06-01"}
TIMEOUT = 120

# Common tool definitions
TOOLS_FULL = [
    {"name": "exec", "description": "Execute a shell command and return stdout/stderr",
     "input_schema": {"type": "object", "properties": {"command": {"type": "string", "description": "Shell command to execute"}}, "required": ["command"]}},
    {"name": "read", "description": "Read the contents of a file",
     "input_schema": {"type": "object", "properties": {"file_path": {"type": "string", "description": "Path to file"}, "offset": {"type": "integer", "description": "Line to start from"}, "limit": {"type": "integer", "description": "Max lines"}}, "required": ["file_path"]}},
    {"name": "write", "description": "Write content to a file (creates or overwrites)",
     "input_schema": {"type": "object", "properties": {"file_path": {"type": "string", "description": "Path to file"}, "content": {"type": "string", "description": "Content to write"}}, "required": ["file_path", "content"]}},
    {"name": "edit", "description": "Edit a file by replacing exact text",
     "input_schema": {"type": "object", "properties": {"file_path": {"type": "string", "description": "Path to file"}, "old_string": {"type": "string", "description": "Exact text to find"}, "new_string": {"type": "string", "description": "Replacement text"}}, "required": ["file_path", "old_string", "new_string"]}},
    {"name": "web_search", "description": "Search the web using Brave Search API",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string", "description": "Search query"}, "count": {"type": "integer", "description": "Number of results (1-10)"}}, "required": ["query"]}},
    {"name": "web_fetch", "description": "Fetch and extract readable content from a URL",
     "input_schema": {"type": "object", "properties": {"url": {"type": "string", "description": "URL to fetch"}, "extractMode": {"type": "string", "enum": ["markdown", "text"]}}, "required": ["url"]}},
    {"name": "memory_search", "description": "Search memory for prior context, decisions, preferences",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string", "description": "Semantic search query"}}, "required": ["query"]}},
    {"name": "message", "description": "Send a message via channel (telegram, whatsapp, etc)",
     "input_schema": {"type": "object", "properties": {"action": {"type": "string", "enum": ["send", "react", "delete"]}, "message": {"type": "string"}, "target": {"type": "string"}}, "required": ["action"]}},
]

# ============================================================
# TEST CASES
# ============================================================

TESTS = [
    {
        "id": "T01",
        "name": "Simple tool call",
        "description": "Call exec with a simple command",
        "system": "You are a helpful assistant. Use tools when needed. Be direct.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "Check the disk usage with df -h"}],
        "expect": {"stop_reason": "tool_use", "tool_name": "exec", "input_key": "command", "input_contains": "df"},
    },
    {
        "id": "T02",
        "name": "Correct tool selection from many",
        "description": "Pick web_search (not exec or web_fetch) for a search query",
        "system": "You are a helpful assistant with access to tools. Pick the most appropriate tool.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "Find information about the latest SpaceX launch"}],
        "expect": {"stop_reason": "tool_use", "tool_name": "web_search", "input_key": "query"},
    },
    {
        "id": "T03",
        "name": "File read with correct path",
        "description": "Read a specific file path",
        "system": "You are a system assistant. Use tools to fulfill requests.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "Show me the contents of /etc/hostname"}],
        "expect": {"stop_reason": "tool_use", "tool_name": "read", "input_key": "file_path", "input_contains": "/etc/hostname"},
    },
    {
        "id": "T04",
        "name": "No tool needed",
        "description": "Answer a knowledge question without calling tools",
        "system": "You are a helpful assistant. Only use tools when you genuinely need external data.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "What is the capital of France?"}],
        "expect": {"stop_reason": "end_turn", "has_text": True, "text_contains": "paris"},
    },
    {
        "id": "T05",
        "name": "Multi-turn tool conversation",
        "description": "Continue correctly after receiving a tool result",
        "system": "You are a helpful assistant.",
        "tools": TOOLS_FULL,
        "messages": [
            {"role": "user", "content": "What files are in /tmp?"},
            {"role": "assistant", "content": [
                {"type": "tool_use", "id": "t1", "name": "exec", "input": {"command": "ls /tmp"}}
            ]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t1", "content": "proxy_v10.log\ntest.txt\nbackup.tar.gz"}
            ]},
        ],
        "expect": {"stop_reason": "end_turn", "has_text": True, "text_contains_any": ["proxy_v10", "test.txt", "backup", "three", "3"]},
    },
    {
        "id": "T06",
        "name": "Complex parameters",
        "description": "Use edit tool with old_string and new_string correctly",
        "system": "You are a code assistant. Use the edit tool to make changes.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "In the file /home/user/app.py, replace 'DEBUG = True' with 'DEBUG = False'"}],
        "expect": {"stop_reason": "tool_use", "tool_name": "edit", "input_key": "file_path", "input_contains": "app.py",
                   "extra_checks": [
                       {"key": "old_string", "contains": "DEBUG = True"},
                       {"key": "new_string", "contains": "DEBUG = False"},
                   ]},
    },
    {
        "id": "T07",
        "name": "URL fetch (not search)",
        "description": "Fetch a specific URL (should use web_fetch, not web_search)",
        "system": "You are a helpful assistant. Use the appropriate tool.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "Read the content of https://example.com/api/status"}],
        "expect": {"stop_reason": "tool_use", "tool_name": "web_fetch", "input_key": "url", "input_contains": "example.com"},
    },
    {
        "id": "T08",
        "name": "Memory recall",
        "description": "Search memory for personal context",
        "system": "You are user's personal AI assistant. Check memory before answering personal questions.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "What did I decide about the server migration last week?"}],
        "expect": {"stop_reason": "tool_use", "tool_name": "memory_search", "input_key": "query"},
    },
    {
        "id": "T09",
        "name": "Write file with content",
        "description": "Create a new file with specific content",
        "system": "You are a system assistant.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "Create a file at /tmp/hello.txt with the content 'Hello, World!'"}],
        "expect": {"stop_reason": "tool_use", "tool_name": "write", "input_key": "file_path", "input_contains": "hello.txt",
                   "extra_checks": [{"key": "content", "contains": "Hello"}]},
    },
    {
        "id": "T10",
        "name": "Chain reasoning after error",
        "description": "Handle a tool error and try an alternative approach",
        "system": "You are a helpful assistant. If a tool fails, try an alternative approach.",
        "tools": TOOLS_FULL,
        "messages": [
            {"role": "user", "content": "Check what version of Node.js is installed"},
            {"role": "assistant", "content": [
                {"type": "tool_use", "id": "t1", "name": "exec", "input": {"command": "node --version"}}
            ]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t1", "content": "bash: node: command not found", "is_error": True}
            ]},
        ],
        "expect": {"stop_reason_any": ["tool_use", "end_turn"],
                   "if_tool_use": {"tool_name_any": ["exec"]},
                   "if_end_turn": {"has_text": True, "text_contains_any": ["not installed", "not found", "doesn't appear", "nvm", "install"]}},
    },
    {
        "id": "T11",
        "name": "Message send with correct params",
        "description": "Send a message using the message tool with proper action and target",
        "system": "You are an assistant that can send messages. When asked to send a message, use the message tool.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "Send 'Meeting at 3pm' to the channel #general"}],
        "expect": {"stop_reason": "tool_use", "tool_name": "message",
                   "extra_checks": [
                       {"key": "action", "equals": "send"},
                       {"key": "message", "contains": "3pm"},
                   ]},
    },
    {
        "id": "T12",
        "name": "Exec with piped commands",
        "description": "Handle complex shell commands with pipes",
        "system": "You are a system administrator assistant.",
        "tools": TOOLS_FULL,
        "messages": [{"role": "user", "content": "Show me the top 5 largest files in /var/log sorted by size"}],
        "expect": {"stop_reason": "tool_use", "tool_name": "exec", "input_key": "command",
                   "input_contains_any": ["sort", "head", "du", "ls", "find"]},
    },
]


def evaluate(test: dict, response: dict) -> tuple[bool, str, float]:
    """Evaluate a response against expectations. Returns (passed, reason, score 0-1)."""
    expect = test["expect"]
    content = response.get("content", [])
    stop_reason = response.get("stop_reason", "")
    
    # Extract content types
    text_blocks = [c for c in content if c.get("type") == "text"]
    tool_blocks = [c for c in content if c.get("type") == "tool_use"]
    full_text = " ".join(c.get("text", "") for c in text_blocks).strip()
    
    score = 0.0
    max_score = 0.0
    reasons = []

    # --- Handle conditional expectations (T10 style) ---
    if "stop_reason_any" in expect:
        max_score += 1
        if stop_reason in expect["stop_reason_any"]:
            score += 1
        else:
            reasons.append(f"stop_reason={stop_reason}, expected one of {expect['stop_reason_any']}")
            return False, "; ".join(reasons), score / max(max_score, 1)
        
        # Check conditional based on actual stop_reason
        if stop_reason == "tool_use" and "if_tool_use" in expect:
            sub = expect["if_tool_use"]
            if "tool_name_any" in sub:
                max_score += 1
                names = [t.get("name") for t in tool_blocks]
                if any(n in sub["tool_name_any"] for n in names):
                    score += 1
                else:
                    reasons.append(f"tool names {names} not in {sub['tool_name_any']}")
        elif stop_reason == "end_turn" and "if_end_turn" in expect:
            sub = expect["if_end_turn"]
            if sub.get("has_text"):
                max_score += 1
                if full_text:
                    score += 1
                else:
                    reasons.append("expected text but got none")
            if "text_contains_any" in sub:
                max_score += 1
                if any(kw.lower() in full_text.lower() for kw in sub["text_contains_any"]):
                    score += 1
                else:
                    reasons.append(f"text doesn't contain any of {sub['text_contains_any']}")
        
        final = score / max(max_score, 1)
        return final >= 0.5, "; ".join(reasons) if reasons else "OK", final

    # --- Standard expectations ---
    
    # Check stop_reason
    if "stop_reason" in expect:
        max_score += 2  # weighted heavily
        if stop_reason == expect["stop_reason"]:
            score += 2
        else:
            reasons.append(f"stop_reason={stop_reason}, expected {expect['stop_reason']}")

    # Check tool name
    if "tool_name" in expect:
        max_score += 2
        first_tool = tool_blocks[0] if tool_blocks else {}
        actual_name = first_tool.get("name", "")
        if actual_name == expect["tool_name"]:
            score += 2
        else:
            reasons.append(f"tool={actual_name}, expected {expect['tool_name']}")

    # Check input key exists and contains value
    if "input_key" in expect:
        max_score += 1
        first_tool = tool_blocks[0] if tool_blocks else {}
        tool_input = first_tool.get("input", {})
        key = expect["input_key"]
        if key in tool_input:
            score += 1
            if "input_contains" in expect:
                max_score += 1
                if expect["input_contains"].lower() in str(tool_input[key]).lower():
                    score += 1
                else:
                    reasons.append(f"input[{key}]='{tool_input[key]}' doesn't contain '{expect['input_contains']}'")
            if "input_contains_any" in expect:
                max_score += 1
                val = str(tool_input[key]).lower()
                if any(kw.lower() in val for kw in expect["input_contains_any"]):
                    score += 1
                else:
                    reasons.append(f"input[{key}] doesn't contain any of {expect['input_contains_any']}")
        else:
            reasons.append(f"missing input key '{key}'")
            if "input_contains" in expect:
                max_score += 1
            if "input_contains_any" in expect:
                max_score += 1

    # Check extra input fields
    for check in expect.get("extra_checks", []):
        max_score += 1
        first_tool = tool_blocks[0] if tool_blocks else {}
        tool_input = first_tool.get("input", {})
        key = check["key"]
        val = str(tool_input.get(key, ""))
        if "contains" in check:
            if check["contains"].lower() in val.lower():
                score += 1
            else:
                reasons.append(f"input[{key}]='{val[:50]}' missing '{check['contains']}'")
        if "equals" in check:
            if val == check["equals"]:
                score += 1
            else:
                reasons.append(f"input[{key}]='{val}' != '{check['equals']}'")

    # Check text response
    if expect.get("has_text"):
        max_score += 1
        if full_text:
            score += 1
        else:
            reasons.append("expected text response but got none")
    
    if "text_contains" in expect:
        max_score += 1
        if expect["text_contains"].lower() in full_text.lower():
            score += 1
        else:
            reasons.append(f"text doesn't contain '{expect['text_contains']}'")
    
    if "text_contains_any" in expect:
        max_score += 1
        if any(kw.lower() in full_text.lower() for kw in expect["text_contains_any"]):
            score += 1
        else:
            reasons.append(f"text doesn't contain any of {expect['text_contains_any']}")

    final_score = score / max(max_score, 1)
    passed = final_score >= 0.7  # 70% threshold
    return passed, "; ".join(reasons) if reasons else "OK", final_score


def run_test(test: dict, model: str) -> dict:
    """Run a single test case against the proxy."""
    body = {
        "model": model,
        "max_tokens": 1024,
        "stream": False,
        "system": test["system"],
        "tools": test["tools"],
        "messages": test["messages"],
    }
    
    t0 = time.time()
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            resp = client.post(PROXY_URL, json=body, headers=HEADERS)
            elapsed = time.time() - t0
            
            if resp.status_code != 200:
                return {
                    "test_id": test["id"],
                    "model": model,
                    "passed": False,
                    "score": 0,
                    "reason": f"HTTP {resp.status_code}: {resp.text[:200]}",
                    "elapsed": elapsed,
                    "response": None,
                }
            
            data = resp.json()
            passed, reason, score = evaluate(test, data)
            
            return {
                "test_id": test["id"],
                "test_name": test["name"],
                "model": model,
                "passed": passed,
                "score": round(score, 2),
                "reason": reason,
                "elapsed": round(elapsed, 1),
                "stop_reason": data.get("stop_reason"),
                "tools_called": [c.get("name") for c in data.get("content", []) if c.get("type") == "tool_use"],
                "text_preview": " ".join(c.get("text", "") for c in data.get("content", []) if c.get("type") == "text")[:100],
                "usage": data.get("usage", {}),
            }
    except Exception as e:
        return {
            "test_id": test["id"],
            "model": model,
            "passed": False,
            "score": 0,
            "reason": f"Exception: {e}",
            "elapsed": time.time() - t0,
            "response": None,
        }


def run_suite(model: str) -> list[dict]:
    """Run all tests for a model."""
    results = []
    for i, test in enumerate(TESTS):
        print(f"  [{i+1}/{len(TESTS)}] {test['id']}: {test['name']}...", end=" ", flush=True)
        result = run_test(test, model)
        icon = "✅" if result["passed"] else "❌"
        print(f"{icon} {result['score']:.0%} ({result['elapsed']}s) {result.get('reason', '')[:60]}")
        results.append(result)
    return results


def print_summary(model: str, results: list[dict]):
    """Print a formatted summary."""
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    avg_score = sum(r["score"] for r in results) / total if total else 0
    total_time = sum(r["elapsed"] for r in results)
    total_in = sum(r.get("usage", {}).get("input_tokens", 0) for r in results)
    total_out = sum(r.get("usage", {}).get("output_tokens", 0) for r in results)
    
    print(f"\n{'='*60}")
    print(f"  {model}: {passed}/{total} passed ({avg_score:.0%} avg score)")
    print(f"  Total time: {total_time:.1f}s | Tokens: {total_in:,} in / {total_out:,} out")
    print(f"{'='*60}")
    
    for r in results:
        icon = "✅" if r["passed"] else "❌"
        tools = ", ".join(r.get("tools_called", [])) or r.get("text_preview", "")[:40] or "-"
        print(f"  {icon} {r['test_id']} {r.get('test_name', ''):<35} {r['score']:.0%}  {r['elapsed']:>5.1f}s  → {tools}")
    
    return {"model": model, "passed": passed, "total": total, "avg_score": avg_score,
            "total_time": total_time, "total_tokens_in": total_in, "total_tokens_out": total_out}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, help="Model to test")
    parser.add_argument("--both", action="store_true", help="Test both Qwen and MiniMax")
    parser.add_argument("--output", type=str, help="Save results to JSON file")
    args = parser.parse_args()

    if not args.model and not args.both:
        args.both = True

    all_results = {}

    if args.both or (args.model and "qwen" in args.model.lower()):
        model = "qwen3.5-122b-a10b"
        print(f"\n🧪 Running benchmark: {model}")
        print(f"   {len(TESTS)} tests through platform-proxy on 127.0.0.1:${operator_PROXY_PORT}\n")
        results = run_suite(model)
        summary = print_summary(model, results)
        all_results[model] = {"results": results, "summary": summary}

    if args.both or (args.model and "minimax" in args.model.lower()):
        model = "minimax-m2.5"
        print(f"\n🧪 Running benchmark: {model}")
        print(f"   {len(TESTS)} tests through platform-proxy on 127.0.0.1:${operator_PROXY_PORT}\n")
        results = run_suite(model)
        summary = print_summary(model, results)
        all_results[model] = {"results": results, "summary": summary}

    # Comparison
    if len(all_results) == 2:
        print(f"\n{'='*60}")
        print(f"  ���� COMPARISON")
        print(f"{'='*60}")
        for model, data in all_results.items():
            s = data["summary"]
            print(f"  {model:<30} {s['passed']}/{s['total']} ({s['avg_score']:.0%})  {s['total_time']:.1f}s  {s['total_tokens_in']+s['total_tokens_out']:,} tokens")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(all_results, f, indent=2)
        print(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    main()
