/**
 * File command - File operations within ALFIE workspace
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, relative } from 'path';
import { createSpinner, success, error, header, createTable, formatDate, truncate } from '../lib/output.js';
import { getConfig, getWorkspacePath } from '../lib/config.js';

/**
 * Create the file command
 */
export function fileCommand() {
  const cmd = new Command('file')
    .alias('f')
    .description('File operations in ALFIE workspace');
  
  // List files
  cmd
    .command('list [path]')
    .alias('ls')
    .description('List files in workspace')
    .option('-a, --all', 'Show hidden files')
    .option('-l, --long', 'Show detailed listing')
    .option('-r, --recursive', 'List recursively')
    .option('--pattern <glob>', 'Filter by glob pattern')
    .action(listFiles);
  
  // Read file
  cmd
    .command('read <path>')
    .alias('cat')
    .description('Read a file')
    .option('-n, --lines <n>', 'Number of lines to show', parseInt)
    .option('--head', 'Show first 20 lines')
    .option('--tail', 'Show last 20 lines')
    .option('-o, --output <format>', 'Output format (text, json)', 'text')
    .action(readFile);
  
  // Write file
  cmd
    .command('write <path>')
    .description('Write to a file')
    .option('-c, --content <text>', 'Content to write')
    .option('-a, --append', 'Append instead of overwrite')
    .option('-f, --force', 'Overwrite without confirmation')
    .action(writeFile);
  
  // Search files
  cmd
    .command('search <pattern>')
    .alias('grep')
    .description('Search for pattern in files')
    .option('-i, --ignore-case', 'Case insensitive search')
    .option('-r, --recursive', 'Search recursively', true)
    .option('-n, --line-numbers', 'Show line numbers', true)
    .option('--include <glob>', 'Include only matching files', '*.{py,js,ts,md,txt}')
    .option('--context <n>', 'Lines of context', parseInt, 0)
    .action(searchFiles);
  
  // File info
  cmd
    .command('info <path>')
    .description('Show file information')
    .action(fileInfo);
  
  return cmd;
}

/**
 * Resolve path relative to workspace
 */
function resolvePath(path) {
  const workspace = getWorkspacePath();
  if (!path) return workspace;
  
  // If absolute path, use it
  if (path.startsWith('/')) {
    return path;
  }
  
  // Otherwise, relative to workspace
  return join(workspace, path);
}

/**
 * List files
 */
