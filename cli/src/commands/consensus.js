/**
 * Consensus command - Multi-model consensus queries
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner, success, error, header, createTable, renderMarkdown } from '../lib/output.js';
import { getConfig, getEndpoint } from '../lib/config.js';
import fetch from 'node-fetch';

/**
 * Create the consensus command
 */
export function consensusCommand() {
  const cmd = new Command('consensus')
    .description('Query multiple models and get consensus answer')
    .argument('<query>', 'Question to ask')
    .option('-t, --type <type>', 'Query type (factual, analytical, creative)', 'factual')
    .option('--temperature <n>', 'Temperature (0.0-1.0)', parseFloat)
    .option('--timeout <ms>', 'Timeout per model in ms', parseInt, 60000)
    .option('-o, --output <format>', 'Output format (text, json)', 'text')
    .option('--models <list>', 'Comma-separated list of models to use')
    .option('--no-local', 'Skip local models')
    .option('--no-cloud', 'Skip cloud models')
    .action(handleConsensus);
  
  return cmd;
}

/**
 * Query a single model
 */
async function queryModel(model, prompt, temperature, timeout) {
  const startTime = Date.now();
  
  try {
    let url, headers, body;
    
    if (model.isLocal) {
      url = `${model.endpoint}/chat/completions`;
      headers = { 'Content-Type': 'application/json' };
    } else {
      url = 'https://openrouter.ai/api/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`,
        'HTTP-Referer': 'https://github.com/alfie-ai/alfie-cli',
        'X-Title': 'ALFIE CLI Consensus'
      };
    }
    
    body = {
      model: model.modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: 1000
    };
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      return {
        name: model.name,
        error: `HTTP ${response.status}: ${errorText}`,
        responseTime: Date.now() - startTime
      };
    }
    
    const data = await response.json();
    const text = data.choices[0]?.message?.content || '';
    
    return {
      name: model.name,
      text,
      responseTime: Date.now() - startTime
    };
    
  } catch (e) {
    return {
      name: model.name,
      error: e.name === 'AbortError' ? 'Timeout' : e.message,
      responseTime: Date.now() - startTime
    };
  }
}

/**
 * Calculate text similarity (simple approach)
 */
