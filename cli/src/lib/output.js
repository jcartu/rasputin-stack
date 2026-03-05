/**
 * Output formatting utilities
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';

dayjs.extend(relativeTime);

// Configure marked for terminal output
marked.use(markedTerminal({
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  html: chalk.gray,
  heading: chalk.green.bold,
  firstHeading: chalk.magenta.bold,
  hr: chalk.gray,
  listitem: chalk.cyan,
  table: chalk.cyan,
  paragraph: chalk.white,
  strong: chalk.bold,
  em: chalk.italic,
  codespan: chalk.yellow,
  del: chalk.gray.strikethrough,
  link: chalk.blue.underline,
  href: chalk.blue
}));

/**
 * Create a spinner
 */
export function createSpinner(text) {
  return ora({
    text,
    spinner: 'dots',
    color: 'cyan'
  });
}

/**
 * Print success message
 */
export function success(message) {
  console.log(chalk.green('✓') + ' ' + message);
}

/**
 * Print error message
 */
export function error(message) {
  console.error(chalk.red('✗') + ' ' + message);
}

/**
 * Print warning message
 */
export function warning(message) {
  console.log(chalk.yellow('⚠') + ' ' + message);
}

/**
 * Print info message
 */
export function info(message) {
  console.log(chalk.blue('ℹ') + ' ' + message);
}

/**
 * Print a header
 */
export function header(text) {
  console.log('\n' + chalk.bold.cyan(text));
  console.log(chalk.gray('─'.repeat(Math.min(text.length + 4, 60))));
}

/**
 * Print a subheader
 */
export function subheader(text) {
  console.log('\n' + chalk.bold(text));
}

/**
 * Create a table
 */
export function createTable(columns, options = {}) {
  return new Table({
    head: columns.map(c => chalk.cyan(c)),
    style: {
      head: [],
      border: ['gray']
    },
    ...options
  });
}

/**
 * Render markdown
 */
export function renderMarkdown(text) {
  return marked.parse(text);
}

/**
 * Format a date
 */
export function formatDate(date, format = 'YYYY-MM-DD HH:mm') {
  return dayjs(date).format(format);
}

/**
 * Format relative time
 */
export function formatRelative(date) {
  return dayjs(date).fromNow();
}

/**
 * Truncate text
 */
export function truncate(text, maxLength = 80) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Print a memory result
 */
export function printMemory(memory, index = null) {
  const payload = memory.payload || {};
  const score = memory.score || 0;
  
  const prefix = index !== null ? chalk.gray(`[${index + 1}]`) + ' ' : '';
  const dateStr = payload.date ? chalk.blue(`[${payload.date}]`) + ' ' : '';
  const source = payload.source ? chalk.magenta(payload.source) + ' ' : '';
  const chatTitle = payload.chat_title ? chalk.yellow(`"${payload.chat_title}"`) + ' ' : '';
  const sender = payload.sender ? chalk.gray(`- ${payload.sender}`) : '';
  
  console.log(`${prefix}${dateStr}${source}${chatTitle}${sender}`);
  console.log(chalk.white('  ' + truncate(payload.text || '', 200)));
  console.log(chalk.gray(`  Relevance: ${(score * 100).toFixed(1)}%`));
  console.log();
}

/**
 * Print a session summary
 */
export function printSession(session) {
  const table = createTable(['Field', 'Value']);
  table.push(
    ['ID', session.id],
    ['Created', formatDate(session.created_at)],
    ['Updated', formatRelative(session.updated_at)],
    ['Messages', session.message_count],
    ['Model', session.model || 'default']
  );
  console.log(table.toString());
}

/**
 * Print JSON
 */
export function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Ask for confirmation
 */
export async function confirm(message) {
  const { default: inquirer } = await import('inquirer');
  const { confirmed } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirmed',
    message,
    default: false
  }]);
  return confirmed;
}

/**
 * Print a boxed message
 */
export function box(message, title = '') {
  const width = Math.min(message.length + 4, 60);
  const top = '┌' + '─'.repeat(width - 2) + '┐';
  const bottom = '└' + '─'.repeat(width - 2) + '┘';
  
  console.log(chalk.cyan(top));
  if (title) {
    console.log(chalk.cyan('│') + chalk.bold(` ${title.padEnd(width - 3)}`) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + '─'.repeat(width - 2) + chalk.cyan('│'));
  }
  
  // Word wrap the message
  const words = message.split(' ');
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width - 4) {
      console.log(chalk.cyan('│') + ` ${line.padEnd(width - 3)}` + chalk.cyan('│'));
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) {
    console.log(chalk.cyan('│') + ` ${line.padEnd(width - 3)}` + chalk.cyan('│'));
  }
  
  console.log(chalk.cyan(bottom));
}
