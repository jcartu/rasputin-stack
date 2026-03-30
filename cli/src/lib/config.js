/**
 * Configuration management for ALFIE CLI
 */

import Conf from 'conf';
import { homedir } from 'os';
import { join } from 'path';

// Default configuration
const defaults = {
  // ALFIE endpoints
  endpoints: {
    secondBrain: 'http://localhost:6333',
    embedding: 'http://localhost:8003/embed',
    consensus: {
      local120b: 'http://localhost:8001/v1',
      local20b: 'http://localhost:8002/v1',
      openrouter: 'https://openrouter.ai/api/v1'
    }
  },
  
  // Workspace path
  workspace: join(homedir(), '.openclaw', 'workspace'),
  
  // Chat settings
  chat: {
    model: 'local-120b',
    temperature: 0.7,
    maxTokens: 2000,
    streamOutput: true
  },
  
  // Search settings
  search: {
    defaultLimit: 10,
    scoreThreshold: 0.5,
    collection: 'second_brain'
  },
  
  // Session settings
  sessions: {
    directory: join(homedir(), '.openclaw', 'sessions'),
    maxHistory: 100
  },
  
  // Display settings
  display: {
    colorOutput: true,
    showTimestamps: true,
    markdownRendering: true
  },
  
  // API keys (loaded from env by default)
  apiKeys: {
    openrouter: process.env.OPENROUTER_API_KEY || '',
    perplexity: process.env.PERPLEXITY_API_KEY || '',
    brave: process.env.BRAVE_API_KEY || ''
  }
};

// Create config store
export const config = new Conf({
  projectName: 'alfie-cli',
  defaults,
  schema: {
    endpoints: { type: 'object' },
    workspace: { type: 'string' },
    chat: { type: 'object' },
    search: { type: 'object' },
    sessions: { type: 'object' },
    display: { type: 'object' },
    apiKeys: { type: 'object' }
  }
});

/**
 * Get a config value
 */
export function getConfig(key) {
  return config.get(key);
}

/**
 * Set a config value
 */
export function setConfig(key, value) {
  config.set(key, value);
}

/**
 * Reset config to defaults
 */
export function resetConfig() {
  config.clear();
}

/**
 * Get all config
 */
export function getAllConfig() {
  return config.store;
}

/**
 * Get workspace path
 */
export function getWorkspacePath() {
  return config.get('workspace');
}

/**
 * Get endpoint URL
 */
export function getEndpoint(name) {
  const endpoints = config.get('endpoints');
  const parts = name.split('.');
  let value = endpoints;
  for (const part of parts) {
    value = value?.[part];
  }
  return value;
}
