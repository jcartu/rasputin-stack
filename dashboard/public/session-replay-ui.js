
/* Session Replay UI Enhancements - Time Travel Debugging */
const SessionReplayUI = {
  activeSession: null,
  currentEventIndex: -1,
  events: [],
  playbackTimer: null,
  playbackSpeed: 1000,
  
  init() {
    console.log('[SessionReplayUI] Initializing...');
    this.injectStyles();
    this.createControls();
    this.bindGlobalEvents();
  },

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .replay-timeline-container {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(10, 10, 20, 0.95);
        border-top: 1px solid rgba(100, 100, 255, 0.3);
        padding: 10px 20px;
        z-index: 10000;
        backdrop-filter: blur(10px);
        transform: translateY(100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.5);
      }
      
      .replay-timeline-container.active {
        transform: translateY(0);
      }
      
      .replay-timeline-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      
      .replay-timeline-title {
        font-size: 14px;
        font-weight: 600;
        color: #a855f7;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .replay-controls {
        display: flex;
        align-items: center;
        gap: 15px;
      }
      
      .replay-btn {
        background: none;
        border: none;
        color: #e0e0e0;
        cursor: pointer;
        padding: 5px;
        border-radius: 5px;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .replay-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      
      .replay-btn.active {
        color: #00d4ff;
      }
      
      .replay-timeline-track {
        height: 6px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        position: relative;
        cursor: pointer;
        margin: 15px 0;
      }
      
      .replay-timeline-progress {
        height: 100%;
        background: linear-gradient(90deg, #00d4ff, #a855f7);
        border-radius: 3px;
        width: 0%;
        position: absolute;
        top: 0;
        left: 0;
      }
      
      .replay-timeline-handle {
        width: 14px;
        height: 14px;
        background: #fff;
        border-radius: 50%;
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        z-index: 2;
      }
      
      .replay-marker {
        position: absolute;
        width: 4px;
        height: 10px;
        top: -2px;
        border-radius: 2px;
        z-index: 1;
      }
      
      .replay-marker.message-user { background: #60a5fa; }
      .replay-marker.message-assistant { background: #a78bfa; }
      .replay-marker.tool { background: #34d399; }
      .replay-marker.error { background: #f87171; }
      
      .replay-tooltip {
        position: absolute;
        bottom: 25px;
        background: rgba(30, 30, 40, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 5px 10px;
        border-radius: 5px;
        font-size: 11px;
        white-space: nowrap;
        pointer-events: none;
        display: none;
        z-index: 10;
      }
      
      .replay-timeline-track:hover .replay-tooltip {
        display: block;
      }
      
      .replay-status {
        font-size: 12px;
        color: #888;
        font-family: monospace;
      }
      
      .close-replay {
        color: #666;
        cursor: pointer;
      }
      
      /* Sidebar toggle style integration */
      .action-chip.replay-mode {
        background: linear-gradient(135deg, #6366f1, #a855f7);
        color: white;
        border: none;
      }
    `;
    document.head.appendChild(style);
  },

  createControls() {
    const container = document.createElement('div');
    container.id = 'replay-timeline-ui';
    container.className = 'replay-timeline-container';
    
    container.innerHTML = `
      <div class="replay-timeline-header">
        <div class="replay-timeline-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span>TIME TRAVEL DEBUGGER</span>
          <span class="replay-status" id="replay-current-time">00:00 / 00:00</span>
        </div>
        <div class="replay-controls">
          <button class="replay-btn" id="replay-prev" title="Step Back (Left Arrow)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 17l-5-5m0 0l5-5m-5 5h12"/></svg>
          </button>
          <button class="replay-btn" id="replay-play" title="Play/Pause (Space)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" id="replay-play-icon"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="replay-btn" id="replay-next" title="Step Forward (Right Arrow)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
          </button>
          <div style="width: 1px; height: 20px; background: rgba(255,255,255,0.1); margin: 0 5px;"></div>
          <select id="replay-speed" style="background:none; border:none; color:#888; font-size:12px; cursor:pointer; outline:none;">
            <option value="2000">0.5x</option>
            <option value="1000" selected>1x</option>
            <option value="500">2x</option>
            <option value="250">4x</option>
          </select>
          <div class="close-replay" id="replay-close" title="Exit Replay Mode">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </div>
        </div>
      </div>
      <div class="replay-timeline-track" id="replay-track">
        <div class="replay-timeline-progress" id="replay-progress"></div>
        <div class="replay-timeline-handle" id="replay-handle"></div>
        <div class="replay-markers" id="replay-markers"></div>
        <div class="replay-tooltip" id="replay-tooltip"></div>
      </div>
    `;
    
    document.body.appendChild(container);
    
    // Create toggle button in sidebar actions
    this.createToggleButton();
  },

  createToggleButton() {
    const actions = document.querySelector('.neural-actions');
    if (!actions) return;
    
    const btn = document.createElement('button');
    btn.className = 'action-chip';
    btn.id = 'toggle-replay-mode';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <span>Replay</span>
    `;
    btn.onclick = () => this.toggleMode();
    actions.appendChild(btn);
  },

  bindGlobalEvents() {
    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (!document.getElementById('replay-timeline-ui').classList.contains('active')) return;
      
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlayback();
      } else if (e.code === 'ArrowRight') {
        this.step(1);
      } else if (e.code === 'ArrowLeft') {
        this.step(-1);
      } else if (e.code === 'Escape') {
        this.toggleMode(false);
      }
    });
    
    // Timeline clicks
    const track = document.getElementById('replay-track');
    track.addEventListener('click', (e) => {
      const rect = track.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      this.jumpToPct(pct);
    });
    
    // Tooltip tracking
    track.addEventListener('mousemove', (e) => {
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const tooltip = document.getElementById('replay-tooltip');
      
      if (this.events.length > 0) {
        const index = Math.floor(pct * (this.events.length - 1));
        const event = this.events[index];
        tooltip.style.left = \`\${pct * 100}%\`;
        tooltip.textContent = \`\${event.type.toUpperCase()}: \${event.role || event.toolCallId || 'event'} (\${new Date(event.ts).toLocaleTimeString()})\`;
      }
    });
    
    // Control buttons
    document.getElementById('replay-play').onclick = () => this.togglePlayback();
    document.getElementById('replay-prev').onclick = () => this.step(-1);
    document.getElementById('replay-next').onclick = () => this.step(1);
    document.getElementById('replay-close').onclick = () => this.toggleMode(false);
    document.getElementById('replay-speed').onchange = (e) => {
      this.playbackSpeed = parseInt(e.target.value);
      if (this.playbackTimer) {
        this.pause();
        this.play();
      }
    };
  },

  async toggleMode(force) {
    const container = document.getElementById('replay-timeline-ui');
    const isActive = force !== undefined ? !force : container.classList.contains('active');
    
    if (!isActive) {
      // Entering replay mode
      const sessionKey = new URLSearchParams(window.location.search).get('session') || 'current';
      await this.loadSession(sessionKey);
      container.classList.add('active');
      document.getElementById('toggle-replay-mode').classList.add('replay-mode');
      
      // Stop live neural stream logic if needed
      if (window.NeuralStream) window.NeuralStream.paused = true;
    } else {
      // Exiting replay mode
      this.pause();
      container.classList.remove('active');
      document.getElementById('toggle-replay-mode').classList.remove('replay-mode');
      
      if (window.NeuralStream) window.NeuralStream.paused = false;
      // Refresh to live view
      window.location.reload();
    }
  },

  async loadSession(sessionKey) {
    console.log('[SessionReplayUI] Loading session:', sessionKey);
    try {
      const res = await fetch(\`/api/replay/\${sessionKey}\`, { method: 'POST' });
      const data = await res.json();
      
      if (data.messages) {
        this.events = data.messages.map(m => ({
          ...m,
          ts: m.timestamp || Date.now()
        }));
        this.renderMarkers();
        this.jumpToIndex(this.events.length - 1);
      }
    } catch (err) {
      console.error('[SessionReplayUI] Load failed:', err);
    }
  },

  renderMarkers() {
    const markersContainer = document.getElementById('replay-markers');
    markersContainer.innerHTML = '';
    
    if (this.events.length === 0) return;
    
    const startTime = this.events[0].ts;
    const duration = Math.max(1, this.events[this.events.length - 1].ts - startTime);
    
    this.events.forEach((evt, i) => {
      const marker = document.createElement('div');
      marker.className = \`replay-marker \${evt.type === 'tool_result' ? 'tool' : 'message-' + (evt.role || 'sys')}\`;
      const pos = ((evt.ts - startTime) / duration) * 100;
      marker.style.left = \`\${pos}%\`;
      markersContainer.appendChild(marker);
    });
  },

  jumpToIndex(index) {
    if (index < 0 || index >= this.events.length) return;
    
    this.currentEventIndex = index;
    const event = this.events[index];
    
    // Update Progress UI
    const pct = (index / (this.events.length - 1)) * 100;
    document.getElementById('replay-progress').style.width = \`\${pct}%\`;
    document.getElementById('replay-handle').style.left = \`\${pct}%\`;
    
    // Update Time Display
    const currentTs = new Date(event.ts).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' });
    const totalDuration = this.formatDuration(this.events[this.events.length - 1].ts - this.events[0].ts);
    document.getElementById('replay-current-time').textContent = \`\${currentTs} / \${totalDuration}\`;
    
    // APPLY STATE TO DASHBOARD
    this.renderState(index);
  },

  jumpToPct(pct) {
    const index = Math.round(pct * (this.events.length - 1));
    this.jumpToIndex(index);
  },

  step(dir) {
    this.pause();
    this.jumpToIndex(this.currentEventIndex + dir);
  },

  togglePlayback() {
    if (this.playbackTimer) this.pause();
    else this.play();
  },

  play() {
    if (this.currentEventIndex >= this.events.length - 1) {
      this.currentEventIndex = -1;
    }
    
    document.getElementById('replay-play-icon').innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    
    this.playbackTimer = setInterval(() => {
      if (this.currentEventIndex < this.events.length - 1) {
        this.jumpToIndex(this.currentEventIndex + 1);
      } else {
        this.pause();
      }
    }, this.playbackSpeed);
  },

  pause() {
    clearInterval(this.playbackTimer);
    this.playbackTimer = null;
    document.getElementById('replay-play-icon').innerHTML = '<path d="M8 5v14l11-7z"/>';
  },

  renderState(index) {
    // This is the "Time Travel" part - it reconstructs the neural stream
    const stream = document.getElementById('neural-stream') || document.querySelector('.messages-container');
    if (!stream) return;
    
    // Clear current view
    stream.innerHTML = '';
    
    // Render all messages up to this point
    for (let i = 0; i <= index; i++) {
      const evt = this.events[i];
      
      // Use existing dashboard message rendering if possible
      if (window.renderNeuralMessage) {
        // Mock a streaming event for the renderer
        window.renderNeuralMessage(evt);
      } else {
        // Fallback simple renderer
        const div = document.createElement('div');
        div.className = \`message message-\${evt.role || 'system'}\`;
        div.style.padding = '10px';
        div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        
        let content = '';
        if (typeof evt.content === 'string') content = evt.content;
        else if (Array.isArray(evt.content)) {
          content = evt.content.map(c => c.text || JSON.stringify(c)).join('\\n');
        }
        
        div.innerHTML = \`
          <div style="font-size: 10px; color: #666; margin-bottom: 4px;">\${evt.role?.toUpperCase() || evt.type} - \${new Date(evt.ts).toLocaleTimeString()}</div>
          <div style="font-size: 13px;">\${this.escapeHtml(content)}</div>
        \`;
        stream.appendChild(div);
      }
    }
    
    // Auto-scroll to bottom
    stream.scrollTop = stream.scrollHeight;
  },

  formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return \`\${m.toString().padStart(2, '0')}:\${(s % 60).toString().padStart(2, '0')}\`;
  },

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Initialize after dashboard is ready
window.addEventListener('load', () => {
  setTimeout(() => SessionReplayUI.init(), 2000);
});
