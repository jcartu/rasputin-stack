#!/usr/bin/env node
// Model Performance Leaderboard - Cost-Adjusted Rankings
// NOVEL FEATURE: Nobody else has this!

const fs = require('fs');
const path = require('path');

class ModelLeaderboard {
  constructor(dataFile = '.model_stats.json') {
    this.dataFile = path.join(__dirname, dataFile);
    this.models = this.load();
  }

  // Load existing data
  load() {
    try {
      if (fs.existsSync(this.dataFile)) {
        return JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to load model stats:', e.message);
    }
    return {};
  }

  // Save data to disk
  save() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.models, null, 2));
    } catch (e) {
      console.error('Failed to save model stats:', e.message);
    }
  }

  // Record a model interaction
  recordInteraction(modelName, data) {
    if (!modelName) return;

    // Initialize model entry if new
    if (!this.models[modelName]) {
      this.models[modelName] = {
        name: modelName,
        totalCalls: 0,
        totalCost: 0,
        totalLatency: 0,
        totalTokens: 0,
        thumbsUp: 0,
        thumbsDown: 0,
        errors: 0,
        samples: [], // Last 100 samples
      };
    }

    const model = this.models[modelName];

    // Update stats
    model.totalCalls++;
    if (data.cost) model.totalCost += data.cost;
    if (data.latency) model.totalLatency += data.latency;
    if (data.tokens) model.totalTokens += data.tokens;
    if (data.error) model.errors++;

    // Store sample
    const sample = {
      timestamp: Date.now(),
      cost: data.cost || 0,
      latency: data.latency || 0,
      tokens: data.tokens || 0,
      quality: data.quality || null, // thumbs up/down
      error: data.error || false,
    };

    model.samples.push(sample);
    if (model.samples.length > 100) {
      model.samples.shift(); // Keep last 100
    }

    this.save();
  }

  // Record quality feedback (thumbs up/down)
  recordFeedback(modelName, thumbsUp) {
    if (!this.models[modelName]) return;

    if (thumbsUp) {
      this.models[modelName].thumbsUp++;
    } else {
      this.models[modelName].thumbsDown++;
    }

    this.save();
  }

  // Calculate derived metrics for a model
  calculateMetrics(model) {
    if (model.totalCalls === 0) {
      return {
        avgCost: 0,
        avgLatency: 0,
        avgTokens: 0,
        errorRate: 0,
        qualityScore: 0,
        costPerStar: Infinity,
        valueRank: 0,
      };
    }

    const avgCost = model.totalCost / model.totalCalls;
    const avgLatency = model.totalLatency / model.totalCalls;
    const avgTokens = model.totalTokens / model.totalCalls;
    const errorRate = (model.errors / model.totalCalls) * 100;

    // Quality score (5-star scale based on thumbs up/down ratio)
    const totalFeedback = model.thumbsUp + model.thumbsDown;
    const qualityScore = totalFeedback > 0 
      ? (model.thumbsUp / totalFeedback) * 5 
      : 3; // Default 3 stars if no feedback

    // Cost per quality point ($/⭐)
    const costPerStar = qualityScore > 0 ? avgCost / qualityScore : Infinity;

    return {
      avgCost,
      avgLatency,
      avgTokens,
      errorRate,
      qualityScore,
      costPerStar,
      totalFeedback,
    };
  }

  // Get leaderboard (sorted by various criteria)
  getLeaderboard(sortBy = 'value') {
    const models = Object.values(this.models).map(model => {
      const metrics = this.calculateMetrics(model);
      return {
        ...model,
        ...metrics,
      };
    });

    // Sort by requested criteria
    switch (sortBy) {
      case 'value': // Best value (lowest cost per star)
        return models.sort((a, b) => a.costPerStar - b.costPerStar);
      
      case 'speed': // Fastest
        return models.sort((a, b) => a.avgLatency - b.avgLatency);
      
      case 'cost': // Cheapest
        return models.sort((a, b) => a.avgCost - b.avgCost);
      
      case 'quality': // Highest quality
        return models.sort((a, b) => b.qualityScore - a.qualityScore);
      
      case 'reliability': // Lowest error rate
        return models.sort((a, b) => a.errorRate - b.errorRate);
      
      case 'usage': // Most used
        return models.sort((a, b) => b.totalCalls - a.totalCalls);
      
      default:
        return models;
    }
  }

  // Get summary stats
  getSummary() {
    const totalModels = Object.keys(this.models).length;
    const totalCalls = Object.values(this.models).reduce((sum, m) => sum + m.totalCalls, 0);
    const totalCost = Object.values(this.models).reduce((sum, m) => sum + m.totalCost, 0);

    // Get best performers
    const leaderboard = this.getLeaderboard('value');
    const bestValue = leaderboard[0];
    const fastest = this.getLeaderboard('speed')[0];
    const cheapest = this.getLeaderboard('cost')[0];
    const bestQuality = this.getLeaderboard('quality')[0];

    return {
      totalModels,
      totalCalls,
      totalCost,
      bestValue: bestValue ? {
        name: bestValue.name,
        costPerStar: bestValue.costPerStar,
        qualityScore: bestValue.qualityScore,
        avgCost: bestValue.avgCost,
      } : null,
      fastest: fastest ? {
        name: fastest.name,
        avgLatency: fastest.avgLatency,
      } : null,
      cheapest: cheapest ? {
        name: cheapest.name,
        avgCost: cheapest.avgCost,
      } : null,
      bestQuality: bestQuality ? {
        name: bestQuality.name,
        qualityScore: bestQuality.qualityScore,
        totalFeedback: bestQuality.totalFeedback,
      } : null,
    };
  }

  // Get recent activity (last N interactions across all models)
  getRecentActivity(limit = 20) {
    const allSamples = [];

    for (const [modelName, model] of Object.entries(this.models)) {
      for (const sample of model.samples) {
        allSamples.push({
          model: modelName,
          ...sample,
        });
      }
    }

    return allSamples
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Reset all stats (for testing)
  reset() {
    this.models = {};
    this.save();
  }
}

