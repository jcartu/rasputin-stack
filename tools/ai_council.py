#!/usr/bin/env python3
"""AI Council & Synthesis System — Multi-model consensus engine.

Usage:
    python3 ai_council.py "question"                        # Auto mode
    python3 ai_council.py --mode synthesis "question"       # Fast synthesis
    python3 ai_council.py --mode council "question"         # Full debate
    python3 ai_council.py --panel                           # Show models
    python3 ai_council.py --json "question"                 # JSON output
"""

import asyncio
import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional

try:
    import httpx
except ImportError:
    print("Installing httpx...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx", "-q"])
    import httpx

# ─── Load env ────────────────────────────────────────────────
ENV_PATH = Path.home() / ".openclaw/workspace/.env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

# ─── ANSI Colors ─────────────────────────────────────────────
class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"
    BG_DARK = "\033[48;5;236m"

def p(color, text, end="\n"):
    print(f"{color}{text}{C.RESET}", end=end, file=sys.stderr)

# ─── Streaming Events ────────────────────────────────────────
_stream_mode = False

def emit(event_type: str, **data):
    """Emit a streaming event as JSONL to stdout."""
    if not _stream_mode:
        return
    data["event"] = event_type
    data["ts"] = time.time()
    print(json.dumps(data, default=str), flush=True)

# ─── Model Registry ─────────────────────────────────────────

class Tier(Enum):
    FRONTIER = 1
    STRONG = 2
    FAST = 3
    LOCAL = 4

TIER_WEIGHTS = {Tier.FRONTIER: 3.0, Tier.STRONG: 2.0, Tier.FAST: 1.0, Tier.LOCAL: 0.5}
TIER_TIMEOUTS = {Tier.FRONTIER: 90, Tier.STRONG: 45, Tier.FAST: 20, Tier.LOCAL: 15}
TIER_COLORS = {Tier.FRONTIER: C.MAGENTA, Tier.STRONG: C.CYAN, Tier.FAST: C.GREEN, Tier.LOCAL: C.YELLOW}

@dataclass
class Model:
    key: str
    model_id: str
    provider: str  # anthropic, openrouter, ollama, groq, cerebras, xai
    tier: Tier
    name: str

    @property
    def weight(self): return TIER_WEIGHTS[self.tier]
    @property
    def timeout(self): return TIER_TIMEOUTS[self.tier]

MODELS: dict[str, Model] = {}
def _m(key, model_id, provider, tier, name):
    MODELS[key] = Model(key, model_id, provider, tier, name)

# Tier 1 Frontier — Feb 2026 latest models only
_m("opus",          "claude-opus-4-6",                  "anthropic",   Tier.FRONTIER, "Claude Opus 4.6")
_m("gemini-3-pro",  "google/gemini-3.1-pro-preview",      "openrouter",  Tier.FRONTIER, "Gemini 3.1 Pro")
# DeepSeek removed — too slow for council
_m("grok-reason",   "grok-4-1-fast-reasoning",          "xai",         Tier.FRONTIER, "Grok 4.1 Reasoning")

# Tier 2 Strong — fast frontier models
_m("sonnet",        "claude-sonnet-4-5",                "anthropic",   Tier.STRONG,   "Claude Sonnet 4.5")
_m("gpt52",         "openai/gpt-5.2",                   "openrouter",  Tier.FRONTIER, "GPT-5.2")
_m("gemini-flash",  "google/gemini-3-flash-preview",    "openrouter",  Tier.STRONG,   "Gemini 3 Flash")
_m("grok-fast",     "grok-4-1-fast-non-reasoning",      "xai",         Tier.STRONG,   "Grok 4.1 Fast")

# ─── Default Panels ─────────────────────────────────────────

SYNTHESIS_PANEL = ["sonnet", "gpt52", "gemini-flash", "grok-fast"]
COUNCIL_PANEL = ["opus", "gpt52", "gemini-3-pro", "grok-reason", "sonnet", "gemini-flash"]
JUDGE_MODEL = "opus"  # Claude Opus 4.6 for final verdicts
CLASSIFIER_MODEL = "gemini-flash"  # Gemini 3 Flash for fast classification

