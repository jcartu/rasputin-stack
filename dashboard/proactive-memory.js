#!/usr/bin/env node
// Proactive Memory Context Injection System
// Automatically queries second brain before EVERY ALFIE response
// Based on competitive analysis: MemGPT, Mem0, ChatGPT Memory

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');

class ProactiveMemory {
  constructor() {
    this.enabled = true;
    this.cacheDir = path.join(__dirname, '.memory_cache');
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    this.maxResults = 5; // Top 5 memories per query
    this.minRelevanceScore = 0.5; // Minimum similarity score
    
    // Statistics
    this.stats = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgRetrievalTimeMs: 0,
      memoriesRetrieved: 0,
    };

    this.ensureCacheDir();
  }

  async ensureCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create cache dir:', error);
    }
  }

  // Hash query for cache key
  hashQuery(query) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(query).digest('hex');
  }

  // Check cache for recent results
  async getFromCache(query) {
    const cacheKey = this.hashQuery(query);
    const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

    try {
      const stats = await fs.stat(cachePath);
      const age = Date.now() - stats.mtimeMs;
      
      if (age < this.cacheTTL) {
        const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
        this.stats.cacheHits++;
        return cached;
      }
    } catch (error) {
      // Cache miss - file doesn't exist or expired
    }

    this.stats.cacheMisses++;
    return null;
  }

  // Save to cache
  async saveToCache(query, results) {
    const cacheKey = this.hashQuery(query);
    const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

    try {
      await fs.writeFile(cachePath, JSON.stringify(results, null, 2));
    } catch (error) {
      console.error('Failed to cache results:', error);
    }
  }

  // Query second brain using SMART query system
  // Now uses smart_memory_query.py with multi-query decomposition, 
  // temporal decay, and importance ranking
  async querySecondBrain(query) {
    const startTime = Date.now();
    this.stats.totalQueries++;

    try {
      // Use new smart query system with JSON output
      const { stdout } = await execAsync(
        `python3 /home/admin/.openclaw/workspace/smart_memory_query.py "${query}" --max-results ${this.maxResults} --format json --recency-weight 0.3`,
        { timeout: 15000 } // 15 second timeout (smart query is more thorough)
      );

      // Parse JSON output from smart query
      const results = JSON.parse(stdout);
      
      // Convert to our format
      const memories = results
        .filter(r => r.combined_score >= this.minRelevanceScore)
        .map(r => ({
          score: r.combined_score || r.score || 0,
          text: r.content || '',
          temporalFactor: r.temporal_factor || null,
          importanceBoost: r.importance_boost || 0,
          ageDays: r.age_days || null,
        }));

      const elapsed = Date.now() - startTime;
      this.stats.avgRetrievalTimeMs = 
        (this.stats.avgRetrievalTimeMs * (this.stats.totalQueries - 1) + elapsed) / 
        this.stats.totalQueries;
      this.stats.memoriesRetrieved += memories.length;

      return memories;
    } catch (error) {
      console.error('Smart query failed, falling back to basic query:', error.message);
      
      // Fallback to basic query if smart query fails
      try {
        const { stdout } = await execAsync(
          `python3 /home/admin/.openclaw/workspace/alfie_second_brain.py "${query}" ${this.maxResults}`,
          { timeout: 10000 }
        );

        // Parse basic query output
        const lines = stdout.split('\n');
        const memories = [];
        let currentMemory = null;

        for (const line of lines) {
          const headerMatch = line.match(/^\[.+?\]\s+\w+:.+?\(relevance:\s*([\d.]+)\)/);
          
          if (headerMatch) {
            if (currentMemory && currentMemory.text.trim()) {
              const score = parseFloat(currentMemory.score);
              if (score >= this.minRelevanceScore) {
                memories.push(currentMemory);
              }
            }
            
            currentMemory = {
              score: parseFloat(headerMatch[1]),
              text: '',
            };
          } else if (currentMemory && line.trim() && !line.startsWith('##')) {
            currentMemory.text += (currentMemory.text ? ' ' : '') + line.trim();
          }
        }

        if (currentMemory && currentMemory.text.trim()) {
          const score = parseFloat(currentMemory.score);
          if (score >= this.minRelevanceScore) {
            memories.push(currentMemory);
          }
        }

        return memories;
      } catch (fallbackError) {
        console.error('Both smart and basic queries failed:', fallbackError.message);
        return [];
      }
    }
  }

  // Extract relevant entities and topics from message
  async extractQueryTerms(message) {
    // Multi-query decomposition: extract key terms for memory search
    const queries = [];

    // 1. Named entities (people, places, projects)
    const entities = message.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    queries.push(...entities.slice(0, 3)); // Top 3 named entities

    // 2. Technical terms (code, APIs, tools)
    const techTerms = message.match(/\b(?:API|CLI|GPU|CPU|model|agent|server|database|script|config)\b/gi) || [];
    queries.push(...new Set(techTerms.map(t => t.toLowerCase())));

    // 3. Action keywords
    const actions = message.match(/\b(?:install|deploy|fix|optimize|debug|monitor|track|analyze)\w*\b/gi) || [];
    queries.push(...new Set(actions.map(a => a.toLowerCase())));

    // 4. Full message (if short)
    if (message.length < 200) {
      queries.push(message);
    } else {
      // Or first sentence
      const firstSentence = message.match(/^.+?[.!?]/);
      if (firstSentence) {
        queries.push(firstSentence[0]);
      }
    }

    return [...new Set(queries)].slice(0, 5); // Max 5 queries
  }

  // Main: Get proactive context for a user message
  // Now uses smart_memory_query.py which handles query decomposition,
  // deduplication, temporal decay, and importance ranking automatically
  async getProactiveContext(message, options = {}) {
    if (!this.enabled) return null;

    const {
      useCache = true,
      forceRefresh = false,
    } = options;

    try {
      // Check cache first
      if (useCache && !forceRefresh) {
        const cached = await this.getFromCache(message);
        if (cached) {
          return cached;
        }
      }

      // Smart query handles everything: decomposition, dedup, temporal, importance
      // Just pass the full message - it will figure out the best queries
      const memories = await this.querySecondBrain(message);

      if (!memories || memories.length === 0) {
        return null;
      }

      const result = {
        memories: memories,
        queriesUsed: ['smart_query_auto_decomposed'], // Smart query decomposes internally
        timestamp: Date.now(),
        totalFound: memories.length,
      };

      // Cache for future
      if (useCache) {
        await this.saveToCache(message, result);
      }

      return result;
    } catch (error) {
      console.error('Proactive memory retrieval failed:', error);
      return null;
    }
  }

  // Format memories for inclusion in system prompt
  // Now includes smart query metadata (temporal, importance)
  formatForPrompt(context) {
    if (!context || !context.memories || context.memories.length === 0) {
      return '';
    }

    const memoryText = context.memories
      .map((m, i) => {
        let meta = `[Score: ${m.score.toFixed(2)}`;
        if (m.ageDays !== null && m.ageDays !== undefined) {
          meta += `, Age: ${m.ageDays}d`;
        }
        if (m.importanceBoost) {
          meta += `, Importance: +${(m.importanceBoost * 100).toFixed(0)}%`;
        }
        meta += `]`;
        
        return `${i + 1}. ${meta} ${m.text}`;
      })
      .join('\n\n');

    return `\n\n## Relevant Context from Second Brain (${context.memories.length} memories retrieved via smart query):\n${memoryText}\n`;
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      cacheHitRate: this.stats.totalQueries > 0 
        ? (this.stats.cacheHits / this.stats.totalQueries * 100).toFixed(1) + '%'
        : '0%',
      avgMemoriesPerQuery: this.stats.totalQueries > 0
        ? (this.stats.memoriesRetrieved / this.stats.totalQueries).toFixed(1)
        : '0',
    };
  }

  // Enable/disable proactive memory
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  // Clear cache
  async clearCache() {
    try {
      const files = await fs.readdir(this.cacheDir);
      for (const file of files) {
        await fs.unlink(path.join(this.cacheDir, file));
      }
      console.log(`Cleared ${files.length} cached memory queries`);
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }

  // Warm cache for common queries
  async warmCache(commonQueries = []) {
    console.log(`Warming cache with ${commonQueries.length} common queries...`);
    
    for (const query of commonQueries) {
      await this.getProactiveContext(query, { useCache: false });
    }
    
    console.log('Cache warming complete');
  }
}

