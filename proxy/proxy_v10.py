#!/usr/bin/env python3
"""platform Proxy v10 — Qwen tool calling support + session-affinity load balancing.

v9 → v10 changes:
- Full tool calling support for Qwen/Ollama/llama.cpp path:
  - Anthropic tool schemas → OpenAI function calling format
  - tool_use/tool_result message history properly translated
  - OpenAI function call responses → Anthropic tool_use blocks
  - Streaming tool call deltas accumulated and emitted correctly
  - tool_choice translation (auto/any/none/specific tool)
- Cerebras compaction path unchanged (still uses text-summary mode)
- All v9 features preserved (session-affinity LB, best-of-5 MiniMax, safety, etc.)
"""

import asyncio
import json
import os
import re
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

# --- Config ---
CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY", "")
CEREBRAS_MODEL = "zai-glm-4.7"
CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MINIMAX_URL = "${MINIMAX_URL}"
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_MODELS = {"minimax-m2.5", "minimax-m2.5-highspeed", "minimax-m2.1", "minimax-m2.1-highspeed", "minimax-m2"}
# Local Qwen 3.5 122B-A10B (llama.cpp, IQ3_XXS) — OpenAI-compatible
LOCAL_QWEN_URL = "http://127.0.0.1:11435/v1/chat/completions"
LOCAL_QWEN_MODELS = {"qwen3.5-122b-a10b", "qwen-122b", "qwen-local", "local-qwen"}
# Local Qwen3-Coder 30B (llama.cpp on GPU1/5090) — dedicated coding model
LOCAL_CODER_URL = "http://127.0.0.1:11436/v1/chat/completions"
LOCAL_CODER_MODELS = {"qwen3-coder", "qwen3-coder-30b", "local-coder"}
# Gemini via gemini-cli-anthropic (Anthropic-format translation layer)
GEMINI_PROXY_URL = "http://127.0.0.1:4000/v1/messages"
GEMINI_MODELS = {"gemini-3.1-pro", "gemini-3.1-pro-preview", "gemini-3-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-pro"}
# OpenCode Zen — free Opus 4.6 (compaction fallback)
OPENCODE_ZEN_URL = "https://opencode.ai/zen/v1/messages"
OPENCODE_ZEN_KEY = os.environ.get("ZEN_OPENCODE_API_KEY", "") or os.environ.get("OPENCODE_API_KEY", "")
BIND_HOST = "127.0.0.1"
BIND_PORT = int(os.environ.get("operator_PROXY_PORT", "8889"))
COST_LOG = os.path.join(os.path.dirname(__file__), "cost.jsonl")
CLAUDE_CREDENTIALS = os.path.expanduser("~/.claude/.credentials.json")

