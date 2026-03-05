#!/usr/bin/env node
// Rasputin Nexus — Backend Server v2.0 (Production Hardened)
// Zero dependencies. Built-in Node.js only.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile } = require('child_process');
const LatencyTracker = require('./latency-tracker.js');
const LatencyAlerter = require('./latency-alerts.js');
const ModelLeaderboard = require('./model-leaderboard.js');
const ErrorTracker = require('./error-tracker.js');
const {
  calculateEnhancedForecast,
  getCachedForecast,
  updateBudgetSettings,
  getBudgetSettings,
} = require('./cost-forecast-enhanced.js');
const MemoryHeatmap = require('./memory-heatmap.js');
const MemoryAccessTracker = require('./memory-access-tracker.js');
const SessionAutopsy = require('./session-autopsy.js');
const WebhookManager = require('./webhook-manager.js');
const SessionExporter = require('./session-exporter.js');
const SessionReports = require('./session-reports.js');
const SessionRecipes = require('./session-recipes.js');
const ManusBackend = require('./manus-backend.js');
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (_) {
  console.warn('puppeteer not installed');
}

// ─── Browser Sessions ─────────────────────────────────────────────────────────
const browserSessions = new Map(); // sessionId → { browser, page, createdAt }
const MAX_BROWSER_SESSIONS = 3;

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.ALFIE_PORT || '9001', 10);
const SECRET = process.env.ALFIE_DASH_SECRET || 'rasputin-neural-2026';
const SESSION_DIR = '/home/admin/.openclaw/agents/main/sessions';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CHAT_LOG = path.join(__dirname, 'chat_history.jsonl');
// ─── Performance-Optimized Telemetry Intervals ────────────────────────────────
const TELEMETRY_INTERVAL_FAST = 2000; // Fast updates (system metrics, /proc)
const TELEMETRY_INTERVAL_MEDIUM = 5000; // GPU stats (nvidia-smi is expensive)
const TELEMETRY_INTERVAL_SLOW = 15000; // Docker/PM2 (slow-changing)
const SESSION_ACTIVE_THRESHOLD = 5 * 60 * 1000;
const WS_PING_INTERVAL = 30000;
const MAX_CONNECTIONS = 100;
const MAX_AUTH_ATTEMPTS_PER_MIN = 50; // Increased: localhost has many dashboard tabs + gateway bridge
const KEY_DIR = path.join(process.env.HOME || '/root', '.alfie-nexus', 'keys');

// Load API keys from .env (logging functions not available yet, so just silent fail)
let ELEVENLABS_API_KEY = null;
let ANTHROPIC_API_KEY = null;
let OPENROUTER_API_KEY = null;
let XAI_API_KEY = null;
try {
  const envPath = path.join(process.env.HOME || '/root', '.openclaw', 'workspace', '.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  const getKey = (k) => { const m = envFile.match(new RegExp(`${k}=(.+)`)); return m ? m[1].trim() : null; };
  ELEVENLABS_API_KEY = getKey('ELEVENLABS_API_KEY');
  ANTHROPIC_API_KEY = getKey('ANTHROPIC_API_KEY');
  OPENROUTER_API_KEY = getKey('OPENROUTER_API_KEY');
  XAI_API_KEY = getKey('XAI_API_KEY');
} catch (e) {
  // Silent - will log later when logWarn is available
}

// ─── Multi-Provider Model Registry (replaces LiteLLM) ────────────────────────
const PLAYGROUND_MODELS = [
  // Anthropic (native API)
  { id: 'claude-opus-4-6', owned_by: 'anthropic', provider: 'anthropic', apiModel: 'claude-opus-4-6' },
  { id: 'claude-sonnet-4-5', owned_by: 'anthropic', provider: 'anthropic', apiModel: 'claude-sonnet-4-5' },
  // OpenRouter
  { id: 'google/gemini-3-pro', owned_by: 'google', provider: 'openrouter', apiModel: 'google/gemini-3-pro' },
  { id: 'google/gemini-3-flash-preview', owned_by: 'google', provider: 'openrouter', apiModel: 'google/gemini-3-flash-preview' },
  { id: 'openai/gpt-5.2', owned_by: 'openai', provider: 'openrouter', apiModel: 'openai/gpt-5.2' },
  { id: 'deepseek/deepseek-r1', owned_by: 'deepseek', provider: 'openrouter', apiModel: 'deepseek/deepseek-r1' },
  // xAI
  { id: 'grok-4-1-fast', owned_by: 'xai', provider: 'xai', apiModel: 'grok-4-1-fast-non-reasoning' },
  // Local models via operator-proxy (routes to llama-server instances)
  { id: 'qwen3.5-122b-a10b', owned_by: 'local', provider: 'operator-proxy', apiModel: 'qwen3.5-122b-a10b' },
  { id: 'qwen3-coder:30b', owned_by: 'local', provider: 'operator-proxy', apiModel: 'qwen3-coder:30b' },
];

function callPlaygroundModel(modelId, messages, maxTokens, temperature) {
  const modelDef = PLAYGROUND_MODELS.find((m) => m.id === modelId);
  if (!modelDef) return Promise.resolve({ text: '', usage: {}, error: `Unknown model: ${modelId}` });

  const start = Date.now();

  if (modelDef.provider === 'anthropic') {
    // Route through operator-proxy (localhost:8080) for OAuth/Zen failover
    return new Promise((resolve) => {
      const payload = JSON.stringify({
        model: modelDef.apiModel,
        messages,
        max_tokens: maxTokens,
        temperature,
      });
      const req2 = http.request(
        {
          hostname: 'localhost',
          port 8080,
          path: '/v1/messages',
          method: 'POST',
          timeout: 120000,
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res2) => {
          let d = '';
          res2.on('data', (c) => (d += c));
          res2.on('end', () => {
            const elapsed = Date.now() - start;
            try {
              const j = JSON.parse(d);
              if (j.error) return resolve({ text: '', elapsed, usage: {}, error: j.error.message || JSON.stringify(j.error) });
              const text = (j.content || []).map((b) => b.text || '').join('');
              const usage = { prompt_tokens: j.usage?.input_tokens, completion_tokens: j.usage?.output_tokens };
              resolve({ text, elapsed, usage, error: null });
            } catch (e) {
              resolve({ text: '', elapsed, usage: {}, error: d.slice(0, 200) });
            }
          });
        }
      );
      req2.on('error', (e) => resolve({ text: '', elapsed: Date.now() - start, usage: {}, error: e.message }));
      req2.on('timeout', () => { req2.destroy(); resolve({ text: '', elapsed: Date.now() - start, usage: {}, error: 'timeout' }); });
      req2.write(payload);
      req2.end();
    });
  }

  // operator-proxy local models — route through proxy's Anthropic-format endpoint
  if (modelDef.provider === 'operator-proxy') {
    return new Promise((resolve) => {
      const payload = JSON.stringify({
        model: modelDef.apiModel,
        messages,
        max_tokens: Math.max(maxTokens, 16),
        temperature,
      });
      const req2 = http.request(
        {
          hostname: 'localhost',
          port 8080,
          path: '/v1/messages',
          method: 'POST',
          timeout: 120000,
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res2) => {
          let d = '';
          res2.on('data', (c) => (d += c));
          res2.on('end', () => {
            const elapsed = Date.now() - start;
            try {
              const j = JSON.parse(d);
              if (j.error) return resolve({ text: '', elapsed, usage: {}, error: j.error.message || JSON.stringify(j.error) });
              const text = (j.content || []).map((b) => b.text || '').join('');
              const usage = { prompt_tokens: j.usage?.input_tokens, completion_tokens: j.usage?.output_tokens };
              resolve({ text, elapsed, usage, error: null });
            } catch (e) {
              resolve({ text: '', elapsed, usage: {}, error: d.slice(0, 200) });
            }
          });
        }
      );
      req2.on('error', (e) => resolve({ text: '', elapsed: Date.now() - start, usage: {}, error: e.message }));
      req2.on('timeout', () => { req2.destroy(); resolve({ text: '', elapsed: Date.now() - start, usage: {}, error: 'timeout' }); });
      req2.write(payload);
      req2.end();
    });
  }

  // OpenAI-compatible providers (OpenRouter, xAI, Ollama)
  const providerConfig = {
    openrouter: { hostname: 'openrouter.ai', port: 443, path: '/api/v1/chat/completions', key: OPENROUTER_API_KEY, tls: true },
    xai: { hostname: 'api.x.ai', port: 443, path: '/v1/chat/completions', key: XAI_API_KEY, tls: true },
    ollama: { hostname: 'localhost', port: 11434, path: '/v1/chat/completions', key: 'ollama', tls: false },
  }[modelDef.provider];

  if (!providerConfig) return Promise.resolve({ text: '', usage: {}, error: `No provider config for ${modelDef.provider}` });

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: modelDef.apiModel,
      messages,
      max_tokens: Math.max(maxTokens, 16), // Some providers (GPT-5.2) require min 16
      temperature,
    });
    const httpMod = providerConfig.tls ? https : http;
    const req2 = httpMod.request(
      {
        hostname: providerConfig.hostname,
        port: providerConfig.port,
        path: providerConfig.path,
        method: 'POST',
        timeout: 120000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${providerConfig.key}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res2) => {
        let d = '';
        res2.on('data', (c) => (d += c));
        res2.on('end', () => {
          const elapsed = Date.now() - start;
          try {
            const j = JSON.parse(d);
            if (j.error) return resolve({ text: '', elapsed, usage: {}, error: j.error.message || JSON.stringify(j.error) });
            const text = j.choices?.[0]?.message?.content || '';
            const usage = j.usage || {};
            resolve({ text, elapsed, usage, error: null });
          } catch (e) {
            resolve({ text: '', elapsed, usage: {}, error: d.slice(0, 200) });
          }
        });
      }
    );
    req2.on('error', (e) => resolve({ text: '', elapsed: Date.now() - start, usage: {}, error: e.message }));
    req2.on('timeout', () => { req2.destroy(); resolve({ text: '', elapsed: Date.now() - start, usage: {}, error: 'timeout' }); });
    req2.write(payload);
    req2.end();
  });
}

// ─── Google OAuth 2.0 Config ──────────────────────────────────────────────────
let GOOGLE_CLIENT_ID = null;
let GOOGLE_CLIENT_SECRET = null;
let GOOGLE_JWT_SECRET = null;
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || 'https://dash.rasputin.to/auth/google/callback';
const WHITELISTED_EMAILS = ['admin@operator.com']; // Only these emails can authenticate

try {
  const envPath = path.join(
    process.env.HOME || '/root',
    '.openclaw',
    'workspace',
    'alfie-dashboard',
    '.env'
  );
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    const getEnv = (key) => {
      const match = envFile.match(new RegExp(`${key}=(.+)`));
      return match ? match[1].trim() : null;
    };
    GOOGLE_CLIENT_ID = getEnv('GOOGLE_CLIENT_ID');
    GOOGLE_CLIENT_SECRET = getEnv('GOOGLE_CLIENT_SECRET');
    GOOGLE_JWT_SECRET = getEnv('GOOGLE_JWT_SECRET');
  }
} catch (e) {
  // Silent - will log later
}

// ─── State ────────────────────────────────────────────────────────────────────
const clients = new Set();
const authedClients = new Set();
const clientMeta = new WeakMap(); // socket → { ip, authed, lastPong }
let currentSessionFile = null;
let sessionFileOffset = 0;
let sessionWatcher = null;
let dirWatcher = null;
let messageCount = 0;
let toolCallCount = 0;
// Latency tracking
const latencyTracker = new LatencyTracker();
const latencyAlerter = new LatencyAlerter();
const modelLeaderboard = new ModelLeaderboard();
// Error tracking
const errorTracker = new ErrorTracker();
// Memory heatmap
const memoryHeatmap = new MemoryHeatmap();
// Memory access tracker (tracks which memories are accessed most frequently)
const memoryAccessTracker = new MemoryAccessTracker();
// Session autopsy (automatic post-session analysis)
const sessionAutopsy = new SessionAutopsy();
// Session export (Markdown/JSON export for sharing)
const sessionExporter = new SessionExporter();
// Session recipes (save successful sessions as templates)
const sessionRecipes = new SessionRecipes();
// Session reports (full analysis + sharing)
const sessionReports = new SessionReports(sessionExporter, sessionAutopsy);
// Connect webhook manager to error tracker
errorTracker.setWebhookManager(WebhookManager);
let currentMessageId = null;
// Persist costs across restarts
const COST_FILE = path.join(__dirname, '.total_cost.json');
const COST_HISTORY_FILE = path.join(__dirname, '.cost_history.json');
let totalCost = 0;
let lifetimeCost = 0;
let costHistory = []; // Array of {ts, cost, delta}
try {
  const s = JSON.parse(fs.readFileSync(COST_FILE, 'utf8'));
  lifetimeCost = s.lifetimeCost || 0;
  totalCost = s.sessionCost || 0;
} catch (_e) {}
try {
  costHistory = JSON.parse(fs.readFileSync(COST_HISTORY_FILE, 'utf8')) || [];
} catch (_e) {}
function saveCosts() {
  try {
    fs.writeFileSync(
      COST_FILE,
      JSON.stringify({ lifetimeCost, sessionCost: totalCost, lastSaved: Date.now() })
    );
  } catch (_e) {}
}
function saveCostHistory() {
  try {
    // Keep only last 30 days of hourly samples
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    costHistory = costHistory.filter((e) => e.ts > thirtyDaysAgo);
    fs.writeFileSync(COST_HISTORY_FILE, JSON.stringify(costHistory));
  } catch (_e) {}
}
setInterval(saveCosts, 30000);
// Sample cost every hour for forecasting
let lastCostSample = lifetimeCost;
setInterval(
  () => {
    const delta = lifetimeCost - lastCostSample;
    costHistory.push({ ts: Date.now(), cost: lifetimeCost, delta });
    lastCostSample = lifetimeCost;
    saveCostHistory();
  },
  60 * 60 * 1000
); // Every hour
let detectedModel = 'unknown';
let serverStartTime = Date.now();

// Rate limiting: ip → { attempts, resetAt }
const authAttempts = new Map();

// Encryption state
let serverIdentityKeyPair = null;
let serverEphemeralKeyPair = null;

// ─── Knowledge Base Directory Scanner ─────────────────────────────────────────
function scanDir(dirPath, pattern, maxDepth, depth) {
  const results = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (entry.isDirectory() && depth < maxDepth) {
          const children = scanDir(fullPath, null, maxDepth, depth + 1);
          if (children.length > 0) {
            results.push({
              name: entry.name,
              type: 'dir',
              size: 0,
              modified: stat.mtimeMs,
              children,
            });
          }
        } else if (entry.isFile()) {
          if (pattern && !pattern.test(entry.name)) continue;
          results.push({ name: entry.name, type: 'file', size: stat.size, modified: stat.mtimeMs });
        }
      } catch (_) {}
    }
  } catch (_) {}
  results.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
  );
  return results;
}

// ─── Structured Logging ───────────────────────────────────────────────────────
function log(level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, msg, ...meta };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}
const logInfo = (msg, meta) => log('info', msg, meta);
const logWarn = (msg, meta) => log('warn', msg, meta);
const logErr = (msg, meta) => log('error', msg, meta);

// ─── MIME Types ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.map': 'application/json',
};

const COMPRESSIBLE = new Set([
  'text/html',
  'text/css',
  'application/javascript',
  'application/json',
  'image/svg+xml',
  'text/plain',
]);

function isCompressible(contentType) {
  for (const t of COMPRESSIBLE) {
    if (contentType.startsWith(t)) return true;
  }
  return false;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────
function checkAuthRate(ip) {
  const now = Date.now();
  let entry = authAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { attempts: 0, resetAt: now + 60000 };
    authAttempts.set(ip, entry);
  }
  entry.attempts++;
  return entry.attempts <= MAX_AUTH_ATTEMPTS_PER_MIN;
}

// Clean stale rate limit entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authAttempts) {
    if (now > entry.resetAt) authAttempts.delete(ip);
  }
}, 300000);

// ─── Minimal WebSocket (RFC 6455) ─────────────────────────────────────────────
function computeAccept(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  // Sanity: reject frames > 16MB
  if (payloadLen > 16 * 1024 * 1024) return { error: 'frame_too_large' };

  let mask = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.slice(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + payloadLen) return null;
  const data = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    data[i] = buf[offset + i] ^ (mask ? mask[i % 4] : 0);
  }

  return { fin, opcode, data, totalLen: offset + payloadLen };
}

function encodeFrame(data, opcode = 0x01) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsSend(socket, data) {
  if (socket.writable && !socket.destroyed) {
    try {
      socket.write(encodeFrame(data));
    } catch (_) {}
  }
}

function wsClose(socket, code = 1000, reason = '') {
  try {
    const reasonBuf = Buffer.from(reason, 'utf8');
    const buf = Buffer.alloc(2 + reasonBuf.length);
    buf.writeUInt16BE(code, 0);
    reasonBuf.copy(buf, 2);
    socket.write(encodeFrame(buf, 0x08));
    socket.end();
  } catch (_) {}
}

function cleanupSocket(socket) {
  clients.delete(socket);
  authedClients.delete(socket);
  clientMeta.delete(socket);
}

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of authedClients) {
    try {
      wsSend(ws, msg);
    } catch (_) {}
  }
}

// ─── WebSocket Ping/Pong Keepalive ────────────────────────────────────────────
const pingInterval = setInterval(() => {
  const now = Date.now();
  for (const socket of clients) {
    const meta = clientMeta.get(socket);
    if (!meta) continue;
    // If no pong received since last ping, kill it
    if (meta.lastPing && !meta.lastPong) {
      logWarn('WebSocket timeout, closing', { ip: meta.ip });
      wsClose(socket, 1001, 'ping timeout');
      cleanupSocket(socket);
      continue;
    }
    meta.lastPing = now;
    meta.lastPong = false;
    try {
      socket.write(encodeFrame(Buffer.alloc(0), 0x09)); // ping
    } catch (_) {
      cleanupSocket(socket);
    }
  }
}, WS_PING_INTERVAL);

// ─── WebSocket Connection Handler ─────────────────────────────────────────────
function handleWsConnection(socket, ip) {
  if (clients.size >= MAX_CONNECTIONS) {
    logWarn('Max connections reached, rejecting', { ip });
    wsClose(socket, 1013, 'max connections');
    return;
  }

  clients.add(socket);
  clientMeta.set(socket, {
    ip,
    authed: false,
    lastPong: true,
    lastPing: null,
    connectedAt: Date.now(),
  });
  logInfo('WebSocket connected', { ip, total: clients.size });

  let buffer = Buffer.alloc(0);
  let fragments = [];

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      const frame = decodeFrame(buffer);
      if (!frame) break;
      if (frame.error) {
        logWarn('Bad frame, closing', { ip, error: frame.error });
        wsClose(socket, 1009, frame.error);
        cleanupSocket(socket);
        return;
      }
      buffer = buffer.slice(frame.totalLen);

      if (frame.opcode === 0x08) {
        // close
        const code = frame.data.length >= 2 ? frame.data.readUInt16BE(0) : 1000;
        logInfo('WebSocket close received', { ip, code });
        cleanupSocket(socket);
        wsClose(socket, code);
        return;
      }
      if (frame.opcode === 0x09) {
        // ping from client
        socket.write(encodeFrame(frame.data, 0x0a));
        continue;
      }
      if (frame.opcode === 0x0a) {
        // pong
        const meta = clientMeta.get(socket);
        if (meta) meta.lastPong = true;
        continue;
      }

      if (frame.opcode === 0x00) {
        fragments.push(frame.data);
        if (frame.fin) {
          const full = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          handleMessage(socket, full);
        }
      } else {
        if (!frame.fin) {
          fragments = [frame.data];
        } else {
          handleMessage(socket, frame.data.toString('utf8'));
        }
      }
    }
  });

  socket.on('close', () => {
    logInfo('WebSocket disconnected', { ip });
    cleanupSocket(socket);
  });
  socket.on('error', (e) => {
    logErr('WebSocket error', { ip, error: e.message });
    cleanupSocket(socket);
  });
}

