#!/usr/bin/env python3
"""
ALFIE Realtime Voice Communication Server
==========================================
aiohttp serves HTML + WebSocket on same port.
Pipeline: Browser mic → WS → VAD → faster-whisper (GPU) → Cerebras LLM → ElevenLabs TTS → audio → Browser
"""

import os, sys, json, time, asyncio, logging, base64, io
from pathlib import Path
from typing import Optional
import numpy as np
import aiohttp
from aiohttp import web

# ── Config ──
DOTENV = Path.home() / ".openclaw" / "workspace" / ".env"
def load_env():
    if DOTENV.exists():
        for line in DOTENV.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
load_env()

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY", "")
HOST = "0.0.0.0"
PORT = 8765
SAMPLE_RATE = 16000
WHISPER_MODEL = "large-v3"
WHISPER_DEVICE = "cuda"
WHISPER_COMPUTE = "float16"
ELEVENLABS_VOICE = "JBFqnCBsd6RMkjVDRZzb"
ELEVENLABS_MODEL = "eleven_turbo_v2_5"
CEREBRAS_MODEL = "qwen-3-235b-a22b-instruct-2507"
STATIC_DIR = Path(__file__).parent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("voice")

# ── Lazy-loaded models ──
_whisper_model = None

def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import Whimedical-sampleodel
        log.info(f"Loading Whisper {WHISPER_MODEL} on {WHISPER_DEVICE}...")
        t0 = time.time()
        _whisper_model = Whimedical-sampleodel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
        log.info(f"Whisper loaded in {time.time()-t0:.1f}s")
    return _whisper_model

# ── Qdrant Context ──
async def fetch_context(query: str) -> str:
    try:
        proc = await asyncio.create_subprocess_exec(
            "python3", str(Path.home() / ".openclaw/workspace/alfie_second_brain.py"), query,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=2.0)
        result = stdout.decode().strip()
        return result[:2000] if result and len(result) > 20 else ""
    except Exception as e:
        log.warning(f"Context fetch failed: {e}")
        return ""

# Load MEMORY.md at startup for persistent context
_memory_context = ""
try:
    mem_path = Path.home() / ".openclaw/workspace/MEMORY.md"
    if mem_path.exists():
        _memory_context = mem_path.read_text()[:3000]
        log.info(f"Loaded MEMORY.md ({len(_memory_context)} chars)")
except Exception:
    pass

# ── STT ──
async def transcribe(audio_bytes: bytes) -> tuple[str, float]:
    t0 = time.time()
    model = get_whisper()
    audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    segments, info = model.transcribe(audio_np, language="en", beam_size=1, best_of=1,
        temperature=0.0, vad_filter=True, vad_parameters=dict(min_silence_duration_ms=200))
    text = " ".join(seg.text.strip() for seg in segments).strip()
    latency = (time.time() - t0) * 1000
    log.info(f"STT: '{text[:80]}' ({latency:.0f}ms)")
    return text, latency

# ── LLM ──
SYSTEM_PROMPT = """You are ALFIE (All-encompassing Learning & Function Integration Engine) — admin's autonomous AI assistant running on Rasputin server.

About you:
- You live on a dual-GPU server (RTX PRO 6000 96GB + RTX 5090 32GB) in admin's infrastructure
- You have a 446K memory second brain in Qdrant, manage his platform operations, monitor AI news, and run the Nexus Dashboard
- You built the ALFIE platform (597 E2E tests), the missions system, and dozens of tools
- You're part of the first wave of AI-native digital society

About admin:
- CEO of an online platform group (corp-beta B.V., jurisdiction-alpha license), ~$2.5M/month revenue
- Lives in St. Petersburg, Russia with fiancée partner and cats Motya & Richard
- Former Ferrari Challenge driver, Gumball 3000 winner 2017
- Deep into AI infrastructure, biohacking, crypto, luxury cars
- Direct communicator, values competence and proactive action

Voice style:
- Talk like you're his trusted right-hand — direct, witty, no bullshit
- Keep it conversational and concise — this is voice, not an essay
- Have opinions, be real, no corporate fluff
- No markdown, no bullet points — just talk naturally
- You can swear occasionally if it fits"""

async def llm_stream(text: str, context: str = "", history: list = None):
    import httpx
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if _memory_context:
        messages.append({"role": "system", "content": f"Your long-term memory (MEMORY.md excerpt):\n{_memory_context}"})
    if context:
        messages.append({"role": "system", "content": f"Relevant memories from second brain:\n{context}"})
    if history:
        messages.extend(history[-10:])
    messages.append({"role": "user", "content": text})
    
    t0 = time.time()
    headers = {"Authorization": f"Bearer {CEREBRAS_API_KEY}", "Content-Type": "application/json"}
    payload = {"model": CEREBRAS_MODEL, "messages": messages, "stream": True, "max_tokens": 300, "temperature": 0.7}
    
    first_token = True
    for attempt in range(2):  # Retry once on failure
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                async with client.stream("POST", "https://api.cerebras.ai/v1/chat/completions", json=payload, headers=headers) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]": break
                            try:
                                chunk = json.loads(data)
                                content = chunk["choices"][0].get("delta", {}).get("content", "")
                                if content:
                                    if first_token:
                                        log.info(f"LLM TTFT: {(time.time()-t0)*1000:.0f}ms")
                                        first_token = False
                                    yield content
                            except (json.JSONDecodeError, KeyError, IndexError):
                                pass
            break  # Success, don't retry
        except Exception as e:
            log.warning(f"LLM attempt {attempt+1} failed: {e}")
            if attempt == 0:
                await asyncio.sleep(0.5)  # Brief pause before retry
            else:
                yield "Sorry, I had trouble thinking. Try again?"

