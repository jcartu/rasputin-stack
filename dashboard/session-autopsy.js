#!/usr/bin/env node
// Session Autopsy Module for ALFIE Nexus
// Automatically analyzes completed sessions and provides insights
// NOVEL FEATURE - Nobody else does this!

const fs = require('fs');
const path = require('path');

class SessionAutopsy {
  constructor() {
    this.autopsyCache = new Map(); // sessionId → autopsy report
    this.reportsPath = path.join(__dirname, '.autopsy_reports.json');
    this.loadReports();
  }

  // Load previous autopsy reports
  loadReports() {
    try {
      if (fs.existsSync(this.reportsPath)) {
        const data = JSON.parse(fs.readFileSync(this.reportsPath, 'utf8'));
        this.autopsyCache = new Map(Object.entries(data));
      }
    } catch (err) {
      console.error('[Autopsy] Failed to load reports:', err.message);
    }
  }

  // Save autopsy reports to disk
  saveReports() {
    try {
      const data = Object.fromEntries(this.autopsyCache);
      fs.writeFileSync(this.reportsPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[Autopsy] Failed to save reports:', err.message);
    }
  }

  // Analyze a completed session
  analyzeSession(sessionData) {
    const {
      sessionId,
      messages = [],
      toolCalls = [],
      totalDuration = 0,
      totalCost = 0,
      model = 'unknown',
      startTime,
      endTime,
      errors = []
    } = sessionData;

    // Basic metrics
    const metrics = {
      duration: totalDuration,
      cost: totalCost,
      messageCount: messages.length,
      toolCallCount: toolCalls.length,
      errorCount: errors.length,
      model,
      timestamp: Date.now()
    };

    // Tool analysis
    const toolAnalysis = this.analyzeTools(toolCalls);

    // Performance analysis
    const performance = this.analyzePerformance(sessionData);

    // Cost efficiency
    const costEfficiency = this.analyzeCostEfficiency(sessionData);

    // Error analysis
    const errorAnalysis = this.analyzeErrors(errors);

    // Generate insights
    const insights = this.generateInsights({
      metrics,
      toolAnalysis,
      performance,
      costEfficiency,
      errorAnalysis
    });

    // Generate optimizations
    const optimizations = this.generateOptimizations({
      metrics,
      toolAnalysis,
      performance,
      costEfficiency,
      errorAnalysis
    });

    const autopsy = {
      sessionId,
      timestamp: Date.now(),
      summary: this.generateSummary(metrics),
      metrics,
      toolAnalysis,
      performance,
      costEfficiency,
      errorAnalysis,
      insights,
      optimizations
    };

    // Cache and save
    this.autopsyCache.set(sessionId, autopsy);
    this.saveReports();

    return autopsy;
  }

  // Analyze tool usage
  analyzeTools(toolCalls) {
    if (!toolCalls.length) {
      return { totalCalls: 0, byTool: [], cached: 0, failed: 0 };
    }

    const byTool = {};
    let cached = 0;
    let failed = 0;
    let totalDuration = 0;

    for (const call of toolCalls) {
      const toolName = call.tool || call.name || 'unknown';
      
      if (!byTool[toolName]) {
        byTool[toolName] = { count: 0, duration: 0, cached: 0, failed: 0 };
      }
      
      byTool[toolName].count++;
      byTool[toolName].duration += call.duration || 0;
      
      if (call.cached) {
        byTool[toolName].cached++;
        cached++;
      }
      
      if (call.error || call.failed) {
        byTool[toolName].failed++;
        failed++;
      }

      totalDuration += call.duration || 0;
    }

    // Convert to array and sort by count
    const toolArray = Object.entries(byTool)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        duration: Math.round(stats.duration),
        avgDuration: Math.round(stats.duration / stats.count),
        cached: stats.cached,
        failed: stats.failed,
        percentage: ((stats.count / toolCalls.length) * 100).toFixed(1)
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalCalls: toolCalls.length,
      byTool: toolArray,
      cached,
      failed,
      cacheHitRate: ((cached / toolCalls.length) * 100).toFixed(1),
      failureRate: ((failed / toolCalls.length) * 100).toFixed(1),
      avgDuration: Math.round(totalDuration / toolCalls.length)
    };
  }