function handleMessage(socket, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (_) {
    return;
  }
  if (!msg || !msg.type) return;

  const meta = clientMeta.get(socket);
  const ip = meta?.ip || 'unknown';

  switch (msg.type) {
    case 'auth': {
      if (msg.secret === SECRET) {
        authedClients.add(socket);
        if (meta) meta.authed = true;
        wsSend(socket, JSON.stringify({ type: 'auth', status: 'ok' }));
        logInfo('Client authenticated', { ip, total: authedClients.size });
      } else {
        // Only rate-limit failed auth attempts
        if (!checkAuthRate(ip)) {
          wsSend(socket, JSON.stringify({ type: 'auth', status: 'rate_limited' }));
          logWarn('Auth rate limited', { ip });
          return;
        }
        wsSend(socket, JSON.stringify({ type: 'auth', status: 'denied' }));
        logWarn('Auth denied', { ip });
      }
      break;
    }

    case 'chat_message':
      if (!authedClients.has(socket)) return;
      handleChat(msg);
      break;

    case 'voice_message':
      if (!authedClients.has(socket)) return;
      // Treat voice messages as chat messages (transcribed text)
      handleChat({ text: msg.text, from: msg.from || 'voice' });
      break;

    case 'file_upload':
      if (!authedClients.has(socket)) return;
      handleFileUpload(socket, msg);
      break;

    case 'chunked_init':
      if (!authedClients.has(socket)) return;
      handleChunkedInit(socket, msg);
      break;

    case 'chunked_data':
      if (!authedClients.has(socket)) return;
      handleChunkedData(socket, msg);
      break;

    case 'chunked_finish':
      if (!authedClients.has(socket)) return;
      handleChunkedFinish(socket, msg);
      break;

    case 'ping':
      wsSend(socket, JSON.stringify({ type: 'pong', ts: Date.now() }));
      break;

    // Encryption handshake messages
    case 'crypto_hello':
      if (!authedClients.has(socket)) return;
      handleCryptoHello(socket, msg);
      break;

    case 'crypto_handshake_complete':
      if (!authedClients.has(socket)) return;
      handleCryptoHandshakeComplete(socket, msg);
      break;

    case 'crypto_rotate':
      if (!authedClients.has(socket)) return;
      handleCryptoRotate(socket);
      break;

    // ━━━ NEXT-GEN CHAT PROTOCOL ━━━
    case 'thinking_start':
      if (!authedClients.has(socket)) return;
      broadcast({ type: 'thinking_start', sender: msg.sender || 'Rasputin' });
      break;

    case 'thinking_end':
      if (!authedClients.has(socket)) return;
      broadcast({ type: 'thinking_end', sender: msg.sender || 'Rasputin' });
      break;

    case 'message_chunk':
      if (!authedClients.has(socket)) return;
      broadcast({ type: 'message_chunk', content: msg.content, messageId: msg.messageId });
      break;

    case 'artifact':
      if (!authedClients.has(socket)) return;
      broadcast({
        type: 'artifact',
        title: msg.title,
        content: msg.content,
        artifactType: msg.artifactType,
      });
      break;

    case 'widget':
      if (!authedClients.has(socket)) return;
      broadcast({
        type: 'widget',
        title: msg.title,
        description: msg.description,
        action: msg.action,
        payload: msg.payload,
        buttonText: msg.buttonText,
      });
      break;
  }
}

// ─── Chat Relay ───────────────────────────────────────────────────────────────
function handleChat(msg) {
  const entry = {
    ts: Date.now(),
    text: (msg.text || '').slice(0, 4096),
    from: (msg.from || 'anon').slice(0, 64),
  };
  try {
    fs.appendFileSync(CHAT_LOG, JSON.stringify(entry) + '\n');
  } catch (e) {
    logErr('Chat log write failed', { error: e.message });
  }
  broadcast({ type: 'chat_message', ...entry });

  // Forward to OpenClaw via gateway wake + save to inbox
  const text = (msg.text || '').trim();
  if (text) {
    // Save to inbox file
    const inboxPath = path.join(__dirname, 'chat_inbox.jsonl');
    const entry = JSON.stringify({ ts: Date.now(), text, from: 'dashboard' });
    try {
      fs.appendFileSync(inboxPath, entry + '\n');
    } catch (_) {}

    // Forward to Rasputin via openclaw system event (official CLI method)
    const { exec } = require('child_process');
    const escapedText = text.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
    exec(
      `openclaw system event --mode now --text "[Dashboard Chat] ${escapedText}" --token 64f1359b68351e9da05916f380c6ad26f94f4c9fb0592b30`,
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          logErr('OpenClaw system event failed', {
            error: err.message,
            stderr: (stderr || '').slice(0, 200),
          });
        } else {
          logInfo('Chat forwarded via openclaw system event', { textLen: text.length });
        }
      }
    );
  }
}

// ─── File Upload (supports huge files via chunked + single-shot) ──────────────
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB max
const activeChunkedUploads = new Map(); // uploadId → { name, chunks, totalSize, received }

function humanSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
  if (bytes < 0000000000) return (bytes / 1048576).toFixed(1) + 'MB';
  return (bytes / 0000000000).toFixed(2) + 'GB';
}

function detectFileType(name, buf) {
  const ext = path.extname(name).toLowerCase();
  const extMap = {
    // Documents
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.py': 'text/x-python',
    '.sh': 'text/x-shellscript',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.toml': 'text/toml',
    '.ini': 'text/ini',
    '.log': 'text/plain',
    '.sql': 'text/x-sql',
    '.rs': 'text/x-rust',
    '.go': 'text/x-go',
    // Images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    // Audio/Video
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.m4a': 'audio/mp4',
    // Archives
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.7z': 'application/x-7z-compressed',
    '.rar': 'application/vnd.rar',
    '.bz2': 'application/x-bzip2',
    // Data
    '.sqlite': 'application/x-sqlite3',
    '.db': 'application/x-sqlite3',
    '.parquet': 'application/vnd.apache.parquet',
  };
  // Magic byte detection for common types
  if (buf && buf.length >= 4) {
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
      return 'application/pdf';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
      return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      if (ext === '.docx') return extMap['.docx'];
      if (ext === '.xlsx') return extMap['.xlsx'];
      if (ext === '.pptx') return extMap['.pptx'];
      return 'application/zip';
    }
    if (buf[0] === 0x1f && buf[1] === 0x8b) return 'application/gzip';
    if (
      buf.slice(0, 4).toString() === 'RIFF' &&
      buf.length >= 12 &&
      buf.slice(8, 12).toString() === 'WEBP'
    )
      return 'image/webp';
  }
  return extMap[ext] || 'application/octet-stream';
}

