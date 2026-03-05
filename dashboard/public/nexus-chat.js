/**
 * NexusChat — Rich Media Chat Component for Rasputin Nexus
 * Self-hosted encrypted communications platform
 * ES Module, zero dependencies (GSAP optional)
 * 
 * Usage:
 *   const chat = new NexusChat({
 *     container: document.getElementById('chat-container'),
 *     ws: websocketConnection,
 *     user: { name: 'admin', avatar: '👤' },
 *     ai: { name: 'Rasputin', avatar: '🧠' }
 *   });
 */

// ─── STYLES ────────────────────────────────────────────────────────────────────
const NEXUS_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --nx-bg: #06060e;
  --nx-bg-secondary: #0c0c18;
  --nx-bg-tertiary: #12121f;
  --nx-surface: rgba(255,255,255,0.03);
  --nx-surface-hover: rgba(255,255,255,0.06);
  --nx-border: rgba(255,255,255,0.06);
  --nx-border-active: rgba(124,92,255,0.4);
  --nx-accent: #7c5cff;
  --nx-accent-dim: rgba(124,92,255,0.15);
  --nx-accent-glow: rgba(124,92,255,0.3);
  --nx-text: #e8e6f0;
  --nx-text-secondary: rgba(232,230,240,0.55);
  --nx-text-tertiary: rgba(232,230,240,0.3);
  --nx-success: #34d399;
  --nx-warning: #fbbf24;
  --nx-error: #f87171;
  --nx-ai-accent: #a78bfa;
  --nx-ai-bg: rgba(167,139,250,0.06);
  --nx-glass: rgba(255,255,255,0.025);
  --nx-glass-border: rgba(255,255,255,0.06);
  --nx-radius: 12px;
  --nx-radius-sm: 8px;
  --nx-radius-lg: 16px;
  --nx-font-display: 'Space Grotesk', system-ui, sans-serif;
  --nx-font-body: 'Inter', system-ui, sans-serif;
  --nx-font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --nx-transition: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --nx-shadow: 0 4px 24px rgba(0,0,0,0.4);
  --nx-shadow-lg: 0 8px 48px rgba(0,0,0,0.6);
}

/* ─── RESET ─── */
.nexus-chat *, .nexus-chat *::before, .nexus-chat *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.nexus-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--nx-bg);
  color: var(--nx-text);
  font-family: var(--nx-font-body);
  font-size: 14px;
  line-height: 1.6;
  position: relative;
  overflow: hidden;
}

/* ─── SCROLLBAR ─── */
.nexus-chat ::-webkit-scrollbar { width: 6px; }
.nexus-chat ::-webkit-scrollbar-track { background: transparent; }
.nexus-chat ::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
}
.nexus-chat ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

/* ─── HEADER ─── */
.nx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: var(--nx-bg-secondary);
  border-bottom: 1px solid var(--nx-border);
  flex-shrink: 0;
  z-index: 10;
}
.nx-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.nx-header-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--nx-accent-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  position: relative;
}
.nx-header-avatar .nx-online-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  background: var(--nx-success);
  border: 2px solid var(--nx-bg-secondary);
  border-radius: 50%;
}
.nx-header-info h3 {
  font-family: var(--nx-font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--nx-text);
  line-height: 1.2;
}
.nx-header-info span {
  font-size: 12px;
  color: var(--nx-text-secondary);
}
.nx-header-actions {
  display: flex;
  gap: 4px;
}
.nx-header-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  color: var(--nx-text-secondary);
  border-radius: var(--nx-radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--nx-transition);
  font-size: 16px;
}
.nx-header-btn:hover {
  background: var(--nx-surface-hover);
  color: var(--nx-text);
}
.nx-header-btn.active {
  background: var(--nx-accent-dim);
  color: var(--nx-accent);
}

/* ─── SEARCH BAR ─── */
.nx-search-bar {
  padding: 10px 20px;
  background: var(--nx-bg-secondary);
  border-bottom: 1px solid var(--nx-border);
  display: none;
  flex-shrink: 0;
}
.nx-search-bar.visible { display: flex; gap: 8px; align-items: center; }
.nx-search-input {
  flex: 1;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius-sm);
  padding: 8px 12px;
  color: var(--nx-text);
  font-family: var(--nx-font-body);
  font-size: 13px;
  outline: none;
  transition: border-color var(--nx-transition);
}
.nx-search-input:focus { border-color: var(--nx-border-active); }
.nx-search-input::placeholder { color: var(--nx-text-tertiary); }
.nx-search-results-count {
  font-size: 12px;
  color: var(--nx-text-secondary);
  white-space: nowrap;
}
.nx-search-nav { display: flex; gap: 2px; }
.nx-search-nav button {
  background: transparent;
  border: none;
  color: var(--nx-text-secondary);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 14px;
}
.nx-search-nav button:hover { background: var(--nx-surface-hover); color: var(--nx-text); }

/* ─── MESSAGES AREA ─── */
.nx-messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scroll-behavior: smooth;
}

/* ─── NEW MESSAGES BADGE ─── */
.nx-new-msg-badge {
  position: absolute;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: var(--nx-accent);
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  z-index: 20;
  box-shadow: var(--nx-shadow);
  opacity: 0;
  pointer-events: none;
  transition: all 200ms ease;
  display: flex;
  align-items: center;
  gap: 6px;
}
.nx-new-msg-badge.visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}

