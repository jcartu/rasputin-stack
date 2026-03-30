#!/usr/bin/env node
/**
 * Post-install setup script for ALFIE CLI
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Ensure directories exist
const dirs = [
  join(homedir(), '.openclaw', 'workspace'),
  join(homedir(), '.openclaw', 'sessions'),
];

for (const dir of dirs) {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    } catch (e) {
      // Ignore errors
    }
  }
}

console.log('ALFIE CLI setup complete.');
console.log('Run "alfie --help" to get started.');
