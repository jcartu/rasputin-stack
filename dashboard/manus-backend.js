// ─── Manus Backend — Real-time Control Interface Backend ──────────────────────
// Provides: Terminal execution, live logs, agent activity, system metrics, tasks
// All streamed via the existing WebSocket broadcast system in server.js
// Usage: const manus = require('./manus-backend.js'); manus.init(broadcastFn, requireAuthFn);

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_DIR = '/home/admin/.openclaw/agents/main/sessions';
const WORKSPACE_DIR = '/home/admin/.openclaw/workspace';
const COMMAND_HISTORY_FILE = path.join(__dirname, '.manus_cmd_history.json');

// ─── State ────────────────────────────────────────────────────────────────────
let broadcastFn = null;
let requireAuthFn = null;
const activeTerminals = new Map(); // sessionId → { proc, output, cwd }
const logTailers = new Map(); // name → { proc, buffer }
const metricsInterval = { ref: null };
const logsInterval = { ref: null };
const agentInterval = { ref: null };

// Command history persistence
let commandHistory = [];
try {
  commandHistory = JSON.parse(fs.readFileSync(COMMAND_HISTORY_FILE, 'utf8'));
} catch (_) {}
function saveCommandHistory() {
  try {
    // Keep last 500 commands
    if (commandHistory.length > 500) commandHistory = commandHistory.slice(-500);
    fs.writeFileSync(COMMAND_HISTORY_FILE, JSON.stringify(commandHistory));
  } catch (_) {}
}

// ─── Command Security ─────────────────────────────────────────────────────────
const BLOCKED_COMMANDS = [
  /\brm\s+(-rf?|--force)\s+\//, // rm -rf /
  /\bmkfs\b/, // format disk
  /\bdd\s+.*of=\/dev\//, // dd to device
  /:\(\)\s*\{/, // fork bomb
  /\bshutdown\b/, // shutdown
  /\breboot\b/, // reboot
  /\bhalt\b/, // halt
  /\binit\s+0\b/, // init 0
  />\s*\/dev\/sd/, // write to disk device
  /\bchmod\s+777\s+\//, // chmod 777 /
  /\bchown\s+.*\s+\//, // chown /
];

const ALLOWED_PREFIXES = [
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'du',
  'df',
  'free',
  'top',
  'htop',
  'ps',
  'uptime',
  'whoami',
  'hostname',
  'uname',
  'date',
  'nvidia-smi',
  'pm2',
  'docker',
  'git',
  'node',
  'python3',
  'python',
  'pip',
  'npm',
  'curl',
  'wget',
  'ping',
  'traceroute',
  'nslookup',
  'dig',
  'systemctl',
  'journalctl',
  'netstat',
  'ss',
  'lsof',
  'ip',
  'ifconfig',
  'echo',
  'env',
  'printenv',
  'which',
  'whereis',
  'file',
  'stat',
  'tree',
  'jq',
  'sed',
  'awk',
  'sort',
  'uniq',
  'cut',
  'tr',
  'xargs',
  'tee',
  'cd',
  'pwd',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'ln',
  'chmod',
  'chown',
  'tar',
  'gzip',
  'gunzip',
  'zip',
  'unzip',
  'opencode',
  'openclaw',
  'ollama',
  'qdrant',
  'sqlite3',
  'redis-cli',
  'mongo',
  'psql',
];

function validateCommand(cmd) {
  const trimmed = cmd.trim();
  if (!trimmed) return { ok: false, reason: 'Empty command' };

  // Block dangerous patterns
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `Blocked: dangerous command pattern detected` };
    }
  }

  // Max command length
  if (trimmed.length > 4096) {
    return { ok: false, reason: 'Command too long (max 4096 chars)' };
  }

  return { ok: true };
}

