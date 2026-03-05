/**
 * Procedure command - Manage ALFIE's procedural memory
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { createSpinner, success, error, header, createTable } from '../lib/output.js';
import { getWorkspacePath } from '../lib/config.js';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

/**
 * Create the procedure command
 */
export function procedureCommand() {
  const cmd = new Command('procedure')
    .alias('proc')
    .description('Manage ALFIE\'s procedural memory');
  
  // List procedures
  cmd
    .command('list')
    .alias('ls')
    .description('List all procedures')
    .option('-t, --tag <tag>', 'Filter by tag')
    .option('-o, --output <format>', 'Output format (text, json, table)', 'table')
    .action(listProcedures);
  
  // Search procedures
  cmd
    .command('search <query>')
    .description('Search procedures by task description')
    .option('-n, --limit <n>', 'Number of results', parseInt, 5)
    .action(searchProcedures);
  
  // Show procedure details
  cmd
    .command('show <id>')
    .description('Show procedure details')
    .option('-o, --output <format>', 'Output format (text, json)', 'text')
    .action(showProcedure);
  
  // Get stats
  cmd
    .command('stats')
    .description('Show procedural memory statistics')
    .action(showStats);
  
  // Create procedure (advanced)
  cmd
    .command('create')
    .description('Create a new procedure interactively')
    .action(createProcedure);
  
  return cmd;
}

/**
 * Load procedures from JSON file
 */
function loadProcedures() {
  const proceduresPath = join(getWorkspacePath(), 'procedures.json');
  
  if (!existsSync(proceduresPath)) {
    return { procedures: {}, pattern_frequency: {} };
  }
  
  try {
    return JSON.parse(readFileSync(proceduresPath, 'utf8'));
  } catch (e) {
    return { procedures: {}, pattern_frequency: {} };
  }
}

/**
 * List procedures
 */
async function listProcedures(options) {
  const data = loadProcedures();
  let procedures = Object.values(data.procedures || {});
  
  // Filter by tag
  if (options.tag) {
    procedures = procedures.filter(p => p.tags?.includes(options.tag));
  }
  
  // Sort by execution count
  procedures.sort((a, b) => (b.metrics?.execution_count || 0) - (a.metrics?.execution_count || 0));
  
  if (procedures.length === 0) {
    console.log(chalk.yellow('No procedures found.'));
    console.log(chalk.gray('Procedures are created through ALFIE\'s learning system.'));
    return;
  }
  
  if (options.output === 'json') {
    console.log(JSON.stringify(procedures, null, 2));
    return;
  }
  
  if (options.output === 'table') {
    header(`Procedures (${procedures.length})`);
    
    const table = createTable(['Name', 'Executions', 'Success Rate', 'Tags']);
    procedures.forEach(p => {
      const metrics = p.metrics || {};
      const successRate = metrics.execution_count > 0 
        ? `${((metrics.success_count || 0) / metrics.execution_count * 100).toFixed(0)}%`
        : 'N/A';
      
      table.push([
        (p.name || 'Unnamed').slice(0, 30),
        metrics.execution_count || 0,
        successRate,
        (p.tags || []).slice(0, 3).join(', ')
      ]);
    });
    
    console.log(table.toString());
  } else {
    header(`Procedures (${procedures.length})`);
    procedures.forEach(p => {
      console.log(`\n${chalk.cyan(p.name || 'Unnamed')} (${p.id?.slice(0, 8)}...)`);
      console.log(chalk.gray(`  ${p.description || 'No description'}`));
      if (p.metrics?.execution_count > 0) {
        console.log(chalk.gray(`  ${p.metrics.execution_count} executions, ${((p.metrics.success_count || 0) / p.metrics.execution_count * 100).toFixed(0)}% success`));
      }
    });
  }
}

/**
 * Search procedures
 */
