#!/usr/bin/env node
/**
 * Token Heatmap Module for ALFIE Nexus
 * 
 * Novel Feature: Per-word token cost visualization
 * Shows which parts of responses cost money
 * 
 * Features:
 * - Tokenize response text using tiktoken approximation
 * - Calculate per-token cost based on model pricing
 * - Generate heatmap data (word → cost → color)
 * - Cumulative cost visualization
 * - Identify expensive phrases/words
 * 
 * Pricing (approximate, per 1M tokens):
 * - GPT-4: $30 output
 * - Claude Opus: $75 output
 * - Gemini Pro: $3.75 output
 * - Local models: $0
 */

class TokenHeatmap {
  constructor() {
    // Model pricing (per 1M output tokens)
    this.modelPricing = {
      'gpt-4': 30.00,
      'gpt-4-turbo': 30.00,
      'gpt-4.5-turbo': 22.50,
      'gpt-3.5-turbo': 2.00,
      'claude-opus': 75.00,
      'claude-opus-4': 75.00,
      'claude-opus-4.6': 75.00,
      'claude-sonnet': 15.00,
      'claude-sonnet-4': 15.00,
      'claude-sonnet-4.5': 15.00,
      'gemini-pro': 3.75,
      'gemini-flash': 0.75,
      'gemini-2.0-pro': 10.00,
      'gemini-3-flash': 0.50,
      'llama-3.3-70b': 0.00, // Local
      'qwen-2.5-72b': 0.00,  // Local
      'gpt-oss-120b': 0.00,  // Local
    };

    // Token cost tiers (for coloring)
    this.costTiers = [
      { threshold: 0.0001, color: 'rgb(34, 197, 94)', label: 'cheap' },      // Green (common)
      { threshold: 0.0005, color: 'rgb(234, 179, 8)', label: 'moderate' },   // Yellow
      { threshold: 0.001, color: 'rgb(249, 115, 22)', label: 'expensive' },  // Orange
      { threshold: Infinity, color: 'rgb(239, 68, 68)', label: 'very-expensive' } // Red (rare)
    ];
  }

