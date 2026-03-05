#!/usr/bin/env python3
"""platform Proxy v2 — Compaction-only Cerebras router + Anthropic passthrough.

Sits between OpenClaw and Anthropic API. Intercepts compaction requests
and routes them to Cerebras GLM-4.7 for 30-60x faster compaction.
Everything else passes through transparently to api.anthropic.com.
"""

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

# --- Config ---
CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY", "")
CEREBRAS_MODEL = "zai-glm-4.7"
CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
BIND_HOST = "127.0.0.1"
BIND_PORT = int(os.environ.get("operator_PROXY_PORT", "8889"))
COST_LOG = os.path.join(os.path.dirname(__file__), "cost.jsonl")
CLAUDE_CREDENTIALS = os.path.expanduser("~/.claude/.credentials.json")

# OAuth token cache (re-read from disk periodically)
_oauth_cache = {"token": None, "expires": 0, "last_read": 0}
OAUTH_CACHE_TTL = 300  # re-read credentials file every 5 min


def get_anthropic_auth() -> dict:
    """Get Authorization headers for Anthropic API using OAuth token from Claude CLI."""
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
            print(f"[AUTH] Failed to read OAuth token: {e}")
            # Fall back to ANTHROPIC_API_KEY env var
            api_key = os.environ.get("ANTHROPIC_API_KEY", "")
            if api_key:
                return {"x-api-key": api_key}
            return {}
    if not token:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if api_key:
            return {"x-api-key": api_key}
        return {}
    return {
        "Authorization": f"Bearer {token}",
        "anthropic-beta": "oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14",
    }

# Compaction detection keywords
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

app = FastAPI(title="platform Proxy v2")
client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0), limits=httpx.Limits(max_connections=20))

# Stats
stats = {"started": time.time(), "requests": 0, "compactions": 0, "passthrough": 0,
         "cerebras_ok": 0, "cerebras_fail": 0, "errors": 0}


def is_compaction(body: dict) -> bool:
    """Detect compaction by scanning system + user messages for markers."""
    texts = []
    # System prompt
    system = body.get("system", "")
    if isinstance(system, str):
        texts.append(system.lower())
    elif isinstance(system, list):
        for block in system:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(block.get("text", "").lower())
    # Messages (check last 3 user messages)
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


def anthropic_to_openai(body: dict) -> dict:
    """Translate Anthropic Messages format → OpenAI Chat format for Cerebras."""
    messages = []
    # System
    system = body.get("system", "")
    if isinstance(system, str) and system.strip():
        messages.append({"role": "system", "content": system})
    elif isinstance(system, list):
        text = " ".join(b.get("text", "") for b in system if isinstance(b, dict) and b.get("type") == "text")
        if text.strip():
            messages.append({"role": "system", "content": text})
    # Messages — flatten content blocks to text
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
    # Ensure high max_tokens for reasoning model (reasoning tokens + content tokens)
    max_tokens = max(body.get("max_tokens", 16384), 16384)
    return {
        "model": CEREBRAS_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": body.get("temperature", 1.0),
        "stream": body.get("stream", False),
    }


def openai_to_anthropic_sync(resp: dict, model_requested: str) -> dict:
    """Translate OpenAI response → Anthropic Messages response (non-streaming)."""
    choice = resp.get("choices", [{}])[0]
    text = choice.get("message", {}).get("content", "")
    usage = resp.get("usage", {})
    return {
        "id": f"msg_{uuid.uuid4().hex[:24]}",
        "type": "message",
        "role": "assistant",
        "model": model_requested,
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }


async def openai_to_anthropic_stream(resp_stream, model_requested: str):
    """Translate OpenAI SSE stream → Anthropic SSE stream.
    
    Cerebras GLM-4.7 is a reasoning model:
    - delta.reasoning = internal thinking (skip)
    - delta.content = actual output (forward as content_block_delta)
    """
    msg_id = f"msg_{uuid.uuid4().hex[:24]}"
    # message_start
    yield f"event: message_start\ndata: {json.dumps({'type': 'message_start', 'message': {'id': msg_id, 'type': 'message', 'role': 'assistant', 'model': model_requested, 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 0, 'output_tokens': 0}}})}\n\n"
    # content_block_start
    yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})}\n\n"

    input_tokens = 0
    output_tokens = 0
    has_content = False
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
        # Extract usage if present
        if "usage" in chunk:
            input_tokens = chunk["usage"].get("prompt_tokens", input_tokens)
            output_tokens = chunk["usage"].get("completion_tokens", output_tokens)
        delta = (chunk.get("choices") or [{}])[0].get("delta", {})
        # Forward actual content (skip reasoning)
        text = delta.get("content")
        if text:
            has_content = True
            yield f"event: content_block_delta\ndata: {json.dumps({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': text}})}\n\n"

    # content_block_stop
    yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': 0})}\n\n"
    # message_delta
    yield f"event: message_delta\ndata: {json.dumps({'type': 'message_delta', 'delta': {'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': output_tokens}})}\n\n"
    # message_stop
    yield f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n"


