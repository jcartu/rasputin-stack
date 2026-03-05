/**
 * Import command - Import ALFIE data (sessions, configs)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { createSpinner, success, error, info, confirm } from '../lib/output.js';
import { getConfig, setConfig, getAllConfig } from '../lib/config.js';

/**
 * Create the import command
 */
export function importCommand() {
  const cmd = new Command('import')
    .description('Import ALFIE data');
  
  // Import sessions
  cmd
    .command('sessions <file>')
    .description('Import chat sessions from export file')
    .option('-f, --force', 'Overwrite existing sessions')
    .option('--dry-run', 'Preview import without making changes')
    .action(importSessions);
  
  // Import config
  cmd
    .command('config <file>')
    .description('Import configuration')
    .option('-m, --merge', 'Merge with existing config instead of replacing')
    .option('-f, --force', 'Import without confirmation')
    .action(importConfig);
  
  // Import workspace
  cmd
    .command('workspace <file>')
    .description('Import workspace files from export')
    .option('-f, --force', 'Overwrite existing files')
    .option('--dry-run', 'Preview import without making changes')
    .action(importWorkspace);
  
  return cmd;
}

/**
 * Import sessions
 */
async function importSessions(file, options) {
  if (!existsSync(file)) {
    error(`File not found: ${file}`);
    process.exit(1);
  }
  
  const spinner = createSpinner('Reading export file...').start();
  
  try {
    const content = readFileSync(file, 'utf8');
    let sessions;
    
    // Determine format
    if (file.endsWith('.json')) {
      sessions = JSON.parse(content);
      if (!Array.isArray(sessions)) {
        sessions = [sessions];
      }
    } else {
      spinner.stop();
      error('Only JSON format is supported for import');
      process.exit(1);
    }
    
    spinner.text = `Found ${sessions.length} sessions to import`;
    
    const sessionsDir = getConfig('sessions.directory');
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }
    
    let imported = 0;
    let skipped = 0;
    
    for (const session of sessions) {
      const sessionId = session.id || `imported_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const sessionFile = join(sessionsDir, `${sessionId}.json`);
      
      if (existsSync(sessionFile) && !options.force) {
        skipped++;
        continue;
      }
      
      if (!options.dryRun) {
        writeFileSync(sessionFile, JSON.stringify(session, null, 2));
      }
      imported++;
    }
    
    spinner.stop();
    
    if (options.dryRun) {
      info(`Dry run: Would import ${imported} sessions (${skipped} would be skipped)`);
    } else {
      success(`Imported ${imported} sessions`);
      if (skipped > 0) {
        info(`Skipped ${skipped} existing sessions (use -f to overwrite)`);
      }
    }
    
  } catch (e) {
    spinner.stop();
    error(`Import failed: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Import config
 */
async function importConfig(file, options) {
  if (!existsSync(file)) {
    error(`File not found: ${file}`);
    process.exit(1);
  }
  
  try {
    const newConfig = JSON.parse(readFileSync(file, 'utf8'));
    
    // Show what will change
    console.log(chalk.cyan('\nConfiguration to import:'));
    console.log(JSON.stringify(newConfig, null, 2));
    
    if (!options.force) {
      const confirmed = await confirm('\nApply this configuration?');
      if (!confirmed) {
        console.log(chalk.gray('Cancelled.'));
        return;
      }
    }
    
    if (options.merge) {
      // Merge with existing
      const current = getAllConfig();
      
      function deepMerge(target, source) {
        for (const key of Object.keys(source)) {
          if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            target[key] = target[key] || {};
            deepMerge(target[key], source[key]);
          } else {
            target[key] = source[key];
          }
        }
        return target;
      }
      
      const merged = deepMerge({ ...current }, newConfig);
      
      for (const [key, value] of Object.entries(merged)) {
        setConfig(key, value);
      }
      
      success('Configuration merged');
    } else {
      // Replace
      for (const [key, value] of Object.entries(newConfig)) {
        setConfig(key, value);
      }
      success('Configuration replaced');
    }
    
  } catch (e) {
    error(`Import failed: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Import workspace
 */
async function importWorkspace(file, options) {
  if (!existsSync(file)) {
    error(`File not found: ${file}`);
    process.exit(1);
  }
  
  const spinner = createSpinner('Reading export file...').start();
  
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    
    if (!data.files || !Array.isArray(data.files)) {
      spinner.stop();
      error('Invalid workspace export file');
      process.exit(1);
    }
    
    spinner.text = `Found ${data.files.length} files to import`;
    
    const workspace = getConfig('workspace');
    let imported = 0;
    let skipped = 0;
    
    for (const fileData of data.files) {
      const targetPath = join(workspace, fileData.path);
      const targetDir = require('path').dirname(targetPath);
      
      if (!existsSync(targetDir)) {
        if (!options.dryRun) {
          mkdirSync(targetDir, { recursive: true });
        }
      }
      
      if (existsSync(targetPath) && !options.force) {
        skipped++;
        continue;
      }
      
      if (!options.dryRun) {
        writeFileSync(targetPath, fileData.content);
      }
      imported++;
    }
    
    spinner.stop();
    
    if (options.dryRun) {
      info(`Dry run: Would import ${imported} files (${skipped} would be skipped)`);
    } else {
      success(`Imported ${imported} files`);
      if (skipped > 0) {
        info(`Skipped ${skipped} existing files (use -f to overwrite)`);
      }
    }
    
  } catch (e) {
    spinner.stop();
    error(`Import failed: ${e.message}`);
    process.exit(1);
  }
}