  // Analyze performance
  analyzePerformance(sessionData) {
    const { totalDuration = 0, messages = [], toolCalls = [] } = sessionData;

    // Calculate latencies
    const messageLatencies = messages
      .map(m => m.latency || 0)
      .filter(l => l > 0);

    const avgLatency = messageLatencies.length > 0
      ? Math.round(messageLatencies.reduce((a, b) => a + b, 0) / messageLatencies.length)
      : 0;

    const maxLatency = messageLatencies.length > 0
      ? Math.max(...messageLatencies)
      : 0;

    // Find bottlenecks
    const bottlenecks = [];
    
    // Slow messages
    if (maxLatency > 10000) {
      bottlenecks.push({
        type: 'slow_message',
        severity: 'high',
        message: `Slowest message took ${(maxLatency / 1000).toFixed(1)}s`
      });
    }

    // Slow tools
    const slowTools = toolCalls.filter(t => (t.duration || 0) > 5000);
    if (slowTools.length > 0) {
      bottlenecks.push({
        type: 'slow_tool',
        severity: 'medium',
        message: `${slowTools.length} tool(s) took >5s`,
        tools: slowTools.map(t => t.tool || t.name).join(', ')
      });
    }

    return {
      totalDuration: Math.round(totalDuration),
      avgLatency,
      maxLatency,
      messageCount: messages.length,
      toolCallCount: toolCalls.length,
      throughput: messages.length > 0
        ? (messages.length / (totalDuration / 1000)).toFixed(2)
        : '0',
      bottlenecks
    };
  }

  // Analyze cost efficiency
  analyzeCostEfficiency(sessionData) {
    const { totalCost = 0, messages = [], toolCalls = [] } = sessionData;

    const costPerMessage = messages.length > 0
      ? (totalCost / messages.length).toFixed(4)
      : '0';

    const costPerTool = toolCalls.length > 0
      ? (totalCost / toolCalls.length).toFixed(4)
      : '0';

    // Efficiency rating
    let rating = 'good';
    let rationale = 'Cost within normal range';

    if (totalCost > 1.0) {
      rating = 'expensive';
      rationale = 'High cost session (>$1.00)';
    } else if (totalCost > 0.5) {
      rating = 'moderate';
      rationale = 'Moderate cost session ($0.50-$1.00)';
    } else if (totalCost < 0.1) {
      rating = 'efficient';
      rationale = 'Very efficient session (<$0.10)';
    }

    return {
      totalCost: totalCost.toFixed(4),
      costPerMessage,
      costPerTool,
      rating,
      rationale
    };
  }

  // Analyze errors
  analyzeErrors(errors) {
    if (!errors.length) {
      return { count: 0, byType: [], critical: 0 };
    }

    const byType = {};
    let critical = 0;

    for (const error of errors) {
      const type = error.type || 'unknown';
      
      if (!byType[type]) {
        byType[type] = { count: 0, severity: error.severity || 'low' };
      }
      
      byType[type].count++;
      
      if (error.severity === 'critical') {
        critical++;
      }
    }

    const typeArray = Object.entries(byType)
      .map(([type, data]) => ({
        type,
        count: data.count,
        severity: data.severity
      }))
      .sort((a, b) => b.count - a.count);

    return {
      count: errors.length,
      byType: typeArray,
      critical
    };
  }

  // Generate summary
  generateSummary(metrics) {
    const parts = [];
    
    parts.push(`Session completed in ${(metrics.duration / 1000).toFixed(1)}s`);
    
    if (metrics.cost > 0) {
      parts.push(`cost $${metrics.cost.toFixed(4)}`);
    }
    
    if (metrics.toolCallCount > 0) {
      parts.push(`${metrics.toolCallCount} tool(s) called`);
    }
    
    if (metrics.errorCount > 0) {
      parts.push(`${metrics.errorCount} error(s)`);
    }

    return parts.join(', ');
  }