async def route_to_cerebras(body: dict, is_stream: bool) -> tuple:
    """Send compaction to Cerebras. Returns (response, True) or (None, False) on failure."""
    openai_body = anthropic_to_openai(body)
    model_requested = body.get("model", "claude-opus-4-6")
    headers = {"Authorization": f"Bearer {CEREBRAS_API_KEY}", "Content-Type": "application/json"}
    t0 = time.time()

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
                    log_cost("cerebras", model_requested, 0, 0, time.time() - t0, compaction=True)

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
            log_cost("cerebras", model_requested,
                     result["usage"]["input_tokens"], result["usage"]["output_tokens"],
                     elapsed, compaction=True)
            return JSONResponse(content=result), True
    except Exception as e:
        stats["cerebras_fail"] += 1
        print(f"[CEREBRAS ERROR] {e}")
        return None, False


async def passthrough_to_anthropic(request: Request, body: bytes, is_stream: bool):
    """Forward request to api.anthropic.com with real OAuth auth."""
    # Start with our own auth (OAuth token from credentials.json)
    forward_headers = get_anthropic_auth()
    # Add standard headers from request (but NOT auth — we override it)
    for key in ["anthropic-version", "content-type", "user-agent", "x-app"]:
        val = request.headers.get(key)
        if val:
            forward_headers[key] = val
    # Merge anthropic-beta (keep both ours and caller's)
    caller_beta = request.headers.get("anthropic-beta", "")
    our_beta = forward_headers.get("anthropic-beta", "")
    if caller_beta and our_beta:
        # Merge unique beta features
        all_betas = set(our_beta.split(",")) | set(caller_beta.split(","))
        forward_headers["anthropic-beta"] = ",".join(sorted(all_betas))
    elif caller_beta:
        forward_headers["anthropic-beta"] = caller_beta
    t0 = time.time()

    if is_stream:
        resp = await client.send(
            client.build_request("POST", ANTHROPIC_URL, content=body, headers=forward_headers),
            stream=True,
        )

        async def stream_gen():
            try:
                async for chunk in resp.aiter_raw():
                    yield chunk
            finally:
                await resp.aclose()

        return StreamingResponse(
            stream_gen(),
            status_code=resp.status_code,
            media_type=resp.headers.get("content-type", "text/event-stream"),
            headers={k: v for k, v in resp.headers.items()
                     if k.lower() in ("x-ratelimit-limit-requests", "x-ratelimit-limit-tokens",
                                       "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens",
                                       "anthropic-ratelimit-requests-limit",
                                       "anthropic-ratelimit-requests-remaining",
                                       "anthropic-ratelimit-requests-reset",
                                       "anthropic-ratelimit-tokens-limit",
                                       "anthropic-ratelimit-tokens-remaining",
                                       "anthropic-ratelimit-tokens-reset",
                                       "anthropic-ratelimit-input-tokens-limit",
                                       "anthropic-ratelimit-input-tokens-remaining",
                                       "anthropic-ratelimit-input-tokens-reset",
                                       "anthropic-ratelimit-output-tokens-limit",
                                       "anthropic-ratelimit-output-tokens-remaining",
                                       "anthropic-ratelimit-output-tokens-reset",
                                       "retry-after", "request-id")},
        )
    else:
        resp = await client.post(ANTHROPIC_URL, content=body, headers=forward_headers)
        elapsed = time.time() - t0
        return JSONResponse(
            content=resp.json(),
            status_code=resp.status_code,
            headers={k: v for k, v in resp.headers.items()
                     if k.lower().startswith("anthropic-ratelimit") or k.lower() in ("retry-after", "request-id")},
        )


def log_cost(provider: str, model: str, input_tokens: int, output_tokens: int,
             elapsed: float, compaction: bool = False):
    """Append to cost.jsonl."""
    try:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "provider": provider,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "elapsed_s": round(elapsed, 3),
            "compaction": compaction,
        }
        with open(COST_LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


@app.post("/v1/messages")
async def proxy_messages(request: Request):
    stats["requests"] += 1
    body_bytes = await request.body()

    try:
        body = json.loads(body_bytes)
    except json.JSONDecodeError:
        return JSONResponse({"error": {"type": "invalid_request", "message": "Invalid JSON"}}, status_code=400)

    is_stream = body.get("stream", False)

    # Check for compaction
    if is_compaction(body):
        stats["compactions"] += 1
        print(f"[COMPACTION] Routing to Cerebras (stream={is_stream})")
        result, ok = await route_to_cerebras(body, is_stream)
        if ok:
            return result
        print("[COMPACTION] Cerebras failed, falling through to Anthropic")

    # Passthrough to Anthropic
    stats["passthrough"] += 1
    return await passthrough_to_anthropic(request, body_bytes, is_stream)


@app.get("/status")
async def status():
    uptime = time.time() - stats["started"]
    return {
        "status": "ok",
        "version": "2.0.0",
        "uptime_s": round(uptime),
        "uptime_h": round(uptime / 3600, 1),
        "requests": stats["requests"],
        "compactions": stats["compactions"],
        "cerebras_ok": stats["cerebras_ok"],
        "cerebras_fail": stats["cerebras_fail"],
        "passthrough": stats["passthrough"],
        "errors": stats["errors"],
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    print(f"[platform PROXY v2] Starting on {BIND_HOST}:{BIND_PORT}")
    print(f"[platform PROXY v2] Cerebras model: {CEREBRAS_MODEL}")
    print(f"[platform PROXY v2] Compaction markers: {len(COMPACTION_MARKERS)}")
    uvicorn.run(app, host=BIND_HOST, port=BIND_PORT, log_level="warning")