// ─── Terminal Execution ───────────────────────────────────────────────────────
function executeCommand(cmd, sessionId) {
  return new Promise((resolve) => {
    const validation = validateCommand(cmd);
    if (!validation.ok) {
      const result = {
        type: 'manus:terminal:output',
        sessionId,
        cmd,
        exitCode: 1,
        output: '',
        error: validation.reason,
        ts: Date.now(),
        runtime: 0,
      };
      if (broadcastFn) broadcastFn(result);
      resolve(result);
      return;
    }

    // Save to history
    commandHistory.push({ cmd, ts: Date.now() });
    saveCommandHistory();

    const startTime = Date.now();
    const proc = spawn('bash', ['-c', cmd], {
      cwd: WORKSPACE_DIR,
      timeout: 30000,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLUMNS: '120',
        LINES: '40',
      },
      maxBuffer: 2 * 1024 * 1024,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // Stream output chunks in real-time
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (broadcastFn) {
        broadcastFn({
          type: 'manus:terminal:chunk',
          sessionId,
          stream: 'stdout',
          text,
          ts: Date.now(),
        });
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (broadcastFn) {
        broadcastFn({
          type: 'manus:terminal:chunk',
          sessionId,
          stream: 'stderr',
          text,
          ts: Date.now(),
        });
      }
    });

    proc.on('close', (code) => {
      const runtime = Date.now() - startTime;
      const result = {
        type: 'manus:terminal:output',
        sessionId,
        cmd,
        exitCode: killed ? 137 : code || 0,
        output: stdout.slice(0, 100000),
        error: stderr.slice(0, 50000),
        ts: Date.now(),
        runtime,
      };
      if (broadcastFn) broadcastFn(result);
      resolve(result);
    });

    proc.on('error', (err) => {
      const result = {
        type: 'manus:terminal:output',
        sessionId,
        cmd,
        exitCode: 1,
        output: '',
        error: err.message,
        ts: Date.now(),
        runtime: Date.now() - startTime,
      };
      if (broadcastFn) broadcastFn(result);
      resolve(result);
    });

    // Store reference for potential cancellation
    activeTerminals.set(sessionId, { proc, cmd, startTime });

    // Auto-kill after 30s
    setTimeout(() => {
      if (!proc.killed) {
        killed = true;
        proc.kill('SIGKILL');
      }
    }, 30000);
  });
}

// ─── Live Logs Streaming ──────────────────────────────────────────────────────
const LOG_SOURCES = [
  { name: 'alfie-nexus', type: 'pm2', id: 'alfie-nexus' },
  { name: 'rasputin', type: 'pm2', id: 'rasputin' },
  { name: 'opencode-stream', type: 'pm2', id: 'opencode-stream' },
  { name: 'gateway', type: 'file', path: '/home/admin/.openclaw/logs/gateway.log' },
  { name: 'openclaw', type: 'file', path: '/home/admin/.openclaw/logs/openclaw.log' },
];

let logBuffer = [];
const MAX_LOG_BUFFER = 200;

function parseLogLevel(line) {
  if (/\berror\b/i.test(line) || /\bERR\b/.test(line) || /\bfatal\b/i.test(line)) return 'error';
  if (/\bwarn\b/i.test(line) || /\bWARN\b/.test(line)) return 'warn';
  if (/\bdebug\b/i.test(line) || /\bDEBUG\b/.test(line)) return 'debug';
  return 'info';
}

function parseLogSource(line) {
  // Try to extract JSON log
  try {
    const json = JSON.parse(line);
    return {
      ts: json.ts || json.timestamp || new Date().toISOString(),
      level: json.level || parseLogLevel(line),
      msg: json.msg || json.message || line,
      source: json.source || 'system',
    };
  } catch (_) {}

  // PM2 format: "2026-02-16T00:00:00: message"
  const pm2Match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+):\s*(.*)/);
  if (pm2Match) {
    return {
      ts: pm2Match[1],
      level: parseLogLevel(pm2Match[2]),
      msg: pm2Match[2],
      source: 'pm2',
    };
  }

  return {
    ts: new Date().toISOString(),
    level: parseLogLevel(line),
    msg: line,
    source: 'unknown',
  };
}

