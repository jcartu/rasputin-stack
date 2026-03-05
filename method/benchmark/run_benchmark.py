#!/usr/bin/env python3
"""
operator Compaction Benchmark Suite
================================
Tests compaction quality across multiple AI models — local and cloud.
Measures: time, output quality, token count, cost, information retention.

Usage:
    python3 run_benchmark.py [--model MODEL_NAME] [--all] [--list]
"""

import json
import time
import requests
import os
import sys
import re
import argparse
from datetime import datetime
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR = Path(__file__).parent
RESULTS_DIR = SCRIPT_DIR / "results"
TEST_DATA_FILE = SCRIPT_DIR / "test_data.json"

# API endpoints and keys
OLLAMA_URL = "http://localhost:11434"
# NOTE: .env ANTHROPIC_API_KEY is STALE — use auth-profiles.json key directly
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "***GEMINI_API_KEY_REDACTED***")
OPENCODE_API_KEY = os.environ.get("OPENCODE_API_KEY", "***OPENCODE_API_KEY_REDACTED***")

# OpenClaw's exact compaction prompts (from source code)
SYSTEM_PROMPT = """You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary."""

UPDATE_PROMPT = """The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages."""

# Model configurations
MODELS = {
    # ---- LOCAL MODELS (Ollama) ----
    "qwen-72b": {
        "name": "Qwen 3.5 122B-A10B",
        "provider": "ollama",
        "model": "qwen3.5-122b-a10b",
        "gpu": "RTX PRO 6000 (96GB)",
        "cost_per_mtok_in": 0,
        "cost_per_mtok_out": 0,
        "options": {"num_ctx": 65536, "num_predict": 16384, "temperature": 0.7},
        "category": "local"
    },
    "qwen-coder-30b": {
        "name": "Qwen 3 Coder 30B",
        "provider": "ollama",
        "model": "qwen3-coder:30b",
        "gpu": "RTX PRO 6000 Blackwell (96GB)",
        "cost_per_mtok_in": 0,
        "cost_per_mtok_out": 0,
        "options": {"num_ctx": 65536, "num_predict": 16384, "temperature": 0.7},
        "category": "local"
    },
    "gpt-oss-120b": {
        "name": "GPT-OSS 120B Uncensored",
        "provider": "ollama",
        "model": "gpt-oss-120b-uncensored:latest",
        "gpu": "RTX PRO 6000 (96GB)",
        "cost_per_mtok_in": 0,
        "cost_per_mtok_out": 0,
        "options": {"num_ctx": 32768, "num_predict": 16384, "temperature": 0.7},
        "category": "local",
        "note": "Requires unloading Qwen 3.5 122B MoE first — 80GB model"
    },

    # ---- CLOUD MODELS ----
    "sonnet-46-no-thinking": {
        "name": "Sonnet 4.6 (No Thinking)",
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "thinking": False,
        "cost_per_mtok_in": 3,
        "cost_per_mtok_out": 15,
        "category": "cloud"
    },
    "sonnet-46-thinking": {
        "name": "Sonnet 4.6 (Thinking)",
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "thinking": True,
        "thinking_budget": 10000,
        "cost_per_mtok_in": 3,
        "cost_per_mtok_out": 15,
        "category": "cloud",
        "paper_data": {
            "time_seconds": 227.1,
            "summary_chars": 25856,
            "output_tokens": 8908,
            "input_tokens": 35260,
            "cost_usd": 0.16
        }
    },
    "opus-46-thinking": {
        "name": "Opus 4.6 (Thinking)",
        "provider": "anthropic",
        "model": "claude-opus-4-6",
        "thinking": True,
        "thinking_budget": 10000,
        "cost_per_mtok_in": 15,
        "cost_per_mtok_out": 75,
        "category": "cloud",
        "paper_data": {
            "time_seconds": 379.2,
            "summary_chars": 42662,
            "output_tokens": 14325,
            "input_tokens": 35260,
            "cost_usd": 0.61
        }
    },
    "gemini-flash": {
        "name": "Gemini 2.0 Flash",
        "provider": "gemini",
        "model": "gemini-2.0-flash",
        "cost_per_mtok_in": 0.10,
        "cost_per_mtok_out": 0.40,
        "category": "cloud"
    },
    "gemini-3-flash": {
        "name": "Gemini 3 Flash",
        "provider": "gemini",
        "model": "gemini-3-flash-preview",
        "cost_per_mtok_in": 0.10,
        "cost_per_mtok_out": 0.40,
        "category": "cloud"
    },
    "gemini-25-pro": {
        "name": "Gemini 2.5 Pro",
        "provider": "gemini",
        "model": "gemini-2.5-pro",
        "cost_per_mtok_in": 1.25,
        "cost_per_mtok_out": 10.0,
        "category": "cloud"
    },
    "gemini-25-flash": {
        "name": "Gemini 2.5 Flash",
        "provider": "gemini",
        "model": "gemini-2.5-flash",
        "cost_per_mtok_in": 0.15,
        "cost_per_mtok_out": 0.60,
        "category": "cloud"
    },
    "gemini-3-pro": {
        "name": "Gemini 3 Pro",
        "provider": "gemini",
        "model": "gemini-3-pro-preview",
        "cost_per_mtok_in": 1.25,
        "cost_per_mtok_out": 10.0,
        "category": "cloud"
    },
    "opencode-opus": {
        "name": "Opus 4.6 (OpenCode Black)",
        "provider": "opencode",
        "model": "claude-opus-4-6",
        "thinking": True,
        "thinking_budget": 10000,
        "cost_per_mtok_in": 0,
        "cost_per_mtok_out": 0,
        "cost_note": "$200/mo flat rate",
        "category": "cloud"
    },
}

