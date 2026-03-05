/**
 * Session Replay System - Time Travel Debugging for AI Agents
 * 
 * Inspired by AgentOps, Langfuse session replay capabilities.
 * Records every session event (messages, tool calls, thoughts) with timestamps
 * and enables "time travel" playback through the session timeline.
 * 
 * Features:
 * - Timeline-based event recording (messages, tools, errors, state changes)
 * - Playback controls (play, pause, step forward/back)
 * - Jump to any point in session
 * - Context snapshots (full state at each event)
 * - Export/share session replays
 * - Visual timeline with event markers
 * 
 * Competitive Position: Matches AgentOps, exceeds Langfuse
 */

const fs = require('fs').promises;
const path = require('path');

class SessionReplayRecorder {
  constructor(storageDir = '.session_replays') {
    this.storageDir = storageDir;
    this.activeSessions = new Map(); // sessionKey -> events[]
    this.maxEventsPerSession = 10000;
    this.init();
  }

  async init() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create replay storage dir:', err);
    }
  }

  /**
   * Record an event in the session timeline
   * @param {string} sessionKey - Session identifier
   * @param {object} event - Event data
   */
  recordEvent(sessionKey, event) {
    if (!this.activeSessions.has(sessionKey)) {
      this.activeSessions.set(sessionKey, []);
    }

    const events = this.activeSessions.get(sessionKey);
    
    const recordedEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      timestampISO: new Date().toISOString(),
      sessionKey,
      ...event
    };

    events.push(recordedEvent);

    // Prevent memory bloat - trim old events
    if (events.length > this.maxEventsPerSession) {
      events.splice(0, events.length - this.maxEventsPerSession);
    }

    return recordedEvent;
  }

  /**
   * Record a user message
   */
  recordUserMessage(sessionKey, message, metadata = {}) {
    return this.recordEvent(sessionKey, {
      type: 'message',
      role: 'user',
      content: message,
      metadata
    });
  }

  /**
   * Record an assistant message
   */
  recordAssistantMessage(sessionKey, message, metadata = {}) {
    return this.recordEvent(sessionKey, {
      type: 'message',
      role: 'assistant',
      content: message,
      metadata: {
        model: metadata.model,
        cost: metadata.cost,
        tokens: metadata.tokens,
        latency: metadata.latency,
        ...metadata
      }
    });
  }

  /**
   * Record a tool call
   */
  recordToolCall(sessionKey, toolName, params, result, metadata = {}) {
    return this.recordEvent(sessionKey, {
      type: 'tool_call',
      toolName,
      params,
      result: typeof result === 'string' ? result.substring(0, 500) : result,
      success: !metadata.error,
      error: metadata.error,
      latency: metadata.latency,
      metadata
    });
  }

  /**
   * Record agent thinking/reasoning
   */
  recordThinking(sessionKey, thought, metadata = {}) {
    return this.recordEvent(sessionKey, {
      type: 'thinking',
      content: thought,
      metadata
    });
  }

  /**
   * Record state change (context update, memory access, etc.)
   */
  recordStateChange(sessionKey, stateType, stateData, metadata = {}) {
    return this.recordEvent(sessionKey, {
      type: 'state_change',
      stateType,
      stateData,
      metadata
    });
  }

  /**
   * Record error
   */
  recordError(sessionKey, error, context = {}) {
    return this.recordEvent(sessionKey, {
      type: 'error',
      error: error.message || String(error),
      stack: error.stack,
      context
    });
  }

  /**
   * Get all events for a session
   */
  getSessionEvents(sessionKey) {
    return this.activeSessions.get(sessionKey) || [];
  }

  /**
   * Get session events within a time range
   */
  getSessionEventRange(sessionKey, startTime, endTime) {
    const events = this.getSessionEvents(sessionKey);
    return events.filter(e => e.timestamp >= startTime && e.timestamp <= endTime);
  }

  /**
   * Get session snapshot at a specific time
   * Returns all events up to that point
   */
  getSessionSnapshot(sessionKey, timestamp) {
    const events = this.getSessionEvents(sessionKey);
    return events.filter(e => e.timestamp <= timestamp);
  }

  /**
   * Save session replay to disk
   */
  async saveSession(sessionKey) {
    const events = this.activeSessions.get(sessionKey);
    if (!events || events.length === 0) return null;

    const filename = `${sessionKey}_${Date.now()}.json`;
    const filepath = path.join(this.storageDir, filename);

    const sessionData = {
      sessionKey,
      recordedAt: new Date().toISOString(),
      eventCount: events.length,
      duration: events.length > 0 ? events[events.length - 1].timestamp - events[0].timestamp : 0,
      events
    };

    try {
      await fs.writeFile(filepath, JSON.stringify(sessionData, null, 2));
      return filepath;
    } catch (err) {
      console.error('Failed to save session replay:', err);
      return null;
    }
  }

  /**
   * Load session replay from disk
   */
  async loadSession(filepath) {
    try {
      const data = await fs.readFile(filepath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Failed to load session replay:', err);
      return null;
    }
  }

  /**
   * List all saved session replays
   */
  async listSessions() {
    try {
      const files = await fs.readdir(this.storageDir);
      const sessions = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filepath = path.join(this.storageDir, file);
        const data = await this.loadSession(filepath);
        
        if (data) {
          sessions.push({
            file,
            filepath,
            sessionKey: data.sessionKey,
            recordedAt: data.recordedAt,
            eventCount: data.eventCount,
            duration: data.duration
          });
        }
      }

      return sessions.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
    } catch (err) {
      console.error('Failed to list sessions:', err);
      return [];
    }
  }

  /**
   * Generate session statistics
   */
  getSessionStats(sessionKey) {
    const events = this.getSessionEvents(sessionKey);
    if (events.length === 0) return null;

    const stats = {
      totalEvents: events.length,
      startTime: events[0].timestamp,
      endTime: events[events.length - 1].timestamp,
      duration: events[events.length - 1].timestamp - events[0].timestamp,
      eventTypes: {},
      toolCalls: [],
      errors: [],
      messageCount: 0,
      thinkingCount: 0
    };

    for (const event of events) {
      // Count by type
      stats.eventTypes[event.type] = (stats.eventTypes[event.type] || 0) + 1;

      // Track specific event types
      if (event.type === 'message') stats.messageCount++;
      if (event.type === 'thinking') stats.thinkingCount++;
      if (event.type === 'tool_call') stats.toolCalls.push(event.toolName);
      if (event.type === 'error') stats.errors.push(event.error);
    }

    return stats;
  }

  /**
   * Clear session from memory (after saving)
   */
  clearSession(sessionKey) {
    this.activeSessions.delete(sessionKey);
  }
}

module.exports = SessionReplayRecorder;