  /**
   * Approximate tokenization (simple word-based)
   * Real tiktoken would be more accurate but requires native modules
   */
  approximateTokenize(text) {
    // Simple heuristic: 
    // - 1 word ≈ 1.3 tokens (average)
    // - Punctuation ≈ 1 token
    // - Numbers ≈ 1-2 tokens
    
    const words = text.split(/(\s+|[,.!?;:(){}[\]"'])/g).filter(w => w.trim());
    const tokens = [];

    for (const word of words) {
      if (/^\s+$/.test(word)) {
        continue; // Skip whitespace
      }

      // Estimate token count for this word
      let tokenCount = 1;
      if (word.length > 8) tokenCount = 2;  // Long words ≈ 2 tokens
      if (/^\d+$/.test(word)) tokenCount = Math.ceil(word.length / 3); // Numbers
      if (word.length > 15) tokenCount = 3; // Very long words

      tokens.push({
        text: word,
        tokenCount,
        charLength: word.length
      });
    }

    return tokens;
  }

  /**
   * Calculate cost per token for a given model
   */
  getCostPerToken(modelName) {
    // Normalize model name (remove provider prefix)
    const normalized = modelName.toLowerCase()
      .replace(/^(openrouter|anthropic|openai|google|ollama|xai)\//, '')
      .replace(/^(meta-llama|google|x-ai|moonshot)\//, '');

    // Match to pricing table
    for (const [key, price] of Object.entries(this.modelPricing)) {
      if (normalized.includes(key)) {
        return price / 1_000_000; // Convert to per-token
      }
    }

    // Default: assume expensive if unknown
    return 30.00 / 1_000_000;
  }

  /**
   * Get color for a token based on its cost
   */
  getColorForCost(cost) {
    for (const tier of this.costTiers) {
      if (cost < tier.threshold) {
        return tier;
      }
    }
    return this.costTiers[this.costTiers.length - 1];
  }

  /**
   * Generate heatmap data for a message
   * 
   * @param {string} text - Message text
   * @param {string} model - Model name (e.g., 'gpt-4', 'claude-opus')
   * @param {number} actualTokens - Actual token count (if available)
   * @returns {object} Heatmap data
   */
  generateHeatmap(text, model, actualTokens = null) {
    const tokens = this.approximateTokenize(text);
    const costPerToken = this.getCostPerToken(model);

    // If actual token count provided, adjust our estimates
    const estimatedTotal = tokens.reduce((sum, t) => sum + t.tokenCount, 0);
    const adjustmentFactor = actualTokens ? actualTokens / estimatedTotal : 1;

    let cumulativeCost = 0;
    const heatmapTokens = tokens.map(token => {
      const adjustedTokenCount = token.tokenCount * adjustmentFactor;
      const tokenCost = adjustedTokenCount * costPerToken;
      cumulativeCost += tokenCost;

      const tier = this.getColorForCost(tokenCost);

      return {
        text: token.text,
        tokens: Math.round(adjustedTokenCount * 100) / 100,
        cost: tokenCost,
        costFormatted: this.formatCost(tokenCost),
        cumulativeCost,
        cumulativeCostFormatted: this.formatCost(cumulativeCost),
        color: tier.color,
        tier: tier.label
      };
    });

    // Calculate statistics
    const totalCost = cumulativeCost;
    const totalTokens = actualTokens || estimatedTotal * adjustmentFactor;
    const avgCostPerToken = totalCost / totalTokens;

    // Find most expensive words
    const sorted = [...heatmapTokens].sort((a, b) => b.cost - a.cost);
    const topExpensive = sorted.slice(0, 10);

    // Calculate cost distribution by tier
    const tierDistribution = {};
    for (const tier of this.costTiers) {
      tierDistribution[tier.label] = {
        count: 0,
        totalCost: 0,
        color: tier.color
      };
    }

    for (const token of heatmapTokens) {
      tierDistribution[token.tier].count++;
      tierDistribution[token.tier].totalCost += token.cost;
    }

    return {
      tokens: heatmapTokens,
      stats: {
        totalTokens: Math.round(totalTokens),
        totalCost,
        totalCostFormatted: this.formatCost(totalCost),
        avgCostPerToken,
        avgCostPerTokenFormatted: this.formatCost(avgCostPerToken),
        model,
        costPerMillionTokens: costPerToken * 1_000_000,
        tierDistribution,
        topExpensive: topExpensive.map(t => ({
          text: t.text,
          cost: t.costFormatted,
          tokens: t.tokens
        }))
      }
    };
  }

  /**
   * Format cost as human-readable string
   */
  formatCost(cost) {
    if (cost === 0) return '$0.00';
    if (cost < 0.0001) return `$${(cost * 1000000).toFixed(2)}×10⁻⁶`;
    if (cost < 0.01) return `$${(cost * 1000).toFixed(4)}×10⁻³`;
    return `$${cost.toFixed(6)}`;
  }

  /**
   * Generate HTML heatmap visualization
   */
  generateHTML(heatmapData) {
    const { tokens, stats } = heatmapData;

    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Token Cost Heatmap</title>
  <style>
    body {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
      background: #0a0a0a;
      color: #e5e5e5;
      padding: 20px;
      margin: 0;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .stats {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    
    .stats h3 {
      margin-top: 0;
      color: #60a5fa;
    }
    
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    
    .stat-item {
      background: rgba(255, 255, 255, 0.03);
      padding: 12px;
      border-radius: 6px;
    }
    
    .stat-label {
      font-size: 12px;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .stat-value {
      font-size: 20px;
      font-weight: bold;
      color: #fff;
      margin-top: 5px;
    }
    
    .heatmap {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 20px;
      line-height: 2.2;
      font-size: 16px;
      word-wrap: break-word;
    }
    
    .token {
      display: inline-block;
      padding: 2px 4px;
      margin: 2px;
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
    }
    
    .token:hover {
      transform: scale(1.1);
      z-index: 10;
    }
    
    .token:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.95);
      color: #fff;
      padding: 8px 12px;
      border-radius: 4px;
      white-space: nowrap;
      font-size: 12px;
      pointer-events: none;
      z-index: 100;
      margin-bottom: 5px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    .legend {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 20px;
      margin-top: 20px;
    }
    
    .legend h3 {
      margin-top: 0;
      color: #60a5fa;
    }
    
    .legend-items {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    
    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .legend-color {
      width: 30px;
      height: 20px;
      border-radius: 3px;
    }
    
    .top-expensive {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 20px;
      margin-top: 20px;
    }
    
    .top-expensive h3 {
      margin-top: 0;
      color: #ef4444;
    }
    
    .expensive-list {
      list-style: none;
      padding: 0;
    }
    
    .expensive-list li {
      padding: 8px;
      margin: 5px 0;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Token Cost Heatmap</h1>
    
    <div class="stats">
      <h3>Statistics</h3>
      <div class="stat-grid">
        <div class="stat-item">
          <div class="stat-label">Total Tokens</div>
          <div class="stat-value">${stats.totalTokens.toLocaleString()}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Total Cost</div>
          <div class="stat-value">${stats.totalCostFormatted}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Model</div>
          <div class="stat-value">${stats.model}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Cost/Token</div>
          <div class="stat-value">${stats.avgCostPerTokenFormatted}</div>
        </div>
      </div>
    </div>
    
    <div class="heatmap">
      ${tokens.map(t => {
        const tooltip = `${t.text} | ${t.tokens} tokens | ${t.costFormatted} | Cumulative: ${t.cumulativeCostFormatted}`;
        return `<span class="token" style="background-color: ${t.color}20; border: 1px solid ${t.color};" data-tooltip="${tooltip}">${t.text}</span>`;
      }).join('')}
    </div>
    
    <div class="legend">
      <h3>Cost Tiers</h3>
      <div class="legend-items">
        ${this.costTiers.map(tier => `
          <div class="legend-item">
            <div class="legend-color" style="background-color: ${tier.color};"></div>
            <span>${tier.label.replace('-', ' ')}</span>
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="top-expensive">
      <h3>Most Expensive Words</h3>
      <ul class="expensive-list">
        ${stats.topExpensive.slice(0, 10).map((item, i) => `
          <li>
            <span><strong>${i + 1}.</strong> "${item.text}"</span>
            <span>${item.cost} (${item.tokens} tokens)</span>
          </li>
        `).join('')}
      </ul>
    </div>
  </div>
</body>
</html>
    `;

    return html;
  }
}

module.exports = TokenHeatmap;