# ─── API Caller ──────────────────────────────────────────────

async def call_model(client: httpx.AsyncClient, model: Model, messages: list[dict],
                     max_tokens: int = 1024) -> dict:
    start = time.monotonic()
    result = {"model": model.name, "key": model.key, "tier": model.tier.value,
              "weight": model.weight, "content": None, "error": None, "latency": 0}
    try:
        if model.provider == "anthropic":
            # Route through operator-proxy (localhost:8080) which handles OAuth/Zen/paid failover
            system_text = None
            api_messages = []
            for msg in messages:
                if msg["role"] == "system":
                    system_text = msg["content"]
                else:
                    api_messages.append(msg)
            body = {"model": model.model_id, "max_tokens": max_tokens, "messages": api_messages}
            if system_text:
                body["system"] = system_text
            r = await client.post("http://localhost:8080/v1/messages",
                headers={"anthropic-version": "2023-06-01", "content-type": "application/json"},
                json=body,
                timeout=model.timeout)
            r.raise_for_status()
            data = r.json()
            # Handle both Anthropic format and OpenAI format (proxy may transform)
            if "content" in data and isinstance(data["content"], list):
                result["content"] = data["content"][0]["text"]
            elif "choices" in data:
                result["content"] = data["choices"][0]["message"]["content"]
            else:
                result["content"] = str(data)

        elif model.provider == "openrouter":
            r = await client.post("https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
                         "content-type": "application/json"},
                json={"model": model.model_id, "max_tokens": max_tokens, "messages": messages},
                timeout=model.timeout)
            r.raise_for_status()
            result["content"] = r.json()["choices"][0]["message"]["content"]

        elif model.provider == "ollama":
            r = await client.post("http://localhost:11434/api/chat",
                json={"model": model.model_id, "messages": messages, "stream": False},
                timeout=model.timeout)
            r.raise_for_status()
            result["content"] = r.json()["message"]["content"]

        elif model.provider == "groq":
            r = await client.post("https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}",
                         "content-type": "application/json"},
                json={"model": model.model_id, "max_tokens": max_tokens, "messages": messages},
                timeout=model.timeout)
            r.raise_for_status()
            result["content"] = r.json()["choices"][0]["message"]["content"]

        elif model.provider == "cerebras":
            r = await client.post("https://api.cerebras.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['CEREBRAS_API_KEY']}",
                         "content-type": "application/json"},
                json={"model": model.model_id, "max_tokens": max_tokens, "messages": messages},
                timeout=model.timeout)
            r.raise_for_status()
            result["content"] = r.json()["choices"][0]["message"]["content"]

        elif model.provider == "xai":
            # X.AI / Grok provider — OpenAI-compatible API
            r = await client.post("https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['XAI_API_KEY']}",
                         "content-type": "application/json"},
                json={"model": model.model_id, "max_tokens": max_tokens, "messages": messages},
                timeout=model.timeout)
            r.raise_for_status()
            result["content"] = r.json()["choices"][0]["message"]["content"]

    except Exception as e:
        result["error"] = f"{type(e).__name__}: {str(e)[:200]}"

    result["latency"] = round(time.monotonic() - start, 2)
    return result

# ─── Modes ───────────────────────────────────────────────────

async def classify_query(client: httpx.AsyncClient, query: str) -> str:
    """Use Gemini Flash to classify → 'synthesis' or 'council'."""
    model = MODELS[CLASSIFIER_MODEL]
    r = await call_model(client, model, [{"role": "user", "content":
        f"Rate this query's complexity 1-10 (reply ONLY the number):\n"
        f"1-3: Simple factual, one right answer\n"
        f"4-5: Moderate\n6-10: Complex, controversial, multi-faceted\n\n"
        f"Query: \"{query}\""}], max_tokens=5)
    try:
        score = int(re.search(r'\d+', r.get("content") or "5").group())
    except:
        score = 5
    return "council" if score >= 6 else "synthesis"

