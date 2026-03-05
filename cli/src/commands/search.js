/**
 * Search command - Search ALFIE's second brain and memories
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner, success, error, header, printMemory, createTable } from '../lib/output.js';
import { searchMemories, getCollectionStats } from '../lib/api.js';
import { getConfig } from '../lib/config.js';

/**
 * Create the search command
 */
export function searchCommand() {
  const cmd = new Command('search')
    .description('Search ALFIE\'s second brain for memories')
    .argument('<query>', 'Search query')
    .option('-n, --limit <n>', 'Number of results', parseInt, 10)
    .option('-t, --threshold <n>', 'Minimum relevance score (0.0-1.0)', parseFloat, 0.5)
    .option('-c, --collection <name>', 'Qdrant collection to search', 'second_brain')
    .option('-f, --filter <json>', 'JSON filter for payload fields')
    .option('-o, --output <format>', 'Output format (text, json, table)', 'text')
    .option('--stats', 'Show collection statistics instead of searching')
    .action(handleSearch);
  
  return cmd;
}

/**
 * Handle search command
 */
async function handleSearch(query, options) {
  if (options.stats) {
    await showStats(options);
    return;
  }
  
  const spinner = createSpinner(`Searching for "${query}"...`).start();
  
  try {
    const results = await searchMemories(query, {
      limit: options.limit,
      scoreThreshold: options.threshold,
      collection: options.collection
    });
    
    spinner.stop();
    
    if (results.length === 0) {
      console.log(chalk.yellow('No memories found matching your query.'));
      console.log(chalk.gray('Try a different query or lower the threshold with -t 0.3'));
      return;
    }
    
    // Output based on format
    if (options.output === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else if (options.output === 'table') {
      printResultsTable(results);
    } else {
      printResultsText(query, results);
    }
    
  } catch (e) {
    spinner.stop();
    error(`Search failed: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Print results as text
 */
function printResultsText(query, results) {
  header(`Found ${results.length} memories for "${query}"`);
  console.log();
  
  results.forEach((result, index) => {
    printMemory(result, index);
  });
}

/**
 * Print results as table
 */
function printResultsTable(results) {
  const table = createTable(['#', 'Date', 'Source', 'Score', 'Content']);
  
  results.forEach((result, index) => {
    const payload = result.payload || {};
    table.push([
      index + 1,
      payload.date || '-',
      payload.source || '-',
      `${(result.score * 100).toFixed(1)}%`,
      (payload.text || '').slice(0, 60) + '...'
    ]);
  });
  
  console.log(table.toString());
}

/**
 * Show collection statistics
 */
async function showStats(options) {
  const spinner = createSpinner('Getting collection stats...').start();
  
  try {
    const stats = await getCollectionStats(options.collection);
    
    spinner.stop();
    
    header(`Collection: ${options.collection}`);
    
    const table = createTable(['Metric', 'Value']);
    table.push(
      ['Points Count', stats.points_count?.toLocaleString() || 'N/A'],
      ['Vectors Count', stats.vectors_count?.toLocaleString() || 'N/A'],
      ['Indexed Vectors', stats.indexed_vectors_count?.toLocaleString() || 'N/A'],
      ['Status', stats.status || 'N/A'],
      ['Optimizer Status', stats.optimizer_status?.ok ? 'OK' : 'Optimizing']
    );
    
    console.log(table.toString());
    
    if (stats.config) {
      console.log(chalk.gray('\nVector Configuration:'));
      console.log(chalk.gray(`  Size: ${stats.config.params?.vectors?.size || 'N/A'}`));
      console.log(chalk.gray(`  Distance: ${stats.config.params?.vectors?.distance || 'N/A'}`));
    }
    
  } catch (e) {
    spinner.stop();
    error(`Failed to get stats: ${e.message}`);
    process.exit(1);
  }
}
