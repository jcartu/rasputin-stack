#!/usr/bin/env python3
"""platform Proxy v3 — Full cost intelligence + Cerebras compaction router.

v2 → v3 changes:
- Track token usage on ALL passthrough requests (parse SSE streams)
- Calculate real $ cost per request using provider pricing
- /costs endpoint: aggregated cost data for dashboard
- /providers endpoint: real-time provider health + rate limit headroom
- Rate limit headers captured and tracked from Anthropic responses
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

# Compaction markers
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
app = FastAPI(title="platform Proxy v3")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0), limits=httpx.Limits(max_connections=20))

stats = {
    "started": time.time(), "requests": 0, "compactions": 0, "passthrough": 0,
    "cerebras_ok": 0, "cerebras_fail": 0, "errors": 0,
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
        "recent": entries[-10:],  # Last 10 entries for live feed
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
    }
    return {"providers": providers, "failover_chain": [
        "platform-proxy/claude-opus-4-6 → Anthropic API (OAuth)",
        "opencode/claude-opus-4-6 (Zen, free)",
        "anthropic-direct/claude-opus-4-6 (paid API key)",
    ]}


if __name__ == "__main__":
    import uvicorn
    print(f"[platform PROXY v3] Starting on {BIND_HOST}:{BIND_PORT}")
    print(f"[platform PROXY v3] Cerebras: {CEREBRAS_MODEL}")
    print(f"[platform PROXY v3] Compaction markers: {len(COMPACTION_MARKERS)}")
    print(f"[platform PROXY v3] Cost log: {COST_LOG}")
    uvicorn.run(app, host=BIND_HOST, port=BIND_PORT, log_level="warning")