async def _call_model_with_events(client, model, messages, max_tokens=1024):
    """Wrapper that emits streaming events around call_model."""
    emit("model_start", model=model.name, key=model.key, provider=model.provider, tier=model.tier.value)
    result = await call_model(client, model, messages, max_tokens)
    if result["error"]:
        emit("model_error", model=model.name, key=model.key, error=result["error"], latency=result["latency"])
    else:
        emit("model_done", model=model.name, key=model.key, content=result["content"],
             latency=result["latency"], tier=result["tier"], provider=model.provider)
    return result

async def run_synthesis(client: httpx.AsyncClient, query: str, panel_keys: list[str]) -> dict:
    """Single-pass: all models answer → judge synthesizes."""
    t0 = time.monotonic()
    panel = [MODELS[k] for k in panel_keys if k in MODELS]

    p(C.BOLD + C.BLUE, f"\n⚡ SYNTHESIS MODE — {len(panel)} models")
    p(C.DIM, f"   Panel: {', '.join(m.name for m in panel)}")
    p(C.DIM, f"   Judge: {MODELS[JUDGE_MODEL].name}\n")

    emit("phase", phase="round1", mode="synthesis",
         models=[{"name": m.name, "key": m.key, "provider": m.provider, "tier": m.tier.value} for m in panel])

    # Round 1: All parallel (with system context + confidence scoring)
    system_prompt = get_council_system_prompt()
    p(C.YELLOW, "▸ Round 1: Gathering responses...", end="")
    r1_start = time.monotonic()
    tasks = [_call_model_with_events(client, m, [{"role": "system", "content": system_prompt}, {"role": "user", "content": f"{query}\n\nProvide your answer and conclude with: CONFIDENCE: [0.0-1.0]"}]) for m in panel]
    r1 = await asyncio.gather(*tasks)
    r1_time = time.monotonic() - r1_start
    p(C.GREEN, f" done ({r1_time:.1f}s)")

    for r in r1:
        color = C.GREEN if not r["error"] else C.RED
        conf = _extract_confidence(r.get("content", ""))
        r["confidence"] = conf
        status = f"✓ {r['latency']}s (conf: {conf:.2f})" if not r["error"] else f"✗ {r['error'][:50]}"
        p(color, f"   {r['model']:25s} {status}")

    valid = [r for r in r1 if not r["error"]]
    if not valid:
        result = {"verdict": "All models failed.", "confidence": 0, "responses": r1,
                "total_time": round(time.monotonic() - t0, 2), "mode": "synthesis"}
        emit("done", result=result)
        return result

    # Synthesize
    emit("phase", phase="synthesizing", judge=MODELS[JUDGE_MODEL].name)
    p(C.YELLOW, "▸ Synthesizing...", end="")
    s_start = time.monotonic()
    responses_text = "\n\n".join(
        f"**{r['model']}** (weight {r['weight']}x):\n{r['content']}" for r in valid)
    synth = await call_model(client, MODELS[JUDGE_MODEL], [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content":
            f"You are the synthesis judge. Question: {query}\n\n"
            f"RESPONSES:\n{responses_text}\n\n"
            f"Synthesize into ONE authoritative answer. Include:\n"
            f"1. **VERDICT**: The best answer\n"
            f"2. **CONFIDENCE**: 0-100\n"
            f"3. **CONSENSUS**: unanimous/strong/weak/split\n"
            f"Where models agree, state as established. Where they disagree, pick the stronger position.\n"
            f"Output the BEST answer, not a summary of responses."}
    ], max_tokens=2048)
    s_time = time.monotonic() - s_start
    p(C.GREEN, f" done ({s_time:.1f}s)")

    total = time.monotonic() - t0
    verdict = synth.get("content") or "Synthesis failed"

    p(C.BOLD + C.WHITE, f"\n{'═' * 70}")
    p(C.BOLD + C.GREEN, f" SYNTHESIS RESULT  │  {total:.1f}s  │  {len(valid)}/{len(panel)} models")
    p(C.BOLD + C.WHITE, f"{'═' * 70}\n")
    p(C.WHITE, verdict)
    p(C.BOLD + C.WHITE, f"\n{'═' * 70}")

    result = {"verdict": verdict, "confidence": _extract_int(verdict, "CONFIDENCE", 50),
            "consensus": _extract_word(verdict), "responses": r1, "synthesis": synth,
            "total_time": round(total, 2), "mode": "synthesis"}
    emit("verdict", verdict=verdict, confidence=result["confidence"], consensus=result["consensus"],
         total_time=result["total_time"], mode="synthesis")
    emit("done", result=result)
    return result