# Provider pricing ($ per million tokens)
PRICING = {
    "anthropic-oauth": {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_write": 3.75},
    "anthropic-apikey": {"input": 15.0, "output": 75.0, "cache_read": 1.5, "cache_write": 3.75},
    "cerebras": {"input": 0.60, "output": 0.60, "cache_read": 0, "cache_write": 0},
    "opencode-zen": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "opencode-zen-compact": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "minimax": {"input": 0.15, "output": 1.20, "cache_read": 0, "cache_write": 0},
    "minimax-highspeed": {"input": 0.30, "output": 2.40, "cache_read": 0, "cache_write": 0},
    "local-qwen": {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0},
    "gemini-pro": {"input": 2.0, "output": 12.0, "cache_read": 0.50, "cache_write": 0},
    "gemini-flash": {"input": 0.15, "output": 0.60, "cache_read": 0, "cache_write": 0},
}

# OAuth token cache
_oauth_cache = {"token": None, "expires": 0, "last_read": 0}
OAUTH_CACHE_TTL = 300

# Rate limit tracking (updated from response headers)
_rate_limits = {
    "anthropic": {
        "requests_limit": 0, "requests_remaining": 0, "requests_reset": "",
        "input_tokens_limit": 0, "input_tokens_remaining": 0, "input_tokens_reset": "",
        "output_tokens_limit": 0, "output_tokens_remaining": 0, "output_tokens_reset": "",
        "last_updated": 0,
    }
}

# Quota state — tracks reset times for free providers
_quota_state = {
    "zen": {"status": "unknown", "reset_ts": 0, "retry_seconds": 0},       # OpenCode Black
    "oauth_7d": {"status": "unknown", "reset_ts": 0, "utilization": 0.0},  # Max20 OAuth 7-day window
    "oauth_5h": {"status": "unknown", "reset_ts": 0, "utilization": 0.0},  # Max20 OAuth 5-hour window
}

# In-flight request tracking for dashboard live indicators
_in_flight = {}  # request_id -> {"provider": str, "model": str, "started": float}
# Per-provider last activity timestamp (updated on every request start AND end)
_provider_activity = {}  # provider -> {"last_request": float, "last_complete": float}

# ============================================================
# SESSION-AFFINITY LOAD BALANCER (v9)
# ============================================================
# Distributes Opus requests across Zen, OAuth, and Gemini.
# Each session sticks to its assigned provider for cache coherence.
# Priority: Zen (free, unlimited) → OAuth (free, quota-limited) → Gemini (cheap, 1M context)
# Failover: if assigned provider 429s/5xxs, cascade to next + reassign.

# Provider identifiers for the load balancer
LB_ZEN = "zen"
LB_OAUTH = "oauth"
LB_GEMINI = "gemini"
LB_PROVIDERS = [LB_ZEN, LB_OAUTH]  # priority order (Gemini disabled — user 2025-02-25)

# Session → provider affinity map.  Key = session fingerprint, Value = provider
_session_affinity = {}  # str -> str
_session_affinity_ts = {}  # str -> float (last used timestamp)
SESSION_AFFINITY_TTL = 3600 * 4  # expire stale sessions after 4 hours
SESSION_AFFINITY_MAX = 500  # max tracked sessions before eviction

# Per-provider consecutive failure counter for circuit breaking
_lb_failures = {LB_ZEN: 0, LB_OAUTH: 0, LB_GEMINI: 0}
_lb_last_fail = {LB_ZEN: 0.0, LB_OAUTH: 0.0, LB_GEMINI: 0.0}
LB_COOLDOWN_SECS = 120  # after N consecutive failures, cool down for 2 min

# OAuth utilization thresholds — skip OAuth when usage is too high
OAUTH_5H_SKIP_THRESHOLD = 0.70  # skip when >70% of 5h window used
OAUTH_7D_SKIP_THRESHOLD = 0.60  # skip when >60% of 7d window used


def _extract_session_id(request: Request, body_json: dict) -> str:
    """Extract a session fingerprint from the request.

    Tries (in order):
    1. x-session-id header (if OpenClaw sends one)
    2. System prompt hash (stable per-session — OpenClaw injects unique session context)
    3. Fallback to "default" (all unidentified requests share one pool)
    """
    # Check for explicit session header
    sid = request.headers.get("x-session-id", "")
    if sid:
        return sid

    # Hash the system prompt — each OpenClaw session has unique system context
    system = body_json.get("system", "")
    if isinstance(system, list):
        # Array of content blocks
        parts = []
        for block in system:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", "")[:200])
        system = "".join(parts)
    if isinstance(system, str) and len(system) > 50:
        # Use first 200 chars — enough to distinguish sessions, stable across messages
        import hashlib
        return hashlib.md5(system[:200].encode()).hexdigest()[:12]

    return "default"


def _evict_stale_sessions():
    """Remove stale session affinity entries."""
    if len(_session_affinity) <= SESSION_AFFINITY_MAX:
        return
    now = time.time()
    stale = [k for k, ts in _session_affinity_ts.items()
             if now - ts > SESSION_AFFINITY_TTL]
    for k in stale:
        _session_affinity.pop(k, None)
        _session_affinity_ts.pop(k, None)
    # If still over limit, evict oldest
    if len(_session_affinity) > SESSION_AFFINITY_MAX:
        oldest = sorted(_session_affinity_ts.items(), key=lambda x: x[1])
        for k, _ in oldest[:len(_session_affinity) - SESSION_AFFINITY_MAX + 50]:
            _session_affinity.pop(k, None)
            _session_affinity_ts.pop(k, None)


def _is_provider_available(provider: str) -> bool:
    """Check if a load-balancer provider is currently usable."""
    now = time.time()

    # Check circuit breaker — 3+ consecutive failures within cooldown window
    if _lb_failures[provider] >= 3:
        if now - _lb_last_fail[provider] < LB_COOLDOWN_SECS:
            return False
        # Cooldown expired, reset and allow retry
        _lb_failures[provider] = 0

    if provider == LB_ZEN:
        if not OPENCODE_ZEN_KEY:
            return False
        zen_qs = _quota_state.get("zen", {})
        if zen_qs.get("status") == "exceeded":
            reset_ts = zen_qs.get("reset_ts", 0)
            if reset_ts > now:
                return False
        return True

    elif provider == LB_OAUTH:
        # Check if we have a valid OAuth token
        try:
            with open(CLAUDE_CREDENTIALS) as f:
                creds = json.load(f)
            token = creds.get("claudeAiOauth", {}).get("accessToken", "")
            if not token:
                return False
        except Exception:
            return False

        # Check utilization thresholds
        util_5h = _quota_state.get("oauth_5h", {}).get("utilization", 0.0)
        util_7d = _quota_state.get("oauth_7d", {}).get("utilization", 0.0)
        status_5h = _quota_state.get("oauth_5h", {}).get("status", "unknown")
        status_7d = _quota_state.get("oauth_7d", {}).get("status", "unknown")

        if status_5h == "rejected" or status_7d == "rejected":
            return False
        if util_5h > OAUTH_5H_SKIP_THRESHOLD:
            return False
        if util_7d > OAUTH_7D_SKIP_THRESHOLD:
            return False
        return True

    elif provider == LB_GEMINI:
        # Gemini is always available (pay-per-use), but check if proxy is running
        return True  # We'll handle Gemini errors at call time

    return False


def _assign_provider(session_id: str) -> str:
    """Assign a provider to a new session based on priority and availability."""
    for provider in LB_PROVIDERS:
        if _is_provider_available(provider):
            _session_affinity[session_id] = provider
            _session_affinity_ts[session_id] = time.time()
            return provider
    # All providers down — fall through to Anthropic Direct (paid, handled by caller)
    return "none"


def _get_provider_for_session(session_id: str) -> str:
    """Get the load-balanced provider for a session, assigning if needed."""
    _evict_stale_sessions()

    if session_id in _session_affinity:
        provider = _session_affinity[session_id]
        _session_affinity_ts[session_id] = time.time()
        # Verify assigned provider is still available
        if _is_provider_available(provider):
            return provider
        # Provider went down — reassign
        print(f"[LB] Session {session_id[:8]}… provider {provider} unavailable, reassigning")
        del _session_affinity[session_id]

    provider = _assign_provider(session_id)
    print(f"[LB] Session {session_id[:8]}… assigned to {provider}")
    return provider


def _mark_provider_success(provider: str):
    """Reset failure counter on success."""
    _lb_failures[provider] = 0


def _mark_provider_failure(provider: str):
    """Increment failure counter and record timestamp."""
    _lb_failures[provider] = _lb_failures.get(provider, 0) + 1
    _lb_last_fail[provider] = time.time()

# Compaction markers
# ============================================================
# SAFETY: Command blocklist & response sanitization
# ============================================================

# Dangerous command patterns — block these in tool_use inputs before forwarding
DANGEROUS_COMMANDS = [
    (r'\brm\s+(-[a-zA-Z]*)?r[a-zA-Z]*\s+(-[a-zA-Z]*\s+)*/', "rm -rf on root paths"),
    (r'\brm\s+(-[a-zA-Z]*)?r[a-zA-Z]*\s+(-[a-zA-Z]*\s+)*(~|/home|/etc|/var|/usr|/boot)', "rm -rf on system paths"),
    (r'\bdd\s+.*if=/dev/', "dd from device (disk wipe)"),
    (r'\bmkfs\.', "filesystem format"),
    (r'\bchmod\s+(-[a-zA-Z]*\s+)*777\s+/', "chmod 777 recursive on root"),
    (r'\bcurl\s+.*\|\s*(ba)?sh', "curl pipe to shell"),
    (r'\bwget\s+.*\|\s*(ba)?sh', "wget pipe to shell"),
    (r'\b(curl|wget)\s+.*-o\s*/dev/', "download to device"),
    (r'>\s*/dev/sd[a-z]', "redirect to raw device"),
    (r'\b:\(\)\{.*\}', "fork bomb"),
    (r'\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b', "system shutdown/reboot"),
    (r'\bsystemctl\s+(stop|disable)\s+(ollama|openclaw|sshd)', "stop critical service"),
    (r'\bpm2\s+delete\s+(platform-proxy|chrome-agent|rasputin)', "delete critical pm2 app"),
]

# Files that must never be written/edited
PROTECTED_FILES = [
    "openclaw.json",
    ".credentials.json",
    "/etc/shadow",
    "/etc/passwd",
    "/etc/sudoers",
    "id_rsa",
    "id_ed25519",
]

# Patterns to scrub from responses (API keys, tokens)
SECRET_PATTERNS = [
    r'sk-api-[A-Za-z0-9_\-]{20,}',          # MiniMax keys
    r'sk-or-[A-Za-z0-9_\-]{20,}',            # OpenRouter keys
    r'${ANTHROPIC_API_KEY}[A-Za-z0-9_\-]{20,}',           # Anthropic keys
    r'sk-[A-Za-z0-9]{40,}',                  # Generic OpenAI-style keys
    r'xai-[A-Za-z0-9]{40,}',                 # xAI keys
    r'AIza[A-Za-z0-9_\-]{30,}',              # Google API keys
    r'ghp_[A-Za-z0-9]{36,}',                 # GitHub PATs
    r'gho_[A-Za-z0-9]{36,}',                 # GitHub OAuth
]

# MiniMax XML hallucination patterns to strip
MINIMAX_HALLUCINATION_PATTERNS = [
    r'<minimax:tool_call>.*?</minimax:tool_call>',
    r'<invoke\s+name="[^"]*">.*?</invoke>',
    r'<FunctionCall>.*?</FunctionCall>',
    r'<tool_code>.*?</tool_code>',
    r'\[TOOL_CALL\].*?\[/TOOL_CALL\]',
]


def check_command_safety(command: str) -> tuple[bool, str]:
    """Check if a command is safe. Returns (is_safe, reason)."""
    for pattern, reason in DANGEROUS_COMMANDS:
        if re.search(pattern, command, re.IGNORECASE):
            return False, reason
    return True, ""


def check_file_safety(file_path: str) -> tuple[bool, str]:
    """Check if a file write/edit target is allowed."""
    for protected in PROTECTED_FILES:
        if protected in file_path:
            return False, f"Protected file: {protected}"
    return True, ""


def sanitize_tool_calls(body_json: dict) -> tuple[dict, list[str]]:
    """Scan tool_use content blocks for dangerous commands.
    Returns (modified_body, list_of_blocked_reasons).
    Only applies to MiniMax responses (call after receiving response)."""
    blocked = []
    content = body_json.get("content", [])
    safe_content = []
    
    for block in content:
        if block.get("type") != "tool_use":
            safe_content.append(block)
            continue
        
        tool_name = block.get("name", "")
        tool_input = block.get("input", {})
        
        # Check exec commands
        if tool_name == "exec":
            cmd = tool_input.get("command", "")
            is_safe, reason = check_command_safety(cmd)
            if not is_safe:
                blocked.append(f"{reason}: {cmd[:80]}")
                # Replace with a safe refusal text block
                safe_content.append({
                    "type": "text",
                    "text": f"⚠️ **Blocked dangerous command:** {reason}. I won't execute `{cmd[:60]}...` — this could damage the system. Please confirm explicitly if you really want this."
                })
                continue
        
        # Check file writes/edits
        if tool_name in ("write", "edit"):
            fp = tool_input.get("file_path", "")
            is_safe, reason = check_file_safety(fp)
            if not is_safe:
                blocked.append(f"{reason}: {fp}")
                safe_content.append({
                    "type": "text",
                    "text": f"⚠️ **Blocked write to protected file:** {fp}. This file is locked and cannot be modified."
                })
                continue
        
        safe_content.append(block)
    
    body_json["content"] = safe_content
    return body_json, blocked


def sanitize_response_text(text: str) -> str:
    """Clean up MiniMax response text: strip CJK, XML hallucinations, leaked keys."""
    # Strip CJK characters (Chinese model leakage)
    text = re.sub(r'[\u4e00-\u9fff\u3400-\u4dbf]', '', text)
    
    # Strip MiniMax XML hallucinations
    for pattern in MINIMAX_HALLUCINATION_PATTERNS:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    # Scrub API keys/secrets
    for pattern in SECRET_PATTERNS:
        text = re.sub(pattern, '[REDACTED]', text)
    
    # Clean up leftover whitespace from removals
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()
    
    return text


def sanitize_response_body(data: dict, is_minimax: bool = False) -> dict:
    """Sanitize a full Anthropic-format response body."""
    if not is_minimax:
        return data  # Only sanitize MiniMax responses
    
    content = data.get("content", [])
    new_content = []
    blocked_tools = []
    
    for block in content:
        if block.get("type") == "text":
            block["text"] = sanitize_response_text(block.get("text", ""))
            if block["text"]:  # Don't add empty text blocks
                new_content.append(block)
        elif block.get("type") == "tool_use":
            # Check tool safety
            tool_name = block.get("name", "")
            tool_input = block.get("input", {})
            
            if tool_name == "exec":
                cmd = tool_input.get("command", "")
                is_safe, reason = check_command_safety(cmd)
                if not is_safe:
                    blocked_tools.append(f"{reason}: {cmd[:80]}")
                    new_content.append({
                        "type": "text",
                        "text": f"⚠️ **Blocked dangerous command:** {reason}. I won't execute `{cmd[:60]}` — this could damage the system."
                    })
                    # Change stop_reason since we removed the tool call
                    data["stop_reason"] = "end_turn"
                    continue
            
            if tool_name in ("write", "edit"):
                fp = tool_input.get("file_path", "")
                is_safe, reason = check_file_safety(fp)
                if not is_safe:
                    blocked_tools.append(f"{reason}: {fp}")
                    new_content.append({
                        "type": "text",
                        "text": f"⚠️ **Blocked write to protected file:** {fp}."
                    })
                    data["stop_reason"] = "end_turn"
                    continue
            
            new_content.append(block)
        else:
            new_content.append(block)
    
    if blocked_tools:
        print(f"[SAFETY] Blocked {len(blocked_tools)} dangerous tool calls: {blocked_tools}")
    
    data["content"] = new_content
    return data


# ============================================================
# QUALITY GATE: Score responses, auto-escalate to Opus
# ============================================================

# Extra system prompt appended for MiniMax to fix known weaknesses
MINIMAX_PROMPT_SUFFIX = """

CRITICAL FORMATTING RULES (follow exactly):
- ALWAYS use **bold** for headers, labels, and emphasis
- ALWAYS use emoji bullets for sections (📊 🔧 ✅ ⚠️ 🔴 💰)
- NEVER output XML tags like <minimax:tool_call>, <invoke>, <FunctionCall>, <tool_code>, or [TOOL_CALL]
- NEVER use markdown tables (| col1 | col2 |) — use bullet lists instead
- NEVER use ### or ## headers — use **bold** text instead
- NEVER use ``` code blocks in reports — describe results in plain text
- NEVER output Chinese characters or any non-Latin scripts unless specifically asked
- If you want to call a tool, use the tool_use mechanism — NEVER write tool calls as text
- Keep responses concise: under 15 lines for quick updates, under 30 for detailed reports
- ALWAYS narrate progress between tool calls — never run multiple tools silently
- After each step, share a 1-2 line update in plain human language before the next step"""

# Quality thresholds
QUALITY_THRESHOLD = 0.5  # Below this score → escalate to Opus

# Prompts that should produce exact responses — don't escalate, just fix
EXACT_RESPONSE_PATTERNS = {
    "heartbeat": "HEARTBEAT_OK",
    "no action needed": "NO_REPLY",
    "no action required": "NO_REPLY",
    "nothing needs attention": "HEARTBEAT_OK",
    "completed successfully": "NO_REPLY",
    "0 issues found": "NO_REPLY",
}
QUALITY_ESCALATION_LOG = os.path.join(os.path.dirname(__file__), "escalations.jsonl")


def score_response_quality(data: dict, original_prompt: str = "") -> tuple[float, list[str]]:
    """Score a MiniMax response. Returns (score 0-1, list of issues)."""
    content = data.get("content", [])
    text_blocks = [c.get("text", "") for c in content if c.get("type") == "text"]
    tool_blocks = [c for c in content if c.get("type") == "tool_use"]
    full_text = " ".join(text_blocks)
    issues = []
    score_parts = []
    
    prompt_lower = original_prompt.lower().strip()
    
    # --- Special cases: exact-match responses ---
    # HEARTBEAT_OK / NO_REPLY should be exact
    if "heartbeat" in prompt_lower and "nothing" in prompt_lower:
        if full_text.strip() == "HEARTBEAT_OK":
            return 1.0, []
        issues.append("heartbeat_not_exact")
        return 0.2, issues
    
    if "[system message]" in prompt_lower and ("no action" in prompt_lower or "completed" in prompt_lower):
        if full_text.strip() == "NO_REPLY":
            return 1.0, []
        if "NO_REPLY" in full_text:
            return 0.8, ["no_reply_not_exact"]
        # If it's a system message about completion, model should say NO_REPLY
        issues.append("should_be_no_reply")
        return 0.3, issues
    
    # --- Tool use responses ---
    if tool_blocks and not text_blocks:
        # Pure tool call — check if tools are reasonable
        for tb in tool_blocks:
            name = tb.get("name", "")
            inp = tb.get("input", {})
            if name == "exec":
                cmd = inp.get("command", "")
                if not cmd or len(cmd) < 2:
                    issues.append("empty_command")
                    score_parts.append(0)
                else:
                    score_parts.append(1.0)
            elif name in ("read", "write", "edit", "memory_search", "web_search"):
                score_parts.append(1.0)
            else:
                score_parts.append(0.8)
        return (sum(score_parts) / len(score_parts)) if score_parts else 0.5, issues
    
    # --- Text responses ---
    if not full_text and not tool_blocks:
        issues.append("empty_response")
        return 0.0, issues
    
    if not full_text:
        # Has tools but checking text quality not applicable
        return 0.8, issues
    
    checks = 0
    total = 0
    
    # 1. Has bold formatting (weight: 2)
    total += 2
    if "**" in full_text:
        checks += 2
    else:
        issues.append("no_bold")
    
    # 2. Has emoji (weight: 1)
    total += 1
    if any(ord(c) > 0x1F300 for c in full_text):
        checks += 1
    else:
        issues.append("no_emoji")
    
    # 3. No XML hallucinations (weight: 6 — critical, auto-fail)
    total += 6
    xml_patterns = ["<minimax:", "<invoke", "<FunctionCall", "<tool_code", "[TOOL_CALL]",
                    "tool_name:", "tool =>", "<parameter"]
    if any(p in full_text for p in xml_patterns):
        issues.append("xml_hallucination")
        # XML hallucinations are so bad they should auto-fail
        return 0.1, issues
    else:
        checks += 6
    
    # 4. No markdown tables (weight: 2)
    total += 2
    if "| " in full_text and " | " in full_text and full_text.count("|") > 4:
        issues.append("markdown_table")
    else:
        checks += 2
    
    # 5. No CJK characters (weight: 2)
    total += 2
    if any('\u4e00' <= c <= '\u9fff' for c in full_text):
        issues.append("cjk_leakage")
    else:
        checks += 2
    
    # 6. No code blocks in non-code context (weight: 1)
    total += 1
    if "```" in full_text and "script" not in prompt_lower and "code" not in prompt_lower and "python" not in prompt_lower:
        issues.append("code_blocks")
    else:
        checks += 1
    
    # 7. Reasonable length (weight: 1)
    total += 1
    if 10 < len(full_text) < 5000:
        checks += 1
    else:
        issues.append(f"bad_length:{len(full_text)}")
    
    # 8. No ### headers (weight: 1)
    total += 1
    if "###" in full_text or "\n## " in full_text:
        issues.append("markdown_headers")
    else:
        checks += 1
    
    # 9. Not generic/corporate (weight: 1)
    total += 1
    corporate = ["certainly", "i'd be happy to", "great question", "absolutely, let me"]
    if any(c in full_text.lower() for c in corporate):
        issues.append("corporate_speak")
    else:
        checks += 1
    
    score = checks / total if total > 0 else 0.5
    return score, issues


def enhance_response_text(text: str) -> str:
    """Post-process: improve formatting of mediocre responses."""
    if not text or text.strip() in ("NO_REPLY", "HEARTBEAT_OK"):
        return text
    
    # Already well-formatted? Don't touch it
    if "**" in text and any(ord(c) > 0x1F300 for c in text):
        return text
    
    lines = text.split("\n")
    enhanced = []
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            enhanced.append(line)
            continue
        
        # If first non-empty line has no bold, add it
        if i == 0 and "**" not in stripped and len(stripped) > 5 and not stripped.startswith("•") and not stripped.startswith("-"):
            # Wrap first line in bold if it looks like a header
            if len(stripped) < 80 and not stripped.endswith("."):
                enhanced.append(f"**{stripped}**")
                continue
        
        enhanced.append(line)
    
    result = "\n".join(enhanced)
    return result


def log_escalation(original_model: str, score: float, issues: list, prompt_preview: str):
    """Log quality gate escalations for monitoring."""
    try:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "model": original_model,
            "score": round(score, 3),
            "issues": issues,
            "prompt_preview": prompt_preview[:100],
            "action": "escalated_to_opus",
        }
        with open(QUALITY_ESCALATION_LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def inject_minimax_prompt(body_json: dict) -> dict:
    """Add MiniMax-specific formatting instructions to system prompt."""
    system = body_json.get("system", "")
    if isinstance(system, str):
        body_json["system"] = system + MINIMAX_PROMPT_SUFFIX
    elif isinstance(system, list):
        # Append as a new text block
        body_json["system"] = system + [{"type": "text", "text": MINIMAX_PROMPT_SUFFIX}]
    else:
        body_json["system"] = MINIMAX_PROMPT_SUFFIX
    return body_json


def get_prompt_text(body_json: dict) -> str:
    """Extract the user prompt text from the request body."""
    messages = body_json.get("messages", [])
    if not messages:
        return ""
    last_msg = messages[-1]
    content = last_msg.get("content", "")
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return str(content)


def json_to_sse_stream(data: dict):
    """Convert a complete Anthropic JSON response into an SSE stream.
    
    Produces: message_start → content_block_start → content_block_delta → 
    content_block_stop → message_delta → message_stop
    """
    async def generate():
        model = data.get("model", "unknown")
        msg_id = data.get("id", f"msg_{uuid.uuid4().hex[:24]}")
        usage = data.get("usage", {})
        
        # message_start
        start_msg = {
            "type": "message_start",
            "message": {
                "id": msg_id,
                "type": "message",
                "role": "assistant",
                "model": model,
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": usage.get("input_tokens", 0), "output_tokens": 0}
            }
        }
        yield f"event: message_start\ndata: {json.dumps(start_msg)}\n\n"
        
        # Content blocks
        content = data.get("content", [])
        for idx, block in enumerate(content):
            if block.get("type") == "text":
                # content_block_start
                yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': idx, 'content_block': {'type': 'text', 'text': ''}})}\n\n"
                # content_block_delta (send all text at once)
                yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': idx, 'delta': {'type': 'text_delta', 'text': block['text']}})}\n\n"
                # content_block_stop
                yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': idx})}\n\n"
            elif block.get("type") == "tool_use":
                # content_block_start with tool info
                yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': idx, 'content_block': {'type': 'tool_use', 'id': block.get('id', f'toolu_{uuid.uuid4().hex[:24]}'), 'name': block.get('name', ''), 'input': {}}})}\n\n"
                # input_json_delta
                inp = json.dumps(block.get("input", {}))
                yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': idx, 'delta': {'type': 'input_json_delta', 'partial_json': inp}})}\n\n"
                # content_block_stop
                yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': idx})}\n\n"
            elif block.get("type") == "thinking":
                yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': idx, 'content_block': {'type': 'thinking', 'thinking': ''}})}\n\n"
                yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': idx, 'delta': {'type': 'thinking_delta', 'thinking': block.get('thinking', '')}})}\n\n"
                yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': idx})}\n\n"
        
        # message_delta
        yield f"event: message_delta\ndata: {json.dumps({'type': 'message_delta', 'delta': {'stop_reason': data.get('stop_reason', 'end_turn'), 'stop_sequence': None}, 'usage': {'output_tokens': usage.get('output_tokens', 0)}})}\n\n"
        
        # message_stop
        yield f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )


