#!/usr/bin/env node
// Advanced Latency Alerting & Anomaly Detection for ALFIE Nexus
// Implements competitive analysis recommendations: alerting, regression detection, historical comparison

const fs = require('fs');
const path = require('path');

class LatencyAlerter {
  constructor(options = {}) {
    this.alertHistoryFile = options.alertHistoryFile || path.join(__dirname, '.latency_alerts.json');
    this.thresholds = options.thresholds || {
      p95Warning: 3000,      // ms - warn if P95 > 3s
      p95Critical: 5000,     // ms - critical if P95 > 5s
      p99Critical: 8000,     // ms - critical if P99 > 8s
      ttftWarning: 1000,     // ms - warn if TTFT P95 > 1s
      regressionThreshold: 1.5, // Alert if P95 increases by 50%+
    };
    
    // Historical data for comparison
    this.historicalData = this.loadHistoricalData();
    this.activeAlerts = new Map();
    this.alertHistory = this.loadAlertHistory();
    
    // Stats for anomaly detection
    this.recentSamples = []; // Last 20 P95 samples
    this.maxSamples = 20;
  }

  // Load historical data (24h ago baseline)
  loadHistoricalData() {
    const historyFile = path.join(__dirname, '.latency_history.json');
    try {
      if (fs.existsSync(historyFile)) {
        const data = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        return data;
      }
    } catch (e) {
      console.error('Failed to load latency history:', e.message);
    }
    return {
      timestamp: Date.now() - 86400000, // 24h ago
      p50: 0,
      p95: 0,
      p99: 0,
      ttft: { p95: 0 },
    };
  }

  // Save historical data (called daily)
  saveHistoricalData(stats) {
    const historyFile = path.join(__dirname, '.latency_history.json');
    const snapshot = {
      timestamp: Date.now(),
      p50: stats.latency.p50,
      p95: stats.latency.p95,
      p99: stats.latency.p99,
      ttft: { p95: stats.ttft.p95 },
    };
    try {
      fs.writeFileSync(historyFile, JSON.stringify(snapshot, null, 2));
    } catch (e) {
      console.error('Failed to save latency history:', e.message);
    }
  }

