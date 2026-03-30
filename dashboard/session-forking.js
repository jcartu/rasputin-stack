
/* Session Forking Enhancements */
const SessionForking = {
  init() {
    console.log('[SessionForking] Initializing...');
    this.createUI();
    this.bindEvents();
  },

  createUI() {
    // Look for chat controls or neural stream bottom
    const streamBottom = document.querySelector('.neural-stream-controls') || document.body;
    
    const forkBtn = document.createElement('button');
    forkBtn.id = 'session-fork-btn';
    forkBtn.className = 'action-chip'; // Assume this class exists based on dashboard style
    forkBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0l-3 3m3-3l3 3m7 13V10m0 0l-3 3m3-3l3 3M7 10h10"/></svg>
      <span>Fork Session</span>
    `;
    forkBtn.style.marginLeft = '8px';
    forkBtn.setAttribute('title', 'Branch this conversation into a parallel session');
    
    if (document.querySelector('.neural-actions')) {
      document.querySelector('.neural-actions').appendChild(forkBtn);
    } else {
      forkBtn.style.position = 'fixed';
      forkBtn.style.bottom = '100px';
      forkBtn.style.right = '20px';
      forkBtn.style.zIndex = '9999';
      document.body.appendChild(forkBtn);
    }
  },

  bindEvents() {
    const btn = document.getElementById('session-fork-btn');
    if (btn) {
      btn.addEventListener('click', () => this.fork());
    }
  },

  async fork() {
    const sessionKey = new URLSearchParams(window.location.search).get('session') || 'current';
    console.log(`[SessionForking] Forking session: ${sessionKey}`);
    
    // Visual feedback
    const btn = document.getElementById('session-fork-btn');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span>Forking...</span>';
    btn.style.opacity = '0.5';

    try {
      const response = await fetch('/api/sessions/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey })
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Show success notification (assume Toast exists or alert)
        if (window.showToast) {
          window.showToast('Session forked into parallel universe!', 'success');
        } else {
          alert('Session forked successfully! New session: ' + result.newSessionKey);
        }
        
        // Redirect to new session
        window.location.search = `?session=${result.newSessionKey}`;
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      console.error('[SessionForking] Error:', err);
      if (window.showToast) window.showToast('Fork failed: ' + err.message, 'error');
      else alert('Fork failed: ' + err.message);
    } finally {
      btn.innerHTML = originalContent;
      btn.style.opacity = '1';
    }
  }
};

// Auto-init
setTimeout(() => SessionForking.init(), 1000);
