/**
 * API client for ALFIE services
 */

import fetch from 'node-fetch';
import { getEndpoint, getConfig } from './config.js';

/**
 * Get embedding for text
 */
export async function getEmbedding(text) {
  const endpoint = getEndpoint('embedding');
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: text.slice(0, 8000) }),
    timeout: 15000
  });
  
  if (!response.ok) {
    throw new Error(`Embedding service error: ${response.status}`);
  }
  
  const data = await response.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : data;
}

/**
 * Search second brain for memories
 */
export async function searchMemories(query, options = {}) {
  const {
    limit = getConfig('search.defaultLimit'),
    scoreThreshold = getConfig('search.scoreThreshold'),
    collection = getConfig('search.collection')
  } = options;
  
  const qdrantEndpoint = getEndpoint('secondBrain');
  
  // Get embedding for query
  const embedding = await getEmbedding(query);
  
  // Search Qdrant
  const searchPayload = {
    vector: embedding,
    limit,
    with_payload: true,
    score_threshold: scoreThreshold
  };
  
  const response = await fetch(
    `${qdrantEndpoint}/collections/${collection}/points/search`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchPayload),
      timeout: 15000
    }
  );
  
  if (!response.ok) {
    throw new Error(`Qdrant search error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.result || [];
}

/**
 * Query a model (local or cloud)
 */
export async function queryModel(prompt, options = {}) {
  const {
    model = getConfig('chat.model'),
    temperature = getConfig('chat.temperature'),
    maxTokens = getConfig('chat.maxTokens'),
    stream = false
  } = options;
  
  let endpoint, apiKey, modelId;
  
  // Determine which endpoint to use
  if (model.startsWith('local')) {
    endpoint = model === 'local-120b' 
      ? getEndpoint('consensus.local120b')
      : getEndpoint('consensus.local20b');
    modelId = model === 'local-120b' ? 'gpt-oss-120b' : 'gpt-oss-20b';
  } else {
    // OpenRouter for cloud models
    endpoint = getEndpoint('consensus.openrouter');
    apiKey = getConfig('apiKeys.openrouter');
    modelId = model;
  }
  
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['HTTP-Referer'] = 'https://github.com/alfie-ai/alfie-cli';
    headers['X-Title'] = 'ALFIE CLI';
  }
  
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
      stream
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Model query error: ${response.status} - ${error}`);
  }
  
  if (stream) {
    return response.body;
  }
  
  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

/**
 * Check service health
 */
export async function checkHealth() {
  const results = {
    secondBrain: false,
    embedding: false,
    localModels: {
      '120b': false,
      '20b': false
    },
    openrouter: false
  };
  
  // Check Qdrant
  try {
    const response = await fetch(`${getEndpoint('secondBrain')}/collections`, {
      timeout: 5000
    });
    results.secondBrain = response.ok;
  } catch (e) {
    results.secondBrain = false;
  }
  
  // Check embedding service
  try {
    const response = await fetch(getEndpoint('embedding'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: 'test' }),
      timeout: 5000
    });
    results.embedding = response.ok;
  } catch (e) {
    results.embedding = false;
  }
  
  // Check local models
  try {
    const response = await fetch(`${getEndpoint('consensus.local120b')}/models`, {
      timeout: 5000
    });
    results.localModels['120b'] = response.ok;
  } catch (e) {
    results.localModels['120b'] = false;
  }
  
  try {
    const response = await fetch(`${getEndpoint('consensus.local20b')}/models`, {
      timeout: 5000
    });
    results.localModels['20b'] = response.ok;
  } catch (e) {
    results.localModels['20b'] = false;
  }
  
  // Check OpenRouter (just verify key exists)
  results.openrouter = !!getConfig('apiKeys.openrouter');
  
  return results;
}

/**
 * Get collection stats
 */
export async function getCollectionStats(collection = 'second_brain') {
  const qdrantEndpoint = getEndpoint('secondBrain');
  
  const response = await fetch(
    `${qdrantEndpoint}/collections/${collection}`,
    { timeout: 5000 }
  );
  
  if (!response.ok) {
    throw new Error(`Qdrant error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.result;
}
