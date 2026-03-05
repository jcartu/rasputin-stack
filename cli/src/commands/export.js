/**
 * Export command - Export ALFIE data (sessions, memories, configs)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { createSpinner, success, error, header, info } from '../lib/output.js';
import { getConfig, getAllConfig, getWorkspacePath } from '../lib/config.js';
import { searchMemories } from '../lib/api.js';

/**
 * Create the export command
 */
export function exportCommand() {
  const cmd = new Command('export')
    .description('Export ALFIE data');
  
  // Export sessions
  cmd
    .command('sessions [output]')
    .description('Export chat sessions')
    .option('-a, --all', 'Export all sessions')
    .option('-n, --limit <n>', 'Number of sessions to export', parseInt, 10)
    .option('-f, --format <type>', 'Export format (json, markdown)', 'json')
    .option('--since <date>', 'Export sessions since date (YYYY-MM-DD)')
    .action(exportSessions);
  
  // Export memories
  cmd
    .command('memories <query> [output]')
    .description('Export memories matching query')
    .option('-n, --limit <n>', 'Number of memories', parseInt, 100)
    .option('-t, --threshold <n>', 'Minimum score', parseFloat, 0.3)
    .option('-f, --format <type>', 'Export format (json, markdown, csv)', 'json')
    .action(exportMemories);
  
  // Export config
  cmd
    .command('config [output]')
    .description('Export current configuration')
    .option('--include-keys', 'Include API keys (sensitive!)')
    .action(exportConfig);
  
  // Export workspace
  cmd
    .command('workspace [output]')
    .description('Export workspace files')
    .option('--include <glob>', 'Files to include', '*.{py,md,json}')
    .option('--exclude <glob>', 'Files to exclude')
    .action(exportWorkspace);
  
  return cmd;
}

/**
 * Export sessions
 */