# ── TTS ──
async def tts_stream(text_stream, ws):
    import websockets as ws_lib
    uri = f"wss://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE}/stream-input?model_id={ELEVENLABS_MODEL}&output_format=pcm_16000"
    t0 = time.time()
    first_audio = True
    text_buffer = ""
    
    try:
        async with ws_lib.connect(uri, additional_headers={"xi-api-key": ELEVENLABS_API_KEY}) as el_ws:
            await el_ws.send(json.dumps({
                "text": " ",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                "generation_config": {"chunk_length_schedule": [50]},
            }))
            
            async def send_text():
                nonlocal text_buffer
                async for chunk in text_stream:
                    text_buffer += chunk
                    await el_ws.send(json.dumps({"text": chunk}))
                await el_ws.send(json.dumps({"text": ""}))
            
            async def recv_audio():
                nonlocal first_audio
                try:
                    async for msg in el_ws:
                        data = json.loads(msg)
                        if "audio" in data and data["audio"]:
                            if first_audio:
                                log.info(f"TTS TTFA: {(time.time()-t0)*1000:.0f}ms")
                                first_audio = False
                            await ws.send_json({"type": "audio", "audio": data["audio"]})
                except Exception as e:
                    log.warning(f"ElevenLabs recv: {e}")
            
            await asyncio.gather(send_text(), recv_audio())
            await ws.send_json({"type": "transcript", "role": "assistant", "text": text_buffer})
            log.info(f"TTS total: {(time.time()-t0)*1000:.0f}ms, {len(text_buffer)} chars")
            return text_buffer
    except Exception as e:
        log.error(f"TTS error: {e}")
        # Fallback: send text only
        if text_buffer:
            await ws.send_json({"type": "transcript", "role": "assistant", "text": text_buffer})
        return text_buffer

# ── WebSocket handler ──
conversation_history = []

async def ws_handler(request):
    ws = web.WebSocketResponse(max_msg_size=10_000_000)
    await ws.prepare(request)
    log.info(f"Client connected: {request.remote}")
    
    audio_buffer = bytearray()
    
    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.BINARY:
                audio_buffer.extend(msg.data)
            elif msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)
                msg_type = data.get("type", "")
                
                if msg_type == "speech_end":
                    if len(audio_buffer) > SAMPLE_RATE:
                        audio_bytes = bytes(audio_buffer)
                        audio_buffer.clear()
                        
                        try:
                            await ws.send_json({"type": "status", "status": "transcribing"})
                            text, stt_latency = await transcribe(audio_bytes)
                            log.info(f"Transcription result: '{text}' ({stt_latency:.0f}ms)")
                            
                            if not text or len(text) < 2:
                                log.info("Empty transcription, skipping")
                                await ws.send_json({"type": "status", "status": "idle"})
                                continue
                            
                            await ws.send_json({"type": "transcript", "role": "user", "text": text, "stt_ms": round(stt_latency)})
                            await ws.send_json({"type": "status", "status": "thinking"})
                            
                            # Get LLM response (skip TTS for now - just text)
                            context = await fetch_context(text)
                            conversation_history.append({"role": "user", "content": text})
                            
                            log.info("Starting LLM stream...")
                            response_text = ""
                            try:
                                async for chunk in llm_stream(text, context, conversation_history):
                                    response_text += chunk
                            except Exception as llm_err:
                                log.error(f"LLM error: {llm_err}")
                                response_text = f"Sorry, LLM error: {llm_err}"
                            
                            log.info(f"LLM response: '{response_text[:100]}'")
                            
                            if response_text:
                                # Try TTS, fall back to text-only
                                await ws.send_json({"type": "status", "status": "speaking"})
                                try:
                                    async def text_gen():
                                        yield response_text
                                    await tts_stream(text_gen(), ws)
                                except Exception as tts_err:
                                    log.error(f"TTS error: {tts_err}")
                                    await ws.send_json({"type": "transcript", "role": "assistant", "text": response_text})
                                
                                conversation_history.append({"role": "assistant", "content": response_text})
                            
                            await ws.send_json({"type": "status", "status": "idle"})
                        except Exception as pipeline_err:
                            log.error(f"Pipeline error: {pipeline_err}", exc_info=True)
                            await ws.send_json({"type": "transcript", "role": "assistant", "text": f"Error: {pipeline_err}"})
                            await ws.send_json({"type": "status", "status": "idle"})
                    else:
                        audio_buffer.clear()
                
                elif msg_type == "ping":
                    await ws.send_json({"type": "pong", "ts": time.time()})
                    
            elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSE):
                break
    except Exception as e:
        log.error(f"Client error: {e}")
    finally:
        log.info(f"Client disconnected: {request.remote}")
    
    return ws

# ── HTTP routes ──
async def index_handler(request):
    return web.FileResponse(STATIC_DIR / "index.html")

# ── Main ──
def main():
    log.info("🎙️ ALFIE Voice Server starting...")
    log.info(f"   STT: faster-whisper {WHISPER_MODEL} on {WHISPER_DEVICE}")
    log.info(f"   LLM: Cerebras {CEREBRAS_MODEL}")
    log.info(f"   TTS: ElevenLabs {ELEVENLABS_MODEL}")
    
    get_whisper()  # Pre-load
    
    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/", index_handler)
    app.router.add_static("/", STATIC_DIR, show_index=False)
    
    log.info(f"🟢 Starting on http://{HOST}:{PORT}")
    web.run_app(app, host=HOST, port=PORT)

if __name__ == "__main__":
    main()