async function searchProcedures(query, options) {
  const spinner = createSpinner(`Searching for "${query}"...`).start();
  
  try {
    // Try Python script first
    const scriptPath = join(getWorkspacePath(), 'alfie_procedures.py');
    
    const result = await new Promise((resolve, reject) => {
      const proc = spawn('python3', [scriptPath, 'search', query], {
        cwd: getWorkspacePath(),
        timeout: 10000
      });
      
      let output = '';
      proc.stdout.on('data', (data) => { output += data; });
      proc.stderr.on('data', (data) => { output += data; });
      
      proc.on('close', () => resolve(output));
      proc.on('error', () => resolve(null));
    });
    
    spinner.stop();
    
    if (result) {
      console.log(result);
    } else {
      // Fallback: local search
      const data = loadProcedures();
      const procedures = Object.values(data.procedures || {});
      const queryLower = query.toLowerCase();
      
      const matches = procedures
        .map(p => {
          let score = 0;
          if (p.name?.toLowerCase().includes(queryLower)) score += 0.5;
          if (p.description?.toLowerCase().includes(queryLower)) score += 0.3;
          if (p.trigger_conditions?.some(c => c.toLowerCase().includes(queryLower))) score += 0.2;
          return { procedure: p, score };
        })
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, options.limit);
      
      if (matches.length === 0) {
        console.log(chalk.yellow(`No procedures found matching "${query}"`));
        return;
      }
      
      header(`Search Results for "${query}"`);
      matches.forEach((m, i) => {
        const p = m.procedure;
        console.log(`\n${i + 1}. ${chalk.cyan(p.name)} (relevance: ${(m.score * 100).toFixed(0)}%)`);
        console.log(chalk.gray(`   ${p.description || 'No description'}`));
      });
    }
    
  } catch (e) {
    spinner.stop();
    error(`Search failed: ${e.message}`);
  }
}

/**
 * Show procedure details
 */
