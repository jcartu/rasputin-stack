#!/usr/bin/env node
// P95/P99 Latency Tracking Enhancements for ALFIE Nexus
// Feature: GPU-Latency Correlation + Trend Detection + Anomaly Alerts

// This module extends the existing latency tracker with:
// 1. GPU utilization correlation (unique to ALFIE)
// 2. Latency trend detection (improving/degrading)
// 3. Anomaly detection (spikes > 2x P95)
// 4. TTFT optimization insights

class LatencyEnhancements {
  constructor(latencyTracker, gpuMonitor) {
    this.latencyTracker = latencyTracker;
    this.gpuMonitor = gpuMonitor;
    
    // Correlation data
    this.correlationSamples = []; // { timestamp, latency, gpuUtil }
    this.maxCorrelationSamples = 100;
    
    // Trend tracking
    this.trendWindow = 20; // Last 20 requests
    this.lastTrendCheck = 0;
    this.currentTrend = 'stable'; // stable | improving | degrading
    
    // Anomaly detection
    this.anomalyThreshold = 2.0; // 2x P95
    this.recentAnomalies = [];
    this.maxAnomalies = 50;
  }

  // Record a completed request with GPU correlation
  recordSample(sample, gpuUtilization = null) {
    if (!sample) return;

    const correlationSample = {
      timestamp: sample.timestamp,
      latency: sample.totalLatency,
      ttft: sample.ttft,
      messageId: sample.messageId,
      gpuUtil: gpuUtilization,
    };

    this.correlationSamples.push(correlationSample);
    if (this.correlationSamples.length > this.maxCorrelationSamples) {
      this.correlationSamples.shift();
    }

    // Check for anomalies
    this.checkForAnomalies(sample);
  }

  // Detect latency anomalies (spikes > 2x P95)
  checkForAnomalies(sample) {
    const stats = this.latencyTracker.getStats();
    const p95 = stats.latency.p95;
    
    if (p95 > 0 && sample.totalLatency > p95 * this.anomalyThreshold) {
      const anomaly = {
        timestamp: sample.timestamp,
        latency: sample.totalLatency,
        p95: p95,
        ratio: (sample.totalLatency / p95).toFixed(2),
        messageId: sample.messageId,
      };

      this.recentAnomalies.push(anomaly);
      if (this.recentAnomalies.length > this.maxAnomalies) {
        this.recentAnomalies.shift();
      }

      console.log(`🔴 Latency anomaly detected: ${sample.totalLatency}ms (${anomaly.ratio}x P95)`);
      return anomaly;
    }

    return null;
  }

  // Calculate GPU-latency correlation
  getGPUCorrelation() {
    const validSamples = this.correlationSamples.filter(s => s.gpuUtil !== null);
    if (validSamples.length < 10) {
      return {
        enabled: false,
        message: 'Insufficient GPU correlation data',
      };
    }

    // Calculate Pearson correlation coefficient
    const n = validSamples.length;
    const sumLatency = validSamples.reduce((sum, s) => sum + s.latency, 0);
    const sumGPU = validSamples.reduce((sum, s) => sum + s.gpuUtil, 0);
    const sumLatencyGPU = validSamples.reduce((sum, s) => sum + s.latency * s.gpuUtil, 0);
    const sumLatencySq = validSamples.reduce((sum, s) => sum + s.latency * s.latency, 0);
    const sumGPUSq = validSamples.reduce((sum, s) => sum + s.gpuUtil * s.gpuUtil, 0);

    const numerator = n * sumLatencyGPU - sumLatency * sumGPU;
    const denominator = Math.sqrt(
      (n * sumLatencySq - sumLatency * sumLatency) *
      (n * sumGPUSq - sumGPU * sumGPU)
    );

    const correlation = denominator === 0 ? 0 : numerator / denominator;

    // Interpret correlation
    let strength, message;
    const absCorr = Math.abs(correlation);
    
    if (absCorr >= 0.7) {
      strength = 'strong';
      message = correlation > 0 
        ? '🔥 High GPU utilization causes latency spikes'
        : '🤔 Lower GPU usage paradoxically increases latency';
    } else if (absCorr >= 0.4) {
      strength = 'moderate';
      message = correlation > 0
        ? '⚠️ GPU utilization moderately affects latency'
        : 'ℹ️ GPU and latency show weak inverse relationship';
    } else {
      strength = 'weak';
      message = '✓ Latency independent of GPU utilization';
    }

    // Find highest GPU spike
    const maxGPUSample = validSamples.reduce((max, s) => 
      s.gpuUtil > max.gpuUtil ? s : max
    , validSamples[0]);

    return {
      enabled: true,
      correlation: correlation.toFixed(3),
      strength,
      message,
      maxGPUUtilization: maxGPUSample.gpuUtil,
      maxGPULatency: maxGPUSample.latency,
      sampleCount: n,
    };
  }

