#!/usr/bin/env node
/**
 * System Health Score for Rasputin Nexus
 * 
 * Novel feature - unified health metric combining:
 * - GPU health (utilization, temperature, memory)
 * - Latency health (P95/P99 vs thresholds)
 * - Error rate health
 * - Cost burn rate (vs budget)
 * - Memory/disk health
 * - Sub-agent success rate
 * 
 * Returns 0-100 score where:
 * - 90-100 = Excellent (green)
 * - 70-89 = Good (yellow)
 * - 50-69 = Degraded (orange)
 * - 0-49 = Critical (red)
 */

class SystemHealthScore {
  constructor() {
    this.weights = {
      gpu: 0.25,        // GPU health is critical
      latency: 0.20,    // Response time matters
      errors: 0.20,     // Errors are serious
      cost: 0.15,       // Budget tracking
      resources: 0.10,  // Memory/disk
      reliability: 0.10 // Sub-agent success rate
    };
    
    this.thresholds = {
      latency: {
        p95Good: 2000,      // <2s is good
        p95Warning: 4000,   // 2-4s is warning
        p95Critical: 6000,  // >6s is critical
        p99Good: 4000,
        p99Warning: 8000,
        p99Critical: 12000
      },
      gpu: {
        utilGood: 80,       // <80% is good headroom
        utilWarning: 90,    // 80-90% is warning
        utilCritical: 95,   // >95% is critical
        tempGood: 75,       // <75°C is good
        tempWarning: 80,    // 75-80°C is warning
        tempCritical: 85,   // >85°C is critical
        memGood: 80,        // <80% memory is good
        memWarning: 90,
        memCritical: 95
      },
      errors: {
        rateGood: 0.01,     // <1% error rate is good
        rateWarning: 0.05,  // 1-5% is warning
        rateCritical: 0.10  // >10% is critical
      },
      cost: {
        budgetGood: 0.60,   // <60% of budget is good
        budgetWarning: 0.80, // 60-80% is warning
        budgetCritical: 0.95 // >95% is critical
      },
      resources: {
        diskGood: 70,       // <70% disk usage is good
        diskWarning: 85,
        diskCritical: 95,
        memGood: 70,
        memWarning: 85,
        memCritical: 95
      }
    };
    
    this.history = [];
    this.maxHistory = 1440; // 24 hours at 1min intervals
  }

