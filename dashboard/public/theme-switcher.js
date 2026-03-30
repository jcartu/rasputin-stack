#!/usr/bin/env node
/**
 * Theme Switcher for Rasputin Nexus Dashboard
 * Implements dark/light mode toggle with persistence
 * 
 * Features:
 * - Auto-detect system preference
 * - Manual toggle via button
 * - Persist choice in localStorage
 * - Smooth transitions
 * - Keyboard shortcut (Cmd+Shift+L)
 * 
 * Usage: Include in HTML:
 * <script src="theme-switcher.js"></script>
 * 
 * Theme will auto-initialize based on saved preference or system default
 */

(function() {
  'use strict';

  class ThemeSwitcher {
    constructor() {
      this.STORAGE_KEY = 'alfie-theme-preference';
      this.THEMES = {
        DARK: 'dark',
        LIGHT: 'light',
        AUTO: 'auto'
      };
      
      this.currentTheme = this.loadTheme();
      this.init();
    }

    init() {
      // Apply theme immediately (before page renders)
      this.applyTheme(this.currentTheme);
      
      // Listen for system theme changes
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
          if (this.currentTheme === this.THEMES.AUTO) {
            this.applyTheme(this.THEMES.AUTO);
          }
        });
      }

      // Keyboard shortcut: Cmd+Shift+L
      document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'L') {
          e.preventDefault();
          this.toggle();
        }
      });

      // Create UI button (will be injected by shared-nav.js or page)
      this.createButton();

      console.log('[ThemeSwitcher] Initialized with theme:', this.currentTheme);
    }

    loadTheme() {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      
      // If saved preference exists, use it
      if (saved && Object.values(this.THEMES).includes(saved)) {
        return saved;
      }

      // Otherwise, check system preference
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return this.THEMES.DARK;
      }

      // Default to dark (current ALFIE style)
      return this.THEMES.DARK;
    }

    saveTheme(theme) {
      localStorage.setItem(this.STORAGE_KEY, theme);
    }

    applyTheme(theme) {
      const root = document.documentElement;
      const body = document.body;

      // Resolve 'auto' to actual theme
      let actualTheme = theme;
      if (theme === this.THEMES.AUTO) {
        actualTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? this.THEMES.DARK
          : this.THEMES.LIGHT;
      }

      // Apply theme class
      root.setAttribute('data-theme', actualTheme);
      body.classList.remove('theme-dark', 'theme-light');
      body.classList.add(`theme-${actualTheme}`);

      // Update button icon if it exists
      this.updateButtonIcon(actualTheme);

      console.log(`[ThemeSwitcher] Applied theme: ${actualTheme} (from ${theme})`);
    }

    toggle() {
      // Toggle between dark and light (skip auto for simplicity)
      const newTheme = this.currentTheme === this.THEMES.DARK 
        ? this.THEMES.LIGHT 
        : this.THEMES.DARK;
      
      this.setTheme(newTheme);
    }

    setTheme(theme) {
      this.currentTheme = theme;
      this.saveTheme(theme);
      this.applyTheme(theme);

      // Dispatch event for pages to react
      window.dispatchEvent(new CustomEvent('themeChanged', { 
        detail: { theme } 
      }));
    }

    createButton() {
      // Button will be injected into topbar by shared-nav.js
      // This just creates the element, shared-nav.js handles placement
      const button = document.createElement('button');
      button.id = 'theme-toggle-button';
      button.className = 'theme-toggle';
      button.setAttribute('aria-label', 'Toggle theme');
      button.setAttribute('title', 'Toggle light/dark mode (Cmd+Shift+L)');
      
      button.innerHTML = this.getIconForTheme(this.currentTheme);
      
      button.addEventListener('click', () => {
        this.toggle();
      });

      // Inject CSS for button
      this.injectStyles();

      // Store reference
      this.button = button;
      
      // If topbar actions exist, inject now
      // Otherwise, shared-nav.js will handle it
      const topbarActions = document.querySelector('.topbar-actions');
      if (topbarActions) {
        topbarActions.insertBefore(button, topbarActions.firstChild);
      }
    }

    updateButtonIcon(theme) {
      if (this.button) {
        this.button.innerHTML = this.getIconForTheme(theme);
      }
    }

    getIconForTheme(theme) {
      // Resolve auto to actual theme
      let actualTheme = theme;
      if (theme === this.THEMES.AUTO) {
        actualTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? this.THEMES.DARK
          : this.THEMES.LIGHT;
      }

      if (actualTheme === this.THEMES.LIGHT) {
        // Show moon icon (currently light, click for dark)
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>`;
      } else {
        // Show sun icon (currently dark, click for light)
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>`;
      }
    }

    injectStyles() {
      if (document.getElementById('theme-switcher-styles')) return;

      const style = document.createElement('style');
      style.id = 'theme-switcher-styles';
      style.textContent = `
        /* Theme transition */
        * {
          transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
        }

        /* Dark theme (default) */
        :root[data-theme="dark"] {
          --bg-primary: #0a0e27;
          --bg-secondary: #141B2D;
          --bg-tertiary: #1e2538;
          --text-primary: #e0e0e0;
          --text-secondary: #b0b0b0;
          --text-muted: #808080;
          --border-color: rgba(255, 255, 255, 0.1);
          --accent-primary: #00ffff;
          --accent-secondary: #ff00ff;
          --card-bg: rgba(20, 27, 45, 0.8);
          --card-border: rgba(0, 255, 255, 0.2);
          --shadow: rgba(0, 0, 0, 0.5);
          --code-bg: rgba(0, 0, 0, 0.3);
          --success: #4ade80;
          --warning: #fbbf24;
          --error: #ef4444;
        }

        /* Light theme */
        :root[data-theme="light"] {
          --bg-primary: #f5f5f5;
          --bg-secondary: #ffffff;
          --bg-tertiary: #e0e0e0;
          --text-primary: #1a1a1a;
          --text-secondary: #4a4a4a;
          --text-muted: #808080;
          --border-color: rgba(0, 0, 0, 0.1);
          --accent-primary: #0088cc;
          --accent-secondary: #9933cc;
          --card-bg: rgba(255, 255, 255, 0.9);
          --card-border: rgba(0, 136, 204, 0.3);
          --shadow: rgba(0, 0, 0, 0.1);
          --code-bg: rgba(0, 0, 0, 0.05);
          --success: #16a34a;
          --warning: #d97706;
          --error: #dc2626;
        }

        /* Apply theme colors */
        body {
          background-color: var(--bg-primary);
          color: var(--text-primary);
        }

        .topbar, .sidebar {
          background: var(--bg-secondary);
          border-color: var(--border-color);
        }

        .card, .panel {
          background: var(--card-bg);
          border-color: var(--card-border);
          box-shadow: 0 4px 8px var(--shadow);
        }

        .card h2, .card h3 {
          color: var(--text-primary);
        }

        .card p, .card span {
          color: var(--text-secondary);
        }

        .stat-card {
          background: var(--bg-tertiary);
          border-color: var(--border-color);
        }

        pre, code {
          background: var(--code-bg);
          color: var(--text-primary);
          border-color: var(--border-color);
        }

        input, textarea, select {
          background: var(--bg-tertiary);
          color: var(--text-primary);
          border-color: var(--border-color);
        }

        button {
          background: var(--bg-tertiary);
          color: var(--text-primary);
          border-color: var(--border-color);
        }

        button:hover {
          background: var(--accent-primary);
          color: var(--bg-primary);
        }

        a {
          color: var(--accent-primary);
        }

        a:hover {
          color: var(--accent-secondary);
        }

        /* Theme toggle button */
        .theme-toggle {
          position: relative;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
          margin-right: 10px;
        }

        .theme-toggle:hover {
          background: var(--accent-primary);
          transform: scale(1.1);
          box-shadow: 0 0 20px var(--accent-primary);
        }

        .theme-toggle svg {
          color: var(--text-primary);
          transition: color 0.3s ease;
        }

        .theme-toggle:hover svg {
          color: var(--bg-primary);
        }

        /* Light theme specific overrides */
        [data-theme="light"] .gradient-text {
          background: linear-gradient(135deg, #0088cc 0%, #9933cc 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        [data-theme="light"] .neural-stream-bg {
          background: linear-gradient(180deg, 
            rgba(255, 255, 255, 0) 0%,
            rgba(0, 136, 204, 0.05) 100%);
        }

        [data-theme="light"] .glow {
          box-shadow: 0 0 20px rgba(0, 136, 204, 0.3);
        }

        [data-theme="light"] .topbar {
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
        }

        [data-theme="light"] .sidebar {
          box-shadow: 2px 0 10px rgba(0, 0, 0, 0.05);
        }

        /* Success/Warning/Error colors */
        .success { color: var(--success); }
        .warning { color: var(--warning); }
        .error { color: var(--error); }

        .bg-success { background-color: var(--success); }
        .bg-warning { background-color: var(--warning); }
        .bg-error { background-color: var(--error); }
      `;
      
      document.head.appendChild(style);
    }
  }

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.themeSwitcher = new ThemeSwitcher();
    });
  } else {
    window.themeSwitcher = new ThemeSwitcher();
  }

  // Expose API
  window.ThemeSwitcher = ThemeSwitcher;
})();