def get_council_system_prompt():
    """Build a system prompt with current context for council models."""
    system = (
        "You are an expert AI advisor on a council panel. You're answering questions for the operator, "
        "who runs an digital-ops business and an advanced AI infrastructure setup.\n\n"
        "KEY CONTEXT:\n"
        "- OpenClaw is an open-source AI agent framework (github.com/openclaw/openclaw, 145K+ GitHub stars). "
        "It runs autonomous AI agents connected to messaging apps (Telegram, WhatsApp, Discord). "
        "admin runs OpenClaw on a server called Rasputin with dual GPUs (RTX PRO 6000 96GB + RTX 5090 32GB).\n"
        "- His AI assistant Rasputin runs on Claude Opus 4.6 as the main model, with Sonnet 4.5 for sub-agents, "
        "Gemini 3 Flash for heartbeats, Grok 4.1 for real-time X/Twitter intelligence, and a local GPT-OSS 120B for uncensored content.\n"
        "- Infrastructure: Qdrant vector DB (761K memories), vLLM inference server, LiteLLM router, "
        "Cloudflare tunnels, PM2 process management.\n"
        "- Business: CEO of digital-ops group (~$2-2.65M/month revenue), brands include platform-beta, platform-alpha, platform-gamma. "
        "Focus on LatAm/Asia markets, especially Brazil (PT-BR).\n\n"
        "Answer with current, accurate information. If you don't know something specific, say so rather than guessing."
    )
    # Try to enrich with Qdrant recall
    try:
        import subprocess
        result = subprocess.run(
            [sys.executable, str(Path.home() / ".openclaw/workspace/tools/memory_engine.py"), "recall", ""],
            capture_output=True, text=True, timeout=5, cwd=str(Path.home() / ".openclaw/workspace")
        )
        # Don't inject recall for empty queries — system prompt is enough
    except Exception:
        pass
    return system