function startLogTailing() {
  // Tail PM2 logs
  const pm2Sources = LOG_SOURCES.filter((s) => s.type === 'pm2');
  if (pm2Sources.length > 0) {
    try {
      const proc = spawn('pm2', ['logs', '--raw', '--lines', '0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      const handleData = (data, stream) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseLogSource(line);
          parsed.stream = stream;
          addLogEntry(parsed);
        }
      };

      proc.stdout.on('data', (d) => handleData(d, 'stdout'));
      proc.stderr.on('data', (d) => handleData(d, 'stderr'));
      proc.on('close', () => {
        // Restart after 5s if killed
        setTimeout(startLogTailing, 5000);
      });

      logTailers.set('pm2', { proc });
    } catch (e) {
      console.error('Failed to start PM2 log tailing:', e.message);
    }
  }

  // Tail file-based logs
  for (const source of LOG_SOURCES.filter((s) => s.type === 'file')) {
    try {
      if (!fs.existsSync(source.path)) continue;

      const proc = spawn('tail', ['-f', '-n', '0', source.path], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      proc.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseLogSource(line);
          parsed.source = source.name;
          addLogEntry(parsed);
        }
      });

      logTailers.set(source.name, { proc });
    } catch (_) {}
  }
}

function addLogEntry(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer = logBuffer.slice(-MAX_LOG_BUFFER);
  }

  // Broadcast to Manus clients
  if (broadcastFn) {
    broadcastFn({
      type: 'manus:log',
      ...entry,
    });
  }
}

// ─── System Metrics (Real) ────────────────────────────────────────────────────
let metricsHistory = {
  cpu: [],
  mem: [],
  net: [],
  gpu0: [],
  gpu1: [],
};
const MAX_METRICS_HISTORY = 120; // 2 minutes at 1s intervals

