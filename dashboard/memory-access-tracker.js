#!/usr/bin/env node
// Memory Access Tracker for ALFIE Nexus
// Tracks which second brain memories are accessed most frequently
// NOVEL FEATURE - Nobody else does this!

const fs = require('fs');
const path = require('path');

class MemoryAccessTracker {
  constructor() {
    this.accessLog = []; // Recent memory accesses
    this.heatmap = new Map(); // memory_id → access count
    this.temporal = new Map(); // timestamp → access count
    this.clusters = new Map(); // topic → memories
    this.maxLog = 10000; // Keep last 10k accesses
    
    this.dataPath = path.join(__dirname, '.memory_access.json');
    this.loadData();
    
    // Auto-save every 5 minutes
    setInterval(() => this.saveData(), 5 * 60 * 1000);
  }

  // Load persisted access data
  loadData() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        this.accessLog = data.accessLog || [];
        this.heatmap = new Map(Object.entries(data.heatmap || {}));
        this.temporal = new Map(Object.entries(data.temporal || {}));
        this.clusters = new Map(Object.entries(data.clusters || {}));
      }
    } catch (err) {
      console.error('[MemoryTracker] Failed to load data:', err.message);
    }
  }

  // Save access data to disk
  saveData() {
    try {
      const data = {
        accessLog: this.accessLog.slice(-this.maxLog),
        heatmap: Object.fromEntries(this.heatmap),
        temporal: Object.fromEntries(this.temporal),
        clusters: Object.fromEntries(this.clusters),
        lastSaved: Date.now()
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[MemoryTracker] Failed to save data:', err.message);
    }
  }

  // Record a memory access
  recordAccess(memoryId, metadata = {}) {
    const timestamp = Date.now();
    const hourKey = Math.floor(timestamp / (60 * 60 * 1000));
    
    // Add to access log
    this.accessLog.push({
      memoryId,
      timestamp,
      query: metadata.query || null,
      score: metadata.score || null,
      context: metadata.context || null
    });

    // Trim log if too large
    if (this.accessLog.length > this.maxLog) {
      this.accessLog = this.accessLog.slice(-this.maxLog);
    }

    // Update heatmap (access count)
    const currentCount = this.heatmap.get(memoryId) || 0;
    this.heatmap.set(memoryId, currentCount + 1);

    // Update temporal data (accesses per hour)
    const hourCount = this.temporal.get(hourKey.toString()) || 0;
    this.temporal.set(hourKey.toString(), hourCount + 1);

    // Update clusters if topic provided
    if (metadata.topic) {
      const clusterMemories = this.clusters.get(metadata.topic) || [];
      if (!clusterMemories.includes(memoryId)) {
        clusterMemories.push(memoryId);
        this.clusters.set(metadata.topic, clusterMemories);
      }
    }
  }

  // Get hottest memories (most accessed)
  getTopMemories(limit = 50) {
    return Array.from(this.heatmap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([memoryId, count]) => {
        // Find latest access
        const recentAccess = this.accessLog
          .slice()
          .reverse()
          .find(log => log.memoryId === memoryId);

        return {
          memoryId,
          accessCount: count,
          lastAccessed: recentAccess?.timestamp || null,
          lastQuery: recentAccess?.query || null,
          lastScore: recentAccess?.score || null
        };
      });
  }

  // Get coldest memories (least accessed)
  getColdMemories(limit = 50) {
    return Array.from(this.heatmap.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([memoryId, count]) => ({
        memoryId,
        accessCount: count
      }));
  }

  // Get temporal heatmap (accesses over time)
  getTemporalHeatmap(hoursBack = 168) { // Default: last week
    const now = Date.now();
    const oldestHour = Math.floor((now - hoursBack * 60 * 60 * 1000) / (60 * 60 * 1000));
    
    const timeline = [];
    for (let i = 0; i < hoursBack; i++) {
      const hourKey = (oldestHour + i).toString();
      const count = this.temporal.get(hourKey) || 0;
      timeline.push({
        hour: oldestHour + i,
        timestamp: (oldestHour + i) * 60 * 60 * 1000,
        accessCount: count
      });
    }

    return timeline;
  }

  // Get clusters (grouped by topic)
  getClusters() {
    return Array.from(this.clusters.entries())
      .map(([topic, memories]) => {
        // Calculate total accesses for this cluster
        const totalAccesses = memories.reduce((sum, memId) => {
          return sum + (this.heatmap.get(memId) || 0);
        }, 0);

        return {
          topic,
          memoryCount: memories.length,
          totalAccesses,
          avgAccessemedical-sampleemory: Math.round(totalAccesses / memories.length)
        };
      })
      .sort((a, b) => b.totalAccesses - a.totalAccesses);
  }

  // Get statistics
  getStats() {
    const totalAccesses = this.accessLog.length;
    const uniqueMemories = this.heatmap.size;
    const avgAccessemedical-sampleemory = uniqueMemories > 0 
      ? Math.round(totalAccesses / uniqueMemories) 
      : 0;

    // Calculate access velocity (accesses per hour, last 24h)
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const recent = this.accessLog.filter(log => log.timestamp >= last24h).length;
    const velocity = Math.round(recent / 24 * 10) / 10;

    // Find peak hour
    const hourCounts = Array.from(this.temporal.values());
    const peakHourAccesses = hourCounts.length > 0 ? Math.max(...hourCounts) : 0;

    return {
      totalAccesses,
      uniqueMemories,
      avgAccessemedical-sampleemory,
      velocity, // accesses per hour
      peakHourAccesses,
      topClusters: this.getClusters().slice(0, 10),
      oldestAccess: this.accessLog.length > 0 ? this.accessLog[0].timestamp : null,
      newestAccess: this.accessLog.length > 0 ? this.accessLog[this.accessLog.length - 1].timestamp : null
    };
  }

  // Get recent access stream (for live feed)
  getRecentAccesses(limit = 20) {
    return this.accessLog.slice(-limit).reverse();
  }

  // Reset all data (for testing)
  reset() {
    this.accessLog = [];
    this.heatmap.clear();
    this.temporal.clear();
    this.clusters.clear();
    this.saveData();
  }
}

module.exports = MemoryAccessTracker;
