#!/usr/bin/env node
// Latency Tracking Module for ALFIE Nexus
// Tracks P50, P95, P99 latency + TTFT (Time To First Token)

class LatencyTracker {
  constructor() {
    // Store last 1000 samples (rolling window)
    this.samples = [];
    this.maxSamples = 1000;
    
    // Track active requests
    this.activeRequests = new Map(); // messageId → { startTime, firstTokenTime }
    
    // Stats
    this.totalRequests = 0;
    this.totalLatency = 0;
  }

  // Start tracking a new request
  startRequest(messageId) {
    this.activeRequests.set(messageId, {
      startTime: Date.now(),
      firstTokenTime: null,
    });
  }

  // Record first token (for TTFT)
  recordFirstToken(messageId) {
    const req = this.activeRequests.get(messageId);
    if (req && !req.firstTokenTime) {
      req.firstTokenTime = Date.now();
    }
  }

  // Complete request and calculate latency
  completeRequest(messageId) {
    const req = this.activeRequests.get(messageId);
    if (!req) return null;

    const endTime = Date.now();
    const totalLatency = endTime - req.startTime;
    const ttft = req.firstTokenTime ? req.firstTokenTime - req.startTime : null;

    // Store sample
    const sample = {
      timestamp: endTime,
      totalLatency,
      ttft,
      messageId,
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift(); // Remove oldest
    }

    this.totalRequests++;
    this.totalLatency += totalLatency;

    this.activeRequests.delete(messageId);

    return sample;
  }

  // Calculate percentiles
  getPercentile(percentile) {
    if (this.samples.length === 0) return 0;
    
    const sorted = this.samples
      .map(s => s.totalLatency)
      .sort((a, b) => a - b);
    
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  // Calculate TTFT percentiles
  getTTFTPercentile(percentile) {
    const validSamples = this.samples
      .filter(s => s.ttft !== null)
      .map(s => s.ttft)
      .sort((a, b) => a - b);
    
    if (validSamples.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * validSamples.length) - 1;
    return validSamples[Math.max(0, index)] || 0;
  }

  // Get stats summary
  getStats() {
    const p50 = this.getPercentile(50);
    const p95 = this.getPercentile(95);
    const p99 = this.getPercentile(99);
    const avgLatency = this.samples.length > 0 
      ? this.samples.reduce((sum, s) => sum + s.totalLatency, 0) / this.samples.length 
      : 0;

    const ttftP50 = this.getTTFTPercentile(50);
    const ttftP95 = this.getTTFTPercentile(95);
    const ttftP99 = this.getTTFTPercentile(99);
    const avgTTFT = this.samples.filter(s => s.ttft !== null).length > 0
      ? this.samples.filter(s => s.ttft !== null).reduce((sum, s) => sum + s.ttft, 0) / this.samples.filter(s => s.ttft !== null).length
      : 0;

    return {
      totalRequests: this.totalRequests,
      sampleCount: this.samples.length,
      latency: {
        p50: Math.round(p50),
        p95: Math.round(p95),
        p99: Math.round(p99),
        avg: Math.round(avgLatency),
        min: this.samples.length > 0 ? Math.min(...this.samples.map(s => s.totalLatency)) : 0,
        max: this.samples.length > 0 ? Math.max(...this.samples.map(s => s.totalLatency)) : 0,
      },
      ttft: {
        p50: Math.round(ttftP50),
        p95: Math.round(ttftP95),
        p99: Math.round(ttftP99),
        avg: Math.round(avgTTFT),
      },
      histogram: this.getHistogram(),
    };
  }

  // Get histogram data for visualization
  getHistogram() {
    if (this.samples.length === 0) return [];

    // Create 20 buckets
    const buckets = 20;
    const latencies = this.samples.map(s => s.totalLatency);
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const bucketSize = (max - min) / buckets;

    const histogram = Array(buckets).fill(0);
    
    for (const latency of latencies) {
      const bucketIndex = Math.min(
        Math.floor((latency - min) / bucketSize),
        buckets - 1
      );
      histogram[bucketIndex]++;
    }

    return histogram.map((count, i) => ({
      min: Math.round(min + i * bucketSize),
      max: Math.round(min + (i + 1) * bucketSize),
      count,
    }));
  }

  // Get recent samples (for debugging)
  getRecentSamples(count = 10) {
    return this.samples.slice(-count);
  }

  // Clear all data (reset)
  reset() {
    this.samples = [];
    this.activeRequests.clear();
    this.totalRequests = 0;
    this.totalLatency = 0;
  }
}

module.exports = LatencyTracker;