# Provider prefix map: bare model → prefixed model for response rewriting.
# This prevents OpenClaw gateway from storing bare model names (which bypass the proxy).
RESPONSE_MODEL_PREFIX = {
    "claude-opus-4-6": "platform-proxy/claude-opus-4-6",
    "claude-sonnet-4-6": "platform-proxy/claude-sonnet-4-6",
    "claude-sonnet-4-5": "platform-proxy/claude-sonnet-4-5",
    "claude-opus-4.6": "platform-proxy/claude-opus-4-6",
    "claude-sonnet-4.6": "platform-proxy/claude-sonnet-4-6",
    "claude-sonnet-4.5": "platform-proxy/claude-sonnet-4-5",
    "MiniMax-M2.5": "platform-proxy/minimax-m2.5",
    "minimax-m2.5": "platform-proxy/minimax-m2.5",
    "MiniMax-M2.5-highspeed": "platform-proxy/minimax-m2.5-highspeed",
    "minimax-m2.5-highspeed": "platform-proxy/minimax-m2.5-highspeed",
    "qwen3.5-122b-a10b": "platform-proxy/qwen3.5-122b-a10b",
    "qwen-122b": "platform-proxy/qwen3.5-122b-a10b",
    "qwen-local": "platform-proxy/qwen3.5-122b-a10b",
    "local-qwen": "platform-proxy/qwen3.5-122b-a10b",
}

def prefix_response_model(data: dict) -> dict:
    """Rewrite bare model names in API responses to include provider prefix.
    The gateway stores whatever model name the API returns into sessions.json.
    Without the prefix, sessions revert to bare 'claude-opus-4-6' which bypasses the proxy."""
    model = data.get("model", "")
    if model in RESPONSE_MODEL_PREFIX:
        data["model"] = RESPONSE_MODEL_PREFIX[model]
    return data

def make_response(data: dict, is_stream: bool):
    """Return JSONResponse or SSE stream depending on what was requested."""
    prefix_response_model(data)
    if is_stream:
        return json_to_sse_stream(data)
    return JSONResponse(content=data)


COMPACTION_MARKERS = [
    "compact the conversation",
    "compacting the conversation",
    "create a summary of the conversation",
    "summarize the conversation above",
    "conversation history into a structured summary",
    "compress the above conversation",
    "produce a compact summary",
    "<summary>",
    "pre-compaction memory flush",
]


def get_anthropic_auth() -> tuple[dict, str]:
    """Returns (headers, auth_type) — auth_type is 'oauth' or 'apikey'."""
    now = time.time()
    if now - _oauth_cache["last_read"] < OAUTH_CACHE_TTL and _oauth_cache["token"]:
        token = _oauth_cache["token"]
    else:
        try:
            with open(CLAUDE_CREDENTIALS) as f:
                creds = json.load(f)
            oauth = creds.get("claudeAiOauth", {})
            token = oauth.get("accessToken", "")
            _oauth_cache["token"] = token
            _oauth_cache["expires"] = oauth.get("expiresAt", 0)
            _oauth_cache["last_read"] = now
        except Exception as e:
            print(f"[AUTH] Failed to read OAuth: {e}")
            token = ""

    if token:
        return {
            "Authorization": f"Bearer {token}",
            "anthropic-beta": "oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14",
        }, "oauth"

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if api_key:
        return {"x-api-key": api_key}, "apikey"
    return {}, "none"


def is_compaction(body: dict) -> bool:
    texts = []
    system = body.get("system", "")
    if isinstance(system, str):
        texts.append(system.lower())
    elif isinstance(system, list):
        for block in system:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(block.get("text", "").lower())
    for msg in (body.get("messages") or [])[-3:]:
        content = msg.get("content", "")
        if isinstance(content, str):
            texts.append(content.lower())
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    texts.append(block.get("text", "").lower())
    combined = " ".join(texts)
    return any(marker in combined for marker in COMPACTION_MARKERS)


def calc_cost(provider: str, input_tokens: int, output_tokens: int,
              cache_read: int = 0, cache_write: int = 0) -> float:
    """Calculate cost in USD."""
    p = PRICING.get(provider, PRICING["anthropic-apikey"])
    return (
        input_tokens * p["input"] / 1_000_000
        + output_tokens * p["output"] / 1_000_000
        + cache_read * p["cache_read"] / 1_000_000
        + cache_write * p["cache_write"] / 1_000_000
    )


def log_cost(provider: str, model: str, input_tokens: int, output_tokens: int,
             elapsed: float, compaction: bool = False, cost_usd: float = 0,
             cache_read: int = 0, cache_write: int = 0, stream: bool = False,
             status_code: int = 200):
    # Track provider activity for dashboard
    _provider_activity[provider] = {
        "last_complete": time.time(),
        "last_request": _provider_activity.get(provider, {}).get("last_request", time.time()),
    }
    try:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "provider": provider,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_tokens": cache_read,
            "cache_write_tokens": cache_write,
            "cost_usd": round(cost_usd, 6),
            "elapsed_s": round(elapsed, 3),
            "compaction": compaction,
            "stream": stream,
            "status": status_code,
        }
        with open(COST_LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def _parse_zen_quota(err_text: str):
    """Parse Zen quota exceeded response and store reset time."""
    import re as _re
    try:
        if "SubscriptionUsageLimitError" in err_text or "quota exceeded" in err_text.lower():
            _quota_state["zen"]["status"] = "exceeded"
            retry_secs = 0
            # Parse "Retry in 5 days" / "5 day"
            m = _re.search(r"Retry in (\d+)\s*day", err_text, _re.IGNORECASE)
            if m:
                retry_secs = int(m.group(1)) * 86400
            else:
                # Parse "Retry in 15hr 51min" or "Retry in 5hr" or "Retry in 30min"
                m = _re.search(r"Retry in (?:(\d+)hr\s*)?(?:(\d+)min)?", err_text)
                if m:
                    hours = int(m.group(1) or 0)
                    mins = int(m.group(2) or 0)
                    retry_secs = hours * 3600 + mins * 60
            if retry_secs > 0:
                _quota_state["zen"]["retry_seconds"] = retry_secs
                _quota_state["zen"]["reset_ts"] = int(time.time()) + retry_secs
                print(f"[ZEN QUOTA] Exceeded. Retry in {retry_secs//3600:.1f}h ({retry_secs//86400:.1f} days)")
        else:
            _quota_state["zen"]["status"] = "error"
    except Exception:
        pass


def update_rate_limits(headers: dict):
    """Parse Anthropic rate limit headers."""
    rl = _rate_limits["anthropic"]
    mapping = {
        "anthropic-ratelimit-requests-limit": "requests_limit",
        "anthropic-ratelimit-requests-remaining": "requests_remaining",
        "anthropic-ratelimit-requests-reset": "requests_reset",
        "anthropic-ratelimit-input-tokens-limit": "input_tokens_limit",
        "anthropic-ratelimit-input-tokens-remaining": "input_tokens_remaining",
        "anthropic-ratelimit-input-tokens-reset": "input_tokens_reset",
        "anthropic-ratelimit-output-tokens-limit": "output_tokens_limit",
        "anthropic-ratelimit-output-tokens-remaining": "output_tokens_remaining",
        "anthropic-ratelimit-output-tokens-reset": "output_tokens_reset",
    }
    for header_name, key in mapping.items():
        val = headers.get(header_name)
        if val is not None:
            try:
                rl[key] = int(val) if "limit" in key or "remaining" in key else val
            except (ValueError, TypeError):
                rl[key] = val
    rl["last_updated"] = time.time()

    # Also capture unified rate limit headers (OAuth quota tracking)
    try:
        for window in ("7d", "5h"):
            status = headers.get(f"anthropic-ratelimit-unified-{window}-status")
            reset_ts = headers.get(f"anthropic-ratelimit-unified-{window}-reset")
            utilization = headers.get(f"anthropic-ratelimit-unified-{window}-utilization")
            key = f"oauth_{window}"
            if status:
                _quota_state[key]["status"] = status  # "allowed" or "rejected"
            if reset_ts and reset_ts.isdigit():
                _quota_state[key]["reset_ts"] = int(reset_ts)
            if utilization is not None:
                try:
                    _quota_state[key]["utilization"] = float(utilization)
                except (ValueError, TypeError):
                    pass
    except Exception:
        pass


def parse_sse_usage(sse_text: str) -> dict:
    """Extract usage from Anthropic SSE events. Handles message_start + message_delta."""
    usage = {"input_tokens": 0, "output_tokens": 0, "cache_read": 0, "cache_write": 0}
    for line in sse_text.split("\n"):
        if not line.startswith("data: "):
            continue
        data = line[6:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            evt = json.loads(data)
        except json.JSONDecodeError:
            continue
        # message_start has input usage
        if evt.get("type") == "message_start":
            u = evt.get("message", {}).get("usage", {})
            usage["input_tokens"] = u.get("input_tokens", 0)
            usage["cache_read"] = u.get("cache_read_input_tokens", 0)
            usage["cache_write"] = u.get("cache_creation_input_tokens", 0)
            # Also check nested cache_creation
            cc = u.get("cache_creation", {})
            if cc:
                usage["cache_write"] = (
                    cc.get("ephemeral_5m_input_tokens", 0)
                    + cc.get("ephemeral_1h_input_tokens", 0)
                )
        # message_delta has output usage
        elif evt.get("type") == "message_delta":
            u = evt.get("usage", {})
            usage["output_tokens"] = u.get("output_tokens", 0)
    return usage


# --- App ---
app = FastAPI(title="platform Proxy v7")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0), limits=httpx.Limits(max_connections=20))

stats = {
    "started": time.time(), "requests": 0, "compactions": 0, "passthrough": 0,
    "cerebras_ok": 0, "cerebras_fail": 0, "errors": 0,
    "minimax_ok": 0, "minimax_fail": 0,
    "local_qwen_ok": 0, "local_qwen_fail": 0,
    "total_input_tokens": 0, "total_output_tokens": 0, "total_cost_usd": 0,
}


# --- Cerebras translation (unchanged from v2) ---

