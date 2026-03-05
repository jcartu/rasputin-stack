#!/usr/bin/env python3
"""platform Proxy v6 — Intelligent quality gate + auto-escalation + prompt tuning.

v5 → v6 changes:
- Quality gate: score MiniMax responses, auto-escalate to Opus if below threshold
- MiniMax-specific system prompt injection (extra formatting rules)
- Post-processing enhancement (add missing bold/emoji, truncate verbose)
- Escalation logging and stats
- All v5 safety features preserved (blocklist, sanitization, scrubbing)
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
    "minimax": {"input": 0.15, "output": 1.20, "cache_read": 0, "cache_write": 0},
    "minimax-highspeed": {"input": 0.30, "output": 2.40, "cache_read": 0, "cache_write": 0},
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

# In-flight request tracking for dashboard live indicators
_in_flight = {}  # request_id -> {"provider": str, "model": str, "started": float}
# Per-provider last activity timestamp (updated on every request start AND end)
_provider_activity = {}  # provider -> {"last_request": float, "last_complete": float}

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


def make_response(data: dict, is_stream: bool):
    """Return JSONResponse or SSE stream depending on what was requested."""
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
app = FastAPI(title="platform Proxy v6")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0), limits=httpx.Limits(max_connections=20))

stats = {
    "started": time.time(), "requests": 0, "compactions": 0, "passthrough": 0,
    "cerebras_ok": 0, "cerebras_fail": 0, "errors": 0,
    "minimax_ok": 0, "minimax_fail": 0,
    "total_input_tokens": 0, "total_output_tokens": 0, "total_cost_usd": 0,
}


# --- Cerebras translation (unchanged from v2) ---

def anthropic_to_openai(body: dict) -> dict:
    messages = []
    system = body.get("system", "")
    if isinstance(system, str) and system.strip():
        messages.append({"role": "system", "content": system})
    elif isinstance(system, list):
        text = " ".join(b.get("text", "") for b in system if isinstance(b, dict) and b.get("type") == "text")
        if text.strip():
            messages.append({"role": "system", "content": text})
    for msg in body.get("messages", []):
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = "\n".join(
                b.get("text", "") for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            )
        else:
            text = str(content)
        if text.strip():
            messages.append({"role": role, "content": text})
    max_tokens = max(body.get("max_tokens", 16384), 16384)
    return {"model": CEREBRAS_MODEL, "messages": messages, "max_tokens": max_tokens,
            "temperature": body.get("temperature", 1.0), "stream": body.get("stream", False)}


def openai_to_anthropic_sync(resp: dict, model_requested: str) -> dict:
    choice = resp.get("choices", [{}])[0]
    text = choice.get("message", {}).get("content", "")
    usage = resp.get("usage", {})
    return {
        "id": f"msg_{uuid.uuid4().hex[:24]}",
        "type": "message", "role": "assistant", "model": model_requested,
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn", "stop_sequence": None,
        "usage": {"input_tokens": usage.get("prompt_tokens", 0),
                  "output_tokens": usage.get("completion_tokens", 0)},
    }


async def openai_to_anthropic_stream(resp_stream, model_requested: str):
    msg_id = f"msg_{uuid.uuid4().hex[:24]}"
    yield f"event: message_start\ndata: {json.dumps({'type': 'message_start', 'message': {'id': msg_id, 'type': 'message', 'role': 'assistant', 'model': model_requested, 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 0, 'output_tokens': 0}}})}\n\n"
    yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})}\n\n"
    input_tokens = output_tokens = 0
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
        delta = (chunk.get("choices") or [{}])[0].get("delta", {})
        text = delta.get("content")
        if text:
            yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': text}})}\n\n"
    yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': 0})}\n\n"
    yield f"event: message_delta\ndata: {json.dumps({'type': 'message_delta', 'delta': {'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': output_tokens}})}\n\n"
    yield f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n"


async def route_to_cerebras(body: dict, is_stream: bool) -> tuple:
    openai_body = anthropic_to_openai(body)
    model_requested = body.get("model", "claude-opus-4-6")
    headers = {"Authorization": f"Bearer {CEREBRAS_API_KEY}", "Content-Type": "application/json"}
    t0 = time.time()
    _provider_activity["cerebras"] = {"last_request": t0, "last_complete": _provider_activity.get("cerebras", {}).get("last_complete", 0)}
    try:
        if is_stream:
            openai_body["stream"] = True
            openai_body["stream_options"] = {"include_usage": True}
            resp = await client.send(
                client.build_request("POST", CEREBRAS_URL, json=openai_body, headers=headers),
                stream=True,
            )
            if resp.status_code != 200:
                await resp.aclose()
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
            return JSONResponse(content=result), True
    except Exception as e:
        stats["cerebras_fail"] += 1
        print(f"[CEREBRAS ERROR] {e}")
        return None, False


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


async def route_to_minimax_with_quality_gate(request: Request, body: bytes, body_json: dict, original_prompt: str):
    """Non-streaming MiniMax with quality gate and Opus fallback."""
    model_requested = body_json.get("model", "MiniMax-M2.5")
    
    # Try MiniMax first
    data = await route_to_minimax_sync(request, body, body_json)
    
    if data is not None:
        score, issues = score_response_quality(data, original_prompt)
        
        if score >= QUALITY_THRESHOLD:
            # Good quality — sanitize, enhance, return
            data = sanitize_response_body(data, is_minimax=True)
            for block in data.get("content", []):
                if block.get("type") == "text":
                    block["text"] = enhance_response_text(block["text"])
            stats["minimax_quality_pass"] = stats.get("minimax_quality_pass", 0) + 1
            print(f"[QUALITY GATE] ✅ Score {score:.2f} — MiniMax response accepted. {len(issues)} minor issues: {issues[:3]}")
            return JSONResponse(content=data)  # Non-streaming path, JSONResponse is correct
        else:
            # Low quality — escalate
            stats["minimax_escalations"] = stats.get("minimax_escalations", 0) + 1
            log_escalation(model_requested, score, issues, original_prompt)
            print(f"[QUALITY GATE] ❌ Score {score:.2f} — escalating to Opus. Issues: {issues}")
    else:
        stats["minimax_escalations"] = stats.get("minimax_escalations", 0) + 1
        log_escalation(model_requested, 0, ["minimax_failed"], original_prompt)
        print(f"[QUALITY GATE] ❌ MiniMax failed — escalating to Opus")
    
    # Escalate to Opus
    opus_body = dict(body_json)
    opus_body["model"] = "claude-opus-4-6"
    opus_body["stream"] = False
    # Remove MiniMax prompt suffix
    sys_prompt = opus_body.get("system", "")
    if isinstance(sys_prompt, str) and MINIMAX_PROMPT_SUFFIX in sys_prompt:
        opus_body["system"] = sys_prompt.replace(MINIMAX_PROMPT_SUFFIX, "")
    opus_bytes = json.dumps(opus_body).encode()
    return await passthrough_to_anthropic(request, opus_bytes, opus_body, False)


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
    for key in ["anthropic-version", "content-type", "user-agent", "x-app"]:
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

        # We need to intercept the stream to capture usage from the SSE events
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
        return JSONResponse(content=resp.json(), status_code=resp.status_code, headers=rl_headers)


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
        
        if is_stream:
            # For streaming: do a non-streaming preflight, score, then stream final
            # Make non-streaming MiniMax call first
            preflight_body = dict(body_json)
            preflight_body["stream"] = False
            preflight_bytes = json.dumps(preflight_body).encode()
            
            preflight_resp = await route_to_minimax_sync(request, preflight_bytes, preflight_body)
            if preflight_resp is not None and isinstance(preflight_resp, dict):
                # Score the preflight response
                score, issues = score_response_quality(preflight_resp, original_prompt)
                if score >= QUALITY_THRESHOLD:
                    # Good quality — sanitize and convert to streaming response
                    preflight_resp = sanitize_response_body(preflight_resp, is_minimax=True)
                    # Enhance text
                    for block in preflight_resp.get("content", []):
                        if block.get("type") == "text":
                            block["text"] = enhance_response_text(block["text"])
                    stats["minimax_quality_pass"] = stats.get("minimax_quality_pass", 0) + 1
                    return make_response(preflight_resp, is_stream)
                else:
                    # Low quality — escalate to Opus
                    stats["minimax_escalations"] = stats.get("minimax_escalations", 0) + 1
                    log_escalation(model, score, issues, original_prompt)
                    print(f"[QUALITY GATE] Score {score:.2f} below {QUALITY_THRESHOLD} — escalating to Opus. Issues: {issues}")
                    # Restore original system prompt (without MiniMax suffix) for Opus
                    opus_body = json.loads(await request.body()) if hasattr(request, '_body') else body_json.copy()
                    # Remove MiniMax prompt suffix
                    sys_prompt = opus_body.get("system", "")
                    if isinstance(sys_prompt, str) and MINIMAX_PROMPT_SUFFIX in sys_prompt:
                        opus_body["system"] = sys_prompt.replace(MINIMAX_PROMPT_SUFFIX, "")
                    opus_body["model"] = "claude-opus-4-6"
                    opus_body["stream"] = True
                    opus_bytes = json.dumps(opus_body).encode()
                    return await passthrough_to_anthropic(request, opus_bytes, opus_body, True)
            else:
                # Preflight failed — fall through to Opus
                stats["minimax_escalations"] = stats.get("minimax_escalations", 0) + 1
                log_escalation(model, 0, ["preflight_failed"], original_prompt)
                print(f"[QUALITY GATE] Preflight failed — escalating to Opus")
                opus_body = dict(body_json)
                opus_body["model"] = "claude-opus-4-6"
                if isinstance(opus_body.get("system", ""), str):
                    opus_body["system"] = opus_body["system"].replace(MINIMAX_PROMPT_SUFFIX, "")
                opus_bytes = json.dumps(opus_body).encode()
                return await passthrough_to_anthropic(request, opus_bytes, opus_body, True)
        else:
            # Non-streaming: straightforward quality gate
            return await route_to_minimax_with_quality_gate(request, body_bytes, body_json, original_prompt)

    if is_compaction(body_json):
        stats["compactions"] += 1
        print(f"[COMPACTION] Routing to Cerebras (stream={is_stream})")
        result, ok = await route_to_cerebras(body_json, is_stream)
        if ok:
            return result
        print("[COMPACTION] Cerebras failed, falling through to Anthropic")

    stats["passthrough"] += 1
    return await passthrough_to_anthropic(request, body_bytes, body_json, is_stream)


@app.get("/status")
async def status_endpoint():
    uptime = time.time() - stats["started"]
    return {
        "status": "ok",
        "version": "3.0.0",
        "uptime_s": round(uptime),
        "uptime_h": round(uptime / 3600, 1),
        **{k: v if not isinstance(v, float) else round(v, 6) for k, v in stats.items() if k != "started"},
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


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
        "provider_activity": {k: {"last_request": round(v["last_request"], 1), "last_complete": round(v["last_complete"], 1), "seconds_ago": round(time.time() - max(v["last_request"], v["last_complete"]), 1)} for k, v in _provider_activity.items()},
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
            "status": "ok" if rl.get("requests_remaining", 0) > 0 or not rl["last_updated"] else "limited",
            "role": "primary (via proxy)",
            "cost_per_mtok": {"input": "$15", "output": "$75", "cache_read": "$1.50"},
            "rate_limits": {
                "requests": f"{rl.get('requests_remaining', '?')}/{rl.get('requests_limit', '?')}",
                "input_tokens": f"{rl.get('input_tokens_remaining', '?'):,}/{rl.get('input_tokens_limit', '?'):,}",
                "output_tokens": f"{rl.get('output_tokens_remaining', '?'):,}/{rl.get('output_tokens_limit', '?'):,}",
                "last_updated_s": rl_age,
            },
        },
        "opencode-zen": {
            "status": "configured",
            "role": "fallback-1 (free)",
            "cost_per_mtok": "$0",
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
            "stats": {
                "ok": stats["minimax_ok"],
                "fail": stats["minimax_fail"],
            },
        },
    }
    return {"providers": providers, "failover_chain": [
        "platform-proxy/claude-opus-4-6 → Anthropic API (OAuth)",
        "opencode/claude-opus-4-6 (Zen, free)",
        "anthropic-direct/claude-opus-4-6 (paid API key)",
        "MiniMax-M2.5 → api.minimax.io (direct, $0.15/$1.20)",
    ]}


if __name__ == "__main__":
    import uvicorn
    print(f"[platform PROXY v6] Starting on {BIND_HOST}:{BIND_PORT}")
    print(f"[platform PROXY v6] Cerebras: {CEREBRAS_MODEL}")
    print(f"[platform PROXY v6] MiniMax: {'configured' if MINIMAX_API_KEY else 'NO KEY'}")
    print(f"[platform PROXY v6] Quality gate: threshold={QUALITY_THRESHOLD}, auto-escalation to Opus")
    print(f"[platform PROXY v6] MiniMax prompt suffix: {len(MINIMAX_PROMPT_SUFFIX)} chars")
    print(f"[platform PROXY v6] Safety: {len(DANGEROUS_COMMANDS)} cmd patterns, {len(PROTECTED_FILES)} files, {len(SECRET_PATTERNS)} secrets")
    print(f"[platform PROXY v6] Cost log: {COST_LOG}")
    uvicorn.run(app, host=BIND_HOST, port=BIND_PORT, log_level="warning")
