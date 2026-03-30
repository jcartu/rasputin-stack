/**
 * Status command - Check ALFIE system status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner, success, error, header, createTable } from '../lib/output.js';
import { checkHealth, getCollectionStats } from '../lib/api.js';
import { getConfig, getAllConfig } from '../lib/config.js';

/**
 * Create the status command
 */
export function statusCommand() {
  const cmd = new Command('status')
    .description('Check ALFIE system status')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Show detailed status')
    .action(handleStatus);
  
  return cmd;
}

/**
 * Handle status command
 */
async function handleStatus(options) {
  const spinner = createSpinner('Checking ALFIE status...').start();
  
  try {
    const health = await checkHealth();
    
    // Get memory stats if second brain is available
    let memoryStats = null;
    if (health.secondBrain) {
      try {
        memoryStats = await getCollectionStats('second_brain');
      } catch (e) {
        // Ignore
      }
    }
    
    spinner.stop();
    
    if (options.json) {
      console.log(JSON.stringify({
        health,
        memoryStats,
        config: options.verbose ? getAllConfig() : undefined
      }, null, 2));
      return;
    }
    
    // Display status
    console.log();
    console.log(chalk.cyan('  ╔═══════════════════════════════════════╗'));
    console.log(chalk.cyan('  ║') + chalk.bold.white('          ALFIE System Status          ') + chalk.cyan('║'));
    console.log(chalk.cyan('  ╚═══════════════════════════════════════╝'));
    console.log();
    
    // Services status
    const statusIcon = (ok) => ok ? chalk.green('●') : chalk.red('●');
    const statusText = (ok) => ok ? chalk.green('Online') : chalk.red('Offline');
    
    console.log(chalk.bold('  Services'));
    console.log(chalk.gray('  ─────────────────────────────────────'));
    console.log(`  ${statusIcon(health.secondBrain)} Second Brain (Qdrant)  ${statusText(health.secondBrain)}`);
    console.log(`  ${statusIcon(health.embedding)} Embedding Service      ${statusText(health.embedding)}`);
    console.log(`  ${statusIcon(health.localModels['120b'])} Local 120B Model       ${statusText(health.localModels['120b'])}`);
    console.log(`  ${statusIcon(health.localModels['20b'])} Local 20B Model        ${statusText(health.localModels['20b'])}`);
    console.log(`  ${statusIcon(health.openrouter)} OpenRouter API Key     ${health.openrouter ? chalk.green('Configured') : chalk.yellow('Not set')}`);
    console.log();
    
    // Memory stats
    if (memoryStats) {
      console.log(chalk.bold('  Second Brain'));
      console.log(chalk.gray('  ─────────────────────────────────────'));
      console.log(`  Memories:   ${chalk.cyan(memoryStats.points_count?.toLocaleString() || 'N/A')}`);
      console.log(`  Vectors:    ${chalk.cyan(memoryStats.vectors_count?.toLocaleString() || 'N/A')}`);
      console.log(`  Status:     ${chalk.green(memoryStats.status || 'OK')}`);
      console.log();
    }
    
    // Config summary
    if (options.verbose) {
      console.log(chalk.bold('  Configuration'));
      console.log(chalk.gray('  ─────────────────────────────────────'));
      console.log(`  Workspace:    ${chalk.gray(getConfig('workspace'))}`);
      console.log(`  Chat Model:   ${chalk.gray(getConfig('chat.model'))}`);
      console.log(`  Temperature:  ${chalk.gray(getConfig('chat.temperature'))}`);
      console.log(`  Search Limit: ${chalk.gray(getConfig('search.defaultLimit'))}`);
      console.log();
    }
    
    // Overall status
    const allServicesUp = health.secondBrain && health.embedding;
    const hasModel = health.localModels['120b'] || health.localModels['20b'] || health.openrouter;
    
    if (allServicesUp && hasModel) {
      console.log(chalk.green('  ✓ ALFIE is fully operational'));
    } else if (hasModel) {
      console.log(chalk.yellow('  ⚠ ALFIE is partially operational (some services offline)'));
    } else {
      console.log(chalk.red('  ✗ ALFIE is not operational (no models available)'));
    }
    
    console.log();
    
  } catch (e) {
    spinner.stop();
    error(`Failed to check status: ${e.message}`);
    process.exit(1);
  }
}
