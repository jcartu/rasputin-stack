/**
 * Session command - Manage ALFIE chat sessions
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createSpinner, success, error, header, createTable, formatDate, formatRelative, confirm } from '../lib/output.js';
import { getConfig } from '../lib/config.js';

/**
 * Create the session command
 */
export function sessionCommand() {
  const cmd = new Command('session')
    .alias('s')
    .description('Manage chat sessions');
  
  // List sessions
  cmd
    .command('list')
    .alias('ls')
    .description('List all sessions')
    .option('-n, --limit <n>', 'Number of sessions to show', parseInt, 20)
    .option('--all', 'Show all sessions')
    .option('-o, --output <format>', 'Output format (text, json, table)', 'table')
    .action(listSessions);
  
  // Show session details
  cmd
    .command('show <id>')
    .description('Show session details')
    .option('--messages', 'Include all messages')
    .option('-o, --output <format>', 'Output format (text, json)', 'text')
    .action(showSession);
  
  // Delete session
  cmd
    .command('delete <id>')
    .alias('rm')
    .description('Delete a session')
    .option('-f, --force', 'Skip confirmation')
    .action(deleteSession);
  
  // Create new session
  cmd
    .command('new')
    .description('Create a new session')
    .option('-n, --name <name>', 'Session name')
    .option('-m, --model <model>', 'Model to use')
    .action(newSession);
  
  // Resume session
  cmd
    .command('resume <id>')
    .description('Resume a previous session in chat')
    .action(resumeSession);
  
  return cmd;
}

/**
 * Get sessions directory
 */
function getSessionsDir() {
  const dir = getConfig('sessions.directory');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * List all sessions
 */
async function listSessions(options) {
  const sessionsDir = getSessionsDir();
  
  try {
    const files = readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      console.log(chalk.yellow('No sessions found.'));
      console.log(chalk.gray('Start a new chat with: alfie chat'));
      return;
    }
    
    // Load session metadata
    const sessions = [];
    const limit = options.all ? files.length : options.limit;
    
    for (const file of files.slice(0, limit)) {
      try {
        const content = JSON.parse(readFileSync(join(sessionsDir, file), 'utf8'));
        sessions.push({
          id: file.replace('.json', ''),
          name: content.name || 'Unnamed',
          created_at: content.created_at || 'Unknown',
          updated_at: content.updated_at || content.created_at || 'Unknown',
          message_count: content.messages?.length || 0,
          model: content.model || 'default'
        });
      } catch (e) {
        // Skip invalid sessions
      }
    }
    
    // Output
    if (options.output === 'json') {
      console.log(JSON.stringify(sessions, null, 2));
    } else if (options.output === 'table') {
      header(`Sessions (${sessions.length}${files.length > limit ? ` of ${files.length}` : ''})`);
      
      const table = createTable(['ID', 'Name', 'Messages', 'Updated', 'Model']);
      sessions.forEach(s => {
        table.push([
          s.id.slice(0, 12) + '...',
          (s.name || 'Unnamed').slice(0, 20),
          s.message_count,
          formatRelative(s.updated_at),
          s.model
        ]);
      });
      console.log(table.toString());
      
      if (files.length > limit) {
        console.log(chalk.gray(`\nShowing ${limit} of ${files.length}. Use --all to see all.`));
      }
    } else {
      header(`Sessions (${sessions.length})`);
      sessions.forEach(s => {
        console.log(`${chalk.cyan(s.id)} - ${s.name}`);
        console.log(chalk.gray(`  ${s.message_count} messages, updated ${formatRelative(s.updated_at)}`));
      });
    }
    
  } catch (e) {
    error(`Failed to list sessions: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Show session details
 */
async function showSession(id, options) {
  const sessionsDir = getSessionsDir();
  
  // Find session (allow partial ID match)
  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  const matching = files.filter(f => f.startsWith(id));
  
  if (matching.length === 0) {
    error(`Session not found: ${id}`);
    process.exit(1);
  }
  
  if (matching.length > 1) {
    error(`Ambiguous session ID. Matches: ${matching.map(m => m.replace('.json', '')).join(', ')}`);
    process.exit(1);
  }
  
  const sessionFile = join(sessionsDir, matching[0]);
  
  try {
    const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
    
    if (options.output === 'json') {
      console.log(JSON.stringify(session, null, 2));
      return;
    }
    
    header(`Session: ${session.name || matching[0].replace('.json', '')}`);
    
    const table = createTable(['Field', 'Value']);
    table.push(
      ['ID', matching[0].replace('.json', '')],
      ['Name', session.name || 'Unnamed'],
      ['Model', session.model || 'default'],
      ['Created', formatDate(session.created_at)],
      ['Updated', formatDate(session.updated_at)],
      ['Messages', session.messages?.length || 0]
    );
    console.log(table.toString());
    
    if (options.messages && session.messages) {
      console.log(chalk.bold('\nMessages:'));
      console.log(chalk.gray('─'.repeat(60)));
      
      session.messages.forEach((msg, i) => {
        const role = msg.role === 'user' ? chalk.green('You') : chalk.blue('ALFIE');
        console.log(`\n${role}: ${msg.content.slice(0, 500)}${msg.content.length > 500 ? '...' : ''}`);
      });
    }
    
  } catch (e) {
    error(`Failed to read session: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Delete a session
 */
async function deleteSession(id, options) {
  const sessionsDir = getSessionsDir();
  
  // Find session
  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  const matching = files.filter(f => f.startsWith(id));
  
  if (matching.length === 0) {
    error(`Session not found: ${id}`);
    process.exit(1);
  }
  
  if (matching.length > 1) {
    error(`Ambiguous session ID. Matches: ${matching.map(m => m.replace('.json', '')).join(', ')}`);
    process.exit(1);
  }
  
  const sessionFile = join(sessionsDir, matching[0]);
  const sessionId = matching[0].replace('.json', '');
  
  if (!options.force) {
    const confirmed = await confirm(`Delete session ${sessionId}?`);
    if (!confirmed) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }
  
  try {
    const { unlinkSync } = await import('fs');
    unlinkSync(sessionFile);
    success(`Deleted session: ${sessionId}`);
  } catch (e) {
    error(`Failed to delete session: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Create a new session
 */
async function newSession(options) {
  const sessionsDir = getSessionsDir();
  const id = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const session = {
    id,
    name: options.name || `Session ${new Date().toLocaleDateString()}`,
    model: options.model || getConfig('chat.model'),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: []
  };
  
  try {
    writeFileSync(join(sessionsDir, `${id}.json`), JSON.stringify(session, null, 2));
    success(`Created session: ${id}`);
    
    if (options.name) {
      console.log(chalk.gray(`Name: ${options.name}`));
    }
    
    console.log(chalk.gray(`Resume with: alfie session resume ${id}`));
  } catch (e) {
    error(`Failed to create session: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Resume a session
 */
async function resumeSession(id) {
  const sessionsDir = getSessionsDir();
  
  // Find session
  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  const matching = files.filter(f => f.startsWith(id));
  
  if (matching.length === 0) {
    error(`Session not found: ${id}`);
    process.exit(1);
  }
  
  const sessionId = matching[0].replace('.json', '');
  
  console.log(chalk.cyan(`Resuming session: ${sessionId}`));
  console.log(chalk.gray('Launching chat with history...\n'));
  
  // Import and run chat with this session
  const { chatCommand } = await import('./chat.js');
  // For now, just inform the user - full session resume requires chat refactor
  console.log(chalk.yellow('Note: Full session resume coming soon.'));
  console.log(chalk.gray(`For now, use: alfie chat --history ${join(sessionsDir, matching[0])}`));
}
