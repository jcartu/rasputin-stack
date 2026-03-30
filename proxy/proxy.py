#!/usr/bin/env python3
"""
platform Proxy — OpenAI-compatible LLM failover proxy.

Main chain (Opus 4.6 w/ thinking):
  1. Anthropic Max20 (subscription — $0 marginal)
  2. OpenCode Zen Black (flat — $0 marginal)
  3. OpenRouter (credits)
  4. Anthropic Direct (pay-per-token — last resort)

Compaction chain (GLM-4.7 on Cerebras — fast & cheap):
  Detects compaction requests and routes to Cerebras for ~500ms extraction.
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [platform] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("platform")

# ─── Config ────────────────────────────────────────────────────────────
PORT = int(os.environ.get("operator_PROXY_PORT", "8889"))
API_KEY = os.environ.get("operator_PROXY_KEY", "platform-local-2026")
HEALTH_INTERVAL = 60
REQUEST_TIMEOUT = 300
ANTHROPIC_API_VERSION = "2023-06-01"

# Cerebras config for compaction routing
CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY", "")
CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"
CEREBRAS_MODEL = "zai-glm-4.7"

# Compaction detection keywords (OpenClaw sends these in system prompt for compaction)
COMPACTION_MARKERS = [
    "compact the conversation",
    "compacting the conversation",
    "create a summary of the conversation",
    "summarize the conversation above",
    "conversation history into a structured summary",
    "compress the above conversation",
    "produce a compact summary",
    "<summary>",  # OpenClaw's compaction format
]


@dataclass
class Provider:
    name: str
    api_type: str  # "anthropic" or "openai"
    base_url: str
    api_key: str
    model_id: str
    healthy: bool = True
    last_check: float = 0
    last_error: str = ""
    consecutive_fails: int = 0
    latency_ms: float = 0
    total_ok: int = 0
    total_fail: int = 0


def load_providers() -> list[Provider]:
    """Build the failover chain from environment + config."""
    chain = []

    # Read anthropic-direct key from openclaw.json
    direct_key = ""
    try:
        with open(os.path.expanduser("~/.openclaw/openclaw.json")) as f:
            cfg = json.load(f)
        direct_key = (
            cfg.get("models", {})
            .get("providers", {})
            .get("anthropic-direct", {})
            .get("apiKey", "")
        )
    except Exception:
        pass

    # 1. Anthropic Max20
    k = os.environ.get("ANTHROPIC_API_KEY", "")
    if k:
        chain.append(Provider("anthropic-max20", "anthropic", "https://api.anthropic.com", k, "claude-opus-4-6"))

    # 2. OpenCode Zen Black
    k = os.environ.get("OPENCODE_API_KEY", "") or os.environ.get("ZEN_OPENCODE_API_KEY", "")
    if k:
        chain.append(Provider("opencode-zen", "anthropic", "https://opencode.ai/zen", k, "claude-opus-4-6"))

    # 3. OpenRouter
    k = os.environ.get("OPENROUTER_API_KEY", "")
    if k:
        chain.append(Provider("openrouter", "openai", "https://openrouter.ai/api/v1", k, "anthropic/claude-opus-4.6"))

    # 4. Anthropic Direct (pay-per-token, last resort)
    if direct_key:
        chain.append(Provider("anthropic-direct", "anthropic", "https://api.anthropic.com", direct_key, "claude-opus-4-6"))

    return chain


# ─── Format Translation ───────────────────────────────────────────────

def openai_to_anthropic_body(body: dict, model_id: str) -> dict:
    """Convert OpenAI /chat/completions request → Anthropic /messages body."""
    system_parts = []
    messages = []

    for msg in body.get("messages", []):
        role = msg.get("role", "user")
        content = msg.get("content", "")

        if role == "system":
            if isinstance(content, str):
                system_parts.append({"type": "text", "text": content})
            elif isinstance(content, list):
                system_parts.extend(content)
        elif role in ("user", "assistant"):
            messages.append({"role": role, "content": content})

    max_tokens = body.get("max_tokens", 16384)

    # Extended thinking: high = 32k budget
    # Anthropic requires max_tokens > thinking.budget_tokens
    budget = 32000
    if max_tokens <= budget:
        max_tokens = budget + max(max_tokens, 8192)  # ensure headroom

    result = {
        "model": model_id,
        "messages": messages,
        "max_tokens": max_tokens,
        "thinking": {"type": "enabled", "budget_tokens": budget},
    }

    if system_parts:
        result["system"] = system_parts

    if body.get("temperature") is not None:
        result["temperature"] = body["temperature"]

    if body.get("tools"):
        result["tools"] = body["tools"]

    return result


def anthropic_sse_to_openai(event_type: str, data: dict, model: str) -> Optional[str]:
    """Convert one Anthropic SSE event to OpenAI SSE chunk string."""
    if event_type == "message_start":
        msg_id = data.get("message", {}).get("id", "")
        return json.dumps({
            "id": msg_id, "object": "chat.completion.chunk",
            "created": int(time.time()), "model": model,
            "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}],
        })

    if event_type == "content_block_delta":
        delta = data.get("delta", {})
        if delta.get("type") == "text_delta":
            return json.dumps({
                "id": "", "object": "chat.completion.chunk",
                "created": int(time.time()), "model": model,
                "choices": [{"index": 0, "delta": {"content": delta.get("text", "")}, "finish_reason": None}],
            })
        return None  # skip thinking_delta, input_json_delta

    if event_type == "message_delta":
        usage = data.get("usage", {})
        return json.dumps({
            "id": "", "object": "chat.completion.chunk",
            "created": int(time.time()), "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
            },
        })

    if event_type == "message_stop":
        return "[DONE]"

    return None


def anthropic_response_to_openai(data: dict, model: str) -> dict:
    """Convert Anthropic non-stream response → OpenAI format."""
    text = "".join(b["text"] for b in data.get("content", []) if b.get("type") == "text")
    usage = data.get("usage", {})
    return {
        "id": data.get("id", ""),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
        },
    }


# ─── Provider Calls ────────────────────────────────────────────────────

async def try_provider_nonstream(client: httpx.AsyncClient, p: Provider, body: dict) -> dict:
    """Non-streaming call → returns OpenAI-format dict or raises."""
    if p.api_type == "anthropic":
        abody = openai_to_anthropic_body(body, p.model_id)
        resp = await client.post(
            f"{p.base_url}/v1/messages",
            json=abody,
            headers={"x-api-key": p.api_key, "anthropic-version": ANTHROPIC_API_VERSION, "content-type": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            raise Exception(f"HTTP {resp.status_code}: {resp.text[:300]}")
        return anthropic_response_to_openai(resp.json(), body.get("model", "claude-opus-4-6"))
    else:
        fwd = {**body, "model": p.model_id, "stream": False}
        resp = await client.post(
            f"{p.base_url}/chat/completions",
            json=fwd,
            headers={"Authorization": f"Bearer {p.api_key}", "content-type": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            raise Exception(f"HTTP {resp.status_code}: {resp.text[:300]}")
        return resp.json()


async def try_provider_stream(client: httpx.AsyncClient, p: Provider, body: dict) -> AsyncIterator[bytes]:
    """
    Streaming call. VALIDATES the connection (reads first chunk) before yielding.
    Raises on connection error / non-200 / first-chunk failure.
    Returns an async iterator of SSE lines (bytes).
    """
    model_label = body.get("model", "claude-opus-4-6")

    if p.api_type == "anthropic":
        abody = openai_to_anthropic_body(body, p.model_id)
        abody["stream"] = True
        req = client.build_request(
            "POST", f"{p.base_url}/v1/messages",
            json=abody,
            headers={"x-api-key": p.api_key, "anthropic-version": ANTHROPIC_API_VERSION, "content-type": "application/json"},
        )
        resp = await client.send(req, stream=True)
        if resp.status_code != 200:
            body_text = (await resp.aread()).decode()[:500]
            await resp.aclose()
            raise Exception(f"HTTP {resp.status_code}: {body_text}")

        async def gen():
            try:
                event_type = ""
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if line.startswith("event: "):
                        event_type = line[7:]
                    elif line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue
                        chunk = anthropic_sse_to_openai(event_type, data, model_label)
                        if chunk:
                            yield f"data: {chunk}\n\n".encode()
            finally:
                await resp.aclose()

        return gen()

    else:  # openai-compatible
        fwd = {**body, "model": p.model_id, "stream": True}
        req = client.build_request(
            "POST", f"{p.base_url}/chat/completions",
            json=fwd,
            headers={"Authorization": f"Bearer {p.api_key}", "content-type": "application/json"},
        )
        resp = await client.send(req, stream=True)
        if resp.status_code != 200:
            body_text = (await resp.aread()).decode()[:500]
            await resp.aclose()
            raise Exception(f"HTTP {resp.status_code}: {body_text}")

        async def gen():
            try:
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if line:
                        yield f"{line}\n\n".encode()
            finally:
                await resp.aclose()

        return gen()


# ─── Health Probing ────────────────────────────────────────────────────

async def probe(client: httpx.AsyncClient, p: Provider):
    """Lightweight health probe."""
    try:
        t0 = time.monotonic()
        if p.api_type == "anthropic":
            r = await client.post(
                f"{p.base_url}/v1/messages",
                json={"model": p.model_id, "max_tokens": 1, "messages": [{"role": "user", "content": "hi"}]},
                headers={"x-api-key": p.api_key, "anthropic-version": ANTHROPIC_API_VERSION, "content-type": "application/json"},
                timeout=15,
            )
        else:
            r = await client.post(
                f"{p.base_url}/chat/completions",
                json={"model": p.model_id, "max_tokens": 1, "messages": [{"role": "user", "content": "hi"}]},
                headers={"Authorization": f"Bearer {p.api_key}", "content-type": "application/json"},
                timeout=15,
            )

        p.latency_ms = (time.monotonic() - t0) * 1000
        p.last_check = time.time()

        if r.status_code == 200:
            was_down = not p.healthy
            p.healthy = True
            p.consecutive_fails = 0
            p.last_error = ""
            if was_down:
                log.info(f"✅ {p.name} recovered ({p.latency_ms:.0f}ms)")
        elif r.status_code in (401, 403):
            p.healthy = False
            p.last_error = f"Auth {r.status_code}"
            log.warning(f"🔑 {p.name}: auth {r.status_code}")
        elif r.status_code == 429:
            p.healthy = False
            p.last_error = "Rate limited"
            log.warning(f"⏳ {p.name}: 429")
        else:
            p.healthy = False
            p.last_error = f"HTTP {r.status_code}"
            log.warning(f"❌ {p.name}: HTTP {r.status_code}")

    except Exception as e:
        p.healthy = False
        p.last_error = str(e)[:200]
        p.last_check = time.time()
        log.warning(f"❌ {p.name} probe error: {e}")


async def health_loop(providers: list[Provider]):
    """Background health checker that runs forever."""
    async with httpx.AsyncClient() as client:
        # Initial probe
        log.info("Running initial health probes...")
        for p in providers:
            await probe(client, p)
            status = "✅" if p.healthy else f"❌ {p.last_error}"
            log.info(f"  {p.name}: {status} ({p.latency_ms:.0f}ms)")

        while True:
            await asyncio.sleep(HEALTH_INTERVAL)
            for p in providers:
                await probe(client, p)


# ─── Cost Log ──────────────────────────────────────────────────────────

COST_LOG = os.path.expanduser("~/.openclaw/workspace/platform-proxy/cost.jsonl")

def log_cost(provider: str, model: str, in_tok: int, out_tok: int, ms: float, ok: bool):
    try:
        with open(COST_LOG, "a") as f:
            f.write(json.dumps({
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "provider": provider, "model": model,
                "in": in_tok, "out": out_tok,
                "ms": round(ms), "ok": ok,
            }) + "\n")
    except Exception:
        pass


# ─── Compaction Interceptor ────────────────────────────────────────────

QDRANT_URL = "http://localhost:7777"

async def maybe_commit_compaction(text: str):
    """If response has compaction rescue blocks, auto-commit to Qdrant."""
    markers = ["[COMPACTED]", "[RESCUED_FACTS]", "[RESCUED_DECISIONS]", "[RESCUED_SKILLS]"]
    if not any(m in text for m in markers):
        return
    try:
        async with httpx.AsyncClient() as c:
            r = await c.post(f"{QDRANT_URL}/commit", json={"text": text, "source": "platform-proxy"}, timeout=10)
            log.info(f"📦 Compaction → Qdrant: {r.status_code} ({len(text)} chars)")
    except Exception as e:
        log.warning(f"📦 Qdrant commit failed: {e}")


# ─── Compaction Router (Cerebras GLM-4.7) ──────────────────────────────

def is_compaction_request(body: dict) -> bool:
    """Detect if this request is a compaction/summarization task."""
    # Check system messages and last user message for compaction markers
    text_to_check = ""
    for msg in body.get("messages", []):
        role = msg.get("role", "")
        content = msg.get("content", "")
        if isinstance(content, list):
            content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
        if role == "system":
            text_to_check += content + " "
        elif role == "user":
            text_to_check = content  # only check last user msg

    text_lower = text_to_check.lower()
    return any(marker.lower() in text_lower for marker in COMPACTION_MARKERS)


async def handle_compaction(body: dict, is_stream: bool):
    """Route compaction to Cerebras GLM-4.7 for fast, cheap extraction."""
    t0 = time.monotonic()
    log.info("🧠 Compaction detected → routing to Cerebras GLM-4.7")

    fwd = {
        "model": CEREBRAS_MODEL,
        "messages": body.get("messages", []),
        "max_completion_tokens": body.get("max_tokens", 16384),
    }

    headers = {
        "Authorization": f"Bearer {CEREBRAS_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        if is_stream:
            req = http_client.build_request("POST", f"{CEREBRAS_BASE_URL}/chat/completions",
                json={**fwd, "stream": True}, headers=headers)
            resp = await http_client.send(req, stream=True)
            if resp.status_code != 200:
                err = (await resp.aread()).decode()[:300]
                await resp.aclose()
                raise Exception(f"Cerebras {resp.status_code}: {err}")

            async def gen():
                try:
                    full_text = []
                    async for line in resp.aiter_lines():
                        line = line.strip()
                        if line:
                            yield f"{line}\n\n".encode()
                            # Collect for Qdrant commit
                            if line.startswith("data: ") and line != "data: [DONE]":
                                try:
                                    d = json.loads(line[6:])
                                    t = d.get("choices", [{}])[0].get("delta", {}).get("content", "")
                                    if t:
                                        full_text.append(t)
                                except Exception:
                                    pass
                    if full_text:
                        asyncio.create_task(maybe_commit_compaction("".join(full_text)))
                finally:
                    await resp.aclose()

            ms = (time.monotonic() - t0) * 1000
            log_cost("cerebras-glm4.7", CEREBRAS_MODEL, 0, 0, ms, True)
            return StreamingResponse(gen(), media_type="text/event-stream", headers={
                "Cache-Control": "no-cache",
                "X-platform-Provider": "cerebras-glm4.7",
                "X-platform-Compaction": "true",
            })

        else:
            resp = await http_client.post(f"{CEREBRAS_BASE_URL}/chat/completions",
                json=fwd, headers=headers, timeout=60)
            if resp.status_code != 200:
                raise Exception(f"Cerebras {resp.status_code}: {resp.text[:300]}")

            result = resp.json()
            ms = (time.monotonic() - t0) * 1000
            usage = result.get("usage", {})
            time_info = result.get("time_info", {})

            log.info(f"🧠 Compaction done: {ms:.0f}ms total, "
                     f"{time_info.get('completion_time', 0)*1000:.0f}ms inference, "
                     f"{usage.get('prompt_tokens', 0)}in/{usage.get('completion_tokens', 0)}out")

            log_cost("cerebras-glm4.7", CEREBRAS_MODEL,
                     usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), ms, True)

            # Auto-commit compaction result to Qdrant
            text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            if text:
                asyncio.create_task(maybe_commit_compaction(text))

            return JSONResponse(result, headers={
                "X-platform-Provider": "cerebras-glm4.7",
                "X-platform-Compaction": "true",
            })

    except Exception as e:
        ms = (time.monotonic() - t0) * 1000
        log.warning(f"🧠 Cerebras compaction failed ({ms:.0f}ms): {e}")
        log_cost("cerebras-glm4.7", CEREBRAS_MODEL, 0, 0, ms, False)
        # Fall through to main Opus chain
        log.info("🧠 Falling back to Opus chain for compaction")
        return None  # caller will handle


# ─── App ───────────────────────────────────────────────────────────────

providers: list[Provider] = []
http_client: Optional[httpx.AsyncClient] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global providers, http_client
    providers = load_providers()
    http_client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)

    log.info(f"🚀 platform Proxy on :{PORT}  ({len(providers)} providers)")
    for i, p in enumerate(providers, 1):
        log.info(f"  {i}. {p.name} ({p.api_type}) → {p.model_id}")

    health_task = asyncio.create_task(health_loop(providers))
    yield
    health_task.cancel()
    await http_client.aclose()


app = FastAPI(title="platform Proxy", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def get_health():
    return {
        "status": "ok",
        "providers": [
            {
                "name": p.name,
                "healthy": p.healthy,
                "latency_ms": round(p.latency_ms),
                "error": p.last_error,
                "ok": p.total_ok,
                "fail": p.total_fail,
                "checked": time.strftime("%H:%M:%S", time.localtime(p.last_check)) if p.last_check else "-",
            }
            for p in providers
        ],
    }


@app.get("/v1/models")
async def list_models():
    return {"object": "list", "data": [
        {"id": "claude-opus-4-6", "object": "model", "created": int(time.time()), "owned_by": "platform-proxy"},
    ]}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    is_stream = body.get("stream", False)

    # ─── Compaction Detection → Route to Cerebras GLM-4.7 ───
    if CEREBRAS_API_KEY and is_compaction_request(body):
        result = await handle_compaction(body, is_stream)
        if result is not None:
            return result
        log.info("🧠 Cerebras failed, falling through to Opus chain")

    # Build ordered list: healthy first, then unhealthy as fallback
    candidates = [p for p in providers if p.healthy] + [p for p in providers if not p.healthy]
    if not candidates:
        return JSONResponse({"error": {"message": "No providers configured", "type": "server_error"}}, status_code=500)

    last_err = ""

    for p in candidates:
        t0 = time.monotonic()
        try:
            if is_stream:
                log.info(f"→ {p.name} (stream)")
                stream_gen = await try_provider_stream(http_client, p, body)
                # Connection validated (non-200 would have raised). Stream it.
                p.total_ok += 1
                ms = (time.monotonic() - t0) * 1000
                log_cost(p.name, body.get("model", "?"), 0, 0, ms, True)

                async def wrap(gen=stream_gen):
                    full = []
                    async for chunk in gen:
                        yield chunk
                        # Collect text for compaction check
                        try:
                            line = chunk.decode().strip()
                            if line.startswith("data: ") and line != "data: [DONE]":
                                d = json.loads(line[6:])
                                t = d.get("choices", [{}])[0].get("delta", {}).get("content", "")
                                if t:
                                    full.append(t)
                        except Exception:
                            pass
                    if full:
                        asyncio.create_task(maybe_commit_compaction("".join(full)))

                return StreamingResponse(wrap(), media_type="text/event-stream", headers={
                    "Cache-Control": "no-cache",
                    "X-platform-Provider": p.name,
                })

            else:
                log.info(f"→ {p.name} (sync)")
                result = await try_provider_nonstream(http_client, p, body)
                ms = (time.monotonic() - t0) * 1000
                p.total_ok += 1
                p.consecutive_fails = 0

                usage = result.get("usage", {})
                log_cost(p.name, body.get("model", "?"), usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), ms, True)

                # Compaction check
                text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                if text:
                    asyncio.create_task(maybe_commit_compaction(text))

                return JSONResponse(result, headers={"X-platform-Provider": p.name})

        except Exception as e:
            ms = (time.monotonic() - t0) * 1000
            p.total_fail += 1
            p.consecutive_fails += 1
            last_err = f"{p.name}: {e}"
            log.warning(f"✗ {p.name} ({ms:.0f}ms): {str(e)[:150]}")
            log_cost(p.name, body.get("model", "?"), 0, 0, ms, False)

            if p.consecutive_fails >= 3:
                p.healthy = False
                log.warning(f"🔴 {p.name} marked unhealthy ({p.consecutive_fails} consecutive fails)")
            continue

    log.error(f"💀 All {len(candidates)} providers failed. Last: {last_err}")
    return JSONResponse(
        {"error": {"message": f"All providers failed. Last: {last_err}", "type": "server_error", "code": "all_failed"}},
        status_code=502,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
