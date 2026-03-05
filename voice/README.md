# Voice Pipeline

Real-time voice communication with memory-augmented AI responses.

## Architecture

```
Browser Mic → WebSocket → VAD → faster-whisper (GPU) → LLM → TTS → Audio → Browser
                                                         ↑
                                                    Qdrant Context
                                                    (memory recall)
```

## Components

### Voice Communication Server (`server.py`)
- **aiohttp** WebSocket server serving HTML + handling bidirectional audio
- **Voice Activity Detection** for segmenting continuous audio into utterances
- **faster-whisper** (large-v3) on GPU for real-time speech-to-text
- **Memory-augmented responses**: fetches relevant context from Qdrant before LLM generation
- **ElevenLabs TTS** for natural speech output streamed back to browser
- Lazy model loading to minimize startup time

### Qwen3-TTS Server (Local TTS)
An OpenAI-compatible TTS server with streaming and voice cloning:

- **Real-time audio streaming** — yields PCM chunks as the model generates them
- **Voice library** — save/load voice profiles, auto-switch between base and custom voice models
- **Voice prompt caching** — speaker embeddings computed once, reused across requests (~0.7s savings)
- **torch.compile + CUDA graphs** — configurable optimization backend
- **GPU keepalive** — periodic matmul prevents GPU downclocking after idle (AMD DPM issue)
- **Pipecat integration** — full voice agent pipeline with WebRTC (end-to-end ~2s latency)

Supports both NVIDIA CUDA and AMD ROCm. Docker images for both.

## What Makes This Novel

1. **Memory-augmented voice** — the voice pipeline doesn't just do STT → LLM → TTS. It fetches relevant memories from the vector database before generating a response, so the agent "remembers" past conversations even in voice mode.

2. **GPU keepalive for consistent latency** — discovered that AMD's Dynamic Power Management downclocks the GPU after idle periods, spiking TTFB from 0.3s to 0.85s. A periodic dummy matmul keeps the GPU warm.

3. **Voice prompt caching** — speaker embeddings for voice cloning are expensive to compute. Cache them once per profile and reuse, cutting ~0.7s from every cloned voice request.
