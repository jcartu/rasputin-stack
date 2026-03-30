/**
 * Webhook Manager for ALFIE Nexus
 * - POST to Slack, Discord, or custom endpoints on events
 * - Configurable triggers: errors, cost alerts, session complete, latency spikes
 * - Retry logic with exponential backoff
 * - Status tracking and delivery confirmation
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const WEBHOOK_CONFIG_FILE = path.join(__dirname, '.webhook_config.json');
const WEBHOOK_LOG_FILE = path.join(__dirname, '.webhook_log.json');

// Default config
let webhookConfig = {
  enabled: true,
  webhooks: [],
  // Global settings
  retryAttempts: 3,
  retryDelayMs: 1000,
  timeoutMs: 5000,
};

// Webhook log (last 100 deliveries)
let webhookLog = [];
const MAX_LOG_ENTRIES = 100;

// Load config
function loadConfig() {
  try {
    if (fs.existsSync(WEBHOOK_CONFIG_FILE)) {
      const data = fs.readFileSync(WEBHOOK_CONFIG_FILE, 'utf8');
      webhookConfig = { ...webhookConfig, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('[WEBHOOK] Failed to load config:', e.message);
  }
}

// Save config
function saveConfig() {
  try {
    fs.writeFileSync(WEBHOOK_CONFIG_FILE, JSON.stringify(webhookConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('[WEBHOOK] Failed to save config:', e.message);
  }
}

// Load log
function loadLog() {
  try {
    if (fs.existsSync(WEBHOOK_LOG_FILE)) {
      const data = fs.readFileSync(WEBHOOK_LOG_FILE, 'utf8');
      webhookLog = JSON.parse(data);
    }
  } catch (e) {
    console.error('[WEBHOOK] Failed to load log:', e.message);
  }
}

// Save log
function saveLog() {
  try {
    fs.writeFileSync(WEBHOOK_LOG_FILE, JSON.stringify(webhookLog, null, 2), 'utf8');
  } catch (e) {
    console.error('[WEBHOOK] Failed to save log:', e.message);
  }
}

// Add webhook
function addWebhook(webhook) {
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  const newWebhook = {
    id,
    name: webhook.name || 'Untitled Webhook',
    url: webhook.url,
    method: webhook.method || 'POST',
    headers: webhook.headers || {},
    events: webhook.events || [],
    enabled: webhook.enabled !== false,
    format: webhook.format || 'json', // 'json', 'slack', 'discord'
    createdAt: Date.now(),
  };
  
  webhookConfig.webhooks.push(newWebhook);
  saveConfig();
  return newWebhook;
}

// Update webhook
function updateWebhook(id, updates) {
  const idx = webhookConfig.webhooks.findIndex(w => w.id === id);
  if (idx === -1) return null;
  
  webhookConfig.webhooks[idx] = { ...webhookConfig.webhooks[idx], ...updates };
  saveConfig();
  return webhookConfig.webhooks[idx];
}

// Delete webhook
function deleteWebhook(id) {
  const idx = webhookConfig.webhooks.findIndex(w => w.id === id);
  if (idx === -1) return false;
  
  webhookConfig.webhooks.splice(idx, 1);
  saveConfig();
  return true;
}

// Get all webhooks
function getWebhooks() {
  return webhookConfig.webhooks;
}

// Format payload based on webhook type
function formatPayload(webhook, event) {
  const { format } = webhook;
  const { type, data, timestamp, severity } = event;
  
  if (format === 'slack') {
    // Slack incoming webhook format
    const color = {
      critical: 'danger',
      high: 'warning',
      medium: '#439FE0',
      low: 'good',
    }[severity] || 'good';
    
    const emoji = {
      error: '🚨',
      cost_alert: '💰',
      session_complete: '✅',
      latency_spike: '⚡',
      agent_spawn: '🤖',
      budget_alert: '⚠️',
    }[type] || 'ℹ️';
    
    return {
      text: `${emoji} ALFIE Nexus Alert`,
      attachments: [{
        color,
        title: data.title || type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        text: data.message || 'No details provided',
        fields: Object.entries(data.fields || {}).map(([key, value]) => ({
          title: key,
          value: String(value),
          short: true,
        })),
        footer: 'ALFIE Nexus Dashboard',
        ts: Math.floor(timestamp / 1000),
      }],
    };
  } else if (format === 'discord') {
    // Discord webhook format
    const color = {
      critical: 0xFF0000,
      high: 0xFFA500,
      medium: 0x439FE0,
      low: 0x00FF00,
    }[severity] || 0x7C3AED;
    
    const emoji = {
      error: '🚨',
      cost_alert: '💰',
      session_complete: '✅',
      latency_spike: '⚡',
      agent_spawn: '🤖',
      budget_alert: '⚠️',
    }[type] || 'ℹ️';
    
    return {
      embeds: [{
        title: `${emoji} ${data.title || type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`,
        description: data.message || 'No details provided',
        color,
        fields: Object.entries(data.fields || {}).map(([key, value]) => ({
          name: key,
          value: String(value),
          inline: true,
        })),
        footer: {
          text: 'ALFIE Nexus Dashboard',
        },
        timestamp: new Date(timestamp).toISOString(),
      }],
    };
  } else {
    // Plain JSON format
    return {
      event: type,
      severity,
      timestamp,
      data,
    };
  }
}

// Send webhook with retry logic
async function sendWebhook(webhook, event, attempt = 1) {
  return new Promise((resolve) => {
    const payload = formatPayload(webhook, event);
    const body = JSON.stringify(payload);
    
    const url = new URL(webhook.url);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: webhook.method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'ALFIE-Nexus-Webhook/1.0',
        ...webhook.headers,
      },
      timeout: webhookConfig.timeoutMs,
    };
    
    const protocol = url.protocol === 'https:' ? https : http;
    
    const startTime = Date.now();
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        const success = res.statusCode >= 200 && res.statusCode < 300;
        
        const logEntry = {
          webhookId: webhook.id,
          webhookName: webhook.name,
          event: event.type,
          timestamp: Date.now(),
          attempt,
          success,
          statusCode: res.statusCode,
          duration,
          error: success ? null : `HTTP ${res.statusCode}`,
        };
        
        webhookLog.unshift(logEntry);
        if (webhookLog.length > MAX_LOG_ENTRIES) {
          webhookLog = webhookLog.slice(0, MAX_LOG_ENTRIES);
        }
        saveLog();
        
        if (success) {
          console.log(`[WEBHOOK] ✓ ${webhook.name} → ${event.type} (${duration}ms)`);
          resolve({ success: true, statusCode: res.statusCode, duration });
        } else if (attempt < webhookConfig.retryAttempts) {
          // Retry with exponential backoff
          const delay = webhookConfig.retryDelayMs * Math.pow(2, attempt - 1);
          console.log(`[WEBHOOK] ✗ ${webhook.name} → ${event.type} (HTTP ${res.statusCode}), retrying in ${delay}ms...`);
          setTimeout(() => {
            sendWebhook(webhook, event, attempt + 1).then(resolve);
          }, delay);
        } else {
          console.error(`[WEBHOOK] ✗ ${webhook.name} → ${event.type} failed after ${attempt} attempts`);
          resolve({ success: false, statusCode: res.statusCode, duration, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    
    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      
      const logEntry = {
        webhookId: webhook.id,
        webhookName: webhook.name,
        event: event.type,
        timestamp: Date.now(),
        attempt,
        success: false,
        statusCode: null,
        duration,
        error: err.message,
      };
      
      webhookLog.unshift(logEntry);
      if (webhookLog.length > MAX_LOG_ENTRIES) {
        webhookLog = webhookLog.slice(0, MAX_LOG_ENTRIES);
      }
      saveLog();
      
      if (attempt < webhookConfig.retryAttempts) {
        const delay = webhookConfig.retryDelayMs * Math.pow(2, attempt - 1);
        console.log(`[WEBHOOK] ✗ ${webhook.name} → ${event.type} (${err.message}), retrying in ${delay}ms...`);
        setTimeout(() => {
          sendWebhook(webhook, event, attempt + 1).then(resolve);
        }, delay);
      } else {
        console.error(`[WEBHOOK] ✗ ${webhook.name} → ${event.type} failed: ${err.message}`);
        resolve({ success: false, statusCode: null, duration, error: err.message });
      }
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.error(`[WEBHOOK] ✗ ${webhook.name} → ${event.type} timeout`);
      resolve({ success: false, statusCode: null, duration: webhookConfig.timeoutMs, error: 'Timeout' });
    });
    
    req.write(body);
    req.end();
  });
}

// Trigger webhooks for an event
async function triggerEvent(eventType, data, severity = 'medium') {
  if (!webhookConfig.enabled) return [];
  
  const event = {
    type: eventType,
    data,
    severity,
    timestamp: Date.now(),
  };
  
  // Find matching webhooks
  const matchingWebhooks = webhookConfig.webhooks.filter(w => 
    w.enabled && w.events.includes(eventType)
  );
  
  if (matchingWebhooks.length === 0) return [];
  
  console.log(`[WEBHOOK] Triggering ${matchingWebhooks.length} webhooks for event: ${eventType}`);
  
  // Send all webhooks in parallel
  const results = await Promise.all(
    matchingWebhooks.map(webhook => sendWebhook(webhook, event))
  );
  
  return results;
}

// Get webhook log
function getLog(limit = 50) {
  return webhookLog.slice(0, limit);
}

// Clear log
function clearLog() {
  webhookLog = [];
  saveLog();
}

// Update global settings
function updateSettings(settings) {
  webhookConfig = { ...webhookConfig, ...settings };
  saveConfig();
  return webhookConfig;
}

// Initialize
loadConfig();
loadLog();

module.exports = {
  addWebhook,
  updateWebhook,
  deleteWebhook,
  getWebhooks,
  triggerEvent,
  getLog,
  clearLog,
  updateSettings,
  getConfig: () => webhookConfig,
};
