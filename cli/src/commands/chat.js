/**
 * Chat command - Interactive and non-interactive chat with ALFIE
 */

import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import { createSpinner, success, error, info, renderMarkdown } from '../lib/output.js';
import { queryModel, searchMemories } from '../lib/api.js';
import { getConfig } from '../lib/config.js';

/**
 * Create the chat command
 */
export function chatCommand() {
  const cmd = new Command('chat')
    .description('Chat with ALFIE')
    .argument('[message]', 'Message to send (omit for interactive mode)')
    .option('-m, --model <model>', 'Model to use (local-120b, local-20b, or OpenRouter model)', 'local-120b')
    .option('-t, --temperature <temp>', 'Temperature (0.0-1.0)', parseFloat, 0.7)
    .option('--no-context', 'Disable automatic memory context injection')
    .option('--max-tokens <n>', 'Maximum response tokens', parseInt, 2000)
    .option('-s, --system <prompt>', 'System prompt to use')
    .option('-o, --output <format>', 'Output format (text, json, markdown)', 'text')
    .option('--history <file>', 'Load conversation history from file')
    .action(handleChat);
  
  return cmd;
}

/**
 * Handle chat command
 */
async function handleChat(message, options) {
  // Check if we're in a pipe (non-interactive input)
  const isPiped = !process.stdin.isTTY;
  
  if (message) {
    // Single message mode
    await sendSingleMessage(message, options);
  } else if (isPiped) {
    // Read from pipe
    await readFromPipe(options);
  } else {
    // Interactive mode
    await interactiveChat(options);
  }
}

/**
 * Send a single message and get response
 */
async function sendSingleMessage(message, options) {
  const spinner = createSpinner('Thinking...').start();
  
  try {
    // Optionally inject memory context
    let fullPrompt = message;
    if (options.context !== false) {
      try {
        const memories = await searchMemories(message, { limit: 3 });
        if (memories.length > 0) {
          const contextStr = memories
            .map(m => `[${m.payload?.date || 'Unknown'}] ${m.payload?.text || ''}`)
            .join('\n');
          fullPrompt = `Context from memory:\n${contextStr}\n\nUser message: ${message}`;
          spinner.text = 'Thinking (with context)...';
        }
      } catch (e) {
        // Memory search failed, continue without context
      }
    }
    
    if (options.system) {
      fullPrompt = `${options.system}\n\n${fullPrompt}`;
    }
    
    const response = await queryModel(fullPrompt, {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens
    });
    
    spinner.stop();
    
    // Output based on format
    if (options.output === 'json') {
      console.log(JSON.stringify({ message, response }, null, 2));
    } else if (options.output === 'markdown') {
      console.log(renderMarkdown(response));
    } else {
      console.log(response);
    }
  } catch (e) {
    spinner.stop();
    error(`Chat failed: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Read messages from pipe
 */
async function readFromPipe(options) {
  let input = '';
  
  process.stdin.setEncoding('utf8');
  
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  
  if (input.trim()) {
    await sendSingleMessage(input.trim(), options);
  }
}

/**
 * Interactive chat mode
 */
async function interactiveChat(options) {
  const history = [];
  
  console.log(chalk.cyan('\n🤖 ALFIE Interactive Chat'));
  console.log(chalk.gray('Type your message and press Enter. Commands:'));
  console.log(chalk.gray('  /exit, /quit  - Exit chat'));
  console.log(chalk.gray('  /clear        - Clear history'));
  console.log(chalk.gray('  /model <name> - Switch model'));
  console.log(chalk.gray('  /history      - Show conversation history'));
  console.log(chalk.gray('  /save <file>  - Save conversation to file'));
  console.log(chalk.gray('  /help         - Show this help'));
  console.log();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('You: '),
    terminal: true
  });
  
  rl.prompt();
  
  let currentModel = options.model;
  
  rl.on('line', async (line) => {
    const input = line.trim();
    
    if (!input) {
      rl.prompt();
      return;
    }
    
    // Handle commands
    if (input.startsWith('/')) {
      const [cmd, ...args] = input.slice(1).split(' ');
      
      switch (cmd) {
        case 'exit':
        case 'quit':
        case 'q':
          console.log(chalk.cyan('\nGoodbye! 👋'));
          rl.close();
          process.exit(0);
          break;
          
        case 'clear':
          history.length = 0;
          console.log(chalk.gray('History cleared.'));
          break;
          
        case 'model':
          if (args[0]) {
            currentModel = args[0];
            console.log(chalk.gray(`Switched to model: ${currentModel}`));
          } else {
            console.log(chalk.gray(`Current model: ${currentModel}`));
          }
          break;
          
        case 'history':
          if (history.length === 0) {
            console.log(chalk.gray('No conversation history yet.'));
          } else {
            history.forEach((entry, i) => {
              console.log(chalk.green(`[${i + 1}] You: `) + entry.user);
              console.log(chalk.blue(`    ALFIE: `) + entry.assistant.slice(0, 100) + '...');
            });
          }
          break;
          
        case 'save':
          if (args[0]) {
            try {
              const { writeFileSync } = await import('fs');
              const content = history.map(h => 
                `User: ${h.user}\n\nALFIE: ${h.assistant}\n\n---\n`
              ).join('\n');
              writeFileSync(args[0], content);
              success(`Saved to ${args[0]}`);
            } catch (e) {
              error(`Failed to save: ${e.message}`);
            }
          } else {
            info('Usage: /save <filename>');
          }
          break;
          
        case 'help':
        case '?':
          console.log(chalk.gray('Commands:'));
          console.log(chalk.gray('  /exit, /quit  - Exit chat'));
          console.log(chalk.gray('  /clear        - Clear history'));
          console.log(chalk.gray('  /model <name> - Switch model'));
          console.log(chalk.gray('  /history      - Show conversation'));
          console.log(chalk.gray('  /save <file>  - Save conversation'));
          break;
          
        default:
          console.log(chalk.yellow(`Unknown command: /${cmd}`));
      }
      
      rl.prompt();
      return;
    }
    
    // Send message
    const spinner = createSpinner('ALFIE is thinking...').start();
    
    try {
      // Build context from history
      let prompt = input;
      if (history.length > 0 && options.context !== false) {
        const historyContext = history
          .slice(-5) // Last 5 exchanges
          .map(h => `User: ${h.user}\nAssistant: ${h.assistant}`)
          .join('\n\n');
        prompt = `Previous conversation:\n${historyContext}\n\nUser: ${input}`;
      }
      
      // Inject memory context
      if (options.context !== false) {
        try {
          const memories = await searchMemories(input, { limit: 2 });
          if (memories.length > 0) {
            const memoryContext = memories
              .map(m => m.payload?.text || '')
              .filter(Boolean)
              .join('\n');
            prompt = `Relevant memories:\n${memoryContext}\n\n${prompt}`;
          }
        } catch (e) {
          // Continue without memory context
        }
      }
      
      const response = await queryModel(prompt, {
        model: currentModel,
        temperature: options.temperature,
        maxTokens: options.maxTokens
      });
      
      spinner.stop();
      
      // Store in history
      history.push({ user: input, assistant: response });
      
      // Print response
      console.log(chalk.blue('ALFIE: ') + response);
      console.log();
      
    } catch (e) {
      spinner.stop();
      error(`Error: ${e.message}`);
    }
    
    rl.prompt();
  });
  
  rl.on('close', () => {
    process.exit(0);
  });
}