  /**
   * Calculate overall health score
   * @param {Object} data - All system metrics
   * @returns {Object} Health score + breakdown
   */
  calculate(data) {
    const scores = {
      gpu: this.scoreGPU(data.gpu),
      latency: this.scoreLatency(data.latency),
      errors: this.scoreErrors(data.errors),
      cost: this.scoreCost(data.cost),
      resources: this.scoreResources(data.resources),
      reliability: this.scoreReliability(data.reliability)
    };

    // Calculate weighted overall score
    let overall = 0;
    let totalWeight = 0;

    for (const [category, score] of Object.entries(scores)) {
      if (score !== null) {
        overall += score * this.weights[category];
        totalWeight += this.weights[category];
      }
    }

    overall = totalWeight > 0 ? Math.round(overall / totalWeight) : 0;

    // Determine grade
    const grade = this.getGrade(overall);
    
    // Identify critical issues
    const issues = this.identifyIssues(scores, data);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(scores, data);

    const result = {
      overall,
      grade,
      scores,
      issues,
      recommendations,
      timestamp: Date.now(),
      trend: this.calculateTrend(overall)
    };

    // Store in history
    this.history.push({ score: overall, timestamp: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return result;
  }

  /**
   * Score GPU health (0-100)
   */
  scoreGPU(gpuData) {
    if (!gpuData || !gpuData.gpus || gpuData.gpus.length === 0) {
      return null; // No GPU data available
    }

    let totalScore = 0;
    
    for (const gpu of gpuData.gpus) {
      let gpuScore = 100;
      
      // Utilization factor (inverse - lower is better for headroom)
      const util = gpu.utilization || 0;
      if (util > this.thresholds.gpu.utilCritical) {
        gpuScore -= 30;
      } else if (util > this.thresholds.gpu.utilWarning) {
        gpuScore -= 15;
      } else if (util < 10) {
        gpuScore -= 5; // Too low might indicate problem
      }
      
      // Temperature factor
      const temp = gpu.temperature || 0;
      if (temp > this.thresholds.gpu.tempCritical) {
        gpuScore -= 25;
      } else if (temp > this.thresholds.gpu.tempWarning) {
        gpuScore -= 10;
      }
      
      // Memory factor
      const memPercent = gpu.memoryUsedPercent || 0;
      if (memPercent > this.thresholds.gpu.memCritical) {
        gpuScore -= 20;
      } else if (memPercent > this.thresholds.gpu.memWarning) {
        gpuScore -= 10;
      }
      
      totalScore += Math.max(0, gpuScore);
    }

    return Math.round(totalScore / gpuData.gpus.length);
  }

  /**
   * Score latency health (0-100)
   */
  scoreLatency(latencyData) {
    if (!latencyData || !latencyData.latency) {
      return null;
    }

    let score = 100;
    const p95 = latencyData.latency.p95 || 0;
    const p99 = latencyData.latency.p99 || 0;

    // P95 scoring
    if (p95 > this.thresholds.latency.p95Critical) {
      score -= 40;
    } else if (p95 > this.thresholds.latency.p95Warning) {
      score -= 20;
    } else if (p95 > this.thresholds.latency.p95Good) {
      score -= 10;
    }

    // P99 scoring
    if (p99 > this.thresholds.latency.p99Critical) {
      score -= 40;
    } else if (p99 > this.thresholds.latency.p99Warning) {
      score -= 20;
    } else if (p99 > this.thresholds.latency.p99Good) {
      score -= 10;
    }

    // TTFT bonus/penalty
    if (latencyData.ttft && latencyData.ttft.p95) {
      const ttft = latencyData.ttft.p95;
      if (ttft < 500) {
        score += 5; // Excellent TTFT
      } else if (ttft > 2000) {
        score -= 10; // Poor TTFT
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Score error rate health (0-100)
   */
  scoreErrors(errorData) {
    if (!errorData) {
      return null;
    }

    const total = errorData.total || 0;
    const errors = errorData.count || 0;
    
    if (total === 0) return 100; // No requests yet

    const errorRate = errors / total;
    let score = 100;

    if (errorRate > this.thresholds.errors.rateCritical) {
      score = 20; // Critical error rate
    } else if (errorRate > this.thresholds.errors.rateWarning) {
      score = 50; // Warning error rate
    } else if (errorRate > this.thresholds.errors.rateGood) {
      score = 80; // Acceptable error rate
    }

    // Recent error spike detection
    if (errorData.recent && errorData.recent.length > 0) {
      const recentErrors = errorData.recent.filter(e => 
        Date.now() - e.timestamp < 60000 // Last minute
      ).length;
      if (recentErrors > 5) {
        score -= 20; // Penalty for error spike
      }
    }

    return Math.max(0, score);
  }

  /**
   * Score cost health (0-100)
   */
  scoreCost(costData) {
    if (!costData || !costData.budget) {
      return null;
    }

    const spent = costData.spent || 0;
    const budget = costData.budget;
    
    if (budget === 0) return 100; // No budget set

    const percentUsed = spent / budget;
    let score = 100;

    if (percentUsed > this.thresholds.cost.budgetCritical) {
      score = 20;
    } else if (percentUsed > this.thresholds.cost.budgetWarning) {
      score = 60;
    } else if (percentUsed > this.thresholds.cost.budgetGood) {
      score = 85;
    }

    // Burn rate factor
    if (costData.burnRate) {
      const projectedPercent = costData.burnRate.projectedPercent || 0;
      if (projectedPercent > 120) {
        score -= 15; // Projected to exceed budget
      }
    }

    return Math.max(0, score);
  }

  /**
   * Score system resources (0-100)
   */
  scoreResources(resourceData) {
    if (!resourceData) {
      return null;
    }

    let score = 100;

    // Disk usage
    if (resourceData.disk) {
      const diskPercent = resourceData.disk.usedPercent || 0;
      if (diskPercent > this.thresholds.resources.diskCritical) {
        score -= 30;
      } else if (diskPercent > this.thresholds.resources.diskWarning) {
        score -= 15;
      }
    }

    // Memory usage
    if (resourceData.memory) {
      const memPercent = resourceData.memory.usedPercent || 0;
      if (memPercent > this.thresholds.resources.memCritical) {
        score -= 30;
      } else if (memPercent > this.thresholds.resources.memWarning) {
        score -= 15;
      }
    }

    return Math.max(0, score);
  }

  /**
   * Score sub-agent reliability (0-100)
   */
  scoreReliability(reliabilityData) {
    if (!reliabilityData) {
      return null;
    }

    const total = reliabilityData.total || 0;
    const succeeded = reliabilityData.succeeded || 0;
    
    if (total === 0) return 100; // No sub-agents spawned yet

    const successRate = succeeded / total;
    
    if (successRate >= 0.95) return 100;
    if (successRate >= 0.90) return 90;
    if (successRate >= 0.80) return 75;
    if (successRate >= 0.70) return 60;
    return Math.max(0, Math.round(successRate * 100));
  }

  /**
   * Get grade from score
   */
  getGrade(score) {
    if (score >= 90) return { letter: 'A', label: 'Excellent', color: 'oklch(0.70 0.20 150)' };
    if (score >= 70) return { letter: 'B', label: 'Good', color: 'oklch(0.75 0.18 100)' };
    if (score >= 50) return { letter: 'C', label: 'Degraded', color: 'oklch(0.75 0.18 60)' };
    return { letter: 'F', label: 'Critical', color: 'oklch(0.60 0.20 30)' };
  }

  /**
   * Identify critical issues
   */
  identifyIssues(scores, data) {
    const issues = [];

    // GPU issues
    if (scores.gpu !== null && scores.gpu < 50) {
      const gpuData = data.gpu?.gpus || [];
      const hotGPU = gpuData.find(g => g.temperature > 80);
      const overloadedGPU = gpuData.find(g => g.utilization > 95);
      
      if (hotGPU) {
        issues.push({
          severity: 'critical',
          category: 'gpu',
          message: `GPU ${hotGPU.id} temperature critical: ${hotGPU.temperature}°C`,
          action: 'Check cooling, reduce workload'
        });
      }
      if (overloadedGPU) {
        issues.push({
          severity: 'warning',
          category: 'gpu',
          message: `GPU ${overloadedGPU.id} utilization high: ${overloadedGPU.utilization}%`,
          action: 'Consider load balancing or scaling'
        });
      }
    }

    // Latency issues
    if (scores.latency !== null && scores.latency < 60) {
      const p95 = data.latency?.latency?.p95 || 0;
      issues.push({
        severity: p95 > 6000 ? 'critical' : 'warning',
        category: 'latency',
        message: `High P95 latency: ${p95}ms`,
        action: 'Investigate slow requests, check GPU load'
      });
    }

    // Error issues
    if (scores.errors !== null && scores.errors < 70) {
      const rate = data.errors?.count / (data.errors?.total || 1);
      issues.push({
        severity: rate > 0.1 ? 'critical' : 'warning',
        category: 'errors',
        message: `Elevated error rate: ${Math.round(rate * 100)}%`,
        action: 'Review error logs, check dependencies'
      });
    }

    // Cost issues
    if (scores.cost !== null && scores.cost < 60) {
      issues.push({
        severity: 'warning',
        category: 'cost',
        message: 'Budget utilization high',
        action: 'Review cost breakdown, optimize expensive operations'
      });
    }

    // Resource issues
    if (scores.resources !== null && scores.resources < 60) {
      if (data.resources?.disk?.usedPercent > 85) {
        issues.push({
          severity: 'warning',
          category: 'resources',
          message: `Low disk space: ${data.resources.disk.usedPercent}% used`,
          action: 'Clean up logs, backups, or temporary files'
        });
      }
      if (data.resources?.memory?.usedPercent > 85) {
        issues.push({
          severity: 'warning',
          category: 'resources',
          message: `High memory usage: ${data.resources.memory.usedPercent}%`,
          action: 'Review memory leaks, restart services if needed'
        });
      }
    }

    return issues;
  }

  /**
   * Generate recommendations
   */
  generateRecommendations(scores, data) {
    const recommendations = [];

    // Overall health recommendations
    const lowestScore = Object.entries(scores)
      .filter(([_, score]) => score !== null)
      .sort(([_, a], [__, b]) => a - b)[0];

    if (lowestScore && lowestScore[1] < 70) {
      recommendations.push({
        priority: 'high',
        category: lowestScore[0],
        text: `Focus on improving ${lowestScore[0]} health (score: ${lowestScore[1]})`
      });
    }

    // Specific recommendations
    if (scores.gpu !== null && scores.gpu < 80) {
      recommendations.push({
        priority: 'medium',
        category: 'gpu',
        text: 'Monitor GPU workload distribution, consider implementing GPU queuing'
      });
    }

    if (scores.latency !== null && scores.latency < 80) {
      recommendations.push({
        priority: 'high',
        category: 'latency',
        text: 'Enable prompt caching, optimize model routing, or scale inference servers'
      });
    }

    if (scores.cost !== null && scores.cost < 80) {
      recommendations.push({
        priority: 'medium',
        category: 'cost',
        text: 'Review model usage, implement request batching, or use cheaper models for simple tasks'
      });
    }

    return recommendations;
  }

  /**
   * Calculate trend (improving/stable/declining)
   */
  calculateTrend(currentScore) {
    if (this.history.length < 10) {
      return 'stable'; // Not enough data
    }

    const recent = this.history.slice(-10).map(h => h.score);
    const avg = recent.reduce((sum, s) => sum + s, 0) / recent.length;
    
    const diff = currentScore - avg;

    if (diff > 5) return 'improving';
    if (diff < -5) return 'declining';
    return 'stable';
  }

  /**
   * Get historical data for charting
   */
  getHistory(minutes = 60) {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.history.filter(h => h.timestamp > cutoff);
  }

  /**
   * Get comprehensive health report
   */
  getReport(data) {
    const health = this.calculate(data);
    
    return {
      ...health,
      summary: this.generateSummary(health),
      history: this.getHistory(60)
    };
  }

  /**
   * Generate human-readable summary
   */
  generateSummary(health) {
    const lines = [
      `System Health: ${health.overall}/100 (${health.grade.label})`
    ];

    if (health.issues.length > 0) {
      lines.push(`⚠️ ${health.issues.length} active issue(s)`);
    } else {
      lines.push('✅ No critical issues detected');
    }

    if (health.trend === 'improving') {
      lines.push('📈 Health trending upward');
    } else if (health.trend === 'declining') {
      lines.push('📉 Health declining - attention needed');
    }

    return lines.join(' • ');
  }
}

module.exports = SystemHealthScore;
