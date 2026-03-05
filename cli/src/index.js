#!/usr/bin/env node
/**
 * ALFIE CLI - Command-line interface for ALFIE AI assistant
 * 
 * Like GitHub's gh CLI but for ALFIE - interact with your AI assistant,
 * manage sessions, search memories, and more.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Commands
import { chatCommand } from './commands/chat.js';
import { searchCommand } from './commands/search.js';
import { sessionCommand } from './commands/session.js';
import { fileCommand } from './commands/file.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';
import { configCommand } from './commands/config.js';
import { completionCommand } from './commands/completion.js';
import { statusCommand } from './commands/status.js';
import { consensusCommand } from './commands/consensus.js';
import { verifyCommand } from './commands/verify.js';
import { procedureCommand } from './commands/procedure.js';

// Get package.json for version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

// Create main program
const program = new Command();

program
  .name('nexus')
  .description(chalk.cyan('ALFIE CLI') + ' - Your AI assistant in the terminal\n\n' +
    'Commands for interacting with ALFIE: chat, search memories,\n' +
    'manage sessions, run consensus queries, and more.')
  .version(pkg.version, '-v, --version', 'Show version number')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('--no-color', 'Disable colored output')
  .option('-c, --config <path>', 'Path to config file')
  .hook('preAction', (thisCommand) => {
    // Global setup before any command
    if (thisCommand.opts().noColor) {
      chalk.level = 0;
    }
  });

// Register commands
program.addCommand(chatCommand());
program.addCommand(searchCommand());
program.addCommand(sessionCommand());
program.addCommand(fileCommand());
program.addCommand(exportCommand());
program.addCommand(importCommand());
program.addCommand(configCommand());
program.addCommand(completionCommand());
program.addCommand(statusCommand());
program.addCommand(consensusCommand());
program.addCommand(verifyCommand());
program.addCommand(procedureCommand());

// Default action (no command specified)
program
  .action(() => {
    program.help();
  });

// Custom help formatting
program.configureHelp({
  sortSubcommands: true,
  subcommandTerm: (cmd) => cmd.name() + (cmd.alias() ? '|' + cmd.alias() : ''),
});

// Add examples to help
program.addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.gray('# Start interactive chat')}
  $ alfie chat

  ${chalk.gray('# Send a quick message')}
  $ alfie chat "What time is it in Tokyo?"

  ${chalk.gray('# Search memories')}
  $ alfie search "meeting with Eric"

  ${chalk.gray('# Get multi-model consensus')}
  $ alfie consensus "Is quantum computing practical today?"

  ${chalk.gray('# List recent sessions')}
  $ alfie session list

  ${chalk.gray('# Check ALFIE status')}
  $ alfie status

${chalk.bold('Learn more:')}
  Use 'alfie <command> --help' for detailed information about a command.
  
  Documentation: ${chalk.blue('https://github.com/alfie-ai/alfie-cli')}
`);

// Parse arguments
program.parse();
