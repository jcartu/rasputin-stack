#!/usr/bin/env node
// Generate PWA icons from SVG
// Uses Node.js built-ins only - no dependencies

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

// SVG icon design - cyberpunk neural network logo
const SVG_ICON = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#60a5fa;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#a78bfa;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#34d399;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#60a5fa;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Background -->
  <rect width="512" height="512" fill="#0a0a0f" rx="64"/>
  
  <!-- Neural network nodes -->
  <circle cx="256" cy="256" r="48" fill="url(#grad1)" opacity="0.9"/>
  <circle cx="180" cy="180" r="24" fill="url(#grad1)" opacity="0.7"/>
  <circle cx="332" cy="180" r="24" fill="url(#grad1)" opacity="0.7"/>
  <circle cx="180" cy="332" r="24" fill="url(#grad1)" opacity="0.7"/>
  <circle cx="332" cy="332" r="24" fill="url(#grad1)" opacity="0.7"/>
  <circle cx="128" cy="256" r="16" fill="url(#grad2)" opacity="0.6"/>
  <circle cx="384" cy="256" r="16" fill="url(#grad2)" opacity="0.6"/>
  <circle cx="256" cy="128" r="16" fill="url(#grad2)" opacity="0.6"/>
  <circle cx="256" cy="384" r="16" fill="url(#grad2)" opacity="0.6"/>
  
  <!-- Connections -->
  <line x1="256" y1="256" x2="180" y2="180" stroke="url(#grad1)" stroke-width="3" opacity="0.4"/>
  <line x1="256" y1="256" x2="332" y2="180" stroke="url(#grad1)" stroke-width="3" opacity="0.4"/>
  <line x1="256" y1="256" x2="180" y2="332" stroke="url(#grad1)" stroke-width="3" opacity="0.4"/>
  <line x1="256" y1="256" x2="332" y2="332" stroke="url(#grad1)" stroke-width="3" opacity="0.4"/>
  <line x1="256" y1="256" x2="128" y2="256" stroke="url(#grad2)" stroke-width="2" opacity="0.3"/>
  <line x1="256" y1="256" x2="384" y2="256" stroke="url(#grad2)" stroke-width="2" opacity="0.3"/>
  <line x1="256" y1="256" x2="256" y2="128" stroke="url(#grad2)" stroke-width="2" opacity="0.3"/>
  <line x1="256" y1="256" x2="256" y2="384" stroke="url(#grad2)" stroke-width="2" opacity="0.3"/>
  
  <!-- Center glow -->
  <circle cx="256" cy="256" r="64" fill="url(#grad1)" opacity="0.2"/>
  <circle cx="256" cy="256" r="80" fill="none" stroke="url(#grad1)" stroke-width="2" opacity="0.3"/>
  
  <!-- Text -->
  <text x="256" y="440" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="url(#grad1)" text-anchor="middle">NEXUS</text>
</svg>`;

// Write SVG file
const svgPath = path.join(PUBLIC_DIR, 'icon.svg');
fs.writeFileSync(svgPath, SVG_ICON);
console.log('✅ Created icon.svg');

// Try to convert using various tools (ImageMagick, rsvg-convert, or fallback to librsvg)
const methods = [
  // Method 1: ImageMagick (most common)
  (size, output) => {
    try {
      execSync(`convert -background none -resize ${size}x${size} "${svgPath}" "${output}"`, { stdio: 'ignore' });
      return true;
    } catch (_) {
      return false;
    }
  },
  // Method 2: rsvg-convert (librsvg)
  (size, output) => {
    try {
      execSync(`rsvg-convert -w ${size} -h ${size} "${svgPath}" -o "${output}"`, { stdio: 'ignore' });
      return true;
    } catch (_) {
      return false;
    }
  },
  // Method 3: Inkscape
  (size, output) => {
    try {
      execSync(`inkscape -w ${size} -h ${size} "${svgPath}" -o "${output}"`, { stdio: 'ignore' });
      return true;
    } catch (_) {
      return false;
    }
  },
];

// Try each method
let success = false;
for (const method of methods) {
  try {
    method(192, path.join(PUBLIC_DIR, 'icon-192.png'));
    method(512, path.join(PUBLIC_DIR, 'icon-512.png'));
    success = true;
    console.log('✅ Generated icon-192.png and icon-512.png');
    break;
  } catch (_) {
    continue;
  }
}

if (!success) {
  console.log('⚠️  Could not convert SVG to PNG automatically.');
  console.log('   Please install one of: imagemagick, librsvg, or inkscape');
  console.log('   Or manually convert icon.svg to PNG using an online tool:');
  console.log('   - https://cloudconvert.com/svg-to-png');
  console.log('   - https://svgtopng.com/');
  console.log('');
  console.log('   SVG saved at: ' + svgPath);
  console.log('   Generate 192x192 and 512x512 PNG files and save as:');
  console.log('   - ' + path.join(PUBLIC_DIR, 'icon-192.png'));
  console.log('   - ' + path.join(PUBLIC_DIR, 'icon-512.png'));
  process.exit(1);
}

console.log('✅ PWA icons generated successfully!');