// Single-shot upload (legacy + small files)
function handleFileUpload(socket, msg) {
  try {
    if (!msg.name || !msg.data) throw new Error('Missing name or data');
    const safeName = path.basename(msg.name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(UPLOADS_DIR, `${Date.now()}-${safeName}`);
    const buf = Buffer.from(msg.data, 'base64');
    if (buf.length > MAX_FILE_SIZE)
      throw new Error(`File too large (max ${humanSize(MAX_FILE_SIZE)})`);
    fs.writeFileSync(filePath, buf);
    const mime = detectFileType(safeName, buf);
    const resp = {
      type: 'file_uploaded',
      name: safeName,
      url: `/uploads/${path.basename(filePath)}`,
      size: buf.length,
      mime,
      humanSize: humanSize(buf.length),
    };
    wsSend(socket, JSON.stringify(resp));
    broadcast({
      type: 'file_shared',
      name: safeName,
      url: resp.url,
      size: buf.length,
      mime,
      humanSize: humanSize(buf.length),
    });
    logInfo('File uploaded', { name: safeName, size: buf.length, mime });
  } catch (e) {
    wsSend(socket, JSON.stringify({ type: 'error', message: 'Upload failed: ' + e.message }));
  }
}

// Chunked upload — init
function handleChunkedInit(socket, msg) {
  try {
    if (!msg.name || !msg.totalSize) throw new Error('Missing name or totalSize');
    if (msg.totalSize > MAX_FILE_SIZE)
      throw new Error(`File too large (max ${humanSize(MAX_FILE_SIZE)})`);
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const safeName = path.basename(msg.name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(UPLOADS_DIR, `${uploadId}-${safeName}`);
    activeChunkedUploads.set(uploadId, {
      name: safeName,
      filePath,
      totalSize: msg.totalSize,
      received: 0,
      fd: fs.openSync(filePath, 'w'),
    });
    wsSend(socket, JSON.stringify({ type: 'chunked_ready', uploadId, name: safeName }));
    logInfo('Chunked upload started', {
      uploadId,
      name: safeName,
      totalSize: humanSize(msg.totalSize),
    });
  } catch (e) {
    wsSend(socket, JSON.stringify({ type: 'error', message: 'Chunked init failed: ' + e.message }));
  }
}

// Chunked upload — receive chunk
function handleChunkedData(socket, msg) {
  try {
    const upload = activeChunkedUploads.get(msg.uploadId);
    if (!upload) throw new Error('Unknown uploadId');
    const buf = Buffer.from(msg.data, 'base64');
    fs.writeSync(upload.fd, buf, 0, buf.length, upload.received);
    upload.received += buf.length;
    const pct = Math.round((upload.received / upload.totalSize) * 100);
    wsSend(
      socket,
      JSON.stringify({
        type: 'chunked_progress',
        uploadId: msg.uploadId,
        received: upload.received,
        total: upload.totalSize,
        pct,
      })
    );
  } catch (e) {
    wsSend(socket, JSON.stringify({ type: 'error', message: 'Chunk write failed: ' + e.message }));
  }
}

// Chunked upload — finalize
function handleChunkedFinish(socket, msg) {
  try {
    const upload = activeChunkedUploads.get(msg.uploadId);
    if (!upload) throw new Error('Unknown uploadId');
    fs.closeSync(upload.fd);
    activeChunkedUploads.delete(msg.uploadId);
    // Detect type from first bytes
    const headerBuf = Buffer.alloc(16);
    const fd2 = fs.openSync(upload.filePath, 'r');
    fs.readSync(fd2, headerBuf, 0, 16, 0);
    fs.closeSync(fd2);
    const mime = detectFileType(upload.name, headerBuf);
    const url = `/uploads/${path.basename(upload.filePath)}`;
    const resp = {
      type: 'file_uploaded',
      name: upload.name,
      url,
      size: upload.received,
      mime,
      humanSize: humanSize(upload.received),
    };
    wsSend(socket, JSON.stringify(resp));
    broadcast({
      type: 'file_shared',
      name: upload.name,
      url,
      size: upload.received,
      mime,
      humanSize: humanSize(upload.received),
    });
    logInfo('Chunked upload complete', {
      name: upload.name,
      size: humanSize(upload.received),
      mime,
    });
  } catch (e) {
    wsSend(
      socket,
      JSON.stringify({ type: 'error', message: 'Chunked finish failed: ' + e.message })
    );
  }
}

// ─── Encryption Handshake Preparation ─────────────────────────────────────────
async function initServerCryptoKeys() {
  try {
    fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
    // Generate ECDH identity keypair (P-256) using Node crypto
    const identityPath = path.join(KEY_DIR, 'identity.json');
    if (fs.existsSync(identityPath)) {
      const data = JSON.parse(fs.readFileSync(identityPath, 'utf-8'));
      serverIdentityKeyPair = crypto.createECDH('prime256v1');
      serverIdentityKeyPair.setPrivateKey(Buffer.from(data.priv, 'base64'));
      logInfo('Loaded server identity key', { fingerprint: data.fingerprint });
    } else {
      serverIdentityKeyPair = crypto.createECDH('prime256v1');
      serverIdentityKeyPair.generateKeys();
      const pub = serverIdentityKeyPair.getPublicKey('base64');
      const priv = serverIdentityKeyPair.getPrivateKey('base64');
      const fingerprint = crypto
        .createHash('sha256')
        .update(serverIdentityKeyPair.getPublicKey())
        .digest('hex')
        .slice(0, 32);
      fs.writeFileSync(identityPath, JSON.stringify({ pub, priv, fingerprint }), { mode: 0o600 });
      logInfo('Generated new server identity key', { fingerprint });
    }
    // Generate ephemeral key
    serverEphemeralKeyPair = crypto.createECDH('prime256v1');
    serverEphemeralKeyPair.generateKeys();
    logInfo('Server crypto keys initialized');
  } catch (e) {
    logErr('Crypto key init failed', { error: e.message });
  }
}

function handleCryptoHello(socket, msg) {
  if (!serverIdentityKeyPair || !serverEphemeralKeyPair) {
    wsSend(socket, JSON.stringify({ type: 'crypto_error', msg: 'Server crypto not ready' }));
    return;
  }
  wsSend(
    socket,
    JSON.stringify({
      type: 'crypto_server_hello',
      ikPub: serverIdentityKeyPair.getPublicKey('base64'),
      ekPub: serverEphemeralKeyPair.getPublicKey('base64'),
    })
  );
  logInfo('Crypto hello sent to client');
}

function handleCryptoHandshakeComplete(socket, msg) {
  try {
    if (!msg.ikPub || !msg.ekPub) throw new Error('Missing client keys');
    const clientEkBuf = Buffer.from(msg.ekPub, 'base64');
    // Compute DH shared secret (ephemeral × client ephemeral)
    const sharedSecret = serverEphemeralKeyPair.computeSecret(clientEkBuf);
    // Derive session ID from shared secret
    const sessionId = crypto
      .createHmac('sha256', sharedSecret)
      .update('Rasputin-Nexus-v1-session-id')
      .digest('hex')
      .slice(0, 32);
    wsSend(
      socket,
      JSON.stringify({
        type: 'crypto_session_established',
        sessionId,
      })
    );
    // Rotate ephemeral key for next handshake
    serverEphemeralKeyPair = crypto.createECDH('prime256v1');
    serverEphemeralKeyPair.generateKeys();
    logInfo('Crypto session established', { sessionId });
  } catch (e) {
    wsSend(socket, JSON.stringify({ type: 'crypto_error', msg: e.message }));
    logErr('Crypto handshake failed', { error: e.message });
  }
}

function handleCryptoRotate(socket) {
  serverEphemeralKeyPair = crypto.createECDH('prime256v1');
  serverEphemeralKeyPair.generateKeys();
  wsSend(
    socket,
    JSON.stringify({
      type: 'crypto_rotate_keys',
      ekPub: serverEphemeralKeyPair.getPublicKey('base64'),
    })
  );
  logInfo('Crypto key rotation');
}

// ─── Session Tailing ──────────────────────────────────────────────────────────
function findLatestSession() {
  try {
    const files = fs
      .readdirSync(SESSION_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        try {
          return { name: f, mtime: fs.statSync(path.join(SESSION_DIR, f)).mtimeMs };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? path.join(SESSION_DIR, files[0].name) : null;
  } catch (e) {
    logErr('Session scan failed', { error: e.message });
    return null;
  }
}

function parseSessionLine(line) {
  try {
    const raw = JSON.parse(line);
    const ts = raw.timestamp || raw.ts || Date.now();

    // OpenClaw JSONL wraps messages in a .message envelope
    const obj = raw.message || raw;

    // Model detection
    if (obj.model) detectedModel = obj.model;
    if (raw.message?.model) detectedModel = raw.message.model;
    if (obj.metadata?.model) detectedModel = obj.metadata.model;

    // Cost tracking from usage data (OpenClaw provides pre-calculated costs)
    const usage = obj.usage || raw.usage;
    if (usage) {
      const cost = usage.cost?.total || 0;
      if (cost > 0) {
        totalCost += cost;
        lifetimeCost += cost;
      } else {
        // Fallback: calculate from token counts
        const inputCost = ((usage.input || usage.input_tokens || 0) / 1000000) * 15;
        const outputCost = ((usage.output || usage.output_tokens || 0) / 1000000) * 75;
        const cacheCost = ((usage.cacheRead || 0) / 1000000) * 0.5;
        const estimated = inputCost + outputCost + cacheCost;
        totalCost += estimated;
        lifetimeCost += estimated;
      }
      // Broadcast token usage event

      // Record model interaction for leaderboard
      if (detectedModel && detectedModel !== 'unknown') {
        modelLeaderboard.recordInteraction(detectedModel, {
          cost: usage.cost?.total || 0,
          latency: currentMessageId ? Date.now() - ts : 0,
          tokens: usage.totalTokens || (usage.input || 0) + (usage.output || 0),
        });
      }
      broadcast({
        type: 'token_usage',
        ts,
        input: usage.input || usage.input_tokens || 0,
        output: usage.output || usage.output_tokens || 0,
        cacheRead: usage.cacheRead || 0,
        total: usage.totalTokens || (usage.input || 0) + (usage.output || 0),
        cost: usage.cost?.total || 0,
        totalCost: Math.round(totalCost * 10000) / 10000,
        lifetimeCost: Math.round(lifetimeCost * 10000) / 10000,
        model: obj.model || detectedModel,
      });
    }

    // Assistant message with text content
    if (obj.role === 'assistant' && obj.content) {
      const content = obj.content;
      const texts = [];
      const tools = [];

      if (Array.isArray(content)) {
        for (const block of content) {
          // Thinking/reasoning blocks
          if (block.type === 'thinking' && block.thinking) {
            broadcast({
              type: 'thinking',
              ts,
              text: block.thinking,
              model: obj.model || detectedModel,
            });
          }
          if (block.type === 'text' && block.text) texts.push(block.text);
          if (block.type === 'tool_use' || block.type === 'toolCall') {
            const toolInput = block.input || block.arguments || {};
            tools.push({ name: block.name, input: toolInput, id: block.id });

            // Detect sub-agent spawns
            if (block.name === 'sessions_spawn') {
              const args = toolInput;
              broadcast({
                type: 'agent_update',
                action: 'spawn',
                id: block.id,
                label: args.label || 'sub-agent',
                task: (args.task || '').slice(0, 120),
                ts,
              });
            }
          }
        }
      } else if (typeof content === 'string') {
        texts.push(content);
      }

      // Emit tool calls with smart descriptions
      if (tools.length > 0) {
        toolCallCount += tools.length;
        // Broadcast each tool call
        for (const t of tools) {
          const smartDesc = generateSmartToolDescription(t.name, t.input);
          broadcast({
            type: 'tool_call',
            ts,
            tool: t.name,
            input: t.input,
            id: t.id,
            description: smartDesc,
          });
        }
      }

      // Emit text content — filter out gibberish (JSON blobs, code dumps, raw tool output)
      if (texts.length > 0) {
        const combined = texts.join('\n');
        // Skip if it looks like raw JSON, code, tool output, or system noise
        const isGibberish =
          (/^\s*[\[{]/.test(combined) && /[\]}]\s*$/.test(combined.trim())) || // JSON blob
          /^\s*(│|┌|├|└|─)/.test(combined) || // table/box drawing
          /^\[PM2\]/.test(combined) || // pm2 output
          /^(HTTP\/|curl |grep |cat |tail )/.test(combined) || // command output
          combined.includes('__OPENCLAW_REDACTED__') || // config dumps
          (/^\s*```/.test(combined) && combined.length > 500); // large code blocks
        if (!isGibberish) {
          messageCount++;
          // Record first token time (TTFT)
          if (currentMessageId) {
            latencyTracker.recordFirstToken(currentMessageId);
          }
          return { type: 'token_stream', ts, text: combined, role: 'assistant' };
        }
      }

      // If only tools, already broadcasted above
      if (tools.length > 0) return null;
    }

    // Tool result (handles both 'tool' and 'toolResult' roles)
    if (obj.role === 'tool' || obj.role === 'toolResult' || raw.type === 'tool_result') {
      const result =
        typeof obj.content === 'string'
          ? obj.content
          : Array.isArray(obj.content)
            ? obj.content.map((b) => b.text || '').join('')
            : JSON.stringify(obj.content || '').slice(0, 200);

      // Detect sub-agent spawn confirmations
      if (obj.toolName === 'sessions_spawn' && obj.details?.status === 'accepted') {
        broadcast({
          type: 'agent_update',
          action: 'confirmed',
          id: obj.toolCallId,
          sessionKey: obj.details.childSessionKey,
          ts,
        });
      }

      return {
        type: 'tool_result',
        ts,
        toolCallId: obj.toolCallId || obj.tool_use_id || obj.id || raw.id,
        toolName: obj.toolName,
        status: 'completed',
        result: result?.slice(0, 300),
      };
    }

    // User message — only show actual human messages, not system/forwarded noise
    if (obj.role === 'user' || obj.role === 'human') {
      const text =
        typeof obj.content === 'string'
          ? obj.content
          : Array.isArray(obj.content)
            ? obj.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('')
            : '';
      if (text) {
        // Skip system injections, heartbeats, queued announces, compaction flushes
        const isSystem =
          /^\[.*GMT[+-]\d\].*\[Queued announce/.test(text) ||
          /^Pre-compaction memory flush/.test(text) ||
          /^Read HEARTBEAT\.md/.test(text) ||
          /\[Dashboard Chat\]/.test(text) ||
          text.startsWith('A subagent task "');
        if (!isSystem) {
          // Extract clean user text from Telegram-style prefix
          const cleanMatch = text.match(/\[Telegram.*?\]\s*(.*)/s);
          let cleanText = cleanMatch ? cleanMatch[1] : text;
          // Strip [message_id: XXXX] and media attachment headers
          cleanText = cleanText
            .replace(/\[message_id:\s*\d+\]\s*/g, '')
            .replace(/\[media attached:.*?\]\n?/gs, '')
            .trim();
          messageCount++;
          // Start latency tracking for this message
          currentMessageId = `msg-${ts}-${Math.random().toString(36).slice(2, 9)}`;
          latencyTracker.startRequest(currentMessageId);
          return {
            type: 'user_message',
            ts,
            text: cleanText.slice(0, 2000),
            messageId: currentMessageId,
          };
        }
      }
    }

    return null;
  } catch (_) {
    return null;
  }
}

// ─── OpenClaw Gateway WebSocket Bridge ───────────────────────────────────────
const WebSocket = require('ws');

const OPENCLAW_TOKEN = '64f1359b68351e9da05916f380c6ad26f94f4c9fb0592b30';
const OPENCLAW_PASSWORD = 'alfie-gateway-2026';
const GATEWAY_WS_URL = 'ws://127.0.0.1:18789';

let gatewayWs = null;
let gatewayReconnectDelay = 1000; // Start at 1s
let gatewayReconnectTimer = null;
let gatewayAuthenticated = false;
let streamingMessageId = null;

function smartToolDescription(tool, input) {
  // Generate concise descriptions for common tools
  if (tool === 'read') return `Reading ${input?.file_path || 'file'}`;
  if (tool === 'write') return `Writing ${input?.file_path || 'file'}`;
  if (tool === 'edit') return `Editing ${input?.file_path || 'file'}`;
  if (tool === 'exec') return `Running: ${input?.command || 'command'}`;
  if (tool === 'web_search') return `Searching: ${input?.query || 'web'}`;
  if (tool === 'web_fetch') return `Fetching ${input?.url || 'URL'}`;
  if (tool === 'browser') return `Browser: ${input?.action || 'action'}`;
  if (tool === 'message') return `Message: ${input?.action || 'action'}`;
  return `Tool: ${tool}`;
}

function connectToGateway() {
  if (gatewayWs && (gatewayWs.readyState === WebSocket.CONNECTING || gatewayWs.readyState === WebSocket.OPEN)) {
    return; // Already connecting or connected
  }

  logInfo('Connecting to OpenClaw Gateway', { url: GATEWAY_WS_URL });
  
  gatewayWs = new WebSocket(GATEWAY_WS_URL);
  gatewayAuthenticated = false;

  gatewayWs.on('open', () => {
    logInfo('Gateway WebSocket connected');
    gatewayReconnectDelay = 1000; // Reset backoff on successful connection
  });

  gatewayWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Handle connect.challenge → send auth
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        const authReq = {
          type: 'req',
          id: `auth-${Date.now()}`,
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'gateway-client',
              version: '2.0.0',
              platform: 'node',
              mode: 'backend',
            },
            caps: ['tool-events'],
            auth: {
              token: OPENCLAW_TOKEN,
              password: OPENCLAW_PASSWORD,
            },
            role: 'operator',
            scopes: ['operator.admin'],
          },
        };
        gatewayWs.send(JSON.stringify(authReq));
        logInfo('Sent authentication request');
        return;
      }

      // Handle auth response
      if (msg.type === 'res' && msg.id && msg.id.startsWith('auth-')) {
        if (msg.ok) {
          gatewayAuthenticated = true;
          logInfo('Gateway authentication successful');
        } else {
          logErr('Gateway authentication failed', { error: msg.error });
          gatewayWs.close();
        }
        return;
      }

      // Only process events if authenticated
      if (!gatewayAuthenticated) return;

      // Map gateway events to dashboard broadcasts
      if (msg.type === 'event') {
        const ts = Date.now();
        
        // Debug: log all gateway events (remove after confirmed working)
        if (msg.event === 'agent') {
          const p = msg.payload || msg;
          logInfo('Gateway agent event', { stream: p.stream, phase: p.data?.phase, name: p.data?.name, hasText: !!p.data?.text });
        }

        if (msg.event === 'agent') {
          // Gateway wraps agent events in payload: { runId, stream, data, sessionKey, seq }
          const payload = msg.payload || msg;
          const stream = payload.stream;
          const data = payload.data || {};

          // assistant → token_stream (text streaming)
          if (stream === 'assistant' && data.text) {
            if (!streamingMessageId) {
              streamingMessageId = payload.runId || `msg-${ts}`;
              broadcast({ type: 'streaming_start', ts, messageId: streamingMessageId });
            }
            broadcast({
              type: 'token_stream',
              text: data.text,
              delta: data.delta,
              role: 'assistant',
              ts,
              messageId: streamingMessageId,
            });
          }

          // thinking → thinking
          else if (stream === 'thinking' && data.text) {
            broadcast({ type: 'thinking', text: data.text, ts });
          }

          // tool → forward ALL phases (start, update, result, end, error)
          else if (stream === 'tool') {
            const phase = data.phase || 'start';
            const toolCallId = data.toolCallId;

            if (phase === 'start' && data.name) {
              broadcast({
                type: 'tool_start',
                tool: data.name,
                input: data.args || data.input || {},
                id: toolCallId,
                description: smartToolDescription(data.name, data.args || data.input || {}),
                ts,
              });
              // Track file modifications for FILES panel
              if (data.name === 'write' || data.name === 'edit') {
                const fp = (data.args || data.input || {})?.file_path || (data.args || data.input || {})?.path || '';
                if (fp) broadcast({ type: 'file_modified', path: fp, action: data.name, ts });
              }
            }

            if (phase === 'update' && data.partialResult) {
              broadcast({
                type: 'tool_output',
                id: toolCallId,
                text: typeof data.partialResult === 'string' ? data.partialResult : JSON.stringify(data.partialResult).slice(0, 2000),
                partial: true,
                ts,
              });
            }

            if (phase === 'result') {
              const resultText = data.meta || data.result || '';
              broadcast({
                type: 'tool_result',
                id: toolCallId,
                text: typeof resultText === 'string' ? resultText : JSON.stringify(resultText).slice(0, 4000),
                ts,
              });
            }

            if (phase === 'end') {
              broadcast({ type: 'tool_end', id: toolCallId, ts });
            }

            if (phase === 'error' || data.isError) {
              broadcast({
                type: 'tool_error',
                id: toolCallId,
                text: data.error || data.meta || 'Tool call failed',
                ts,
              });
            }
          }

          // lifecycle → streaming_end on phase=end
          else if (stream === 'lifecycle' && data.phase === 'end') {
            if (streamingMessageId) {
              broadcast({ type: 'streaming_end', ts, messageId: streamingMessageId });
              streamingMessageId = null;
            }
          }

          // error stream
          else if (stream === 'error') {
            broadcast({ type: 'agent_error', data, ts });
          }
        }

        // chat events (delta/final for message delivery)
        else if (msg.event === 'chat') {
          const payload = msg.payload || msg;
          if (payload.state === 'final') {
            if (streamingMessageId) {
              broadcast({ type: 'streaming_end', ts, messageId: streamingMessageId });
              streamingMessageId = null;
            }
            // Also broadcast the final message text if present
            const text = payload.message?.content?.[0]?.text;
            if (text) {
              broadcast({ type: 'chat_final', text, sessionKey: payload.sessionKey, ts });
            }
          }
        }

        // health → broadcast channel/session status to Manus
        else if (msg.event === 'health') {
          const h = msg.payload;
          if (h) {
            broadcast({
              type: 'openclaw:health',
              channels: h.channels,
              agents: h.agents,
              sessions: h.sessions,
              ts,
            });
          }
        }
      }
    } catch (e) {
      logWarn('Failed to parse gateway message', { error: e.message });
    }
  });

  gatewayWs.on('error', (err) => {
    logWarn('Gateway WebSocket error', { error: err.message });
  });

  gatewayWs.on('close', () => {
    logWarn('Gateway WebSocket closed, reconnecting...', { delay: gatewayReconnectDelay });
    gatewayAuthenticated = false;
    
    // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s max
    if (gatewayReconnectTimer) clearTimeout(gatewayReconnectTimer);
    gatewayReconnectTimer = setTimeout(() => {
      connectToGateway();
    }, gatewayReconnectDelay);

    gatewayReconnectDelay = Math.min(gatewayReconnectDelay * 2, 30000);
  });
}

function startGatewayBridge() {
  connectToGateway();
  startSessionTailer(); // Hybrid: tail JSONL for tool events the WS bridge can't get
  startCoderStreamTailer(); // Tail live coder output for Code pane
}

// ─── Coder Stream Tailer (live code output from Qwen3-Coder) ─────────────────
const CODER_STREAM_LOG = '/tmp/coder-stream.log';
let coderStreamOffset = 0;
let coderStreamWatcher = null;
let coderStreamDebounce = null;

function readCoderStream() {
  try {
    const stat = fs.statSync(CODER_STREAM_LOG);
    if (stat.size <= coderStreamOffset) return;
    const fd = fs.openSync(CODER_STREAM_LOG, 'r');
    const buf = Buffer.alloc(stat.size - coderStreamOffset);
    fs.readSync(fd, buf, 0, buf.length, coderStreamOffset);
    fs.closeSync(fd);
    coderStreamOffset = stat.size;
    const text = buf.toString('utf-8');
    if (text.trim()) {
      logInfo('Coder stream chunk', { bytes: text.length, clients: authedClients.size });
      broadcast({ type: 'coder_stream', text, ts: Date.now() });
    }
  } catch (_) {}
}

function startCoderStreamTailer() {
  // Reset offset on start
  try { coderStreamOffset = fs.statSync(CODER_STREAM_LOG).size; } catch (_) { coderStreamOffset = 0; }

  // Watch for changes
  const watchDir = path.dirname(CODER_STREAM_LOG);
  const watchFile = path.basename(CODER_STREAM_LOG);
  try {
    // Use interval-based polling since /tmp files might not trigger fs.watch reliably
    setInterval(() => {
      try {
        const stat = fs.statSync(CODER_STREAM_LOG);
        if (stat.size > coderStreamOffset) readCoderStream();
        // Reset offset if file was truncated (new coding session)
        if (stat.size < coderStreamOffset) { coderStreamOffset = 0; readCoderStream(); }
      } catch (_) {}
    }, 300); // Poll every 300ms for near-real-time
    logInfo('Coder stream tailer started', { file: CODER_STREAM_LOG });
  } catch (e) {
    logWarn('Coder stream tailer failed to start', { error: e.message });
  }
}

// ─── Session JSONL Tailer (for tool events) ──────────────────────────────────
// Uses fs.watch() for near-instant event delivery + periodic scan for new sessions
const sessionTails = new Map(); // filepath → { offset, watcher, debounceTimer }
const MAX_TAILED_SESSIONS = 8;
const SESSION_SCAN_INTERVAL_MS = 5000; // Check for new session files every 5s
const WATCH_DEBOUNCE_MS = 50; // Debounce rapid fs.watch() events

function getActiveSessionFiles() {
  try {
    return fs.readdirSync(SESSION_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const fp = path.join(SESSION_DIR, f);
        try { return { path: fp, mtime: fs.statSync(fp).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_TAILED_SESSIONS)
      .map(f => f.path);
  } catch { return []; }
}

function parseToolEventsFromLine(line) {
  try {
    const obj = JSON.parse(line);
    const msg = obj.message;
    if (!msg || !msg.content || !Array.isArray(msg.content)) return [];
    
    const events = [];
    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : (msg.timestamp || Date.now());
    
    for (const c of msg.content) {
      if (!c || typeof c !== 'object') continue;
      
      // Tool calls from assistant (JSONL uses 'arguments' not 'input')
      if (c.type === 'toolCall' && c.name) {
        const input = c.arguments || c.input || {};
        events.push({
          type: 'tool_start',
          tool: c.name,
          input,
          id: c.id,
          description: smartToolDescription(c.name, input),
          ts,
        });
        // Track file modifications
        if (c.name === 'write' || c.name === 'edit') {
          const fp = input.file_path || input.path || '';
          if (fp) events.push({ type: 'file_modified', path: fp, action: c.name, ts });
        }
      }
      
      // Tool results — correlation ID is msg.toolCallId, output in msg.details.aggregated or c.text
      if (msg.role === 'toolResult') {
        const toolCallId = msg.toolCallId || c.toolUseId || obj.parentId;
        const resultText = msg.details?.aggregated || (c.type === 'text' ? c.text : '') || '';
        if (resultText) {
          events.push({
            type: 'tool_result',
            id: toolCallId,
            tool: msg.toolName,
            text: typeof resultText === 'string' ? resultText.slice(0, 4000) : JSON.stringify(resultText).slice(0, 4000),
            isError: msg.isError || false,
            ts,
          });
          // Also emit tool_end for the completed tool
          events.push({ type: 'tool_end', id: toolCallId, ts });
        }
        break; // Only one result per toolResult message
      }
    }
    return events;
  } catch { return []; }
}

function readNewDataFromFile(fp) {
  const info = sessionTails.get(fp);
  if (!info) return;
  
  try {
    const stat = fs.statSync(fp);
    if (stat.size <= info.offset) return; // No new data
    
    const fd = fs.openSync(fp, 'r');
    const buf = Buffer.alloc(stat.size - info.offset);
    fs.readSync(fd, buf, 0, buf.length, info.offset);
    fs.closeSync(fd);
    info.offset = stat.size;
    
    const lines = buf.toString('utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      const events = parseToolEventsFromLine(line);
      for (const evt of events) {
        broadcast(evt);
      }
    }
  } catch (e) {
    logWarn('Session tail read error', { file: path.basename(fp), error: e.message });
  }
}

function watchSessionFile(fp) {
  if (sessionTails.has(fp)) return; // Already watching
  
  try {
    const size = fs.statSync(fp).size;
    const info = { offset: size, watcher: null, debounceTimer: null };
    
    // Set up fs.watch() for near-instant change detection
    info.watcher = fs.watch(fp, { persistent: false }, (eventType) => {
      if (eventType !== 'change') return;
      // Debounce: batch rapid writes into a single read
      if (info.debounceTimer) clearTimeout(info.debounceTimer);
      info.debounceTimer = setTimeout(() => {
        info.debounceTimer = null;
        readNewDataFromFile(fp);
      }, WATCH_DEBOUNCE_MS);
    });
    
    info.watcher.on('error', (err) => {
      logWarn('Session watcher error', { file: path.basename(fp), error: err.message });
      unwatchSessionFile(fp);
    });
    
    sessionTails.set(fp, info);
    logInfo('Session tailer watching (fs.watch)', { file: path.basename(fp) });
  } catch (e) {
    logWarn('Failed to watch session file', { file: path.basename(fp), error: e.message });
  }
}

function unwatchSessionFile(fp) {
  const info = sessionTails.get(fp);
  if (!info) return;
  if (info.watcher) { try { info.watcher.close(); } catch {} }
  if (info.debounceTimer) clearTimeout(info.debounceTimer);
  sessionTails.delete(fp);
}

function refreshWatchedSessions() {
  const activeFiles = new Set(getActiveSessionFiles());
  
  // Stop watching files that are no longer in the top N
  for (const fp of sessionTails.keys()) {
    if (!activeFiles.has(fp)) {
      unwatchSessionFile(fp);
      logInfo('Session tailer unwatched', { file: path.basename(fp) });
    }
  }
  
  // Start watching new active files
  for (const fp of activeFiles) {
    watchSessionFile(fp);
  }
}

function startSessionTailer() {
  refreshWatchedSessions();
  // Periodically check for new/rotated session files
  setInterval(refreshWatchedSessions, SESSION_SCAN_INTERVAL_MS);
  logInfo('Session JSONL tailer started', { mode: 'fs.watch', scanInterval: SESSION_SCAN_INTERVAL_MS + 'ms', maxSessions: MAX_TAILED_SESSIONS });
}

// ─── GPU Telemetry ────────────────────────────────────────────────────────────
function getGpuMetrics() {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      [
        '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw',
        '--format=csv,noheader,nounits',
      ],
      { timeout: 3000 },
      (err, stdout) => {
        if (err) return resolve([]);
        const gpus = stdout
          .trim()
          .split('\n')
          .map((line, i) => {
            const [name, util, memUsed, memTotal, temp, power] = line
              .split(',')
              .map((s) => s.trim());
            return {
              id: i,
              name,
              utilization: parseFloat(util) || 0,
              memoryUsed: parseInt(memUsed) || 0,
              memoryTotal: parseInt(memTotal) || 0,
              temperature: parseInt(temp) || 0,
              powerDraw: parseFloat(power) || 0,
            };
          });
        resolve(gpus);
      }
    );
  });
}

// ─── NVTOP Data (GPU Process Monitor) ─────────────────────────────────────────
function getNvtopData() {
  return new Promise((resolve) => {
    // Get GPU processes
    execFile(
      'nvidia-smi',
      [
        '--query-compute-apps=pid,process_name,used_gpu_memory,gpu_uuid',
        '--format=csv,noheader,nounits',
      ],
      { timeout: 3000 },
      (err, stdout) => {
        const processes = [];
        if (!err && stdout.trim()) {
          stdout
            .trim()
            .split('\n')
            .forEach((line) => {
              const [pid, name, mem, uuid] = line.split(',').map((s) => s.trim());
              processes.push({
                pid: parseInt(pid) || 0,
                name: name || 'unknown',
                memory: parseInt(mem) || 0,
                gpu_uuid: uuid || '',
              });
            });
        }

        // Get detailed GPU metrics
        execFile(
          'nvidia-smi',
          [
            '--query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.gr,clocks.mem',
            '--format=csv,noheader,nounits',
          ],
          { timeout: 3000 },
          (err2, stdout2) => {
            const gpus = [];
            if (!err2 && stdout2.trim()) {
              stdout2
                .trim()
                .split('\n')
                .forEach((line) => {
                  const [
                    idx,
                    name,
                    util,
                    memUtil,
                    memUsed,
                    memTotal,
                    temp,
                    power,
                    powerLimit,
                    fan,
                    clockGr,
                    clockMem,
                  ] = line.split(',').map((s) => s.trim());
                  gpus.push({
                    index: parseInt(idx) || 0,
                    name: (name || '').replace('NVIDIA ', '').replace(' Workstation Edition', ''),
                    utilization: parseFloat(util) || 0,
                    memUtilization: parseFloat(memUtil) || 0,
                    memoryUsed: parseInt(memUsed) || 0,
                    memoryTotal: parseInt(memTotal) || 0,
                    temperature: parseInt(temp) || 0,
                    powerDraw: parseFloat(power) || 0,
                    powerLimit: parseFloat(powerLimit) || 0,
                    fanSpeed: parseInt(fan) || 0,
                    clockGraphics: parseInt(clockGr) || 0,
                    clockMemory: parseInt(clockMem) || 0,
                  });
                });
            }
            resolve({ processes, gpus });
          }
        );
      }
    );
  });
}

// ─── Services Status (Docker + PM2) ───────────────────────────────────────────
function getServicesStatus() {
  return new Promise((resolve) => {
    const services = { docker: [], pm2: [] };

    // Get Docker containers
    execFile(
      'docker',
      ['ps', '--all', '--format', '{{.Names}}\t{{.Status}}'],
      { timeout: 3000 },
      (err, stdout) => {
        if (!err && stdout.trim()) {
          stdout
            .trim()
            .split('\n')
            .forEach((line) => {
              const [name, status] = line.split('\t');
              const healthy =
                status.toLowerCase().includes('up') && !status.toLowerCase().includes('unhealthy');
              const restarting = status.toLowerCase().includes('restarting');
              services.docker.push({
                name: name.trim(),
                status: status.trim(),
                healthy: restarting ? 'restarting' : healthy ? 'running' : 'stopped',
              });
            });
        }

        // Get PM2 services
        execFile('pm2', ['jlist'], { timeout: 3000 }, (err2, stdout2) => {
          if (!err2 && stdout2.trim()) {
            try {
              const procs = JSON.parse(stdout2);
              procs.forEach((p) => {
                const status = p.pm2_env?.status || 'unknown';
                const uptime = p.pm2_env?.pm_uptime
                  ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000)
                  : 0;
                services.pm2.push({
                  name: p.name,
                  status: status,
                  healthy:
                    status === 'online'
                      ? 'running'
                      : status === 'stopping' || status === 'launching'
                        ? 'restarting'
                        : 'stopped',
                  uptime: uptime,
                });
              });
            } catch (_) {}
          }
          resolve(services);
        });
      }
    );
  });
}

// ─── TOP Data (System Process Monitor) ───────────────────────────────────────
function getTopData() {
  return new Promise((resolve) => {
    // Get top processes by CPU
    execFile('ps', ['aux', '--sort=-%cpu'], { timeout: 3000 }, (err, stdout) => {
      const processes = [];
      if (!err && stdout.trim()) {
        const lines = stdout.trim().split('\n').slice(1, 16); // Skip header, take top 15
        lines.forEach((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 11) {
            processes.push({
              user: parts[0],
              pid: parseInt(parts[1]) || 0,
              cpu: parseFloat(parts[2]) || 0,
              mem: parseFloat(parts[3]) || 0,
              vsz: parseInt(parts[4]) || 0,
              rss: parseInt(parts[5]) || 0,
              tty: parts[6],
              stat: parts[7],
              start: parts[8],
              time: parts[9],
              command: parts.slice(10).join(' ').slice(0, 100),
            });
          }
        });
      }

      // Get system info
      let loadAvg = [0, 0, 0];
      let uptime = 0;
      let memTotal = 0;
      let memFree = 0;
      let memAvailable = 0;
      let memBuffers = 0;
      let memCached = 0;
      let cpuCount = 0;

      try {
        const loadStr = fs.readFileSync('/proc/loadavg', 'utf8');
        loadAvg = loadStr.split(' ').slice(0, 3).map(parseFloat);
      } catch (_) {}

      try {
        uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
      } catch (_) {}

      try {
        const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
        const get = (key) => {
          const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
          return m ? parseInt(m[1]) : 0;
        };
        memTotal = get('MemTotal');
        memFree = get('MemFree');
        memAvailable = get('MemAvailable');
        memBuffers = get('Buffers');
        memCached = get('Cached');
      } catch (_) {}

      try {
        cpuCount = require('os').cpus().length;
      } catch (_) {}

      // Count process states
      let totalProcs = 0;
      let runningProcs = 0;
      let sleepingProcs = 0;

      try {
        const statFiles = fs.readdirSync('/proc').filter((f) => /^\d+$/.test(f));
        totalProcs = statFiles.length;
        statFiles.forEach((pid) => {
          try {
            const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
            const state = stat.split(' ')[2];
            if (state === 'R') runningProcs++;
            else if (state === 'S') sleepingProcs++;
          } catch (_) {}
        });
      } catch (_) {}

      resolve({
        processes,
        system: {
          loadAvg,
          uptime,
          cpuCount,
          memory: {
            total: memTotal,
            free: memFree,
            available: memAvailable,
            used: memTotal - memAvailable,
            buffers: memBuffers,
            cached: memCached,
          },
          processCount: {
            total: totalProcs,
            running: runningProcs,
            sleeping: sleepingProcs,
          },
        },
      });
    });
  });
}

// ─── System Metrics ───────────────────────────────────────────────────────────
function getSystemMetrics() {
  const result = {
    ram: 0,
    cpu: 0,
    disk: 0,
    network: 0,
    memTotal: 0,
    memAvailable: 0,
    memUsed: 0,
    loadAvg: [0, 0, 0],
    uptime: 0,
  };
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (key) => {
      const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1]) * 1024 : 0;
    };
    result.memTotal = get('MemTotal');
    result.memAvailable = get('MemAvailable');
    result.memUsed = result.memTotal - result.memAvailable;
    result.ram = result.memTotal > 0 ? Math.round((result.memUsed / result.memTotal) * 100) : 0;
  } catch (_) {}
  try {
    const load = fs.readFileSync('/proc/loadavg', 'utf8').split(' ');
    result.loadAvg = load.slice(0, 3).map(parseFloat);
    // CPU % approximation: load avg / num CPUs * 100
    const numCpus = require('os').cpus().length;
    result.cpu = Math.min(100, Math.round((result.loadAvg[0] / numCpus) * 100));
  } catch (_) {}
  try {
    result.uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  } catch (_) {}
  // Disk usage
  try {
    const { execSync } = require('child_process');
    const df = execSync('df /home --output=pcent | tail -1', { timeout: 2000 }).toString().trim();
    result.disk = parseInt(df) || 0;
  } catch (_) {}
  // Network throughput (bytes/sec from /proc/net/dev)
  try {
    const net = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = net
      .split('\n')
      .filter((l) => l.includes('eno') || l.includes('eth') || l.includes('wlan'));
    let totalBytes = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      totalBytes += parseInt(parts[1] || 0) + parseInt(parts[9] || 0);
    }
    // Store for delta calculation
    const now = Date.now();
    if (getSystemMetrics._lastNet) {
      const dt = (now - getSystemMetrics._lastNet.ts) / 1000;
      if (dt > 0)
        result.network =
          Math.round(((totalBytes - getSystemMetrics._lastNet.bytes) / dt / 1024 / 1024) * 10) / 10;
      if (result.network < 0) result.network = 0;
    }
    getSystemMetrics._lastNet = { bytes: totalBytes, ts: now };
    // Separate rx/tx
    let rxBytes = 0,
      txBytes = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      rxBytes += parseInt(parts[1] || 0);
      txBytes += parseInt(parts[9] || 0);
    }
    if (getSystemMetrics._lastNetDetail) {
      const dt = (now - getSystemMetrics._lastNetDetail.ts) / 1000;
      if (dt > 0) {
        result.netRx =
          Math.round(((rxBytes - getSystemMetrics._lastNetDetail.rx) / dt / 1024) * 10) / 10; // KB/s
        result.netTx =
          Math.round(((txBytes - getSystemMetrics._lastNetDetail.tx) / dt / 1024) * 10) / 10;
        if (result.netRx < 0) result.netRx = 0;
        if (result.netTx < 0) result.netTx = 0;
      }
    }
    getSystemMetrics._lastNetDetail = { rx: rxBytes, tx: txBytes, ts: now };
  } catch (_) {}
  // Disk I/O from /proc/diskstats
  try {
    const diskstats = fs.readFileSync('/proc/diskstats', 'utf8');
    const nvme = diskstats.split('\n').find((l) => l.includes('nvme0n1 ') || l.includes('sda '));
    if (nvme) {
      const p = nvme.trim().split(/\s+/);
      const sectorsRead = parseInt(p[5] || 0);
      const sectorsWritten = parseInt(p[9] || 0);
      const now2 = Date.now();
      if (getSystemMetrics._lastDisk) {
        const dt = (now2 - getSystemMetrics._lastDisk.ts) / 1000;
        if (dt > 0) {
          result.diskReadMBs =
            Math.round(
              (((sectorsRead - getSystemMetrics._lastDisk.r) * 512) / dt / 1024 / 1024) * 100
            ) / 100;
          result.diskWriteMBs =
            Math.round(
              (((sectorsWritten - getSystemMetrics._lastDisk.w) * 512) / dt / 1024 / 1024) * 100
            ) / 100;
          if (result.diskReadMBs < 0) result.diskReadMBs = 0;
          if (result.diskWriteMBs < 0) result.diskWriteMBs = 0;
        }
      }
      getSystemMetrics._lastDisk = { r: sectorsRead, w: sectorsWritten, ts: now2 };
    }
  } catch (_) {}
  // CPU per-core from /proc/stat
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const cpuLines = stat.split('\n').filter((l) => l.startsWith('cpu') && l[3] !== ' ');
    const cores = cpuLines.length;
    result.cpuCores = cores;
    // CPU frequency
    try {
      const freq = fs.readFileSync('/proc/cpuinfo', 'utf8');
      const freqs = [...freq.matchAll(/cpu MHz\s*:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
      if (freqs.length > 0)
        result.cpuFreqAvg = Math.round(freqs.reduce((a, b) => a + b, 0) / freqs.length);
    } catch (_) {}
  } catch (_) {}
  // Disk total/used
  try {
    const { execSync } = require('child_process');
    const dfOut = execSync('df /home --output=size,used,avail -B1 | tail -1', { timeout: 2000 })
      .toString()
      .trim()
      .split(/\s+/);
    result.diskTotal = parseInt(dfOut[0] || 0);
    result.diskUsed = parseInt(dfOut[1] || 0);
    result.diskAvail = parseInt(dfOut[2] || 0);
  } catch (_) {}
  return result;
}

// ─── Extra System Data (fetched less frequently) ─────────────────────────────
let extraSystemCache = null;
let lastExtraFetch = 0;
async function getExtraSystemData() {
  const now = Date.now();
  if (extraSystemCache && now - lastExtraFetch < 15000) return extraSystemCache; // cache 15s
  const data = { qdrant: null, ollama: null, docker: null };
  // Qdrant
  try {
    const http = require('http');
    const qdrantData = await new Promise((resolve, reject) => {
      http
        .get('http://localhost:6333/collections', { timeout: 3000 }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on('error', reject);
    });
    if (qdrantData.result?.collections) {
      data.qdrant = {
        collections: qdrantData.result.collections.length,
        names: qdrantData.result.collections.map((c) => c.name),
      };
      // Get total points
      let totalPoints = 0;
      for (const col of qdrantData.result.collections) {
        try {
          const colData = await new Promise((resolve, reject) => {
            http
              .get(`http://localhost:6333/collections/${col.name}`, { timeout: 2000 }, (res) => {
                let b = '';
                res.on('data', (c) => (b += c));
                res.on('end', () => {
                  try {
                    resolve(JSON.parse(b));
                  } catch (e) {
                    reject(e);
                  }
                });
              })
              .on('error', reject);
          });
          totalPoints += colData.result?.points_count || 0;
        } catch (_) {}
      }
      data.qdrant.totalPoints = totalPoints;
    }
  } catch (_) {}
  // Ollama models
  try {
    const http = require('http');
    const ollamaData = await new Promise((resolve, reject) => {
      http
        .get('http://localhost:11434/api/ps', { timeout: 3000 }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on('error', reject);
    });
    data.ollama = {
      models: (ollamaData.models || []).map((m) => ({
        name: m.name,
        size: m.size,
        vram: m.size_vram,
      })),
    };
  } catch (_) {}
  // Docker containers
  try {
    const { execSync } = require('child_process');
    const out = execSync("docker ps --format '{{.Names}}|{{.Status}}|{{.Image}}' 2>/dev/null", {
      timeout: 3000,
    })
      .toString()
      .trim();
    data.docker = out
      ? out.split('\n').map((l) => {
          const p = l.split('|');
          return { name: p[0], status: p[1], image: p[2] };
        })
      : [];
  } catch (_) {
    data.docker = [];
  }
  extraSystemCache = data;
  lastExtraFetch = now;
  return data;
}

// ─── Sub-Agent Monitoring ─────────────────────────────────────────────────────
function getSubAgentSessions() {
  const now = Date.now();
  const sessions = [];
  try {
    // Read sessions.json for labeled sub-agents
    let sessionMeta = {};
    try {
      const sj = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'sessions.json'), 'utf8'));
      const entries = sj.sessions ? Object.entries(sj.sessions) : Object.entries(sj);
      {
        for (const [key, info] of entries) {
          if (key.includes('subagent')) {
            sessionMeta[info.sessionId || key] = {
              label: info.label || key.split(':').pop(),
              sessionKey: key,
              sessionId: info.sessionId,
              status: info.status,
              model: info.model,
            };
          }
        }
      }
    } catch (_) {}

    // Build reverse lookup: sessionId → meta
    const sidToMeta = {};
    for (const [, meta] of Object.entries(sessionMeta)) {
      if (meta.sessionId) sidToMeta[meta.sessionId] = meta;
    }

    const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.jsonl'));
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(SESSION_DIR, f));
        const age = now - stat.mtimeMs;
        if (age < SESSION_ACTIVE_THRESHOLD * 12) {
          // Show sessions active in last hour
          const id = f.replace('.jsonl', '');
          const meta = sessionMeta[id] || sidToMeta[id] || {};
          sessions.push({
            name: id,
            label: meta.label || (id.includes('subagent') ? 'sub-agent' : 'main'),
            active: age < SESSION_ACTIVE_THRESHOLD,
            lastModified: stat.mtimeMs,
            size: stat.size,
            isSubAgent: !!meta.sessionKey || !!meta.label,
            status: meta.status,
            model: meta.model,
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
  return sessions;
}

// ─── Ecosystem Map (for network graph) ────────────────────────────────────────
function getEcosystemMap() {
  return new Promise((resolve) => {
    const nodes = [];
    const links = [];

    // Center: ALFIE main
    nodes.push({ id: 'nexus', label: 'Rasputin', type: 'core', color: '#8b6cf6', size: 24 });

    // GPU nodes
    try {
      execFile(
        'nvidia-smi',
        ['--query-gpu=index,name,utilization.gpu', '--format=csv,noheader,nounits'],
        { timeout: 2000 },
        (err, stdout) => {
          if (!err && stdout.trim()) {
            stdout
              .trim()
              .split('\n')
              .forEach((line) => {
                const [idx, name, util] = line.split(',').map((s) => s.trim());
                const shortName = name
                  .replace('NVIDIA ', '')
                  .replace(' Workstation Edition', '')
                  .slice(0, 20);
                nodes.push({
                  id: `gpu${idx}`,
                  label: shortName,
                  type: 'gpu',
                  color: '#34d399',
                  size: 16,
                  util: parseFloat(util),
                });
                links.push({ source: 'nexus', target: `gpu${idx}` });
              });
          }

          // Docker containers
          execFile(
            'docker',
            ['ps', '--format', '{{.Names}}\t{{.Status}}'],
            { timeout: 2000 },
            (err2, stdout2) => {
              if (!err2 && stdout2.trim()) {
                stdout2
                  .trim()
                  .split('\n')
                  .slice(0, 8)
                  .forEach((line) => {
                    const [name, status] = line.split('\t');
                    const short = name.slice(0, 15);
                    nodes.push({
                      id: `docker-${name}`,
                      label: short,
                      type: 'docker',
                      color: '#38bdf8',
                      size: 10,
                    });
                    links.push({ source: 'nexus', target: `docker-${name}` });
                  });
              }

              // PM2 services
              execFile('pm2', ['jlist'], { timeout: 2000 }, (err3, stdout3) => {
                if (!err3 && stdout3.trim()) {
                  try {
                    const procs = JSON.parse(stdout3);
                    procs.forEach((p) => {
                      nodes.push({
                        id: `pm2-${p.name}`,
                        label: p.name,
                        type: 'service',
                        color: '#fbbf24',
                        size: 12,
                        status: p.pm2_env?.status,
                      });
                      links.push({ source: 'nexus', target: `pm2-${p.name}` });
                    });
                  } catch (_) {}
                }

                // Sub-agents from sessions.json
                try {
                  const sj = JSON.parse(
                    fs.readFileSync(path.join(SESSION_DIR, 'sessions.json'), 'utf8')
                  );
                  const sessions = sj.sessions || sj;
                  let agentCount = 0;
                  for (const [key, info] of Object.entries(sessions)) {
                    if (key.includes('subagent') && agentCount < 6) {
                      const age = Date.now() - (info.updatedAt || 0);
                      if (age < 3600000) {
                        // last hour
                        const label = (info.label || key.split(':').pop()).slice(0, 12);
                        const active = age < 300000;
                        nodes.push({
                          id: `agent-${agentCount}`,
                          label,
                          type: 'agent',
                          color: active ? '#c084fc' : '#6b7280',
                          size: 12,
                          active,
                        });
                        links.push({ source: 'nexus', target: `agent-${agentCount}` });
                        agentCount++;
                      }
                    }
                  }
                } catch (_) {}

                // Qdrant
                nodes.push({
                  id: 'qdrant',
                  label: 'Qdrant 446K',
                  type: 'database',
                  color: '#f97316',
                  size: 14,
                });
                links.push({ source: 'nexus', target: 'qdrant' });

                // Ollama
                nodes.push({
                  id: 'ollama',
                  label: 'Ollama LLM',
                  type: 'service',
                  color: '#fbbf24',
                  size: 12,
                });
                links.push({ source: 'nexus', target: 'ollama' });

                resolve({ nodes, links });
              });
            }
          );
        }
      );
    } catch (_) {
      resolve({ nodes, links });
    }
  });
}

// ─── Telemetry Loop (Performance Optimized) ──────────────────────────────────
let ecosystemCache = null;
let lastEcosystemFetch = 0;
const ECOSYSTEM_INTERVAL = 10000; // refresh ecosystem every 10s

// Cached telemetry data with different refresh rates
let gpuCache = null;
let lastGpuFetch = 0;
let nvtopCache = null;
let lastNvtopFetch = 0;
let topCache = null;
let lastTopFetch = 0;
let servicesCache = null;
let lastServicesFetch = 0;

// Batched broadcast buffer
let telemetryBuffer = null;
let lastBroadcast = 0;
const BROADCAST_THROTTLE = 3000; // Batch broadcasts every 3 seconds

async function emitTelemetry() {
  try {
    const now = Date.now();

    // Determine what to fetch based on intervals
    const fetchGpu = !gpuCache || now - lastGpuFetch > TELEMETRY_INTERVAL_MEDIUM;
    const fetchNvtop = !nvtopCache || now - lastNvtopFetch > TELEMETRY_INTERVAL_MEDIUM;
    const fetchTop = !topCache || now - lastTopFetch > TELEMETRY_INTERVAL_MEDIUM;
    const fetchEcosystem = !ecosystemCache || now - lastEcosystemFetch > ECOSYSTEM_INTERVAL;
    const fetchServices = !servicesCache || now - lastServicesFetch > TELEMETRY_INTERVAL_SLOW;

    // Always fetch fast-changing data (system metrics from /proc)
    const promises = [getSystemMetrics(), getSubAgentSessions(), getExtraSystemData()];

    // Conditionally fetch expensive operations
    if (fetchGpu) promises.push(getGpuMetrics());
    if (fetchNvtop) promises.push(getNvtopData());
    if (fetchTop) promises.push(getTopData());
    if (fetchEcosystem) promises.push(getEcosystemMap());
    if (fetchServices) promises.push(getServicesStatus());

    const results = await Promise.all(promises);
    const [system, sessions, extraSystem] = results;
    let idx = 3;

    // Update caches
    if (fetchGpu) {
      gpuCache = results[idx++];
      lastGpuFetch = now;
    }
    if (fetchNvtop) {
      nvtopCache = results[idx++];
      lastNvtopFetch = now;
    }
    if (fetchTop) {
      topCache = results[idx++];
      lastTopFetch = now;
    }
    if (fetchEcosystem) {
      ecosystemCache = results[idx++];
      lastEcosystemFetch = now;
    }
    if (fetchServices) {
      servicesCache = results[idx++];
      lastServicesFetch = now;
    }

    // Get latency stats
    const latencyStats = latencyTracker.getStats();

    // Analyze latency and generate alerts
    const latencyAnalysis = latencyAlerter.analyze(latencyStats, gpuCache);

    // Build telemetry payload
    const telemetryData = {
      type: 'telemetry',
      ts: now,
      data: {
        gpu: gpuCache || [],
        system,
        sessions,
        nvtop: nvtopCache || { processes: [], gpus: [] },
        top: topCache || { processes: [], system: {} },
        ecosystem: ecosystemCache,
        services: servicesCache,
        extraSystem,
        activeSessions: sessions.filter((s) => s.active).length,
        model: detectedModel,
        messageCount,
        toolCallCount,
        totalCost: Math.round(totalCost * 10000) / 10000,
        lifetimeCost: Math.round(lifetimeCost * 10000) / 10000,
        connectedClients: authedClients.size,
        uptimeMs: Date.now() - serverStartTime,
        latency: latencyStats,
        latencyAnalysis: latencyAnalysis,
      },
    };

    // Batched broadcast: buffer updates and send every 3 seconds
    telemetryBuffer = telemetryData;

    if (now - lastBroadcast >= BROADCAST_THROTTLE) {
      if (telemetryBuffer) {
        broadcast(telemetryBuffer);
        telemetryBuffer = null;
        lastBroadcast = now;
      }
    }
  } catch (e) {
    logErr('Telemetry error', { error: e.message });
  }
}

// ─── Active Agents ────────────────────────────────────────────────────────────
async function getActiveAgents() {
  const agents = [];
  try {
    // Read sessions.json for labeled sub-agents
    const sessionsJsonPath = path.join(SESSION_DIR, 'sessions.json');
    let sessionMeta = {};

    try {
      const sj = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf8'));
      const entries = sj.sessions ? Object.entries(sj.sessions) : Object.entries(sj);

      for (const [key, info] of entries) {
        sessionMeta[key] = {
          sessionKey: key,
          label: info.label || key.split(':').pop(),
          sessionId: info.sessionId,
          status: info.status || 'unknown',
          model: info.model || 'unknown',
          startedAt: info.startedAt || Date.now(),
        };
      }
    } catch (_) {}

    // Read all .jsonl files
    const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.jsonl'));
    const now = Date.now();

    for (const f of files) {
      try {
        const filePath = path.join(SESSION_DIR, f);
        const stat = fs.statSync(filePath);
        const age = now - stat.mtimeMs;
        const sessionId = f.replace('.jsonl', '');
        const meta = sessionMeta[sessionId] || {};

        // Parse last few lines to get model/task info
        let lastModel = meta.model || 'unknown';
        let taskDesc = '';
        let tokenCount = 0;

        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.trim().split('\n').slice(-10);

          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              const msg = json.message || json;

              if (msg.model) lastModel = msg.model;
              if (msg.usage) {
                tokenCount += (msg.usage.input || 0) + (msg.usage.output || 0);
              }

              // Extract task description from user messages
              if ((msg.role === 'user' || msg.role === 'human') && !taskDesc) {
                const content =
                  typeof msg.content === 'string'
                    ? msg.content
                    : Array.isArray(msg.content)
                      ? msg.content.map((b) => b.text || '').join(' ')
                      : '';
                taskDesc = content.slice(0, 120);
              }
            } catch (_) {}
          }
        } catch (_) {}

        const isSubAgent = sessionId.includes('subagent') || meta.label;
        const active = age < SESSION_ACTIVE_THRESHOLD;

        agents.push({
          id: sessionId,
          label: meta.label || (isSubAgent ? 'sub-agent' : 'main'),
          model: lastModel,
          status: active ? 'active' : 'completed',
          task: taskDesc || meta.label || 'Processing...',
          runtime: Math.floor((now - (meta.startedAt || stat.birthtimeMs)) / 1000),
          tokenCount,
          lastActivity: stat.mtimeMs,
          isSubAgent,
        });
      } catch (_) {}
    }

    // Sort by last activity
    agents.sort((a, b) => b.lastActivity - a.lastActivity);
  } catch (e) {
    logErr('Failed to get active agents', { error: e.message });
  }

  return agents;
}

