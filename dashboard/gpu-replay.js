/**
 * GPU REPLAY - Visual GPU Utilization During Session Replay
 * 
 * UNIQUE FEATURE: No other AI agent dashboard (Langfuse, Helicone, AgentOps, 
 * LangSmith, Open WebUI, Dify) has GPU monitoring. ALFIE does.
 * 
 * This correlates session replay with GPU utilization in real-time.
 * 
 * Features:
 * - Session timeline with GPU utilization graph overlaid
 * - Click GPU spike → jump to that moment in replay
 * - Color-coded GPU usage (green → yellow → red)
 * - Shows which messages/tool calls triggered GPU load
 * - Dual-GPU support (GPU0: PRO 6000, GPU1: RTX 5090)
 * 
 * Competitive advantage: Visual correlation of agent actions with hardware usage
 */

const fs = require('fs').promises;
const path = require('path');

class GPUReplayEngine {
  constructor() {
    this.historyDir = path.join(__dirname, '.gpu_history');
    this.replayDir = path.join(__dirname, '.session_replays');
    this.cacheTTL = 30000; // 30 seconds
    this.cache = new Map();
  }

  /**
   * Initialize GPU history directory
   */
  async init() {
    try {
      await fs.mkdir(this.historyDir, { recursive: true });
      console.log('[GPU-Replay] Initialized history directory');
    } catch (err) {
      console.error('[GPU-Replay] Init error:', err.message);
    }
  }

  /**
   * Record GPU snapshot with timestamp
   */
  async recordGPUSnapshot(sessionId, gpuData) {
    const timestamp = Date.now();
    const snapshot = {
      timestamp,
      sessionId,
      gpus: gpuData,
      memory: {
        gpu0: {
          used: gpuData[0]?.memory_used || 0,
          total: gpuData[0]?.memory_total || 96 * 1024, // 96GB for PRO 6000
          percent: gpuData[0]?.memory_percent || 0
        },
        gpu1: {
          used: gpuData[1]?.memory_used || 0,
          total: gpuData[1]?.memory_total || 32 * 1024, // 32GB for RTX 5090
          percent: gpuData[1]?.memory_percent || 0
        }
      },
      utilization: {
        gpu0: gpuData[0]?.utilization || 0,
        gpu1: gpuData[1]?.utilization || 0,
        avg: (gpuData[0]?.utilization + gpuData[1]?.utilization) / 2 || 0
      }
    };

    try {
      const historyFile = path.join(this.historyDir, `${sessionId}.jsonl`);
      await fs.appendFile(historyFile, JSON.stringify(snapshot) + '\n');
    } catch (err) {
      console.error('[GPU-Replay] Record error:', err.message);
    }
  }

