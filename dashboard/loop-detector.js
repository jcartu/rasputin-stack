/**
 * Recursive Loop Detector for Autonomous Agents
 * Detects and prevents infinite reasoning loops, stuck agents, and runaway processes
 * NOVEL FEATURE - competitive analysis showed only AgentOps has checkpoints, nobody has full loop detection
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '.loop_detector_state.json');
const ALERT_HISTORY_FILE = path.join(__dirname, '.loop_alerts.json');

class LoopDetector {
  constructor(options = {}) {
    this.options = {
      // Pattern detection thresholds
      maxRepetitions: options.maxRepetitions || 3,           // Same pattern 3+ times = loop
      repetitionWindow: options.repetitionWindow || 300000,   // 5 minutes
      
      // Tool call thresholds
      maxToolCallmedical-sampleinute: options.maxToolCallmedical-sampleinute || 20,
      maxSameToolRepeats: options.maxSameToolRepeats || 5,
      
      // Session thresholds
      maxMessagesPerSession: options.maxMessagesPerSession || 50,
      maxSessionDuration: options.maxSessionDuration || 3600000, // 1 hour
      
      // Token thresholds
      maxTokenmedical-sampleinute: options.maxTokenmedical-sampleinute || 50000,
      maxCostPerSession: options.maxCostPerSession || 5.0,       // $5 safety limit
      
      // Error loop detection
      maxConsecutiveErrors: options.maxConsecutiveErrors || 3,
      errorRepeatWindow: options.errorRepeatWindow || 60000,     // 1 minute
      
      // Alert settings
      alertCooldown: options.alertCooldown || 300000,            // 5 min between same alerts
      autoKillEnabled: options.autoKillEnabled !== false,        // Default: enabled
      ...options
    };

    this.state = this.loadState();
    this.alertHistory = this.loadAlertHistory();
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
    } catch (err) {
      console.error('[LoopDetector] Failed to load state:', err.message);
    }
    return {
      sessions: {},           // sessionId -> session tracking data
      patterns: {},           // sessionId -> detected patterns
      toolCalls: {},          // sessionId -> tool call history
      errors: {},             // sessionId -> error history
      alerts: []              // Active alerts
    };
  }

  saveState() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.error('[LoopDetector] Failed to save state:', err.message);
    }
  }

  loadAlertHistory() {
    try {
      if (fs.existsSync(ALERT_HISTORY_FILE)) {
        const history = JSON.parse(fs.readFileSync(ALERT_HISTORY_FILE, 'utf8'));
        // Keep only last 100 alerts
        return history.slice(-100);
      }
    } catch (err) {
      console.error('[LoopDetector] Failed to load alert history:', err.message);
    }
    return [];
  }

  saveAlertHistory() {
    try {
      // Keep only last 100 alerts
      const recent = this.alertHistory.slice(-100);
      fs.writeFileSync(ALERT_HISTORY_FILE, JSON.stringify(recent, null, 2));
    } catch (err) {
      console.error('[LoopDetector] Failed to save alert history:', err.message);
    }
  }

  /**
   * Track a message in a session
   * @param {string} sessionId - Session identifier
   * @param {Object} message - Message data
   */
  trackMessage(sessionId, message) {
    const now = Date.now();
    
    if (!this.state.sessions[sessionId]) {
      this.state.sessions[sessionId] = {
        startTime: now,
        messageCount: 0,
        totalTokens: 0,
        totalCost: 0,
        lastMessageTime: now,
        messageHistory: []
      };
    }

    const session = this.state.sessions[sessionId];
    session.messageCount++;
    session.totalTokens += message.tokens || 0;
    session.totalCost += message.cost || 0;
    session.lastMessageTime = now;
    
    // Store message content for pattern detection (keep last 20)
    session.messageHistory.push({
      timestamp: now,
      role: message.role,
      content: this.normalizeContent(message.content),
      tokens: message.tokens || 0
    });
    if (session.messageHistory.length > 20) {
      session.messageHistory.shift();
    }

    this.saveState();
    return this.analyzeSession(sessionId);
  }

  /**
   * Track a tool call
   * @param {string} sessionId - Session identifier
   * @param {Object} toolCall - Tool call data
   */
  trackToolCall(sessionId, toolCall) {
    const now = Date.now();
    
    if (!this.state.toolCalls[sessionId]) {
      this.state.toolCalls[sessionId] = [];
    }

    this.state.toolCalls[sessionId].push({
      timestamp: now,
      tool: toolCall.tool,
      params: this.normalizeParams(toolCall.params),
      duration: toolCall.duration
    });

    // Keep only last 100 tool calls per session
    if (this.state.toolCalls[sessionId].length > 100) {
      this.state.toolCalls[sessionId].shift();
    }

    this.saveState();
    return this.analyzeToolCalls(sessionId);
  }

  /**
   * Track an error
   * @param {string} sessionId - Session identifier
   * @param {Object} error - Error data
   */
  trackError(sessionId, error) {
    const now = Date.now();
    
    if (!this.state.errors[sessionId]) {
      this.state.errors[sessionId] = [];
    }

    this.state.errors[sessionId].push({
      timestamp: now,
      type: error.type || 'unknown',
      message: error.message,
      critical: error.critical || false
    });

    // Keep only last 50 errors
    if (this.state.errors[sessionId].length > 50) {
      this.state.errors[sessionId].shift();
    }

    this.saveState();
    return this.analyzeErrors(sessionId);
  }

  /**
   * Analyze session for loops and anomalies
   */
  analyzeSession(sessionId) {
    const alerts = [];
    const session = this.state.sessions[sessionId];
    if (!session) return alerts;

    const now = Date.now();
    const duration = now - session.startTime;

    // Check message count threshold
    if (session.messageCount > this.options.maxMessagesPerSession) {
      alerts.push(this.createAlert(sessionId, 'MESSAGE_OVERFLOW', {
        severity: 'critical',
        count: session.messageCount,
        threshold: this.options.maxMessagesPerSession,
        message: `Session exceeded ${this.options.maxMessagesPerSession} messages (${session.messageCount} sent)`,
        recommendation: 'Consider terminating session or increasing limit'
      }));
    }

    // Check session duration
    if (duration > this.options.maxSessionDuration) {
      alerts.push(this.createAlert(sessionId, 'SESSION_TIMEOUT', {
        severity: 'high',
        duration: Math.round(duration / 60000),
        threshold: Math.round(this.options.maxSessionDuration / 60000),
        message: `Session running for ${Math.round(duration / 60000)} minutes`,
        recommendation: 'Long-running session detected - check for stuck state'
      }));
    }

    // Check cost threshold
    if (session.totalCost > this.options.maxCostPerSession) {
      alerts.push(this.createAlert(sessionId, 'COST_LIMIT', {
        severity: 'critical',
        cost: session.totalCost.toFixed(2),
        threshold: this.options.maxCostPerSession,
        message: `Session cost $${session.totalCost.toFixed(2)} exceeds limit`,
        recommendation: 'TERMINATE SESSION IMMEDIATELY - cost runaway detected',
        autoKill: true
      }));
    }

    // Check token rate (last minute)
    const recentMessages = session.messageHistory.filter(m => now - m.timestamp < 60000);
    const tokensLastMinute = recentMessages.reduce((sum, m) => sum + m.tokens, 0);
    if (tokensLastMinute > this.options.maxTokenmedical-sampleinute) {
      alerts.push(this.createAlert(sessionId, 'TOKEN_SPIKE', {
        severity: 'high',
        rate: tokensLastMinute,
        threshold: this.options.maxTokenmedical-sampleinute,
        message: `High token rate: ${tokensLastMinute} tokens/min`,
        recommendation: 'Possible reasoning loop or verbose output'
      }));
    }

    // Detect repetitive patterns
    const patternAlerts = this.detectPatterns(sessionId, session.messageHistory);
    alerts.push(...patternAlerts);

    return this.processAlerts(sessionId, alerts);
  }

  /**
   * Analyze tool calls for loops
   */
  analyzeToolCalls(sessionId) {
    const alerts = [];
    const toolCalls = this.state.toolCalls[sessionId];
    if (!toolCalls || toolCalls.length === 0) return alerts;

    const now = Date.now();

    // Check tool call rate (last minute)
    const recentCalls = toolCalls.filter(tc => now - tc.timestamp < 60000);
    if (recentCalls.length > this.options.maxToolCallmedical-sampleinute) {
      alerts.push(this.createAlert(sessionId, 'TOOL_SPAM', {
        severity: 'high',
        rate: recentCalls.length,
        threshold: this.options.maxToolCallmedical-sampleinute,
        message: `Excessive tool calls: ${recentCalls.length} calls/min`,
        recommendation: 'Possible tool loop - check agent logic'
      }));
    }

    // Check for repeated identical tool calls
    const last10 = toolCalls.slice(-10);
    const toolGroups = {};
    last10.forEach(tc => {
      const key = `${tc.tool}:${JSON.stringify(tc.params)}`;
      toolGroups[key] = (toolGroups[key] || 0) + 1;
    });

    Object.entries(toolGroups).forEach(([key, count]) => {
      if (count >= this.options.maxSameToolRepeats) {
        const [tool] = key.split(':');
        alerts.push(this.createAlert(sessionId, 'TOOL_LOOP', {
          severity: 'critical',
          tool,
          count,
          threshold: this.options.maxSameToolRepeats,
          message: `Tool "${tool}" called ${count} times with identical params`,
          recommendation: 'TOOL LOOP DETECTED - terminate and debug agent logic',
          autoKill: true
        }));
      }
    });

    return this.processAlerts(sessionId, alerts);
  }

  /**
   * Analyze errors for loops
   */
  analyzeErrors(sessionId) {
    const alerts = [];
    const errors = this.state.errors[sessionId];
    if (!errors || errors.length === 0) return alerts;

    const now = Date.now();

    // Check consecutive errors (last N)
    const recentErrors = errors.slice(-this.options.maxConsecutiveErrors);
    if (recentErrors.length >= this.options.maxConsecutiveErrors) {
      const allRecent = recentErrors.every(e => now - e.timestamp < this.options.errorRepeatWindow);
      if (allRecent) {
        alerts.push(this.createAlert(sessionId, 'ERROR_LOOP', {
          severity: 'critical',
          count: recentErrors.length,
          threshold: this.options.maxConsecutiveErrors,
          message: `${recentErrors.length} consecutive errors in ${Math.round(this.options.errorRepeatWindow / 1000)}s`,
          recommendation: 'ERROR LOOP DETECTED - agent stuck in failure state',
          autoKill: true
        }));
      }
    }

    // Check for critical errors
    const criticalErrors = errors.filter(e => e.critical && now - e.timestamp < 60000);
    if (criticalErrors.length > 0) {
      alerts.push(this.createAlert(sessionId, 'CRITICAL_ERROR', {
        severity: 'critical',
        count: criticalErrors.length,
        message: `${criticalErrors.length} critical error(s) in last minute`,
        recommendation: 'Check logs and terminate if necessary'
      }));
    }

    return this.processAlerts(sessionId, alerts);
  }

  /**
   * Detect repetitive patterns in message history
   */
  detectPatterns(sessionId, messageHistory) {
    const alerts = [];
    if (messageHistory.length < 6) return alerts;

    // Look for repeated content sequences
    const sequences = [];
    for (let i = 0; i < messageHistory.length - 2; i++) {
      const seq = messageHistory.slice(i, i + 3).map(m => m.content).join('|');
      sequences.push({ index: i, content: seq, timestamp: messageHistory[i].timestamp });
    }

    // Find repeating sequences
    const seqGroups = {};
    sequences.forEach(seq => {
      if (!seqGroups[seq.content]) {
        seqGroups[seq.content] = [];
      }
      seqGroups[seq.content].push(seq);
    });

    const now = Date.now();
    Object.entries(seqGroups).forEach(([content, occurrences]) => {
      if (occurrences.length >= this.options.maxRepetitions) {
        // Check if repetitions are within time window
        const inWindow = occurrences.filter(o => now - o.timestamp < this.options.repetitionWindow);
        if (inWindow.length >= this.options.maxRepetitions) {
          alerts.push(this.createAlert(sessionId, 'REASONING_LOOP', {
            severity: 'critical',
            pattern: content.substring(0, 100) + '...',
            count: inWindow.length,
            threshold: this.options.maxRepetitions,
            message: `Repetitive pattern detected ${inWindow.length} times`,
            recommendation: 'REASONING LOOP - agent stuck in repetitive thought process',
            autoKill: true
          }));
        }
      }
    });

    return alerts;
  }

  /**
   * Create an alert object
   */
  createAlert(sessionId, type, details) {
    return {
      sessionId,
      type,
      timestamp: Date.now(),
      ...details
    };
  }

  /**
   * Process and deduplicate alerts
   */
  processAlerts(sessionId, alerts) {
    const now = Date.now();
    const unique = [];

    alerts.forEach(alert => {
      // Check if similar alert was recently fired
      const recent = this.state.alerts.find(a => 
        a.sessionId === sessionId &&
        a.type === alert.type &&
        now - a.timestamp < this.options.alertCooldown
      );

      if (!recent) {
        unique.push(alert);
        this.state.alerts.push(alert);
        this.alertHistory.push(alert);
        
        // Auto-kill if enabled and recommended
        if (this.options.autoKillEnabled && alert.autoKill) {
          this.killSession(sessionId, alert);
        }
      }
    });

    // Clean old alerts (older than 1 hour)
    this.state.alerts = this.state.alerts.filter(a => now - a.timestamp < 3600000);

    if (unique.length > 0) {
      this.saveState();
      this.saveAlertHistory();
    }

    return unique;
  }

  /**
   * Kill a runaway session
   */
  killSession(sessionId, alert) {
    console.error(`[LoopDetector] AUTO-KILL SESSION ${sessionId}: ${alert.message}`);
    
    // Log to alert history
    this.alertHistory.push({
      ...alert,
      action: 'SESSION_KILLED',
      timestamp: Date.now()
    });
    this.saveAlertHistory();

    // Clean up state
    delete this.state.sessions[sessionId];
    delete this.state.toolCalls[sessionId];
    delete this.state.errors[sessionId];
    delete this.state.patterns[sessionId];
    this.saveState();

    // TODO: Integrate with session manager to actually terminate the session
    // For now, this is logged and tracked - integration point for server.js
  }

  /**
   * Get current alerts
   */
  getAlerts(sessionId = null) {
    if (sessionId) {
      return this.state.alerts.filter(a => a.sessionId === sessionId);
    }
    return this.state.alerts;
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit = 50) {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Get session stats
   */
  getSessionStats(sessionId) {
    return {
      session: this.state.sessions[sessionId] || null,
      toolCalls: this.state.toolCalls[sessionId] || [],
      errors: this.state.errors[sessionId] || [],
      alerts: this.getAlerts(sessionId)
    };
  }

  /**
   * Reset session tracking
   */
  resetSession(sessionId) {
    delete this.state.sessions[sessionId];
    delete this.state.toolCalls[sessionId];
    delete this.state.errors[sessionId];
    delete this.state.patterns[sessionId];
    this.state.alerts = this.state.alerts.filter(a => a.sessionId !== sessionId);
    this.saveState();
  }

  /**
   * Normalize content for pattern matching
   */
  normalizeContent(content) {
    if (!content) return '';
    return content.toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim()
      .substring(0, 200);
  }

  /**
   * Normalize tool params for comparison
   */
  normalizeParams(params) {
    if (!params) return {};
    // Keep only essential fields for comparison
    const normalized = {};
    Object.keys(params).sort().forEach(key => {
      if (typeof params[key] !== 'function') {
        normalized[key] = params[key];
      }
    });
    return normalized;
  }
}

module.exports = LoopDetector;