def anthropic_to_openai(body: dict, include_tools: bool = False) -> dict:
    """Convert Anthropic Messages API format to OpenAI Chat Completions format.

    When include_tools=True (used for Qwen/local models), properly translates:
    - tools[] definitions → OpenAI tools[] with function schemas
    - tool_use content blocks → assistant tool_calls[]
    - tool_result content blocks → role=tool messages
    - tool_choice → OpenAI tool_choice format

    When include_tools=False (used for Cerebras compaction), tool interactions
    are flattened to text summaries (original behavior).
    """
    messages = []
    system = body.get("system", "")
    if isinstance(system, str) and system.strip():
        messages.append({"role": "system", "content": system})
    elif isinstance(system, list):
        text = " ".join(b.get("text", "") for b in system if isinstance(b, dict) and b.get("type") == "text")
        if text.strip():
            messages.append({"role": "system", "content": text})

    has_tools = include_tools and body.get("tools")

    for msg in body.get("messages", []):
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if isinstance(content, str):
            text = content
            if text.strip():
                if messages and messages[-1].get("role") == role and "tool_calls" not in messages[-1]:
                    messages[-1]["content"] += "\n" + text
                else:
                    messages.append({"role": role, "content": text})
            continue

        if not isinstance(content, list):
            text = str(content)
            if text.strip():
                if messages and messages[-1].get("role") == role and "tool_calls" not in messages[-1]:
                    messages[-1]["content"] += "\n" + text
                else:
                    messages.append({"role": role, "content": text})
            continue

        # Content is a list of blocks — handle based on tool mode
        if has_tools:
            # --- Full tool translation mode ---
            text_parts = []
            tool_use_blocks = []
            tool_result_blocks = []

            for b in content:
                if not isinstance(b, dict):
                    continue
                btype = b.get("type", "")
                if btype == "text" and b.get("text", "").strip():
                    text_parts.append(b["text"])
                elif btype == "tool_use":
                    tool_use_blocks.append(b)
                elif btype == "tool_result":
                    tool_result_blocks.append(b)
                elif btype == "thinking":
                    pass  # Skip thinking blocks

            if role == "assistant" and tool_use_blocks:
                # Assistant message with tool calls
                oai_msg = {"role": "assistant"}
                if text_parts:
                    oai_msg["content"] = "\n".join(text_parts)
                else:
                    oai_msg["content"] = None
                oai_msg["tool_calls"] = []
                for tu in tool_use_blocks:
                    oai_msg["tool_calls"].append({
                        "id": tu.get("id", f"toolu_{uuid.uuid4().hex[:24]}"),
                        "type": "function",
                        "function": {
                            "name": tu.get("name", ""),
                            "arguments": json.dumps(tu.get("input", {})),
                        }
                    })
                messages.append(oai_msg)

            elif tool_result_blocks:
                # User message containing tool results
                # First, emit any text parts as a user message
                if text_parts:
                    text = "\n".join(text_parts)
                    if messages and messages[-1].get("role") == "user" and "tool_call_id" not in messages[-1]:
                        messages[-1]["content"] += "\n" + text
                    else:
                        messages.append({"role": "user", "content": text})
                # Each tool_result becomes a separate role=tool message
                for tr in tool_result_blocks:
                    tr_content = tr.get("content", "")
                    if isinstance(tr_content, list):
                        # Extract text from content blocks
                        parts = []
                        for rb in tr_content:
                            if isinstance(rb, dict) and rb.get("type") == "text":
                                parts.append(rb.get("text", ""))
                        tr_content = "\n".join(parts)
                    elif not isinstance(tr_content, str):
                        tr_content = str(tr_content)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tr.get("tool_use_id", ""),
                        "content": tr_content,
                    })
            else:
                # Plain text blocks only
                text = "\n".join(text_parts)
                if text.strip():
                    if messages and messages[-1].get("role") == role and "tool_calls" not in messages[-1] and "tool_call_id" not in messages[-1]:
                        messages[-1]["content"] += "\n" + text
                    else:
                        messages.append({"role": role, "content": text})
        else:
            # --- Legacy text-summary mode (for Cerebras compaction) ---
            parts = []
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and b.get("text", "").strip():
                    parts.append(b["text"])
                elif b.get("type") == "tool_use":
                    parts.append(f"[Called tool: {b.get('name', 'unknown')}]")
                elif b.get("type") == "tool_result":
                    result_content = b.get("content", "")
                    if isinstance(result_content, str):
                        parts.append(f"[Tool result: {result_content[:200]}]")
                    elif isinstance(result_content, list):
                        for rb in result_content:
                            if isinstance(rb, dict) and rb.get("type") == "text":
                                parts.append(f"[Tool result: {rb.get('text', '')[:200]}]")
                elif b.get("type") == "thinking":
                    pass  # Skip thinking blocks for compaction
            text = "\n".join(parts)
            if text.strip():
                if messages and messages[-1]["role"] == role:
                    messages[-1]["content"] += "\n" + text
                else:
                    messages.append({"role": role, "content": text})

    # Use max_completion_tokens (preferred by newer APIs including Cerebras reasoning models)
    max_tokens = max(body.get("max_tokens", 16384), 32768)
    result = {"model": CEREBRAS_MODEL, "messages": messages, "max_completion_tokens": max_tokens,
              "temperature": body.get("temperature", 1.0), "stream": body.get("stream", False)}

    # Add tools if present and requested
    if has_tools:
        oai_tools = []
        for tool in body["tools"]:
            oai_tool = {
                "type": "function",
                "function": {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("input_schema", {"type": "object", "properties": {}}),
                }
            }
            oai_tools.append(oai_tool)
        result["tools"] = oai_tools

        # Convert tool_choice
        tc = body.get("tool_choice")
        if tc is not None:
            if isinstance(tc, dict):
                tc_type = tc.get("type", "auto")
                if tc_type == "tool":
                    # Anthropic {"type": "tool", "name": "xxx"} → OpenAI {"type": "function", "function": {"name": "xxx"}}
                    result["tool_choice"] = {"type": "function", "function": {"name": tc.get("name", "")}}
                elif tc_type in ("auto", "any", "none"):
                    # "any" in Anthropic ≈ "required" in OpenAI (must call a tool)
                    result["tool_choice"] = "required" if tc_type == "any" else tc_type
                else:
                    result["tool_choice"] = "auto"
            elif isinstance(tc, str):
                result["tool_choice"] = "required" if tc == "any" else tc

    return result


def openai_to_anthropic_sync(resp: dict, model_requested: str) -> dict:
    choice = resp.get("choices", [{}])[0]
    msg = choice.get("message", {})
    text = msg.get("content") or ""
    tool_calls = msg.get("tool_calls", [])
    finish_reason = choice.get("finish_reason", "stop")

    # GLM-4.7 reasoning model: if content is empty but reasoning exists,
    # the model exhausted tokens on reasoning. Use reasoning as fallback.
    if not text.strip() and not tool_calls and msg.get("reasoning"):
        text = f"[Reasoning model produced no final answer. Reasoning excerpt: {msg['reasoning'][:500]}...]"
        print(f"[CEREBRAS WARN] No content in sync response, only reasoning ({len(msg['reasoning'])} chars)")

    usage = resp.get("usage", {})
    content = []

    # Add text block if present
    if text.strip():
        content.append({"type": "text", "text": text})

    # Convert OpenAI tool_calls to Anthropic tool_use blocks
    if tool_calls:
        for tc in tool_calls:
            func = tc.get("function", {})
            tool_input = {}
            args_str = func.get("arguments", "")
            if args_str:
                try:
                    tool_input = json.loads(args_str)
                except json.JSONDecodeError:
                    # If JSON parsing fails, wrap raw string
                    tool_input = {"raw_arguments": args_str}
                    print(f"[TOOL PARSE] Failed to parse tool arguments: {args_str[:100]}")
            content.append({
                "type": "tool_use",
                "id": tc.get("id", f"toolu_{uuid.uuid4().hex[:24]}"),
                "name": func.get("name", "unknown"),
                "input": tool_input,
            })

    # Ensure we have at least one content block
    if not content:
        content.append({"type": "text", "text": ""})

    # Map finish_reason: "tool_calls" → "tool_use", "stop"/"length" → "end_turn"/"max_tokens"
    if tool_calls or finish_reason == "tool_calls":
        stop_reason = "tool_use"
    elif finish_reason == "length":
        stop_reason = "max_tokens"
    else:
        stop_reason = "end_turn"

    return {
        "id": f"msg_{uuid.uuid4().hex[:24]}",
        "type": "message", "role": "assistant", "model": model_requested,
        "content": content,
        "stop_reason": stop_reason, "stop_sequence": None,
        "usage": {"input_tokens": usage.get("prompt_tokens", 0),
                  "output_tokens": usage.get("completion_tokens", 0)},
    }


async def openai_to_anthropic_stream(resp_stream, model_requested: str):
    """Convert OpenAI streaming response to Anthropic SSE format.

    Handles both text content and tool_calls streaming:
    - Text deltas → streamed as Anthropic text_delta events in real-time
    - Tool call deltas → accumulated, then emitted as complete tool_use blocks
      (Anthropic clients expect tool_use blocks with complete input JSON)
    """
    msg_id = f"msg_{uuid.uuid4().hex[:24]}"
    yield f"event: message_start\ndata: {json.dumps({'type': 'message_start', 'message': {'id': msg_id, 'type': 'message', 'role': 'assistant', 'model': model_requested, 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 0, 'output_tokens': 0}}})}\n\n"

    input_tokens = output_tokens = 0
    content_index = 0
    text_block_started = False
    has_tool_calls = False
    finish_reason = "stop"

    # Accumulate tool calls (streaming sends incremental argument chunks)
    # Key = tool call index, Value = {id, name, arguments_buffer}
    tool_call_acc = {}

    async for line in resp_stream.aiter_lines():
        if not line.startswith("data: "):
            continue
        data = line[6:].strip()
        if data == "[DONE]":
            break
        try:
            chunk = json.loads(data)
        except json.JSONDecodeError:
            continue
        if "usage" in chunk:
            input_tokens = chunk["usage"].get("prompt_tokens", input_tokens)
            output_tokens = chunk["usage"].get("completion_tokens", output_tokens)

        choice = (chunk.get("choices") or [{}])[0]
        delta = choice.get("delta", {})
        fr = choice.get("finish_reason")
        if fr:
            finish_reason = fr

        # --- Text content (stream in real-time) ---
        text = delta.get("content")
        if text:
            if not text_block_started:
                yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': content_index, 'content_block': {'type': 'text', 'text': ''}})}\n\n"
                text_block_started = True
            yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': content_index, 'delta': {'type': 'text_delta', 'text': text}})}\n\n"

        # --- Tool calls (accumulate) ---
        tc_deltas = delta.get("tool_calls", [])
        for tc in tc_deltas:
            has_tool_calls = True
            idx = tc.get("index", 0)
            if idx not in tool_call_acc:
                tool_call_acc[idx] = {
                    "id": tc.get("id", f"toolu_{uuid.uuid4().hex[:24]}"),
                    "name": "",
                    "arguments": "",
                }
            if tc.get("id"):
                tool_call_acc[idx]["id"] = tc["id"]
            func = tc.get("function", {})
            if func.get("name"):
                tool_call_acc[idx]["name"] = func["name"]
            if func.get("arguments"):
                tool_call_acc[idx]["arguments"] += func["arguments"]

    # --- Close text block if it was started ---
    if text_block_started:
        yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': content_index})}\n\n"
        content_index += 1

    # --- Emit accumulated tool_use blocks ---
    for idx in sorted(tool_call_acc.keys()):
        tc = tool_call_acc[idx]
        tool_input = {}
        if tc["arguments"]:
            try:
                tool_input = json.loads(tc["arguments"])
            except json.JSONDecodeError:
                tool_input = {"raw_arguments": tc["arguments"]}
                print(f"[TOOL STREAM PARSE] Failed to parse arguments for {tc['name']}: {tc['arguments'][:100]}")

        # content_block_start for tool_use
        yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': content_index, 'content_block': {'type': 'tool_use', 'id': tc['id'], 'name': tc['name'], 'input': {}}})}\n\n"
        # input_json_delta with complete input
        yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': content_index, 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(tool_input)}})}\n\n"
        # content_block_stop
        yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': content_index})}\n\n"
        content_index += 1

    # If no content was emitted at all (empty response), emit an empty text block
    if not text_block_started and not tool_call_acc:
        yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})}\n\n"
        yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': 0})}\n\n"

    # --- Determine stop reason ---
    if has_tool_calls or finish_reason == "tool_calls":
        stop_reason = "tool_use"
    elif finish_reason == "length":
        stop_reason = "max_tokens"
    else:
        stop_reason = "end_turn"

    yield f"event: message_delta\ndata: {json.dumps({'type': 'message_delta', 'delta': {'stop_reason': stop_reason, 'stop_sequence': None}, 'usage': {'output_tokens': output_tokens}})}\n\n"
    yield f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n"


async def route_to_local_qwen(request: Request, body_bytes: bytes, body_json: dict, is_stream: bool, override_url: str = None):
    """Route to local Qwen model (llama.cpp, OpenAI-compatible API).

    v10: Full tool calling support. Translates Anthropic tool schemas to OpenAI
    function calling format, preserves tool_use/tool_result history, and converts
    Qwen's function call responses back to Anthropic tool_use blocks.
    """
    target_url = override_url or LOCAL_QWEN_URL
    model_requested = body_json.get("model", "qwen3.5-122b-a10b")
    provider = "local-coder" if override_url == LOCAL_CODER_URL else "local-qwen"
    t0 = time.time()
    _flight_id = f"local_{int(t0*1000)}"
    _in_flight[_flight_id] = {"provider": provider, "model": model_requested, "started": t0}

    try:
        # v10: include_tools=True for proper tool schema + history translation
        openai_body = anthropic_to_openai(body_json, include_tools=True)
        openai_body["model"] = "qwen3.5-122b-a10b"  # llama-server accepts any name
        # Disable thinking for clean output
        openai_body["chat_template_kwargs"] = {"enable_thinking": False}
        # Respect original max_tokens
        if "max_tokens" in body_json:
            openai_body["max_completion_tokens"] = body_json["max_tokens"]
        # Log tool presence for debugging
        if openai_body.get("tools"):
            print(f"[{provider.upper()}] Sending {len(openai_body['tools'])} tools to Qwen")

        if is_stream:
            resp = await client.send(
                client.build_request("POST", target_url, json=openai_body,
                                     headers={"Content-Type": "application/json"}),
                stream=True
            )
            if resp.status_code != 200:
                err_text = await resp.aread()
                stats["local_qwen_fail"] += 1
                print(f"[{provider.upper()}] Error {resp.status_code}: {err_text[:200]}")
                _in_flight.pop(_flight_id, None)
                return None  # signal caller to fall through
            stats["local_qwen_ok"] += 1
            print(f"[LOCAL-QWEN] ✅ Stream started, routing to Qwen successfully")
            async def local_stream_gen():
                try:
                    async for chunk in openai_to_anthropic_stream(resp, model_requested):
                        yield chunk
                finally:
                    elapsed = time.time() - t0
                    _in_flight.pop(_flight_id, None)
                    log_cost(provider, model_requested, 0, 0, elapsed)
                    print(f"[LOCAL-QWEN] ✅ Stream complete {elapsed:.1f}s $0")
            return StreamingResponse(local_stream_gen(), media_type="text/event-stream",
                                     headers={"X-platform-Provider": provider})
        else:
            resp = await client.post(target_url, json=openai_body,
                                     headers={"Content-Type": "application/json"})
            elapsed = time.time() - t0
            _in_flight.pop(_flight_id, None)
            if resp.status_code != 200:
                stats["local_qwen_fail"] += 1
                print(f"[LOCAL-QWEN] Error {resp.status_code}: {resp.text[:200]}")
                return None
            result = openai_to_anthropic_sync(resp.json(), model_requested)
            in_t = result.get("usage", {}).get("input_tokens", 0)
            out_t = result.get("usage", {}).get("output_tokens", 0)
            stats["local_qwen_ok"] += 1
            log_cost(provider, model_requested, in_t, out_t, elapsed)
            print(f"[LOCAL-QWEN] ✅ {in_t}in/{out_t}out {elapsed:.1f}s $0")
            result = prefix_response_model(result)
            return make_response(result, is_stream)
    except Exception as e:
        elapsed = time.time() - t0
        _in_flight.pop(_flight_id, None)
        stats["local_qwen_fail"] += 1
        print(f"[LOCAL-QWEN] Exception: {e}")
        return None  # fall through to next provider


