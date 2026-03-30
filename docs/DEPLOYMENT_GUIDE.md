# ALFIE Deployment Guide

**Version:** 1.0.0  
**Last Updated:** February 6, 2026  
**Status:** Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Component Installation](#component-installation)
5. [Configuration](#configuration)
6. [Environment Variables](#environment-variables)
7. [Service Management](#service-management)
8. [GPU Acceleration Setup](#gpu-acceleration-setup)
9. [Monitoring & Health Checks](#monitoring--health-checks)
10. [Troubleshooting](#troubleshooting)
11. [Production Deployment](#production-deployment)

---

## Overview

ALFIE (Autonomous Learning & Functional Intelligence Engine) is a comprehensive AI assistant system featuring:

- **Multi-model consensus engine** for reliable AI responses
- **Second Brain** with 438K+ semantic memories
- **GPU-accelerated inference** with local 120B and 20B models
- **Desktop automation** capabilities
- **Real-time web dashboard** with WebSocket streaming
- **Procedural memory** that learns and improves over time

### System Components

| Component            | Description                    | Port      |
| -------------------- | ------------------------------ | --------- |
| **ALFIE Backend**    | Express.js API server          | 3001      |
| **ALFIE UI**         | Next.js web dashboard          | 3000      |
| **OpenClaw Gateway** | AI model gateway               | 8080      |
| **Qdrant**           | Vector database (Second Brain) | 6333      |
| **VLLM**             | Local GPU inference            | 8001-8002 |
| **Rasputin**         | Extended tooling (optional)    | 3000      |

---

## Prerequisites

### System Requirements

| Resource    | Minimum          | Recommended            |
| ----------- | ---------------- | ---------------------- |
| **CPU**     | 8 cores          | 16+ cores              |
| **RAM**     | 32 GB            | 64+ GB                 |
| **Storage** | 100 GB SSD       | 500+ GB NVMe           |
| **GPU**     | NVIDIA 96GB VRAM | NVIDIA 96GB+ VRAM (dual)      |
| **OS**      | Ubuntu 22.04 LTS | Ubuntu 22.04/24.04 LTS |

### Software Dependencies

```bash
# System packages
sudo apt update && sudo apt install -y \
    curl wget git build-essential \
    python3 python3-pip python3-venv \
    nodejs npm \
    xdotool scrot xclip \
    nvidia-driver-535 nvidia-cuda-toolkit

# Node.js 18+ (via nvm recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Python 3.11+
python3 --version  # Should be 3.11+

# Docker (optional, for Qdrant)
curl -fsSL https://get.docker.com | sh
```

### API Keys Required

| Service          | Purpose              | Get Key                      |
| ---------------- | -------------------- | ---------------------------- |
| **OpenRouter**   | Cloud model access   | https://openrouter.ai/keys   |
| **Perplexity**   | Real-time web search | https://perplexity.ai/api    |
| **Brave Search** | Web search fallback  | https://brave.com/search/api |

---

## Quick Start

### One-Command Setup

```bash
# Clone and setup
cd /home/admin/.openclaw/workspace
./scripts/setup.sh  # If available

# Or manual setup
npm install
pip3 install -r requirements.txt --break-system-packages

# Start all services
npm run start:all
```

### Verify Installation

```bash
# Check backend
curl http://localhost:3001/api/health

# Check UI
curl http://localhost:3000

# Check Second Brain
curl http://localhost:6333/health

# Check GPU models (if configured)
curl http://localhost:8001/v1/models
```

---

## Component Installation

### 1. ALFIE Backend

```bash
cd /home/admin/.openclaw/workspace/alfie-backend

# Install dependencies
npm install

# Initialize database
npm run db:init
npm run db:migrate

# Start server
npm start
# Or with OpenTelemetry tracing
npm run start:no-otel  # Without tracing
```

**Configuration:** Create `.env` file:

```env
# Server
PORT=3001
HOST=0.0.0.0

# Authentication
API_TOKEN=your-secure-token-here

# OpenClaw Gateway
OPENCLAW_GATEWAY_URL=http://localhost:8080
OPENCLAW_API_KEY=your-api-key

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/alfie

# Redis (optional)
REDIS_URL=redis://localhost:6379

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Workspace
WORKSPACE_ROOT=/home/admin/.openclaw/workspace
MAX_FILE_SIZE=10485760

# WebSocket
WS_HEARTBEAT_INTERVAL=30000
WS_CLIENT_TIMEOUT=60000
```

### 2. ALFIE UI

```bash
cd /home/admin/.openclaw/workspace/alfie-ui

# Install dependencies
npm install

# Development mode
npm run dev

# Production build
npm run build
npm start
```

**Configuration:** Create `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
NEXT_PUBLIC_APP_NAME=ALFIE
```

### 3. Second Brain (Qdrant)

```bash
# Option 1: Docker (recommended)
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant:latest

# Option 2: Native installation
# See https://qdrant.tech/documentation/install/

# Verify
curl http://localhost:6333/health
```

### 4. Python Components

```bash
cd /home/admin/.openclaw/workspace

# Install Python dependencies
pip3 install -r requirements.txt --break-system-packages

# Or in a virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Verify components
python3 alfie_consensus.py test
python3 alfie_multisearch.py --help
python3 alfie_verify.py --help
```

---

## Configuration

### Main Configuration Files

| File                  | Purpose                   |
| --------------------- | ------------------------- |
| `alfie-backend/.env`  | Backend API configuration |
| `alfie-ui/.env.local` | Frontend configuration    |
| `api_keys.env`        | API keys (DO NOT COMMIT)  |
| `procedures.json`     | Procedural memory storage |
| `learning/`           | Continuous learning data  |

### API Keys Setup

Create `/home/admin/.openclaw/workspace/api_keys.env`:

```env
# Required
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}

# Recommended
PERPLEXITY_API_KEY=pplx-xxxxx
BRAVE_API_KEY=BSAxxxxx

# Optional
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
OPENAI_API_KEY=sk-xxxxx
GOOGLE_API_KEY=AIzaxxxxx
```

Load keys:

```bash
source api_keys.env
# Or add to ~/.bashrc
echo 'source /home/admin/.openclaw/workspace/api_keys.env' >> ~/.bashrc
```

---

## Environment Variables

### Backend Environment Variables

| Variable                | Required | Default               | Description             |
| ----------------------- | -------- | --------------------- | ----------------------- |
| `PORT`                  | No       | 3001                  | API server port         |
| `HOST`                  | No       | 0.0.0.0               | Bind address            |
| `API_TOKEN`             | Yes      | -                     | Authentication token    |
| `OPENCLAW_GATEWAY_URL`  | Yes      | http://localhost:8080 | Gateway URL             |
| `DATABASE_URL`          | Yes      | -                     | PostgreSQL connection   |
| `WORKSPACE_ROOT`        | No       | cwd                   | File operations root    |
| `MAX_FILE_SIZE`         | No       | 10MB                  | Max upload size         |
| `WS_HEARTBEAT_INTERVAL` | No       | 30000                 | WebSocket ping interval |
| `CORS_ORIGINS`          | No       | \*                    | Allowed origins         |

### Python Environment Variables

| Variable             | Required    | Default               | Description        |
| -------------------- | ----------- | --------------------- | ------------------ |
| `OPENROUTER_API_KEY` | Yes         | -                     | Cloud model access |
| `PERPLEXITY_API_KEY` | Recommended | -                     | Real-time search   |
| `BRAVE_API_KEY`      | Recommended | -                     | Search fallback    |
| `QDRANT_URL`         | No          | http://localhost:6333 | Vector DB URL      |
| `VLLM_BASE_URL`      | No          | http://localhost:8001 | Local model URL    |

---

## Service Management

### Using systemd

Create service files for production:

**ALFIE Backend** (`/etc/systemd/system/alfie-backend.service`):

```ini
[Unit]
Description=ALFIE Backend API Server
After=network.target postgresql.service

[Service]
Type=simple
User=admin
WorkingDirectory=/home/admin/.openclaw/workspace/alfie-backend
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**ALFIE UI** (`/etc/systemd/system/alfie-ui.service`):

```ini
[Unit]
Description=ALFIE Web UI
After=network.target alfie-backend.service

[Service]
Type=simple
User=admin
WorkingDirectory=/home/admin/.openclaw/workspace/alfie-ui
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Commands:**

```bash
# Enable services
sudo systemctl enable alfie-backend alfie-ui

# Start services
sudo systemctl start alfie-backend alfie-ui

# Check status
sudo systemctl status alfie-backend alfie-ui

# View logs
journalctl -u alfie-backend -f
journalctl -u alfie-ui -f
```

### Using PM2 (Alternative)

```bash
# Install PM2
npm install -g pm2

# Start services
pm2 start alfie-backend/src/index.js --name alfie-backend
pm2 start npm --name alfie-ui -- start --prefix alfie-ui

# Save configuration
pm2 save
pm2 startup

# Monitor
pm2 monit
pm2 logs
```

---

## GPU Acceleration Setup

### VLLM Installation

```bash
# Install VLLM
pip3 install vllm --break-system-packages

# Start with 120B model
python3 -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Llama-3.3-70B-Instruct \
    --port 8001 \
    --tensor-parallel-size 2 \
    --max-model-len 8192 \
    --gpu-memory-utilization 0.85

# Start with 20B model (second GPU)
python3 -m vllm.entrypoints.openai.api_server \
    --model mistralai/Mistral-Small-3.1-24B-Instruct-2503 \
    --port 8002 \
    --gpu-memory-utilization 0.85
```

### GPU Monitoring

```bash
# Real-time monitoring
watch -n 1 nvidia-smi

# Temperature monitoring
nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader

# Memory usage
nvidia-smi --query-gpu=memory.used,memory.total --format=csv

# Use ALFIE's GPU monitor
python3 gpu_watchdog.py
```

### Cooling Optimization

```bash
# Optimize fan curves (if supported)
sudo ./cpu_cooling_optimization.sh

# Set power limit (adjust for your GPU)
sudo nvidia-smi -pl 350  # Watts
```

---

## Monitoring & Health Checks

### Health Endpoints

| Endpoint                | Description                      |
| ----------------------- | -------------------------------- |
| `GET /api/health`       | Backend health with dependencies |
| `GET /api/system/stats` | CPU, memory, uptime              |
| `GET /api/system/gpu`   | GPU utilization, temperature     |

### Example Health Check Script

```bash
#!/bin/bash
# health_check.sh

BACKEND_URL="http://localhost:3001"
UI_URL="http://localhost:3000"
QDRANT_URL="http://localhost:6333"

check_service() {
    local name=$1
    local url=$2
    local endpoint=${3:-""}

    if curl -sf "$url$endpoint" > /dev/null; then
        echo "✅ $name: OK"
        return 0
    else
        echo "❌ $name: FAILED"
        return 1
    fi
}

echo "=== ALFIE Health Check ==="
check_service "Backend API" "$BACKEND_URL" "/api/health"
check_service "Web UI" "$UI_URL"
check_service "Second Brain" "$QDRANT_URL" "/health"

# GPU check
if nvidia-smi > /dev/null 2>&1; then
    GPU_TEMP=$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader | head -1)
    echo "✅ GPU: ${GPU_TEMP}°C"
else
    echo "⚠️  GPU: Not available"
fi
```

### Logging

```bash
# Backend logs
tail -f /home/admin/.openclaw/workspace/alfie-backend/logs/app.log

# System logs
journalctl -u alfie-backend -f

# GPU logs
tail -f /home/admin/.openclaw/workspace/gpu_ultra.log

# Learning system logs
tail -f /home/admin/.openclaw/workspace/learning/events.jsonl
```

---

## Troubleshooting

### Common Issues

#### Backend won't start

```bash
# Check port availability
lsof -i :3001
kill -9 $(lsof -t -i :3001)

# Check logs
npm run dev 2>&1 | head -50

# Verify dependencies
npm install
```

#### Qdrant connection failed

```bash
# Check if running
docker ps | grep qdrant

# Restart container
docker restart qdrant

# Check logs
docker logs qdrant
```

#### GPU not detected

```bash
# Check NVIDIA driver
nvidia-smi

# Reinstall driver
sudo apt install --reinstall nvidia-driver-535

# Check CUDA
nvcc --version
```

#### Memory issues

```bash
# Check memory usage
free -h

# Clear caches
sync && echo 3 | sudo tee /proc/sys/vm/drop_caches

# Restart services
sudo systemctl restart alfie-backend alfie-ui
```

### Debug Mode

```bash
# Backend debug
DEBUG=* node alfie-backend/src/index.js

# Python debug
python3 -v alfie_consensus.py test

# WebSocket debug
wscat -c ws://localhost:3001/ws
```

---

## Production Deployment

### Pre-deployment Checklist

- [ ] All API keys configured securely
- [ ] Database migrations complete
- [ ] SSL/TLS certificates installed
- [ ] Firewall rules configured
- [ ] Monitoring alerts set up
- [ ] Backup strategy implemented
- [ ] Rate limiting enabled
- [ ] Error tracking configured (Sentry)

### Security Hardening

```bash
# Set proper permissions
chmod 600 api_keys.env
chmod 700 /home/admin/.openclaw/workspace

# Configure firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3001/tcp from 127.0.0.1
sudo ufw enable

# Use nginx reverse proxy
sudo apt install nginx
```

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/alfie
server {
    listen 80;
    server_name alfie.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d alfie.yourdomain.com
```

---

## Support

### Resources

- **Documentation:** `/home/admin/.openclaw/workspace/docs/`
- **API Reference:** `http://localhost:3001/api/docs`
- **Architecture:** See `ARCHITECTURE.md`
- **Features:** See `FEATURE_LIST.md`

### Getting Help

1. Check logs: `journalctl -u alfie-backend -f`
2. Review configuration files
3. Run health checks
4. Check this deployment guide

---

**Document Maintained By:** ALFIE Documentation System  
**Version:** 1.0.0  
**Status:** Production Ready