  // Load alert history
  loadAlertHistory() {
    try {
      if (fs.existsSync(this.alertHistoryFile)) {
        return JSON.parse(fs.readFileSync(this.alertHistoryFile, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to load alert history:', e.message);
    }
    return [];
  }

  // Save alert history
  saveAlertHistory() {
    try {
      // Keep last 100 alerts
      const recent = this.alertHistory.slice(-100);
      fs.writeFileSync(this.alertHistoryFile, JSON.stringify(recent, null, 2));
    } catch (e) {
      console.error('Failed to save alert history:', e.message);
    }
  }

  // Analyze latency stats and generate alerts
  analyze(stats, gpuData = null) {
    const alerts = [];
    const now = Date.now();

    // Track P95 for anomaly detection
    this.recentSamples.push(stats.latency.p95);
    if (this.recentSamples.length > this.maxSamples) {
      this.recentSamples.shift();
    }

    // 1. Absolute threshold alerts
    if (stats.latency.p95 > this.thresholds.p95Critical) {
      alerts.push(this.createAlert('critical', 'P95_HIGH', 
        `P95 latency critically high: ${stats.latency.p95}ms (threshold: ${this.thresholds.p95Critical}ms)`,
        stats
      ));
    } else if (stats.latency.p95 > this.thresholds.p95Warning) {
      alerts.push(this.createAlert('warning', 'P95_ELEVATED', 
        `P95 latency elevated: ${stats.latency.p95}ms (threshold: ${this.thresholds.p95Warning}ms)`,
        stats
      ));
    }

    if (stats.latency.p99 > this.thresholds.p99Critical) {
      alerts.push(this.createAlert('critical', 'P99_HIGH', 
        `P99 tail latency critically high: ${stats.latency.p99}ms (threshold: ${this.thresholds.p99Critical}ms)`,
        stats
      ));
    }

    if (stats.ttft.p95 > this.thresholds.ttftWarning) {
      alerts.push(this.createAlert('warning', 'TTFT_SLOW', 
        `Time to First Token slow: ${stats.ttft.p95}ms (threshold: ${this.thresholds.ttftWarning}ms) - Users experiencing lag`,
        stats
      ));
    }

    // 2. Regression detection (compare to historical baseline)
    if (this.historicalData.p95 > 0) {
      const regressionFactor = stats.latency.p95 / this.historicalData.p95;
      if (regressionFactor >= this.thresholds.regressionThreshold) {
        const percentIncrease = Math.round((regressionFactor - 1) * 100);
        alerts.push(this.createAlert('warning', 'REGRESSION', 
          `Latency regression detected: P95 increased ${percentIncrease}% vs 24h ago (was ${this.historicalData.p95}ms, now ${stats.latency.p95}ms)`,
          stats
        ));
      }
    }

    // 3. Anomaly detection (sudden spike)
    if (this.recentSamples.length >= 10) {
      const recent = this.recentSamples.slice(-10);
      const avg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
      const stdDev = Math.sqrt(
        recent.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / recent.length
      );
      const current = stats.latency.p95;
      
      // Alert if current value is > 2 standard deviations from recent average
      if (current > avg + (2 * stdDev) && stdDev > 100) {
        alerts.push(this.createAlert('warning', 'ANOMALY', 
          `Sudden latency spike detected: ${current}ms (${Math.round((current - avg) / avg * 100)}% above recent average of ${Math.round(avg)}ms)`,
          stats
        ));
      }
    }

    // 4. GPU correlation alert (UNIQUE TO ALFIE!)
    if (gpuData && gpuData.gpus && gpuData.gpus.length > 0) {
      const avgGpuUtil = gpuData.gpus.reduce((sum, g) => sum + (g.utilization || 0), 0) / gpuData.gpus.length;
      
      if (avgGpuUtil > 90 && stats.latency.p95 > stats.latency.avg * 1.5) {
        alerts.push(this.createAlert('warning', 'GPU_BOTTLENECK', 
          `GPU bottleneck detected: ${Math.round(avgGpuUtil)}% utilization correlates with ${stats.latency.p95}ms P95 latency. Consider scaling GPU resources.`,
          stats,
          { gpuUtilization: avgGpuUtil }
        ));
      }
    }

    // Process alerts (dedupe, rate-limit)
    const processedAlerts = this.processAlerts(alerts, now);

    return {
      alerts: processedAlerts,
      activeAlertCount: this.activeAlerts.size,
      comparison: this.getComparison(stats),
      anomalyScore: this.calculateAnomalyScore(stats),
    };
  }

  // Create alert object
  createAlert(severity, type, message, stats, metadata = {}) {
    return {
      id: `${type}_${Date.now()}`,
      severity, // 'info', 'warning', 'critical'
      type,
      message,
      timestamp: Date.now(),
      stats: {
        p50: stats.latency.p50,
        p95: stats.latency.p95,
        p99: stats.latency.p99,
        avg: stats.latency.avg,
      },
      metadata,
    };
  }

  // Process alerts (dedupe, rate-limit)
  processAlerts(alerts, now) {
    const processed = [];
    
    for (const alert of alerts) {
      const key = alert.type;
      const existing = this.activeAlerts.get(key);
      
      // Rate limiting: Only re-alert every 5 minutes for same type
      if (existing && (now - existing.timestamp < 300000)) {
        continue; // Skip duplicate
      }
      
      // Add to active alerts
      this.activeAlerts.set(key, alert);
      
      // Add to history
      this.alertHistory.push(alert);
      
      processed.push(alert);
    }
    
    // Clean up old active alerts (older than 30 minutes)
    for (const [key, alert] of this.activeAlerts.entries()) {
      if (now - alert.timestamp > 1800000) {
        this.activeAlerts.delete(key);
      }
    }
    
    // Save history if new alerts
    if (processed.length > 0) {
      this.saveAlertHistory();
    }
    
    return processed;
  }

  // Compare current stats to historical baseline
  getComparison(stats) {
    if (this.historicalData.p95 === 0) {
      return null; // No baseline yet
    }
    
    const p95Change = stats.latency.p95 - this.historicalData.p95;
    const p95ChangePercent = Math.round((p95Change / this.historicalData.p95) * 100);
    
    const p99Change = stats.latency.p99 - this.historicalData.p99;
    const p99ChangePercent = Math.round((p99Change / this.historicalData.p99) * 100);
    
    return {
      baseline: {
        timestamp: this.historicalData.timestamp,
        p95: this.historicalData.p95,
        p99: this.historicalData.p99,
      },
      current: {
        p95: stats.latency.p95,
        p99: stats.latency.p99,
      },
      change: {
        p95: p95Change,
        p95Percent: p95ChangePercent,
        p99: p99Change,
        p99Percent: p99ChangePercent,
      },
      trend: p95ChangePercent > 10 ? 'up' : (p95ChangePercent < -10 ? 'down' : 'stable'),
    };
  }

  // Calculate anomaly score (0-100, higher = more anomalous)
  calculateAnomalyScore(stats) {
    let score = 0;
    
    // Factor 1: How far above thresholds
    if (stats.latency.p95 > this.thresholds.p95Warning) {
      score += Math.min(30, (stats.latency.p95 - this.thresholds.p95Warning) / 100);
    }
    
    // Factor 2: Variance (higher variance = more unstable)
    if (this.recentSamples.length >= 5) {
      const recent = this.recentSamples.slice(-5);
      const avg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
      const variance = recent.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / recent.length;
      const coefficientOfVariation = Math.sqrt(variance) / avg;
      score += Math.min(30, coefficientOfVariation * 100);
    }
    
    // Factor 3: Historical regression
    if (this.historicalData.p95 > 0) {
      const regression = (stats.latency.p95 / this.historicalData.p95) - 1;
      if (regression > 0) {
        score += Math.min(40, regression * 100);
      }
    }
    
    return Math.min(100, Math.round(score));
  }

  // Get alert summary for dashboard
  getSummary() {
    return {
      activeAlerts: Array.from(this.activeAlerts.values()),
      recentAlerts: this.alertHistory.slice(-10),
      totalAlerts: this.alertHistory.length,
      criticalCount: this.alertHistory.filter(a => a.severity === 'critical').length,
      warningCount: this.alertHistory.filter(a => a.severity === 'warning').length,
    };
  }

  // Export latency data as CSV
  exportCSV(samples) {
    const headers = 'timestamp,totalLatency,ttft,messageId\n';
    const rows = samples.map(s => 
      `${new Date(s.timestamp).toISOString()},${s.totalLatency},${s.ttft || ''},${s.messageId}`
    ).join('\n');
    return headers + rows;
  }

  // Generate report
  generateReport(stats, gpuData) {
    const analysis = this.analyze(stats, gpuData);
    
    return {
      timestamp: new Date().toISOString(),
      summary: {
        p50: stats.latency.p50,
        p95: stats.latency.p95,
        p99: stats.latency.p99,
        ttft: stats.ttft.p95,
        totalRequests: stats.totalRequests,
        sampleCount: stats.sampleCount,
      },
      alerts: analysis.alerts,
      comparison: analysis.comparison,
      anomalyScore: analysis.anomalyScore,
      recommendation: this.getRecommendation(analysis),
    };
  }

  // Get optimization recommendations
  getRecommendation(analysis) {
    const recommendations = [];
    
    if (analysis.anomalyScore > 70) {
      recommendations.push('⚠️ HIGH ANOMALY SCORE: Investigate recent changes or external factors affecting latency.');
    }
    
    if (analysis.comparison && analysis.comparison.change.p95Percent > 50) {
      recommendations.push('📈 SIGNIFICANT REGRESSION: P95 latency increased 50%+ vs baseline. Review recent deployments.');
    }
    
    const gpuAlert = analysis.alerts.find(a => a.type === 'GPU_BOTTLENECK');
    if (gpuAlert) {
      recommendations.push('🎮 GPU BOTTLENECK: Consider scaling GPU resources or optimizing model inference.');
    }
    
    const ttftAlert = analysis.alerts.find(a => a.type === 'TTFT_SLOW');
    if (ttftAlert) {
      recommendations.push('⏱️ SLOW TTFT: Users experiencing lag. Consider prompt caching or faster model routing.');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('✅ All systems nominal. Latency within expected ranges.');
    }
    
    return recommendations;
  }
}

module.exports = LatencyAlerter;