async def run_council(client: httpx.AsyncClient, query: str, panel_keys: list[str]) -> dict:
    """Full 4-round council debate with critique round."""
    import random
    t0 = time.monotonic()
    panel = [MODELS[k] for k in panel_keys if k in MODELS]
    judge = MODELS[JUDGE_MODEL]
    system_prompt = get_council_system_prompt()

    p(C.BOLD + C.MAGENTA, f"\n🏛️  COUNCIL MODE — {len(panel)} models, 4 rounds")
    p(C.DIM, f"   Panel: {', '.join(m.name for m in panel)}")
    p(C.DIM, f"   Judge: {judge.name}\n")

    # Select devil's advocate
    devils_advocate = random.choice(panel)
    p(C.RED, f"👿 Devil's Advocate: {devils_advocate.name}\n")

    emit("phase", phase="round1", mode="council", round=1, total_rounds=4,
         models=[{"name": m.name, "key": m.key, "provider": m.provider, "tier": m.tier.value} for m in panel],
         devils_advocate=devils_advocate.name)

    # Round 1: Independent answers with confidence scoring
    p(C.YELLOW, "▸ Round 1: Independent answers...", end="")
    r1_start = time.monotonic()
    r1_prompts = []
    for m in panel:
        user_prompt = query
        if m == devils_advocate:
            user_prompt = (
                f"🔴 DEVIL'S ADVOCATE MODE: You must argue AGAINST the most common position. "
                f"Take a contrarian stance.\n\nQuestion: {query}\n\n"
                f"Provide:\n1. Your contrarian answer\n2. CONFIDENCE: [0.0-1.0] in your position"
            )
        else:
            user_prompt = f"{query}\n\nProvide your answer and conclude with: CONFIDENCE: [0.0-1.0]"
        
        r1_prompts.append(_call_model_with_events(client, m, [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]))
    
    r1 = await asyncio.gather(*r1_prompts)
    r1_time = time.monotonic() - r1_start
    p(C.GREEN, f" done ({r1_time:.1f}s)")
    
    for r in r1:
        color = C.GREEN if not r["error"] else C.RED
        conf = _extract_confidence(r.get("content", ""))
        r["confidence"] = conf
        status = f"✓ {r['latency']}s (conf: {conf:.2f})" if not r["error"] else f"✗ {r['error'][:50]}"
        marker = "👿 " if r["model"] == devils_advocate.name else ""
        p(color, f"   {marker}{r['model']:25s} {status}")

    valid1 = [r for r in r1 if not r["error"]]
    if not valid1:
        return {"verdict": "All models failed in Round 1.", "confidence": 0,
                "round1": r1, "round2": [], "round3": [], "judge": None,
                "total_time": round(time.monotonic() - t0, 2), "mode": "council"}

    # Round 2: CRITIQUE ROUND — Models explicitly critique each other
    r1_text = "\n\n".join(f"### {r['model']} (weight {r['weight']}x, confidence: {r.get('confidence', 0):.2f}):\n{r['content']}" for r in valid1)
    
    emit("phase", phase="critique", round=2, total_rounds=4,
         models=[{"name": m.name, "key": m.key, "provider": m.provider, "tier": m.tier.value} for m in panel])
    
    p(C.YELLOW, f"▸ Round 2: Critique round ({len(panel)} models debating)...", end="")
    r2_start = time.monotonic()
    
    critique_prompts = []
    for m in panel:
        critique_prompt = (
            f"Original question: {query}\n\n"
            f"ROUND 1 RESPONSES:\n{r1_text}\n\n"
            f"Your task: EXPLICITLY CRITIQUE each model's response.\n"
            f"For EACH model above, state:\n"
            f"• \"I agree with [Model] because...\"\n"
            f"• \"I disagree with [Model] because...\"\n"
            f"• \"[Model] missed...\"\n\n"
            f"Be specific. Name models. Challenge weak arguments. Identify errors.\n"
            f"Conclude with: CONFIDENCE: [0.0-1.0]"
        )
        critique_prompts.append(_call_model_with_events(client, m, [{"role": "system", "content": system_prompt}, {"role": "user", "content": critique_prompt}]))
    
    r2 = await asyncio.gather(*critique_prompts)
    r2_time = time.monotonic() - r2_start
    p(C.GREEN, f" done ({r2_time:.1f}s)")
    
    for r in r2:
        color = C.GREEN if not r["error"] else C.RED
        conf = _extract_confidence(r.get("content", ""))
        r["confidence"] = conf
        status = f"✓ {r['latency']}s (conf: {conf:.2f})" if not r["error"] else f"✗ {r['error'][:50]}"
        p(color, f"   {r['model']:25s} {status}")

    valid2 = [r for r in r2 if not r["error"]]

    # Round 3: Synthesis (Tier 1-2 only) — seeing all critiques, produce refined answer
    r2_text = "\n\n".join(f"**{r['model']}** (critiques, confidence: {r.get('confidence', 0):.2f}):\n{r['content']}" for r in valid2) if valid2 else "No Round 2 responses."
    
    r3_models = [m for m in panel if m.tier in (Tier.FRONTIER, Tier.STRONG)]
    emit("phase", phase="synthesis", round=3, total_rounds=4,
         models=[{"name": m.name, "key": m.key, "provider": m.provider, "tier": m.tier.value} for m in r3_models])
    
    p(C.YELLOW, f"▸ Round 3: Synthesis ({len(r3_models)} models)...", end="")
    r3_start = time.monotonic()
    
    synthesis_prompts = []
    for m in r3_models:
        synthesis_prompt = (
            f"Original question: {query}\n\n"
            f"ROUND 1 (Initial responses):\n{r1_text}\n\n"
            f"ROUND 2 (Critiques):\n{r2_text}\n\n"
            f"Now synthesize all perspectives into your BEST FINAL ANSWER.\n"
            f"Consider:\n"
            f"• Valid critiques from Round 2\n"
            f"• Strong points from Round 1\n"
            f"• Areas of consensus vs. disagreement\n\n"
            f"Conclude with: CONFIDENCE: [0.0-1.0]"
        )
        synthesis_prompts.append(_call_model_with_events(client, m, [{"role": "system", "content": system_prompt}, {"role": "user", "content": synthesis_prompt}]))
    
    r3 = await asyncio.gather(*synthesis_prompts)
    r3_time = time.monotonic() - r3_start
    p(C.GREEN, f" done ({r3_time:.1f}s)")
    
    for r in r3:
        color = C.GREEN if not r["error"] else C.RED
        conf = _extract_confidence(r.get("content", ""))
        r["confidence"] = conf
        status = f"✓ {r['latency']}s (conf: {conf:.2f})" if not r["error"] else f"✗ {r['error'][:50]}"
        p(color, f"   {r['model']:25s} {status}")

    valid3 = [r for r in r3 if not r["error"]]

    # Round 4: Judge verdict
    r3_text = "\n\n".join(f"**{r['model']}** (final synthesis, confidence: {r.get('confidence', 0):.2f}):\n{r['content']}" for r in valid3) if valid3 else "No Round 3 responses."
    judge_prompt = (
        f"You are the final judge of a multi-AI council debate.\n\n"
        f"QUESTION: {query}\n\n"
        f"ROUND 1 (Independent):\n{r1_text}\n\n"
        f"ROUND 2 (Critiques):\n{r2_text}\n\n"
        f"ROUND 3 (Synthesis):\n{r3_text}\n\n"
        f"Produce your FINAL VERDICT:\n"
        f"1. **VERDICT**: The definitive answer to the question\n"
        f"2. **CONFIDENCE**: 0-100 score\n"
        f"3. **CONSENSUS**: unanimous / strong / weak / split\n"
        f"4. **DISSENTS**: Notable minority positions worth mentioning\n"
        f"5. **DEVIL'S ADVOCATE**: Comment on {devils_advocate.name}'s contrarian position\n"
        f"6. **REASONING**: How you weighted inputs and reached this conclusion\n\n"
        f"Be authoritative. This is the final word.")

    emit("phase", phase="judging", round=4, total_rounds=4, judge=judge.name)
    p(C.YELLOW, "▸ Round 4: Final verdict...", end="")
    r4_start = time.monotonic()
    judge_result = await call_model(client, judge, [{"role": "system", "content": system_prompt}, {"role": "user", "content": judge_prompt}], max_tokens=2048)
    r4_time = time.monotonic() - r4_start
    p(C.GREEN, f" done ({r4_time:.1f}s)")

    total = time.monotonic() - t0
    verdict = judge_result.get("content") or "Judge failed to produce verdict."

    p(C.BOLD + C.WHITE, f"\n{'═' * 70}")
    p(C.BOLD + C.MAGENTA, f" 🏛️  COUNCIL VERDICT  │  {total:.1f}s  │  4 rounds  │  {len(valid1)}/{len(panel)} models")
    p(C.BOLD + C.WHITE, f"{'═' * 70}\n")
    p(C.WHITE, verdict)
    p(C.BOLD + C.WHITE, f"\n{'═' * 70}")

    result = {"verdict": verdict, "confidence": _extract_int(verdict, "CONFIDENCE", 50),
            "consensus": _extract_word(verdict), 
            "round1": r1, "round2": r2, "round3": r3,
            "devils_advocate": devils_advocate.name,
            "judge": judge_result, "total_time": round(total, 2), "mode": "council"}
    emit("verdict", verdict=verdict, confidence=result["confidence"], consensus=result["consensus"],
         total_time=result["total_time"], mode="council", devils_advocate=devils_advocate.name)
    emit("done", result=result)
    return result