/* ─── DATE SEPARATOR ─── */
.nx-date-sep {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 8px;
}
.nx-date-sep::before, .nx-date-sep::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--nx-border);
}
.nx-date-sep span {
  font-size: 11px;
  font-weight: 500;
  color: var(--nx-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

/* ─── MESSAGE ─── */
.nx-msg {
  display: flex;
  gap: 10px;
  padding: 4px 8px;
  border-radius: var(--nx-radius);
  position: relative;
  max-width: 100%;
  transition: background var(--nx-transition);
}
.nx-msg:hover { background: var(--nx-surface); }
.nx-msg.nx-msg-highlight {
  background: var(--nx-accent-dim) !important;
}
.nx-msg.nx-msg-grouped { padding-top: 1px; padding-bottom: 1px; }
.nx-msg.nx-msg-grouped .nx-msg-avatar { visibility: hidden; }
.nx-msg.nx-msg-grouped .nx-msg-header { display: none; }

.nx-msg-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  margin-top: 2px;
  cursor: pointer;
  position: relative;
}
.nx-msg-avatar.nx-ai-avatar {
  background: linear-gradient(135deg, rgba(124,92,255,0.2), rgba(167,139,250,0.15));
  box-shadow: 0 0 12px rgba(124,92,255,0.15);
}
.nx-msg-avatar.nx-ai-avatar::after {
  content: '✦';
  position: absolute;
  bottom: -2px;
  right: -2px;
  font-size: 10px;
  color: var(--nx-accent);
  background: var(--nx-bg);
  border-radius: 50%;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nx-msg-avatar.nx-user-avatar {
  background: var(--nx-surface);
}

.nx-msg-body {
  flex: 1;
  min-width: 0;
}
.nx-msg-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
}
.nx-msg-author {
  font-family: var(--nx-font-display);
  font-weight: 600;
  font-size: 14px;
  color: var(--nx-text);
}
.nx-msg.nx-msg-ai .nx-msg-author { color: var(--nx-ai-accent); }
.nx-msg-time {
  font-size: 11px;
  color: var(--nx-text-tertiary);
  cursor: default;
}
.nx-msg-edited {
  font-size: 10px;
  color: var(--nx-text-tertiary);
  font-style: italic;
}

/* ─── MESSAGE CONTENT ─── */
.nx-msg-content {
  color: var(--nx-text);
  line-height: 1.6;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.nx-msg-content p { margin-bottom: 4px; }
.nx-msg-content p:last-child { margin-bottom: 0; }
.nx-msg-content strong { font-weight: 600; color: #fff; }
.nx-msg-content em { font-style: italic; }
.nx-msg-content a {
  color: var(--nx-accent);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color var(--nx-transition);
}
.nx-msg-content a:hover { border-bottom-color: var(--nx-accent); }
.nx-msg-content code {
  font-family: var(--nx-font-mono);
  font-size: 12.5px;
  background: rgba(124,92,255,0.1);
  color: #c4b5fd;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(124,92,255,0.15);
}
.nx-msg-content ul, .nx-msg-content ol {
  padding-left: 20px;
  margin: 4px 0;
}
.nx-msg-content li { margin: 2px 0; }
.nx-msg-content h1, .nx-msg-content h2, .nx-msg-content h3 {
  font-family: var(--nx-font-display);
  font-weight: 600;
  margin: 8px 0 4px;
}
.nx-msg-content h1 { font-size: 18px; }
.nx-msg-content h2 { font-size: 16px; }
.nx-msg-content h3 { font-size: 14px; }
.nx-msg-content blockquote {
  border-left: 3px solid var(--nx-accent);
  padding: 4px 12px;
  margin: 6px 0;
  color: var(--nx-text-secondary);
  background: var(--nx-surface);
  border-radius: 0 var(--nx-radius-sm) var(--nx-radius-sm) 0;
}

/* ─── CODE BLOCKS ─── */
.nx-code-block {
  margin: 8px 0;
  border-radius: var(--nx-radius-sm);
  overflow: hidden;
  border: 1px solid var(--nx-border);
  background: rgba(0,0,0,0.4);
}
.nx-code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: rgba(255,255,255,0.03);
  border-bottom: 1px solid var(--nx-border);
}
.nx-code-lang {
  font-family: var(--nx-font-mono);
  font-size: 11px;
  color: var(--nx-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.nx-code-copy {
  background: transparent;
  border: none;
  color: var(--nx-text-tertiary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: var(--nx-font-body);
  transition: all var(--nx-transition);
}
.nx-code-copy:hover { background: var(--nx-surface-hover); color: var(--nx-text); }
.nx-code-block pre {
  margin: 0;
  padding: 12px 16px;
  overflow-x: auto;
  font-family: var(--nx-font-mono);
  font-size: 13px;
  line-height: 1.5;
  color: var(--nx-text);
}
/* Syntax highlighting */
.nx-hl-kw { color: #c792ea; }
.nx-hl-str { color: #c3e88d; }
.nx-hl-num { color: #f78c6c; }
.nx-hl-cm { color: #546e7a; font-style: italic; }
.nx-hl-fn { color: #82aaff; }
.nx-hl-op { color: #89ddff; }
.nx-hl-tag { color: #f07178; }
.nx-hl-attr { color: #ffcb6b; }
.nx-hl-type { color: #ffcb6b; }
.nx-hl-def { color: #82aaff; }
.nx-hl-var { color: #f07178; }
.nx-hl-prop { color: #b2ccd6; }

/* ─── IMAGE MESSAGE ─── */
.nx-msg-image {
  margin: 6px 0;
  max-width: 400px;
  border-radius: var(--nx-radius-sm);
  overflow: hidden;
  cursor: pointer;
  position: relative;
  border: 1px solid var(--nx-border);
}
.nx-msg-image img {
  width: 100%;
  display: block;
  transition: transform 300ms ease;
}
.nx-msg-image:hover img { transform: scale(1.02); }

/* ─── VIDEO MESSAGE ─── */
.nx-msg-video {
  margin: 6px 0;
  max-width: 450px;
  border-radius: var(--nx-radius-sm);
  overflow: hidden;
  border: 1px solid var(--nx-border);
  position: relative;
  background: #000;
}
.nx-msg-video video {
  width: 100%;
  display: block;
}
.nx-video-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0,0,0,0.7);
}
.nx-video-btn {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 14px;
  padding: 2px;
}
.nx-video-progress {
  flex: 1;
  height: 4px;
  background: rgba(255,255,255,0.2);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}
.nx-video-progress-fill {
  height: 100%;
  background: var(--nx-accent);
  border-radius: 2px;
  width: 0%;
  transition: width 100ms linear;
}
.nx-video-time {
  font-size: 11px;
  color: rgba(255,255,255,0.7);
  font-family: var(--nx-font-mono);
}

/* ─── FILE MESSAGE ─── */
.nx-msg-file {
  margin: 6px 0;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius);
  cursor: pointer;
  transition: all var(--nx-transition);
  max-width: 360px;
  text-decoration: none;
  color: inherit;
}
.nx-msg-file:hover {
  background: var(--nx-surface-hover);
  border-color: var(--nx-border-active);
}
.nx-file-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--nx-radius-sm);
  background: var(--nx-accent-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.nx-file-info { min-width: 0; }
.nx-file-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--nx-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nx-file-size {
  font-size: 11px;
  color: var(--nx-text-tertiary);
}
.nx-file-download {
  margin-left: auto;
  color: var(--nx-accent);
  font-size: 16px;
  flex-shrink: 0;
}

/* ─── VOICE MESSAGE ─── */
.nx-msg-voice {
  margin: 6px 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  border-radius: 20px;
  max-width: 320px;
}
.nx-voice-play {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--nx-accent);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  transition: all var(--nx-transition);
}
.nx-voice-play:hover { background: #6b4de6; transform: scale(1.05); }
.nx-voice-waveform {
  flex: 1;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.nx-voice-bar {
  width: 3px;
  border-radius: 2px;
  background: var(--nx-text-tertiary);
  transition: background 100ms ease;
}
.nx-voice-bar.active { background: var(--nx-accent); }
.nx-voice-duration {
  font-size: 11px;
  color: var(--nx-text-tertiary);
  font-family: var(--nx-font-mono);
  flex-shrink: 0;
}

/* ─── EMBED ─── */
.nx-msg-embed {
  margin: 6px 0;
  border-left: 3px solid var(--nx-accent);
  border-radius: 0 var(--nx-radius-sm) var(--nx-radius-sm) 0;
  background: var(--nx-surface);
  border-top: 1px solid var(--nx-border);
  border-right: 1px solid var(--nx-border);
  border-bottom: 1px solid var(--nx-border);
  padding: 12px;
  max-width: 420px;
  cursor: pointer;
  transition: all var(--nx-transition);
}
.nx-msg-embed:hover { background: var(--nx-surface-hover); }
.nx-embed-site {
  font-size: 11px;
  color: var(--nx-text-tertiary);
  margin-bottom: 4px;
}
.nx-embed-title {
  font-family: var(--nx-font-display);
  font-weight: 600;
  font-size: 14px;
  color: var(--nx-accent);
  margin-bottom: 4px;
  line-height: 1.3;
}
.nx-embed-desc {
  font-size: 13px;
  color: var(--nx-text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.nx-embed-image {
  margin-top: 8px;
  border-radius: var(--nx-radius-sm);
  overflow: hidden;
}
.nx-embed-image img {
  width: 100%;
  display: block;
}

/* ─── REPLY REFERENCE ─── */
.nx-msg-reply {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--nx-text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: background var(--nx-transition);
}
.nx-msg-reply:hover { background: var(--nx-surface); }
.nx-msg-reply::before {
  content: '↩';
  color: var(--nx-accent);
  font-size: 11px;
}
.nx-msg-reply-author {
  font-weight: 600;
  color: var(--nx-text);
}
.nx-msg-reply-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

/* ─── REACTIONS ─── */
.nx-msg-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.nx-reaction {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--nx-transition);
}
.nx-reaction:hover {
  background: var(--nx-surface-hover);
  border-color: var(--nx-border-active);
}
.nx-reaction.nx-reaction-mine {
  background: var(--nx-accent-dim);
  border-color: var(--nx-accent-glow);
}
.nx-reaction-count {
  font-size: 11px;
  color: var(--nx-text-secondary);
  font-weight: 500;
}

/* ─── READ RECEIPTS ─── */
.nx-msg-status {
  font-size: 11px;
  color: var(--nx-text-tertiary);
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.nx-msg-status.delivered { color: var(--nx-text-secondary); }
.nx-msg-status.read { color: var(--nx-accent); }

/* ─── MESSAGE ACTIONS ─── */
.nx-msg-actions {
  position: absolute;
  top: -10px;
  right: 8px;
  display: flex;
  gap: 2px;
  background: var(--nx-bg-tertiary);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius-sm);
  padding: 2px;
  box-shadow: var(--nx-shadow);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--nx-transition);
  z-index: 5;
}
.nx-msg:hover .nx-msg-actions {
  opacity: 1;
  pointer-events: auto;
}
.nx-msg-action {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--nx-text-secondary);
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all var(--nx-transition);
}
.nx-msg-action:hover {
  background: var(--nx-surface-hover);
  color: var(--nx-text);
}

/* ─── TYPING INDICATOR ─── */
.nx-typing {
  display: none;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
}
.nx-typing.visible { display: flex; }
.nx-typing-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(124,92,255,0.2), rgba(167,139,250,0.15));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.nx-typing-dots {
  display: flex;
  gap: 4px;
  padding: 10px 14px;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  border-radius: 16px 16px 16px 4px;
}
.nx-typing-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--nx-text-tertiary);
  animation: nxTypingBounce 1.4s infinite;
}
.nx-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.nx-typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes nxTypingBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-6px); opacity: 1; }
}

/* ─── INPUT AREA ─── */
.nx-input-area {
  padding: 12px 20px 16px;
  background: var(--nx-bg-secondary);
  border-top: 1px solid var(--nx-border);
  flex-shrink: 0;
}

/* Reply bar */
.nx-reply-bar {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--nx-surface);
  border-left: 3px solid var(--nx-accent);
  border-radius: 0 var(--nx-radius-sm) var(--nx-radius-sm) 0;
  font-size: 13px;
}
.nx-reply-bar.visible { display: flex; }
.nx-reply-bar-author { font-weight: 600; color: var(--nx-accent); }
.nx-reply-bar-text { color: var(--nx-text-secondary); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nx-reply-bar-close {
  background: none;
  border: none;
  color: var(--nx-text-tertiary);
  cursor: pointer;
  font-size: 16px;
  padding: 2px;
}

/* Toolbar */
.nx-toolbar {
  display: flex;
  gap: 2px;
  margin-bottom: 8px;
}
.nx-toolbar-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--nx-text-tertiary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--nx-transition);
  font-weight: 600;
}
.nx-toolbar-btn:hover {
  background: var(--nx-surface-hover);
  color: var(--nx-text);
}

/* Editor */
.nx-editor-wrap {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius);
  padding: 8px 12px;
  transition: border-color var(--nx-transition);
}
.nx-editor-wrap:focus-within { border-color: var(--nx-border-active); }
.nx-editor {
  flex: 1;
  max-height: 160px;
  min-height: 20px;
  overflow-y: auto;
  outline: none;
  color: var(--nx-text);
  font-family: var(--nx-font-body);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.nx-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--nx-text-tertiary);
  pointer-events: none;
}
.nx-editor code {
  font-family: var(--nx-font-mono);
  background: rgba(124,92,255,0.1);
  padding: 0 4px;
  border-radius: 3px;
  font-size: 13px;
}
.nx-send-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--nx-accent);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  transition: all var(--nx-transition);
  opacity: 0.5;
}
.nx-send-btn.active { opacity: 1; }
.nx-send-btn:hover { background: #6b4de6; transform: scale(1.05); }
.nx-voice-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--nx-border);
  color: var(--nx-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  transition: all var(--nx-transition);
}
.nx-voice-btn:hover { border-color: var(--nx-border-active); color: var(--nx-text); }
.nx-voice-btn.recording {
  background: var(--nx-error);
  border-color: var(--nx-error);
  color: white;
  animation: nxPulse 1.5s infinite;
}
@keyframes nxPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(248,113,113,0.4); }
  50% { box-shadow: 0 0 0 8px rgba(248,113,113,0); }
}

/* Voice recording UI */
.nx-recording-bar {
  display: none;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(248,113,113,0.08);
  border: 1px solid rgba(248,113,113,0.2);
  border-radius: var(--nx-radius);
}
.nx-recording-bar.visible { display: flex; }
.nx-recording-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--nx-error);
  animation: nxPulse 1.5s infinite;
}
.nx-recording-time {
  font-family: var(--nx-font-mono);
  font-size: 13px;
  color: var(--nx-text-secondary);
}
.nx-recording-waveform {
  flex: 1;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.nx-recording-cancel {
  background: none;
  border: none;
  color: var(--nx-text-tertiary);
  cursor: pointer;
  font-size: 13px;
  padding: 4px 8px;
}
.nx-recording-send {
  background: var(--nx-accent);
  border: none;
  color: white;
  cursor: pointer;
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 16px;
  font-weight: 500;
}

/* Drag overlay */
.nx-drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(6,6,14,0.9);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 50;
  border: 2px dashed var(--nx-accent);
  border-radius: var(--nx-radius-lg);
  margin: 8px;
}
.nx-drag-overlay.visible { display: flex; }
.nx-drag-content {
  text-align: center;
}
.nx-drag-icon { font-size: 48px; margin-bottom: 12px; }
.nx-drag-text {
  font-family: var(--nx-font-display);
  font-size: 18px;
  font-weight: 600;
  color: var(--nx-text);
}
.nx-drag-sub {
  font-size: 13px;
  color: var(--nx-text-secondary);
  margin-top: 4px;
}

