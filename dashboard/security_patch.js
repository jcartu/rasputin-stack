// Security Patch for ALFIE Nexus Dashboard
// Apply authentication to all critical API endpoints

// Add this function after isAuthed():
function requireAuth(req, res) {
  // Check cookie auth
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

// Protected endpoints that need auth:
const PROTECTED_API_ENDPOINTS = [
  '/api/execute',           // Code execution - CRITICAL
  '/api/execute/install',   // Package installation - CRITICAL
  '/api/execute/save',      // Save execution results
  '/api/research',          // Start research jobs (costs money)
  '/api/playground',        // Multi-model inference (costs money)
  '/api/knowledge/',        // Read workspace files
  '/api/agents',            // View active agents
  '/api/agents/active',     // View active agents
  '/api/agents/spawn',      // Spawn sub-agents
  '/api/sessions',          // List sessions
  '/api/replay/',           // Replay sessions
  '/api/export/',           // Export data
  '/api/share',             // Create shares
  '/api/upload',            // File uploads
  '/api/browser/',          // Browser automation
  '/api/tts',              // Text-to-speech (API costs)
];

// Apply auth check before handling these endpoints
function checkEndpointAuth(urlPath, req, res) {
  for (const endpoint of PROTECTED_API_ENDPOINTS) {
    if (urlPath === endpoint || urlPath.startsWith(endpoint)) {
      return requireAuth(req, res);
    }
  }
  return true; // Not a protected endpoint
}

// Input validation functions
function validateExecutePayload(data) {
  if (!data.code || typeof data.code !== 'string') {
    throw new Error('Missing or invalid code field');
  }
  if (!data.language || typeof data.language !== 'string') {
    throw new Error('Missing or invalid language field');
  }
  if (data.code.trim().length === 0) {
    throw new Error('Code cannot be empty');
  }
  const validLanguages = ['python', 'javascript', 'bash'];
  if (!validLanguages.includes(data.language)) {
    throw new Error(`Invalid language. Must be one of: ${validLanguages.join(', ')}`);
  }
  // Clamp timeout
  data.timeout = Math.min(Math.max(parseInt(data.timeout) || 30, 1), 120);
  return data;
}

function validateResearchPayload(data) {
  if (!data.question || typeof data.question !== 'string') {
    throw new Error('Missing or invalid question field');
  }
  if (data.question.trim().length < 3) {
    throw new Error('Question must be at least 3 characters');
  }
  if (data.question.length > 1000) {
    throw new Error('Question too long (max 1000 chars)');
  }
  return data;
}

function validatePlaygroundPayload(data) {
  if (!data.prompt || typeof data.prompt !== 'string') {
    throw new Error('Missing or invalid prompt field');
  }
  if (!Array.isArray(data.models) || data.models.length === 0) {
    throw new Error('Must provide at least one model');
  }
  if (data.models.length > 8) {
    throw new Error('Maximum 8 models allowed');
  }
  data.prompt = data.prompt.slice(0, 10000);
  data.maxTokens = Math.min(data.maxTokens || 1024, 4096);
  data.temperature = Math.max(0, Math.min(2, data.temperature ?? 0.7));
  return data;
}

function sanitizePath(relPath, allowedRoot) {
  // Remove any path traversal attempts
  const segments = relPath.split('/').filter(s => s && s !== '.' && s !== '..');
  const sanitized = segments.join('/');
  const resolved = path.resolve(allowedRoot, sanitized);
  
  // Ensure resolved path stays within allowed root
  if (!resolved.startsWith(path.resolve(allowedRoot))) {
    throw new Error('Path traversal detected');
  }
  
  return resolved;
}

// Rate limiting for expensive operations
const rateLimits = new Map(); // ip -> { lastRequest, count }
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMITS = {
  execute: 30,      // 30 code executions per minute
  research: 5,      // 5 research jobs per minute
  playground: 10,   // 10 playground requests per minute
  browser: 10,      // 10 browser actions per minute
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
  entry.lastRequest = now;
  
  const limit = RATE_LIMITS[operation] || 100;
  if (entry.count > limit) {
    throw new Error(`Rate limit exceeded: ${limit} ${operation} requests per minute`);
  }
}

// Clean old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits.entries()) {
    if (now - entry.lastRequest > RATE_LIMIT_WINDOW * 2) {
      rateLimits.delete(key);
    }
  }
}, 300000);

module.exports = {
  requireAuth,
  checkEndpointAuth,
  validateExecutePayload,
  validateResearchPayload,
  validatePlaygroundPayload,
  sanitizePath,
  checkRateLimit,
};