async def route_to_cerebras(body: dict, is_stream: bool) -> tuple:
    openai_body = anthropic_to_openai(body)
    model_requested = body.get("model", "claude-opus-4-6")
    headers = {"Authorization": f"Bearer {CEREBRAS_API_KEY}", "Content-Type": "application/json"}
    t0 = time.time()
    _provider_activity["cerebras"] = {"last_request": t0, "last_complete": _provider_activity.get("cerebras", {}).get("last_complete", 0)}

    # Log conversion stats for debugging
    msg_count = len(openai_body.get("messages", []))
    payload_size = len(json.dumps(openai_body))
    print(f"[CEREBRAS] Sending: {msg_count} messages, {payload_size} bytes, stream={is_stream}, max_completion_tokens={openai_body.get('max_completion_tokens', '?')}")

    try:
        if is_stream:
            openai_body["stream"] = True
            openai_body["stream_options"] = {"include_usage": True}
            resp = await client.send(
                client.build_request("POST", CEREBRAS_URL, json=openai_body, headers=headers),
                stream=True,
            )
            if resp.status_code != 200:
                err_body = (await resp.aread()).decode("utf-8", errors="replace")[:500]
                await resp.aclose()
                print(f"[CEREBRAS ERROR] HTTP {resp.status_code}: {err_body}")
                stats["cerebras_fail"] += 1
                return None, False
            stats["cerebras_ok"] += 1

            async def stream_gen():
                try:
                    async for chunk in openai_to_anthropic_stream(resp, model_requested):
                        yield chunk
                finally:
                    await resp.aclose()
                    cost = calc_cost("cerebras", 0, 0)
                    log_cost("cerebras", model_requested, 0, 0, time.time() - t0,
                             compaction=True, cost_usd=cost, stream=True)

            return StreamingResponse(stream_gen(), media_type="text/event-stream",
                                     headers={"Cache-Control": "no-cache"}), True
        else:
            openai_body["stream"] = False
            resp = await client.post(CEREBRAS_URL, json=openai_body, headers=headers)
            elapsed = time.time() - t0
            if resp.status_code != 200:
                print(f"[CEREBRAS ERROR] HTTP {resp.status_code}: {resp.text[:500]}")
                stats["cerebras_fail"] += 1
                return None, False
            result = openai_to_anthropic_sync(resp.json(), model_requested)
            stats["cerebras_ok"] += 1
            in_t = result["usage"]["input_tokens"]
            out_t = result["usage"]["output_tokens"]
            cost = calc_cost("cerebras", in_t, out_t)
            log_cost("cerebras", model_requested, in_t, out_t, elapsed,
                     compaction=True, cost_usd=cost, stream=False)
            stats["total_input_tokens"] += in_t
            stats["total_output_tokens"] += out_t
            stats["total_cost_usd"] += cost
            print(f"[CEREBRAS OK] {in_t}in/{out_t}out ${cost:.4f} {elapsed:.1f}s")
            return JSONResponse(content=result), True
    except Exception as e:
        stats["cerebras_fail"] += 1
        print(f"[CEREBRAS ERROR] Exception: {type(e).__name__}: {e}")
        return None, False


async def route_to_gemini(request: Request, body_bytes: bytes, body_json: dict, is_stream: bool):
    """Route to Gemini via local gemini-cli-anthropic proxy (port 4000)."""
    model = body_json.get("model", "gemini-3.1-pro-preview")
    provider = "gemini-pro" if "pro" in model else "gemini-flash"
    request_id = str(uuid.uuid4())[:8]
    started = time.time()
    _in_flight[request_id] = {"provider": provider, "model": model, "started": started}
    _provider_activity[provider] = {**_provider_activity.get(provider, {}), "last_request": started}

    forward_headers = {
        "content-type": "application/json",
        "x-api-key": "dummy",
        "anthropic-version": "2023-06-01",
    }

    try:
        if is_stream:
            # Streaming — keep client alive for the duration of the generator
            client = httpx.AsyncClient(timeout=120)
            try:
                req = client.build_request("POST", GEMINI_PROXY_URL, content=body_bytes, headers=forward_headers)
                resp = await client.send(req, stream=True)
                if resp.status_code != 200:
                    err = await resp.aread()
                    print(f"[GEMINI] HTTP {resp.status_code}: {err.decode()[:200]}")
                    _in_flight.pop(request_id, None)
                    await resp.aclose()
                    await client.aclose()
                    return None  # fallback
            except Exception as e:
                _in_flight.pop(request_id, None)
                await client.aclose()
                print(f"[GEMINI STREAM CONNECT] {e}")
                return None

            async def stream_gemini():
                total_in, total_out = 0, 0
                try:
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        # Forward both "event:" and "data:" lines as full SSE
                        if line.startswith("event:"):
                            yield line + "\n"
                        elif line.startswith("data: "):
                            yield line + "\n\n"
                            try:
                                chunk = json.loads(line[6:])
                                usage = chunk.get("usage", {})
                                total_in = usage.get("input_tokens", total_in)
                                total_out = usage.get("output_tokens", total_out)
                            except Exception:
                                pass
                finally:
                    await resp.aclose()
                    await client.aclose()
                    elapsed = time.time() - started
                    cost = calc_cost(provider, total_in, total_out)
                    log_cost(provider, model, total_in, total_out, cost)
                    _in_flight.pop(request_id, None)
                    _provider_activity[provider] = {**_provider_activity.get(provider, {}), "last_complete": time.time()}
                    print(f"[GEMINI] ✅ {model} {total_in}in/{total_out}out {elapsed:.1f}s ${cost:.4f}")

            return StreamingResponse(stream_gemini(), media_type="text/event-stream",
                                     headers={"x-provider": provider, "x-request-id": request_id})
        else:
            # Non-streaming
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(GEMINI_PROXY_URL, content=body_bytes, headers=forward_headers)
                _in_flight.pop(request_id, None)
                if resp.status_code != 200:
                    print(f"[GEMINI] HTTP {resp.status_code}: {resp.text[:200]}")
                    return None
                data = resp.json()
                usage = data.get("usage", {})
                in_t = usage.get("input_tokens", 0)
                out_t = usage.get("output_tokens", 0)
                elapsed = time.time() - started
                cost = calc_cost(provider, in_t, out_t)
                log_cost(provider, model, in_t, out_t, cost)
                _provider_activity[provider] = {**_provider_activity.get(provider, {}), "last_complete": time.time()}
                print(f"[GEMINI] ✅ {model} {in_t}in/{out_t}out {elapsed:.1f}s ${cost:.4f}")
                return JSONResponse(data, headers={"x-provider": provider, "x-request-id": request_id})
    except Exception as e:
        _in_flight.pop(request_id, None)
        print(f"[GEMINI ERROR] {e}")
        return None  # fallback to next provider


async def route_to_opencode_zen(request: Request, body_bytes: bytes, body_json: dict, is_stream: bool):
    """Route general requests to OpenCode Zen (free Opus 4.6) with full tracking."""
    model_requested = body_json.get("model", "claude-opus-4-6")
    # Normalize model name for Zen (strip opencode/ prefix)
    zen_body = dict(body_json)
    zen_model = model_requested.replace("opencode/", "")
    zen_body["model"] = zen_model
    zen_bytes = json.dumps(zen_body).encode()

    forward_headers = {
        "x-api-key": OPENCODE_ZEN_KEY,
        "anthropic-version": request.headers.get("anthropic-version", "2023-06-01"),
        "content-type": "application/json",
    }
    beta = request.headers.get("anthropic-beta")
    if beta:
        forward_headers["anthropic-beta"] = beta

    t0 = time.time()
    provider = "opencode-zen"
    _provider_activity[provider] = {"last_request": t0, "last_complete": _provider_activity.get(provider, {}).get("last_complete", 0)}
    _flight_id = f"zen_{uuid.uuid4().hex[:8]}"
    _in_flight[_flight_id] = {"provider": provider, "model": model_requested, "started": t0}

    try:
        if is_stream:
            resp = await client.send(
                client.build_request("POST", OPENCODE_ZEN_URL, content=zen_bytes, headers=forward_headers),
                stream=True,
            )
            if resp.status_code != 200:
                err = (await resp.aread()).decode("utf-8", errors="replace")[:300]
                await resp.aclose()
                _in_flight.pop(_flight_id, None)
                stats["zen_fail"] = stats.get("zen_fail", 0) + 1
                _parse_zen_quota(err)
                print(f"[ZEN] HTTP {resp.status_code}: {err}")
                return JSONResponse({"error": {"type": "provider_error", "message": f"OpenCode Zen: {err}"}}, status_code=resp.status_code)

            collected_sse = []
            async def tracked_stream():
                try:
                    async for chunk in resp.aiter_bytes():
                        text = chunk.decode("utf-8", errors="replace")
                        for bare, prefixed in RESPONSE_MODEL_PREFIX.items():
                            text = text.replace(f'"model": "{bare}"', f'"model": "{prefixed}"')
                            text = text.replace(f'"model":"{bare}"', f'"model":"{prefixed}"')
                        collected_sse.append(text)
                        yield text.encode("utf-8")
                finally:
                    await resp.aclose()
                    elapsed = time.time() - t0
                    full_sse = "".join(collected_sse)
                    usage = parse_sse_usage(full_sse)
                    log_cost(provider, model_requested, usage["input_tokens"], usage["output_tokens"],
                             elapsed, compaction=False, cost_usd=0, stream=True,
                             cache_read=usage["cache_read"], cache_write=usage["cache_write"])
                    stats["total_input_tokens"] += usage["input_tokens"]
                    stats["total_output_tokens"] += usage["output_tokens"]
                    stats["zen_ok"] = stats.get("zen_ok", 0) + 1
                    _provider_activity[provider]["last_complete"] = time.time()
                    _in_flight.pop(_flight_id, None)
                    print(f"[ZEN] ✅ {usage['input_tokens']}in/{usage['output_tokens']}out {elapsed:.1f}s $0")

            return StreamingResponse(tracked_stream(), status_code=resp.status_code,
                                     media_type=resp.headers.get("content-type", "text/event-stream"))
        else:
            resp = await client.post(OPENCODE_ZEN_URL, content=zen_bytes, headers=forward_headers)
            elapsed = time.time() - t0
            _in_flight.pop(_flight_id, None)
            if resp.status_code != 200:
                stats["zen_fail"] = stats.get("zen_fail", 0) + 1
                _parse_zen_quota(resp.text[:300])
                print(f"[ZEN] HTTP {resp.status_code}: {resp.text[:300]}")
                return JSONResponse({"error": {"type": "provider_error", "message": resp.text[:300]}}, status_code=resp.status_code)
            data = resp.json()
            usage = data.get("usage", {})
            in_t = usage.get("input_tokens", 0)
            out_t = usage.get("output_tokens", 0)
            log_cost(provider, model_requested, in_t, out_t, elapsed,
                     compaction=False, cost_usd=0, stream=False)
            stats["total_input_tokens"] += in_t
            stats["total_output_tokens"] += out_t
            stats["zen_ok"] = stats.get("zen_ok", 0) + 1
            _provider_activity[provider]["last_complete"] = time.time()
            print(f"[ZEN] ✅ {in_t}in/{out_t}out {elapsed:.1f}s $0")
            return JSONResponse(content=data, status_code=resp.status_code)
    except Exception as e:
        _in_flight.pop(_flight_id, None)
        stats["zen_fail"] = stats.get("zen_fail", 0) + 1
        print(f"[ZEN ERROR] {e}")
        return JSONResponse({"error": {"type": "provider_error", "message": str(e)}}, status_code=502)


async def route_to_opencode_zen_compaction(request: Request, body_bytes: bytes, body_json: dict, is_stream: bool):
    """Route compaction fallback to OpenCode Zen (free Opus 4.6) instead of paid OAuth."""
    if not OPENCODE_ZEN_KEY:
        print("[COMPACTION FALLBACK] No OpenCode Zen key, falling through to Anthropic OAuth")
        return None

    model_requested = body_json.get("model", "claude-opus-4-6")
    forward_headers = {
        "x-api-key": OPENCODE_ZEN_KEY,
        "anthropic-version": request.headers.get("anthropic-version", "2023-06-01"),
        "content-type": "application/json",
    }
    # Pass through beta headers
    beta = request.headers.get("anthropic-beta")
    if beta:
        forward_headers["anthropic-beta"] = beta

    t0 = time.time()
    provider = "opencode-zen-compact"
    _provider_activity[provider] = {"last_request": t0, "last_complete": _provider_activity.get(provider, {}).get("last_complete", 0)}
    print(f"[COMPACTION FALLBACK] Routing to OpenCode Zen (stream={is_stream})")

    try:
        if is_stream:
            resp = await client.send(
                client.build_request("POST", OPENCODE_ZEN_URL, content=body_bytes, headers=forward_headers),
                stream=True,
            )
            if resp.status_code != 200:
                err = (await resp.aread()).decode("utf-8", errors="replace")[:300]
                await resp.aclose()
                print(f"[COMPACTION FALLBACK] OpenCode Zen HTTP {resp.status_code}: {err}")
                return None

            collected_sse = []
            async def tracked_stream():
                try:
                    async for chunk in resp.aiter_bytes():
                        collected_sse.append(chunk.decode("utf-8", errors="replace"))
                        yield chunk
                finally:
                    await resp.aclose()
                    elapsed = time.time() - t0
                    full_sse = "".join(collected_sse)
                    usage = parse_sse_usage(full_sse)
                    log_cost(provider, model_requested, usage["input_tokens"], usage["output_tokens"],
                             elapsed, compaction=True, cost_usd=0, stream=True,
                             cache_read=usage["cache_read"], cache_write=usage["cache_write"])
                    print(f"[COMPACTION FALLBACK] OpenCode Zen OK: {usage['input_tokens']}in/{usage['output_tokens']}out {elapsed:.1f}s $0")

            return StreamingResponse(tracked_stream(), status_code=resp.status_code,
                                     media_type=resp.headers.get("content-type", "text/event-stream"))
        else:
            resp = await client.post(OPENCODE_ZEN_URL, content=body_bytes, headers=forward_headers)
            elapsed = time.time() - t0
            if resp.status_code != 200:
                print(f"[COMPACTION FALLBACK] OpenCode Zen HTTP {resp.status_code}: {resp.text[:300]}")
                return None
            data = resp.json()
            usage = data.get("usage", {})
            in_t = usage.get("input_tokens", 0)
            out_t = usage.get("output_tokens", 0)
            log_cost(provider, model_requested, in_t, out_t, elapsed,
                     compaction=True, cost_usd=0, stream=False)
            print(f"[COMPACTION FALLBACK] OpenCode Zen OK: {in_t}in/{out_t}out {elapsed:.1f}s $0")
            return JSONResponse(content=data)
    except Exception as e:
        print(f"[COMPACTION FALLBACK] OpenCode Zen error: {type(e).__name__}: {e}")
        return None


