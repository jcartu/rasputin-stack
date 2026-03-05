#!/usr/bin/env node
// Inject Model Leaderboard API routes into server.js

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverPath, 'utf8');

// Check if already injected
if (content.includes('ModelLeaderboard')) {
  console.log('✅ Model Leaderboard already injected');
  process.exit(0);
}

// Find the requires section (after LatencyTracker require)
const requireInsert = `const LatencyTracker = require('./latency-tracker.js');
const ModelLeaderboard = require('./model-leaderboard.js');`;

content = content.replace(
  `const LatencyTracker = require('./latency-tracker.js');`,
  requireInsert
);

// Find where latencyTracker is initialized
const initInsert = `const latencyTracker = new LatencyTracker();
const modelLeaderboard = new ModelLeaderboard();`;

content = content.replace(
  `const latencyTracker = new LatencyTracker();`,
  initInsert
);

// Find where to insert API routes (after the other /api/ routes, before final server start)
const apiRoutes = `
  // ─── Model Leaderboard API ────────────────────────────────────────────────
  if (urlPath === '/api/model-leaderboard' && req.method === 'GET') {
    try {
      const url = new URL(req.url, \`http://\${req.headers.host}\`);
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
    req.on('data', chunk => { body += chunk; });
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
`;

// Find a good insertion point - after the /api/share route
const insertAfter = `if (urlPath === '/api/share' && req.method === 'POST') {`;
const insertIndex = content.indexOf(insertAfter);

if (insertIndex === -1) {
  console.error('❌ Could not find insertion point');
  process.exit(1);
}

// Find the end of this route handler (next if statement)
const nextRouteIndex = content.indexOf('\n  if (', insertIndex + insertAfter.length);
if (nextRouteIndex === -1) {
  console.error('❌ Could not find next route');
  process.exit(1);
}

// Insert the new routes
content = content.slice(0, nextRouteIndex) + apiRoutes + content.slice(nextRouteIndex);

// Add model tracking to parseSessionLine (track model usage)
// Find where usage is tracked and add model recording
const usageBroadcast = `broadcast({
        type: 'token_usage',`;

const usageIndex = content.indexOf(usageBroadcast);
if (usageIndex > -1) {
  const modelRecording = `      
      // Record model interaction for leaderboard
      if (detectedModel && detectedModel !== 'unknown') {
        modelLeaderboard.recordInteraction(detectedModel, {
          cost: usage.cost?.total || 0,
          latency: currentMessageId ? (Date.now() - ts) : 0,
          tokens: usage.totalTokens || (usage.input || 0) + (usage.output || 0),
        });
      }
      `;
  
  content = content.slice(0, usageIndex) + modelRecording + content.slice(usageIndex);
}

// Write back
fs.writeFileSync(serverPath, content);
console.log('✅ Model Leaderboard API routes injected successfully');
console.log('   Restart server with: pm2 restart alfie-nexus');