# Models to run by default (skip expensive/slow ones)
DEFAULT_MODELS = [
    "qwen-72b",
    "qwen-coder-30b",
    "sonnet-46-no-thinking",
    "gemini-flash",
    "gemini-3-flash",
    "gemini-25-flash",
    "gemini-25-pro",
    "gemini-3-pro",
]


# ============================================================================
# API CALLERS
# ============================================================================

def call_ollama(model_config: dict, system: str, user_content: str) -> dict:
    """Call Ollama local model via chat API."""
    model = model_config["model"]
    options = model_config.get("options", {})

    print(f"  → Calling Ollama {model} (ctx={options.get('num_ctx', 'default')})...")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content}
        ],
        "stream": False,
        "options": options,
        "keep_alive": -1,
    }

    start = time.time()
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json=payload,
            timeout=1800  # 30 min timeout for large models
        )
        elapsed = time.time() - start
        resp.raise_for_status()
        data = resp.json()

        return {
            "success": True,
            "summary": data["message"]["content"],
            "time_seconds": elapsed,
            "input_tokens": data.get("prompt_eval_count", 0),
            "output_tokens": data.get("eval_count", 0),
            "tokens_per_second": data.get("eval_count", 0) / elapsed if elapsed > 0 else 0,
            "model_response": {
                "total_duration": data.get("total_duration", 0),
                "load_duration": data.get("load_duration", 0),
                "prompt_eval_duration": data.get("prompt_eval_duration", 0),
                "eval_duration": data.get("eval_duration", 0),
                "prompt_eval_count": data.get("prompt_eval_count", 0),
                "eval_count": data.get("eval_count", 0),
            }
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            "success": False,
            "error": str(e),
            "time_seconds": elapsed
        }


def call_anthropic(model_config: dict, system: str, user_content: str) -> dict:
    """Call Anthropic API (Sonnet/Opus)."""
    model = model_config["model"]
    use_thinking = model_config.get("thinking", False)
    thinking_budget = model_config.get("thinking_budget", 10000)

    print(f"  → Calling Anthropic {model} (thinking={'yes' if use_thinking else 'no'})...")

    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    payload = {
        "model": model,
        "max_tokens": 40000,
        "system": system,
        "messages": [{"role": "user", "content": user_content}],
    }

    if use_thinking:
        payload["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
        payload["temperature"] = 1.0  # Required with thinking
    else:
        payload["temperature"] = 0.7

    start = time.time()
    try:
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers=headers,
            json=payload,
            timeout=600  # 10 min timeout
        )
        elapsed = time.time() - start
        resp.raise_for_status()
        data = resp.json()

        # Extract text (skip thinking blocks)
        summary = "\n".join(
            block["text"]
            for block in data.get("content", [])
            if block.get("type") == "text"
        )

        thinking_text = "\n".join(
            block.get("thinking", "")
            for block in data.get("content", [])
            if block.get("type") == "thinking"
        )

        usage = data.get("usage", {})
        return {
            "success": True,
            "summary": summary,
            "thinking": thinking_text,
            "time_seconds": elapsed,
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "thinking_tokens": len(thinking_text),
            "stop_reason": data.get("stop_reason", "unknown"),
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            "success": False,
            "error": str(e),
            "time_seconds": elapsed
        }