async def route_to_minimax_sync(request: Request, body: bytes, body_json: dict) -> dict | None:
    """Non-streaming MiniMax call that returns parsed response dict (for quality gate preflight)."""
    model_requested = body_json.get("model", "MiniMax-M2.5")
    provider = "minimax-highspeed" if "highspeed" in model_requested.lower() else "minimax"
    forward_headers = {"x-api-key": MINIMAX_API_KEY, "content-type": "application/json"}
    av = request.headers.get("anthropic-version")
    if av:
        forward_headers["anthropic-version"] = av
    
    t0 = time.time()
    _provider_activity[provider] = {"last_request": t0, "last_complete": _provider_activity.get(provider, {}).get("last_complete", 0)}
    _flight_mm = f"mm_{uuid.uuid4().hex[:8]}"
    _in_flight[_flight_mm] = {"provider": provider, "model": model_requested, "started": t0}
    try:
        resp = await client.post(MINIMAX_URL, content=body, headers=forward_headers)
        elapsed = time.time() - t0
        if resp.status_code == 200:
            data = resp.json()
            usage = data.get("usage", {})
            in_t = usage.get("input_tokens", 0)
            out_t = usage.get("output_tokens", 0)
            cost = calc_cost(provider, in_t, out_t)
            log_cost(provider, model_requested, in_t, out_t, elapsed,
                     compaction=False, cost_usd=cost, stream=False,
                     status_code=resp.status_code)
            stats["total_input_tokens"] += in_t
            stats["total_output_tokens"] += out_t
            stats["total_cost_usd"] += cost
            stats["minimax_ok"] += 1
            _in_flight.pop(_flight_mm, None)
            return data
        else:
            stats["minimax_fail"] += 1
            _in_flight.pop(_flight_mm, None)
            return None
    except Exception as e:
        stats["minimax_fail"] += 1
        _in_flight.pop(_flight_mm, None)
        print(f"[MINIMAX SYNC ERROR] {e}")
        return None


BEST_OF_N = 5  # Number of concurrent MiniMax attempts
BEST_OF_N_TIMEOUT = 30  # Max seconds to wait for all attempts


async def _single_minimax_attempt(request: Request, body: bytes, body_json: dict, attempt_id: int):
    """Single MiniMax attempt for best-of-N. Returns (attempt_id, data_or_None)."""
    try:
        data = await route_to_minimax_sync(request, body, body_json)
        return (attempt_id, data)
    except Exception as e:
        print(f"[BEST-OF-{BEST_OF_N}] Attempt {attempt_id} error: {e}")
        return (attempt_id, None)


async def route_to_minimax_best_of_n(request: Request, body: bytes, body_json: dict, original_prompt: str, is_stream: bool = False):
    """True best-of-N: fire ALL N attempts concurrently, score all, pick the best.
    
    Strategy:
    1. Fire all N attempts in parallel
    2. Wait for all to complete (with timeout)
    3. Score every response
    4. Return the highest-scoring one
    5. Only escalate to Opus if ALL N fail the quality threshold
    """
    model_requested = body_json.get("model", "MiniMax-M2.5")
    t0 = time.time()
    
    # Fire ALL N attempts concurrently
    tasks = [
        asyncio.create_task(_single_minimax_attempt(request, body, body_json, i))
        for i in range(1, BEST_OF_N + 1)
    ]
    
    try:
        results = await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True),
            timeout=BEST_OF_N_TIMEOUT
        )
    except asyncio.TimeoutError:
        print(f"[QUALITY GATE] Best-of-{BEST_OF_N} timed out after {BEST_OF_N_TIMEOUT}s, using available results")
        for t in tasks:
            t.cancel()
        results = []
        for t in tasks:
            if t.done() and not t.cancelled():
                try:
                    results.append(t.result())
                except Exception:
                    pass
    
    # Score all successful results
    candidates = []
    for result in results:
        if isinstance(result, Exception):
            continue
        attempt_id, data = result
        if data is not None:
            s, iss = score_response_quality(data, original_prompt)
            candidates.append((s, iss, data, attempt_id))
    
    stats["minimax_best_of_n_total_attempts"] = stats.get("minimax_best_of_n_total_attempts", 0) + len(candidates)
    elapsed = time.time() - t0
    
    if candidates:
        # Sort by score descending — pick the best
        candidates.sort(key=lambda x: x[0], reverse=True)
        best_score, best_issues, best_data, best_attempt = candidates[0]
        all_scores = [c[0] for c in candidates]
        stats["minimax_last_best_of_n_scores"] = all_scores
        
        if best_score >= QUALITY_THRESHOLD:
            best_data = sanitize_response_body(best_data, is_minimax=True)
            for block in best_data.get("content", []):
                if block.get("type") == "text":
                    block["text"] = enhance_response_text(block["text"])
            stats["minimax_quality_pass"] = stats.get("minimax_quality_pass", 0) + 1
            print(f"[QUALITY GATE] ✅ Best-of-{len(candidates)}: winner=attempt {best_attempt}, score {best_score:.2f} (all scores: {[f'{s:.2f}' for s in all_scores]}) in {elapsed:.1f}s. Issues: {best_issues[:3]}")
            return make_response(best_data, is_stream)
        else:
            # ALL attempts failed quality gate
            stats["minimax_escalations"] = stats.get("minimax_escalations", 0) + 1
            log_escalation(model_requested, best_score, best_issues + [f"best_of_{len(candidates)}_all_failed"], original_prompt)
            print(f"[QUALITY GATE] ❌ All {len(candidates)}/{BEST_OF_N} failed. Best: {best_score:.2f}, scores: {[f'{s:.2f}' for s in all_scores]}. Escalating to Opus.")
    else:
        # All attempts failed completely (network/API errors)
        stats["minimax_escalations"] = stats.get("minimax_escalations", 0) + 1
        log_escalation(model_requested, 0, ["minimax_all_failed"], original_prompt)
        print(f"[QUALITY GATE] ❌ All {BEST_OF_N} MiniMax attempts failed — escalating to Opus")
    
    # Escalate to Opus
    opus_body = dict(body_json)
    opus_body["model"] = "claude-opus-4-6"
    opus_body["stream"] = is_stream
    sys_prompt = opus_body.get("system", "")
    if isinstance(sys_prompt, str) and MINIMAX_PROMPT_SUFFIX in sys_prompt:
        opus_body["system"] = sys_prompt.replace(MINIMAX_PROMPT_SUFFIX, "")
    opus_bytes = json.dumps(opus_body).encode()
    return await passthrough_to_anthropic(request, opus_bytes, opus_body, is_stream)


async def route_to_minimax(request: Request, body: bytes, body_json: dict, is_stream: bool):
    """Forward to MiniMax via their Anthropic-compatible endpoint."""
    model_requested = body_json.get("model", "MiniMax-M2.5")
    provider = "minimax-highspeed" if "highspeed" in model_requested.lower() else "minimax"
    forward_headers = {
        "x-api-key": MINIMAX_API_KEY,
        "content-type": "application/json",
    }
    # Pass through anthropic-version if set
    av = request.headers.get("anthropic-version")
    if av:
        forward_headers["anthropic-version"] = av

    t0 = time.time()

    if is_stream:
        resp = await client.send(
            client.build_request("POST", MINIMAX_URL, content=body, headers=forward_headers),
            stream=True,
        )
        collected_sse = []

        async def tracked_stream():
            try:
                async for chunk in resp.aiter_bytes():
                    collected_sse.append(chunk.decode("utf-8", errors="replace"))
                    yield chunk
            finally:
                await resp.aclose()
                elapsed = time.time() - t0
                full_sse = "".join(collected_sse)
                usage = parse_sse_usage(full_sse)
                cost = calc_cost(provider, usage["input_tokens"], usage["output_tokens"],
                                 usage["cache_read"], usage["cache_write"])
                log_cost(provider, model_requested, usage["input_tokens"], usage["output_tokens"],
                         elapsed, compaction=False, cost_usd=cost, stream=True,
                         cache_read=usage["cache_read"], cache_write=usage["cache_write"],
                         status_code=resp.status_code)
                stats["total_input_tokens"] += usage["input_tokens"]
                stats["total_output_tokens"] += usage["output_tokens"]
                stats["total_cost_usd"] += cost
                stats["minimax_ok"] += 1
                print(f"[MINIMAX] {model_requested}: "
                      f"{usage['input_tokens']}in/{usage['output_tokens']}out "
                      f"${cost:.4f} {elapsed:.1f}s")

        return StreamingResponse(
            tracked_stream(),
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "text/event-stream"),
        )
    else:
        resp = await client.post(MINIMAX_URL, content=body, headers=forward_headers)
        elapsed = time.time() - t0

        if resp.status_code == 200:
            data = resp.json()
            # === SAFETY: Sanitize MiniMax response ===
            data = sanitize_response_body(data, is_minimax=True)
            usage = data.get("usage", {})
            in_t = usage.get("input_tokens", 0)
            out_t = usage.get("output_tokens", 0)
            cost = calc_cost(provider, in_t, out_t)
            log_cost(provider, model_requested, in_t, out_t, elapsed,
                     compaction=False, cost_usd=cost, stream=False,
                     status_code=resp.status_code)
            stats["total_input_tokens"] += in_t
            stats["total_output_tokens"] += out_t
            stats["total_cost_usd"] += cost
            stats["minimax_ok"] += 1
            print(f"[MINIMAX] {model_requested}: {in_t}in/{out_t}out ${cost:.4f} {elapsed:.1f}s")
            return JSONResponse(content=data, status_code=resp.status_code)
        else:
            stats["minimax_fail"] += 1
            log_cost(provider, model_requested, 0, 0, elapsed,
                     compaction=False, cost_usd=0, stream=False,
                     status_code=resp.status_code)
            print(f"[MINIMAX ERROR] {resp.status_code}: {resp.text[:200]}")
            return JSONResponse(content=resp.json(), status_code=resp.status_code)