async function showProcedure(id, options) {
  const data = loadProcedures();
  
  // Find by ID (partial match)
  const procedures = Object.values(data.procedures || {});
  const matches = procedures.filter(p => p.id?.startsWith(id));
  
  if (matches.length === 0) {
    error(`Procedure not found: ${id}`);
    process.exit(1);
  }
  
  if (matches.length > 1) {
    error(`Ambiguous ID. Matches: ${matches.map(p => p.id).join(', ')}`);
    process.exit(1);
  }
  
  const procedure = matches[0];
  
  if (options.output === 'json') {
    console.log(JSON.stringify(procedure, null, 2));
    return;
  }
  
  header(`Procedure: ${procedure.name}`);
  
  const table = createTable(['Field', 'Value']);
  table.push(
    ['ID', procedure.id],
    ['Name', procedure.name || 'Unnamed'],
    ['Description', procedure.description || 'N/A'],
    ['Active', procedure.is_active !== false ? 'Yes' : 'No'],
    ['Tags', (procedure.tags || []).join(', ') || 'None']
  );
  
  const metrics = procedure.metrics || {};
  if (metrics.execution_count > 0) {
    const successRate = (metrics.success_count || 0) / metrics.execution_count * 100;
    table.push(
      ['Executions', metrics.execution_count],
      ['Success Rate', `${successRate.toFixed(1)}%`],
      ['Avg Time', `${(metrics.avg_execution_time_ms || 0).toFixed(0)}ms`],
      ['Last Run', metrics.last_executed_at || 'Never']
    );
  }
  
  console.log(table.toString());
  
  // Steps
  if (procedure.steps && procedure.steps.length > 0) {
    console.log(chalk.bold('\nSteps:'));
    procedure.steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step.action}`);
      if (step.tool) {
        console.log(chalk.gray(`     Tool: ${step.tool}`));
      }
      if (step.expected_outcome) {
        console.log(chalk.gray(`     Expect: ${step.expected_outcome}`));
      }
    });
  }
  
  // Trigger conditions
  if (procedure.trigger_conditions && procedure.trigger_conditions.length > 0) {
    console.log(chalk.bold('\nTrigger Conditions:'));
    procedure.trigger_conditions.forEach(c => {
      console.log(`  • ${c}`);
    });
  }
  
  // Optimizations
  if (procedure.optimizations && procedure.optimizations.length > 0) {
    console.log(chalk.bold('\nLearned Optimizations:'));
    procedure.optimizations.forEach(o => {
      console.log(chalk.green(`  ✓ ${o}`));
    });
  }
}

/**
 * Show stats
 */
async function showStats() {
  const spinner = createSpinner('Loading stats...').start();
  
  try {
    // Try Python script
    const scriptPath = join(getWorkspacePath(), 'alfie_procedures.py');
    
    const result = await new Promise((resolve, reject) => {
      const proc = spawn('python3', [scriptPath, 'stats'], {
        cwd: getWorkspacePath(),
        timeout: 10000
      });
      
      let output = '';
      proc.stdout.on('data', (data) => { output += data; });
      
      proc.on('close', () => resolve(output));
      proc.on('error', () => resolve(null));
    });
    
    spinner.stop();
    
    if (result) {
      console.log(result);
    } else {
      // Fallback: compute locally
      const data = loadProcedures();
      const procedures = Object.values(data.procedures || {});
      
      const totalExec = procedures.reduce((sum, p) => sum + (p.metrics?.execution_count || 0), 0);
      const totalSuccess = procedures.reduce((sum, p) => sum + (p.metrics?.success_count || 0), 0);
      const activeCount = procedures.filter(p => p.is_active !== false).length;
      
      header('Procedural Memory Stats');
      
      const table = createTable(['Metric', 'Value']);
      table.push(
        ['Total Procedures', procedures.length],
        ['Active', activeCount],
        ['Total Executions', totalExec],
        ['Overall Success Rate', totalExec > 0 ? `${(totalSuccess / totalExec * 100).toFixed(1)}%` : 'N/A']
      );
      console.log(table.toString());
      
      // Top patterns
      const patterns = Object.entries(data.pattern_frequency || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      if (patterns.length > 0) {
        console.log(chalk.bold('\nTop Patterns:'));
        patterns.forEach(([pattern, count]) => {
          console.log(`  ${chalk.cyan(pattern)}: ${count} occurrences`);
        });
      }
    }
    
  } catch (e) {
    spinner.stop();
    error(`Failed to get stats: ${e.message}`);
  }
}

/**
 * Create procedure interactively
 */
async function createProcedure() {
  const { default: inquirer } = await import('inquirer');
  
  console.log(chalk.cyan('\nCreate New Procedure'));
  console.log(chalk.gray('Define a reusable procedure for ALFIE to learn.\n'));
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Procedure name:',
      validate: (v) => v.length > 0 || 'Name is required'
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description:'
    },
    {
      type: 'input',
      name: 'tags',
      message: 'Tags (comma-separated):',
      filter: (v) => v.split(',').map(t => t.trim()).filter(Boolean)
    },
    {
      type: 'input',
      name: 'triggers',
      message: 'Trigger conditions (comma-separated):',
      filter: (v) => v.split(',').map(t => t.trim()).filter(Boolean)
    }
  ]);
  
  // Collect steps
  const steps = [];
  let addMore = true;
  
  while (addMore) {
    const step = await inquirer.prompt([
      {
        type: 'input',
        name: 'action',
        message: `Step ${steps.length + 1} action:`,
        validate: (v) => v.length > 0 || 'Action is required'
      },
      {
        type: 'input',
        name: 'tool',
        message: 'Tool to use (optional):'
      },
      {
        type: 'input',
        name: 'expected_outcome',
        message: 'Expected outcome:'
      }
    ]);
    
    steps.push(step);
    
    const { more } = await inquirer.prompt([{
      type: 'confirm',
      name: 'more',
      message: 'Add another step?',
      default: false
    }]);
    
    addMore = more;
  }
  
  // Create procedure via Python script
  const spinner = createSpinner('Creating procedure...').start();
  
  try {
    const procedure = {
      name: answers.name,
      description: answers.description,
      tags: answers.tags,
      trigger_conditions: answers.triggers,
      steps: steps
    };
    
    // For now, just show what would be created
    spinner.stop();
    
    console.log(chalk.green('\nProcedure definition:'));
    console.log(JSON.stringify(procedure, null, 2));
    
    console.log(chalk.yellow('\nNote: To persist, use the Python API:'));
    console.log(chalk.gray('  from alfie_procedures import ProceduralMemory'));
    console.log(chalk.gray('  pm = ProceduralMemory()'));
    console.log(chalk.gray('  pm.create_procedure(name=..., description=..., steps=...)'));
    
  } catch (e) {
    spinner.stop();
    error(`Failed to create procedure: ${e.message}`);
  }
}