// Singleton instance
const proactiveMemory = new ProactiveMemory();

module.exports = proactiveMemory;

// CLI usage
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'test') {
    const message = process.argv.slice(3).join(' ') || 'Tell me about admin';
    
    console.log(`Testing proactive memory for: "${message}"\n`);
    
    proactiveMemory.getProactiveContext(message).then(context => {
      if (context) {
        console.log('Queries used:', context.queriesUsed);
        console.log(`Found ${context.totalFound} memories, showing top ${context.memories.length}:\n`);
        
        for (const memory of context.memories) {
          console.log(`Score: ${memory.score.toFixed(3)} | Query: "${memory.query}"`);
          console.log(`Text: ${memory.text}\n`);
        }
        
        console.log('\nFormatted for prompt:');
        console.log(proactiveMemory.formatForPrompt(context));
      } else {
        console.log('No relevant memories found');
      }
      
      console.log('\nStatistics:', proactiveMemory.getStats());
    }).catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
  } else if (command === 'stats') {
    console.log('Proactive Memory Statistics:', proactiveMemory.getStats());
  } else if (command === 'clear-cache') {
    proactiveMemory.clearCache().then(() => {
      console.log('Cache cleared successfully');
    });
  } else {
    console.log('Usage:');
    console.log('  node proactive-memory.js test [message]   - Test memory retrieval');
    console.log('  node proactive-memory.js stats            - Show statistics');
    console.log('  node proactive-memory.js clear-cache      - Clear cache');
  }
}