  // Generate insights
  generateInsights(analysis) {
    const insights = [];
    const { metrics, toolAnalysis, performance, costEfficiency, errorAnalysis } = analysis;

    // Tool insights
    if (toolAnalysis.totalCalls > 0) {
      if (toolAnalysis.cached > 0) {
        insights.push({
          type: 'optimization',
          icon: '⚡',
          message: `${toolAnalysis.cached} tool call(s) were cached (${toolAnalysis.cacheHitRate}% hit rate)`
        });
      }

      if (toolAnalysis.failed > 0) {
        insights.push({
          type: 'warning',
          icon: '⚠️',
          message: `${toolAnalysis.failed} tool call(s) failed (${toolAnalysis.failureRate}% failure rate)`
        });
      }

      // Most used tool
      if (toolAnalysis.byTool.length > 0) {
        const topTool = toolAnalysis.byTool[0];
        if (topTool.count > 1) {
          insights.push({
            type: 'info',
            icon: '🔧',
            message: `Most used tool: ${topTool.name} (${topTool.count} calls, ${topTool.avgDuration}ms avg)`
          });
        }
      }
    }

    // Performance insights
    if (performance.bottlenecks.length > 0) {
      for (const bottleneck of performance.bottlenecks) {
        insights.push({
          type: 'bottleneck',
          icon: '🐢',
          message: bottleneck.message,
          details: bottleneck.tools
        });
      }
    }

    // Cost insights
    if (costEfficiency.rating === 'efficient') {
      insights.push({
        type: 'success',
        icon: '💰',
        message: `Excellent cost efficiency: $${costEfficiency.costPerMessage}/message`
      });
    } else if (costEfficiency.rating === 'expensive') {
      insights.push({
        type: 'warning',
        icon: '💸',
        message: costEfficiency.rationale
      });
    }

    // Error insights
    if (errorAnalysis.critical > 0) {
      insights.push({
        type: 'error',
        icon: '🚨',
        message: `${errorAnalysis.critical} critical error(s) occurred`
      });
    }

    return insights;
  }

  // Generate optimization suggestions
  generateOptimizations(analysis) {
    const optimizations = [];
    const { toolAnalysis, performance, costEfficiency } = analysis;

    // Caching optimizations
    if (toolAnalysis.totalCalls > 0 && toolAnalysis.cacheHitRate < 50) {
      optimizations.push({
        type: 'caching',
        priority: 'high',
        suggestion: 'Enable more aggressive caching for frequently-used tools',
        impact: 'Could reduce latency by 30-50% and cost by 20-30%'
      });
    }

    // Tool optimization
    const slowTools = toolAnalysis.byTool.filter(t => t.avgDuration > 5000);
    if (slowTools.length > 0) {
      optimizations.push({
        type: 'performance',
        priority: 'high',
        suggestion: `Optimize slow tools: ${slowTools.map(t => t.name).join(', ')}`,
        impact: 'Could reduce session duration by 20-40%'
      });
    }

    // Cost optimization
    if (costEfficiency.rating === 'expensive') {
      optimizations.push({
        type: 'cost',
        priority: 'medium',
        suggestion: 'Consider using a cheaper model for simple queries',
        impact: 'Could reduce cost by 50-70% with minimal quality loss'
      });
    }

    // Parallel execution
    if (toolAnalysis.totalCalls > 3) {
      const serialTools = toolAnalysis.byTool.filter(t => t.count > 1);
      if (serialTools.length > 0) {
        optimizations.push({
          type: 'parallelization',
          priority: 'medium',
          suggestion: 'Run independent tool calls in parallel',
          impact: 'Could reduce session duration by 15-30%'
        });
      }
    }

    return optimizations;
  }

  // Get autopsy report for a session
  getAutopsy(sessionId) {
    return this.autopsyCache.get(sessionId) || null;
  }

  // Get recent autopsies
  getRecentAutopsies(limit = 10) {
    const reports = Array.from(this.autopsyCache.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    return reports;
  }

  // Get autopsy statistics
  getStats() {
    const reports = Array.from(this.autopsyCache.values());
    
    if (reports.length === 0) {
      return {
        totalSessions: 0,
        avgDuration: 0,
        avgCost: 0,
        avgToolCalls: 0,
        totalInsights: 0,
        totalOptimizations: 0
      };
    }

    const totalDuration = reports.reduce((sum, r) => sum + r.metrics.duration, 0);
    const totalCost = reports.reduce((sum, r) => sum + r.metrics.cost, 0);
    const totalTools = reports.reduce((sum, r) => sum + r.metrics.toolCallCount, 0);
    const totalInsights = reports.reduce((sum, r) => sum + r.insights.length, 0);
    const totalOptimizations = reports.reduce((sum, r) => sum + r.optimizations.length, 0);

    return {
      totalSessions: reports.length,
      avgDuration: Math.round(totalDuration / reports.length),
      avgCost: (totalCost / reports.length).toFixed(4),
      avgToolCalls: (totalTools / reports.length).toFixed(1),
      totalInsights,
      totalOptimizations
    };
  }
}

module.exports = SessionAutopsy;
