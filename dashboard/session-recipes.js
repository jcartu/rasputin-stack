#!/usr/bin/env node
// Session Recipes - Save successful sessions as reusable templates
// Novel feature from competitive analysis - nobody else has this!

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SessionRecipes {
  constructor() {
    this.recipesFile = path.join(__dirname, '.session_recipes.json');
    this.recipes = this.loadRecipes();
  }

  // Load recipes from file
  loadRecipes() {
    try {
      if (fs.existsSync(this.recipesFile)) {
        const data = fs.readFileSync(this.recipesFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load recipes:', e.message);
    }
    return [];
  }

  // Save recipes to file
  saveRecipes() {
    try {
      fs.writeFileSync(this.recipesFile, JSON.stringify(this.recipes, null, 2));
    } catch (e) {
      console.error('Failed to save recipes:', e.message);
    }
  }

  // Create a recipe from a session
  createRecipe(name, description, sessionData, tags = []) {
    const recipeId = crypto.randomBytes(8).toString('hex');
    
    // Extract key components from session
    const recipe = {
      id: recipeId,
      name,
      description,
      tags,
      created: Date.now(),
      lastUsed: null,
      useCount: 0,
      
      // Template structure
      template: {
        initialPrompt: this.extractInitialPrompt(sessionData),
        tools: this.extractToolsUsed(sessionData),
        steps: this.extractSteps(sessionData),
        expectedDuration: sessionData.duration || 0,
        estimatedCost: sessionData.cost || 0,
      },
      
      // Success metrics from original session
      metrics: {
        duration: sessionData.duration || 0,
        cost: sessionData.cost || 0,
        toolCallCount: sessionData.toolCalls?.length || 0,
        messageCount: sessionData.messages?.length || 0,
      },
      
      // Original session reference (for learning)
      sourceSession: {
        key: sessionData.key || null,
        timestamp: sessionData.timestamp || Date.now(),
      },
    };

    this.recipes.push(recipe);
    this.saveRecipes();
    
    return recipe;
  }

  // Extract initial prompt from session
  extractInitialPrompt(sessionData) {
    if (sessionData.messages && sessionData.messages.length > 0) {
      const firstUserMsg = sessionData.messages.find(m => m.role === 'user');
      return firstUserMsg ? firstUserMsg.content : '';
    }
    return '';
  }

  // Extract tools used in session
  extractToolsUsed(sessionData) {
    if (!sessionData.toolCalls) return [];
    
    const toolNames = new Set();
    sessionData.toolCalls.forEach(call => {
      if (call.tool) toolNames.add(call.tool);
    });
    
    return Array.from(toolNames);
  }

  // Extract high-level steps from session
  extractSteps(sessionData) {
    if (!sessionData.messages) return [];
    
    const steps = [];
    let stepNum = 1;
    
    for (const msg of sessionData.messages) {
      if (msg.role === 'user' && steps.length > 0) {
        // User message after assistant = interaction point
        steps.push({
          step: stepNum++,
          type: 'user_interaction',
          summary: this.truncate(msg.content, 100),
        });
      } else if (msg.role === 'assistant') {
        // Assistant message with tool calls
        const toolCalls = sessionData.toolCalls?.filter(
          tc => tc.messageIndex === steps.length
        ) || [];
        
        steps.push({
          step: stepNum++,
          type: 'assistant_action',
          summary: this.truncate(msg.content, 100),
          tools: toolCalls.map(tc => tc.tool),
        });
      }
    }
    
    return steps.slice(0, 10); // Keep first 10 steps as template
  }

  // Truncate text
  truncate(text, maxLen) {
    if (!text) return '';
    return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
  }

  // Get all recipes
  getRecipes(filters = {}) {
    let filtered = [...this.recipes];
    
    // Filter by tag
    if (filters.tag) {
      filtered = filtered.filter(r => r.tags.includes(filters.tag));
    }
    
    // Filter by search query
    if (filters.query) {
      const q = filters.query.toLowerCase();
      filtered = filtered.filter(r => 
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    
    // Sort by popularity (use count)
    if (filters.sort === 'popular') {
      filtered.sort((a, b) => b.useCount - a.useCount);
    } else if (filters.sort === 'recent') {
      filtered.sort((a, b) => b.created - a.created);
    } else if (filters.sort === 'cost') {
      filtered.sort((a, b) => a.metrics.cost - b.metrics.cost);
    }
    
    return filtered;
  }

  // Get recipe by ID
  getRecipe(recipeId) {
    return this.recipes.find(r => r.id === recipeId);
  }

  // Update recipe
  updateRecipe(recipeId, updates) {
    const idx = this.recipes.findIndex(r => r.id === recipeId);
    if (idx === -1) return null;
    
    this.recipes[idx] = {
      ...this.recipes[idx],
      ...updates,
    };
    
    this.saveRecipes();
    return this.recipes[idx];
  }

  // Delete recipe
  deleteRecipe(recipeId) {
    const idx = this.recipes.findIndex(r => r.id === recipeId);
    if (idx === -1) return false;
    
    this.recipes.splice(idx, 1);
    this.saveRecipes();
    return true;
  }

  // Record recipe usage
  recordUsage(recipeId) {
    const recipe = this.getRecipe(recipeId);
    if (!recipe) return null;
    
    recipe.useCount++;
    recipe.lastUsed = Date.now();
    this.saveRecipes();
    
    return recipe;
  }

  // Get all unique tags
  getAllTags() {
    const tags = new Set();
    this.recipes.forEach(r => {
      r.tags.forEach(t => tags.add(t));
    });
    return Array.from(tags).sort();
  }

  // Get statistics
  getStats() {
    return {
      total: this.recipes.length,
      totalUses: this.recipes.reduce((sum, r) => sum + r.useCount, 0),
      avgCost: this.recipes.length > 0
        ? this.recipes.reduce((sum, r) => sum + r.metrics.cost, 0) / this.recipes.length
        : 0,
      avgDuration: this.recipes.length > 0
        ? this.recipes.reduce((sum, r) => sum + r.metrics.duration, 0) / this.recipes.length
        : 0,
      mostPopular: this.recipes.length > 0
        ? this.recipes.reduce((max, r) => r.useCount > max.useCount ? r : max, this.recipes[0])
        : null,
      tags: this.getAllTags(),
    };
  }

  // Suggest recipes based on user query
  suggestRecipes(userQuery, limit = 3) {
    if (!userQuery) return [];
    
    const query = userQuery.toLowerCase();
    const scored = this.recipes.map(recipe => {
      let score = 0;
      
      // Match in name (highest weight)
      if (recipe.name.toLowerCase().includes(query)) score += 100;
      
      // Match in description
      if (recipe.description.toLowerCase().includes(query)) score += 50;
      
      // Match in tags
      recipe.tags.forEach(tag => {
        if (tag.toLowerCase().includes(query)) score += 30;
      });
      
      // Match in initial prompt
      if (recipe.template.initialPrompt.toLowerCase().includes(query)) score += 20;
      
      // Boost popular recipes
      score += recipe.useCount * 5;
      
      return { recipe, score };
    });
    
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.recipe);
  }
}

module.exports = SessionRecipes;