async function collectMetrics() {
  const metrics = {
    ts: Date.now(),
    cpu: 0,
    mem: 0,
    memUsed: 0,
    memTotal: 0,
    disk: 0,
    diskRead: 0,
    diskWrite: 0,
    netRx: 0,
    netTx: 0,
    gpus: [],
    loadAvg: [0, 0, 0],
    uptime: 0,
  };

  // CPU + Memory from /proc
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (key) => {
      const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1]) * 1024 : 0;
    };
    metrics.memTotal = get('MemTotal');
    const memAvailable = get('MemAvailable');
    metrics.memUsed = metrics.memTotal - memAvailable;
    metrics.mem = metrics.memTotal > 0 ? Math.round((metrics.memUsed / metrics.memTotal) * 100) : 0;
  } catch (_) {}

  try {
    const load = fs.readFileSync('/proc/loadavg', 'utf8').split(' ');
    metrics.loadAvg = load.slice(0, 3).map(parseFloat);
    const numCpus = require('os').cpus().length;
    metrics.cpu = Math.min(100, Math.round((metrics.loadAvg[0] / numCpus) * 100));
  } catch (_) {}

  try {
    metrics.uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  } catch (_) {}

  // Disk
  try {
    const { execSync } = require('child_process');
    const df = execSync('df /home --output=pcent | tail -1', { timeout: 2000 }).toString().trim();
    metrics.disk = parseInt(df) || 0;
  } catch (_) {}

  // GPU via nvidia-smi
  try {
    const gpuData = await new Promise((resolve) => {
      execFile(
        'nvidia-smi',
        [
          '--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed',
          '--format=csv,noheader,nounits',
        ],
        { timeout: 3000 },
        (err, stdout) => {
          if (err) return resolve([]);
          resolve(
            stdout
              .trim()
              .split('\n')
              .map((line) => {
                const [idx, name, util, memUsed, memTotal, temp, power, fan] = line
                  .split(',')
                  .map((s) => s.trim());
                return {
                  index: parseInt(idx) || 0,
                  name: (name || '').replace('NVIDIA ', ''),
                  utilization: parseFloat(util) || 0,
                  memoryUsed: parseInt(memUsed) || 0,
                  memoryTotal: parseInt(memTotal) || 0,
                  temperature: parseInt(temp) || 0,
                  powerDraw: parseFloat(power) || 0,
                  fanSpeed: parseInt(fan) || 0,
                };
              })
          );
        }
      );
    });
    metrics.gpus = gpuData;
  } catch (_) {}

  // Network throughput
  try {
    const net = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = net
      .split('\n')
      .filter((l) => l.includes('eno') || l.includes('eth') || l.includes('wlan'));
    let rxBytes = 0,
      txBytes = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      rxBytes += parseInt(parts[1] || 0);
      txBytes += parseInt(parts[9] || 0);
    }
    const now = Date.now();
    if (collectMetrics._lastNet) {
      const dt = (now - collectMetrics._lastNet.ts) / 1000;
      if (dt > 0) {
        metrics.netRx = Math.round((rxBytes - collectMetrics._lastNet.rx) / dt / 1024); // KB/s
        metrics.netTx = Math.round((txBytes - collectMetrics._lastNet.tx) / dt / 1024);
        if (metrics.netRx < 0) metrics.netRx = 0;
        if (metrics.netTx < 0) metrics.netTx = 0;
      }
    }
    collectMetrics._lastNet = { rx: rxBytes, tx: txBytes, ts: now };
  } catch (_) {}

  // Store history for charts
  metricsHistory.cpu.push(metrics.cpu);
  metricsHistory.mem.push(metrics.mem);
  metricsHistory.net.push(metrics.netRx + metrics.netTx);
  if (metrics.gpus[0]) metricsHistory.gpu0.push(metrics.gpus[0].utilization);
  if (metrics.gpus[1]) metricsHistory.gpu1.push(metrics.gpus[1].utilization);

  for (const key of Object.keys(metricsHistory)) {
    if (metricsHistory[key].length > MAX_METRICS_HISTORY) {
      metricsHistory[key] = metricsHistory[key].slice(-MAX_METRICS_HISTORY);
    }
  }

  return metrics;
}

function startMetricsBroadcast() {
  metricsInterval.ref = setInterval(async () => {
    try {
      const metrics = await collectMetrics();
      if (broadcastFn) {
        broadcastFn({
          type: 'manus:metrics',
          ...metrics,
          history: metricsHistory,
        });
      }
    } catch (_) {}
  }, 3000); // Every 3s
}