async function exportSessions(output, options) {
  const sessionsDir = getConfig('sessions.directory');
  
  if (!existsSync(sessionsDir)) {
    error('No sessions directory found.');
    process.exit(1);
  }
  
  const spinner = createSpinner('Exporting sessions...').start();
  
  try {
    let files = readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    
    // Filter by date if specified
    if (options.since) {
      const sinceDate = new Date(options.since);
      files = files.filter(f => {
        const session = JSON.parse(readFileSync(join(sessionsDir, f), 'utf8'));
        return new Date(session.created_at) >= sinceDate;
      });
    }
    
    // Limit
    if (!options.all) {
      files = files.slice(0, options.limit);
    }
    
    // Load sessions
    const sessions = files.map(f => {
      const content = JSON.parse(readFileSync(join(sessionsDir, f), 'utf8'));
      return { id: f.replace('.json', ''), ...content };
    });
    
    spinner.stop();
    
    // Format output
    let content;
    const outputFile = output || `alfie-sessions-export-${Date.now()}.${options.format === 'markdown' ? 'md' : 'json'}`;
    
    if (options.format === 'markdown') {
      content = sessions.map(s => {
        let md = `# Session: ${s.name || s.id}\n\n`;
        md += `- **Created:** ${s.created_at}\n`;
        md += `- **Model:** ${s.model || 'default'}\n`;
        md += `- **Messages:** ${s.messages?.length || 0}\n\n`;
        
        if (s.messages) {
          md += '## Conversation\n\n';
          s.messages.forEach(msg => {
            md += `**${msg.role === 'user' ? 'You' : 'ALFIE'}:**\n${msg.content}\n\n`;
          });
        }
        
        return md;
      }).join('\n---\n\n');
    } else {
      content = JSON.stringify(sessions, null, 2);
    }
    
    writeFileSync(outputFile, content);
    success(`Exported ${sessions.length} sessions to ${outputFile}`);
    
  } catch (e) {
    spinner.stop();
    error(`Export failed: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Export memories
 */
async function exportMemories(query, output, options) {
  const spinner = createSpinner(`Searching for "${query}"...`).start();
  
  try {
    const memories = await searchMemories(query, {
      limit: options.limit,
      scoreThreshold: options.threshold
    });
    
    if (memories.length === 0) {
      spinner.stop();
      error('No memories found matching query.');
      process.exit(1);
    }
    
    spinner.text = `Exporting ${memories.length} memories...`;
    
    // Format output
    const outputFile = output || `alfie-memories-export-${Date.now()}.${options.format}`;
    let content;
    
    if (options.format === 'markdown') {
      content = `# ALFIE Memories Export\n\n`;
      content += `**Query:** ${query}\n`;
      content += `**Count:** ${memories.length}\n`;
      content += `**Exported:** ${new Date().toISOString()}\n\n---\n\n`;
      
      memories.forEach((m, i) => {
        const p = m.payload || {};
        content += `## Memory ${i + 1}\n\n`;
        content += `- **Date:** ${p.date || 'Unknown'}\n`;
        content += `- **Source:** ${p.source || 'Unknown'}\n`;
        content += `- **Relevance:** ${(m.score * 100).toFixed(1)}%\n\n`;
        content += `${p.text || ''}\n\n---\n\n`;
      });
    } else if (options.format === 'csv') {
      content = 'date,source,score,text\n';
      memories.forEach(m => {
        const p = m.payload || {};
        const text = (p.text || '').replace(/"/g, '""').replace(/\n/g, ' ');
        content += `"${p.date || ''}","${p.source || ''}","${m.score}","${text}"\n`;
      });
    } else {
      content = JSON.stringify({
        query,
        count: memories.length,
        exported_at: new Date().toISOString(),
        memories: memories.map(m => ({
          score: m.score,
          ...m.payload
        }))
      }, null, 2);
    }
    
    spinner.stop();
    
    writeFileSync(outputFile, content);
    success(`Exported ${memories.length} memories to ${outputFile}`);
    
  } catch (e) {
    spinner.stop();
    error(`Export failed: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Export config
 */
async function exportConfig(output, options) {
  const config = getAllConfig();
  
  // Remove API keys unless explicitly requested
  if (!options.includeKeys) {
    const sanitized = { ...config };
    if (sanitized.apiKeys) {
      sanitized.apiKeys = Object.fromEntries(
        Object.entries(sanitized.apiKeys).map(([k, v]) => [k, v ? '***' : ''])
      );
    }
    
    const outputFile = output || 'alfie-config-export.json';
    writeFileSync(outputFile, JSON.stringify(sanitized, null, 2));
    success(`Exported config to ${outputFile}`);
    info('API keys masked. Use --include-keys to include them.');
  } else {
    const outputFile = output || 'alfie-config-export.json';
    writeFileSync(outputFile, JSON.stringify(config, null, 2));
    success(`Exported config to ${outputFile}`);
    console.log(chalk.yellow('Warning: API keys are included!'));
  }
}

/**
 * Export workspace
 */
async function exportWorkspace(output, options) {
  const workspace = getWorkspacePath();
  const spinner = createSpinner('Exporting workspace...').start();
  
  try {
    const files = [];
    
    function scanDir(dir) {
      const entries = readdirSync(dir);
      
      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__') continue;
        
        const fullPath = join(dir, entry);
        const stat = require('fs').statSync(fullPath);
        
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else {
          // Check if matches include pattern
          const exts = options.include.replace('*.{', '').replace('}', '').split(',');
          const ext = entry.split('.').pop();
          
          if (exts.includes(ext)) {
            files.push({
              path: fullPath.replace(workspace + '/', ''),
              content: readFileSync(fullPath, 'utf8')
            });
          }
        }
      }
    }
    
    scanDir(workspace);
    
    spinner.stop();
    
    const outputFile = output || `alfie-workspace-export-${Date.now()}.json`;
    writeFileSync(outputFile, JSON.stringify({
      workspace,
      exported_at: new Date().toISOString(),
      file_count: files.length,
      files
    }, null, 2));
    
    success(`Exported ${files.length} files to ${outputFile}`);
    
  } catch (e) {
    spinner.stop();
    error(`Export failed: ${e.message}`);
    process.exit(1);
  }
}