# ─── Helpers ─────────────────────────────────────────────────

def _extract_int(text, label, default):
    m = re.search(rf'{label}[:\s]*(\d+)', text, re.IGNORECASE)
    return int(m.group(1)) if m else default

def _extract_confidence(text):
    """Extract confidence score (0.0-1.0) from text."""
    if not text:
        return 0.5
    # Look for patterns like "CONFIDENCE: 0.85" or "confidence: 0.7"
    m = re.search(r'confidence[:\s]*([0-9]*\.?[0-9]+)', text, re.IGNORECASE)
    if m:
        val = float(m.group(1))
        # If > 1, assume it's a percentage (e.g., 85 instead of 0.85)
        if val > 1.0:
            val = val / 100.0
        return max(0.0, min(1.0, val))
    return 0.5

def _extract_word(text):
    for w in ["unanimous", "strong", "weak", "split"]:
        if w in text.lower():
            return w
    return "unknown"

def save_result(result: dict):
    out_dir = Path.home() / ".openclaw/workspace/council_results"
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = out_dir / f"council_{ts}.json"
    path.write_text(json.dumps(result, indent=2, default=str))
    p(C.DIM, f"\n💾 Saved: {path}")

def show_panel():
    p(C.BOLD + C.WHITE, f"\n{'═' * 70}")
    p(C.BOLD + C.CYAN, " 📋 AI COUNCIL — MODEL REGISTRY")
    p(C.BOLD + C.WHITE, f"{'═' * 70}\n")

    for tier in Tier:
        tier_models = [m for m in MODELS.values() if m.tier == tier]
        color = TIER_COLORS[tier]
        weight = TIER_WEIGHTS[tier]
        label = {Tier.FRONTIER: "🔮 Tier 1 — Frontier (judges)",
                 Tier.STRONG: "💪 Tier 2 — Strong (voters)",
                 Tier.FAST: "⚡ Tier 3 — Fast (diversity)",
                 Tier.LOCAL: "🏠 Tier 4 — Local/Free"}[tier]
        p(color + C.BOLD, f"  {label}  (weight: {weight}x)")
        for m in tier_models:
            p(color, f"    {m.key:16s} {m.name:28s} [{m.provider}] {m.model_id}")
        print()

    p(C.BOLD, "  Default panels:")
    p(C.BLUE, f"    Synthesis: {', '.join(SYNTHESIS_PANEL)}")
    p(C.MAGENTA, f"    Council:   {', '.join(COUNCIL_PANEL)}")
    p(C.GREEN, f"    Judge:     {JUDGE_MODEL}")
    p(C.YELLOW, f"    Classifier: {CLASSIFIER_MODEL}")
    p(C.BOLD + C.WHITE, f"\n{'═' * 70}\n")