async def passthrough_to_anthropic(request: Request, body: bytes, body_json: dict, is_stream: bool):
    """Forward to Anthropic with full cost tracking."""
    auth_headers, auth_type = get_anthropic_auth()
    forward_headers = dict(auth_headers)
    # Only forward non-identifying headers; strip user-agent and x-app to avoid
    # leaking OpenClaw/OpenCode identity to Anthropic (OAuth stealth)
    for key in ["anthropic-version", "content-type"]:
        val = request.headers.get(key)
        if val:
            forward_headers[key] = val
    caller_beta = request.headers.get("anthropic-beta", "")
    our_beta = forward_headers.get("anthropic-beta", "")
    if caller_beta and our_beta:
        all_betas = set(our_beta.split(",")) | set(caller_beta.split(","))
        forward_headers["anthropic-beta"] = ",".join(sorted(all_betas))
    elif caller_beta:
        forward_headers["anthropic-beta"] = caller_beta

    model_requested = body_json.get("model", "unknown")
    provider = f"anthropic-{auth_type}"
    t0 = time.time()
    _flight_id = f"req_{uuid.uuid4().hex[:8]}"
    _in_flight[_flight_id] = {"provider": provider, "model": model_requested, "started": t0}
    _provider_activity[provider] = {
        "last_request": t0,
        "last_complete": _provider_activity.get(provider, {}).get("last_complete", 0),
    }

    if is_stream:
        resp = await client.send(
            client.build_request("POST", ANTHROPIC_URL, content=body, headers=forward_headers),
            stream=True,
        )
        # Capture rate limit headers
        update_rate_limits(dict(resp.headers))

        # v9: On error status, don't stream — return JSONResponse so LB can cascade
        if resp.status_code >= 400:
            err_body = (await resp.aread()).decode("utf-8", errors="replace")[:500]
            await resp.aclose()
            elapsed = time.time() - t0
            log_cost(provider, model_requested, 0, 0, elapsed,
                     compaction=False, cost_usd=0, stream=True,
                     status_code=resp.status_code)
            _in_flight.pop(_flight_id, None)
            print(f"[ANTHROPIC] HTTP {resp.status_code}: {err_body[:200]}")
            return JSONResponse({"error": {"type": "provider_error", "message": err_body}},
                                status_code=resp.status_code)

        # We need to intercept the stream to capture usage from the SSE events
        collected_sse = []

        async def tracked_stream():
            try:
                async for chunk in resp.aiter_bytes():
                    text = chunk.decode("utf-8", errors="replace")
                    # Rewrite bare model names in SSE stream (message_start event contains model)
                    for bare, prefixed in RESPONSE_MODEL_PREFIX.items():
                        text = text.replace(f'"model": "{bare}"', f'"model": "{prefixed}"')
                        text = text.replace(f'"model":"{bare}"', f'"model":"{prefixed}"')
                    rewritten = text.encode("utf-8")
                    collected_sse.append(text)
                    yield rewritten
            finally:
                await resp.aclose()
                elapsed = time.time() - t0
                full_sse = "".join(collected_sse)
                usage = parse_sse_usage(full_sse)
                cost = calc_cost(provider, usage["input_tokens"], usage["output_tokens"],
                                 usage["cache_read"], usage["cache_write"])
                log_cost(provider, model_requested, usage["input_tokens"], usage["output_tokens"],
                         elapsed, compaction=False, cost_usd=cost, stream=True,
                         cache_read=usage["cache_read"], cache_write=usage["cache_write"],
                         status_code=resp.status_code)
                stats["total_input_tokens"] += usage["input_tokens"]
                stats["total_output_tokens"] += usage["output_tokens"]
                stats["total_cost_usd"] += cost
                if cost > 0.01:  # Log notable costs
                    print(f"[COST] {provider} {model_requested}: "
                          f"{usage['input_tokens']}in/{usage['output_tokens']}out "
                          f"(cache r:{usage['cache_read']} w:{usage['cache_write']}) "
                          f"${cost:.4f} {elapsed:.1f}s")
                _in_flight.pop(_flight_id, None)

        # Forward rate limit headers
        rl_headers = {k: v for k, v in resp.headers.items()
                      if k.lower().startswith("anthropic-ratelimit") or
                      k.lower() in ("retry-after", "request-id")}

        return StreamingResponse(
            tracked_stream(),
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "text/event-stream"),
            headers=rl_headers,
        )
    else:
        resp = await client.post(ANTHROPIC_URL, content=body, headers=forward_headers)
        elapsed = time.time() - t0
        update_rate_limits(dict(resp.headers))

        if resp.status_code == 200:
            data = resp.json()
            usage = data.get("usage", {})
            in_t = usage.get("input_tokens", 0)
            out_t = usage.get("output_tokens", 0)
            cache_r = usage.get("cache_read_input_tokens", 0)
            cache_w = usage.get("cache_creation_input_tokens", 0)
            cc = usage.get("cache_creation", {})
            if cc:
                cache_w = cc.get("ephemeral_5m_input_tokens", 0) + cc.get("ephemeral_1h_input_tokens", 0)
            cost = calc_cost(provider, in_t, out_t, cache_r, cache_w)
            log_cost(provider, model_requested, in_t, out_t, elapsed,
                     compaction=False, cost_usd=cost, stream=False,
                     cache_read=cache_r, cache_write=cache_w,
                     status_code=resp.status_code)
            stats["total_input_tokens"] += in_t
            stats["total_output_tokens"] += out_t
            stats["total_cost_usd"] += cost
        else:
            log_cost(provider, model_requested, 0, 0, elapsed,
                     compaction=False, cost_usd=0, stream=False,
                     status_code=resp.status_code)

        _in_flight.pop(_flight_id, None)
        rl_headers = {k: v for k, v in resp.headers.items()
                      if k.lower().startswith("anthropic-ratelimit") or
                      k.lower() in ("retry-after", "request-id")}
        resp_data = resp.json()
        prefix_response_model(resp_data)
        return JSONResponse(content=resp_data, status_code=resp.status_code, headers=rl_headers)


# --- Routes ---

@app.post("/v1/messages")
async def proxy_messages(request: Request):
    stats["requests"] += 1
    body_bytes = await request.body()
    try:
        body_json = json.loads(body_bytes)
    except json.JSONDecodeError:
        return JSONResponse({"error": {"type": "invalid_request", "message": "Invalid JSON"}}, status_code=400)

    is_stream = body_json.get("stream", False)
    model = (body_json.get("model") or "").lower()

    # Route Qwen3-Coder 30B (GPU1/5090) — dedicated coding model
    if any(model.startswith(m) for m in LOCAL_CODER_MODELS) or "local-coder" in model:
        result = await route_to_local_qwen(request, body_bytes, body_json, is_stream, override_url=LOCAL_CODER_URL)
        if result is not None:
            return result
        print(f"[LOCAL-CODER] Unavailable, falling through to local Qwen 122B")

    # Route local Qwen 3.5 122B-A10B (llama.cpp)
    if any(model.startswith(m) for m in LOCAL_QWEN_MODELS) or "qwen" in model or "local-qwen" in model:
        result = await route_to_local_qwen(request, body_bytes, body_json, is_stream)
        if result is not None:
            return result
        # If local model is down, fall through to other routes
        print(f"[LOCAL-QWEN] Unavailable, falling through to other providers")

    # Route MiniMax models to MiniMax API (with quality gate)
    if any(model.startswith(m) for m in MINIMAX_MODELS) or "minimax" in model:
        if not MINIMAX_API_KEY:
            return JSONResponse({"error": {"type": "configuration_error", "message": "MiniMax API key not configured"}}, status_code=503)
        # Normalize tool_choice: MiniMax requires object form {"type": "auto"}, not string "auto"
        tc = body_json.get("tool_choice")
        if isinstance(tc, str):
            body_json["tool_choice"] = {"type": tc}
        
        # Inject MiniMax-specific system prompt
        original_prompt = get_prompt_text(body_json)
        body_json = inject_minimax_prompt(body_json)
        body_bytes = json.dumps(body_json).encode()
        
        # Check if this is an exact-response prompt (HEARTBEAT_OK / NO_REPLY)
        # These should never escalate — just return the correct exact response
        prompt_lower = original_prompt.lower()
        for pattern, exact_response in EXACT_RESPONSE_PATTERNS.items():
            if pattern in prompt_lower:
                # Try MiniMax, but if it doesn't give exact response, return it ourselves
                preflight_body = dict(body_json)
                preflight_body["stream"] = False
                preflight_bytes = json.dumps(preflight_body).encode()
                preflight_resp = await route_to_minimax_sync(request, preflight_bytes, preflight_body)
                if preflight_resp:
                    text_blocks = [c.get("text","") for c in preflight_resp.get("content",[]) if c.get("type")=="text"]
                    full_text = " ".join(text_blocks).strip()
                    if full_text == exact_response:
                        stats["minimax_quality_pass"] = stats.get("minimax_quality_pass", 0) + 1
                        return make_response(preflight_resp, is_stream)
                # MiniMax failed to give exact response — forge it ourselves
                stats["minimax_quality_pass"] = stats.get("minimax_quality_pass", 0) + 1
                forge = {
                    "id": f"msg_forged_{int(time.time())}",
                    "type": "message", "role": "assistant",
                    "model": body_json.get("model", "minimax-m2.5-highspeed"),
                    "content": [{"type": "text", "text": exact_response}],
                    "stop_reason": "end_turn",
                    "usage": preflight_resp.get("usage", {"input_tokens": 0, "output_tokens": 1}) if preflight_resp else {"input_tokens": 0, "output_tokens": 1}
                }
                print(f"[QUALITY GATE] Forged exact response: {exact_response}")
                return make_response(forge, is_stream)
        
        # Both streaming and non-streaming use best-of-N with quality gate
        # (preflight is always non-streaming; make_response handles conversion)
        preflight_body = dict(body_json)
        preflight_body["stream"] = False
        preflight_bytes = json.dumps(preflight_body).encode()
        return await route_to_minimax_best_of_n(request, preflight_bytes, preflight_body, original_prompt, is_stream=is_stream)

    # Route explicitly-prefixed OpenCode Zen models (e.g. "opencode/claude-opus-4-6")
    # OR route bare Claude/Opus models through the session-affinity load balancer
    is_opus_request = ("opencode" in model or "zen" in model or
                       "claude" in model or "opus" in model or
                       model == "" or model == "claude-opus-4-6")

    # Route explicitly-prefixed Gemini models directly
    # Gemini routing disabled — user 2025-02-25
    # if any(model.startswith(m) for m in GEMINI_MODELS) or ("gemini" in model and "opencode" not in model):
    #     result = await route_to_gemini(request, body_bytes, body_json, is_stream)
    if False:
        if result is not None:
            return result
        print("[GEMINI] Direct Gemini route failed, falling through to load balancer")
        is_opus_request = True  # treat as Opus fallback

    if is_opus_request:
        # === SESSION-AFFINITY LOAD BALANCER (v9) ===
        session_id = _extract_session_id(request, body_json)
        is_compact = is_compaction(body_json)

        if is_compact:
            stats["compactions"] += 1

        # Get assigned provider for this session
        provider = _get_provider_for_session(session_id)

        # Try providers in cascade: assigned → next available → next → Anthropic Direct
        tried = set()
        while provider != "none" and provider not in tried:
            tried.add(provider)
            result = None

            if provider == LB_ZEN:
                if OPENCODE_ZEN_KEY:
                    # Route to Zen — returns StreamingResponse (success) or JSONResponse (error)
                    if is_compact:
                        result = await route_to_opencode_zen_compaction(request, body_bytes, body_json, is_stream)
                    else:
                        result = await route_to_opencode_zen(request, body_bytes, body_json, is_stream)
                    if result is None:
                        # compaction route returns None on failure
                        _mark_provider_failure(LB_ZEN)
                        print(f"[LB] Zen returned None, cascading for session {session_id[:8]}…")
                    elif isinstance(result, StreamingResponse):
                        # StreamingResponse = success (Zen returns error as JSONResponse)
                        _mark_provider_success(LB_ZEN)
                        return result
                    elif hasattr(result, 'status_code') and result.status_code >= 400:
                        _mark_provider_failure(LB_ZEN)
                        print(f"[LB] Zen failed ({result.status_code}), cascading for session {session_id[:8]}…")
                    else:
                        _mark_provider_success(LB_ZEN)
                        return result

            elif provider == LB_OAUTH:
                # Normalize model name for Anthropic — strip provider prefixes
                oauth_body = dict(body_json)
                raw_model = oauth_body.get("model", "claude-opus-4-6")
                # Strip known prefixes: opencode/, platform-proxy/, zen/
                for pfx in ("opencode/", "platform-proxy/", "zen/"):
                    if raw_model.startswith(pfx):
                        raw_model = raw_model[len(pfx):]
                        break
                oauth_body["model"] = raw_model
                oauth_bytes = json.dumps(oauth_body).encode()
                # passthrough_to_anthropic always returns a response (StreamingResponse or JSONResponse)
                oauth_result = await passthrough_to_anthropic(request, oauth_bytes, oauth_body, is_stream)
                if isinstance(oauth_result, StreamingResponse):
                    # For streaming, we can't easily check for 429 mid-stream.
                    # But passthrough_to_anthropic checks resp.status_code BEFORE streaming.
                    # If it got 429, it would return a JSONResponse with that status, not a stream.
                    _mark_provider_success(LB_OAUTH)
                    return oauth_result
                elif hasattr(oauth_result, 'status_code'):
                    if oauth_result.status_code < 400:
                        _mark_provider_success(LB_OAUTH)
                        return oauth_result
                    elif oauth_result.status_code == 429:
                        _mark_provider_failure(LB_OAUTH)
                        _quota_state["oauth_5h"]["status"] = "rejected"
                        print(f"[LB] OAuth 429, cascading for session {session_id[:8]}…")
                    elif oauth_result.status_code == 401:
                        _mark_provider_failure(LB_OAUTH)
                        # OAuth token invalid/banned — disable for this run
                        _lb_failures[LB_OAUTH] = 99
                        print(f"[LB] OAuth 401 (token invalid/banned), disabling for this run")
                    else:
                        _mark_provider_failure(LB_OAUTH)
                        print(f"[LB] OAuth failed ({oauth_result.status_code}), cascading for session {session_id[:8]}…")

            elif provider == LB_GEMINI:
                # Remap Opus/Claude model → best Gemini equivalent for fallback
                gemini_body = dict(body_json)
                raw_model = gemini_body.get("model", "")
                for pfx in ("opencode/", "platform-proxy/", "zen/"):
                    if raw_model.startswith(pfx):
                        raw_model = raw_model[len(pfx):]
                        break
                # If it's a Claude/Opus model, use Gemini 3.1 Pro as equivalent
                if "claude" in raw_model.lower() or "opus" in raw_model.lower() or "sonnet" in raw_model.lower():
                    gemini_body["model"] = "gemini-3.1-pro-preview"
                elif raw_model not in GEMINI_MODELS and "gemini" not in raw_model.lower():
                    gemini_body["model"] = "gemini-3.1-pro-preview"
                gemini_bytes = json.dumps(gemini_body).encode()
                gemini_result = await route_to_gemini(request, gemini_bytes, gemini_body, is_stream)
                if gemini_result is not None:
                    _mark_provider_success(LB_GEMINI)
                    return gemini_result
                _mark_provider_failure(LB_GEMINI)
                print(f"[LB] Gemini failed, cascading for session {session_id[:8]}…")

            # Cascade: find next available provider not yet tried
            provider = "none"
            for p in LB_PROVIDERS:
                if p not in tried and _is_provider_available(p):
                    provider = p
                    # Reassign session to new provider
                    _session_affinity[session_id] = p
                    _session_affinity_ts[session_id] = time.time()
                    print(f"[LB] Reassigning session {session_id[:8]}… to {p}")
                    break

        # All LB providers exhausted — last resort: Anthropic Direct (paid)
        print(f"[LB] All providers exhausted for session {session_id[:8]}…, falling to Anthropic Direct (paid)")
        stats["passthrough"] += 1
        # Strip provider prefix for Anthropic Direct (same as OAuth path)
        direct_body = dict(body_json)
        raw_model = direct_body.get("model", "claude-opus-4-6")
        for pfx in ("opencode/", "platform-proxy/", "zen/", "anthropic-direct/"):
            if raw_model.startswith(pfx):
                raw_model = raw_model[len(pfx):]
                break
        direct_body["model"] = raw_model
        direct_bytes = json.dumps(direct_body).encode()
        return await passthrough_to_anthropic(request, direct_bytes, direct_body, is_stream)