  /**
   * Get GPU history for a session
   */
  async getGPUHistory(sessionId) {
    const cacheKey = `history_${sessionId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    try {
      const historyFile = path.join(this.historyDir, `${sessionId}.jsonl`);
      const content = await fs.readFile(historyFile, 'utf8');
      const snapshots = content
        .trim()
        .split('\n')
        .filter(line => line)
        .map(line => JSON.parse(line));

      const data = {
        sessionId,
        snapshots,
        duration: snapshots.length > 0 
          ? snapshots[snapshots.length - 1].timestamp - snapshots[0].timestamp 
          : 0,
        stats: this._calculateStats(snapshots)
      };

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[GPU-Replay] Read error:', err.message);
      }
      return {
        sessionId,
        snapshots: [],
        duration: 0,
        stats: null
      };
    }
  }

  /**
   * Correlate session events with GPU usage
   */
  async correlateSessionWithGPU(sessionId) {
    try {
      // Load session replay data
      const replayFile = path.join(this.replayDir, `${sessionId}.json`);
      let sessionData;
      try {
        const content = await fs.readFile(replayFile, 'utf8');
        sessionData = JSON.parse(content);
      } catch {
        return { error: 'Session replay not found' };
      }

      // Load GPU history
      const gpuHistory = await this.getGPUHistory(sessionId);
      if (gpuHistory.snapshots.length === 0) {
        return {
          session: sessionData,
          gpu: null,
          message: 'No GPU data recorded for this session'
        };
      }

      // Correlate events with GPU snapshots
      const correlatedEvents = sessionData.events.map(event => {
        // Find closest GPU snapshot
        const closestSnapshot = this._findClosestSnapshot(
          gpuHistory.snapshots,
          event.timestamp
        );

        return {
          ...event,
          gpu: closestSnapshot ? {
            timestamp: closestSnapshot.timestamp,
            utilization: closestSnapshot.utilization,
            memory: closestSnapshot.memory,
            spike: this._isSpike(closestSnapshot, gpuHistory.stats)
          } : null
        };
      });

      return {
        session: {
          ...sessionData,
          events: correlatedEvents
        },
        gpu: {
          ...gpuHistory,
          timeline: this._buildGPUTimeline(gpuHistory.snapshots)
        },
        correlations: this._findInterestingCorrelations(correlatedEvents)
      };
    } catch (err) {
      console.error('[GPU-Replay] Correlation error:', err.message);
      return { error: err.message };
    }
  }

  /**
   * Calculate GPU usage statistics
   */
  _calculateStats(snapshots) {
    if (snapshots.length === 0) return null;

    const gpu0Utils = snapshots.map(s => s.utilization.gpu0);
    const gpu1Utils = snapshots.map(s => s.utilization.gpu1);
    const avgUtils = snapshots.map(s => s.utilization.avg);

    return {
      gpu0: {
        min: Math.min(...gpu0Utils),
        max: Math.max(...gpu0Utils),
        avg: gpu0Utils.reduce((a, b) => a + b, 0) / gpu0Utils.length,
        p95: this._percentile(gpu0Utils, 0.95)
      },
      gpu1: {
        min: Math.min(...gpu1Utils),
        max: Math.max(...gpu1Utils),
        avg: gpu1Utils.reduce((a, b) => a + b, 0) / gpu1Utils.length,
        p95: this._percentile(gpu1Utils, 0.95)
      },
      combined: {
        min: Math.min(...avgUtils),
        max: Math.max(...avgUtils),
        avg: avgUtils.reduce((a, b) => a + b, 0) / avgUtils.length,
        p95: this._percentile(avgUtils, 0.95)
      }
    };
  }

  /**
   * Find closest GPU snapshot to a timestamp
   */
  _findClosestSnapshot(snapshots, targetTimestamp) {
    if (snapshots.length === 0) return null;

    let closest = snapshots[0];
    let minDiff = Math.abs(snapshots[0].timestamp - targetTimestamp);

    for (const snapshot of snapshots) {
      const diff = Math.abs(snapshot.timestamp - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snapshot;
      }
    }

    return minDiff < 5000 ? closest : null; // Within 5 seconds
  }

  /**
   * Check if GPU snapshot is a spike
   */
  _isSpike(snapshot, stats) {
    if (!stats) return false;

    const threshold = stats.combined.avg + (stats.combined.avg * 0.5); // 50% above average
    return snapshot.utilization.avg > threshold;
  }

  /**
   * Build GPU timeline for visualization
   */
  _buildGPUTimeline(snapshots) {
    if (snapshots.length === 0) return [];

    const startTime = snapshots[0].timestamp;
    return snapshots.map(snapshot => ({
      time: snapshot.timestamp - startTime, // Relative time in ms
      timestamp: snapshot.timestamp,
      gpu0: snapshot.utilization.gpu0,
      gpu1: snapshot.utilization.gpu1,
      avg: snapshot.utilization.avg,
      memory: {
        gpu0_percent: snapshot.memory.gpu0.percent,
        gpu1_percent: snapshot.memory.gpu1.percent
      }
    }));
  }

  /**
   * Find interesting correlations between events and GPU usage
   */
  _findInterestingCorrelations(events) {
    const correlations = [];

    // Find tool calls that triggered GPU spikes
    const toolCalls = events.filter(e => e.type === 'tool_call' && e.gpu?.spike);
    if (toolCalls.length > 0) {
      correlations.push({
        type: 'gpu_intensive_tools',
        severity: 'high',
        message: `${toolCalls.length} tool call(s) triggered GPU spikes`,
        events: toolCalls.map(e => ({
          tool: e.data?.tool || 'unknown',
          timestamp: e.timestamp,
          gpuUtil: e.gpu?.utilization?.avg
        }))
      });
    }

    // Find messages that caused sustained GPU usage
    const messages = events.filter(e => 
      (e.type === 'user_message' || e.type === 'assistant_message') && 
      e.gpu?.utilization?.avg > 50
    );
    if (messages.length > 0) {
      correlations.push({
        type: 'gpu_intensive_inference',
        severity: 'medium',
        message: `${messages.length} message(s) triggered >50% GPU utilization`,
        events: messages.map(e => ({
          role: e.role,
          timestamp: e.timestamp,
          gpuUtil: e.gpu?.utilization?.avg,
          preview: e.content?.substring(0, 100) || ''
        }))
      });
    }

    // Find idle periods (GPU < 10%)
    const idlePeriods = [];
    let idleStart = null;
    events.forEach((event, idx) => {
      if (event.gpu?.utilization?.avg < 10) {
        if (!idleStart) idleStart = event.timestamp;
      } else {
        if (idleStart) {
          const duration = event.timestamp - idleStart;
          if (duration > 10000) { // > 10 seconds
            idlePeriods.push({ start: idleStart, end: event.timestamp, duration });
          }
          idleStart = null;
        }
      }
    });

    if (idlePeriods.length > 0) {
      correlations.push({
        type: 'idle_periods',
        severity: 'info',
        message: `${idlePeriods.length} idle period(s) detected (GPU < 10%)`,
        periods: idlePeriods
      });
    }

    return correlations;
  }

  /**
   * Calculate percentile
   */
  _percentile(arr, p) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[index];
  }

  /**
   * Clean up old GPU history files
   */
  async cleanupOldHistory(maxAgeMs = 7 * 24 * 60 * 60 * 1000) { // 7 days
    try {
      const files = await fs.readdir(this.historyDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(this.historyDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.unlink(filePath);
          console.log(`[GPU-Replay] Cleaned up old history: ${file}`);
        }
      }
    } catch (err) {
      console.error('[GPU-Replay] Cleanup error:', err.message);
    }
  }
}

module.exports = { GPUReplayEngine };
