/**
 * Global Keyboard Shortcuts for Rasputin Nexus Dashboard
 * Power-user features inspired by Bloomberg Terminal, VS Code, and Vim
 * 
 * Shortcuts:
 * - Cmd/Ctrl + K: Command palette
 * - Cmd/Ctrl + P: Quick page switcher
 * - Cmd/Ctrl + /: Search everything
 * - Cmd/Ctrl + B: Toggle sidebar (if present)
 * - Escape: Close modals/palettes
 * - G then H: Go to home
 * - G then S: Go to sessions
 * - G then M: Go to models
 * - G then B: Go to budget
 * - G then R: Go to replay
 * - G then K: Go to knowledge (second brain)
 * - G then G: Go to GPU monitoring (index)
 * - J/K: Scroll down/up (Vim-style, when not in input)
 * - ?: Show keyboard shortcuts help
 */

(function() {
  'use strict';

  // Config
  const SHORTCUTS = {
    navigation: [
      { keys: ['g', 'h'], action: 'goHome', desc: 'Go to Home (GPU Monitoring)' },
      { keys: ['g', 's'], action: 'goSessions', desc: 'Go to Sessions' },
      { keys: ['g', 'm'], action: 'goModels', desc: 'Go to Models' },
      { keys: ['g', 'b'], action: 'goBudget', desc: 'Go to Budget & Forecasting' },
      { keys: ['g', 'r'], action: 'goReplay', desc: 'Go to Session Replay' },
      { keys: ['g', 'k'], action: 'goKnowledge', desc: 'Go to Knowledge (Second Brain)' },
      { keys: ['g', 'g'], action: 'goGPU', desc: 'Go to GPU Monitoring' },
      { keys: ['g', 'p'], action: 'goPlayground', desc: 'Go to Prompt Playground' },
      { keys: ['g', 'a'], action: 'goAgents', desc: 'Go to Sub-Agents' },
      { keys: ['g', 'e'], action: 'goErrors', desc: 'Go to Error Analytics' },
      { keys: ['g', 'l'], action: 'goLatency', desc: 'Go to Latency Stats' },
      { keys: ['g', 'w'], action: 'goWebhooks', desc: 'Go to Webhooks' },
      { keys: ['g', 't'], action: 'goTemplates', desc: 'Go to Templates (Session Recipes)' },
    ],
    actions: [
      { keys: ['Mod+k'], action: 'commandPalette', desc: 'Open Command Palette' },
      { keys: ['Mod+p'], action: 'quickSwitcher', desc: 'Quick Page Switcher' },
      { keys: ['Mod+/'], action: 'globalSearch', desc: 'Search Everything' },
      { keys: ['Mod+b'], action: 'toggleSidebar', desc: 'Toggle Sidebar' },
      { keys: ['Escape'], action: 'closeModal', desc: 'Close Modal/Palette' },
      { keys: ['?'], action: 'showHelp', desc: 'Show Keyboard Shortcuts Help' },
      { keys: ['j'], action: 'scrollDown', desc: 'Scroll Down (Vim-style)' },
      { keys: ['k'], action: 'scrollUp', desc: 'Scroll Up (Vim-style)' },
      { keys: ['r'], action: 'refresh', desc: 'Refresh Current Page' },
    ],
  };

  const ROUTES = {
    goHome: '/',
    goSessions: '/council.html',
    goModels: '/models.html',
    goBudget: '/budget.html',
    goReplay: '/session-replay.html',
    goKnowledge: '/knowledge.html',
    goGPU: '/',
    goPlayground: '/playground.html',
    goAgents: '/agents.html',
    goErrors: '/errors.html',
    goLatency: '/latency.html',
    goWebhooks: '/webhooks.html',
    goTemplates: '/recipes.html',
  };

  // State
  let keyBuffer = [];
  let keyBufferTimeout = null;
  let modalOpen = false;

  // Detect if Mac
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const modKey = isMac ? 'metaKey' : 'ctrlKey';

  // Replace 'Mod' with actual modifier
  function resolveModKey(keyCombo) {
    return keyCombo.replace('Mod', isMac ? '⌘' : 'Ctrl');
  }

  // Check if target is input
  function isInputFocused() {
    const active = document.activeElement;
    return active && (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.isContentEditable
    );
  }

  // Handle single-key shortcuts (like j/k for scroll)
  function handleSingleKey(key) {
    if (isInputFocused()) return false;

    switch (key) {
      case 'j':
        window.scrollBy({ top: 100, behavior: 'smooth' });
        return true;
      case 'k':
        window.scrollBy({ top: -100, behavior: 'smooth' });
        return true;
      case 'r':
        if (!modalOpen) {
          location.reload();
          return true;
        }
        return false;
      case '?':
        showHelp();
        return true;
      default:
        return false;
    }
  }

  // Handle key sequences (like 'g h' for go home)
  function handleKeySequence(keys) {
    const combo = keys.join(' ');
    
    // Navigation shortcuts
    for (const shortcut of SHORTCUTS.navigation) {
      if (shortcut.keys.join(' ') === combo) {
        if (ROUTES[shortcut.action]) {
          window.location.href = ROUTES[shortcut.action];
          return true;
        }
      }
    }
    
    return false;
  }

  // Handle modifier shortcuts (like Cmd+K)
  function handleModShortcut(e) {
    const key = e.key.toLowerCase();
    
    // Command palette: Cmd/Ctrl + K
    if (e[modKey] && key === 'k') {
      e.preventDefault();
      openCommandPalette();
      return true;
    }
    
    // Quick switcher: Cmd/Ctrl + P
    if (e[modKey] && key === 'p') {
      e.preventDefault();
      openQuickSwitcher();
      return true;
    }
    
    // Global search: Cmd/Ctrl + /
    if (e[modKey] && key === '/') {
      e.preventDefault();
      openGlobalSearch();
      return true;
    }
    
    // Toggle sidebar: Cmd/Ctrl + B
    if (e[modKey] && key === 'b') {
      e.preventDefault();
      toggleSidebar();
      return true;
    }
    
    return false;
  }

  // Main keyboard event handler
  document.addEventListener('keydown', (e) => {
    // Close modal on Escape
    if (e.key === 'Escape') {
      if (modalOpen) {
        closeAllModals();
        e.preventDefault();
        return;
      }
    }

    // Handle modifier shortcuts
    if (e[modKey] || e.ctrlKey || e.metaKey) {
      if (handleModShortcut(e)) {
        return;
      }
    }

    // Skip if input focused (except for specific keys)
    if (isInputFocused()) {
      return;
    }

    // Single-key shortcuts
    if (handleSingleKey(e.key)) {
      e.preventDefault();
      return;
    }

    // Key sequences (like 'g h')
    keyBuffer.push(e.key.toLowerCase());
    
    // Clear buffer after 1 second
    clearTimeout(keyBufferTimeout);
    keyBufferTimeout = setTimeout(() => {
      keyBuffer = [];
    }, 1000);
    
    // Check for sequence match
    if (keyBuffer.length >= 2) {
      if (handleKeySequence(keyBuffer)) {
        keyBuffer = [];
        e.preventDefault();
        return;
      }
      
      // Clear if no match after 2 keys
      if (keyBuffer.length > 2) {
        keyBuffer = [];
      }
    }
  });

  // Command Palette
  function openCommandPalette() {
    if (modalOpen) return;

    const modal = createModal('Command Palette', [
      { icon: '🏠', label: 'Go to Home (GPU Monitoring)', action: () => navigate('/') },
      { icon: '💬', label: 'Go to Sessions', action: () => navigate('/council.html') },
      { icon: '🤖', label: 'Go to Models', action: () => navigate('/models.html') },
      { icon: '💰', label: 'Go to Budget & Forecasting', action: () => navigate('/budget.html') },
      { icon: '🎬', label: 'Go to Session Replay', action: () => navigate('/session-replay.html') },
      { icon: '🧠', label: 'Go to Knowledge (Second Brain)', action: () => navigate('/knowledge.html') },
      { icon: '🎮', label: 'Go to Prompt Playground', action: () => navigate('/playground.html') },
      { icon: '👥', label: 'Go to Sub-Agents', action: () => navigate('/agents.html') },
      { icon: '🚨', label: 'Go to Error Analytics', action: () => navigate('/errors.html') },
      { icon: '⏱️', label: 'Go to Latency Stats', action: () => navigate('/latency.html') },
      { icon: '🔗', label: 'Go to Webhooks', action: () => navigate('/webhooks.html') },
      { icon: '📋', label: 'Go to Templates (Recipes)', action: () => navigate('/recipes.html') },
      { icon: '🔄', label: 'Refresh Page', action: () => location.reload() },
      { icon: '❓', label: 'Show Keyboard Shortcuts', action: () => { closeAllModals(); showHelp(); } },
    ]);

    document.body.appendChild(modal);
  }

  // Quick Switcher (same as command palette but different styling)
  function openQuickSwitcher() {
    openCommandPalette(); // For now, same implementation
  }

  // Global Search (placeholder - to be implemented with actual search backend)
  function openGlobalSearch() {
    if (modalOpen) return;

    const modal = createModal('Search Everything', [
      { icon: '🔍', label: 'Search sessions by content...', action: () => {} },
      { icon: '🔍', label: 'Search tool calls...', action: () => {} },
      { icon: '🔍', label: 'Search errors...', action: () => {} },
      { icon: '🔍', label: 'Search second brain memories...', action: () => navigate('/knowledge.html') },
    ], true);

    document.body.appendChild(modal);
    
    // Focus search input
    setTimeout(() => {
      const input = modal.querySelector('input');
      if (input) input.focus();
    }, 100);
  }

  // Toggle Sidebar (if exists on current page)
  function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar, #sidebar, [data-sidebar]');
    if (sidebar) {
      sidebar.style.display = sidebar.style.display === 'none' ? '' : 'none';
    }
  }

  // Show Help Modal
  function showHelp() {
    if (modalOpen) return;

    const shortcuts = [
      ...SHORTCUTS.navigation,
      ...SHORTCUTS.actions,
    ];

    const items = shortcuts.map(s => ({
      icon: '',
      label: `<span style="font-family: monospace; background: rgba(100,100,255,0.2); padding: 2px 8px; border-radius: 4px; margin-right: 12px; font-size: 12px;">${resolveModKey(s.keys.join(' '))}</span>${s.desc}`,
      action: () => {},
    }));

    const modal = createModal('⌨️ Keyboard Shortcuts', items);
    document.body.appendChild(modal);
  }

  // Create Modal
  function createModal(title, items, hasSearch = false) {
    modalOpen = true;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 10000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 10vh;
      animation: fadeIn 0.15s ease;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: oklch(0.11 0.02 270);
      border: 1px solid oklch(0.30 0.03 270);
      border-radius: 12px;
      width: 90%;
      max-width: 600px;
      max-height: 80vh;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      animation: slideDown 0.2s ease;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      padding: 16px 20px;
      border-bottom: 1px solid oklch(0.25 0.02 280);
      font-size: 16px;
      font-weight: 600;
      color: oklch(0.98 0.005 270);
    `;
    header.textContent = title;

    const content = document.createElement('div');
    content.style.cssText = `
      max-height: 60vh;
      overflow-y: auto;
      padding: 8px;
    `;

    // Search input (if hasSearch)
    if (hasSearch) {
      const searchWrapper = document.createElement('div');
      searchWrapper.style.cssText = `padding: 12px; border-bottom: 1px solid oklch(0.25 0.02 280);`;
      
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Type to search...';
      searchInput.style.cssText = `
        width: 100%;
        padding: 10px 14px;
        background: oklch(0.08 0.015 265);
        border: 1px solid oklch(0.30 0.03 270);
        border-radius: 8px;
        color: oklch(0.98 0.005 270);
        font-size: 14px;
        outline: none;
      `;
      
      searchInput.addEventListener('focus', () => {
        searchInput.style.borderColor = 'oklch(0.60 0.15 195)';
      });
      
      searchInput.addEventListener('blur', () => {
        searchInput.style.borderColor = 'oklch(0.30 0.03 270)';
      });
      
      searchWrapper.appendChild(searchInput);
      modal.appendChild(searchWrapper);
    }

    // Items
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.style.cssText = `
        padding: 12px 16px;
        cursor: pointer;
        border-radius: 8px;
        margin: 4px 0;
        transition: background 0.15s ease;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 14px;
        color: oklch(0.85 0.005 270);
      `;

      if (item.icon) {
        const icon = document.createElement('span');
        icon.textContent = item.icon;
        icon.style.fontSize = '18px';
        row.appendChild(icon);
      }

      const label = document.createElement('span');
      label.innerHTML = item.label;
      label.style.flex = '1';
      row.appendChild(label);

      row.addEventListener('mouseenter', () => {
        row.style.background = 'oklch(0.15 0.04 270)';
      });

      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
      });

      row.addEventListener('click', () => {
        if (item.action) item.action();
        closeAllModals();
      });

      content.appendChild(row);
    });

    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeAllModals();
      }
    });

    // Add animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideDown {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    return overlay;
  }

  // Close All Modals
  function closeAllModals() {
    const modals = document.querySelectorAll('[style*="z-index: 10000"]');
    modals.forEach(m => m.remove());
    modalOpen = false;
  }

  // Navigate
  function navigate(path) {
    window.location.href = path;
  }

  // Toast notification (for feedback)
  function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: oklch(0.15 0.04 270);
      border: 1px solid oklch(0.60 0.15 195);
      color: oklch(0.98 0.005 270);
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10001;
      animation: slideUp 0.3s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    const styleToast = document.createElement('style');
    styleToast.textContent = `
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(styleToast);

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // Expose global API
  window.RasputinKeyboard = {
    showHelp,
    openCommandPalette,
    openQuickSwitcher,
    showToast,
  };

  // Show hint on first load
  if (!localStorage.getItem('keyboardHintShown')) {
    setTimeout(() => {
      showToast('💡 Press ? to see keyboard shortcuts');
      localStorage.setItem('keyboardHintShown', 'true');
    }, 2000);
  }

  console.log('⌨️ Keyboard shortcuts loaded. Press ? for help.');
})();