/* ─── EMOJI PICKER ─── */
.nx-emoji-picker {
  position: absolute;
  bottom: 80px;
  left: 20px;
  width: 320px;
  max-height: 340px;
  background: var(--nx-bg-tertiary);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius);
  box-shadow: var(--nx-shadow-lg);
  z-index: 30;
  display: none;
  flex-direction: column;
  overflow: hidden;
}
.nx-emoji-picker.visible { display: flex; }
.nx-emoji-search {
  padding: 10px;
  border-bottom: 1px solid var(--nx-border);
}
.nx-emoji-search input {
  width: 100%;
  background: var(--nx-surface);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius-sm);
  padding: 7px 10px;
  color: var(--nx-text);
  font-size: 13px;
  outline: none;
  font-family: var(--nx-font-body);
}
.nx-emoji-search input::placeholder { color: var(--nx-text-tertiary); }
.nx-emoji-grid {
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  overflow-y: auto;
  flex: 1;
}
.nx-emoji-item {
  width: 100%;
  aspect-ratio: 1;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--nx-transition);
}
.nx-emoji-item:hover { background: var(--nx-surface-hover); }
.nx-emoji-category {
  grid-column: 1 / -1;
  font-size: 11px;
  font-weight: 600;
  color: var(--nx-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 6px 4px 2px;
}

/* ─── COMMAND PALETTE ─── */
.nx-cmd-palette {
  position: absolute;
  bottom: 80px;
  left: 20px;
  width: 280px;
  background: var(--nx-bg-tertiary);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius);
  box-shadow: var(--nx-shadow-lg);
  z-index: 30;
  display: none;
  overflow: hidden;
}
.nx-cmd-palette.visible { display: block; }
.nx-cmd-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background var(--nx-transition);
}
.nx-cmd-item:hover, .nx-cmd-item.active { background: var(--nx-surface-hover); }
.nx-cmd-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--nx-accent-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.nx-cmd-info { flex: 1; }
.nx-cmd-name { font-size: 13px; font-weight: 500; color: var(--nx-text); }
.nx-cmd-desc { font-size: 11px; color: var(--nx-text-tertiary); }

/* ─── MENTION AUTOCOMPLETE ─── */
.nx-mention-ac {
  position: absolute;
  bottom: 80px;
  left: 20px;
  width: 240px;
  background: var(--nx-bg-tertiary);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius);
  box-shadow: var(--nx-shadow-lg);
  z-index: 30;
  display: none;
  overflow: hidden;
}
.nx-mention-ac.visible { display: block; }
.nx-mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background var(--nx-transition);
  font-size: 13px;
}
.nx-mention-item:hover, .nx-mention-item.active { background: var(--nx-surface-hover); }
.nx-mention-av {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--nx-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

/* ─── LIGHTBOX ─── */
.nx-lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.92);
  z-index: 1000;
  display: none;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}
.nx-lightbox.visible { display: flex; }
.nx-lightbox img {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: var(--nx-radius);
  box-shadow: var(--nx-shadow-lg);
}
.nx-lightbox-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  border: none;
  color: white;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ─── CONTEXT MENU ─── */
.nx-ctx-menu {
  position: fixed;
  background: var(--nx-bg-tertiary);
  border: 1px solid var(--nx-border);
  border-radius: var(--nx-radius-sm);
  box-shadow: var(--nx-shadow-lg);
  z-index: 100;
  display: none;
  min-width: 180px;
  padding: 4px;
  overflow: hidden;
}
.nx-ctx-menu.visible { display: block; }
.nx-ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--nx-text);
  font-size: 13px;
  font-family: var(--nx-font-body);
  cursor: pointer;
  border-radius: 6px;
  width: 100%;
  text-align: left;
  transition: background var(--nx-transition);
}
.nx-ctx-item:hover { background: var(--nx-surface-hover); }
.nx-ctx-item.danger { color: var(--nx-error); }
.nx-ctx-sep {
  height: 1px;
  background: var(--nx-border);
  margin: 4px 0;
}

/* ─── INFINITE SCROLL LOADER ─── */
.nx-loader {
  display: none;
  justify-content: center;
  padding: 16px;
}
.nx-loader.visible { display: flex; }
.nx-loader-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--nx-border);
  border-top-color: var(--nx-accent);
  border-radius: 50%;
  animation: nxSpin 0.8s linear infinite;
}
@keyframes nxSpin {
  to { transform: rotate(360deg); }
}

/* ─── SEARCH HIGHLIGHT ─── */
mark.nx-search-mark {
  background: rgba(124,92,255,0.3);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}

/* ─── ANIMATIONS ─── */
.nx-msg-enter {
  animation: nxMsgIn 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes nxMsgIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.nx-fade-in {
  animation: nxFadeIn 200ms ease;
}
@keyframes nxFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;

// ─── HELPERS ───────────────────────────────────────────────────────────────────

const EMOJIS = {
  'Smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😗','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😮‍💨','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐'],
  'Gestures': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏'],
  'Hearts': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝'],
  'Objects': ['🔥','⭐','🌟','✨','💫','🎉','🎊','🏆','💎','🎵','🎶','🚀','💡','📌','🔔','📎','🔗','💬','💭','🗯️'],
  'Reactions': ['👀','💯','✅','❌','⚡','🙈','🙉','🙊','💀','☠️','🤡','👻','👽','🤖','💩','🎃'],
};

const COMMANDS = [
  { name: 'image', icon: '🖼️', desc: 'Send an image' },
  { name: 'file', icon: '📎', desc: 'Send a file' },
  { name: 'voice', icon: '🎤', desc: 'Record a voice message' },
  { name: 'code', icon: '💻', desc: 'Send a code block' },
  { name: 'gif', icon: '🎬', desc: 'Search for a GIF' },
  { name: 'clear', icon: '🧹', desc: 'Clear chat history' },
  { name: 'encrypt', icon: '🔒', desc: 'Send encrypted message' },
  { name: 'theme', icon: '🎨', desc: 'Change chat theme' },
];

const FILE_ICONS = {
  pdf: '📄', doc: '📝', docx: '📝', txt: '📃', zip: '📦', rar: '📦',
  mp3: '🎵', wav: '🎵', mp4: '🎬', mov: '🎬', png: '🖼️', jpg: '🖼️',
  jpeg: '🖼️', gif: '🖼️', svg: '🖼️', js: '⚡', ts: '⚡', py: '🐍',
  html: '🌐', css: '🎨', json: '📋', default: '📁'
};

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 0000000000) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 0000000000).toFixed(1) + ' GB';
}

function relativeTime(date) {
  const now = Date.now();
  const diff = now - date.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd ago';
  return date.toLocaleDateString();
}

function absoluteTime(date) {
  return date.toLocaleString();
}