// ─── Active Tasks (Real) ──────────────────────────────────────────────────────
async function getActiveTasks() {
  const tasks = [];

  // 1. OpenClaw sessions (active sub-agents)
  try {
    const sessionsJsonPath = path.join(SESSION_DIR, 'sessions.json');
    if (fs.existsSync(sessionsJsonPath)) {
      const sj = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf8'));
      const entries = sj.sessions ? Object.entries(sj.sessions) : Object.entries(sj);
      const now = Date.now();

      for (const [key, info] of entries) {
        const age = now - (info.updatedAt || info.startedAt || 0);
        if (age < 30 * 60 * 1000) {
          // Active in last 30 min
          tasks.push({
            id: key,
            name: info.label || key.split(':').pop() || 'sub-agent',
            type: 'agent',
            status: age < 5 * 60 * 1000 ? 'active' : 'idle',
            agent: info.model || 'unknown',
            priority: 'medium',
            startedAt: info.startedAt || 0,
            runtime: Math.floor(age / 1000),
          });
        }
      }
    }
  } catch (_) {}

  // 2. PM2 processes
  try {
    const pm2Data = await new Promise((resolve) => {
      execFile('pm2', ['jlist'], { timeout: 3000 }, (err, stdout) => {
        if (err) return resolve([]);
        try {
          return resolve(JSON.parse(stdout));
        } catch (_) {
          return resolve([]);
        }
      });
    });

    for (const proc of pm2Data) {
      const status = proc.pm2_env?.status || 'unknown';
      const uptime = proc.pm2_env?.pm_uptime
        ? Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000)
        : 0;
      tasks.push({
        id: `pm2-${proc.name}`,
        name: proc.name,
        type: 'service',
        status: status === 'online' ? 'running' : status,
        agent: 'pm2',
        priority: 'low',
        startedAt: proc.pm2_env?.pm_uptime || 0,
        runtime: uptime,
        restarts: proc.pm2_env?.restart_time || 0,
        memory: proc.monit?.memory || 0,
        cpu: proc.monit?.cpu || 0,
      });
    }
  } catch (_) {}

  // 3. Active terminal commands
  for (const [sid, term] of activeTerminals) {
    if (term.proc && !term.proc.killed) {
      tasks.push({
        id: `term-${sid}`,
        name: `Terminal: ${(term.cmd || '').slice(0, 50)}`,
        type: 'terminal',
        status: 'active',
        agent: 'bash',
        priority: 'high',
        startedAt: term.startTime,
        runtime: Math.floor((Date.now() - term.startTime) / 1000),
      });
    }
  }

  // Sort: active first, then by start time
  tasks.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return (b.startedAt || 0) - (a.startedAt || 0);
  });

  return tasks;
}

// ─── Agent Activity (Real) ────────────────────────────────────────────────────
async function getAgentActivity() {
  const agents = [];

  try {
    // Read sessions.json
    const sessionsJsonPath = path.join(SESSION_DIR, 'sessions.json');
    let sessionMeta = {};

    if (fs.existsSync(sessionsJsonPath)) {
      const sj = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf8'));
      const entries = sj.sessions ? Object.entries(sj.sessions) : Object.entries(sj);
      for (const [key, info] of entries) sessionMeta[key] = info;
    }

    // Scan JSONL files for recent activity
    const files = fs
      .readdirSync(SESSION_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        try {
          const stat = fs.statSync(path.join(SESSION_DIR, f));
          return { name: f, mtime: stat.mtimeMs };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 20); // Top 20 recent

    const now = Date.now();

    for (const f of files) {
      const sessionId = f.name.replace('.jsonl', '');
      const meta = sessionMeta[sessionId] || {};
      const age = now - f.mtime;
      const isActive = age < 5 * 60 * 1000; // Active in last 5 min

      // Read last few lines for context
      let lastModel = meta.model || 'unknown';
      let lastActivity = '';
      let toolCount = 0;

      try {
        const filePath = path.join(SESSION_DIR, f.name);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n');
        const lastLines = lines.slice(-5);

        for (const line of lastLines) {
          try {
            const json = JSON.parse(line);
            const msg = json.message || json;
            if (msg.model) lastModel = msg.model;

            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'tool_use') {
                  toolCount++;
                  lastActivity = `Using ${block.name}`;
                }
                if (block.type === 'text' && block.text) {
                  const text = block.text.slice(0, 100);
                  if (!text.startsWith('{') && !text.startsWith('[')) {
                    lastActivity = text;
                  }
                }
              }
            }
          } catch (_) {}
        }
      } catch (_) {}

      const isSubAgent = sessionId.includes('subagent') || !!meta.label;

      agents.push({
        id: sessionId,
        name: meta.label || (isSubAgent ? 'sub-agent' : 'main'),
        model: lastModel,
        status: isActive ? 'active' : age < 30 * 60 * 1000 ? 'idle' : 'offline',
        lastActivity: lastActivity || 'Idle',
        lastModified: f.mtime,
        isSubAgent,
        toolCount,
        icon: getAgentIcon(meta.label || sessionId),
        role: getAgentRole(meta.label || sessionId, lastModel),
      });
    }
  } catch (_) {}

  return agents;
}