// ─── Second Brain Stats ───────────────────────────────────────────────────────
async function getSecondBrainStats() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: 'localhost',
        port: 6333,
        path: '/collections/second_brain',
        method: 'GET',
        timeout: 3000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({
              status: json.result?.status || 'unknown',
              pointsCount: json.result?.points_count || 0,
              vectorsCount: json.result?.vectors_count || 0,
              segments: json.result?.segments_count || 0,
              collections: [json.result?.name || 'second_brain'],
              lastQuery: 'N/A', // Could track this separately
            });
          } catch (_) {
            resolve({
              status: 'error',
              pointsCount: 0,
              vectorsCount: 0,
              segments: 0,
              collections: [],
              lastQuery: 'N/A',
            });
          }
        });
      }
    );

    req.on('error', () => {
      resolve({
        status: 'offline',
        pointsCount: 0,
        vectorsCount: 0,
        segments: 0,
        collections: [],
        lastQuery: 'N/A',
      });
    });

    req.end();
  });
}

// ─── Activity Heatmap ─────────────────────────────────────────────────────────
async function getActivityData() {
  const activity = {};
  const costs = [];

  try {
    const files = fs
      .readdirSync(SESSION_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(SESSION_DIR, f));

    // Initialize heatmap (7 days × 24 hours)
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const key = `${day}-${hour}`;
        activity[key] = 0;
      }
    }

    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Parse recent files
    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < weekAgo) continue;

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n');

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            const ts = json.timestamp || json.ts || Date.now();

            // Skip if older than a week
            if (ts < weekAgo) continue;

            const date = new Date(ts);
            const day = date.getDay(); // 0-6
            const hour = date.getHours(); // 0-23
            const key = `${day}-${hour}`;

            activity[key] = (activity[key] || 0) + 1;

            // Track costs
            const msg = json.message || json;
            if (msg.usage?.cost?.total) {
              costs.push({ ts, cost: msg.usage.cost.total });
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    // Sort costs by time
    costs.sort((a, b) => a.ts - b.ts);
  } catch (e) {
    logErr('Failed to get activity data', { error: e.message });
  }

  return { heatmap: activity, costs };
}