function generateId() {
  return 'nx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── SYNTAX HIGHLIGHTER ───────────────────────────────────────────────────────

const SyntaxHL = {
  rules: {
    javascript: [
      [/(\/\/.*$)/gm, 'cm'],
      [/(\/\*[\s\S]*?\*\/)/g, 'cm'],
      [/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|yield|static|get|set|super)\b/g, 'kw'],
      [/\b(true|false|null|undefined|NaN|Infinity)\b/g, 'num'],
      [/\b(\d+\.?\d*)\b/g, 'num'],
      [/(["'`])(?:(?!\1|\\).|\\.)*?\1/g, 'str'],
      [/\b(console|document|window|Math|JSON|Array|Object|String|Number|Boolean|Promise|Map|Set|Date|RegExp|Error)\b/g, 'type'],
      [/(=>|\.\.\.|\?\?|\?\.)/g, 'op'],
      [/([{}[\]();,])/g, 'op'],
    ],
    python: [
      [/(#.*$)/gm, 'cm'],
      [/("""[\s\S]*?"""|'''[\s\S]*?''')/g, 'str'],
      [/\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|raise|with|yield|lambda|pass|break|continue|and|or|not|in|is|global|nonlocal|assert|del|async|await)\b/g, 'kw'],
      [/\b(True|False|None)\b/g, 'num'],
      [/\b(\d+\.?\d*)\b/g, 'num'],
      [/(["'])(?:(?!\1|\\).|\\.)*?\1/g, 'str'],
      [/\b(print|len|range|type|int|str|float|list|dict|set|tuple|bool|input|open|super|self|cls)\b/g, 'type'],
      [/@(\w+)/g, 'fn'],
    ],
    bash: [
      [/(#.*$)/gm, 'cm'],
      [/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|echo|read|local|export|source|alias|unalias|cd|ls|grep|sed|awk|cat|chmod|chown|mkdir|rm|cp|mv|find|xargs|pipe|sudo|apt|yum|brew|npm|yarn|git|docker|curl|wget)\b/g, 'kw'],
      [/(\$\{?\w+\}?)/g, 'var'],
      [/(["'])(?:(?!\1|\\).|\\.)*?\1/g, 'str'],
      [/\b(\d+)\b/g, 'num'],
    ],
    html: [
      [/(<!--[\s\S]*?-->)/g, 'cm'],
      [/(<\/?)([\w-]+)/g, (_, brace, tag) => `${escapeHtml(brace)}<span class="nx-hl-tag">${escapeHtml(tag)}</span>`],
      [/\b([\w-]+)(=)/g, (_, attr, eq) => `<span class="nx-hl-attr">${escapeHtml(attr)}</span>${eq}`],
      [/(["'])(?:(?!\1|\\).|\\.)*?\1/g, 'str'],
    ],
    css: [
      [/(\/\*[\s\S]*?\*\/)/g, 'cm'],
      [/([\w-]+)(\s*:)/g, (_, prop, colon) => `<span class="nx-hl-prop">${escapeHtml(prop)}</span>${colon}`],
      [/(#[\da-fA-F]{3,8})\b/g, 'num'],
      [/\b(\d+\.?\d*(px|em|rem|%|vh|vw|s|ms)?)\b/g, 'num'],
      [/(["'])(?:(?!\1|\\).|\\.)*?\1/g, 'str'],
      [/(@\w+|!important)/g, 'kw'],
      [/(\.[\w-]+|#[\w-]+)/g, 'fn'],
    ],
  },

  highlight(code, lang) {
    const rules = this.rules[lang] || this.rules[lang?.toLowerCase()] || null;
    if (!rules) return escapeHtml(code);

    let html = escapeHtml(code);
    // Simple token-based highlighting
    const tokens = [];
    const escaped = code;

    // We'll do a simpler approach: apply regex to escaped HTML
    for (const [regex, cls] of rules) {
      if (typeof cls === 'function') continue; // skip complex ones
      html = html.replace(regex, (match) => {
        if (match.startsWith('<span')) return match;
        return `<span class="nx-hl-${cls}">${match}</span>`;
      });
    }
    return html;
  }
};

// ─── MARKDOWN PARSER ──────────────────────────────────────────────────────────

function parseMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = generateId();
    const highlighted = SyntaxHL.highlight(code.trim(), lang || 'javascript');
    return `<div class="nx-code-block"><div class="nx-code-header"><span class="nx-code-lang">${lang || 'code'}</span><button class="nx-code-copy" data-code-id="${id}">Copy</button></div><pre id="${id}">${highlighted}</pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Auto-link URLs
  html = html.replace(/(^|[^"=])((https?:\/\/)[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Line breaks (but not inside code blocks)
  html = html.replace(/\n/g, '<br>');

  // Clean up excessive <br> after block elements
  html = html.replace(/(<\/(h[1-3]|ul|ol|blockquote|div|pre)>)<br>/g, '$1');
  html = html.replace(/<br>(<(h[1-3]|ul|ol|blockquote|div))/g, '$1');

  return html;
}

// ─── NEXUS CHAT CLASS ─────────────────────────────────────────────────────────

export class NexusChat {
  constructor(options = {}) {
    this.container = options.container;
    this.ws = options.ws || null;
    this.user = options.user || { name: 'User', avatar: '👤' };
    this.ai = options.ai || { name: 'Rasputin', avatar: '🧠' };
    this.onSend = options.onSend || null;
    this.onLoadMore = options.onLoadMore || null;
    this.onCommand = options.onCommand || null;
    this.onFileUpload = options.onFileUpload || null;
    this.members = options.members || [this.user, this.ai];

    this.messages = [];
    this.isAtBottom = true;
    this.newMsgCount = 0;
    this.replyTo = null;
    this.editingMsg = null;
    this.searchQuery = '';
    this.searchResults = [];
    this.searchIdx = -1;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.recordingStartTime = null;
    this.recordingTimer = null;
    this.isLoadingMore = false;
    this.hasMoreMessages = true;

    this._init();
  }

  _init() {
    this._injectStyles();
    this._buildDOM();
    this._bindEvents();
    this._setupWebSocket();
    this._startTimestampUpdater();
  }

  _injectStyles() {
    if (document.getElementById('nexus-chat-styles')) return;
    const style = document.createElement('style');
    style.id = 'nexus-chat-styles';
    style.textContent = NEXUS_STYLES;
    document.head.appendChild(style);
  }

  _buildDOM() {
    this.container.innerHTML = '';
    this.container.classList.add('nexus-chat');

    this.container.innerHTML = `
      <!-- Header -->
      <div class="nx-header">
        <div class="nx-header-left">
          <div class="nx-header-avatar">
            ${this.ai.avatar}
            <div class="nx-online-dot"></div>
          </div>
          <div class="nx-header-info">
            <h3>${escapeHtml(this.ai.name)}</h3>
            <span>Online • End-to-end encrypted</span>
          </div>
        </div>
        <div class="nx-header-actions">
          <button class="nx-header-btn" data-action="search" title="Search">🔍</button>
          <button class="nx-header-btn" data-action="pin" title="Pinned">📌</button>
          <button class="nx-header-btn" data-action="info" title="Info">ℹ️</button>
        </div>
      </div>

      <!-- Search bar -->
      <div class="nx-search-bar">
        <input class="nx-search-input" type="text" placeholder="Search messages..." />
        <span class="nx-search-results-count"></span>
        <div class="nx-search-nav">
          <button data-dir="prev">▲</button>
          <button data-dir="next">▼</button>
        </div>
      </div>

      <!-- Messages -->
      <div class="nx-messages">
        <div class="nx-loader"><div class="nx-loader-spinner"></div></div>
      </div>

      <!-- New message badge -->
      <div class="nx-new-msg-badge">↓ New messages</div>

      <!-- Typing indicator -->
      <div class="nx-typing">
        <div class="nx-typing-avatar">${this.ai.avatar}</div>
        <div class="nx-typing-dots">
          <div class="nx-typing-dot"></div>
          <div class="nx-typing-dot"></div>
          <div class="nx-typing-dot"></div>
        </div>
      </div>

      <!-- Input area -->
      <div class="nx-input-area">
        <div class="nx-reply-bar">
          <span class="nx-reply-bar-author"></span>
          <span class="nx-reply-bar-text"></span>
          <button class="nx-reply-bar-close">✕</button>
        </div>
        <div class="nx-recording-bar">
          <div class="nx-recording-dot"></div>
          <span class="nx-recording-time">0:00</span>
          <div class="nx-recording-waveform"></div>
          <button class="nx-recording-cancel">Cancel</button>
          <button class="nx-recording-send">Send</button>
        </div>
        <div class="nx-toolbar">
          <button class="nx-toolbar-btn" data-format="bold" title="Bold (Ctrl+B)">B</button>
          <button class="nx-toolbar-btn" data-format="italic" title="Italic (Ctrl+I)"><i>I</i></button>
          <button class="nx-toolbar-btn" data-format="code" title="Code">⟨/⟩</button>
          <button class="nx-toolbar-btn" data-format="link" title="Link">🔗</button>
          <button class="nx-toolbar-btn" data-action="emoji" title="Emoji">😊</button>
          <button class="nx-toolbar-btn" data-action="attach" title="Attach file">📎</button>
        </div>
        <div class="nx-editor-wrap">
          <div class="nx-editor" contenteditable="true" data-placeholder="Type a message..." role="textbox" aria-multiline="true"></div>
          <button class="nx-voice-btn" title="Voice message">🎤</button>
          <button class="nx-send-btn" title="Send">↑</button>
        </div>
      </div>

      <!-- Overlays -->
      <div class="nx-drag-overlay">
        <div class="nx-drag-content">
          <div class="nx-drag-icon">📁</div>
          <div class="nx-drag-text">Drop files here</div>
          <div class="nx-drag-sub">Images, videos, documents</div>
        </div>
      </div>

      <div class="nx-emoji-picker">
        <div class="nx-emoji-search"><input type="text" placeholder="Search emoji..." /></div>
        <div class="nx-emoji-grid"></div>
      </div>

      <div class="nx-cmd-palette"></div>
      <div class="nx-mention-ac"></div>
      <div class="nx-ctx-menu"></div>
    `;

    // Cache elements
    this.els = {
      header: this.container.querySelector('.nx-header'),
      searchBar: this.container.querySelector('.nx-search-bar'),
      searchInput: this.container.querySelector('.nx-search-input'),
      searchCount: this.container.querySelector('.nx-search-results-count'),
      messages: this.container.querySelector('.nx-messages'),
      loader: this.container.querySelector('.nx-loader'),
      newBadge: this.container.querySelector('.nx-new-msg-badge'),
      typing: this.container.querySelector('.nx-typing'),
      inputArea: this.container.querySelector('.nx-input-area'),
      replyBar: this.container.querySelector('.nx-reply-bar'),
      replyAuthor: this.container.querySelector('.nx-reply-bar-author'),
      replyText: this.container.querySelector('.nx-reply-bar-text'),
      replyClose: this.container.querySelector('.nx-reply-bar-close'),
      recordingBar: this.container.querySelector('.nx-recording-bar'),
      recordingTime: this.container.querySelector('.nx-recording-time'),
      recordingWaveform: this.container.querySelector('.nx-recording-waveform'),
      recordingCancel: this.container.querySelector('.nx-recording-cancel'),
      recordingSend: this.container.querySelector('.nx-recording-send'),
      toolbar: this.container.querySelector('.nx-toolbar'),
      editor: this.container.querySelector('.nx-editor'),
      sendBtn: this.container.querySelector('.nx-send-btn'),
      voiceBtn: this.container.querySelector('.nx-voice-btn'),
      dragOverlay: this.container.querySelector('.nx-drag-overlay'),
      emojiPicker: this.container.querySelector('.nx-emoji-picker'),
      emojiSearch: this.container.querySelector('.nx-emoji-search input'),
      emojiGrid: this.container.querySelector('.nx-emoji-grid'),
      cmdPalette: this.container.querySelector('.nx-cmd-palette'),
      mentionAc: this.container.querySelector('.nx-mention-ac'),
      ctxMenu: this.container.querySelector('.nx-ctx-menu'),
    };

    this._populateEmojis();

    // Add lightbox to body
    if (!document.querySelector('.nx-lightbox')) {
      const lb = document.createElement('div');
      lb.className = 'nx-lightbox';
      lb.innerHTML = '<button class="nx-lightbox-close">✕</button><img src="" alt="" />';
      document.body.appendChild(lb);
      this.lightbox = lb;
      lb.addEventListener('click', (e) => {
        if (e.target === lb || e.target.classList.contains('nx-lightbox-close')) {
          lb.classList.remove('visible');
        }
      });
    } else {
      this.lightbox = document.querySelector('.nx-lightbox');
    }

    // Hidden file input
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    this.container.appendChild(this.fileInput);
  }

  _populateEmojis(filter = '') {
    const grid = this.els.emojiGrid;
    grid.innerHTML = '';
    const lf = filter.toLowerCase();
    for (const [cat, emojis] of Object.entries(EMOJIS)) {
      const filtered = filter ? emojis.filter(() => true) : emojis; // emoji search is basic
      if (filtered.length === 0) continue;
      grid.innerHTML += `<div class="nx-emoji-category">${cat}</div>`;
      for (const e of filtered) {
        grid.innerHTML += `<button class="nx-emoji-item" data-emoji="${e}">${e}</button>`;
      }
    }
  }

  _bindEvents() {
    const { editor, sendBtn, voiceBtn, messages, searchInput, fileInput } = this.els;

    // Command Palette Hotkey (Cmd+K or Ctrl+K)
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this._toggleCommandPalette();
      }
    });

    // Editor input
    editor.addEventListener('input', () => this._onEditorInput());
    editor.addEventListener('keydown', (e) => this._onEditorKeydown(e));
    editor.addEventListener('paste', (e) => this._onPaste(e));

    // Send
    sendBtn.addEventListener('click', () => this._send());

    // Voice
    voiceBtn.addEventListener('click', () => this._toggleRecording());
    this.els.recordingCancel.addEventListener('click', () => this._cancelRecording());
    this.els.recordingSend.addEventListener('click', () => this._stopRecording(true));

    // Scroll
    messages.addEventListener('scroll', () => this._onScroll());

    // New message badge
    this.els.newBadge.addEventListener('click', () => this._scrollToBottom());

    // Search
    this.container.querySelector('[data-action="search"]').addEventListener('click', () => this._toggleSearch());
    searchInput.addEventListener('input', () => this._onSearch());
    this.els.searchBar.querySelectorAll('.nx-search-nav button').forEach(btn => {
      btn.addEventListener('click', () => this._navigateSearch(btn.dataset.dir));
    });

    // Toolbar
    this.els.toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-format]');
      if (btn) this._applyFormat(btn.dataset.format);
      const action = e.target.closest('[data-action]');
      if (action?.dataset.action === 'emoji') this._toggleEmojiPicker();
      if (action?.dataset.action === 'attach') fileInput.click();
    });

    // File input
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) this._handleFiles(fileInput.files);
      fileInput.value = '';
    });

    // Drag and drop
    this.container.addEventListener('dragenter', (e) => { e.preventDefault(); this.els.dragOverlay.classList.add('visible'); });
    this.els.dragOverlay.addEventListener('dragleave', (e) => {
      if (e.target === this.els.dragOverlay) this.els.dragOverlay.classList.remove('visible');
    });
    this.els.dragOverlay.addEventListener('dragover', (e) => e.preventDefault());
    this.els.dragOverlay.addEventListener('drop', (e) => {
      e.preventDefault();
      this.els.dragOverlay.classList.remove('visible');
      if (e.dataTransfer.files.length) this._handleFiles(e.dataTransfer.files);
    });

    // Emoji picker
    this.els.emojiSearch.addEventListener('input', (e) => this._populateEmojis(e.target.value));
    this.els.emojiGrid.addEventListener('click', (e) => {
      const item = e.target.closest('.nx-emoji-item');
      if (item) {
        this._insertText(item.dataset.emoji);
        this.els.emojiPicker.classList.remove('visible');
      }
    });

    // Reply close
    this.els.replyClose.addEventListener('click', () => this._clearReply());

    // Message click delegation
    messages.addEventListener('click', (e) => this._onMessageClick(e));

    // Context menu on messages
    messages.addEventListener('contextmenu', (e) => {
      const msg = e.target.closest('.nx-msg');
      if (msg) {
        e.preventDefault();
        this._showContextMenu(e.clientX, e.clientY, msg.dataset.id);
      }
    });

    // Close overlays
    document.addEventListener('click', (e) => {
      if (!this.els.emojiPicker.contains(e.target) && !e.target.closest('[data-action="emoji"]')) {
        this.els.emojiPicker.classList.remove('visible');
      }
      if (!this.els.cmdPalette.contains(e.target)) {
        this.els.cmdPalette.classList.remove('visible');
      }
      if (!this.els.mentionAc.contains(e.target)) {
        this.els.mentionAc.classList.remove('visible');
      }
      if (!this.els.ctxMenu.contains(e.target)) {
        this.els.ctxMenu.classList.remove('visible');
      }
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.els.emojiPicker.classList.remove('visible');
        this.els.cmdPalette.classList.remove('visible');
        this.els.ctxMenu.classList.remove('visible');
        if (this.els.searchBar.classList.contains('visible')) this._toggleSearch();
        if (this.lightbox.classList.contains('visible')) this.lightbox.classList.remove('visible');
      }
    });
  }

  _setupWebSocket() {
    if (!this.ws) return;
    this.ws.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data);
        this._handleWsMessage(data);
      } catch {}
    });
  }

  _handleWsMessage(data) {
    switch (data.type) {
      case 'message':
        this.addMessage(data.message);
        break;
      case 'typing':
        this.showTyping(data.typing);
        break;
      case 'read':
        this._markRead(data.messageId);
        break;
      case 'reaction':
        this._addReaction(data.messageId, data.emoji, data.user);
        break;
      case 'edit':
        this._editMessage(data.messageId, data.content);
        break;
      case 'delete':
        this._deleteMessage(data.messageId);
        break;
    }
  }

  // ─── EDITOR ───

  _onEditorInput() {
    const text = this.els.editor.textContent.trim();
    this.els.sendBtn.classList.toggle('active', text.length > 0);

    // Check for command palette trigger
    if (text === '/') {
      this._showCommandPalette();
    } else if (text.startsWith('/') && text.length > 1) {
      this._filterCommandPalette(text.slice(1));
    } else {
      this.els.cmdPalette.classList.remove('visible');
    }

    // Check for mention trigger
    const cursorText = this._getTextBeforeCursor();
    const mentionMatch = cursorText.match(/@(\w*)$/);
    if (mentionMatch) {
      this._showMentions(mentionMatch[1]);
    } else {
      this.els.mentionAc.classList.remove('visible');
    }

    // Check for emoji trigger
    const emojiMatch = cursorText.match(/:(\w{2,})$/);
    if (emojiMatch) {
      // Could show inline emoji suggestions
    }

    // Send typing
    this._sendTyping();
  }

  _getTextBeforeCursor() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return '';
    const range = sel.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(this.els.editor);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString();
  }

  _onEditorKeydown(e) {
    // Command palette navigation
    if (this.els.cmdPalette.classList.contains('visible')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this._navigateCommandPalette(e.key);
        return;
      }
    }

    // Mention autocomplete navigation
    if (this.els.mentionAc.classList.contains('visible')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this._navigateMentions(e.key);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }

    // Formatting shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); this._applyFormat('bold'); }
      if (e.key === 'i') { e.preventDefault(); this._applyFormat('italic'); }
      if (e.key === 'e') { e.preventDefault(); this._applyFormat('code'); }
    }
  }

  _onPaste(e) {
    // Check for images
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) this._handleFiles([file]);
          return;
        }
      }
    }

    // Paste as plain text
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  _applyFormat(format) {
    this.els.editor.focus();
    const sel = window.getSelection();
    const text = sel.toString();

    switch (format) {
      case 'bold':
        document.execCommand('insertText', false, `**${text || 'bold text'}**`);
        break;
      case 'italic':
        document.execCommand('insertText', false, `*${text || 'italic text'}*`);
        break;
      case 'code':
        if (text.includes('\n')) {
          document.execCommand('insertText', false, `\`\`\`\n${text || 'code'}\n\`\`\``);
        } else {
          document.execCommand('insertText', false, `\`${text || 'code'}\``);
        }
        break;
      case 'link':
        document.execCommand('insertText', false, `[${text || 'link text'}](url)`);
        break;
    }
  }

  _insertText(text) {
    this.els.editor.focus();
    document.execCommand('insertText', false, text);
  }

  // ─── SEND ───

  _send() {
    const editor = this.els.editor;
    const text = editor.innerText.trim();
    if (!text && !this.editingMsg) return;

    if (this.editingMsg) {
      this._editMessage(this.editingMsg, text);
      this.editingMsg = null;
      editor.innerHTML = '';
      this.els.sendBtn.classList.remove('active');
      return;
    }

    // Check for command
    if (text.startsWith('/')) {
      const cmd = text.slice(1).split(' ')[0];
      const args = text.slice(cmd.length + 2);
      if (this.onCommand) this.onCommand(cmd, args);
      editor.innerHTML = '';
      this.els.cmdPalette.classList.remove('visible');
      return;
    }

    const msg = {
      id: generateId(),
      type: 'text',
      content: text,
      sender: this.user.name,
      avatar: this.user.avatar,
      timestamp: new Date(),
      status: 'sent',
      replyTo: this.replyTo,
    };

    this.addMessage(msg);
    this._clearReply();
    editor.innerHTML = '';
    this.els.sendBtn.classList.remove('active');

    // Send via WS
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'message', message: msg }));
    }
    if (this.onSend) this.onSend(msg);
  }

  _sendTyping() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'typing', user: this.user.name }));
    }
  }

  // ─── MESSAGES ───

  addMessage(msg) {
    if (!msg.id) msg.id = generateId();
    if (!msg.timestamp) msg.timestamp = new Date();
    if (typeof msg.timestamp === 'string') msg.timestamp = new Date(msg.timestamp);
    if (!msg.reactions) msg.reactions = [];

    this.messages.push(msg);
    const el = this._renderMessage(msg);
    this.els.messages.appendChild(el);

    if (this.isAtBottom) {
      this._scrollToBottom();
    } else {
      this.newMsgCount++;
      this.els.newBadge.textContent = `↓ ${this.newMsgCount} new message${this.newMsgCount > 1 ? 's' : ''}`;
      this.els.newBadge.classList.add('visible');
    }
  }

  addMessages(msgs, prepend = false) {
    if (!prepend) {
      msgs.forEach(m => this.addMessage(m));
      return;
    }

    // Prepend for infinite scroll
    const scrollH = this.els.messages.scrollHeight;
    const scrollT = this.els.messages.scrollTop;

    const frag = document.createDocumentFragment();
    msgs.forEach(m => {
      if (!m.id) m.id = generateId();
      if (!m.timestamp) m.timestamp = new Date();
      if (typeof m.timestamp === 'string') m.timestamp = new Date(m.timestamp);
      if (!m.reactions) m.reactions = [];
      this.messages.unshift(m);
      frag.appendChild(this._renderMessage(m));
    });

    const loader = this.els.loader;
    loader.after(frag);

    // Maintain scroll position
    requestAnimationFrame(() => {
      this.els.messages.scrollTop = scrollT + (this.els.messages.scrollHeight - scrollH);
    });

    this.isLoadingMore = false;
    this.els.loader.classList.remove('visible');
  }

  _renderMessage(msg) {
    const div = document.createElement('div');
    div.className = 'nx-msg nx-msg-enter';
    div.dataset.id = msg.id;

    const isAi = msg.sender === this.ai.name;
    const isOwn = msg.sender === this.user.name;
    if (isAi) div.classList.add('nx-msg-ai');

    // Check grouping
    const prevMsg = this.messages[this.messages.indexOf(msg) - 1];
    const isGrouped = prevMsg && prevMsg.sender === msg.sender &&
      (msg.timestamp - prevMsg.timestamp) < 60000;
    if (isGrouped) div.classList.add('nx-msg-grouped');

    // Avatar
    const avatarClass = isAi ? 'nx-ai-avatar' : 'nx-user-avatar';
    let html = `<div class="nx-msg-avatar ${avatarClass}">${msg.avatar || (isAi ? this.ai.avatar : this.user.avatar)}</div>`;

    // Body
    html += `<div class="nx-msg-body">`;

    // Header
    html += `<div class="nx-msg-header">
      <span class="nx-msg-author">${escapeHtml(msg.sender)}</span>
      <span class="nx-msg-time" title="${absoluteTime(msg.timestamp)}" data-ts="${msg.timestamp.getTime()}">${relativeTime(msg.timestamp)}</span>
      ${msg.edited ? '<span class="nx-msg-edited">(edited)</span>' : ''}
    </div>`;

    // Reply reference
    if (msg.replyTo) {
      const ref = this.messages.find(m => m.id === msg.replyTo);
      if (ref) {
        html += `<div class="nx-msg-reply" data-ref="${ref.id}">
          <span class="nx-msg-reply-author">${escapeHtml(ref.sender)}</span>
          <span class="nx-msg-reply-text">${escapeHtml((ref.content || '').slice(0, 80))}</span>
        </div>`;
      }
    }

    // Content based on type
    html += this._renderContent(msg);

    // Reactions
    if (msg.reactions.length) {
      html += `<div class="nx-msg-reactions">`;
      const grouped = {};
      msg.reactions.forEach(r => {
        if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, mine: false };
        grouped[r.emoji].count++;
        if (r.user === this.user.name) grouped[r.emoji].mine = true;
      });
      for (const r of Object.values(grouped)) {
        html += `<span class="nx-reaction ${r.mine ? 'nx-reaction-mine' : ''}" data-emoji="${r.emoji}">${r.emoji}<span class="nx-reaction-count">${r.count}</span></span>`;
      }
      html += `</div>`;
    }

    // Status (own messages)
    if (isOwn && msg.status) {
      const statusMap = { sent: '✓', delivered: '✓✓', read: '✓✓' };
      html += `<div class="nx-msg-status ${msg.status}">${statusMap[msg.status] || ''}</div>`;
    }

    html += `</div>`; // end body

    // Actions
    html += `<div class="nx-msg-actions">
      <button class="nx-msg-action" data-action="react" title="React">😊</button>
      <button class="nx-msg-action" data-action="reply" title="Reply">↩</button>
      ${isOwn ? '<button class="nx-msg-action" data-action="edit" title="Edit">✏️</button>' : ''}
      ${isOwn ? '<button class="nx-msg-action" data-action="delete" title="Delete">🗑️</button>' : ''}
    </div>`;

    div.innerHTML = html;
    return div;
  }

  _renderContent(msg) {
    switch (msg.type) {
      case 'text':
        return `<div class="nx-msg-content">${parseMarkdown(msg.content)}</div>`;

      case 'image':
        return `<div class="nx-msg-content">${msg.content ? parseMarkdown(msg.content) : ''}</div>
          <div class="nx-msg-image" data-src="${escapeHtml(msg.url)}">
            <img src="${escapeHtml(msg.url)}" alt="${escapeHtml(msg.alt || 'Image')}" loading="lazy" />
          </div>`;

      case 'video':
        return `<div class="nx-msg-content">${msg.content ? parseMarkdown(msg.content) : ''}</div>
          <div class="nx-msg-video" data-src="${escapeHtml(msg.url)}">
            <video src="${escapeHtml(msg.url)}" preload="metadata"></video>
            <div class="nx-video-controls">
              <button class="nx-video-btn nx-video-play">▶</button>
              <div class="nx-video-progress"><div class="nx-video-progress-fill"></div></div>
              <span class="nx-video-time">0:00</span>
            </div>
          </div>`;

      case 'file':
        const ext = (msg.fileName || '').split('.').pop()?.toLowerCase() || 'default';
        const icon = FILE_ICONS[ext] || FILE_ICONS.default;
        return `<a class="nx-msg-file" href="${escapeHtml(msg.url || '#')}" download="${escapeHtml(msg.fileName || 'file')}">
          <div class="nx-file-icon">${icon}</div>
          <div class="nx-file-info">
            <div class="nx-file-name">${escapeHtml(msg.fileName || 'Unknown file')}</div>
            <div class="nx-file-size">${msg.fileSize ? formatFileSize(msg.fileSize) : ''}</div>
          </div>
          <div class="nx-file-download">⬇</div>
        </a>`;

      case 'voice':
        const bars = msg.waveform || Array.from({ length: 40 }, () => Math.random());
        const maxBar = Math.max(...bars);
        const barsHtml = bars.map(v =>
          `<div class="nx-voice-bar" style="height:${Math.max(4, (v / maxBar) * 28)}px"></div>`
        ).join('');
        return `<div class="nx-msg-voice" data-src="${escapeHtml(msg.url || '')}">
          <button class="nx-voice-play">▶</button>
          <div class="nx-voice-waveform">${barsHtml}</div>
          <span class="nx-voice-duration">${msg.duration || '0:00'}</span>
        </div>`;

      case 'embed':
        return `${msg.content ? `<div class="nx-msg-content">${parseMarkdown(msg.content)}</div>` : ''}
          <div class="nx-msg-embed" data-url="${escapeHtml(msg.embed?.url || '')}">
            ${msg.embed?.site ? `<div class="nx-embed-site">${escapeHtml(msg.embed.site)}</div>` : ''}
            <div class="nx-embed-title">${escapeHtml(msg.embed?.title || '')}</div>
            ${msg.embed?.description ? `<div class="nx-embed-desc">${escapeHtml(msg.embed.description)}</div>` : ''}
            ${msg.embed?.image ? `<div class="nx-embed-image"><img src="${escapeHtml(msg.embed.image)}" loading="lazy" /></div>` : ''}
          </div>`;

      default:
        return `<div class="nx-msg-content">${parseMarkdown(msg.content || '')}</div>`;
    }
  }

  // ─── MESSAGE ACTIONS ───

  _onMessageClick(e) {
    // Code copy
    const copyBtn = e.target.closest('.nx-code-copy');
    if (copyBtn) {
      const codeEl = document.getElementById(copyBtn.dataset.codeId);
      if (codeEl) {
        navigator.clipboard.writeText(codeEl.textContent);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy', 2000);
      }
      return;
    }

    // Image lightbox
    const img = e.target.closest('.nx-msg-image');
    if (img) {
      const src = img.dataset.src || img.querySelector('img')?.src;
      if (src) {
        this.lightbox.querySelector('img').src = src;
        this.lightbox.classList.add('visible');
      }
      return;
    }

    // Video controls
    const videoPlay = e.target.closest('.nx-video-play');
    if (videoPlay) {
      const container = videoPlay.closest('.nx-msg-video');
      const video = container.querySelector('video');
      if (video.paused) {
        video.play();
        videoPlay.textContent = '⏸';
      } else {
        video.pause();
        videoPlay.textContent = '▶';
      }
      // Progress
      video.ontimeupdate = () => {
        const fill = container.querySelector('.nx-video-progress-fill');
        const time = container.querySelector('.nx-video-time');
        if (fill) fill.style.width = (video.currentTime / video.duration * 100) + '%';
        if (time) time.textContent = this._formatTime(video.currentTime);
      };
      return;
    }

    // Video progress seek
    const progress = e.target.closest('.nx-video-progress');
    if (progress) {
      const rect = progress.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const video = progress.closest('.nx-msg-video').querySelector('video');
      video.currentTime = ratio * video.duration;
      return;
    }

    // Voice play
    const voicePlay = e.target.closest('.nx-voice-play');
    if (voicePlay) {
      const container = voicePlay.closest('.nx-msg-voice');
      this._playVoice(container);
      return;
    }

    // Reaction click
    const reaction = e.target.closest('.nx-reaction');
    if (reaction) {
      const msgEl = reaction.closest('.nx-msg');
      this._toggleReaction(msgEl.dataset.id, reaction.dataset.emoji);
      return;
    }

    // Reply reference click
    const replyRef = e.target.closest('.nx-msg-reply');
    if (replyRef) {
      this._scrollToMessage(replyRef.dataset.ref);
      return;
    }

    // Embed click
    const embed = e.target.closest('.nx-msg-embed');
    if (embed?.dataset.url) {
      window.open(embed.dataset.url, '_blank');
      return;
    }

    // Message actions
    const action = e.target.closest('.nx-msg-action');
    if (action) {
      const msgEl = action.closest('.nx-msg');
      const msgId = msgEl.dataset.id;
      switch (action.dataset.action) {
        case 'reply': this._setReply(msgId); break;
        case 'react': this._showReactPicker(msgId, action); break;
        case 'edit': this._startEdit(msgId); break;
        case 'delete': this._deleteMessage(msgId); break;
      }
    }
  }

  _showContextMenu(x, y, msgId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;
    const isOwn = msg.sender === this.user.name;

    let html = `
      <button class="nx-ctx-item" data-action="reply" data-id="${msgId}">↩ Reply</button>
      <button class="nx-ctx-item" data-action="react" data-id="${msgId}">😊 React</button>
      <button class="nx-ctx-item" data-action="copy" data-id="${msgId}">📋 Copy text</button>
    `;
    if (isOwn) {
      html += `
        <div class="nx-ctx-sep"></div>
        <button class="nx-ctx-item" data-action="edit" data-id="${msgId}">✏️ Edit</button>
        <button class="nx-ctx-item danger" data-action="delete" data-id="${msgId}">🗑️ Delete</button>
      `;
    }

    this.els.ctxMenu.innerHTML = html;
    this.els.ctxMenu.style.left = x + 'px';
    this.els.ctxMenu.style.top = y + 'px';
    this.els.ctxMenu.classList.add('visible');

    // Bind
    this.els.ctxMenu.querySelectorAll('.nx-ctx-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        switch (item.dataset.action) {
          case 'reply': this._setReply(id); break;
          case 'copy':
            const m = this.messages.find(m => m.id === id);
            if (m?.content) navigator.clipboard.writeText(m.content);
            break;
          case 'edit': this._startEdit(id); break;
          case 'delete': this._deleteMessage(id); break;
        }
        this.els.ctxMenu.classList.remove('visible');
      });
    });
  }

  _setReply(msgId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;
    this.replyTo = msgId;
    this.els.replyAuthor.textContent = msg.sender;
    this.els.replyText.textContent = (msg.content || '').slice(0, 100);
    this.els.replyBar.classList.add('visible');
    this.els.editor.focus();
  }

  _clearReply() {
    this.replyTo = null;
    this.els.replyBar.classList.remove('visible');
  }

  _startEdit(msgId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;
    this.editingMsg = msgId;
    this.els.editor.textContent = msg.content || '';
    this.els.editor.focus();
    this.els.sendBtn.classList.add('active');
  }

  _editMessage(msgId, newContent) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;
    msg.content = newContent;
    msg.edited = true;
    const el = this.els.messages.querySelector(`[data-id="${msgId}"]`);
    if (el) {
      const content = el.querySelector('.nx-msg-content');
      if (content) content.innerHTML = parseMarkdown(newContent);
      const edited = el.querySelector('.nx-msg-edited');
      if (!edited) {
        const timeEl = el.querySelector('.nx-msg-time');
        if (timeEl) timeEl.insertAdjacentHTML('afterend', ' <span class="nx-msg-edited">(edited)</span>');
      }
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'edit', messageId: msgId, content: newContent }));
    }
  }

  _deleteMessage(msgId) {
    const idx = this.messages.findIndex(m => m.id === msgId);
    if (idx !== -1) this.messages.splice(idx, 1);
    const el = this.els.messages.querySelector(`[data-id="${msgId}"]`);
    if (el) {
      el.style.transition = 'opacity 200ms, transform 200ms';
      el.style.opacity = '0';
      el.style.transform = 'translateX(-20px)';
      setTimeout(() => el.remove(), 200);
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'delete', messageId: msgId }));
    }
  }

  _toggleReaction(msgId, emoji) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;
    const existing = msg.reactions.findIndex(r => r.emoji === emoji && r.user === this.user.name);
    if (existing !== -1) {
      msg.reactions.splice(existing, 1);
    } else {
      msg.reactions.push({ emoji, user: this.user.name });
    }
    this._refreshMessageReactions(msgId);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reaction', messageId: msgId, emoji, user: this.user.name }));
    }
  }

  _addReaction(msgId, emoji, user) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;
    msg.reactions.push({ emoji, user });
    this._refreshMessageReactions(msgId);
  }

  _refreshMessageReactions(msgId) {
    const msg = this.messages.find(m => m.id === msgId);
    const el = this.els.messages.querySelector(`[data-id="${msgId}"]`);
    if (!msg || !el) return;

    let reactionsEl = el.querySelector('.nx-msg-reactions');
    if (!msg.reactions.length) {
      if (reactionsEl) reactionsEl.remove();
      return;
    }

    const grouped = {};
    msg.reactions.forEach(r => {
      if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, mine: false };
      grouped[r.emoji].count++;
      if (r.user === this.user.name) grouped[r.emoji].mine = true;
    });

    const html = Object.values(grouped).map(r =>
      `<span class="nx-reaction ${r.mine ? 'nx-reaction-mine' : ''}" data-emoji="${r.emoji}">${r.emoji}<span class="nx-reaction-count">${r.count}</span></span>`
    ).join('');

    if (reactionsEl) {
      reactionsEl.innerHTML = html;
    } else {
      const body = el.querySelector('.nx-msg-body');
      body.insertAdjacentHTML('beforeend', `<div class="nx-msg-reactions">${html}</div>`);
    }
  }

  _showReactPicker(msgId, anchorEl) {
    // Quick react with common emojis
    const quickEmojis = ['👍', '❤️', '😂', '🔥', '👀', '🎉', '🤔', '💯'];
    const rect = anchorEl.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    this.els.ctxMenu.innerHTML = `<div style="display:flex;gap:2px;padding:4px">${
      quickEmojis.map(e => `<button class="nx-emoji-item" style="width:32px;height:32px;font-size:16px" data-emoji="${e}" data-msg="${msgId}">${e}</button>`).join('')
    }</div>`;
    this.els.ctxMenu.style.left = (rect.left - containerRect.left) + 'px';
    this.els.ctxMenu.style.top = (rect.top - containerRect.top - 44) + 'px';
    this.els.ctxMenu.classList.add('visible');

    this.els.ctxMenu.querySelectorAll('[data-emoji]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._toggleReaction(btn.dataset.msg, btn.dataset.emoji);
        this.els.ctxMenu.classList.remove('visible');
      });
    });
  }

  _markRead(msgId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (msg) msg.status = 'read';
    const el = this.els.messages.querySelector(`[data-id="${msgId}"] .nx-msg-status`);
    if (el) { el.className = 'nx-msg-status read'; el.textContent = '✓✓'; }
  }

  _scrollToMessage(msgId) {
    const el = this.els.messages.querySelector(`[data-id="${msgId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('nx-msg-highlight');
      setTimeout(() => el.classList.remove('nx-msg-highlight'), 2000);
    }
  }

  // ─── SCROLL ───

  _onScroll() {
    const { messages } = this.els;
    const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 50;
    this.isAtBottom = atBottom;

    if (atBottom) {
      this.newMsgCount = 0;
      this.els.newBadge.classList.remove('visible');
    }

    // Infinite scroll - load more
    if (messages.scrollTop < 100 && !this.isLoadingMore && this.hasMoreMessages) {
      this.isLoadingMore = true;
      this.els.loader.classList.add('visible');
      if (this.onLoadMore) {
        this.onLoadMore(this.messages[0]?.id).then(msgs => {
          if (msgs && msgs.length) {
            this.addMessages(msgs, true);
          } else {
            this.hasMoreMessages = false;
            this.els.loader.classList.remove('visible');
          }
          this.isLoadingMore = false;
        }).catch(() => {
          this.isLoadingMore = false;
          this.els.loader.classList.remove('visible');
        });
      } else {
        this.isLoadingMore = false;
        this.els.loader.classList.remove('visible');
      }
    }
  }

  _scrollToBottom() {
    this.els.messages.scrollTop = this.els.messages.scrollHeight;
    this.isAtBottom = true;
    this.newMsgCount = 0;
    this.els.newBadge.classList.remove('visible');
  }

  // ─── SEARCH ───

  _toggleSearch() {
    const visible = this.els.searchBar.classList.toggle('visible');
    if (visible) {
      this.els.searchInput.focus();
    } else {
      this.els.searchInput.value = '';
      this._clearSearchHighlights();
    }
    this.container.querySelector('[data-action="search"]').classList.toggle('active', visible);
  }

  _onSearch() {
    const q = this.els.searchInput.value.trim().toLowerCase();
    this._clearSearchHighlights();
    if (!q) {
      this.els.searchCount.textContent = '';
      this.searchResults = [];
      return;
    }

    this.searchResults = [];
    this.els.messages.querySelectorAll('.nx-msg').forEach(el => {
      const content = el.querySelector('.nx-msg-content');
      if (!content) return;
      const text = content.textContent.toLowerCase();
      if (text.includes(q)) {
        this.searchResults.push(el);
        // Highlight
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
          const idx = node.textContent.toLowerCase().indexOf(q);
          if (idx !== -1) {
            const range = document.createRange();
            range.setStart(node, idx);
            range.setEnd(node, idx + q.length);
            const mark = document.createElement('mark');
            mark.className = 'nx-search-mark';
            range.surroundContents(mark);
          }
        }
      }
    });

    this.els.searchCount.textContent = `${this.searchResults.length} result${this.searchResults.length !== 1 ? 's' : ''}`;
    this.searchIdx = this.searchResults.length > 0 ? 0 : -1;
    if (this.searchIdx >= 0) this._jumpToSearchResult();
  }

  _clearSearchHighlights() {
    this.els.messages.querySelectorAll('mark.nx-search-mark').forEach(mark => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  _navigateSearch(dir) {
    if (!this.searchResults.length) return;
    if (dir === 'next') {
      this.searchIdx = (this.searchIdx + 1) % this.searchResults.length;
    } else {
      this.searchIdx = (this.searchIdx - 1 + this.searchResults.length) % this.searchResults.length;
    }
    this._jumpToSearchResult();
  }

  _jumpToSearchResult() {
    this.searchResults.forEach(el => el.classList.remove('nx-msg-highlight'));
    const el = this.searchResults[this.searchIdx];
    if (el) {
      el.classList.add('nx-msg-highlight');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.els.searchCount.textContent = `${this.searchIdx + 1} / ${this.searchResults.length}`;
    }
  }

  // ─── COMMAND PALETTE ───

  _showCommandPalette() {
    const html = COMMANDS.map((cmd, i) =>
      `<div class="nx-cmd-item ${i === 0 ? 'active' : ''}" data-cmd="${cmd.name}">
        <div class="nx-cmd-icon">${cmd.icon}</div>
        <div class="nx-cmd-info">
          <div class="nx-cmd-name">/${cmd.name}</div>
          <div class="nx-cmd-desc">${cmd.desc}</div>
        </div>
      </div>`
    ).join('');
    this.els.cmdPalette.innerHTML = html;
    this.els.cmdPalette.classList.add('visible');
    this._cmdIdx = 0;

    this.els.cmdPalette.querySelectorAll('.nx-cmd-item').forEach(item => {
      item.addEventListener('click', () => {
        this.els.editor.textContent = '/' + item.dataset.cmd + ' ';
        this.els.cmdPalette.classList.remove('visible');
        this.els.editor.focus();
        // Move cursor to end
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(this.els.editor);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      });
    });
  }

  _filterCommandPalette(query) {
    const filtered = COMMANDS.filter(c => c.name.startsWith(query.toLowerCase()));
    if (filtered.length === 0) {
      this.els.cmdPalette.classList.remove('visible');
      return;
    }
    const html = filtered.map((cmd, i) =>
      `<div class="nx-cmd-item ${i === 0 ? 'active' : ''}" data-cmd="${cmd.name}">
        <div class="nx-cmd-icon">${cmd.icon}</div>
        <div class="nx-cmd-info">
          <div class="nx-cmd-name">/${cmd.name}</div>
          <div class="nx-cmd-desc">${cmd.desc}</div>
        </div>
      </div>`
    ).join('');
    this.els.cmdPalette.innerHTML = html;
    this.els.cmdPalette.classList.add('visible');
    this._cmdIdx = 0;
  }

  _navigateCommandPalette(key) {
    const items = this.els.cmdPalette.querySelectorAll('.nx-cmd-item');
    if (!items.length) return;

    if (key === 'Enter' || key === 'Tab') {
      const active = items[this._cmdIdx];
      if (active) active.click();
      return;
    }

    items[this._cmdIdx]?.classList.remove('active');
    if (key === 'ArrowDown') this._cmdIdx = (this._cmdIdx + 1) % items.length;
    else this._cmdIdx = (this._cmdIdx - 1 + items.length) % items.length;
    items[this._cmdIdx]?.classList.add('active');
  }

  // ─── MENTIONS ───

  _showMentions(query) {
    const filtered = this.members.filter(m =>
      m.name.toLowerCase().startsWith(query.toLowerCase())
    );
    if (!filtered.length) {
      this.els.mentionAc.classList.remove('visible');
      return;
    }
    this.els.mentionAc.innerHTML = filtered.map((m, i) =>
      `<div class="nx-mention-item ${i === 0 ? 'active' : ''}" data-name="${escapeHtml(m.name)}">
        <div class="nx-mention-av">${m.avatar}</div>
        <span>${escapeHtml(m.name)}</span>
      </div>`
    ).join('');
    this.els.mentionAc.classList.add('visible');
    this._mentionIdx = 0;

    this.els.mentionAc.querySelectorAll('.nx-mention-item').forEach(item => {
      item.addEventListener('click', () => {
        this._insertMention(item.dataset.name);
      });
    });
  }

  _navigateMentions(key) {
    const items = this.els.mentionAc.querySelectorAll('.nx-mention-item');
    if (!items.length) return;
    if (key === 'Enter' || key === 'Tab') {
      const active = items[this._mentionIdx];
      if (active) this._insertMention(active.dataset.name);
      return;
    }
    items[this._mentionIdx]?.classList.remove('active');
    if (key === 'ArrowDown') this._mentionIdx = (this._mentionIdx + 1) % items.length;
    else this._mentionIdx = (this._mentionIdx - 1 + items.length) % items.length;
    items[this._mentionIdx]?.classList.add('active');
  }

  _insertMention(name) {
    // Remove the @query and insert @name
    const text = this.els.editor.textContent;
    const match = text.match(/@\w*$/);
    if (match) {
      this.els.editor.textContent = text.slice(0, -match[0].length) + `@${name} `;
      // Move cursor to end
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(this.els.editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    this.els.mentionAc.classList.remove('visible');
  }

  // ─── EMOJI PICKER ───

  _toggleEmojiPicker() {
    this.els.emojiPicker.classList.toggle('visible');
    if (this.els.emojiPicker.classList.contains('visible')) {
      this.els.emojiSearch.value = '';
      this._populateEmojis();
      this.els.emojiSearch.focus();
    }
  }

  // ─── FILE HANDLING ───

  _handleFiles(files) {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        this.addMessage({
          type: 'image',
          url,
          alt: file.name,
          sender: this.user.name,
          avatar: this.user.avatar,
          timestamp: new Date(),
          status: 'sent',
        });
      } else if (file.type.startsWith('video/')) {
        const url = URL.createObjectURL(file);
        this.addMessage({
          type: 'video',
          url,
          sender: this.user.name,
          avatar: this.user.avatar,
          timestamp: new Date(),
          status: 'sent',
        });
      } else {
        this.addMessage({
          type: 'file',
          fileName: file.name,
          fileSize: file.size,
          url: URL.createObjectURL(file),
          sender: this.user.name,
          avatar: this.user.avatar,
          timestamp: new Date(),
          status: 'sent',
        });
      }
      if (this.onFileUpload) this.onFileUpload(file);
    }
  }

  // ─── VOICE RECORDING ───

  async _toggleRecording() {
    if (this.isRecording) {
      this._stopRecording(true);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mediaRecorder = new MediaRecorder(stream);
        this.audioChunks = [];
        this.isRecording = true;
        this.els.voiceBtn.classList.add('recording');
        this.els.recordingBar.classList.add('visible');
        this.els.editor.parentElement.style.display = 'none';
        this.els.toolbar.style.display = 'none';

        this.recordingStartTime = Date.now();
        this.recordingTimer = setInterval(() => {
          const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
          const m = Math.floor(elapsed / 60);
          const s = elapsed % 60;
          this.els.recordingTime.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }, 1000);

        // Animate waveform
        this._animateRecordingWaveform(stream);

        this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
        this.mediaRecorder.start();
      } catch {
        // Microphone not available
      }
    }
  }

  _animateRecordingWaveform(stream) {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const bars = 30;

    this.els.recordingWaveform.innerHTML = Array.from({ length: bars }, () =>
      '<div class="nx-voice-bar" style="height:4px;background:var(--nx-error)"></div>'
    ).join('');

    const barEls = this.els.recordingWaveform.querySelectorAll('.nx-voice-bar');

    const animate = () => {
      if (!this.isRecording) return;
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < bars; i++) {
        const val = data[i] || 0;
        barEls[i].style.height = Math.max(4, (val / 255) * 28) + 'px';
      }
      requestAnimationFrame(animate);
    };
    animate();
    this._recordingAudioCtx = ctx;
  }

  _stopRecording(send) {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.els.voiceBtn.classList.remove('recording');
    this.els.recordingBar.classList.remove('visible');
    this.els.editor.parentElement.style.display = '';
    this.els.toolbar.style.display = '';
    clearInterval(this.recordingTimer);
    if (this._recordingAudioCtx) {
      this._recordingAudioCtx.close();
      this._recordingAudioCtx = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = () => {
        // Stop all tracks
        this.mediaRecorder.stream.getTracks().forEach(t => t.stop());

        if (send && this.audioChunks.length) {
          const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
          const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
          const m = Math.floor(elapsed / 60);
          const s = elapsed % 60;
          const duration = `${m}:${s.toString().padStart(2, '0')}`;

          this.addMessage({
            type: 'voice',
            url,
            duration,
            waveform: Array.from({ length: 40 }, () => Math.random()),
            sender: this.user.name,
            avatar: this.user.avatar,
            timestamp: new Date(),
            status: 'sent',
          });
        }
      };
      this.mediaRecorder.stop();
    }
  }

  _cancelRecording() {
    this._stopRecording(false);
  }

  // ─── VOICE PLAYBACK ───

  _playVoice(container) {
    const src = container.dataset.src;
    if (!src) return;

    const playBtn = container.querySelector('.nx-voice-play');
    const bars = container.querySelectorAll('.nx-voice-bar');
    const durationEl = container.querySelector('.nx-voice-duration');

    if (this._currentAudio && this._currentAudioContainer === container) {
      if (this._currentAudio.paused) {
        this._currentAudio.play();
        playBtn.textContent = '⏸';
      } else {
        this._currentAudio.pause();
        playBtn.textContent = '▶';
      }
      return;
    }

    // Stop previous
    if (this._currentAudio) {
      this._currentAudio.pause();
      const prevBtn = this._currentAudioContainer?.querySelector('.nx-voice-play');
      if (prevBtn) prevBtn.textContent = '▶';
    }

    const audio = new Audio(src);
    this._currentAudio = audio;
    this._currentAudioContainer = container;
    playBtn.textContent = '⏸';

    audio.addEventListener('timeupdate', () => {
      const progress = audio.currentTime / audio.duration;
      const activeCount = Math.floor(progress * bars.length);
      bars.forEach((bar, i) => {
        bar.classList.toggle('active', i < activeCount);
      });
      const remaining = audio.duration - audio.currentTime;
      const m = Math.floor(remaining / 60);
      const s = Math.floor(remaining % 60);
      durationEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    });

    audio.addEventListener('ended', () => {
      playBtn.textContent = '▶';
      bars.forEach(b => b.classList.remove('active'));
    });

    audio.play();
  }

  // ─── TYPING ───

  showTyping(show = true) {
    this.els.typing.classList.toggle('visible', show);
    if (show && this.isAtBottom) {
      this._scrollToBottom();
    }
  }

  // ─── TIMESTAMPS ───

  _startTimestampUpdater() {
    setInterval(() => {
      this.els.messages.querySelectorAll('.nx-msg-time[data-ts]').forEach(el => {
        const ts = parseInt(el.dataset.ts);
        el.textContent = relativeTime(new Date(ts));
      });
    }, 30000);
  }

  // ─── UTILITIES ───

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ─── PUBLIC API ───

  /**
   * Clear all messages
   */
  clear() {
    this.messages = [];
    const msgs = this.els.messages;
    while (msgs.lastChild && !msgs.lastChild.classList?.contains('nx-loader')) {
      msgs.removeChild(msgs.lastChild);
    }
  }

  /**
   * Set typing indicator
   */
  setTyping(show) {
    this.showTyping(show);
  }

  /**
   * Update message status
   */
  updateStatus(msgId, status) {
    const msg = this.messages.find(m => m.id === msgId);
    if (msg) {
      msg.status = status;
      const el = this.els.messages.querySelector(`[data-id="${msgId}"] .nx-msg-status`);
      if (el) {
        const statusMap = { sent: '✓', delivered: '✓✓', read: '✓✓' };
        el.className = `nx-msg-status ${status}`;
        el.textContent = statusMap[status] || '';
      }
    }
  }

  /**
   * Destroy the chat instance
   */
  destroy() {
    if (this._currentAudio) this._currentAudio.pause();
    if (this._recordingAudioCtx) this._recordingAudioCtx.close();
    if (this.mediaRecorder?.state !== 'inactive') this.mediaRecorder?.stop();
    this.container.innerHTML = '';
    this.container.classList.remove('nexus-chat');
  }
}

export default NexusChat;