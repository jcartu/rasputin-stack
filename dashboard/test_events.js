// Test all new dashboard event types
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9001');

ws.on('open', () => {
  // Authenticate first
  ws.send(JSON.stringify({ type: 'auth', password: 'rasputin-neural-2026' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'auth' && msg.status === 'ok') {
    console.log('✅ Authenticated, firing events...');
    fireEvents();
  }
});

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fireEvents() {
  // 1. Thinking Start
  console.log('🧠 Thinking start...');
  ws.send(JSON.stringify({ type: 'thinking_start', sender: 'Rasputin' }));
  await sleep(3000);
  
  // 2. Thinking End
  console.log('🧠 Thinking end');
  ws.send(JSON.stringify({ type: 'thinking_end', sender: 'Rasputin' }));
  await sleep(1000);

  // 3. Thinking content (existing)
  console.log('🧠 Thinking content...');
  ws.send(JSON.stringify({ type: 'thinking', text: 'Analyzing the request... admin wants to see all event types. Let me process each handler systematically. The dashboard WebSocket protocol supports 12 event types and I need to demonstrate all of them beautifully.', ts: Date.now(), model: 'claude-opus-4.6' }));
  await sleep(2000);

  // 4. Artifact — code
  console.log('📦 Artifact (code)...');
  ws.send(JSON.stringify({ 
    type: 'artifact', 
    title: 'Rasputin Event System', 
    artifactType: 'code',
    content: `// Rasputin Dashboard Event Handler v2.0\nclass EventPipeline {\n  constructor() {\n    this.handlers = new Map();\n    this.queue = [];\n  }\n\n  on(type, handler) {\n    this.handlers.set(type, handler);\n    return this;\n  }\n\n  emit(type, data) {\n    const handler = this.handlers.get(type);\n    if (handler) handler({ ...data, ts: Date.now() });\n  }\n}\n\nexport default new EventPipeline();`,
    ts: Date.now()
  }));
  await sleep(2000);

  // 5. Artifact — HTML
  console.log('📦 Artifact (html)...');
  ws.send(JSON.stringify({
    type: 'artifact',
    title: 'Status Badge',
    artifactType: 'html',
    content: '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px;border-radius:12px;color:#fff;font-family:monospace;text-align:center;"><h2 style="color:#a855f7;">⚡ RASPUTIN ONLINE</h2><p style="color:#67e8f9;">All Systems Operational</p><div style="display:flex;justify-content:center;gap:10px;margin-top:10px;"><span style="color:#4ade80;">● GPU</span><span style="color:#4ade80;">● Memory</span><span style="color:#4ade80;">● Network</span></div></div>',
    ts: Date.now()
  }));
  await sleep(2000);

  // 6. Widget
  console.log('🧩 Widget...');
  ws.send(JSON.stringify({
    type: 'widget',
    title: 'Quick Actions',
    description: 'Run a system health check or trigger a memory consolidation.',
    action: 'system_health',
    payload: { check: 'full' },
    buttonText: 'Run Health Check',
    ts: Date.now()
  }));
  await sleep(2000);

  // 7. File shared — image
  console.log('📁 File (image)...');
  ws.send(JSON.stringify({
    type: 'file_shared',
    name: 'rasputin-architecture.png',
    url: 'https://dash.rasputin.to/icon-512.png',
    size: 245760,
    mime: 'image/png',
    humanSize: '240 KB',
    ts: Date.now()
  }));
  await sleep(1500);

  // 8. File shared — document
  console.log('📁 File (doc)...');
  ws.send(JSON.stringify({
    type: 'file_shared',
    name: 'war-room-intel-2026-02-15.json',
    url: 'https://dash.rasputin.to/war-room.html',
    size: 84200,
    mime: 'application/json',
    humanSize: '82.2 KB',
    ts: Date.now()
  }));
  await sleep(2000);

  // 9. Research progress
  console.log('🔬 Research start...');
  const jobId = 'demo-' + Date.now();
  ws.send(JSON.stringify({ type: 'research_progress', jobId, pct: 10, ts: Date.now() }));
  await sleep(1000);
  
  ws.send(JSON.stringify({ type: 'research_queries', jobId, queries: ['AI agent frameworks 2026', 'OpenClaw competitors', 'autonomous agent benchmarks', 'RAG vs fine-tuning SOTA'], ts: Date.now() }));
  await sleep(1500);
  
  ws.send(JSON.stringify({ type: 'research_progress', jobId, pct: 40, ts: Date.now() }));
  await sleep(1000);

  ws.send(JSON.stringify({ type: 'research_sources', jobId, sources: [
    { title: 'The State of AI Agents in 2026', url: 'https://arxiv.org/example1' },
    { title: 'Manus vs Open-Source Agents', url: 'https://reddit.com/r/LocalLLaMA/example' },
    { title: 'RAG 2.0: Beyond Vector Search', url: 'https://lilianweng.github.io/example' },
  ], ts: Date.now() }));
  await sleep(1500);

  ws.send(JSON.stringify({ type: 'research_progress', jobId, pct: 75, ts: Date.now() }));
  await sleep(1500);

  ws.send(JSON.stringify({ type: 'research_progress', jobId, pct: 100, ts: Date.now() }));
  await sleep(500);

  ws.send(JSON.stringify({ type: 'research_complete', jobId, ts: Date.now() }));
  await sleep(1000);

  console.log('✅ All events fired!');
  ws.close();
  process.exit(0);
}