module.exports = ModelLeaderboard;

// CLI usage
if (require.main === module) {
  const leaderboard = new ModelLeaderboard();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'show':
      const sortBy = process.argv[3] || 'value';
      const board = leaderboard.getLeaderboard(sortBy);
      console.log(`\n🏆 Model Leaderboard (sorted by ${sortBy}):\n`);
      board.forEach((model, i) => {
        console.log(`${i + 1}. ${model.name}`);
        console.log(`   Quality: ${'⭐'.repeat(Math.round(model.qualityScore))} (${model.qualityScore.toFixed(2)})`);
        console.log(`   Cost/Star: $${model.costPerStar.toFixed(4)}`);
        console.log(`   Avg Cost: $${model.avgCost.toFixed(4)} | Latency: ${model.avgLatency.toFixed(0)}ms`);
        console.log(`   Calls: ${model.totalCalls} | Errors: ${model.errorRate.toFixed(1)}%\n`);
      });
      break;
    
    case 'summary':
      const summary = leaderboard.getSummary();
      console.log('\n📊 Summary:\n');
      console.log(`Total Models: ${summary.totalModels}`);
      console.log(`Total Calls: ${summary.totalCalls.toLocaleString()}`);
      console.log(`Total Cost: $${summary.totalCost.toFixed(2)}`);
      
      if (summary.bestValue) {
        console.log(`\n🥇 Best Value: ${summary.bestValue.name}`);
        console.log(`   $${summary.bestValue.costPerStar.toFixed(4)} per star`);
      }
      
      if (summary.fastest) {
        console.log(`\n⚡ Fastest: ${summary.fastest.name}`);
        console.log(`   ${summary.fastest.avgLatency.toFixed(0)}ms avg latency`);
      }
      
      if (summary.cheapest) {
        console.log(`\n💰 Cheapest: ${summary.cheapest.name}`);
        console.log(`   $${summary.cheapest.avgCost.toFixed(4)} per call`);
      }
      
      if (summary.bestQuality) {
        console.log(`\n⭐ Highest Quality: ${summary.bestQuality.name}`);
        console.log(`   ${summary.bestQuality.qualityScore.toFixed(2)}/5.0 stars (${summary.bestQuality.totalFeedback} votes)`);
      }
      console.log('');
      break;
    
    case 'record':
      // Test recording
      const testModel = process.argv[3] || 'gpt-4';
      leaderboard.recordInteraction(testModel, {
        cost: Math.random() * 0.01,
        latency: Math.random() * 5000,
        tokens: Math.floor(Math.random() * 1000),
      });
      console.log(`Recorded test interaction for ${testModel}`);
      break;
    
    case 'feedback':
      const modelName = process.argv[3];
      const thumbsUp = process.argv[4] === 'up';
      leaderboard.recordFeedback(modelName, thumbsUp);
      console.log(`Recorded ${thumbsUp ? '👍' : '👎'} for ${modelName}`);
      break;
    
    case 'reset':
      leaderboard.reset();
      console.log('Reset all model stats');
      break;
    
    default:
      console.log(`
Usage:
  node model-leaderboard.js show [sortBy]  - Show leaderboard (value|speed|cost|quality|reliability|usage)
  node model-leaderboard.js summary        - Show summary stats
  node model-leaderboard.js record <model> - Record test interaction
  node model-leaderboard.js feedback <model> up|down - Record feedback
  node model-leaderboard.js reset          - Reset all stats
      `);
  }
}