function getAgentIcon(label) {
  const lower = (label || '').toLowerCase();
  if (lower.includes('sisyphus') || lower.includes('main')) return '⚒';
  if (lower.includes('oracle')) return '🔮';
  if (lower.includes('librarian')) return '📚';
  if (lower.includes('hephaestus') || lower.includes('codex')) return '🔨';
  if (lower.includes('explore')) return '🔍';
  if (lower.includes('prometheus') || lower.includes('plan')) return '🔥';
  if (lower.includes('momus') || lower.includes('review')) return '🤔';
  if (lower.includes('frontend') || lower.includes('ui')) return '🎨';
  if (lower.includes('metis')) return '🧠';
  return '🤖';
}

function getAgentRole(label, model) {
  const lower = (label || '').toLowerCase();
  if (lower.includes('sisyphus') || lower.includes('main')) return 'Primary Orchestrator';
  if (lower.includes('oracle')) return 'Architecture Consultant';
  if (lower.includes('librarian')) return 'Knowledge Retrieval';
  if (lower.includes('hephaestus') || lower.includes('codex')) return 'Code Generation';
  if (lower.includes('explore')) return 'Codebase Navigation';
  if (lower.includes('prometheus') || lower.includes('plan')) return 'Planning Engine';
  if (lower.includes('momus') || lower.includes('review')) return 'Quality Reviewer';
  if (lower.includes('frontend') || lower.includes('ui')) return 'UI/UX Engineer';
  if (lower.includes('metis')) return 'Pre-planning Analyst';
  if (model && model !== 'unknown') return model.split('/').pop().slice(0, 30);
  return 'Sub-Agent';
}

// ─── Network Status (Real) ────────────────────────────────────────────────────
async function getNetworkStatus() {
  const nodes = [];

  // Dashboard itself
  nodes.push({
    name: 'example.com',
    status: 'connected',
    latency: '0ms',
    color: 'var(--neon-cyan)',
  });

  // GPUs
  try {
    const gpuData = await new Promise((resolve) => {
      execFile(
        'nvidia-smi',
        ['--query-gpu=index,name,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'],
        { timeout: 2000 },
        (err, stdout) => {
          if (err) return resolve([]);
          resolve(
            stdout
              .trim()
              .split('\n')
              .map((line) => {
                const [idx, name, util, temp] = line.split(',').map((s) => s.trim());
                return { idx, name: name.replace('NVIDIA ', ''), util, temp };
              })
          );
        }
      );
    });

    for (const gpu of gpuData) {
      nodes.push({
        name: `gpu-${gpu.idx} (${gpu.name})`,
        status: 'connected',
        latency: `${gpu.temp}°C`,
        color: 'var(--neon-green)',
      });
    }
  } catch (_) {}

  // Qdrant
  try {
    const start = Date.now();
    const qdrantOk = await new Promise((resolve) => {
      const req = require('http').get(
        'http://localhost:6333/collections',
        { timeout: 2000 },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ ok: true, latency: Date.now() - start }));
        }
      );
      req.on('error', () => resolve({ ok: false }));
    });

    nodes.push({
      name: 'qdrant.local:6333',
      status: qdrantOk.ok ? 'connected' : 'error',
      latency: qdrantOk.ok ? `${qdrantOk.latency}ms` : 'N/A',
      color: qdrantOk.ok ? 'var(--neon-purple)' : 'var(--neon-red)',
    });
  } catch (_) {
    nodes.push({
      name: 'qdrant.local:6333',
      status: 'error',
      latency: 'N/A',
      color: 'var(--neon-red)',
    });
  }

  // Ollama
  try {
    const start = Date.now();
    const ollamaOk = await new Promise((resolve) => {
      const req = require('http').get(
        'http://localhost:11434/api/tags',
        { timeout: 2000 },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ ok: true, latency: Date.now() - start }));
        }
      );
      req.on('error', () => resolve({ ok: false }));
    });

    nodes.push({
      name: 'ollama.local:11434',
      status: ollamaOk.ok ? 'connected' : 'error',
      latency: ollamaOk.ok ? `${ollamaOk.latency}ms` : 'N/A',
      color: ollamaOk.ok ? 'var(--neon-amber)' : 'var(--neon-red)',
    });
  } catch (_) {
    nodes.push({
      name: 'ollama.local:11434',
      status: 'error',
      latency: 'N/A',
      color: 'var(--neon-red)',
    });
  }

  return nodes;
}

