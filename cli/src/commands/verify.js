/**
 * Verify command - Fact verification using ALFIE's verification system
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { createSpinner, success, error, header, createTable } from '../lib/output.js';
import { getWorkspacePath } from '../lib/config.js';
import { join } from 'path';

/**
 * Create the verify command
 */
export function verifyCommand() {
  const cmd = new Command('verify')
    .description('Verify claims using ALFIE\'s fact-checking system')
    .argument('<claim>', 'Claim to verify')
    .option('-c, --category <type>', 'Verification category (factual, statistical, temporal)', 'factual')
    .option('-s, --sources <json>', 'JSON array of sources to check against')
    .option('-o, --output <format>', 'Output format (text, json)', 'text')
    .option('--threshold <n>', 'Confidence threshold for pass (0-100)', parseFloat, 60)
    .action(handleVerify);
  
  return cmd;
}

/**
 * Handle verify command
 */
async function handleVerify(claim, options) {
  const spinner = createSpinner('Verifying claim...').start();
  
  try {
    // Try to use Python verifier script
    const verifierPath = join(getWorkspacePath(), 'alfie_verify.py');
    
    const args = [verifierPath, claim];
    if (options.category) {
      args.push(options.category);
    }
    
    const result = await new Promise((resolve, reject) => {
      const proc = spawn('python3', args, {
        cwd: getWorkspacePath(),
        timeout: 30000
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => {
        stdout += data;
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data;
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(new Error('Invalid JSON response from verifier'));
          }
        } else {
          reject(new Error(stderr || `Verifier exited with code ${code}`));
        }
      });
      
      proc.on('error', (e) => {
        reject(e);
      });
    });
    
    spinner.stop();
    
    // Output
    if (options.output === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    
    // Pretty print
    header('Verification Result');
    
    console.log(`${chalk.gray('Claim:')} ${claim}`);
    console.log(`${chalk.gray('Category:')} ${result.category || options.category}`);
    console.log();
    
    // Confidence indicator
    const confidence = result.confidence_score;
    const confColor = confidence >= 80 ? chalk.green : confidence >= 60 ? chalk.yellow : chalk.red;
    const confBar = '█'.repeat(Math.round(confidence / 10)) + '░'.repeat(10 - Math.round(confidence / 10));
    
    console.log(`${chalk.bold('Confidence:')} ${confColor(`${confidence.toFixed(0)}%`)} [${confBar}]`);
    console.log(`${chalk.bold('Agreement:')} ${result.agreement_percentage?.toFixed(0) || 'N/A'}%`);
    console.log();
    
    // Verdict
    const passed = confidence >= options.threshold;
    if (passed) {
      console.log(chalk.green('✓ VERIFIED') + chalk.gray(` (meets ${options.threshold}% threshold)`));
    } else {
      console.log(chalk.red('✗ NOT VERIFIED') + chalk.gray(` (below ${options.threshold}% threshold)`));
    }
    console.log();
    
    // Issues
    if (result.issues && result.issues.length > 0) {
      console.log(chalk.bold('Issues Found:'));
      result.issues.forEach(issue => {
        const icon = issue.severity === 'critical' ? chalk.red('⛔') : 
                     issue.severity === 'warning' ? chalk.yellow('⚠') : 
                     chalk.blue('ℹ');
        console.log(`  ${icon} ${issue.message}`);
        if (issue.details) {
          console.log(chalk.gray(`     ${issue.details}`));
        }
      });
      console.log();
    }
    
    // Sources
    if (result.sources && result.sources.length > 0) {
      console.log(chalk.bold('Sources Checked:'));
      result.sources.forEach(source => {
        const credIcon = source.credibility_score >= 80 ? chalk.green('●') :
                        source.credibility_score >= 60 ? chalk.yellow('●') :
                        chalk.red('●');
        console.log(`  ${credIcon} ${source.source_name} (${source.credibility_score}%)`);
      });
      console.log();
    }
    
    // Recommendations
    if (result.recommendations && result.recommendations.length > 0) {
      console.log(chalk.bold('Recommendations:'));
      result.recommendations.forEach(rec => {
        console.log(`  → ${rec}`);
      });
      console.log();
    }
    
    // Action flags
    if (result.should_retry) {
      console.log(chalk.yellow('⚠ Consider re-verification with additional sources'));
    }
    if (result.should_escalate) {
      console.log(chalk.red('⚠ Low confidence - manual review recommended'));
    }
    
  } catch (e) {
    spinner.stop();
    
    // Fallback: simple verification without Python script
    console.log(chalk.yellow('Note: Full verification requires alfie_verify.py'));
    console.log(chalk.gray('Running simplified check...\n'));
    
    // Basic heuristic checks
    const issues = [];
    
    // Check for absolute statements
    if (/\b(always|never|all|every|none|impossible|certain|definitely)\b/i.test(claim)) {
      issues.push({
        severity: 'warning',
        message: 'Claim uses absolute language',
        details: 'Absolute statements are rarely verifiable'
      });
    }
    
    // Check for statistics without context
    if (/\d+%/.test(claim) || /\b\d+(?:,\d{3})+\b/.test(claim)) {
      issues.push({
        severity: 'info',
        message: 'Claim contains statistics',
        details: 'Verify source of numerical data'
      });
    }
    
    // Check for future predictions
    const currentYear = new Date().getFullYear();
    const futureYears = claim.match(/\b(20[3-9]\d)\b/g);
    if (futureYears) {
      issues.push({
        severity: 'warning',
        message: `Claim references future year(s): ${futureYears.join(', ')}`,
        details: 'Future predictions cannot be verified'
      });
    }
    
    header('Simplified Verification');
    console.log(`${chalk.gray('Claim:')} ${claim}`);
    console.log();
    
    if (issues.length === 0) {
      console.log(chalk.green('✓ No obvious issues detected'));
      console.log(chalk.gray('  For full verification, ensure alfie_verify.py is available'));
    } else {
      console.log(chalk.yellow(`Found ${issues.length} potential issue(s):`));
      issues.forEach(issue => {
        const icon = issue.severity === 'warning' ? chalk.yellow('⚠') : chalk.blue('ℹ');
        console.log(`  ${icon} ${issue.message}`);
        if (issue.details) {
          console.log(chalk.gray(`     ${issue.details}`));
        }
      });
    }
    
    console.log(chalk.gray('\nFor comprehensive verification: pip install qdrant-client'));
  }
}