function calculateSimilarity(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Handle consensus command
 */
async function handleConsensus(query, options) {
  // Build model list
  const models = [];
  
  // Local models
  if (options.local !== false) {
    models.push({
      name: 'Local-120B',
      endpoint: getEndpoint('consensus.local120b'),
      modelId: 'gpt-oss-120b',
      isLocal: true
    });
    models.push({
      name: 'Local-20B',
      endpoint: getEndpoint('consensus.local20b'),
      modelId: 'gpt-oss-20b',
      isLocal: true
    });
  }
  
  // Cloud models
  const openrouterKey = getConfig('apiKeys.openrouter');
  if (options.cloud !== false && openrouterKey) {
    models.push({
      name: 'Claude-Sonnet',
      modelId: 'anthropic/claude-3.5-sonnet',
      apiKey: openrouterKey,
      isLocal: false
    });
    models.push({
      name: 'GPT-4',
      modelId: 'openai/gpt-4-turbo',
      apiKey: openrouterKey,
      isLocal: false
    });
  }
  
  if (models.length === 0) {
    error('No models available. Check your configuration.');
    process.exit(1);
  }
  
  // Determine temperature
  const temperature = options.temperature ?? (options.type === 'factual' ? 0.3 : 0.7);
  
  const spinner = createSpinner(`Querying ${models.length} models...`).start();
  
  try {
    // Query all models in parallel
    const responses = await Promise.all(
      models.map(m => queryModel(m, query, temperature, options.timeout))
    );
    
    spinner.stop();
    
    // Filter successful responses
    const successful = responses.filter(r => !r.error && r.text);
    const failed = responses.filter(r => r.error);
    
    // Show individual responses
    console.log();
    responses.forEach(r => {
      if (r.error) {
        console.log(`  ${chalk.red('✗')} ${chalk.gray(r.name)}: ${chalk.red(r.error)}`);
      } else {
        console.log(`  ${chalk.green('✓')} ${chalk.gray(r.name)}: ${chalk.gray(`${r.responseTime}ms`)}`);
      }
    });
    console.log();
    
    if (successful.length === 0) {
      error('No models responded successfully.');
      process.exit(1);
    }
    
    // Calculate agreement
    let avgSimilarity = 1.0;
    if (successful.length >= 2) {
      const similarities = [];
      for (let i = 0; i < successful.length; i++) {
        for (let j = i + 1; j < successful.length; j++) {
          similarities.push(calculateSimilarity(successful[i].text, successful[j].text));
        }
      }
      avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    }
    
    // Determine confidence
    let confidence, level;
    if (avgSimilarity >= 0.6) {
      confidence = 0.95;
      level = 'High Consensus';
    } else if (avgSimilarity >= 0.4) {
      confidence = 0.75;
      level = 'Moderate Consensus';
    } else if (avgSimilarity >= 0.2) {
      confidence = 0.50;
      level = 'Low Consensus';
    } else {
      confidence = 0.25;
      level = 'Disagreement';
    }
    
    // Select consensus answer (most similar to others for factual, longest for analytical/creative)
    let consensusResponse;
    if (options.type === 'factual') {
      // Find response with highest average similarity to others
      let bestIdx = 0;
      let bestAvgSim = 0;
      
      for (let i = 0; i < successful.length; i++) {
        const sims = [];
        for (let j = 0; j < successful.length; j++) {
          if (i !== j) {
            sims.push(calculateSimilarity(successful[i].text, successful[j].text));
          }
        }
        const avg = sims.length > 0 ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
        if (avg > bestAvgSim) {
          bestAvgSim = avg;
          bestIdx = i;
        }
      }
      consensusResponse = successful[bestIdx];
    } else {
      // Pick longest for analytical/creative
      consensusResponse = successful.reduce((a, b) => a.text.length > b.text.length ? a : b);
    }
    
    // Output
    if (options.output === 'json') {
      console.log(JSON.stringify({
        query,
        queryType: options.type,
        confidence,
        agreementLevel: level,
        consensusAnswer: consensusResponse.text,
        responses: responses.map(r => ({
          model: r.name,
          text: r.text || null,
          error: r.error || null,
          responseTime: r.responseTime
        })),
        analysis: {
          totalModels: models.length,
          successful: successful.length,
          failed: failed.length,
          avgResponseTime: responses.reduce((a, b) => a + b.responseTime, 0) / responses.length
        }
      }, null, 2));
    } else {
      // Pretty print
      header('Consensus Result');
      
      console.log(`${chalk.gray('Query:')} ${query}`);
      console.log(`${chalk.gray('Type:')} ${options.type}`);
      console.log();
      
      // Confidence indicator
      const confColor = confidence >= 0.75 ? chalk.green : confidence >= 0.5 ? chalk.yellow : chalk.red;
      console.log(`${chalk.gray('Confidence:')} ${confColor(`${(confidence * 100).toFixed(0)}%`)} (${level})`);
      console.log();
      
      // Consensus answer
      console.log(chalk.bold('Answer:'));
      console.log(chalk.white(consensusResponse.text));
      console.log();
      
      // Individual responses summary
      if (successful.length > 1) {
        console.log(chalk.gray('Individual responses:'));
        successful.forEach(r => {
          const preview = r.text.slice(0, 100).replace(/\n/g, ' ');
          console.log(`  ${chalk.cyan(r.name)}: ${preview}...`);
        });
        console.log();
      }
      
      // Analysis
      console.log(chalk.gray(`Models: ${successful.length}/${models.length} responded`));
      console.log(chalk.gray(`Avg response time: ${Math.round(responses.reduce((a, b) => a + b.responseTime, 0) / responses.length)}ms`));
    }
    
  } catch (e) {
    spinner.stop();
    error(`Consensus query failed: ${e.message}`);
    process.exit(1);
  }
}