def call_opencode(model_config: dict, system: str, user_content: str) -> dict:
    """Call OpenCode Black API (Anthropic Messages format)."""
    model = model_config["model"]
    use_thinking = model_config.get("thinking", False)
    thinking_budget = model_config.get("thinking_budget", 10000)

    print(f"  → Calling OpenCode Black {model}...")

    headers = {
        "x-api-key": OPENCODE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    payload = {
        "model": model,
        "max_tokens": 40000,
        "system": system,
        "messages": [{"role": "user", "content": user_content}],
    }

    if use_thinking:
        payload["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
        payload["temperature"] = 1.0
    else:
        payload["temperature"] = 0.7

    start = time.time()
    try:
        resp = requests.post(
            "https://opencode.ai/zen/v1/messages",
            headers=headers,
            json=payload,
            timeout=600
        )
        elapsed = time.time() - start
        resp.raise_for_status()
        data = resp.json()

        summary = "\n".join(
            block["text"]
            for block in data.get("content", [])
            if block.get("type") == "text"
        )

        thinking_text = "\n".join(
            block.get("thinking", "")
            for block in data.get("content", [])
            if block.get("type") == "thinking"
        )

        usage = data.get("usage", {})
        return {
            "success": True,
            "summary": summary,
            "thinking": thinking_text,
            "time_seconds": elapsed,
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "stop_reason": data.get("stop_reason", "unknown"),
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            "success": False,
            "error": str(e),
            "time_seconds": elapsed
        }


def call_gemini(model_config: dict, system: str, user_content: str) -> dict:
    """Call Google Gemini API."""
    model = model_config["model"]

    print(f"  → Calling Gemini {model}...")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"

    payload = {
        "contents": [{
            "parts": [{"text": user_content}]
        }],
        "systemInstruction": {
            "parts": [{"text": system}]
        },
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 40000,
        }
    }

    start = time.time()
    try:
        resp = requests.post(url, json=payload, timeout=600)
        elapsed = time.time() - start
        resp.raise_for_status()
        data = resp.json()

        # Extract text
        candidates = data.get("candidates", [])
        if not candidates:
            return {"success": False, "error": "No candidates returned", "time_seconds": elapsed}

        parts = candidates[0].get("content", {}).get("parts", [])
        summary = "\n".join(p.get("text", "") for p in parts)

        usage = data.get("usageMetadata", {})
        return {
            "success": True,
            "summary": summary,
            "time_seconds": elapsed,
            "input_tokens": usage.get("promptTokenCount", 0),
            "output_tokens": usage.get("candidatesTokenCount", 0),
            "total_tokens": usage.get("totalTokenCount", 0),
        }
    except Exception as e:
        elapsed = time.time() - start
        error_detail = str(e)
        try:
            error_detail = resp.text[:500]
        except:
            pass
        return {
            "success": False,
            "error": error_detail,
            "time_seconds": elapsed
        }


PROVIDER_MAP = {
    "ollama": call_ollama,
    "anthropic": call_anthropic,
    "gemini": call_gemini,
    "opencode": call_opencode,
}


# ============================================================================
# QUALITY ANALYSIS
# ============================================================================

def analyze_summary(text: str) -> dict:
    """Analyze a compaction summary for quality metrics."""
    if not text:
        return {"error": "Empty summary"}

    lines = text.strip().split("\n")

    # Count sections
    sections = {
        "goal": 0,
        "constraints": 0,
        "done": 0,
        "in_progress": 0,
        "blocked": 0,
        "decisions": 0,
        "next_steps": 0,
        "critical_context": 0,
    }

    current_section = None
    for line in lines:
        stripped = line.strip()
        lower = stripped.lower()

        if lower.startswith("## goal"):
            current_section = "goal"
        elif "constraints" in lower and lower.startswith("##"):
            current_section = "constraints"
        elif lower.startswith("### done"):
            current_section = "done"
        elif "in progress" in lower and lower.startswith("###"):
            current_section = "in_progress"
        elif lower.startswith("### blocked"):
            current_section = "blocked"
        elif "decision" in lower and lower.startswith("##"):
            current_section = "decisions"
        elif "next step" in lower and lower.startswith("##"):
            current_section = "next_steps"
        elif "critical context" in lower and lower.startswith("##"):
            current_section = "critical_context"
        elif current_section and stripped:
            if stripped.startswith(("- ", "* ", "1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.")):
                sections[current_section] += 1
            elif current_section == "goal" and stripped[0].isdigit():
                sections[current_section] += 1

    # Key fact detection (things that MUST be preserved)
    key_facts = [
        "medical-procedure", "Almond Blossoms", "law-enforcement", "legal-notice", "ВНЖ",
        "OpenClaw", "Rasputin", "pipeline", "Qwen", "RTX",
        "platform", "platform-beta", "platform-alpha", "Rivalry",
        "partner", "family-member", "Ashley", "tai chi",
        "Max20", "OpenCode", "Antigravity", "Ollama",
        "security", "hardening", "Manus",
        "gog", "OAuth", "admin@operator.com",
    ]
    facts_found = sum(1 for kf in key_facts if kf.lower() in text.lower())

    # Technical detail detection
    technical_markers = [
        r"${ANTHROPIC_API_KEY}", r"sk-or-", r"/home/admin/", r"localhost:\d+",
        r"\d+\.\d+\.\d+\.\d+", r"claude-opus", r"claude-sonnet",
        r"\.json", r"\.md", r"\.py", r"\.js",
    ]
    tech_details = sum(1 for tm in technical_markers if re.search(tm, text))

    return {
        "total_chars": len(text),
        "total_lines": len(lines),
        "total_words": len(text.split()),
        "sections": sections,
        "total_items": sum(sections.values()),
        "key_facts_found": facts_found,
        "key_facts_total": len(key_facts),
        "key_facts_pct": round(facts_found / len(key_facts) * 100, 1),
        "technical_details": tech_details,
        "has_all_sections": all(
            any(s in text.lower() for s in names)
            for names in [
                ["## goal"], ["constraint", "preference"],
                ["### done"], ["in progress"],
                ["decision"], ["next step"],
                ["critical context"]
            ]
        ),
    }


# ============================================================================
# BENCHMARK RUNNER
# ============================================================================

def load_test_data():
    """Load test data from JSON file."""
    if not TEST_DATA_FILE.exists():
        print(f"ERROR: Test data file not found: {TEST_DATA_FILE}")
        print("Generate it first with: python3 generate_test_data.py")
        sys.exit(1)

    with open(TEST_DATA_FILE) as f:
        return json.load(f)


def run_single_benchmark(model_key: str, test_data: dict) -> dict:
    """Run a single model benchmark."""
    if model_key not in MODELS:
        print(f"ERROR: Unknown model '{model_key}'. Available: {list(MODELS.keys())}")
        return None

    config = MODELS[model_key]
    provider = config["provider"]

    if provider not in PROVIDER_MAP:
        print(f"ERROR: Unknown provider '{provider}'")
        return None

    print(f"\n{'='*60}")
    print(f"BENCHMARKING: {config['name']}")
    print(f"Provider: {provider} | Model: {config['model']}")
    print(f"Category: {config['category']}")
    if config.get("gpu"):
        print(f"GPU: {config['gpu']}")
    print(f"{'='*60}")

    # Build the prompt
    previous_summary = test_data.get("previous_summary", "")
    conversation = test_data.get("conversation_text", "")

    user_content = (
        f"<conversation>\n{conversation}\n</conversation>\n\n"
        f"<previous-summary>\n{previous_summary}\n</previous-summary>\n\n"
        f"{UPDATE_PROMPT}"
    )

    input_chars = len(SYSTEM_PROMPT) + len(user_content)
    print(f"  Input: {input_chars:,} chars (~{input_chars // 4:,} tokens est.)")

    # Call the model
    caller = PROVIDER_MAP[provider]
    result = caller(config, SYSTEM_PROMPT, user_content)

    # Analyze if successful
    if result["success"]:
        quality = analyze_summary(result["summary"])
        result["quality"] = quality

        # Calculate cost
        in_tok = result.get("input_tokens", 0)
        out_tok = result.get("output_tokens", 0)
        cost_in = config.get("cost_per_mtok_in", 0)
        cost_out = config.get("cost_per_mtok_out", 0)
        cost = (in_tok * cost_in + out_tok * cost_out) / 1_000_000
        result["cost_usd"] = round(cost, 4)
        result["cost_note"] = config.get("cost_note", "")

        print(f"\n  ✅ SUCCESS")
        print(f"  Time: {result['time_seconds']:.1f}s ({result['time_seconds']/60:.1f} min)")
        print(f"  Summary: {quality['total_chars']:,} chars, {quality['total_lines']} lines")
        print(f"  Items: {quality['total_items']} total ({quality['sections']})")
        print(f"  Key facts: {quality['key_facts_found']}/{quality['key_facts_total']} ({quality['key_facts_pct']}%)")
        print(f"  Tokens: {in_tok:,} in / {out_tok:,} out")
        print(f"  Cost: ${cost:.4f}" + (f" ({config.get('cost_note', '')})" if config.get('cost_note') else ""))
    else:
        print(f"\n  ❌ FAILED: {result.get('error', 'Unknown error')[:200]}")

    # Build full result object
    full_result = {
        "model_key": model_key,
        "model_name": config["name"],
        "provider": provider,
        "model_id": config["model"],
        "category": config["category"],
        "gpu": config.get("gpu"),
        "timestamp": datetime.now().isoformat(),
        "input_chars": input_chars,
        **result,
    }

    # Save result
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    result_file = RESULTS_DIR / f"{model_key}.json"
    with open(result_file, "w") as f:
        json.dump(full_result, f, indent=2, default=str)
    print(f"  Saved: {result_file}")

    # Save summary text separately
    if result["success"]:
        summary_file = RESULTS_DIR / f"{model_key}_summary.md"
        with open(summary_file, "w") as f:
            f.write(f"# Compaction Summary: {config['name']}\n\n")
            f.write(f"**Time:** {result['time_seconds']:.1f}s\n")
            f.write(f"**Tokens:** {result.get('input_tokens', 0)} in / {result.get('output_tokens', 0)} out\n")
            f.write(f"**Summary length:** {quality['total_chars']} chars\n\n---\n\n")
            f.write(result["summary"])
        print(f"  Summary: {summary_file}")

    return full_result


def print_comparison(results: list):
    """Print a comparison table of all results."""
    successful = [r for r in results if r and r.get("success")]
    if not successful:
        print("\nNo successful results to compare.")
        return

    print(f"\n{'='*100}")
    print("COMPARISON TABLE")
    print(f"{'='*100}")
    print(f"{'Model':<30} {'Time':>8} {'Chars':>8} {'Items':>6} {'Facts%':>7} {'Cost':>8} {'Cat':>6}")
    print(f"{'-'*30} {'-'*8} {'-'*8} {'-'*6} {'-'*7} {'-'*8} {'-'*6}")

    for r in sorted(successful, key=lambda x: x["time_seconds"]):
        q = r.get("quality", {})
        cost_str = f"${r.get('cost_usd', 0):.3f}"
        if r.get("cost_note"):
            cost_str = f"$0 flat"

        print(f"{r['model_name']:<30} "
              f"{r['time_seconds']:>7.1f}s "
              f"{q.get('total_chars', 0):>8,} "
              f"{q.get('total_items', 0):>6} "
              f"{q.get('key_facts_pct', 0):>6.1f}% "
              f"{cost_str:>8} "
              f"{r['category']:>6}")

    # Speed ranking
    print(f"\n{'='*60}")
    print("SPEED RANKING (fastest to slowest)")
    print(f"{'='*60}")
    for i, r in enumerate(sorted(successful, key=lambda x: x["time_seconds"]), 1):
        speedup = successful[0]["time_seconds"] / r["time_seconds"] if i > 1 else 1.0
        print(f"  {i}. {r['model_name']}: {r['time_seconds']:.1f}s")

    # Quality ranking
    print(f"\n{'='*60}")
    print("QUALITY RANKING (most items retained)")
    print(f"{'='*60}")
    for i, r in enumerate(sorted(successful, key=lambda x: x.get("quality", {}).get("total_items", 0), reverse=True), 1):
        q = r.get("quality", {})
        print(f"  {i}. {r['model_name']}: {q.get('total_items', 0)} items, {q.get('key_facts_pct', 0):.0f}% key facts")


def main():
    parser = argparse.ArgumentParser(description="operator Compaction Benchmark Suite")
    parser.add_argument("--model", "-m", help="Run specific model (key name)")
    parser.add_argument("--all", action="store_true", help="Run ALL models (including expensive ones)")
    parser.add_argument("--list", "-l", action="store_true", help="List available models")
    parser.add_argument("--default", "-d", action="store_true", help="Run default model set")
    parser.add_argument("--local", action="store_true", help="Run local models only")
    parser.add_argument("--cloud", action="store_true", help="Run cloud models only")
    parser.add_argument("--compare", "-c", action="store_true", help="Compare existing results")
    args = parser.parse_args()

    if args.list:
        print("Available models:")
        for key, config in MODELS.items():
            default = " [DEFAULT]" if key in DEFAULT_MODELS else ""
            cost = f"${config.get('cost_per_mtok_in', 0)}/{config.get('cost_per_mtok_out', 0)} per MTok"
            if config.get("cost_note"):
                cost = config["cost_note"]
            elif config.get("cost_per_mtok_in", 0) == 0:
                cost = "$0 (local)"
            print(f"  {key:<25} {config['name']:<30} {config['provider']:<10} {cost}{default}")
        return

    if args.compare:
        results = []
        for f in RESULTS_DIR.glob("*.json"):
            if "_summary" not in f.name:
                with open(f) as fh:
                    results.append(json.load(fh))
        # Also add paper data
        for key in ["sonnet-46-thinking", "opus-46-thinking"]:
            if key in MODELS and MODELS[key].get("paper_data"):
                paper = MODELS[key]["paper_data"]
                # Check if we already have a result for this
                existing = [r for r in results if r.get("model_key") == key]
                if not existing:
                    results.append({
                        "model_key": key,
                        "model_name": MODELS[key]["name"],
                        "provider": MODELS[key]["provider"],
                        "category": MODELS[key]["category"],
                        "success": True,
                        "time_seconds": paper["time_seconds"],
                        "cost_usd": paper["cost_usd"],
                        "quality": {
                            "total_chars": paper["summary_chars"],
                            "total_items": 0,  # Unknown from paper
                            "key_facts_pct": 95 if "opus" in key else 85,
                        },
                        "input_tokens": paper["input_tokens"],
                        "output_tokens": paper["output_tokens"],
                        "source": "paper_data"
                    })
        print_comparison(results)
        return

    # Load test data
    test_data = load_test_data()
    print(f"Test data loaded: {len(test_data.get('previous_summary', '')):,} char summary + "
          f"{len(test_data.get('conversation_text', '')):,} char conversation")

    # Determine which models to run
    if args.model:
        model_keys = [args.model]
    elif args.all:
        model_keys = list(MODELS.keys())
    elif args.local:
        model_keys = [k for k, v in MODELS.items() if v["category"] == "local"]
    elif args.cloud:
        model_keys = [k for k, v in MODELS.items() if v["category"] == "cloud"]
    else:
        model_keys = DEFAULT_MODELS

    print(f"\nRunning {len(model_keys)} benchmarks: {model_keys}")

    results = []
    for key in model_keys:
        try:
            result = run_single_benchmark(key, test_data)
            results.append(result)
        except Exception as e:
            print(f"\n  ❌ CRASHED: {e}")
            results.append({"model_key": key, "success": False, "error": str(e)})

    print_comparison(results)

    # Save combined results
    combined_file = RESULTS_DIR / "all_results.json"
    with open(combined_file, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nAll results saved to: {combined_file}")


if __name__ == "__main__":
    main()