// ─── Cost Forecasting ─────────────────────────────────────────────────────────
function calculateCostForecast() {
  // Use enhanced forecast with caching
  return getCachedForecast(costHistory, lifetimeCost);
}

// ─── Enhanced Tool Call Parser ────────────────────────────────────────────────
function generateSmartToolDescription(toolName, input) {
  try {
    switch (toolName) {
      case 'web_search':
        return `🔍 Searching web for "${input.query || 'unknown'}"`;

      case 'web_fetch':
        return `🌐 Fetching ${input.url || 'URL'}`;

      case 'read':
        const filePath = input.file_path || input.path || 'file';
        const fileName = path.basename(filePath);
        const limit = input.limit
          ? ` (lines ${input.offset || 1}-${(input.offset || 1) + input.limit})`
          : '';
        return `📁 Reading ${fileName}${limit}`;

      case 'write':
        const writeFile = input.file_path || input.path || 'file';
        const writeSize = input.content ? ` (${(input.content.length / 1024).toFixed(1)}KB)` : '';
        return `💾 Writing ${path.basename(writeFile)}${writeSize}`;

      case 'edit':
        const editFile = input.file_path || input.path || 'file';
        return `✏️ Editing ${path.basename(editFile)}`;

      case 'exec':
        const cmd = input.command || 'command';
        const shortCmd = cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd;
        return `⚡ Running: ${shortCmd}`;

      case 'browser':
        if (input.action === 'open') return `🌐 Opening ${input.targetUrl || 'browser'}`;
        if (input.action === 'snapshot') return `📸 Taking browser snapshot`;
        if (input.action === 'act') {
          const req = input.request || {};
          if (req.kind === 'click') return `🖱️ Clicking ${req.ref || 'element'}`;
          if (req.kind === 'type') return `⌨️ Typing: ${req.text}`;
        }
        return `🌐 Browser: ${input.action}`;

      case 'message':
        if (input.action === 'send') return `📨 Sending message to ${input.target || 'channel'}`;
        return `💬 Message: ${input.action}`;

      case 'image':
        return `🖼️ Analyzing image`;

      default:
        return `🔧 ${toolName}`;
    }
  } catch (_) {
    return `🔧 ${toolName}`;
  }
}

// ─── Build System State ───────────────────────────────────────────────────────
async function getSystemState() {
  const [gpu, system] = await Promise.all([getGpuMetrics(), getSystemMetrics()]);
  const sessions = getSubAgentSessions();
  return {
    server: {
      version: '2.0',
      uptime: Date.now() - serverStartTime,
      port: PORT,
      connections: { total: clients.size, authenticated: authedClients.size },
    },
    ai: {
      model: detectedModel,
      messageCount,
      toolCallCount,
      totalCost: Math.round(totalCost * 10000) / 10000,
      lifetimeCost: Math.round(lifetimeCost * 10000) / 10000,
    },
    sessions: {
      active: sessions.filter((s) => s.active).length,
      recent: sessions,
      currentFile: currentSessionFile ? path.basename(currentSessionFile) : null,
    },
    gpu,
    system,
    crypto: {
      identityKeyLoaded: !!serverIdentityKeyPair,
      ephemeralKeyReady: !!serverEphemeralKeyPair,
    },
  };
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
// --- Cookie Auth ---
const AUTH_COOKIE_NAME = 'nexus_session';
const AUTH_TOKEN_SALT = '0e50e9e662b8973942e34c4031791722b0b7e0ddd549dc86bb5379d61f1d22c4';
const AUTH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function makeAuthToken(secret) {
  return crypto.createHmac('sha256', AUTH_TOKEN_SALT).update(secret).digest('hex');
}
const VALID_AUTH_TOKEN = makeAuthToken(SECRET);

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((c) => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  });
  return cookies;
}

function isAuthed(req) {
  // Check Google OAuth first
  if (isAuthedGoogle(req)) return true;

  // Check hash secret cookie
  const cookies = parseCookies(req.headers.cookie);
  return cookies[AUTH_COOKIE_NAME] === VALID_AUTH_TOKEN;
}

function requireAuth(req, res) {
  // Check Google OAuth first
  if (isAuthedGoogle(req)) return true;

  // Check hash secret cookie auth
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[AUTH_COOKIE_NAME] === VALID_AUTH_TOKEN) return true;

  // Check Bearer token auth
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${SECRET}`) return true;

  // Unauthorized
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
  return false;
}

function setAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=${VALID_AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_TOKEN_MAX_AGE}`
  );
}

// Rate limiting for expensive operations
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMITS = {
  execute: 30,
  research: 5,
  playground: 10,
  browser: 10,
};

function checkRateLimit(ip, operation) {
  const key = `${ip}-${operation}`;
  const now = Date.now();
  let entry = rateLimits.get(key);

  if (!entry || now - entry.lastRequest > RATE_LIMIT_WINDOW) {
    entry = { lastRequest: now, count: 0 };
    rateLimits.set(key, entry);
  }

  entry.count++;
  const limit = RATE_LIMITS[operation] || 100;
  if (entry.count > limit) {
    throw new Error(`Rate limit exceeded: ${limit} ${operation} requests per minute`);
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits.entries()) {
    if (now - entry.lastRequest > RATE_LIMIT_WINDOW * 2) {
      rateLimits.delete(key);
    }
  }
}, 300000);

// ─── Google OAuth Helper Functions ───────────────────────────────────────────

// Create JWT token for session
function createJWT(email) {
  if (!GOOGLE_JWT_SECRET) return null;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  }; // 30 days
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', GOOGLE_JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// Verify JWT token
function verifyJWT(token) {
  if (!token || !GOOGLE_JWT_SECRET) return null;
  try {
    const [encodedHeader, encodedPayload, signature] = token.split('.');
    const expectedSignature = crypto
      .createHmac('sha256', GOOGLE_JWT_SECRET)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    if (signature !== expectedSignature) return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null; // Expired
    return payload;
  } catch (_) {
    return null;
  }
}

// Verify Google ID token (manual JWT verification without dependencies)
function verifyGoogleIdToken(idToken) {
  return new Promise((resolve, reject) => {
    try {
      const [, payloadB64] = idToken.split('.');
      if (!payloadB64) return reject(new Error('Invalid token format'));
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

      // Basic validation
      if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
        return reject(new Error('Invalid issuer'));
      }
      if (payload.aud !== GOOGLE_CLIENT_ID) {
        return reject(new Error('Invalid audience'));
      }
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return reject(new Error('Token expired'));
      }

      // For production, should verify signature against Google's public keys
      // For now, we trust the token came from our OAuth flow

      resolve(payload);
    } catch (e) {
      reject(e);
    }
  });
}

