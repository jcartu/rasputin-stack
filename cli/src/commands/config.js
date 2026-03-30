/**
 * Config command - Manage ALFIE CLI configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner, success, error, header, createTable, confirm } from '../lib/output.js';
import { getConfig, setConfig, resetConfig, getAllConfig } from '../lib/config.js';

/**
 * Create the config command
 */
export function configCommand() {
  const cmd = new Command('config')
    .description('Manage CLI configuration');
  
  // Get config value
  cmd
    .command('get [key]')
    .description('Get config value (all if no key specified)')
    .option('--json', 'Output as JSON')
    .action(getConfigValue);
  
  // Set config value
  cmd
    .command('set <key> <value>')
    .description('Set config value')
    .action(setConfigValue);
  
  // Reset config
  cmd
    .command('reset')
    .description('Reset configuration to defaults')
    .option('-f, --force', 'Skip confirmation')
    .action(resetConfigValue);
  
  // List all config keys
  cmd
    .command('list')
    .alias('ls')
    .description('List all configuration keys and values')
    .option('--show-keys', 'Show API keys (sensitive!)')
    .action(listConfig);
  
  // Edit config interactively
  cmd
    .command('edit')
    .description('Edit configuration interactively')
    .action(editConfig);
  
  return cmd;
}

/**
 * Get config value
 */
async function getConfigValue(key, options) {
  if (!key) {
    // Show all config
    const config = getAllConfig();
    
    // Mask API keys
    const masked = { ...config };
    if (masked.apiKeys) {
      masked.apiKeys = Object.fromEntries(
        Object.entries(masked.apiKeys).map(([k, v]) => [k, v ? '***' : ''])
      );
    }
    
    if (options.json) {
      console.log(JSON.stringify(masked, null, 2));
    } else {
      console.log(chalk.cyan('Current configuration:'));
      console.log(JSON.stringify(masked, null, 2));
    }
    return;
  }
  
  const value = getConfig(key);
  
  if (value === undefined) {
    error(`Config key not found: ${key}`);
    process.exit(1);
  }
  
  if (options.json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    // Mask API keys
    if (key.startsWith('apiKeys.')) {
      console.log(value ? '***' : '(not set)');
    } else if (typeof value === 'object') {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(value);
    }
  }
}

/**
 * Set config value
 */
async function setConfigValue(key, value) {
  // Parse value
  let parsedValue;
  
  try {
    // Try to parse as JSON (for objects/arrays/numbers)
    parsedValue = JSON.parse(value);
  } catch (e) {
    // Keep as string
    parsedValue = value;
  }
  
  // Validate some common keys
  const validations = {
    'chat.temperature': (v) => typeof v === 'number' && v >= 0 && v <= 1,
    'search.defaultLimit': (v) => typeof v === 'number' && v > 0 && v <= 100,
    'search.scoreThreshold': (v) => typeof v === 'number' && v >= 0 && v <= 1,
  };
  
  if (validations[key] && !validations[key](parsedValue)) {
    error(`Invalid value for ${key}`);
    process.exit(1);
  }
  
  setConfig(key, parsedValue);
  success(`Set ${key} = ${JSON.stringify(parsedValue)}`);
}

/**
 * Reset config to defaults
 */
async function resetConfigValue(options) {
  if (!options.force) {
    const confirmed = await confirm('Reset all configuration to defaults?');
    if (!confirmed) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }
  
  resetConfig();
  success('Configuration reset to defaults');
}

/**
 * List all config
 */
async function listConfig(options) {
  const config = getAllConfig();
  
  header('Configuration');
  
  function printConfig(obj, prefix = '') {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        console.log(chalk.bold(`\n${fullKey}:`));
        printConfig(value, fullKey);
      } else {
        // Mask API keys
        let displayValue = value;
        if (fullKey.startsWith('apiKeys.')) {
          displayValue = options.showKeys ? value : (value ? '***' : '(not set)');
        } else if (typeof value === 'object') {
          displayValue = JSON.stringify(value);
        }
        
        console.log(`  ${chalk.cyan(key)}: ${displayValue}`);
      }
    }
  }
  
  printConfig(config);
  
  if (!options.showKeys) {
    console.log(chalk.gray('\nAPI keys masked. Use --show-keys to reveal.'));
  }
}

/**
 * Edit config interactively
 */
async function editConfig() {
  const { default: inquirer } = await import('inquirer');
  
  const config = getAllConfig();
  
  // Build choices from common settings
  const choices = [
    { name: 'Chat model', value: 'chat.model' },
    { name: 'Chat temperature', value: 'chat.temperature' },
    { name: 'Chat max tokens', value: 'chat.maxTokens' },
    { name: 'Search limit', value: 'search.defaultLimit' },
    { name: 'Search threshold', value: 'search.scoreThreshold' },
    { name: 'Workspace path', value: 'workspace' },
    { name: 'OpenRouter API key', value: 'apiKeys.openrouter' },
    { name: 'Perplexity API key', value: 'apiKeys.perplexity' },
    { name: 'Brave API key', value: 'apiKeys.brave' },
    new inquirer.Separator(),
    { name: 'Done', value: 'done' }
  ];
  
  while (true) {
    const { setting } = await inquirer.prompt([{
      type: 'list',
      name: 'setting',
      message: 'Select setting to edit:',
      choices
    }]);
    
    if (setting === 'done') {
      break;
    }
    
    const currentValue = getConfig(setting);
    const isApiKey = setting.startsWith('apiKeys.');
    
    console.log(chalk.gray(`Current: ${isApiKey ? (currentValue ? '***' : '(not set)') : JSON.stringify(currentValue)}`));
    
    const { newValue } = await inquirer.prompt([{
      type: isApiKey ? 'password' : 'input',
      name: 'newValue',
      message: `New value for ${setting}:`,
      default: isApiKey ? '' : (typeof currentValue === 'object' ? JSON.stringify(currentValue) : String(currentValue))
    }]);
    
    if (newValue !== '') {
      let parsed;
      try {
        parsed = JSON.parse(newValue);
      } catch (e) {
        parsed = newValue;
      }
      
      setConfig(setting, parsed);
      success(`Updated ${setting}`);
    }
  }
}
