"""
Rasputin Voice Pipeline — Ultimate Setup
=========================================
Pipecat pipeline: Browser mic → WebRTC → Silero VAD → Local Whisper (GPU) → 
                  Claude Opus 4.6 (Claude Max $0) → Qwen3-TTS (GPU) → Speaker

All local except the LLM brain (Opus via subscription = $0 per call).
"""

import os
import sys
import yaml
import asyncio
from typing import AsyncGenerator
from pathlib import Path
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    ErrorFrame, Frame, TTSAudioRawFrame, TTSStartedFrame, TTSStoppedFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.runner.types import SmallWebRTCRunnerArguments
from pipecat.services.anthropic.llm import AnthropicLLMService
from pipecat.services.openai.tts import OpenAITTSService, VALID_VOICES
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport


# ── Load environment ──
def load_env():
    env_file = Path.home() / ".openclaw" / "workspace" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

load_env()


# ── Load Anthropic token from OpenClaw auth profiles ──
def get_anthropic_token() -> str:
    """Read the Claude Max subscription token from OpenClaw's auth-profiles.json."""
    import json
    auth_file = Path.home() / ".openclaw" / "agents" / "main" / "agent" / "auth-profiles.json"
    if auth_file.exists():
        data = json.loads(auth_file.read_text())
        profiles = data.get("profiles", {})
        # Prefer the manual subscription token
        if "anthropic:manual" in profiles:
            return profiles["anthropic:manual"].get("token", "")
        # Fallback to default API key
        if "anthropic:default" in profiles:
            return profiles["anthropic:default"].get("key", "")
    # Fallback to environment
    return os.environ.get("ANTHROPIC_API_KEY", "")


# ── Streaming TTS for Qwen3-TTS ──
class StreamingQwenTTSService(OpenAITTSService):
    """OpenAI-compatible TTS that sends stream=true for real-time PCM chunk delivery."""

    def __init__(self, *, chunk_seconds: float = 0.3, **kwargs):
        super().__init__(**kwargs)
        self._chunk_seconds = chunk_seconds

    @property
    def chunk_size(self) -> int:
        return int(self.sample_rate * self._chunk_seconds * 2)

    async def run_tts(self, text: str) -> AsyncGenerator[Frame, None]:
        logger.debug(f"TTS generating: [{text[:80]}...]")
        try:
            from openai import BadRequestError
            await self.start_ttfb_metrics()

            async with self._client.audio.speech.with_streaming_response.create(
                input=text,
                model=self.model_name,
                voice=self._voice_id,
                response_format="pcm",
                extra_body={"stream": True},
            ) as r:
                if r.status_code != 200:
                    error = await r.text()
                    logger.error(f"TTS error (status: {r.status_code}, error: {error})")
                    yield ErrorFrame(error=f"TTS error (status: {r.status_code})")
                    return

                await self.start_tts_usage_metrics(text)
                yield TTSStartedFrame()
                async for chunk in r.iter_bytes(self.chunk_size):
                    if len(chunk) > 0:
                        await self.stop_ttfb_metrics()
                        yield TTSAudioRawFrame(chunk, self.sample_rate, 1)
                yield TTSStoppedFrame()
        except BadRequestError as e:
            yield ErrorFrame(error=f"TTS error: {e}")
        except Exception as e:
            logger.error(f"TTS unexpected error: {e}")
            yield ErrorFrame(error=f"TTS error: {e}")


# ── Load config ──
config_path = Path(__file__).parent / "config.yaml"
with open(config_path) as f:
    cfg = yaml.safe_load(f)

logger.info(f"Config loaded: LLM={cfg['llm']['model']}, TTS voice={cfg['tts']['voice']}")

# Register custom voice names
voice_name = cfg["tts"]["voice"]
if voice_name not in VALID_VOICES:
    VALID_VOICES[voice_name] = voice_name


# ── Bot entry point ──
async def bot(args: SmallWebRTCRunnerArguments):
    """Main bot pipeline — called by Pipecat's SmallWebRTC runner."""

    audio_cfg = cfg.get("audio", {})
    agent_cfg = cfg["agent"]

    # -- Transport: WebRTC --
    transport = SmallWebRTCTransport(
        webrtc_connection=args.webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_out_sample_rate=audio_cfg.get("out_sample_rate", 24000),
            audio_out_10ms_chunks=audio_cfg.get("out_10ms_chunks", 2),
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(
                    min_volume=agent_cfg["vad_min_volume"],
                    stop_secs=agent_cfg["vad_stop_secs"],
                )
            ),
        ),
    )

    # -- STT: Local Whisper on GPU --
    stt_cfg = cfg["stt"]
    _lang_map = {
        "en": Language.EN, "ru": Language.RU, "de": Language.DE,
        "fr": Language.FR, "es": Language.ES, "pt": Language.PT,
        "it": Language.IT, "ja": Language.JA, "ko": Language.KO,
        "zh": Language.ZH,
    }
    stt = WhisperSTTService(
        model=stt_cfg.get("model", "large-v3-turbo"),
        device=stt_cfg.get("device", "cuda"),
        compute_type=stt_cfg.get("compute_type", "float16"),
        language=_lang_map.get(stt_cfg.get("language", "en"), Language.EN),
        no_speech_prob=0.4,
    )

    # -- LLM: Claude Opus 4.6 via Claude Max subscription --
    anthropic_token = get_anthropic_token()
    if not anthropic_token:
        logger.error("No Anthropic token found! Check auth-profiles.json")
        return

    llm = AnthropicLLMService(
        api_key=anthropic_token,
        model=cfg["llm"]["model"],
        max_tokens=cfg["llm"].get("max_tokens", 1024),
        temperature=cfg["llm"].get("temperature", 0.7),
    )

    # -- TTS: Qwen3-TTS on GPU0 (streaming) --
    tts_cfg = cfg["tts"]
    if tts_cfg.get("streaming", False):
        tts = StreamingQwenTTSService(
            api_key="not-needed",
            base_url=tts_cfg["base_url"],
            voice=tts_cfg["voice"],
            model=tts_cfg["model"],
            sample_rate=tts_cfg["sample_rate"],
            chunk_seconds=tts_cfg.get("chunk_seconds", 0.3),
        )
    else:
        tts = OpenAITTSService(
            api_key="not-needed",
            base_url=tts_cfg["base_url"],
            voice=tts_cfg["voice"],
            model=tts_cfg["model"],
            sample_rate=tts_cfg["sample_rate"],
        )

    # -- Context with system prompt --
    messages = [
        {"role": "system", "content": agent_cfg["system_prompt"]},
    ]
    context = OpenAILLMContext(messages=messages)
    context_aggregator = llm.create_context_aggregator(context)

    # -- Pipeline: STT → LLM → TTS --
    pipeline = Pipeline(
        [
            transport.input(),       # WebRTC audio in
            stt,                     # Whisper transcription
            context_aggregator.user(),
            llm,                     # Claude Opus 4.6
            tts,                     # Qwen3-TTS
            transport.output(),      # WebRTC audio out
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=agent_cfg.get("allow_interruptions", True),
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"🎤 Client connected: {client}")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info(f"🔇 Client disconnected: {client}")
        await task.queue_frames([])

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)


if __name__ == "__main__":
    from pipecat.runner.run import main
    main()