// Set Google Auth JWT cookie
function setGoogleAuthCookie(res, email) {
  const jwt = createJWT(email);
  if (!jwt) return false;
  res.setHeader(
    'Set-Cookie',
    `nexus_google_session=${jwt}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
  );
  return true;
}

// Check if user is authenticated via Google OAuth or hash secret
function isAuthedGoogle(req) {
  const cookies = parseCookies(req.headers.cookie);
  const googleSession = cookies.nexus_google_session;
  if (googleSession) {
    const payload = verifyJWT(googleSession);
    if (payload && WHITELISTED_EMAILS.includes(payload.email)) {
      return true;
    }
  }
  return false;
}

const LOGIN_PAGE = `<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NEXUS — Login</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e0e0e8;font-family:'Space Grotesk',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-box{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:48px;width:380px;backdrop-filter:blur(20px)}
h1{font-size:24px;font-weight:600;margin-bottom:8px;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:#666;font-size:13px;margin-bottom:32px}
label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#888;margin-bottom:6px}
input{width:100%;padding:12px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e0e0e8;font-size:15px;font-family:inherit;outline:none;transition:border-color 0.2s}
input:focus{border-color:#60a5fa}
button{width:100%;padding:12px;margin-top:20px;background:linear-gradient(135deg,#60a5fa,#a78bfa);border:none;border-radius:8px;color:#fff;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;transition:opacity 0.2s}
button:hover{opacity:0.9}
.err{color:#f87171;font-size:13px;margin-top:12px;display:none}
</style></head><body>
<div class="login-box">
<h1>⚡ NEXUS</h1>
<p class="sub">Rasputin Neural Dashboard — rasputin.to</p>
<form method="POST" action="/auth/login">
<label>Access Key</label>
<input type="password" name="secret" placeholder="Enter access key..." autofocus autocomplete="current-password">
<button type="submit">Authenticate</button>
<p class="err" id="err">Invalid access key</p>
</form>
<script>if(location.search.includes('fail'))document.getElementById('err').style.display='block'</script>
</div></body></html>`;

// Public paths that don't need auth
const PUBLIC_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/google',
  '/auth/google/callback',
  '/demo',
  '/login.html',
  '/offline.html',
  '/service-worker.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
]);

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || '';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  // --- Auth endpoints ---
  if (urlPath === '/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // Parse form or JSON
      let secret = '';
      if (req.headers['content-type']?.includes('json')) {
        try {
          secret = JSON.parse(body).secret || '';
        } catch {}
      } else {
        const params = new URLSearchParams(body);
        secret = params.get('secret') || '';
      }
      if (secret === SECRET) {
        setAuthCookie(res);
        // Redirect back to where they came from
        const reqUrl = new URL(req.url, 'http://localhost');
        const next = decodeURIComponent(reqUrl.searchParams.get('next') || '/');
        res.writeHead(302, { Location: next });
        res.end();
      } else {
        const referer = req.headers.referer || '/auth/login';
        res.writeHead(302, { Location: referer.includes('?') ? referer : referer + '?fail=1' });
        res.end();
      }
    });
    return;
  }

  if (urlPath === '/auth/login' && req.method === 'GET') {
    const reqUrl = new URL(req.url, 'http://localhost');
    const next = reqUrl.searchParams.get('next') || '/';
    if (isAuthed(req)) {
      res.writeHead(302, { Location: next });
      res.end();
      return;
    }
    // Inject next param into login form action
    const page = LOGIN_PAGE.replace(
      'action="/auth/login"',
      `action="/auth/login?next=${encodeURIComponent(next)}"`
    );
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
    return;
  }

  if (urlPath === '/auth/logout') {
    // Clear both auth cookies
    res.setHeader('Set-Cookie', [
      `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`,
      `nexus_google_session=; Path=/; HttpOnly; Max-Age=0`,
    ]);
    res.writeHead(302, { Location: '/login.html' });
    res.end();
    return;
  }

  // --- Google OAuth endpoints ---
  if (urlPath === '/auth/google' && req.method === 'GET') {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(
        '<h1>Google OAuth not configured</h1><p>Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env file.</p>'
      );
      return;
    }

    // Build Google OAuth URL
    const querystring = require('querystring');
    const params = {
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
    };
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${querystring.stringify(params)}`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  if (urlPath === '/auth/google/callback' && req.method === 'GET') {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const code = reqUrl.searchParams.get('code');
    const error = reqUrl.searchParams.get('error');

    if (error) {
      res.writeHead(302, { Location: `/login.html?error=${error}` });
      res.end();
      return;
    }

    if (!code) {
      res.writeHead(302, { Location: '/login.html?error=no_code' });
      res.end();
      return;
    }

    // Exchange code for tokens
    const querystring = require('querystring');
    const postData = querystring.stringify({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const tokenReq = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (tokenRes) => {
        let body = '';
        tokenRes.on('data', (chunk) => (body += chunk));
        tokenRes.on('end', async () => {
          try {
            const tokens = JSON.parse(body);
            if (!tokens.id_token) {
              res.writeHead(302, { Location: '/login.html?error=no_id_token' });
              res.end();
              return;
            }

            // Verify ID token
            const payload = await verifyGoogleIdToken(tokens.id_token);
            const email = payload.email;

            // Check whitelist
            if (!WHITELISTED_EMAILS.includes(email)) {
              logWarn('OAuth: Non-whitelisted email attempted login', { email });
              res.writeHead(302, { Location: '/login.html?error=not_whitelisted' });
              res.end();
              return;
            }

            // Set JWT session cookie
            setGoogleAuthCookie(res, email);
            logInfo('OAuth: User logged in', { email });

            // Redirect to dashboard
            res.writeHead(302, { Location: '/' });
            res.end();
          } catch (e) {
            logErr('OAuth: Token exchange failed', { error: e.message });
            res.writeHead(302, { Location: `/login.html?error=${encodeURIComponent(e.message)}` });
            res.end();
          }
        });
      }
    );

    tokenReq.on('error', (e) => {
      logErr('OAuth: Token request failed', { error: e.message });
      res.writeHead(302, { Location: `/login.html?error=${encodeURIComponent(e.message)}` });
      res.end();
    });

    tokenReq.write(postData);
    tokenReq.end();
    return;
  }

  // --- Auth gate: DISABLED (using client-side hash auth via WebSocket) ---
  // The dashboard uses hash-in-URL auth (#secret) verified on WebSocket connect.
  // Server-side cookie auth gate was causing issues with Cloudflare proxy.
  // Files endpoint still requires auth.
  if (urlPath.startsWith('/files') && !isAuthed(req)) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${SECRET}`) {
      res.writeHead(302, { Location: `/login.html` });
      res.end();
      return;
    }
  }

  // File browser proxy - serves workspace files at /files/*
  if (urlPath.startsWith('/files')) {
    const filePath = urlPath === '/files' ? '/' : urlPath.slice(6);
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: 5556,
        path: filePath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''),
        method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:5556' },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', () => {
      res.writeHead(502);
      res.end('File server unavailable');
    });
    req.pipe(proxyReq);
    return;
  }

  // API endpoints
  if (urlPath === '/api/health') {
    const body = JSON.stringify({
      status: 'ok',
      uptime: Date.now() - serverStartTime,
      ts: Date.now(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }

  // ── Local Qwen 122B model metrics proxy (llama-server at port 11435) ──
  // ── Qwen3-Coder (GPU1/5090) on port 11436 ──
  if (urlPath === '/api/coder/slots' || urlPath === '/api/coder/metrics') {
    const coderPath = urlPath === '/api/coder/slots' ? '/slots' : '/metrics';
    try {
      const coderReq = http.get({ hostname: '127.0.0.1', port: 11436, path: coderPath, timeout: 3000 }, (coderRes) => {
        let data = '';
        coderRes.on('data', chunk => data += chunk);
        coderRes.on('end', () => {
          const ct = coderPath === '/metrics' ? 'text/plain' : 'application/json';
          res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
          res.end(data);
        });
      });
      coderReq.on('error', () => {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'coder model offline' }));
      });
      coderReq.on('timeout', () => { coderReq.destroy(); });
      return;
    } catch(e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'coder model error' }));
      return;
    }
  }

  if (urlPath === '/api/local/metrics' || urlPath === '/api/local/slots') {
    const localPath = urlPath === '/api/local/metrics' ? '/metrics' : '/slots';
    try {
      const proxyReq = http.get({ hostname: '127.0.0.1', port: 11435, path: localPath, timeout: 3000 }, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          const ct = localPath === '/metrics' ? 'text/plain' : 'application/json';
          res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
          res.end(data);
        });
      });
      proxyReq.on('error', () => {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'local model offline' }));
      });
      proxyReq.on('timeout', () => { proxyReq.destroy(); });
      return;
    } catch(e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'local model error' }));
      return;
    }
  }

  // ── Proxy endpoints for dashboard sidebar (costs, memory, quality) ──
  if (urlPath === '/api/proxy/costs' || urlPath === '/api/proxy/providers' || urlPath === '/api/proxy/quality' || urlPath === '/api/proxy/status' || urlPath === '/api/proxy/lb') {
    const port 8080;
    const path = urlPath === '/api/proxy/costs' ? '/costs' : urlPath === '/api/proxy/providers' ? '/providers' : urlPath === '/api/proxy/status' ? '/status' : urlPath === '/api/proxy/lb' ? '/lb/status' : '/quality';
    try {
      const proxyReq = http.get({ hostname: '127.0.0.1', port, path, timeout: 5000 }, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(data);
        });
      });
      proxyReq.on('error', () => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy unavailable' }));
      });
      proxyReq.on('timeout', () => { proxyReq.destroy(); });
      return;
    } catch(e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy error' }));
      return;
    }
  }

  if (urlPath === '/api/proxy/memory') {
    try {
      const proxyReq = http.get({ hostname: '127.0.0.1', port: 7777, path: '/stats', timeout: 5000 }, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(data);
        });
      });
      proxyReq.on('error', () => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'memory service unavailable' }));
      });
      proxyReq.on('timeout', () => { proxyReq.destroy(); });
      return;
    } catch(e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy error' }));
      return;
    }
  }

  // Session file sizes for health monitoring
  if (urlPath === '/api/sessions/size') {
    const sessDir = '/home/admin/.openclaw/agents/main/sessions';
    fs.readdir(sessDir, (err, files) => {
      if (err) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'sessions dir unavailable' }));
        return;
      }
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      if (jsonlFiles.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ sessions: [], active: null, totalBytes: 0 }));
        return;
      }
      let pending = jsonlFiles.length;
      const results = [];
      jsonlFiles.forEach(fname => {
        fs.stat(path.join(sessDir, fname), (serr, st) => {
          if (!serr && st.isFile()) {
            results.push({ name: fname, bytes: st.size, mtime: st.mtimeMs });
          }
          pending--;
          if (pending === 0) {
            results.sort((a, b) => b.mtime - a.mtime);
            const active = results[0] || null;
            const totalBytes = results.reduce((s, r) => s + r.bytes, 0);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ sessions: results.slice(0, 10), active, totalBytes }));
          }
        });
      });
    });
    return;
  }

  // Sub-agents and active sessions from sessions.json
  if (urlPath === '/api/proxy/subagents') {
    try {
      const sessPath = '/home/admin/.openclaw/agents/main/sessions/sessions.json';
      fs.readFile(sessPath, 'utf8', (err, raw) => {
        if (err) {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'sessions file unavailable' }));
          return;
        }
        try {
          const data = JSON.parse(raw);
          const now = Date.now();
          const results = [];
          const seen = new Set(); // dedupe :run: variants

          // Build lookup of :run: children keyed by parent session key
          const runChildren = {};
          for (const [key, s] of Object.entries(data)) {
            if (!key.includes(':run:')) continue;
            const parentKey = key.replace(/:run:[^:]+$/, '');
            if (!runChildren[parentKey] || (s.updatedAt || 0) > (runChildren[parentKey].updatedAt || 0)) {
              runChildren[parentKey] = s;
            }
          }

          for (const [key, s] of Object.entries(data)) {
            // Skip :run: duplicates — only show the parent
            if (key.includes(':run:')) continue;

            const updatedAt = s.updatedAt || 0;
            const ageMin = (now - updatedAt) / 60000;
            // Try: session model → modelOverride → latest :run: child model → default
            const child = runChildren[key];
            const model = s.model || s.modelOverride || (child && (child.model || child.modelOverride)) || '';
            const label = s.label || (child && child.label) || '';
            const tokens = s.contextTokens || 0;
            const provider = s.modelProvider || s.providerOverride || (child && child.modelProvider) || '';
            const inputTok = s.inputTokens || (child && child.inputTokens) || 0;
            const outputTok = s.outputTokens || (child && child.outputTokens) || 0;

            let kind = 'other';
            if (key.includes('subagent') || key.includes('spawn')) kind = 'subagent';
            else if (key.includes('cron')) kind = 'cron';
            else if (key.includes('telegram')) kind = 'telegram';
            else if (key.includes('whatsapp')) kind = 'whatsapp';
            else if (key.endsWith(':main')) kind = 'main';

            // Include: sub-agents always, crons active in last 6h, main sessions
            const maxAge = kind === 'subagent' ? 1440 : kind === 'cron' ? 360 : kind === 'main' || kind === 'telegram' ? 30 : 60;
            if (ageMin > maxAge) continue;

            // Determine if actively running (updated within last 2 min)
            const isActive = ageMin < 2;

            results.push({
              key: key.length > 60 ? key.substring(0, 57) + '...' : key,
              kind,
              model: model.replace('claude-', '').replace('minimax-m2.5-', 'mm-'),
              label: label.replace('Cron: ', ''),
              isActive,
              ageMin: Math.round(ageMin),
              tokens: inputTok + outputTok,
              contextTokens: tokens,
              provider,
            });
          }

          // Sort: active first, then by recency
          results.sort((a, b) => {
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            return a.ageMin - b.ageMin;
          });

          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ sessions: results, total: Object.keys(data).length }));
        } catch (parseErr) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'parse error' }));
        }
      });
      return;
    } catch(e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'subagents error' }));
      return;
    }
  }

  // Context window from openclaw status
  if (urlPath === '/api/proxy/context') {
    try {
      execFile('openclaw', ['status', '--deep'], { timeout: 12000 }, (err, stdout) => {
        if (err && !stdout) {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'openclaw status failed' }));
          return;
        }
        // Parse from --deep output table: "│ agent:main:telegram:direct:1031… │ direct │ 5m ago │ claude-opus-4-6 │ 66k/200k (33%) │"
        // Find the telegram session line (primary interactive session)
        const lines = (stdout || '').split('\n');
        let ctxUsed = 0, ctxMax = 200000, ctxPct = 0, compactions = 0;
        const sessions = [];
        
        for (const line of lines) {
          // Match any session with token info: "66k/200k (33%)"
          const m = line.match(/(\d+)k\/(\d+)k\s*\((\d+)%\)/);
          if (m) {
            const used = parseInt(m[1]) * 1000;
            const max = parseInt(m[2]) * 1000;
            const pct = parseInt(m[3]);
            const isTelegram = line.includes('telegram');
            const isMain = line.includes('agent:main:main');
            sessions.push({ used, max, pct, isTelegram, isMain, line: line.trim() });
          }
          // Compactions line
          const compM = line.match(/[Cc]ompactions?[:\s]+(\d+)/);
          if (compM) compactions = parseInt(compM[1]);
        }
        
        // Priority: telegram session > main session > highest usage
        const primary = sessions.find(s => s.isTelegram) 
          || sessions.find(s => s.isMain)
          || sessions.sort((a, b) => b.pct - a.pct)[0];
        
        if (primary) {
          ctxUsed = primary.used;
          ctxMax = primary.max;
          ctxPct = primary.pct;
        }

        const result = {
          context_used: ctxUsed,
          context_max: ctxMax,
          context_pct: ctxPct,
          compactions,
          sessions: sessions.length,
          active_session: primary ? (primary.isTelegram ? 'telegram' : primary.isMain ? 'main' : 'other') : 'none',
        };

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      });
      return;
    } catch(e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'context error' }));
      return;
    }
  }

  if (urlPath === '/api/proxy/active-model') {
    try {
      execFile('openclaw', ['status', '--json'], { timeout: 8000 }, (err, stdout) => {
        if (err && !stdout) {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'openclaw status failed' }));
          return;
        }
        try {
          const data = JSON.parse(stdout || '{}');
          const sessions = (data.sessions || {}).recent || [];
          // Find the telegram interactive session
          const tgSession = sessions.find(s => s.key && s.key.includes('telegram'));
          const mainSession = sessions.find(s => s.key && s.key.includes(':main:main'));
          const primary = tgSession || mainSession || sessions[0] || {};
          
          // Read the runtime model from openclaw.json agent config
          // The model field in sessions is just the base model name
          // The actual provider comes from the agent's default_model or model override
          const sessionModel = primary.model || 'unknown';
          const modelOverride = primary.modelOverride || null;
          
          // Also read the actual runtime model from the config
          let runtimeModel = sessionModel;
          try {
            const fs = require('fs');
            const configPath = '/home/admin/.openclaw/openclaw.json';
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const defaultModel = (config.agents || {}).defaults || {};
            const agentModel = defaultModel.model || '';
            // If there's a model override on the session, that takes precedence
            if (modelOverride && modelOverride !== 'none') {
              runtimeModel = modelOverride;
            } else if (agentModel) {
              runtimeModel = agentModel;
            }
          } catch(e2) { /* config read failed, use session model */ }
          
          const result = {
            model: runtimeModel,
            base_model: sessionModel,
            override: modelOverride,
            session_key: primary.key || 'unknown',
            context_tokens: primary.contextTokens || 0,
            input_tokens: primary.inputTokens || 0,
            output_tokens: primary.outputTokens || 0,
            total_sessions: (data.sessions || {}).count || 0,
            timestamp: Date.now()
          };
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(result));
        } catch(parseErr) {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'parse error', detail: parseErr.message }));
        }
      });
      return;
    } catch(e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
  }

  if (urlPath.startsWith('/api/manus/')) {
    if (!requireAuth(req, res)) return;
    const handled = await ManusBackend.handleRequest(req, res, urlPath);
    if (handled) return;
  }

  if (urlPath === '/api/state') {
    // Require auth header
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    try {
      const state = await getSystemState();
      const body = JSON.stringify(state);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Helper: Sanitize text for JSON (strip invalid Unicode, emoji, control chars)
  function sanitizeForJSON(text) {
    if (!text) return '';
    // Replace invalid surrogate pairs, control chars, and problematic Unicode
    return text
      .replace(/[\uD800-\uDFFF]/g, '') // Remove unpaired surrogates
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control chars
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '?') // Replace emoji with ?
      .trim();
  }

  // NEW: Sub-agents endpoint
  // ─── Agent Orchestration Endpoints ──────────────────────────────────────────
  if (urlPath === '/api/agents/active') {
    try {
      const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.jsonl'));
      const now = Date.now();
      const agents = [];

      // Load sessions.json for labels
      let sessionMeta = {};
      try {
        const sj = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'sessions.json'), 'utf8'));
        const entries = sj.sessions ? Object.entries(sj.sessions) : Object.entries(sj);
        for (const [key, info] of entries) sessionMeta[key] = info;
      } catch (_) {}

      for (const f of files) {
        try {
          const filePath = path.join(SESSION_DIR, f);
          const stat = fs.statSync(filePath);
          const sessionId = f.replace('.jsonl', '');
          const age = now - stat.mtimeMs;
          const meta = sessionMeta[sessionId] || {};

          // Read last 3 lines
          const content = fs.readFileSync(filePath, 'utf8');
          const allLines = content.trim().split('\n');
          const lastLines = allLines.slice(-3);
          let lastMessage = '';
          let lastModel = meta.model || 'unknown';

          for (const line of lastLines) {
            try {
              const json = JSON.parse(line);
              const msg = json.message || json;
              if (msg.model) lastModel = msg.model;
              if (msg.role === 'assistant' && msg.content) {
                const texts = Array.isArray(msg.content)
                  ? msg.content
                      .filter((b) => b.type === 'text')
                      .map((b) => b.text)
                      .join(' ')
                  : typeof msg.content === 'string'
                    ? msg.content
                    : '';
                if (texts) lastMessage = sanitizeForJSON(texts.slice(0, 200));
              }
              if (msg.role === 'user' && !lastMessage) {
                const text =
                  typeof msg.content === 'string'
                    ? msg.content
                    : Array.isArray(msg.content)
                      ? msg.content
                          .filter((b) => b.type === 'text')
                          .map((b) => b.text)
                          .join(' ')
                      : '';
                if (text) lastMessage = '[user] ' + sanitizeForJSON(text.slice(0, 200));
              }
            } catch (_) {}
          }

          agents.push({
            sessionId,
            label: meta.label || (sessionId.includes('subagent') ? 'sub-agent' : f.slice(0, 8)),
            lastActivity: stat.mtimeMs,
            lastMessage: lastMessage || '(no recent messages)',
            status: age < SESSION_ACTIVE_THRESHOLD ? 'active' : 'idle',
            model: lastModel,
            runtime: Math.floor((now - stat.birthtimeMs) / 1000),
            messageCount: allLines.length,
          });
        } catch (_) {}
      }

      agents.sort((a, b) => b.lastActivity - a.lastActivity);
      const active = agents.filter((a) => a.status === 'active').length;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents, stats: { total: agents.length, active } }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/agents/spawn' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { task, label, model } = JSON.parse(body);
        if (!task) throw new Error('task is required');
        const safeLabel = (label || 'spawned').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        const safeTask = task
          .replace(/"/g, '\\"')
          .replace(/\$/g, '\\$')
          .replace(/`/g, '\\`')
          .slice(0, 500);
        const cmd = `openclaw system event --mode now --text "Spawn sub-agent: label=${safeLabel} task=${safeTask}"`;
        const { exec: execCmd } = require('child_process');
        execCmd(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({ error: 'Spawn failed: ' + (stderr || err.message).slice(0, 200) })
            );
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, label: safeLabel, task: safeTask }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath === '/api/agents') {
    try {
      const agents = await getActiveAgents();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(agents));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // NEW: Second brain stats endpoint
  if (urlPath === '/api/brain') {
    try {
      const stats = await getSecondBrainStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // NEW: System metrics endpoint (for dashboard)
  if (urlPath === '/api/system') {
    try {
      const [gpu, system, services, extraSystem] = await Promise.all([
        getGpuMetrics(),
        getSystemMetrics(),
        getServicesStatus(),
        getExtraSystemData(),
      ]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          gpu,
          system,
          services,
          extraSystem,
          model: detectedModel,
          uptime: Date.now() - serverStartTime,
          totalCost,
          lifetimeCost,
        })
      );
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // NEW: Activity heatmap endpoint
  if (urlPath === '/api/activity') {
    try {
      const activity = await getActivityData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(activity));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // NEW: NVTOP endpoint
  if (urlPath === '/api/chat-inbox') {
    try {
      const inboxPath = path.join(__dirname, 'chat_inbox.jsonl');
      if (fs.existsSync(inboxPath)) {
        const data = fs.readFileSync(inboxPath, 'utf8');
        // Clear inbox after reading
        fs.writeFileSync(inboxPath, '');
        const messages = data
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch (_) {
              return null;
            }
          })
          .filter(Boolean);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: [] }));
      }
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: [] }));
    }
    return;
  }

  if (urlPath === '/api/missions') {
    try {
      const data = fs.readFileSync(path.join(__dirname, 'missions.json'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ missions: [] }));
    }
    return;
  }

  if (urlPath === '/api/nvtop') {
    try {
      const nvtop = await getNvtopData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(nvtop));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Latency Analytics & Alerts API
  if (urlPath === '/api/latency/alerts') {
    try {
      const summary = latencyAlerter.getSummary();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(summary));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/latency/report') {
    try {
      const stats = latencyTracker.getStats();
      const report = latencyAlerter.generateReport(stats, gpuCache);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(report));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/latency/export' && req.method === 'GET') {
    try {
      const samples = latencyTracker.getRecentSamples(1000);
      const csv = latencyAlerter.exportCSV(samples);
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="latency-export-${Date.now()}.csv"`,
        'Cache-Control': 'no-cache',
      });
      res.end(csv);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/latency/save-baseline' && req.method === 'POST') {
    try {
      const stats = latencyTracker.getStats();
      latencyAlerter.saveHistoricalData(stats);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Baseline saved successfully' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // NEW: TOP endpoint
  if (urlPath === '/api/top') {
    try {
      const top = await getTopData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(top));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // NEW: Services endpoint (Docker + PM2)
  if (urlPath === '/api/services') {
    try {
      const services = await getServicesStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(services));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Remote Management (MeshCentral) Endpoints ──────────────────────────────
  if (urlPath === '/api/remote/status') {
    try {
      const { execSync } = require('child_process');
      const out = execSync(
        'docker exec meshcentral node /opt/meshcentral/meshcentral/meshctrl.js ServerInfo --url ws://localhost:443 --loginuser admin --loginpass "M3shC3ntral!2026"',
        { timeout: 10000 }
      ).toString();
      const info = {};
      for (const line of out.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) info[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ healthy: true, name: info.name || '', serverTime: info.serverTime || '' })
      );
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ healthy: false, error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/remote/devices') {
    try {
      const { execSync } = require('child_process');
      let devices = [];
      try {
        const out = execSync(
          'docker exec meshcentral node /opt/meshcentral/meshcentral/meshctrl.js ListDevices --json --url ws://localhost:443 --loginuser admin --loginpass "M3shC3ntral!2026"',
          { timeout: 10000 }
        )
          .toString()
          .trim();
        if (out && out !== 'None') devices = JSON.parse(out);
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ group: 'Rasputin Managed', devices, count: devices.length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Session Replay Endpoints ───────────────────────────────────────────────
  if (urlPath === '/api/sessions') {
    try {
      const files = fs
        .readdirSync(SESSION_DIR)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          try {
            const stat = fs.statSync(path.join(SESSION_DIR, f));
            return {
              id: f.replace('.jsonl', ''),
              filename: f,
              size: stat.size,
              modified: stat.mtimeMs,
              created: stat.birthtimeMs,
            };
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.modified - a.modified);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions: files }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath.startsWith('/api/replay/') && req.method === 'POST') {
    const sessionId = urlPath.split('/api/replay/')[1];
    if (!sessionId || sessionId.includes('..') || sessionId.includes('/')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid session ID' }));
      return;
    }
    const filePath = path.join(SESSION_DIR, sessionId + '.jsonl');
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const messages = data
        .split('\n')
        .filter((l) => l.trim())
        .map((line, idx) => {
          try {
            const raw = JSON.parse(line);
            const obj = raw.message || raw;
            return {
              index: idx,
              type: raw.type || obj.role || 'unknown',
              role: obj.role || raw.type || null,
              content: obj.content || null,
              timestamp: raw.timestamp || raw.ts || null,
              model: obj.model || raw.model || null,
              usage: obj.usage || raw.usage || null,
              toolName: obj.toolName || null,
              toolCallId: obj.toolCallId || null,
              id: raw.id || obj.id || null,
              stop_reason: obj.stop_reason || null,
              raw: raw,
            };
          } catch (_) {
            return { index: idx, type: 'parse_error', content: line.slice(0, 200) };
          }
        });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId, messageCount: messages.length, messages }));
    } catch (e) {
      const code = e.code === 'ENOENT' ? 404 : 500;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: code === 404 ? 'Session not found' : e.message }));
    }
    return;
  }

  // ─── Session Export Endpoints ─────────────────────────────────────────────
  if (urlPath.startsWith('/api/export/session/') && req.method === 'GET') {
    const sessionId = urlPath.split('/api/export/session/')[1].split('?')[0];
    const format = new URL(req.url, 'http://localhost').searchParams.get('format') || 'markdown';

    if (!sessionId || sessionId.includes('..') || sessionId.includes('/')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid session ID' }));
      return;
    }

    const filePath = path.join(SESSION_DIR, sessionId + '.jsonl');

    try {
      // Read session data
      const data = fs.readFileSync(filePath, 'utf8');
      const messages = data
        .split('\n')
        .filter((l) => l.trim())
        .map((line) => {
          try {
            const raw = JSON.parse(line);

            // Skip non-message types
            if (raw.type !== 'message' && raw.type !== 'toolResult') return null;

            const obj = raw.message || raw;

            // Extract text content from various formats
            let content = '';
            if (typeof obj.content === 'string') {
              content = obj.content;
            } else if (Array.isArray(obj.content)) {
              content = obj.content
                .map((item) => {
                  if (typeof item === 'string') return item;
                  if (item.type === 'text') return item.text;
                  if (item.type === 'tool_use') return `[Tool: ${item.name}]`;
                  return '';
                })
                .join('\n');
            } else if (obj.content && obj.content.text) {
              content = obj.content.text;
            }

            // Extract tool calls if present
            let toolCalls = [];
            if (Array.isArray(obj.content)) {
              toolCalls = obj.content
                .filter((item) => item.type === 'tool_use')
                .map((tool) => ({
                  name: tool.name,
                  id: tool.id,
                }));
            }

            return {
              role: obj.role || raw.type || 'assistant',
              content: content || '[No content]',
              timestamp: raw.timestamp || Date.now(),
              toolCalls: toolCalls,
            };
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);

      // Get autopsy data if available
      let autopsy = null;
      try {
        autopsy = sessionAutopsy.getReport(sessionId);
      } catch (_) {}

      // Build session data
      const sessionData = {
        sessionKey: sessionId,
        startTime: messages[0]?.timestamp || Date.now(),
        duration:
          messages.length > 1 ? messages[messages.length - 1].timestamp - messages[0].timestamp : 0,
        messages,
        autopsy,
        totalCost: autopsy?.metrics?.cost || 0,
        model: autopsy?.metrics?.model || 'N/A',
      };

      // Export based on format
      if (format === 'json') {
        const exported = sessionExporter.exportAsJSON(sessionData, true);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="session-${sessionId}.json"`,
        });
        res.end(exported);
      } else {
        // Markdown (default)
        const exported = sessionExporter.exportAsMarkdown(sessionData, {
          includeMetadata: true,
          includeSystem: false,
          includeTools: true,
          includeCost: true,
          includeTimestamps: true,
        });
        res.writeHead(200, {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="session-${sessionId}.md"`,
        });
        res.end(exported);
      }
    } catch (e) {
      const code = e.code === 'ENOENT' ? 404 : 500;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: code === 404 ? 'Session not found' : e.message }));
    }
    return;
  }

  // NEW: Cost Forecast endpoint
  if (urlPath === '/api/cost-forecast') {
    try {
      const forecast = calculateCostForecast();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(forecast));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Budget Settings Endpoints ──────────────────────────────────────────────
  if (urlPath === '/api/budget/settings' && req.method === 'GET') {
    try {
      const settings = getBudgetSettings();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(settings));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/budget/settings' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10000) req.destroy();
    });
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        const settings = updateBudgetSettings(updates);
        logInfo('Budget settings updated', updates);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, settings }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Error Analytics Endpoints ─────────────────────────────────────────────
  if (urlPath === '/api/errors/stats') {
    try {
      const stats = errorTracker.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath.startsWith('/api/errors/') && req.method === 'GET') {
    const errorId = urlPath.split('/api/errors/')[1];
    if (errorId) {
      try {
        const error = errorTracker.getErrorById(errorId);
        if (error) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(error));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Error not found' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    return;
  }

  if (urlPath === '/api/errors/record' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 50000) req.destroy();
    });
    req.on('end', () => {
      try {
        const errorData = JSON.parse(body);
        const error = errorTracker.recordError(errorData);
        logWarn('Error recorded:', error.type, error.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, error }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/errors/resolve/') && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    const errorId = urlPath.split('/api/errors/resolve/')[1];
    try {
      const success = errorTracker.markResolved(errorId);
      if (success) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Error not found' }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Memory Heatmap Endpoints ──────────────────────────────────────────────
  // Second brain composition (what memories exist)
  if (urlPath === '/api/memory/heatmap') {
    try {
      const data = await memoryHeatmap.getHeatmapData();
      // Also include access tracking data
      const accessData = {
        stats: memoryAccessTracker.getStats(),
        topMemories: memoryAccessTracker.getTopMemories(50),
        temporal: memoryAccessTracker.getTemporalHeatmap(168),
        clusters: memoryAccessTracker.getClusters(),
        recentAccesses: memoryAccessTracker.getRecentAccesses(20),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...data, accessTracking: accessData }));
    } catch (e) {
      logError('Memory heatmap error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/memory/search' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { query, limit } = JSON.parse(body);
        const patterns = await memoryHeatmap.searchPatterns(query, limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(patterns));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Session Autopsy Endpoints ───────────────────────────────────────
  if (urlPath === '/api/autopsy/recent') {
    try {
      const limit = parseInt(req.url.split('?limit=')[1] || '10', 10);
      const reports = sessionAutopsy.getRecentAutopsies(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reports));
    } catch (e) {
      logError('Autopsy recent error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath.startsWith('/api/autopsy/session/')) {
    try {
      const sessionId = urlPath.split('/api/autopsy/session/')[1];
      const report = sessionAutopsy.getAutopsy(sessionId);
      if (!report) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Autopsy not found' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(report));
      }
    } catch (e) {
      logError('Autopsy get error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/autopsy/stats') {
    try {
      const stats = sessionAutopsy.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (e) {
      logError('Autopsy stats error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Webhook Endpoints ─────────────────────────────────────────────────────
  if (urlPath === '/api/webhooks' && req.method === 'GET') {
    try {
      const webhooks = WebhookManager.getWebhooks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(webhooks));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/webhooks' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 50000) req.destroy();
    });
    req.on('end', () => {
      try {
        const webhook = JSON.parse(body);
        const created = WebhookManager.addWebhook(webhook);
        logInfo('Webhook created:', created.name);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, webhook: created }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/webhooks/') && req.method === 'PUT') {
    if (!requireAuth(req, res)) return;
    const webhookId = urlPath.split('/api/webhooks/')[1];
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 50000) req.destroy();
    });
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        const updated = WebhookManager.updateWebhook(webhookId, updates);
        if (updated) {
          logInfo('Webhook updated:', webhookId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, webhook: updated }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Webhook not found' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/webhooks/') && req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    const webhookId = urlPath.split('/api/webhooks/')[1];
    try {
      const deleted = WebhookManager.deleteWebhook(webhookId);
      if (deleted) {
        logInfo('Webhook deleted:', webhookId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Webhook not found' }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/webhooks/log' && req.method === 'GET') {
    try {
      const limit = parseInt(req.url.split('?limit=')[1] || '50', 10);
      const log = WebhookManager.getLog(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(log));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/webhooks/test' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { webhookId } = JSON.parse(body);
        const webhooks = WebhookManager.getWebhooks();
        const webhook = webhooks.find((w) => w.id === webhookId);

        if (!webhook) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Webhook not found' }));
          return;
        }

        // Trigger test event
        const results = await WebhookManager.triggerEvent(
          'test',
          {
            title: 'Test Webhook',
            message: 'This is a test notification from Rasputin Nexus Dashboard',
            fields: {
              'Test Type': 'Manual test',
              Timestamp: new Date().toISOString(),
            },
          },
          'low'
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, results }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Browser Automation Endpoints ──────────────────────────────────────────
  if (urlPath.startsWith('/api/browser/') && req.method === 'POST') {
    if (!requireAuth(req, res)) return;

    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 100000) req.destroy();
    });
    req.on('end', async () => {
      try {
        checkRateLimit(ip, 'browser');
      } catch (e) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
        return;
      }
      const action = urlPath.split('/api/browser/')[1];
      try {
        const data = body ? JSON.parse(body) : {};
        let result;

        if (action === 'launch') {
          if (!puppeteer) throw new Error('puppeteer not installed');
          if (browserSessions.size >= MAX_BROWSER_SESSIONS)
            throw new Error('Max sessions reached (3)');
          const browser = await puppeteer.launch({
            headless: 'new',
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
            ],
          });
          const page = await browser.newPage();
          await page.setViewport({ width: 1280, height: 800 });
          const sid = crypto.randomBytes(8).toString('hex');
          browserSessions.set(sid, { browser, page, createdAt: Date.now() });
          result = { sessionId: sid };
          logInfo('Browser session launched', { sessionId: sid, total: browserSessions.size });
        } else if (action === 'navigate') {
          const sess = browserSessions.get(data.sessionId);
          if (!sess) throw new Error('Invalid session');
          if (data.action === 'back') {
            await sess.page
              .goBack({ waitUntil: 'domcontentloaded', timeout: 15000 })
              .catch(() => {});
          } else if (data.action === 'forward') {
            await sess.page
              .goForward({ waitUntil: 'domcontentloaded', timeout: 15000 })
              .catch(() => {});
          } else if (data.action === 'refresh') {
            await sess.page
              .reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
              .catch(() => {});
          } else if (data.url) {
            await sess.page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          }
          const screenshot = await sess.page.screenshot({ encoding: 'base64', type: 'png' });
          const url = sess.page.url();
          result = { screenshot, url };
        } else if (action === 'click') {
          const sess = browserSessions.get(data.sessionId);
          if (!sess) throw new Error('Invalid session');
          await sess.page.mouse.click(data.x, data.y);
          await new Promise((r) => setTimeout(r, 500));
          const screenshot = await sess.page.screenshot({ encoding: 'base64', type: 'png' });
          const url = sess.page.url();
          result = { screenshot, url };
        } else if (action === 'type') {
          const sess = browserSessions.get(data.sessionId);
          if (!sess) throw new Error('Invalid session');
          if (data.selector) {
            await sess.page.waitForSelector(data.selector, { timeout: 5000 }).catch(() => {});
            await sess.page.click(data.selector).catch(() => {});
          }
          await sess.page.keyboard.type(data.text || '', { delay: 30 });
          const screenshot = await sess.page.screenshot({ encoding: 'base64', type: 'png' });
          result = { screenshot };
        } else if (action === 'screenshot') {
          const sess = browserSessions.get(data.sessionId);
          if (!sess) throw new Error('Invalid session');
          const screenshot = await sess.page.screenshot({ encoding: 'base64', type: 'png' });
          result = { screenshot };
        } else if (action === 'close') {
          const sess = browserSessions.get(data.sessionId);
          if (sess) {
            await sess.browser.close().catch(() => {});
            browserSessions.delete(data.sessionId);
            logInfo('Browser session closed', { sessionId: data.sessionId });
          }
          result = { ok: true };
        } else {
          throw new Error('Unknown action: ' + action);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Prompt Playground — query multiple models in parallel (direct provider APIs)
  if (urlPath === '/api/playground' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100000) {
        req.destroy();
      }
    });
    req.on('end', async () => {
      try {
        try {
          checkRateLimit(ip, 'playground');
        } catch (e) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
          return;
        }
        const data = JSON.parse(body);
        if (
          !data.prompt ||
          !Array.isArray(data.models) ||
          data.models.length === 0 ||
          data.models.length > 8
        ) {
          throw new Error('Need prompt (string) and models (array, max 8)');
        }
        const prompt = data.prompt.slice(0, 10000);
        const models = data.models.slice(0, 8);
        const maxTokens = Math.min(data.maxTokens || 1024, 4096);
        const temperature = data.temperature ?? 0.7;

        const results = await Promise.all(
          models.map(async (model) => {
            const r = await callPlaygroundModel(
              model,
              [{ role: 'user', content: prompt }],
              maxTokens,
              temperature
            );
            return { model, ...r };
          })
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results, prompt }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // List available models (from registry, no LiteLLM needed)
  if (urlPath === '/api/playground/models') {
    if (!requireAuth(req, res)) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const models = PLAYGROUND_MODELS.map((m) => ({ id: m.id, owned_by: m.owned_by }));
    res.end(JSON.stringify({ models }));
    return;
  }

  // TTS endpoint
  if (urlPath === '/api/tts' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (!data.text) throw new Error('Missing text');
        const text = data.text.slice(0, 5000); // Limit text length
        const voiceId = data.voiceId || '21m00Tcm4TlvDq8ikWAM'; // Default: Rachel

        if (!ELEVENLABS_API_KEY) {
          // Fallback: return a special response to trigger browser TTS
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ fallback: true, text }));
          return;
        }

        // Call ElevenLabs API
        const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
        const options = {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY,
          },
        };

        const apiReq = https.request(ttsUrl, options, (apiRes) => {
          if (apiRes.statusCode !== 200) {
            res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ElevenLabs API error' }));
            return;
          }

          // Buffer the entire response so we can send Content-Length
          // (fixes browser audio playback issues with chunked transfer)
          const chunks = [];
          apiRes.on('data', (chunk) => chunks.push(chunk));
          apiRes.on('end', () => {
            const buf = Buffer.concat(chunks);
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Content-Length': buf.length,
              'Cache-Control': 'no-cache',
            });
            res.end(buf);
          });
        });

        apiReq.on('error', (err) => {
          logErr('TTS API error', { error: err.message });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });

        apiReq.write(
          JSON.stringify({
            text,
            model_id: 'eleven_monolingual_v1',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          })
        );
        apiReq.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // HTTP multipart file upload (for huge files — no WS size limits)
  // ─── Sandboxed Code Execution ───────────────────────────────────────────────
  if (urlPath === '/api/execute' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        try {
          checkRateLimit(ip, 'execute');
        } catch (e) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
          return;
        }
        const { code, language, timeout: userTimeout } = JSON.parse(body);
        if (!code || !language || !code.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing code or language' }));
          return;
        }
        const timeout = Math.min(Math.max(parseInt(userTimeout) || 30, 1), 120);
        const langMap = {
          python: ['python3', '-c'],
          javascript: ['node', '-e'],
          bash: ['bash', '-c'],
        };
        const cmd = langMap[language];
        if (!cmd) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unsupported language: ' + language }));
          return;
        }
        const startTime = Date.now();
        const { execFile: ef } = require('child_process');
        const args = [
          'run',
          '--rm',
          '--network',
          'none',
          '--memory',
          '512m',
          '--cpus',
          '1',
          '--pids-limit',
          '256',
          '--read-only',
          '--tmpfs',
          '/tmp:rw,noexec,size=64m',
          'alfie-sandbox',
          ...cmd,
          code,
        ];
        const child = ef(
          'docker',
          args,
          { timeout: timeout * 1000, maxBuffer: 2 * 1024 * 1024 },
          (err, stdout, stderr) => {
            const runtime_ms = Date.now() - startTime;
            const exitCode = err ? err.code || 1 : 0;
            const output = stdout || '';
            const error = stderr || (err && !err.killed ? err.message : '') || '';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ output, error, exitCode, runtime_ms }));
          }
        );
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath === '/api/execute/install' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { packages } = JSON.parse(body);
        if (!packages || !Array.isArray(packages) || packages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing packages array' }));
          return;
        }
        // Sanitize package names
        const safe = packages.map((p) => p.replace(/[^a-zA-Z0-9._-]/g, '')).filter(Boolean);
        if (safe.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No valid package names' }));
          return;
        }
        const { exec: ex } = require('child_process');
        const installCmd = `docker exec alfie-sandbox-builder pip install ${safe.join(' ')} 2>&1 || docker run --name alfie-sandbox-builder alfie-sandbox pip install ${safe.join(' ')} 2>&1 && docker commit alfie-sandbox-builder alfie-sandbox && docker rm alfie-sandbox-builder`;
        ex(installCmd, { timeout: 120000 }, (err, stdout, stderr) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: !err,
              output: stdout || '',
              error: stderr || (err ? err.message : ''),
            })
          );
        });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Open upload endpoint (no auth - for admin's direct uploads)
  if (urlPath.startsWith('/api/upload-open') && req.method === 'POST') {
    const urlObj2 = new URL(req.url, `http://${req.headers.host}`);
    let fileName2 = urlObj2.searchParams.get('name') || 'upload';
    fileName2 = path.basename(fileName2).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath2 = path.join(UPLOADS_DIR, `${Date.now()}-${fileName2}`);
    const ws3 = fs.createWriteStream(filePath2);
    let received2 = 0;
    req.on('data', (chunk) => {
      received2 += chunk.length;
      ws3.write(chunk);
    });
    req.on('end', () => {
      ws3.end(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            name: fileName2,
            size: received2,
            humanSize: humanSize(received2),
          })
        );
        logInfo('Open file upload', { name: fileName2, size: humanSize(received2) });
      });
    });
    req.on('error', (e) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  if (urlPath === '/api/upload' && req.method === 'POST') {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_FILE_SIZE) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `File too large (max ${humanSize(MAX_FILE_SIZE)})` }));
      return;
    }
    // Extract filename from Content-Disposition or query param
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    let fileName = urlObj.searchParams.get('name') || 'upload';
    fileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(UPLOADS_DIR, `${Date.now()}-${fileName}`);
    const ws2 = fs.createWriteStream(filePath);
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      ws2.write(chunk);
    });
    req.on('end', () => {
      ws2.end(() => {
        const headerBuf = Buffer.alloc(16);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, headerBuf, 0, 16, 0);
        fs.closeSync(fd);
        const mime = detectFileType(fileName, headerBuf);
        const url = `/uploads/${path.basename(filePath)}`;
        const resp = {
          ok: true,
          name: fileName,
          url,
          size: received,
          mime,
          humanSize: humanSize(received),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resp));
        broadcast({
          type: 'file_shared',
          name: fileName,
          url,
          size: received,
          mime,
          humanSize: humanSize(received),
        });
        logInfo('HTTP file upload', { name: fileName, size: humanSize(received), mime });
      });
    });
    req.on('error', (e) => {
      ws2.destroy();
      try {
        fs.unlinkSync(filePath);
      } catch {}
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // ─── Research API ───────────────────────────────────────────────────────────
  const { ResearchJob } = require('./research-engine.js');
  const RESEARCH_DIR = path.join(__dirname, 'research-results');
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });

  // In-memory job store (also persisted to disk)
  if (!global._researchJobs) global._researchJobs = new Map();
  const researchJobs = global._researchJobs;

  if (urlPath === '/api/research' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        try {
          checkRateLimit(ip, 'research');
        } catch (e) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
          return;
        }
        const { question } = JSON.parse(body);
        if (!question || question.length < 3 || question.length > 1000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Question too short' }));
        }
        const job = new ResearchJob(question);
        researchJobs.set(job.id, job);

        // Forward progress to WebSocket clients
        job.on('progress', (p) => broadcast({ type: 'research_progress', jobId: job.id, ...p }));
        job.on('queries', (q) =>
          broadcast({ type: 'research_queries', jobId: job.id, queries: q })
        );
        job.on('sources', (s) =>
          broadcast({ type: 'research_sources', jobId: job.id, sources: s })
        );
        job.on('source_update', (u) =>
          broadcast({ type: 'research_source_update', jobId: job.id, ...u })
        );
        job.on('synthesis_chunk', (data) =>
          broadcast({ type: 'research_synthesis_chunk', jobId: job.id, chunk: data.chunk, fullText: data.fullText })
        );
        job.on('complete', (result) => {
          broadcast({ type: 'research_complete', jobId: job.id });
          // Persist to disk
          try {
            fs.writeFileSync(
              path.join(RESEARCH_DIR, job.id + '.json'),
              JSON.stringify(result, null, 2)
            );
          } catch (_) {}
        });
        job.on('error', (e) => {
          broadcast({ type: 'research_error', jobId: job.id, error: e.message });
          try {
            fs.writeFileSync(
              path.join(RESEARCH_DIR, job.id + '.json'),
              JSON.stringify(job.toJSON(), null, 2)
            );
          } catch (_) {}
        });

        // Start async
        job.run();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobId: job.id, status: 'started' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath === '/api/research' && req.method === 'GET') {
    // List past research jobs
    const jobs = [];
    // From memory
    for (const [, job] of researchJobs) {
      jobs.push({
        id: job.id,
        question: job.question,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });
    }
    // From disk (ones not in memory)
    try {
      const files = fs.readdirSync(RESEARCH_DIR).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        const id = f.replace('.json', '');
        if (!researchJobs.has(id)) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, f), 'utf8'));
            jobs.push({
              id: data.id,
              question: data.question,
              status: data.status,
              startedAt: data.startedAt,
              completedAt: data.completedAt,
            });
          } catch (_) {}
        }
      }
    } catch (_) {}
    jobs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobs }));
    return;
  }

  if (urlPath.startsWith('/api/research/') && req.method === 'GET') {
    const jobId = urlPath.split('/api/research/')[1];
    // Check memory first
    const memJob = researchJobs.get(jobId);
    if (memJob) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(memJob.toJSON()));
      return;
    }
    // Check disk
    const diskPath = path.join(RESEARCH_DIR, jobId + '.json');
    try {
      const data = fs.readFileSync(diskPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
      return;
    } catch (_) {}
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Job not found' }));
    return;
  }

  if (urlPath.startsWith('/api/research/') && req.method === 'DELETE') {
    const jobId = urlPath.split('/api/research/')[1];
    researchJobs.delete(jobId);
    try {
      fs.unlinkSync(path.join(RESEARCH_DIR, jobId + '.json'));
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deleted: jobId }));
    return;
  }

  // ─── Knowledge Base API ─────────────────────────────────────────────────────
  const WORKSPACE_ROOT = '/home/admin/.openclaw/workspace';
  const KNOWLEDGE_DIRS = [
    { name: 'workspace', path: WORKSPACE_ROOT, pattern: /\.md$/i, shallow: true },
    { name: 'memory', path: path.join(WORKSPACE_ROOT, 'memory'), pattern: null, shallow: false },
    { name: 'tools', path: path.join(WORKSPACE_ROOT, 'tools'), pattern: null, shallow: false },
    {
      name: 'council_results',
      path: path.join(WORKSPACE_ROOT, 'council_results'),
      pattern: null,
      shallow: false,
    },
  ];

  if (urlPath === '/api/knowledge') {
    try {
      const tree = [];
      for (const dir of KNOWLEDGE_DIRS) {
        try {
          const dirStat = fs.statSync(dir.path);
          if (!dirStat.isDirectory()) continue;
          const children = scanDir(dir.path, dir.pattern, dir.shallow ? 0 : 3, 0);
          tree.push({ name: dir.name, path: dir.name, type: 'dir', children });
        } catch (_) {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tree }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath.startsWith('/api/knowledge/')) {
    if (!requireAuth(req, res)) return;

    const relPath = decodeURIComponent(urlPath.slice('/api/knowledge/'.length));

    // Block path traversal attempts
    if (relPath.includes('..') || relPath.includes('/.') || relPath.startsWith('/')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Path traversal detected' }));
      return;
    }

    const segments = relPath.split('/').filter((s) => s && s !== '.' && s !== '..');
    const dirName = segments[0];
    const dirDef = KNOWLEDGE_DIRS.find((d) => d.name === dirName);
    if (!dirDef) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown directory' }));
      return;
    }
    const filePath2 =
      segments.length > 1 ? path.join(dirDef.path, ...segments.slice(1)) : dirDef.path;
    const resolved = path.resolve(filePath2);
    if (
      !resolved.startsWith(path.resolve(dirDef.path) + path.sep) &&
      resolved !== path.resolve(dirDef.path)
    ) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }
    try {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const children = scanDir(resolved, null, 2, 0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'dir', children }));
        return;
      }
      const content = fs.readFileSync(resolved, 'utf8');
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'file',
          name: path.basename(resolved),
          path: relPath,
          size: stat.size,
          modified: stat.mtimeMs,
          ext,
          content,
          wordCount: content.split(/\s+/).filter(Boolean).length,
        })
      );
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
    }
    return;
  }

  // ─── Demo Mode ───────────────────────────────────────────────────────────────
  if (urlPath === '/demo') {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      // Redirect to index.html with demo flag
      res.writeHead(302, { Location: '/?demo=true' });
      res.end();
    });
    return;
  }

  // ─── Export Endpoints ──────────────────────────────────────────────────────
  const EXECUTIONS_FILE = path.join(__dirname, 'executions.json');
  const SHARES_FILE = path.join(__dirname, 'shares.json');

  // Helper: load JSON file safely
  function loadJsonFile(fp, fallback) {
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (_) {
      return fallback;
    }
  }

  // GET /api/export/research/:jobId
  if (urlPath.match(/^\/api\/export\/research\/[\w-]+$/) && req.method === 'GET') {
    const jobId = urlPath.split('/api/export/research/')[1];
    try {
      let data;
      const memJob = (global._researchJobs || new Map()).get(jobId);
      if (memJob) {
        data = memJob.toJSON();
      } else {
        data = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, jobId + '.json'), 'utf8'));
      }

      // Build markdown
      let md = `# Research Report: ${data.question || 'Unknown'}\n\n`;
      md += `**Status:** ${data.status || 'unknown'}\n`;
      md += `**Started:** ${data.startedAt ? new Date(data.startedAt).toISOString() : 'N/A'}\n`;
      md += `**Completed:** ${data.completedAt ? new Date(data.completedAt).toISOString() : 'N/A'}\n\n`;
      if (data.sources && data.sources.length > 0) {
        md += `## Sources\n\n`;
        data.sources.forEach((s, i) => {
          md += `${i + 1}. [${s.title || s.url}](${s.url})\n`;
        });
        md += '\n';
      }
      if (data.report) {
        md += `## Report\n\n${data.report}\n`;
      } else if (data.synthesis) {
        md += `## Synthesis\n\n${data.synthesis}\n`;
      }

      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="research-${jobId}.md"`,
      });
      res.end(md);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Research job not found' }));
    }
    return;
  }

  // GET /api/export/session/:sessionId
  if (urlPath.match(/^\/api\/export\/session\/[\w.-]+$/) && req.method === 'GET') {
    const sessionId = urlPath.split('/api/export/session/')[1];
    if (sessionId.includes('..')) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const filePath = path.join(SESSION_DIR, sessionId + '.jsonl');
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const lines = data.split('\n').filter((l) => l.trim());
      let md = `# Session Transcript: ${sessionId}\n\n`;
      md += `**Messages:** ${lines.length}\n\n---\n\n`;

      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          const obj = raw.message || raw;
          const ts = raw.timestamp || raw.ts;
          const time = ts ? new Date(ts).toISOString() : '';

          if (obj.role === 'user' || obj.role === 'human') {
            const text =
              typeof obj.content === 'string'
                ? obj.content
                : Array.isArray(obj.content)
                  ? obj.content
                      .filter((b) => b.type === 'text')
                      .map((b) => b.text)
                      .join(' ')
                  : '';
            if (text) md += `### 🧑 User (${time})\n\n${text.slice(0, 2000)}\n\n`;
          } else if (obj.role === 'assistant') {
            const texts = [];
            if (Array.isArray(obj.content)) {
              for (const b of obj.content) {
                if (b.type === 'text' && b.text) texts.push(b.text);
                if (b.type === 'tool_use') texts.push(`*Tool: ${b.name}*`);
              }
            } else if (typeof obj.content === 'string') {
              texts.push(obj.content);
            }
            if (texts.length)
              md += `### 🤖 Assistant (${time})\n\n${texts.join('\n\n').slice(0, 5000)}\n\n`;
          } else if (obj.role === 'tool') {
            const result =
              typeof obj.content === 'string'
                ? obj.content.slice(0, 500)
                : JSON.stringify(obj.content).slice(0, 500);
            md += `### 🔧 Tool Result (${time})\n\n\`\`\`\n${result}\n\`\`\`\n\n`;
          }
        } catch (_) {}
      }

      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="session-${sessionId}.md"`,
      });
      res.end(md);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }

  // POST /api/execute/save — store execution server-side
  if (urlPath === '/api/execute/save' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { code, language, output, error: execError, runtime_ms } = JSON.parse(body);
        const executions = loadJsonFile(EXECUTIONS_FILE, []);
        const id = `exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        executions.push({
          id,
          code,
          language,
          output,
          error: execError,
          runtime_ms,
          ts: Date.now(),
        });
        // Keep last 100
        while (executions.length > 100) executions.shift();
        fs.writeFileSync(EXECUTIONS_FILE, JSON.stringify(executions, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/export/execution/:id
  if (urlPath.match(/^\/api\/export\/execution\/[\w-]+$/) && req.method === 'GET') {
    const execId = urlPath.split('/api/export/execution/')[1];
    const executions = loadJsonFile(EXECUTIONS_FILE, []);
    const exec = executions.find((e) => e.id === execId);
    if (!exec) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    let md = `# Code Execution: ${exec.id}\n\n`;
    md += `**Language:** ${exec.language || 'unknown'}\n`;
    md += `**Runtime:** ${exec.runtime_ms || 0}ms\n`;
    md += `**Time:** ${new Date(exec.ts).toISOString()}\n\n`;
    md += `## Code\n\n\`\`\`${exec.language || ''}\n${exec.code || ''}\n\`\`\`\n\n`;
    md += `## Output\n\n\`\`\`\n${exec.output || '(no output)'}\n\`\`\`\n`;
    if (exec.error) md += `\n## Errors\n\n\`\`\`\n${exec.error}\n\`\`\`\n`;

    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exec.id}.md"`,
    });
    res.end(md);
    return;
  }

  // POST /api/council/stream — SSE streaming council query
  if (urlPath === '/api/council/stream' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      if (body.length < 1e5) body += c;
    });
    req.on('end', () => {
      try {
        const { question, mode, models } = JSON.parse(body);
        if (!question) throw new Error('question required');
        const m = mode && ['council', 'synthesis', 'auto'].includes(mode) ? mode : 'auto';
        const args = [
          '/home/admin/.openclaw/workspace/tools/ai_council.py',
          '--mode',
          m,
          '--stream',
          '--json',
        ];
        if (models && Array.isArray(models) && models.length) {
          args.push('--models', models.join(','));
        }
        args.push(question);
        const { spawn } = require('child_process');
        const proc = spawn('python3', args, {
          env: { ...process.env, PYTHONUNBUFFERED: '1' },
          cwd: '/home/admin/.openclaw/workspace',
        });
        console.log('[council-stream] spawn args:', JSON.stringify(args));

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(':\n\n'); // SSE comment keepalive

        let stdoutBuf = '';
        let stderrBuf = '';
        let fullResult = null;
        let closed = false;
        proc.stdout.on('data', (d) => {
          stdoutBuf += d.toString();
          const lines = stdoutBuf.split('\n');
          stdoutBuf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              if (evt.event === 'done' && evt.result) fullResult = evt.result;
              if (!closed) res.write(`data: ${line}\n\n`);
            } catch (_) {}
          }
        });
        proc.stderr.on('data', (d) => {
          stderrBuf += d.toString();
        });
        proc.on('close', (code, signal) => {
          console.log(
            `[council-stream] proc closed code=${code} signal=${signal} stderr=${stderrBuf.slice(0, 200)}`
          );
          // Flush any remaining stdout
          if (stdoutBuf.trim()) {
            try {
              const evt = JSON.parse(stdoutBuf.trim());
              if (evt.event === 'done' && evt.result) fullResult = evt.result;
              if (!closed) res.write(`data: ${stdoutBuf.trim()}\n\n`);
            } catch (_) {}
          }
          if (fullResult) {
            try {
              const histFile = path.join(__dirname, '.council_history.json');
              let hist = [];
              try {
                hist = JSON.parse(fs.readFileSync(histFile, 'utf8'));
              } catch (_) {}
              hist.unshift({ question, mode: m, timestamp: Date.now(), result: fullResult });
              if (hist.length > 50) hist = hist.slice(0, 50);
              fs.writeFileSync(histFile, JSON.stringify(hist));
            } catch (_) {}
          }
          if (!closed) {
            closed = true;
            res.write(
              `data: {"event":"close","code":${code},"stderr":${JSON.stringify((stderrBuf || '').slice(-300))}}\n\n`
            );
            res.end();
          }
        });
        proc.on('error', (err) => {
          if (!closed) {
            closed = true;
            res.write(`data: {"event":"error","message":${JSON.stringify(err.message)}}\n\n`);
            res.end();
          }
        });
        // Kill process if the RESPONSE connection drops (client disconnect)
        res.on('close', () => {
          if (!closed) {
            closed = true;
            try {
              proc.kill();
            } catch (_) {}
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/council — AI Council query
  if (urlPath === '/api/council' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      if (body.length < 1e5) body += c;
    });
    req.on('end', () => {
      try {
        const { question, mode, models } = JSON.parse(body);
        if (!question) throw new Error('question required');
        const m = mode && ['council', 'synthesis', 'auto'].includes(mode) ? mode : 'auto';
        const args = ['/home/admin/.openclaw/workspace/tools/ai_council.py', '--mode', m, '--json'];
        if (models && Array.isArray(models) && models.length) {
          args.push('--models', models.join(','));
        }
        args.push(question);
        const { spawn } = require('child_process');
        const proc = spawn('python3', args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
        let stdout = '',
          stderr = '';
        proc.stdout.on('data', (d) => (stdout += d));
        proc.stderr.on('data', (d) => (stderr += d));
        proc.on('close', (code) => {
          // Extract JSON from stdout (it prints ANSI + JSON at end)
          let result;
          try {
            // Find the JSON object in output (after --json flag prints it)
            const jsonMatch = stdout.match(/\{[\s\S]*"verdict"[\s\S]*\}$/m);
            if (jsonMatch) {
              result = JSON.parse(jsonMatch[0]);
            } else {
              // Try parsing entire stdout
              result = JSON.parse(stdout);
            }
          } catch (parseErr) {
            result = {
              error: 'Failed to parse council output',
              code,
              stderr: stderr.slice(-500),
              stdout: stdout.slice(-2000),
            };
          }
          // Save to history
          try {
            const histFile = path.join(__dirname, '.council_history.json');
            let hist = [];
            try {
              hist = JSON.parse(fs.readFileSync(histFile, 'utf8'));
            } catch (_) {}
            hist.unshift({ question, mode: m, timestamp: Date.now(), result });
            if (hist.length > 50) hist = hist.slice(0, 50);
            fs.writeFileSync(histFile, JSON.stringify(hist));
          } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        });
        proc.on('error', (err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/council/history — past queries
  if (urlPath === '/api/council/history' && req.method === 'GET') {
    try {
      const histFile = path.join(__dirname, '.council_history.json');
      const hist = JSON.parse(fs.readFileSync(histFile, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hist));
    } catch (_) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  // GET /api/council/models — available models
  if (urlPath === '/api/council/models' && req.method === 'GET') {
    const models = {
      frontier: [
        { key: 'opus', name: 'Claude Opus 4.6', provider: 'anthropic' },
        { key: 'gpt52', name: 'GPT-5.2', provider: 'openrouter' },
        { key: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'openrouter' },
        { key: 'grok-reason', name: 'Grok 4.1 Reasoning', provider: 'xai' },
      ],
      strong: [
        { key: 'sonnet', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
        { key: 'gemini-flash', name: 'Gemini 3 Flash', provider: 'openrouter' },
        { key: 'grok-fast', name: 'Grok 4.1 Fast', provider: 'xai' },
      ],
      fast: [],
      local: [],
      defaults: {
        synthesis: ['sonnet', 'gpt52', 'gemini-flash', 'grok-fast'],
        council: ['opus', 'gpt52', 'gemini-3-pro', 'grok-reason', 'sonnet', 'gemini-flash'],
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(models));
    return;
  }

  // POST /api/share — create shareable link
  if (urlPath === '/api/share' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { type, id } = JSON.parse(body);
        if (!type || !id) throw new Error('type and id required');
        const token = crypto.randomBytes(16).toString('hex');
        const shares = loadJsonFile(SHARES_FILE, {});
        shares[token] = { type, id, createdAt: Date.now() };
        fs.writeFileSync(SHARES_FILE, JSON.stringify(shares, null, 2));
        const shareUrl = `/share/${token}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token, url: shareUrl }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /share/:token — serve shared content
  // ─── Model Leaderboard API ────────────────────────────────────────────────
  if (urlPath === '/api/model-leaderboard' && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const sortBy = url.searchParams.get('sort') || 'value';

      const leaderboard = modelLeaderboard.getLeaderboard(sortBy);
      const summary = modelLeaderboard.getSummary();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ leaderboard, summary }));
      logInfo('Model leaderboard fetched', { sortBy, models: leaderboard.length });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      logErr('Model leaderboard fetch failed', { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/model-leaderboard/feedback' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { modelName, thumbsUp } = JSON.parse(body);
        if (!modelName || thumbsUp === undefined) throw new Error('Missing modelName or thumbsUp');

        modelLeaderboard.recordFeedback(modelName, thumbsUp);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        logInfo('Model feedback recorded', { modelName, thumbsUp });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
        logErr('Model feedback failed', { error: e.message });
      }
    });
    return;
  }

  // ─── Session Recipes API ─────────────────────────────────────────────────
  if (urlPath === '/api/recipes' && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const tag = url.searchParams.get('tag');
      const query = url.searchParams.get('query');
      const sort = url.searchParams.get('sort');

      const filters = {};
      if (tag) filters.tag = tag;
      if (query) filters.query = query;
      if (sort) filters.sort = sort;

      const recipes = sessionRecipes.getRecipes(filters);
      const stats = sessionRecipes.getStats();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ recipes, stats }));
      logInfo('Recipes fetched', { count: recipes.length, filters });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      logErr('Recipes fetch failed', { error: e.message });
    }
    return;
  }

  if (urlPath === '/api/recipes' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { name, description, sessionData, tags } = JSON.parse(body);
        if (!name || !sessionData) throw new Error('Missing name or sessionData');

        const recipe = sessionRecipes.createRecipe(
          name,
          description || '',
          sessionData,
          tags || []
        );

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, recipe }));
        logInfo('Recipe created', { name, id: recipe.id });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
        logErr('Recipe creation failed', { error: e.message });
      }
    });
    return;
  }

  if (urlPath.match(/^\/api\/recipes\/[a-f0-9]+$/) && req.method === 'GET') {
    const recipeId = urlPath.split('/api/recipes/')[1];
    try {
      const recipe = sessionRecipes.getRecipe(recipeId);
      if (!recipe) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Recipe not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ recipe }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath.match(/^\/api\/recipes\/[a-f0-9]+\/use$/) && req.method === 'POST') {
    const recipeId = urlPath.split('/api/recipes/')[1].replace('/use', '');
    try {
      const recipe = sessionRecipes.recordUsage(recipeId);
      if (!recipe) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Recipe not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, recipe }));
      logInfo('Recipe used', { id: recipeId, useCount: recipe.useCount });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath.match(/^\/api\/recipes\/[a-f0-9]+$/) && req.method === 'DELETE') {
    const recipeId = urlPath.split('/api/recipes/')[1];
    try {
      const success = sessionRecipes.deleteRecipe(recipeId);
      if (!success) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Recipe not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      logInfo('Recipe deleted', { id: recipeId });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/recipes/suggest' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { query, limit } = JSON.parse(body);
        const suggestions = sessionRecipes.suggestRecipes(query, limit || 3);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ suggestions }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Session Reports API ────────────────────────────────────────────────
  if (urlPath === '/api/autopsy/recent' && req.method === 'GET') {
    try {
      const recent = sessionAutopsy.getRecentAutopsies(20);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recent));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (urlPath === '/api/reports/share' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { sessionKey, options } = JSON.parse(body);
        const token = sessionReports.createShare(sessionKey, options);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/reports/download/') && req.method === 'GET') {
    try {
      const sessionId = urlPath.split('/download/')[1];
      const format = new URL(req.url, `http://${req.headers.host}`).searchParams.get('format') || 'md';
      
      // Get session from autopsy or memory/disk (stub for now, assuming autopsy exists)
      const autopsy = sessionAutopsy.getAutopsy(sessionId);
      if (!autopsy) {
        res.writeHead(404);
        res.end('Session autopsy not found');
        return;
      }
      
      // For a real production app, we would load the full session data here
      // This is a simplified version for the POC
      const sessionData = { 
          sessionKey: sessionId, 
          messages: [], 
          toolCalls: autopsy.toolAnalysis.byTool.map(t => ({ name: t.name, duration: t.duration })),
          totalCost: autopsy.metrics.cost,
          duration: autopsy.metrics.duration,
          autopsy
      };
      
      let content, mime;
      if (format === 'json') {
          content = sessionExporter.exportAsJSON(sessionData);
          mime = 'application/json';
      } else {
          content = sessionExporter.exportAsMarkdown(sessionData);
          mime = 'text/markdown';
      }
      
      res.writeHead(200, { 
          'Content-Type': mime,
          'Content-Disposition': `attachment; filename="report_${sessionId}.${format}"`
      });
      res.end(content);
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
    return;
  }

  if (urlPath.match(/^\/share\/[a-f0-9]+$/) && req.method === 'GET') {
    const token = urlPath.split('/share/')[1];
    const shares = loadJsonFile(SHARES_FILE, {});
    const share = shares[token];
    if (!share) {
      res.writeHead(404);
      res.end('Share not found');
      return;
    }

    // Redirect to the appropriate export endpoint
    let exportUrl = '';
    if (share.type === 'research') exportUrl = `/api/export/research/${share.id}`;
    else if (share.type === 'session') exportUrl = `/api/export/session/${share.id}`;
    else if (share.type === 'execution') exportUrl = `/api/export/execution/${share.id}`;
    else {
      res.writeHead(400);
      res.end('Unknown share type');
      return;
    }

    // Serve inline (not download) for shared links
    res.writeHead(302, { Location: exportUrl });
    res.end();
    return;
  }

  // Serve workspace files (files browser)
  if (urlPath.startsWith('/files')) {
    const http2 = require('http');
    const proxyReq = http2.request(
      {
        hostname: '127.0.0.1',
        port: 5556,
        path: urlPath.replace(/^\/files/, '') || '/',
        method: req.method,
        headers: { ...req.headers, host: 'localhost:5556' },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', () => {
      res.writeHead(502);
      res.end('File server unavailable');
    });
    req.pipe(proxyReq);
    return;
  }

  // Serve uploads
  if (urlPath.startsWith('/uploads/')) {
    const fp = path.join(UPLOADS_DIR, path.basename(urlPath));
    return serveFile(req, fp, res);
  }

  // Redirect extensionless routes to .html
  if (urlPath !== '/' && !path.extname(urlPath)) {
    const htmlPath = path.join(PUBLIC_DIR, urlPath + '.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(302, { Location: urlPath + '.html' });
      res.end();
      return;
    }
  }

  // Serve static
  let staticPath = urlPath === '/' ? '/index.html' : urlPath;
  serveFile(req, path.join(PUBLIC_DIR, staticPath), res);
});

function serveFile(req, filePath, res) {
  // Prevent traversal
  const resolved = path.resolve(filePath);
  if (
    !resolved.startsWith(path.resolve(PUBLIC_DIR)) &&
    !resolved.startsWith(path.resolve(UPLOADS_DIR))
  ) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    // Intelligent caching based on file type
    let cacheControl;
    if (ext === '.html') {
      // HTML: short cache for faster updates
      cacheControl = 'no-cache, no-store, must-revalidate'; // 5 minutes
    } else if (['.js', '.css', '.woff2', '.woff', '.ttf'].includes(ext)) {
      // Static assets: long cache with revalidation
      cacheControl = 'public, max-age=3600, must-revalidate'; // 1 hour
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext)) {
      // Images: very long cache
      cacheControl = 'public, max-age=86400, immutable'; // 24 hours
    } else {
      // Everything else: no cache
      cacheControl = 'no-cache, no-store, must-revalidate';
    }

    const headers = {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    };

    // Gzip compress text responses if client accepts
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (isCompressible(contentType) && acceptEncoding.includes('gzip') && data.length > 1024) {
      zlib.gzip(data, (err, compressed) => {
        if (err) {
          res.writeHead(200, headers);
          res.end(data);
        } else {
          headers['Content-Encoding'] = 'gzip';
          headers['Vary'] = 'Accept-Encoding';
          res.writeHead(200, headers);
          res.end(compressed);
        }
      });
    } else {
      res.writeHead(200, headers);
      res.end(data);
    }
  });
}

// ─── WebSocket Upgrade ────────────────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers['upgrade']?.toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  const accept = computeAccept(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  const ip = req.socket.remoteAddress || 'unknown';
  handleWsConnection(socket, ip);
});

// ─── Start ────────────────────────────────────────────────────────────────────
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

server.listen(PORT, async () => {
  logInfo('ALFIE Nexus server v2.0 started', {
    port: PORT,
    public: PUBLIC_DIR,
    sessions: SESSION_DIR,
  });

  // Log OAuth configuration status
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_JWT_SECRET) {
    logInfo('Google OAuth configured', {
      clientId: GOOGLE_CLIENT_ID.slice(0, 20) + '...',
      redirectUri: GOOGLE_REDIRECT_URI,
    });
  } else {
    logWarn('Google OAuth not configured', {
      hasClientId: !!GOOGLE_CLIENT_ID,
      hasClientSecret: !!GOOGLE_CLIENT_SECRET,
      hasJwtSecret: !!GOOGLE_JWT_SECRET,
      message: 'Create .env file from .env.template to enable Google OAuth',
    });
  }

  await initServerCryptoKeys();
  startGatewayBridge();
  setInterval(emitTelemetry, TELEMETRY_INTERVAL_FAST);
  ManusBackend.init(broadcast, requireAuth);
});

server.on('error', (e) => {
  logErr('Server error', { error: e.message });
});
process.on('uncaughtException', (e) => {
  logErr('Uncaught exception', { error: e.message, stack: e.stack });
});
process.on('unhandledRejection', (e) => {
  logErr('Unhandled rejection', { error: String(e) });
});

// Graceful shutdown
function shutdown(signal) {
  saveCosts();
  ManusBackend.shutdown();
  logInfo('Shutdown initiated', { signal });
  clearInterval(pingInterval);
  if (dirWatcher) dirWatcher.close();

  // Close gateway WebSocket
  if (gatewayReconnectTimer) clearTimeout(gatewayReconnectTimer);
  if (gatewayWs) {
    try {
      gatewayWs.close();
    } catch (_) {}
  }

  for (const socket of clients) {
    wsClose(socket, 1001, 'server shutting down');
  }
  server.close(() => {
    logInfo('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