// ─── HTTP Route Handler ───────────────────────────────────────────────────────
async function handleRequest(req, res, urlPath) {
  // POST /api/manus/terminal — execute command
  if (urlPath === '/api/manus/terminal' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { cmd } = JSON.parse(body);
        if (!cmd) throw new Error('Missing cmd');
        const sessionId = `term-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

        // Start execution (async — output streams via WS)
        const result = await executeCommand(cmd, sessionId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // GET /api/manus/terminal/history — command history
  if (urlPath === '/api/manus/terminal/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ history: commandHistory.slice(-100) }));
    return true;
  }

  // GET /api/manus/metrics — current metrics + history
  if (urlPath === '/api/manus/metrics' && req.method === 'GET') {
    try {
      const metrics = await collectMetrics();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...metrics, history: metricsHistory }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // GET /api/manus/tasks — active tasks
  if (urlPath === '/api/manus/tasks' && req.method === 'GET') {
    try {
      const tasks = await getActiveTasks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tasks }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // GET /api/manus/agents — agent activity
  if (urlPath === '/api/manus/agents' && req.method === 'GET') {
    try {
      const agents = await getAgentActivity();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // GET /api/manus/logs — recent log buffer
  if (urlPath === '/api/manus/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: logBuffer.slice(-100) }));
    return true;
  }

  // GET /api/manus/network — network status
  if (urlPath === '/api/manus/network' && req.method === 'GET') {
    try {
      const nodes = await getNetworkStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ nodes }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // Recent agent activity (backfill for Manus V2 Agent Activity panel)
  if (urlPath === '/api/manus/agent-activity' && req.method === 'GET') {
    try {
      const events = getRecentSessionEvents(100);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ events }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ events: [], error: e.message }));
    }
    return true;
  }

  return false; // Not handled
}

// ─── Recent Session Events (for Agent Activity backfill) ──────────────────────
function getRecentSessionEvents(maxEvents) {
  const events = [];
  try {
    // Find the most recent session file
    const files = fs.readdirSync(SESSION_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(SESSION_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (!files.length) return events;

    // Read last 200KB of the most recent session
    const filePath = path.join(SESSION_DIR, files[0].name);
    const stat = fs.statSync(filePath);
    const readSize = Math.min(stat.size, 200 * 1024);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);

    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    // Parse from end, collect last N relevant events
    for (let i = lines.length - 1; i >= 0 && events.length < maxEvents; i--) {
      try {
        const raw = JSON.parse(lines[i]);
        const obj = raw.message || raw;
        const ts = raw.timestamp || Date.now();

        // Tool calls
        if (obj.role === 'assistant' && Array.isArray(obj.content)) {
          for (const block of obj.content) {
            if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
              const input = block.input || block.arguments || {};
              events.push({ type: 'tool_call', ts, tool: block.name, input, description: smartDesc(block.name, input) });
            }
            if (block.type === 'thinking' && block.thinking) {
              events.push({ type: 'thinking', ts, text: block.thinking.slice(0, 500) });
            }
            if (block.type === 'text' && block.text) {
              events.push({ type: 'token_stream', ts, text: block.text.slice(0, 500), role: 'assistant' });
            }
          }
        }
        // Tool results
        if (obj.role === 'tool' || obj.role === 'toolResult') {
          const result = typeof obj.content === 'string' ? obj.content : '';
          events.push({ type: 'tool_result', ts, toolName: obj.toolName || '', result: result.slice(0, 300) });
        }
        // User messages
        if (obj.role === 'user') {
          const text = typeof obj.content === 'string' ? obj.content
            : Array.isArray(obj.content) ? obj.content.filter(b => b.type === 'text').map(b => b.text).join('') : '';
          if (text && !/^\[.*GMT.*\].*Queued announce|^Read HEARTBEAT|^Pre-compaction/.test(text)) {
            const clean = text.replace(/\[Telegram.*?\]\s*/s, '').replace(/\[message_id:\s*\d+\]\s*/g, '').trim();
            if (clean) events.push({ type: 'user_message', ts, text: clean.slice(0, 200) });
          }
        }
      } catch (_) {}
    }
    events.reverse(); // chronological order
  } catch (_) {}
  return events;
}

function smartDesc(tool, input) {
  try {
    if (tool === 'exec') return '⚡ ' + (input.command || 'command').slice(0, 60);
    if (tool === 'read') return '📁 Reading ' + (input.file_path || input.path || 'file').split('/').pop();
    if (tool === 'write') return '💾 Writing ' + (input.file_path || input.path || 'file').split('/').pop();
    if (tool === 'edit') return '✏️ Editing ' + (input.file_path || input.path || 'file').split('/').pop();
    if (tool === 'web_search') return '🔍 Search: ' + (input.query || '');
    if (tool === 'web_fetch') return '🌐 Fetch: ' + (input.url || '');
    if (tool === 'browser') return '🌐 Browser: ' + (input.action || '');
    if (tool === 'message') return '📨 Message: ' + (input.action || '');
    if (tool === 'sessions_spawn') return '🚀 Spawn: ' + (input.label || input.task || '').slice(0, 50);
    if (tool === 'memory_search') return '🧠 Memory: ' + (input.query || '');
    if (tool === 'image') return '🖼️ Analyze image';
  } catch (_) {}
  return '🔧 ' + tool;
}

// ─── Periodic Tasks Broadcast ─────────────────────────────────────────────────
function startTasksBroadcast() {
  agentInterval.ref = setInterval(async () => {
    try {
      const [tasks, agents] = await Promise.all([getActiveTasks(), getAgentActivity()]);
      if (broadcastFn) {
        broadcastFn({ type: 'manus:tasks', tasks });
        broadcastFn({ type: 'manus:agents', agents });
      }
    } catch (_) {}
  }, 10000); // Every 10s
}

// ─── Init & Cleanup ───────────────────────────────────────────────────────────
function init(broadcast, requireAuth) {
  broadcastFn = broadcast;
  requireAuthFn = requireAuth;

  // Start real-time services
  startLogTailing();
  startMetricsBroadcast();
  startTasksBroadcast();

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      msg: 'Manus backend initialized',
    })
  );
}

function shutdown() {
  if (metricsInterval.ref) clearInterval(metricsInterval.ref);
  if (logsInterval.ref) clearInterval(logsInterval.ref);
  if (agentInterval.ref) clearInterval(agentInterval.ref);

  // Kill log tailers
  for (const [, tailer] of logTailers) {
    try {
      tailer.proc.kill();
    } catch (_) {}
  }
  logTailers.clear();

  // Kill active terminals
  for (const [, term] of activeTerminals) {
    try {
      term.proc.kill();
    } catch (_) {}
  }
  activeTerminals.clear();

  saveCommandHistory();
}

module.exports = {
  init,
  shutdown,
  handleRequest,
  executeCommand,
  getActiveTasks,
  getAgentActivity,
  getNetworkStatus,
  collectMetrics,
  metricsHistory,
  logBuffer,
  commandHistory,
};
