/* ═══════════════════════════════════════════════════════════════════
   RASPUTIN NEXUS SHARED NAVIGATION v2
   Injects navigation links into existing topbar elements.
   Does NOT replace or destroy page-specific topbar layouts.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const NAV_PAGES = [
    {
      path: '/',
      icon: '📊',
      label: 'Dashboard',
      tip: 'Main control center with GPU monitoring, chat, and system metrics',
    },
    {
      path: '/browser.html',
      icon: '🌐',
      label: 'Browser',
      tip: 'Control a headless browser — navigate, click, screenshot any website',
    },
    {
      path: '/execute.html',
      icon: '⚡',
      label: 'Execute',
      tip: 'Run Python, JavaScript or Bash in a sandboxed Docker container',
    },
    {
      path: '/research.html',
      icon: '🔬',
      label: 'Research',
      tip: 'Deep research powered by Perplexity — auto-generates queries, fetches, synthesizes',
    },
    {
      path: '/budget.html',
      icon: '💰',
      label: 'Budget',
      tip: 'Real-time cost tracking with predictive budget alerts and spending forecasts',
    },
    {
      path: '/latency.html',
      icon: '⚡',
      label: 'Latency',
      tip: 'Production observability — P50/P95/P99, TTFT, GPU correlation, histogram',
    },
    {
      path: '/errors.html',
      icon: '🚨',
      label: 'Errors',
      tip: 'Error analytics dashboard — aggregation, trends, insights, debugging',
    },
    {
      path: '/loop-detector.html',
      icon: '🔁',
      label: 'Loop Detector',
      tip: 'Recursive loop detection — auto-kill stuck agents, runaway processes, reasoning loops (NOVEL!)',
    },
    {
      path: '/recipes.html',
      icon: '📝',
      label: 'Recipes',
      tip: 'Save successful sessions as reusable templates — codify tribal knowledge (NOVEL!)',
    },
    {
      path: '/autopsy.html',
      icon: '🔬',
      label: 'Autopsy',
      tip: 'Automatic post-session analysis — insights, optimizations, cost breakdown (NOVEL!)',
    },
    {
      path: '/reports.html',
      icon: '📋',
      label: 'Reports',
      tip: 'Session reports index — full analysis, insights, and shareable links (NOVEL!)',
    },
    {
      path: '/playground.html',
      icon: '🎯',
      label: 'Playground',
      tip: 'Test prompts against multiple AI models side-by-side with timing',
    },
    {
      path: '/council.html',
      icon: '🏛️',
      label: 'Council',
      tip: 'Multi-model AI debate — 16 models across 4 tiers reach consensus',
    },
    {
      path: '/replay.html',
      icon: '🔄',
      label: 'Full Replay',
      tip: 'Step through past agent sessions frame-by-frame with playback controls',
    },
    {
      path: '/gpu-replay.html',
      icon: '🎮',
      label: 'GPU Replay',
      tip: 'UNIQUE: Visual GPU utilization during session replay — correlate agent actions with hardware load (NOBODY ELSE HAS THIS!)',
    },
    {
      path: '/agents.html',
      icon: '🤖',
      label: 'Agents',
      tip: 'Monitor and spawn sub-agents — see active sessions, transcripts, status',
    },
    {
      path: '/knowledge.html',
      icon: '📚',
      label: 'Knowledge',
      tip: 'Browse workspace files with markdown rendering and search',
    },
    {
      path: '/memory.html',
      icon: '🧠',
      label: 'Memory',
      tip: 'Second brain heatmap — 446K memories, usage patterns, clusters, churn',
    },
    {
      path: '/memory-heatmap.html',
      icon: '🔥',
      label: 'Access Heatmap',
      tip: 'NOVEL: Track which memories are accessed most — hot/cold visualization, temporal patterns, live feed',
    },
    {
      path: '/templates.html',
      icon: '📋',
      label: 'Templates',
      tip: 'One-click workflow templates — Deep Research, Build & Test, Data Analysis',
    },
    {
      path: '/remote.html',
      icon: '🖥️',
      label: 'Remote',
      tip: 'Manage remote devices via MeshCentral — run commands, screenshots, file transfer',
    },
    {
      path: '/manus.html',
      icon: '⌨',
      label: 'Manus',
      tip: 'Cyberpunk control interface — terminal, neural viz, system metrics, real-time monitoring',
    },
  ];

  function getCurrentPage() {
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') return '/';
    return path;
  }

  function injectNavigation() {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;

    // If topbar already has real content (children with classes), just ensure nav links exist
    const hasExistingContent = topbar.querySelector('.topbar-logo, .topbar-nav, a[href="/"]');

    if (hasExistingContent) {
      // Page has its own topbar — just ensure all nav links are present
      ensureAllNavLinks(topbar);
      return;
    }

    // Empty topbar placeholder — build full nav into it
    const currentPage = getCurrentPage();
    topbar.classList.add('topbar');
    topbar.innerHTML = '';
    // Only set inline styles if the page doesn't define .topbar CSS
    const hasTopbarCSS = Array.from(document.styleSheets).some((s) => {
      try {
        return Array.from(s.cssRules || []).some(
          (r) => r.selectorText && r.selectorText.includes('.topbar')
        );
      } catch (e) {
        return false;
      }
    });
    if (!hasTopbarCSS) {
      topbar.style.cssText =
        'display:flex;align-items:center;gap:10px;padding:10px 20px;background:oklch(0.08 0.015 265/0.35);backdrop-filter:blur(10px) saturate(150%);border-bottom:1px solid oklch(0.38 0.04 270/0.15);position:sticky;top:0;z-index:100;grid-column:1/-1;overflow-x:auto;scrollbar-width:none';
    }

    // Logo
    const logo = document.createElement('a');
    logo.href = '/';
    logo.style.cssText =
      'font-size:16px;font-weight:700;background:linear-gradient(135deg,oklch(0.68 0.30 290),oklch(0.78 0.22 195));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;white-space:nowrap;text-decoration:none;font-family:"Space Grotesk",system-ui,sans-serif';
    logo.textContent = '🧠 RASPUTIN NEXUS';
    topbar.appendChild(logo);

    // Nav links
    const nav = document.createElement('div');
    nav.className = 'topbar-nav';
    nav.style.cssText =
      'display:flex;gap:6px;margin-left:16px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none';

    for (const page of NAV_PAGES) {
      const link = document.createElement('a');
      link.href = page.path;
      link.title = page.tip;
      const isActive = page.path === currentPage;
      link.style.cssText = `font-size:12px;padding:5px 12px;border:1px solid ${isActive ? 'oklch(0.70 0.18 280)' : 'oklch(0.30 0.02 280)'};border-radius:6px;transition:all .2s;color:${isActive ? 'oklch(0.78 0.22 195)' : 'oklch(0.70 0.18 280)'};text-decoration:none;white-space:nowrap;background:${isActive ? 'oklch(0.70 0.18 280/0.15)' : 'transparent'};font-family:"Space Grotesk",system-ui,sans-serif`;
      link.textContent = `${page.icon} ${page.label}`;
      link.onmouseenter = function () {
        this.style.borderColor = 'oklch(0.70 0.18 280)';
        this.style.background = 'oklch(0.70 0.18 280/0.1)';
      };
      link.onmouseleave = function () {
        if (!isActive) {
          this.style.borderColor = 'oklch(0.30 0.02 280)';
          this.style.background = 'transparent';
        }
      };
      nav.appendChild(link);
    }
    topbar.appendChild(nav);
  }

  function ensureAllNavLinks(topbar) {
    // Find the nav container within the topbar
    const navContainer = topbar.querySelector('.topbar-nav');
    if (!navContainer) return;

    const currentPage = getCurrentPage();
    const existingLinks = new Set();
    navContainer.querySelectorAll('a').forEach((a) => {
      const href = new URL(a.href, window.location.origin).pathname;
      existingLinks.add(href);
    });

    // Add any missing pages
    for (const page of NAV_PAGES) {
      if (!existingLinks.has(page.path)) {
        const link = document.createElement('a');
        link.href = page.path;
        link.title = page.tip;
        link.textContent = `${page.icon} ${page.label}`;
        if (page.path === currentPage) link.classList.add('active');
        navContainer.appendChild(link);
      }
    }

    // Add tooltips to existing links
    navContainer.querySelectorAll('a').forEach((a) => {
      const href = new URL(a.href, window.location.origin).pathname;
      const page = NAV_PAGES.find((p) => p.path === href);
      if (page && !a.title) a.title = page.tip;
    });
  }

  // Load keyboard shortcuts library
  function loadKeyboardShortcuts() {
    const script = document.createElement('script');
    script.src = '/keyboard-shortcuts.js';
    script.defer = true;
    document.head.appendChild(script);
    console.log('⌨️ Loading keyboard shortcuts...');
  }

  // Load theme switcher
  function loadThemeSwitcher() {
    const script = document.createElement('script');
    script.src = '/theme-switcher.js';
    document.head.appendChild(script);
    console.log('🎨 Loading theme switcher...');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadThemeSwitcher(); // Load first (before page renders)
      injectNavigation();
      loadKeyboardShortcuts();
    });
  } else {
    loadThemeSwitcher(); // Load first (before page renders)
    injectNavigation();
    loadKeyboardShortcuts();
  }
})();