async function listFiles(path, options) {
  const targetPath = resolvePath(path);
  
  if (!existsSync(targetPath)) {
    error(`Path not found: ${targetPath}`);
    process.exit(1);
  }
  
  const stat = statSync(targetPath);
  if (!stat.isDirectory()) {
    error(`Not a directory: ${targetPath}`);
    process.exit(1);
  }
  
  try {
    const files = readdirSync(targetPath)
      .filter(f => options.all || !f.startsWith('.'))
      .sort();
    
    if (options.long) {
      const table = createTable(['Name', 'Type', 'Size', 'Modified']);
      
      for (const file of files) {
        const filePath = join(targetPath, file);
        const fileStat = statSync(filePath);
        table.push([
          fileStat.isDirectory() ? chalk.blue(file + '/') : file,
          fileStat.isDirectory() ? 'dir' : 'file',
          formatSize(fileStat.size),
          formatDate(fileStat.mtime)
        ]);
      }
      
      console.log(table.toString());
    } else {
      // Simple listing
      files.forEach(file => {
        const filePath = join(targetPath, file);
        const fileStat = statSync(filePath);
        if (fileStat.isDirectory()) {
          console.log(chalk.blue(file + '/'));
        } else {
          console.log(file);
        }
      });
    }
    
    console.log(chalk.gray(`\n${files.length} items in ${relative(getWorkspacePath(), targetPath) || '.'}`));
    
  } catch (e) {
    error(`Failed to list files: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Read a file
 */
async function readFile(path, options) {
  const targetPath = resolvePath(path);
  
  if (!existsSync(targetPath)) {
    error(`File not found: ${targetPath}`);
    process.exit(1);
  }
  
  try {
    const content = readFileSync(targetPath, 'utf8');
    const lines = content.split('\n');
    
    let outputLines = lines;
    
    if (options.head) {
      outputLines = lines.slice(0, 20);
    } else if (options.tail) {
      outputLines = lines.slice(-20);
    } else if (options.lines) {
      outputLines = lines.slice(0, options.lines);
    }
    
    if (options.output === 'json') {
      console.log(JSON.stringify({
        path: targetPath,
        lines: outputLines.length,
        totalLines: lines.length,
        content: outputLines.join('\n')
      }, null, 2));
    } else {
      console.log(outputLines.join('\n'));
      
      if (outputLines.length < lines.length) {
        console.log(chalk.gray(`\n... (${lines.length - outputLines.length} more lines)`));
      }
    }
    
  } catch (e) {
    error(`Failed to read file: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Write to a file
 */
async function writeFile(path, options) {
  const targetPath = resolvePath(path);
  
  // Check for stdin input
  let content = options.content || '';
  
  if (!content && !process.stdin.isTTY) {
    // Read from stdin
    for await (const chunk of process.stdin) {
      content += chunk;
    }
  }
  
  if (!content) {
    error('No content provided. Use -c or pipe content.');
    process.exit(1);
  }
  
  // Check if file exists
  if (existsSync(targetPath) && !options.force && !options.append) {
    const { confirm } = await import('../lib/output.js');
    const confirmed = await confirm(`Overwrite ${basename(targetPath)}?`);
    if (!confirmed) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }
  
  try {
    if (options.append) {
      const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : '';
      writeFileSync(targetPath, existing + content);
      success(`Appended to ${basename(targetPath)}`);
    } else {
      writeFileSync(targetPath, content);
      success(`Wrote to ${basename(targetPath)}`);
    }
    
    console.log(chalk.gray(`Path: ${targetPath}`));
    
  } catch (e) {
    error(`Failed to write file: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Search files
 */
async function searchFiles(pattern, options) {
  const workspace = getWorkspacePath();
  const spinner = createSpinner('Searching...').start();
  
  const results = [];
  const regex = new RegExp(pattern, options.ignoreCase ? 'gi' : 'g');
  
  function searchDir(dir) {
    const files = readdirSync(dir);
    
    for (const file of files) {
      if (file.startsWith('.')) continue;
      
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      
      if (stat.isDirectory() && options.recursive) {
        searchDir(filePath);
      } else if (stat.isFile()) {
        // Check file extension
        if (options.include) {
          const exts = options.include.replace('*.{', '').replace('}', '').split(',');
          const ext = file.split('.').pop();
          if (!exts.includes(ext)) continue;
        }
        
        try {
          const content = readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          
          lines.forEach((line, i) => {
            if (regex.test(line)) {
              results.push({
                file: relative(workspace, filePath),
                line: i + 1,
                content: line.trim()
              });
            }
          });
        } catch (e) {
          // Skip binary files
        }
      }
    }
  }
  
  try {
    searchDir(workspace);
    spinner.stop();
    
    if (results.length === 0) {
      console.log(chalk.yellow(`No matches found for "${pattern}"`));
      return;
    }
    
    header(`Found ${results.length} matches for "${pattern}"`);
    
    results.slice(0, 50).forEach(r => {
      const lineNum = options.lineNumbers ? chalk.gray(`${r.line}:`) : '';
      console.log(`${chalk.cyan(r.file)}:${lineNum}${truncate(r.content, 100)}`);
    });
    
    if (results.length > 50) {
      console.log(chalk.gray(`\n... and ${results.length - 50} more matches`));
    }
    
  } catch (e) {
    spinner.stop();
    error(`Search failed: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Show file info
 */
async function fileInfo(path) {
  const targetPath = resolvePath(path);
  
  if (!existsSync(targetPath)) {
    error(`File not found: ${targetPath}`);
    process.exit(1);
  }
  
  try {
    const stat = statSync(targetPath);
    
    header(`File: ${basename(targetPath)}`);
    
    const table = createTable(['Property', 'Value']);
    table.push(
      ['Path', targetPath],
      ['Type', stat.isDirectory() ? 'Directory' : 'File'],
      ['Size', formatSize(stat.size)],
      ['Created', formatDate(stat.birthtime)],
      ['Modified', formatDate(stat.mtime)],
      ['Accessed', formatDate(stat.atime)],
      ['Mode', stat.mode.toString(8)]
    );
    
    if (!stat.isDirectory()) {
      const content = readFileSync(targetPath, 'utf8');
      table.push(
        ['Lines', content.split('\n').length.toString()],
        ['Characters', content.length.toString()]
      );
    }
    
    console.log(table.toString());
    
  } catch (e) {
    error(`Failed to get file info: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Format file size
 */
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  
  return `${size.toFixed(unit > 0 ? 1 : 0)} ${units[unit]}`;
}
