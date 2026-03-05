#!/usr/bin/env node
/**
 * ALFIE Dashboard Page Fixer
 * Updates all sub-pages to use shared CSS/nav and fix fetch credentials
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = '/home/admin/.openclaw/workspace/alfie-dashboard/public';

const PAGES_TO_FIX = [
  'execute.html',
  'research.html',
  'playground.html',
  'replay.html',
  'agents.html',
  'knowledge.html',
  'templates.html',
  'council.html',
  'remote.html'
];

function fixPage(filename) {
  const filepath = path.join(PUBLIC_DIR, filename);
  let content = fs.readFileSync(filepath, 'utf8');

  console.log(`\n🔧 Fixing ${filename}...`);

  // 1. Add shared CSS and nav if not present
  if (!content.includes('shared-styles.css')) {
    console.log(`  ✓ Adding shared-styles.css`);
    content = content.replace(
      /<head>/i,
      `<head>\n<link rel="stylesheet" href="/shared-styles.css">\n<script src="/shared-nav.js"></script>`
    );
  }

  // 2. Replace hardcoded topbar with placeholder
  // Find all nav bar variations and replace with <div id="topbar"></div>
  const navPatterns = [
    // Standard pattern
    /<div class="(topbar|header)"[^>]*>[\s\S]*?<\/div>\s*(?=<div class="(main|container|page|layout|grid))/i,
    // Alternative pattern with more specific matching
    /<div class="(topbar|header)"[^>]*>(?:(?!<div class="main|<div class="container|<div class="page|<div class="grid|<div class="sidebar|<div class="layout).)*?<\/div>/is
  ];

  let navReplaced = false;
  for (const pattern of navPatterns) {
    if (pattern.test(content)) {
      content = content.replace(pattern, '<div id="topbar"></div>\n');
      console.log(`  ✓ Replaced hardcoded navigation`);
      navReplaced = true;
      break;
    }
  }

  if (!navReplaced) {
    console.log(`  ⚠ Warning: Could not automatically replace nav (might need manual fix)`);
  }

  // 3. Fix all fetch() calls to include credentials: 'include'
  let fetchCount = 0;
  content = content.replace(
    /fetch\s*\(\s*([^,\)]+)\s*,\s*\{([^}]*)\}\s*\)/g,
    (match, url, options) => {
      // Skip if already has credentials
      if (options.includes('credentials')) {
        return match;
      }
      fetchCount++;
      // Add credentials: 'include' before the closing brace
      return `fetch(${url}, {${options}, credentials: 'include'})`;
    }
  );

  // Also fix fetch calls without options object
  content = content.replace(
    /fetch\s*\(\s*([^,\)]+)\s*\)/g,
    (match, url) => {
      // Skip if it's part of a larger expression
      if (match.includes('credentials')) {
        return match;
      }
      fetchCount++;
      return `fetch(${url}, { credentials: 'include' })`;
    }
  );

  if (fetchCount > 0) {
    console.log(`  ✓ Fixed ${fetchCount} fetch() calls to include credentials`);
  }

  // Write back
  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`  ✅ ${filename} updated successfully`);
}

console.log('🚀 ALFIE Dashboard Comprehensive Fixer\n');
console.log(`Fixing ${PAGES_TO_FIX.length} pages...`);

for (const page of PAGES_TO_FIX) {
  try {
    fixPage(page);
  } catch (err) {
    console.error(`  ❌ Error fixing ${page}:`, err.message);
  }
}

console.log('\n✨ All pages fixed!\n');
console.log('Next steps:');
console.log('  1. Test each page manually');
console.log('  2. Check browser console for errors');
console.log('  3. Verify auth cookies are sent with API calls');
console.log('  4. pm2 restart alfie-nexus\n');