# ─── Main ────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="AI Council — Multi-model consensus engine")
    parser.add_argument("query", nargs="?", help="Question to ask")
    parser.add_argument("--mode", choices=["synthesis", "council", "auto"], default="auto")
    parser.add_argument("--panel", action="store_true", help="Show available models")
    parser.add_argument("--json", action="store_true", help="JSON output")
    parser.add_argument("--models", help="Comma-separated model keys to use")
    parser.add_argument("--stream", action="store_true", help="Emit JSONL streaming events to stdout")
    args = parser.parse_args()

    global _stream_mode
    _stream_mode = args.stream

    if args.panel:
        show_panel()
        return

    if not args.query:
        parser.print_help()
        return

    async with httpx.AsyncClient() as client:
        mode = args.mode
        if mode == "auto":
            emit("phase", phase="classifying")
            p(C.DIM, "🔍 Classifying query complexity...", end="")
            mode = await classify_query(client, args.query)
            emit("phase", phase="classified", mode=mode)
            p(C.DIM, f" → {mode}")

        panel = args.models.split(",") if args.models else None

        if mode == "synthesis":
            result = await run_synthesis(client, args.query, panel or SYNTHESIS_PANEL)
        else:
            result = await run_council(client, args.query, panel or COUNCIL_PANEL)

    save_result(result)

    # Only dump JSON to stdout when NOT in stream mode (stream mode already emits everything via JSONL events)
    if args.json and not args.stream:
        print(json.dumps(result, indent=2, default=str))

if __name__ == "__main__":
    asyncio.run(main())
