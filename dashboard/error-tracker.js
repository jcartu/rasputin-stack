// Error Analytics & Tracking System
// Aggregates errors, provides insights, detects patterns

const fs = require('fs');
const path = require('path');

class ErrorTracker {
  constructor(dataPath = '.error_history.json', maxHistory = 10000) {
    this.dataPath = dataPath;
    this.maxHistory = maxHistory;
    this.errors = [];
    this.loadHistory();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, 'utf8');
        this.errors = JSON.parse(data);
        console.log(`[ErrorTracker] Loaded ${this.errors.length} historical errors`);
      }
    } catch (err) {
      console.error('[ErrorTracker] Failed to load history:', err.message);
      this.errors = [];
    }
  }

  saveHistory() {
    try {
      // Keep only last maxHistory entries
      if (this.errors.length > this.maxHistory) {
        this.errors = this.errors.slice(-this.maxHistory);
      }
      fs.writeFileSync(this.dataPath, JSON.stringify(this.errors, null, 2));
    } catch (err) {
      console.error('[ErrorTracker] Failed to save history:', err.message);
    }
  }

  recordError(errorData) {
    const error = {
      id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      message: errorData.message || 'Unknown error',
      type: errorData.type || this.classifyErrorType(errorData.message),
      severity: errorData.severity || this.detectSeverity(errorData),
      context: {
        model: errorData.model || 'unknown',
        tool: errorData.tool || null,
        sessionId: errorData.sessionId || null,
        userId: errorData.userId || null,
        requestId: errorData.requestId || null
      },
      stack: errorData.stack || null,
      metadata: errorData.metadata || {},
      resolved: false
    };

    this.errors.push(error);
    this.saveHistory();
    
    // Trigger webhook for errors
    if (this.webhookManager) {
      this.webhookManager.triggerEvent('error', {
        title: `Error: ${error.type}`,
        message: error.message,
        fields: {
          'Severity': error.severity,
          'Type': error.type,
          'Model': error.context.model,
          'Session': error.context.sessionId || 'N/A',
        },
      }, error.severity).catch(e => {
        console.error('[ErrorTracker] Webhook trigger failed:', e);
      });
    }
    
    return error;
  }
  
  setWebhookManager(webhookManager) {
    this.webhookManager = webhookManager;
  }

  classifyErrorType(message) {
    if (!message) return 'unknown';
    const msg = message.toLowerCase();
    
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
    if (msg.includes('rate limit') || msg.includes('too many')) return 'rate_limit';
    if (msg.includes('authentication') || msg.includes('unauthorized')) return 'auth';
    if (msg.includes('network') || msg.includes('connection')) return 'network';
    if (msg.includes('parse') || msg.includes('json')) return 'parsing';
    if (msg.includes('token') && msg.includes('limit')) return 'context_length';
    if (msg.includes('model') && msg.includes('not found')) return 'model_not_found';
    if (msg.includes('tool') || msg.includes('function')) return 'tool_execution';
    if (msg.includes('gpu') || msg.includes('cuda') || msg.includes('memory')) return 'gpu';
    
    return 'application';
  }

  detectSeverity(errorData) {
    const msg = (errorData.message || '').toLowerCase();
    
    // Critical errors that require immediate attention
    if (msg.includes('crash') || msg.includes('fatal') || msg.includes('gpu out of memory')) {
      return 'critical';
    }
    
    // High severity - impacts functionality
    if (msg.includes('timeout') || msg.includes('failed') || msg.includes('error')) {
      return 'high';
    }
    
    // Medium severity - degraded experience
    if (msg.includes('warning') || msg.includes('slow') || msg.includes('retry')) {
      return 'medium';
    }
    
    // Low severity - informational
    return 'low';
  }

  getStats(timeWindow = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const windowStart = now - timeWindow;
    
    const recentErrors = this.errors.filter(e => e.timestamp >= windowStart);
    const allTimeErrors = this.errors;

    // Calculate error rate over time
    const hourlyBuckets = this.bucketByHour(recentErrors, 24);
    
    // Group by type
    const byType = this.groupBy(recentErrors, 'type');
    
    // Group by severity
    const bySeverity = this.groupBy(recentErrors, 'severity');
    
    // Group by model
    const byModel = this.groupBy(recentErrors, e => e.context.model);
    
    // Top errors by frequency
    const topErrors = this.getTopErrors(recentErrors, 10);
    
    // Recent errors (last 50)
    const recent = this.errors.slice(-50).reverse();
    
    // Error rate (errors per hour)
    const hoursInWindow = timeWindow / (60 * 60 * 1000);
    const errorRate = recentErrors.length / hoursInWindow;
    
    // Detect spikes (recent hour vs average)
    const lastHourCount = recentErrors.filter(e => e.timestamp >= now - 60 * 60 * 1000).length;
    const avgHourly = errorRate;
    const isSpike = lastHourCount > avgHourly * 2;

    return {
      total: {
        allTime: allTimeErrors.length,
        recent: recentErrors.length,
        unresolved: recentErrors.filter(e => !e.resolved).length
      },
      rate: {
        errorsPerHour: errorRate.toFixed(2),
        lastHour: lastHourCount,
        avgHourly: avgHourly.toFixed(2),
        spike: isSpike
      },
      distribution: {
        byType,
        bySeverity,
        byModel
      },
      topErrors,
      hourlyBuckets,
      recentErrors: recent,
      windowHours: hoursInWindow
    };
  }

  bucketByHour(errors, hours) {
    const now = Date.now();
    const buckets = [];
    
    for (let i = hours - 1; i >= 0; i--) {
      const bucketEnd = now - (i * 60 * 60 * 1000);
      const bucketStart = bucketEnd - (60 * 60 * 1000);
      
      const count = errors.filter(e => 
        e.timestamp >= bucketStart && e.timestamp < bucketEnd
      ).length;
      
      buckets.push({
        hour: new Date(bucketEnd).getHours(),
        timestamp: bucketEnd,
        count
      });
    }
    
    return buckets;
  }

  groupBy(errors, keyOrFn) {
    const groups = {};
    
    for (const error of errors) {
      const key = typeof keyOrFn === 'function' ? keyOrFn(error) : error[keyOrFn];
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(error);
    }
    
    // Convert to array and sort by count
    return Object.entries(groups)
      .map(([key, items]) => ({
        key,
        count: items.length,
        percentage: (items.length / errors.length * 100).toFixed(1)
      }))
      .sort((a, b) => b.count - a.count);
  }

  getTopErrors(errors, limit = 10) {
    // Group by error message
    const grouped = {};
    
    for (const error of errors) {
      const key = error.message;
      if (!grouped[key]) {
        grouped[key] = {
          message: error.message,
          type: error.type,
          severity: error.severity,
          count: 0,
          firstSeen: error.timestamp,
          lastSeen: error.timestamp,
          examples: []
        };
      }
      
      grouped[key].count++;
      grouped[key].lastSeen = Math.max(grouped[key].lastSeen, error.timestamp);
      grouped[key].firstSeen = Math.min(grouped[key].firstSeen, error.timestamp);
      
      // Keep up to 3 examples
      if (grouped[key].examples.length < 3) {
        grouped[key].examples.push({
          id: error.id,
          timestamp: error.timestamp,
          context: error.context
        });
      }
    }
    
    return Object.values(grouped)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getErrorById(id) {
    return this.errors.find(e => e.id === id);
  }

  markResolved(id) {
    const error = this.getErrorById(id);
    if (error) {
      error.resolved = true;
      error.resolvedAt = Date.now();
      this.saveHistory();
      return true;
    }
    return false;
  }

  deleteError(id) {
    const index = this.errors.findIndex(e => e.id === id);
    if (index !== -1) {
      this.errors.splice(index, 1);
      this.saveHistory();
      return true;
    }
    return false;
  }

  clearAll() {
    this.errors = [];
    this.saveHistory();
  }
}

module.exports = ErrorTracker;