  // Detect latency trend (improving/degrading/stable)
  detectTrend() {
    const now = Date.now();
    if (now - this.lastTrendCheck < 10000) {
      return this.currentTrend; // Only check every 10s
    }
    this.lastTrendCheck = now;

    const samples = this.latencyTracker.getRecentSamples(this.trendWindow);
    if (samples.length < this.trendWindow) {
      return 'insufficient_data';
    }

    // Split into first half and second half
    const halfPoint = Math.floor(samples.length / 2);
    const firstHalf = samples.slice(0, halfPoint);
    const secondHalf = samples.slice(halfPoint);

    const avgFirst = firstHalf.reduce((sum, s) => sum + s.totalLatency, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, s) => sum + s.totalLatency, 0) / secondHalf.length;

    const change = ((avgSecond - avgFirst) / avgFirst) * 100;

    let trend;
    if (change > 20) {
      trend = 'degrading';
    } else if (change < -20) {
      trend = 'improving';
    } else {
      trend = 'stable';
    }

    this.currentTrend = trend;

    return {
      trend,
      change: change.toFixed(1),
      avgBefore: Math.round(avgFirst),
      avgNow: Math.round(avgSecond),
      sampleCount: samples.length,
    };
  }

  // Get TTFT optimization insights
  getTTFTInsights() {
    const stats = this.latencyTracker.getStats();
    const ttft = stats.ttft;
    const latency = stats.latency;

    if (ttft.p95 === 0 || latency.p95 === 0) {
      return {
        enabled: false,
        message: 'Insufficient TTFT data',
      };
    }

    // Calculate TTFT as percentage of total latency
    const ttftRatio = (ttft.p95 / latency.p95) * 100;

    let message, recommendation;
    if (ttftRatio > 50) {
      message = `⚠️ First token takes ${ttftRatio.toFixed(0)}% of total response time`;
      recommendation = 'Consider prompt caching or smaller context windows';
    } else if (ttftRatio > 30) {
      message = `ℹ️ First token is ${ttftRatio.toFixed(0)}% of total latency`;
      recommendation = 'TTFT is reasonable but could be optimized';
    } else {
      message = `✓ First token only ${ttftRatio.toFixed(0)}% of total time`;
      recommendation = 'TTFT is well-optimized';
    }

    return {
      enabled: true,
      ttftRatio: ttftRatio.toFixed(1),
      message,
      recommendation,
      ttftP95: ttft.p95,
      latencyP95: latency.p95,
    };
  }

  // Get anomaly summary
  getAnomalySummary() {
    const recentMinutes = 5;
    const cutoff = Date.now() - recentMinutes * 60 * 1000;
    const recentAnomalies = this.recentAnomalies.filter(a => a.timestamp > cutoff);

    if (recentAnomalies.length === 0) {
      return {
        count: 0,
        message: `✓ No anomalies in last ${recentMinutes} minutes`,
      };
    }

    const maxAnomaly = recentAnomalies.reduce((max, a) => 
      a.ratio > max.ratio ? a : max
    , recentAnomalies[0]);

    return {
      count: recentAnomalies.length,
      maxRatio: maxAnomaly.ratio,
      maxLatency: maxAnomaly.latency,
      message: `🔴 ${recentAnomalies.length} spike${recentAnomalies.length > 1 ? 's' : ''} in last ${recentMinutes} min (max: ${maxAnomaly.latency}ms)`,
    };
  }

  // Get comprehensive enhanced stats
  getEnhancedStats() {
    const baseStats = this.latencyTracker.getStats();
    const gpuCorrelation = this.getGPUCorrelation();
    const trend = this.detectTrend();
    const ttftInsights = this.getTTFTInsights();
    const anomalies = this.getAnomalySummary();

    return {
      ...baseStats,
      enhancements: {
        gpuCorrelation,
        trend,
        ttftInsights,
        anomalies,
        timestamp: Date.now(),
      },
    };
  }

  // Reset all enhancement data
  reset() {
    this.correlationSamples = [];
    this.recentAnomalies = [];
    this.currentTrend = 'stable';
    this.lastTrendCheck = 0;
  }
}

module.exports = LatencyEnhancements;
