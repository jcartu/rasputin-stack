#!/usr/bin/env node
// Performance optimization injector for index.html
// Adds GPU acceleration, lazy loading, visibility handling, and performance mode

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
const html = fs.readFileSync(INDEX_PATH, 'utf8');

// Check if already optimized
if (html.includes('/* PERFORMANCE OPTIMIZATIONS */')) {
  console.log('⏭️  index.html already has performance optimizations');
  process.exit(0);
}

// CSS Performance Optimizations (GPU acceleration + containment)
const perfCSS = `
/* PERFORMANCE OPTIMIZATIONS */

/* GPU-accelerated CSS for animated elements */
.card,
.stat-value,
.cost-display,
.token-display,
.latency-value,
.progress-bar,
.btn,
.nav-item,
.agent-card,
.tool-call,
.message-bubble {
  will-change: transform;
  transform: translateZ(0);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  perspective: 1000px;
}

/* CSS Containment for better paint performance */
.card,
.section,
.panel,
.agent-card,
.message-bubble {
  contain: layout style paint;
}

/* Disable transforms on low-end devices */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    will-change: auto !important;
    transform: none !important;
  }
}

/* Performance mode: minimal animations */
body.perf-mode .aurora-bg,
body.perf-mode #particle-canvas {
  display: none !important;
}

body.perf-mode * {
  animation: none !important;
  transition: opacity 0.15s ease, transform 0.15s ease !important;
}

body.perf-mode .card {
  backdrop-filter: none !important;
  background: var(--elevated) !important;
}
`;

// JavaScript Performance Optimizations
const perfJS = `
// ─── PERFORMANCE OPTIMIZATIONS ────────────────────────────────────────────────

// Check for performance mode preference
const PERF_MODE_KEY = 'alfie-perf-mode';
const PERF_LITE_PARAM = new URLSearchParams(window.location.search).has('perf');

let perfMode = localStorage.getItem(PERF_MODE_KEY) === 'true' || PERF_LITE_PARAM;

if (perfMode) {
  document.body.classList.add('perf-mode');
  console.log('🚀 Performance mode enabled');
}

// Toggle performance mode
function togglePerfMode() {
  perfMode = !perfMode;
  localStorage.setItem(PERF_MODE_KEY, perfMode);
  document.body.classList.toggle('perf-mode', perfMode);
  
  if (perfMode) {
    // Destroy Three.js scene if active
    if (window.particleScene) {
      window.particleScene.destroy();
      console.log('🚀 Performance mode: WebGL disabled');
    }
  } else {
    // Reload to reinitialize Three.js
    window.location.reload();
  }
  
  showNotification(perfMode ? 'Performance mode enabled' : 'Performance mode disabled', 2000);
}

// Add performance mode toggle to UI (insert after load)
window.addEventListener('load', () => {
  const nav = document.querySelector('.top-bar nav');
  if (nav) {
    const perfBtn = document.createElement('button');
    perfBtn.className = 'nav-item';
    perfBtn.innerHTML = perfMode ? '⚡ Perf' : '🎨 Full';
    perfBtn.title = 'Toggle performance mode';
    perfBtn.onclick = togglePerfMode;
    perfBtn.style.cssText = 'font-size: 0.75rem; padding: 4px 8px; opacity: 0.7;';
    nav.appendChild(perfBtn);
  }
});

// Lazy-load Three.js particle system
const originalInitParticles = window.initParticlesOriginal || (() => {});

function initParticlesLazy() {
  // Skip if performance mode or mobile/low-end device
  if (perfMode || PERF_LITE_PARAM) {
    console.log('⏩ Skipping WebGL (performance mode)');
    return;
  }
  
  // Skip on mobile or low-end devices
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
  
  if (isMobile || isLowEnd) {
    console.log('⏩ Skipping WebGL (low-end device)');
    return;
  }
  
  // Use Intersection Observer to lazy-load when canvas is visible
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      observer.disconnect();
      
      // Use requestIdleCallback for non-blocking init
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          console.log('🎨 Initializing WebGL particles (idle callback)');
          originalInitParticles();
        }, { timeout: 2000 });
      } else {
        setTimeout(() => {
          console.log('🎨 Initializing WebGL particles (timeout)');
          originalInitParticles();
        }, 100);
      }
    }
  });
  
  observer.observe(canvas);
}

// Tab visibility: pause animations when hidden
let isPageVisible = !document.hidden;
let rafHandle = null;

document.addEventListener('visibilitychange', () => {
  isPageVisible = !document.hidden;
  
  if (isPageVisible) {
    console.log('👁️ Tab visible: resuming animations');
    
    // Resume GSAP timelines
    if (window.gsap) {
      window.gsap.globalTimeline.timeScale(1);
    }
    
    // Resume Three.js animation
    if (window.particleScene && window.particleScene.resume) {
      window.particleScene.resume();
    }
  } else {
    console.log('🙈 Tab hidden: pausing animations');
    
    // Pause GSAP timelines
    if (window.gsap) {
      window.gsap.globalTimeline.timeScale(0);
    }
    
    // Pause Three.js animation
    if (window.particleScene && window.particleScene.pause) {
      window.particleScene.pause();
    }
  }
});

// Wrap Three.js animation loop to respect visibility
const originalRAF = window.requestAnimationFrame;
window.requestAnimationFrame = function(callback) {
  if (!isPageVisible) {
    // Skip animation frames when tab is hidden
    return rafHandle = setTimeout(() => callback(Date.now()), 1000);
  }
  return originalRAF.call(window, callback);
};

console.log('✅ Performance optimizations loaded');
`;

// Find insertion points
const styleEndIndex = html.indexOf('</style>');
const scriptEndIndex = html.lastIndexOf('</script>');

if (styleEndIndex === -1 || scriptEndIndex === -1) {
  console.error('❌ Could not find insertion points in index.html');
  process.exit(1);
}

// Inject CSS optimizations
let optimized = html.slice(0, styleEndIndex) + perfCSS + html.slice(styleEndIndex);

// Inject JS optimizations
const insertAt = optimized.lastIndexOf('</script>');
optimized = optimized.slice(0, insertAt) + '\n<script>\n' + perfJS + '\n</script>\n' + optimized.slice(insertAt);

// Modify Three.js initialization to be lazy-loaded
optimized = optimized.replace(
  '(function initParticles() {',
  'window.initParticlesOriginal = function() {'
);

optimized = optimized.replace(
  'animate();',
  'animate();\n  window.particleScene = { pause: () => cancelAnimationFrame(rafHandle), resume: () => animate(), destroy: () => { cancelAnimationFrame(rafHandle); renderer.dispose(); } };'
);

// Add call to lazy loader
optimized = optimized.replace(
  'window.initParticlesOriginal',
  'initParticlesLazy();\n\nwindow.initParticlesOriginal'
);

// Write back
fs.writeFileSync(INDEX_PATH, optimized);

console.log('✅ Performance optimizations injected into index.html');
console.log('   - GPU-accelerated CSS (will-change, translateZ)');
console.log('   - CSS containment for better paint performance');
console.log('   - Lazy-loaded Three.js WebGL (requestIdleCallback)');
console.log('   - Tab visibility handling (pause/resume animations)');
console.log('   - Performance mode toggle (?perf=lite or localStorage)');
console.log('   - Mobile/low-end device detection');
