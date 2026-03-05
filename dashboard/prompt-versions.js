#!/usr/bin/env node
// Prompt Version Control System for ALFIE Nexus Playground
// Tracks prompt versions, results, and enables A/B comparison

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PromptVersionControl {
  constructor(storePath = path.join(__dirname, '.prompt_versions.json')) {
    this.storePath = storePath;
    this.versions = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.storePath)) {
        return JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      }
    } catch (err) {
      console.error('Failed to load prompt versions:', err);
    }
    return { prompts: {}, history: [] };
  }

  save() {
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(this.versions, null, 2));
    } catch (err) {
      console.error('Failed to save prompt versions:', err);
    }
  }

  // Save a new prompt or new version of existing prompt
  savePrompt(name, prompt, description = '', tags = []) {
    const id = this.generateId(name);
    const timestamp = Date.now();
    const hash = this.hashPrompt(prompt);

    // Check if prompt with this name exists
    if (!this.versions.prompts[id]) {
      // New prompt
      this.versions.prompts[id] = {
        id,
        name,
        description,
        tags,
        createdAt: timestamp,
        updatedAt: timestamp,
        versions: []
      };
    }

    // Check if this exact prompt text already exists in versions
    const existingVersion = this.versions.prompts[id].versions.find(v => v.hash === hash);
    if (existingVersion) {
      return { success: true, message: 'Prompt already saved', versionId: existingVersion.versionId, isDuplicate: true };
    }

    // Add new version
    const versionId = `${id}_v${this.versions.prompts[id].versions.length + 1}`;
    const version = {
      versionId,
      prompt,
      hash,
      timestamp,
      results: [], // Will store model responses
      metrics: {
        avgLatency: 0,
        avgTokens: 0,
        avgCost: 0
      }
    };

    this.versions.prompts[id].versions.push(version);
    this.versions.prompts[id].updatedAt = timestamp;

    // Add to history
    this.versions.history.push({
      action: 'create_version',
      promptId: id,
      versionId,
      timestamp
    });

    this.save();
    return { success: true, message: 'Prompt version saved', versionId, isDuplicate: false };
  }

  // Save results for a prompt version
  saveResults(versionId, results) {
    for (const promptId in this.versions.prompts) {
      const version = this.versions.prompts[promptId].versions.find(v => v.versionId === versionId);
      if (version) {
        version.results = results;
        
        // Calculate metrics
        const validResults = results.filter(r => !r.error && r.elapsed && r.usage);
        if (validResults.length > 0) {
          version.metrics.avgLatency = validResults.reduce((sum, r) => sum + r.elapsed, 0) / validResults.length;
          version.metrics.avgTokens = validResults.reduce((sum, r) => sum + (r.usage?.total_tokens || 0), 0) / validResults.length;
          // Rough cost estimate (GPT-4 pricing: $30/1M input, $60/1M output)
          version.metrics.avgCost = validResults.reduce((sum, r) => {
            const inputCost = (r.usage?.prompt_tokens || 0) * 0.00003;
            const outputCost = (r.usage?.completion_tokens || 0) * 0.00006;
            return sum + inputCost + outputCost;
          }, 0) / validResults.length;
        }

        this.versions.prompts[promptId].updatedAt = Date.now();
        this.save();
        return { success: true };
      }
    }
    return { success: false, message: 'Version not found' };
  }

  // Get all prompts (summary)
  getAllPrompts() {
    return Object.values(this.versions.prompts).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      tags: p.tags,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      versionCount: p.versions.length,
      latestVersion: p.versions[p.versions.length - 1]?.versionId
    }));
  }

  // Get specific prompt with all versions
  getPrompt(promptId) {
    return this.versions.prompts[promptId] || null;
  }

  // Get specific version
  getVersion(versionId) {
    for (const promptId in this.versions.prompts) {
      const version = this.versions.prompts[promptId].versions.find(v => v.versionId === versionId);
      if (version) {
        return {
          prompt: this.versions.prompts[promptId],
          version
        };
      }
    }
    return null;
  }

  // Compare two versions
  compareVersions(versionId1, versionId2) {
    const v1 = this.getVersion(versionId1);
    const v2 = this.getVersion(versionId2);
    
    if (!v1 || !v2) {
      return { success: false, message: 'One or both versions not found' };
    }

    return {
      success: true,
      comparison: {
        version1: {
          id: versionId1,
          prompt: v1.version.prompt,
          timestamp: v1.version.timestamp,
          metrics: v1.version.metrics,
          results: v1.version.results
        },
        version2: {
          id: versionId2,
          prompt: v2.version.prompt,
          timestamp: v2.version.timestamp,
          metrics: v2.version.metrics,
          results: v2.version.results
        },
        diff: this.generateDiff(v1.version.prompt, v2.version.prompt),
        metricsComparison: {
          latencyDelta: v2.version.metrics.avgLatency - v1.version.metrics.avgLatency,
          tokensDelta: v2.version.metrics.avgTokens - v1.version.metrics.avgTokens,
          costDelta: v2.version.metrics.avgCost - v1.version.metrics.avgCost
        }
      }
    };
  }

  // Delete prompt and all versions
  deletePrompt(promptId) {
    if (this.versions.prompts[promptId]) {
      delete this.versions.prompts[promptId];
      this.versions.history.push({
        action: 'delete_prompt',
        promptId,
        timestamp: Date.now()
      });
      this.save();
      return { success: true };
    }
    return { success: false, message: 'Prompt not found' };
  }

  // Delete specific version
  deleteVersion(versionId) {
    for (const promptId in this.versions.prompts) {
      const versionIndex = this.versions.prompts[promptId].versions.findIndex(v => v.versionId === versionId);
      if (versionIndex !== -1) {
        this.versions.prompts[promptId].versions.splice(versionIndex, 1);
        this.versions.prompts[promptId].updatedAt = Date.now();
        this.versions.history.push({
          action: 'delete_version',
          promptId,
          versionId,
          timestamp: Date.now()
        });
        this.save();
        return { success: true };
      }
    }
    return { success: false, message: 'Version not found' };
  }

  // Get recent history
  getHistory(limit = 50) {
    return this.versions.history.slice(-limit).reverse();
  }

  // Search prompts
  search(query) {
    const lowerQuery = query.toLowerCase();
    return Object.values(this.versions.prompts).filter(p => 
      p.name.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery) ||
      p.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
      p.versions.some(v => v.prompt.toLowerCase().includes(lowerQuery))
    );
  }

  // Helper: Generate ID from name
  generateId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // Helper: Hash prompt text
  hashPrompt(prompt) {
    return crypto.createHash('sha256').update(prompt).digest('hex').substring(0, 16);
  }

  // Helper: Generate simple diff
  generateDiff(text1, text2) {
    const words1 = text1.split(/\s+/);
    const words2 = text2.split(/\s+/);
    
    // Simple word-level diff (not optimal but works)
    const removed = words1.filter(w => !words2.includes(w));
    const added = words2.filter(w => !words1.includes(w));
    
    return {
      removed: removed.slice(0, 20), // Limit to prevent huge diffs
      added: added.slice(0, 20),
      similarity: this.calculateSimilarity(text1, text2)
    };
  }

  // Helper: Calculate text similarity (0-1)
  calculateSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  // Export prompts
  export() {
    return this.versions;
  }

  // Import prompts (merge, don't overwrite)
  import(data) {
    try {
      // Merge prompts
      for (const id in data.prompts) {
        if (!this.versions.prompts[id]) {
          this.versions.prompts[id] = data.prompts[id];
        } else {
          // Merge versions if prompt exists
          const existingHashes = new Set(this.versions.prompts[id].versions.map(v => v.hash));
          const newVersions = data.prompts[id].versions.filter(v => !existingHashes.has(v.hash));
          this.versions.prompts[id].versions.push(...newVersions);
        }
      }
      // Append history
      this.versions.history.push(...(data.history || []));
      this.save();
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // Get stats
  getStats() {
    const prompts = Object.values(this.versions.prompts);
    const totalVersions = prompts.reduce((sum, p) => sum + p.versions.length, 0);
    const totalResults = prompts.reduce((sum, p) => 
      sum + p.versions.reduce((vSum, v) => vSum + v.results.length, 0), 0
    );

    return {
      totalPrompts: prompts.length,
      totalVersions,
      totalResults,
      avgVersionsPerPrompt: prompts.length > 0 ? (totalVersions / prompts.length).toFixed(1) : 0,
      recentActivity: this.versions.history.slice(-10).reverse()
    };
  }
}

module.exports = PromptVersionControl;