@app.get("/status")
async def status_endpoint():
    uptime = time.time() - stats["started"]
    now = time.time()
    # Enrich quota state with time_remaining for dashboard
    quota = {}
    for key, qs in _quota_state.items():
        entry = dict(qs)
        reset_ts = qs.get("reset_ts", 0)
        if reset_ts > now:
            entry["seconds_remaining"] = int(reset_ts - now)
        else:
            entry["seconds_remaining"] = 0
            if qs.get("status") == "exceeded" and reset_ts > 0 and reset_ts <= now:
                entry["status"] = "available"  # quota reset
        quota[key] = entry
    return {
        "status": "ok",
        "version": "7.0.0",
        "uptime_s": round(uptime),
        "uptime_h": round(uptime / 3600, 1),
        **{k: v if not isinstance(v, float) else round(v, 6) for k, v in stats.items() if k != "started"},
        "quota_state": quota,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/lb/status")
async def lb_status():
    """Load balancer status — session affinity map, provider health, utilization."""
    now = time.time()
    providers = {}
    for p in LB_PROVIDERS:
        available = _is_provider_available(p)
        failures = _lb_failures.get(p, 0)
        last_fail = _lb_last_fail.get(p, 0)
        info = {"available": available, "consecutive_failures": failures}
        if last_fail > 0:
            info["last_failure_ago_s"] = round(now - last_fail, 1)
        if p == LB_OAUTH:
            info["5h_utilization"] = _quota_state.get("oauth_5h", {}).get("utilization", 0.0)
            info["7d_utilization"] = _quota_state.get("oauth_7d", {}).get("utilization", 0.0)
            info["5h_status"] = _quota_state.get("oauth_5h", {}).get("status", "unknown")
            info["7d_status"] = _quota_state.get("oauth_7d", {}).get("status", "unknown")
        elif p == LB_ZEN:
            info["zen_status"] = _quota_state.get("zen", {}).get("status", "unknown")
        providers[p] = info

    # Session distribution
    distribution = {}
    for sid, prov in _session_affinity.items():
        distribution[prov] = distribution.get(prov, 0) + 1

    return {
        "version": "v9-session-affinity",
        "total_tracked_sessions": len(_session_affinity),
        "session_distribution": distribution,
        "providers": providers,
        "thresholds": {
            "oauth_5h_skip": OAUTH_5H_SKIP_THRESHOLD,
            "oauth_7d_skip": OAUTH_7D_SKIP_THRESHOLD,
            "cooldown_secs": LB_COOLDOWN_SECS,
            "session_ttl_h": SESSION_AFFINITY_TTL / 3600,
        },
    }


@app.get("/costs")
async def costs_endpoint(hours: int = 24):
    """Aggregated cost data for dashboard consumption."""
    # Clean stale in-flight entries (>5 min = likely leaked)
    stale = [k for k, v in _in_flight.items() if time.time() - v["started"] > 300]
    for k in stale:
        _in_flight.pop(k, None)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    entries = []
    try:
        with open(COST_LOG) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                    ts = e.get("ts", "")
                    if ts:
                        # Parse ISO timestamp
                        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                        if dt >= cutoff:
                            entries.append(e)
                except (json.JSONDecodeError, ValueError):
                    continue
    except FileNotFoundError:
        pass

    # Aggregate by provider
    by_provider = defaultdict(lambda: {
        "count": 0, "input_tokens": 0, "output_tokens": 0,
        "cache_read": 0, "cache_write": 0, "cost_usd": 0,
        "compactions": 0, "errors": 0, "total_elapsed": 0,
    })
    # Aggregate by hour
    by_hour = defaultdict(lambda: {"count": 0, "cost_usd": 0, "input_tokens": 0, "output_tokens": 0})

    total_cost = 0
    total_in = 0
    total_out = 0

    for e in entries:
        p = e.get("provider", "unknown")
        s = by_provider[p]
        s["count"] += 1
        s["input_tokens"] += e.get("input_tokens", 0)
        s["output_tokens"] += e.get("output_tokens", 0)
        s["cache_read"] += e.get("cache_read_tokens", 0)
        s["cache_write"] += e.get("cache_write_tokens", 0)
        s["cost_usd"] += e.get("cost_usd", 0)
        s["total_elapsed"] += e.get("elapsed_s", 0)
        if e.get("compaction"):
            s["compactions"] += 1
        if e.get("status", 200) >= 400:
            s["errors"] += 1

        total_cost += e.get("cost_usd", 0)
        total_in += e.get("input_tokens", 0)
        total_out += e.get("output_tokens", 0)

        # Hourly bucket
        try:
            dt = datetime.fromisoformat(e["ts"].replace("Z", "+00:00"))
            hour_key = dt.strftime("%Y-%m-%d %H:00")
            h = by_hour[hour_key]
            h["count"] += 1
            h["cost_usd"] += e.get("cost_usd", 0)
            h["input_tokens"] += e.get("input_tokens", 0)
            h["output_tokens"] += e.get("output_tokens", 0)
        except (ValueError, KeyError):
            pass

    # Round costs
    for p in by_provider.values():
        p["cost_usd"] = round(p["cost_usd"], 4)
        p["total_elapsed"] = round(p["total_elapsed"], 1)
    for h in by_hour.values():
        h["cost_usd"] = round(h["cost_usd"], 4)

    return {
        "period_hours": hours,
        "total_requests": len(entries),
        "total_cost_usd": round(total_cost, 4),
        "total_input_tokens": total_in,
        "total_output_tokens": total_out,
        "by_provider": dict(by_provider),
        "by_hour": dict(sorted(by_hour.items())),
        "rate_limits": _rate_limits,
        "recent": entries[-20:],  # Last 20 entries for live feed
        "in_flight": [{"provider": v["provider"], "model": v["model"], "started": v["started"], "elapsed_s": round(time.time() - v["started"], 1)} for v in _in_flight.values()],
        "provider_activity": {k: {"last_request": round(v.get("last_request", 0), 1), "last_complete": round(v.get("last_complete", 0), 1), "seconds_ago": round(time.time() - max(v.get("last_request", 0), v.get("last_complete", 0)), 1)} for k, v in _provider_activity.items()},
    }


@app.get("/safety")
async def safety_endpoint():
    """Safety layer status and stats."""
    return {
        "version": "v6",
        "command_patterns_blocked": len(DANGEROUS_COMMANDS),
        "protected_files": PROTECTED_FILES,
        "secret_patterns": len(SECRET_PATTERNS),
        "hallucination_patterns": len(MINIMAX_HALLUCINATION_PATTERNS),
        "blocked_log": stats.get("safety_blocks", 0),
    }


@app.get("/quality")
async def quality_endpoint():
    """Quality gate stats."""
    # Read recent escalations
    recent = []
    try:
        with open(QUALITY_ESCALATION_LOG) as f:
            lines = f.readlines()
            for line in lines[-20:]:
                try:
                    recent.append(json.loads(line.strip()))
                except json.JSONDecodeError:
                    pass
    except FileNotFoundError:
        pass
    
    total_mm = stats.get("minimax_quality_pass", 0) + stats.get("minimax_escalations", 0)
    pass_rate = stats.get("minimax_quality_pass", 0) / total_mm if total_mm > 0 else 0
    
    return {
        "quality_threshold": QUALITY_THRESHOLD,
        "minimax_passed": stats.get("minimax_quality_pass", 0),
        "minimax_escalated": stats.get("minimax_escalations", 0),
        "total_minimax_requests": total_mm,
        "pass_rate": round(pass_rate, 3),
        "prompt_suffix_length": len(MINIMAX_PROMPT_SUFFIX),
        "recent_escalations": recent,
    }


@app.get("/providers")
async def providers_endpoint():
    """Real-time provider health + rate limit headroom."""
    now = time.time()
    rl = _rate_limits["anthropic"]
    rl_age = round(now - rl["last_updated"]) if rl["last_updated"] else None

    providers = {
        "platform-proxy": {
            "status": "ok",
            "role": "primary",
            "cost_per_mtok": "$0 (passthrough)",
            "uptime_h": round((now - stats["started"]) / 3600, 1),
        },
        "anthropic-oauth": {
            "status": (
                "ok" if (
                    rl.get("requests_remaining", 0) > 0
                    or not rl["last_updated"]
                    or _quota_state.get("oauth_7d", {}).get("status") == "allowed"
                ) else "limited"
            ),
            "role": "primary (via proxy)",
            "cost_per_mtok": {"input": "$15", "output": "$75", "cache_read": "$1.50"},
            "rate_limits": {
                "requests": f"{rl.get('requests_remaining', '?')}/{rl.get('requests_limit', '?')}",
                "input_tokens": f"{rl.get('input_tokens_remaining', '?'):,}/{rl.get('input_tokens_limit', '?'):,}",
                "output_tokens": f"{rl.get('output_tokens_remaining', '?'):,}/{rl.get('output_tokens_limit', '?'):,}",
                "unified_status": _quota_state.get("oauth_7d", {}).get("status", "unknown"),
                "unified_utilization_7d": _quota_state.get("oauth_7d", {}).get("utilization", 0),
                "unified_utilization_5h": _quota_state.get("oauth_5h", {}).get("utilization", 0),
                "last_updated_s": rl_age,
            },
        },
        "opencode-zen": {
            "status": "active" if stats.get("zen_ok", 0) > 0 or _provider_activity.get("opencode-zen", {}).get("last_request", 0) > now - 300 else "configured",
            "role": "primary (free Opus 4.6)" if stats.get("zen_ok", 0) > 0 else "fallback-1 (free)",
            "cost_per_mtok": "$0",
            "stats": {
                "ok": stats.get("zen_ok", 0),
                "fail": stats.get("zen_fail", 0),
            },
            "note": "No rate limit headers exposed",
        },
        "anthropic-direct": {
            "status": "configured",
            "role": "fallback-2 (paid, last resort)",
            "cost_per_mtok": {"input": "$15", "output": "$75"},
        },
        "cerebras": {
            "status": "ok" if CEREBRAS_API_KEY else "no key",
            "role": "compaction only",
            "model": CEREBRAS_MODEL,
            "cost_per_mtok": "$0.60",
            "stats": {
                "ok": stats["cerebras_ok"],
                "fail": stats["cerebras_fail"],
            },
        },
        "minimax": {
            "status": "ok" if MINIMAX_API_KEY else "no key",
            "role": "cheap frontier (bake test)",
            "models": ["MiniMax-M2.5 (60 tps)", "MiniMax-M2.5-highspeed (100 tps)"],
            "cost_per_mtok": {"input": "$0.15", "output": "$1.20", "highspeed_output": "$2.40"},
            "endpoint": MINIMAX_URL,
            "quality_gate": {
                "mode": f"best-of-{BEST_OF_N}",
                "threshold": QUALITY_THRESHOLD,
                "passed": stats.get("minimax_quality_pass", 0),
                "escalated_to_opus": stats.get("minimax_escalations", 0),
                "total_attempts": stats.get("minimax_best_of_n_total_attempts", 0),
                "last_scores": stats.get("minimax_last_best_of_n_scores", []),
            },
            "stats": {
                "ok": stats["minimax_ok"],
                "fail": stats["minimax_fail"],
            },
        },
        "gemini": {
            "status": "active" if _provider_activity.get("gemini-pro", {}).get("last_complete", 0) > now - 600 or _provider_activity.get("gemini-flash", {}).get("last_complete", 0) > now - 600 else "configured",
            "role": "Gemini 3.1 Pro / Flash via translation proxy",
            "models": list(GEMINI_MODELS),
            "cost_per_mtok": {"pro_input": "$2", "pro_output": "$12", "flash_input": "$0.15", "flash_output": "$0.60"},
            "endpoint": GEMINI_PROXY_URL,
            "context_window": "1M tokens",
            "note": "Anthropic-format translation via gemini-cli-anthropic on port 4000",
        },
    }
    return {"providers": providers, "failover_chain": [
        "platform-proxy/claude-opus-4-6 → Anthropic API (OAuth)",
        "opencode/claude-opus-4-6 (Zen, free)",
        "platform-proxy/gemini-3.1-pro-preview → Gemini via translation proxy ($2/$12)",
        "anthropic-direct/claude-opus-4-6 (paid API key)",
        "MiniMax-M2.5 → api.minimax.io (direct, $0.15/$1.20)",
    ]}


if __name__ == "__main__":
    import uvicorn
    print(f"[platform PROXY v10] Starting on {BIND_HOST}:{BIND_PORT}")
    print(f"[platform PROXY v10] Load balancer: Zen → OAuth → Gemini (session-affinity)")
    print(f"[platform PROXY v10] Qwen tool calling: ENABLED (full schema translation)")
    print(f"[platform PROXY v10] OpenCode Zen: {'configured' if OPENCODE_ZEN_KEY else 'NO KEY'}")
    print(f"[platform PROXY v10] OAuth thresholds: 5h>{OAUTH_5H_SKIP_THRESHOLD*100:.0f}% 7d>{OAUTH_7D_SKIP_THRESHOLD*100:.0f}%")
    print(f"[platform PROXY v10] MiniMax: {'configured' if MINIMAX_API_KEY else 'NO KEY'}")
    print(f"[platform PROXY v10] Quality gate: best-of-{BEST_OF_N}, threshold={QUALITY_THRESHOLD}")
    print(f"[platform PROXY v10] Safety: {len(DANGEROUS_COMMANDS)} cmd patterns, {len(PROTECTED_FILES)} files, {len(SECRET_PATTERNS)} secrets")
    print(f"[platform PROXY v10] Cost log: {COST_LOG}")
    uvicorn.run(app, host=BIND_HOST, port=BIND_PORT, log_level="warning")
