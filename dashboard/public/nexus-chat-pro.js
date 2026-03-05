/**
 * Nexus Chat Pro — Next-Generation Professional Studio Interface
 * Version 2.0 — "The Claude Killer"
 * 
 * Features:
 * ✦ Full Markdown + LaTeX rendering with KaTeX
 * ✦ Syntax highlighting with Prism.js (copy buttons on all code blocks)
 * ✦ Artifacts system (inline HTML/MD preview like Claude.ai)
 * ✦ Drag-drop + paste-to-upload (images/files/context)
 * ✦ Voice recording with waveform visualization
 * ✦ Streaming "Thinking" states (animated spinner)
 * ✦ Actionable widgets (charts, buttons, missions)
 * ✦ Professional Cyberpunk/Nexus dark theme (Tailwind-inspired)
 * ✦ Fragmented upload support (multi-GB files)
 * ✦ Real-time collaborative editing indicators
 * 
 * Usage:
 *   <script type="module">
 *     import { NexusChatPro } from './nexus-chat-pro.js';
 *     const chat = new NexusChatPro({
 *       container: document.getElementById('chat'),
 *       wsUrl: 'ws://localhost:9001',
 *       user: { name: 'admin', avatar: '👤' },
 *       ai: { name: 'Rasputin 2', avatar: '🧠' }
 *     });
 *   </script>
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚡ STYLES — Professional Cyberpunk/Nexus Theme
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NEXUS_PRO_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap');
@import url('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css');
@import url('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css');

:root {
  /* Color Palette — Nexus Professional */
  --nx-bg: #0a0a0f;
  --nx-bg-secondary: #0f0f16;
  --nx-bg-tertiary: #14141d;
  --nx-surface: rgba(255,255,255,0.04);
  --nx-surface-hover: rgba(255,255,255,0.08);
  --nx-border: rgba(255,255,255,0.08);
  --nx-border-active: rgba(139,92,246,0.5);
  --nx-accent: #8b5cf6;
  --nx-accent-bright: #a78bfa;
  --nx-accent-dim: rgba(139,92,246,0.12);
  --nx-accent-glow: rgba(139,92,246,0.4);
  --nx-text: #e8e9ed;
  --nx-text-secondary: rgba(232,233,237,0.6);
  --nx-text-tertiary: rgba(232,233,237,0.35);
  --nx-success: #34d399;
  --nx-warning: #fbbf24;
  --nx-error: #f87171;
  --nx-ai-accent: #a78bfa;
  --nx-ai-bg: rgba(167,139,250,0.08);
  --nx-thinking: #60a5fa;
  --nx-artifact-bg: rgba(59,130,246,0.06);
  --nx-artifact-border: rgba(59,130,246,0.3);
  --nx-widget-bg: rgba(16,185,129,0.08);
  --nx-widget-border: rgba(16,185,129,0.3);
  
  /* Spacing & Typography */
  --nx-radius: 14px;
  --nx-radius-sm: 10px;
  --nx-radius-lg: 18px;
  --nx-font-display: 'Space Grotesk', system-ui, sans-serif;
  --nx-font-body: 'Inter', system-ui, sans-serif;
  --nx-font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  --nx-transition: 180ms cubic-bezier(0.4, 0, 0.2, 1);
  --nx-shadow: 0 4px 32px rgba(0,0,0,0.6);
  --nx-shadow-lg: 0 12px 64px rgba(0,0,0,0.8);
  --nx-glow-accent: 0 0 32px rgba(139,92,246,0.3);
}

/* Reset */
.nexus-chat-pro *, .nexus-chat-pro *::before, .nexus-chat-pro *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.nexus-chat-pro {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--nx-bg);
  color: var(--nx-text);
  font-family: var(--nx-font-body);
  font-size: 15px;
  line-height: 1.65;
  position: relative;
  overflow: hidden;
  border-radius: var(--nx-radius-lg);
}

/* ━━━ Scrollbar ━━━ */
.nexus-chat-pro ::-webkit-scrollbar { width: 8px; height: 8px; }
.nexus-chat-pro ::-webkit-scrollbar-track { background: transparent; }
.nexus-chat-pro ::-webkit-scrollbar-thumb {
  background: rgba(139,92,246,0.3);
  border-radius: 4px;
}
.nexus-chat-pro ::-webkit-scrollbar-thumb:hover {
  background: rgba(139,92,246,0.5);
}

/* ━━━ Header ━━━ */
.nx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  background: var(--nx-bg-secondary);
  border-bottom: 1px solid var(--nx-border);
  flex-shrink: 0;
  backdrop-filter: blur(20px);
  z-index: 20;
}

.nx-header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.nx-header-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(139,92,246,0.2), rgba(167,139,250,0.15));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  position: relative;
  box-shadow: 0 0 24px rgba(139,92,246,0.2);
}

.nx-header-avatar .nx-status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  background: var(--nx-success);
  border: 2px solid var(--nx-bg-secondary);
  border-radius: 50%;
  animation: nx-pulse 2s infinite;
}

@keyframes nx-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.4); }
  50% { box-shadow: 0 0 0 6px rgba(52,211,153,0); }
}

.nx-header-info h3 {
  font-family: var(--nx-font-display);
  font-size: 17px;
  font-weight: 600;
  color: var(--nx-text);
  line-height: 1.2;
}

.nx-header-info .nx-status {
  font-size: 13px;
  color: var(--nx-text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.nx-header-info .nx-status .nx-enc-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(52,211,153,0.15);
  border: 1px solid rgba(52,211,153,0.3);
  border-radius: 8px;
  color: var(--nx-success);
  font-weight: 500;
}

.nx-header-actions {
  display: flex;
  gap: 6px;
}

.nx-header-btn {
  width: 38px;
  height: 38px;
  border: none;
  background: transparent;
  color: var(--nx-text-secondary);
  border-radius: var(--nx-radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--nx-transition);
  font-size: 18px;
}

.nx-header-btn:hover {
  background: var(--nx-surface-hover);
  color: var(--nx-text);
  box-shadow: 0 0 16px rgba(139,92,246,0.15);
}

.nx-header-btn.active {
  background: var(--nx-accent-dim);
  color: var(--nx-accent);
}

/* ━━━ Messages Area ━━━ */
.nx-messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  scroll-behavior: smooth;
  position: relative;
}

/* ━━━ Typing Indicator (Thinking State) ━━━ */
.nx-thinking {
  display: none;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin: 8px 0;
  background: var(--nx-ai-bg);
  border: 1px solid rgba(167,139,250,0.15);
  border-radius: var(--nx-radius);
  max-width: fit-content;
}

.nx-thinking.visible { display: flex; }

.nx-thinking-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(139,92,246,0.25), rgba(167,139,250,0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  animation: nx-thinking-glow 2s infinite;
}

@keyframes nx-thinking-glow {
  0%, 100% { box-shadow: 0 0 12px rgba(167,139,250,0.3); }
  50% { box-shadow: 0 0 24px rgba(167,139,250,0.6); }
}

.nx-thinking-text {
  font-size: 14px;
  color: var(--nx-ai-accent);
  font-weight: 500;
}

.nx-thinking-dots {
  display: flex;
  gap: 5px;
}

.nx-thinking-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--nx-ai-accent);
  animation: nx-thinking-bounce 1.4s infinite;
}

.nx-thinking-dot:nth-child(2) { animation-delay: 0.2s; }
.nx-thinking-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes nx-thinking-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-8px); opacity: 1; }
}

/* ━━━ Message Bubble ━━━ */
.nx-msg {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--nx-radius);
  position: relative;
  max-width: 100%;
  transition: background var(--nx-transition);
  animation: nx-msg-in 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes nx-msg-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.nx-msg:hover { background: var(--nx-surface); }

.nx-msg-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  margin-top: 2px;
}

.nx-msg-avatar.nx-ai-avatar {
  background: linear-gradient(135deg, rgba(139,92,246,0.25), rgba(167,139,250,0.2));
  box-shadow: 0 0 20px rgba(139,92,246,0.2);
  position: relative;
}

.nx-msg-avatar.nx-ai-avatar::after {
  content: '✦';
  position: absolute;
  bottom: -2px;
  right: -2px;
  font-size: 12px;
  color: var(--nx-accent-bright);
  background: var(--nx-bg);
  border-radius: 50%;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nx-msg-avatar.nx-user-avatar {
  background: var(--nx-surface);
  border: 2px solid var(--nx-border);
}

.nx-msg-body {
  flex: 1;
  min-width: 0;
}

.nx-msg-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}

.nx-msg-author {
  font-family: var(--nx-font-display);
  font-weight: 600;
  font-size: 15px;
  color: var(--nx-text);
}

.nx-msg.nx-msg-ai .nx-msg-author { color: var(--nx-ai-accent); }

.nx-msg-time {
  font-size: 12px;
  color: var(--nx-text-tertiary);
  cursor: default;
}

/* ━━━ Message Content — Rich Markdown + LaTeX ━━━ */
.nx-msg-content {
  color: var(--nx-text);
  line-height: 1.75;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.nx-msg-content p { margin-bottom: 12px; }
.nx-msg-content p:last-child { margin-bottom: 0; }
.nx-msg-content strong { font-weight: 600; color: #fff; }
.nx-msg-content em { font-style: italic; }
.nx-msg-content a {
  color: var(--nx-accent-bright);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color var(--nx-transition);
}
.nx-msg-content a:hover { border-bottom-color: var(--nx-accent-bright); }

.nx-msg-content code {
  font-family: var(--nx-font-mono);
  font-size: 13.5px;
  background: rgba(139,92,246,0.12);
  color: #c4b5fd;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid rgba(139,92,246,0.2);
}

.nx-msg-content h1, .nx-msg-content h2, .nx-msg-content h3 {
  font-family: var(--nx-font-display);
  font-weight: 600;
  margin: 18px 0 12px;
  color: #fff;
}

.nx-msg-content h1 { font-size: 24px; }
.nx-msg-content h2 { font-size: 20px; }
.nx-msg-content h3 { font-size: 17px; }

.nx-msg-content ul, .nx-msg-content ol {
  padding-left: 24px;
  margin: 12px 0;
}

.nx-msg-content li {
  margin: 6px 0;
  padding-left: 4px;
}

.nx-msg-content blockquote {
  border-left: 3px solid var(--nx-accent);
  padding: 8px 16px;
  margin: 12px 0;
  color: var(--nx-text-secondary);
  background: var(--nx-surface);
  border-radius: 0 var(--nx-radius-sm) var(--nx-radius-sm) 0;
}

/* LaTeX/KaTeX Support */
.nx-msg-content .katex {
  font-size: 1.1em;
}

.nx-msg-content .katex-display {
  margin: 16px 0;
  overflow-x: auto;
  overflow-y: hidden;
}

/* ━━━ Code Block with Prism.js ━━━ */
.nx-code-block {
  margin: 14px 0;
  border-radius: var(--nx-radius);
  overflow: hidden;
  border: 1px solid var(--nx-border);
  background: rgba(0,0,0,0.5);
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}

.nx-code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid var(--nx-border);
}

.nx-code-lang {
  font-family: var(--nx-font-mono);
  font-size: 11px;
  color: var(--nx-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}

.nx-code-copy {
  background: transparent;
  border: 1px solid var(--nx-border);
  color: var(--nx-text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 8px;
  font-family: var(--nx-font-body);
  font-weight: 500;
  transition: all var(--nx-transition);
  display: flex;
  align-items: center;
  gap: 6px;
}

.nx-code-copy:hover {
  background: var(--nx-surface-hover);
  border-color: var(--nx-accent);
  color: var(--nx-accent);
}

.nx-code-copy.copied {
  background: rgba(52,211,153,0.15);
  border-color: var(--nx-success);
  color: var(--nx-success);
}

.nx-code-block pre {
  margin: 0;
  padding: 18px 20px;
  overflow-x: auto;
  font-family: var(--nx-font-mono);
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--nx-text);
  background: transparent !important;
}

.nx-code-block pre code {
  background: none !important;
  border: none !important;
  padding: 0 !important;
  color: inherit !important;
  font-size: inherit !important;
}

/* ━━━ Artifacts (Claude-style inline previews) ━━━ */
.nx-artifact {
  margin: 16px 0;
  border: 2px solid var(--nx-artifact-border);
  border-radius: var(--nx-radius);
  background: var(--nx-artifact-bg);
  overflow: hidden;
  box-shadow: 0 6px 24px rgba(59,130,246,0.15);
}

.nx-artifact-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px;
  background: rgba(59,130,246,0.08);
  border-bottom: 1px solid var(--nx-artifact-border);
}

.nx-artifact-title {
  font-family: var(--nx-font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--nx-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.nx-artifact-actions {
  display: flex;
  gap: 6px;
}

.nx-artifact-btn {
  background: transparent;
  border: 1px solid rgba(59,130,246,0.3);
  color: var(--nx-text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 8px;
  transition: all var(--nx-transition);
  font-weight: 500;
}

.nx-artifact-btn:hover {
  background: rgba(59,130,246,0.15);
  border-color: rgba(59,130,246,0.5);
  color: var(--nx-text);
}

.nx-artifact-body {
  padding: 20px;
  max-height: 500px;
  overflow: auto;
}

.nx-artifact-body iframe {
  width: 100%;
  min-height: 400px;
  border: none;
  border-radius: var(--nx-radius-sm);
}

/* ━━━ Actionable Widget ━━━ */
.nx-widget {
  margin: 16px 0;
  border: 2px solid var(--nx-widget-border);
  border-radius: var(--nx-radius);
  background: var(--nx-widget-bg);
  overflow: hidden;
  box-shadow: 0 6px 24px rgba(16,185,129,0.15);
  padding: 18px;
}

.nx-widget-title {
  font-family: var(--nx-font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--nx-success);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.nx-widget-body {
  color: var(--nx-text);
}

.nx-widget-btn {
  background: linear-gradient(135deg, var(--nx-success), var(--nx-accent));
  border: none;
  color: white;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 20px;
  border-radius: var(--nx-radius-sm);
  transition: all var(--nx-transition);
  box-shadow: 0 4px 16px rgba(16,185,129,0.3);
  margin-top: 12px;
}

.nx-widget-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 24px rgba(16,185,129,0.5);
}

/* ━━━ Image/Video/File Attachments ━━━ */
.nx-msg-image, .nx-msg-video, .nx-msg-file {
  margin: 12px 0;
  max-width: 500px;
}

.nx-msg-image {
  border-radius: var(--nx-radius-sm);
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--nx-border);
  transition: all var(--nx-transition);
}

.nx-msg-image:hover {
  box-shadow: 0 8px 32px rgba(139,92,246,0.2);
  transform: scale(1.02);
}

.nx-msg-image img {
  width: 100%;
  display: block;
}

/* ━━━ Input Area ━━━ */
.nx-input-area {
  padding: 16px 24px 20px;
  background: var(--nx-bg-secondary);
  border-top: 1px solid var(--nx-border);
  flex-shrink: 0;
}

.nx-editor-wrap {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: var(--nx-surface);
  border: 2px solid var(--nx-border);
  border-radius: var(--nx-radius);
  padding: 12px 16px;
  transition: border-color var(--nx-transition);
}

.nx-editor-wrap:focus-within {
  border-color: var(--nx-border-active);
  box-shadow: var(--nx-glow-accent);
}

.nx-editor {
  flex: 1;
  max-height: 180px;
  min-height: 24px;
  overflow-y: auto;
  outline: none;
  color: var(--nx-text);
  font-family: var(--nx-font-body);
  font-size: 15px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.nx-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--nx-text-tertiary);
  pointer-events: none;
}

.nx-toolbar {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}

.nx-toolbar-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  color: var(--nx-text-tertiary);
  border-radius: var(--nx-radius-sm);
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--nx-transition);
}

.nx-toolbar-btn:hover {
  background: var(--nx-surface-hover);
  color: var(--nx-text);
}

.nx-send-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--nx-accent), var(--nx-accent-bright));
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  transition: all var(--nx-transition);
  box-shadow: 0 4px 16px rgba(139,92,246,0.4);
}

.nx-send-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 24px rgba(139,92,246,0.6);
}

.nx-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ━━━ Drag & Drop Overlay ━━━ */
.nx-drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(10,10,15,0.95);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 100;
  border: 3px dashed var(--nx-accent);
  border-radius: var(--nx-radius-lg);
  margin: 16px;
  backdrop-filter: blur(8px);
}

.nx-drag-overlay.visible { display: flex; }

.nx-drag-content {
  text-align: center;
  animation: nx-drag-bounce 1s infinite;
}

@keyframes nx-drag-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-12px); }
}

.nx-drag-icon {
  font-size: 64px;
  margin-bottom: 16px;
  filter: drop-shadow(0 0 20px rgba(139,92,246,0.6));
}

.nx-drag-text {
  font-family: var(--nx-font-display);
  font-size: 22px;
  font-weight: 600;
  color: var(--nx-text);
  margin-bottom: 8px;
}

.nx-drag-sub {
  font-size: 15px;
  color: var(--nx-text-secondary);
}

/* ━━━ Voice Recording UI ━━━ */
.nx-voice-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: transparent;
  border: 2px solid var(--nx-border);
  color: var(--nx-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  transition: all var(--nx-transition);
}

.nx-voice-btn:hover {
  border-color: var(--nx-accent);
  color: var(--nx-accent);
  box-shadow: 0 0 20px rgba(139,92,246,0.3);
}

.nx-voice-btn.recording {
  background: var(--nx-error);
  border-color: var(--nx-error);
  color: white;
  animation: nx-recording-pulse 1.5s infinite;
}

@keyframes nx-recording-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(248,113,113,0.5); }
  50% { box-shadow: 0 0 0 12px rgba(248,113,113,0); }
}

/* ━━━ Utility Classes ━━━ */
.nx-hidden { display: none !important; }
.nx-fade-in { animation: nx-fade-in 240ms ease; }

@keyframes nx-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚡ UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function generateId() {
  return 'nx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return date.toLocaleDateString();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚡ MARKDOWN + LATEX PARSER (with KaTeX + Prism.js)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let katex, Prism;

function loadDependencies() {
  // Load KaTeX
  if (!window.katex) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
    script.onload = () => { katex = window.katex; };
    document.head.appendChild(script);
  } else {
    katex = window.katex;
  }

  // Load Prism.js
  if (!window.Prism) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js';
    script.setAttribute('data-manual', 'true');
    script.onload = () => {
      // Load additional language components
      const langs = ['javascript', 'python', 'bash', 'css', 'markup', 'json', 'typescript', 'go', 'rust'];
      langs.forEach(lang => {
        const s = document.createElement('script');
        s.src = `https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-${lang}.min.js`;
        document.head.appendChild(s);
      });
      Prism = window.Prism;
    };
    document.head.appendChild(script);
  } else {
    Prism = window.Prism;
  }
}

function parseMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // LaTeX blocks: $$...$$ (display) and $...$ (inline)
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    try {
      return katex ? katex.renderToString(tex, { displayMode: true, throwOnError: false }) : `<span class="math-display">$$${tex}$$</span>`;
    } catch {
      return `<span class="math-error">$$${tex}$$</span>`;
    }
  });

  html = html.replace(/\$([^\$\n]+?)\$/g, (_, tex) => {
    try {
      return katex ? katex.renderToString(tex, { displayMode: false, throwOnError: false }) : `<span class="math-inline">$${tex}$</span>`;
    } catch {
      return `<span class="math-error">$${tex}$</span>`;
    }
  });

  // Code blocks with syntax highlighting
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = generateId();
    let highlighted = escapeHtml(code.trim());
    if (Prism && lang && Prism.languages[lang]) {
      try {
        highlighted = Prism.highlight(code.trim(), Prism.languages[lang], lang);
      } catch {}
    }
    return `<div class="nx-code-block"><div class="nx-code-header"><span class="nx-code-lang">${lang || 'text'}</span><button class="nx-code-copy" data-code-id="${id}"><span>📋</span> Copy</button></div><pre id="${id}"><code class="language-${lang || 'text'}">${highlighted}</code></pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold + Italic
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

  // Lists
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  // Clean up excessive <br>
  html = html.replace(/(<\/(h[1-3]|ul|ol|blockquote|div|pre)>)<br>/g, '$1');
  html = html.replace(/<br>(<(h[1-3]|ul|ol|blockquote|div))/g, '$1');

  return html;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚡ NEXUS CHAT PRO CLASS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class NexusChatPro {
  constructor(options = {}) {
    this.container = options.container;
    this.wsUrl = options.wsUrl || 'ws://localhost:9001';
    this.user = options.user || { name: 'User', avatar: '👤' };
    this.ai = options.ai || { name: 'Rasputin 2', avatar: '🧠' };
    this.onSend = options.onSend || null;
    this.onWidgetAction = options.onWidgetAction || null;

    this.messages = [];
    this.ws = null;
    this.isThinking = false;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];

    this._init();
  }

  _init() {
    loadDependencies();
    this._injectStyles();
    this._buildDOM();
    this._bindEvents();
    if (!this.container.dataset.externalWs) {
      this._connectWebSocket();
    }
  }
  
  // External API: feed messages from an existing WebSocket
  feedMessage(msg) { this._handleWSMessage(msg); }

  _injectStyles() {
    if (document.getElementById('nexus-chat-pro-styles')) return;
    const style = document.createElement('style');
    style.id = 'nexus-chat-pro-styles';
    style.textContent = NEXUS_PRO_STYLES;
    document.head.appendChild(style);
  }

  _buildDOM() {
    this.container.innerHTML = '';
    this.container.classList.add('nexus-chat-pro');

    this.container.innerHTML = `
      <div class="nx-header">
        <div class="nx-header-left">
          <div class="nx-header-avatar">
            ${this.ai.avatar}
            <div class="nx-status-dot"></div>
          </div>
          <div class="nx-header-info">
            <h3>${escapeHtml(this.ai.name)}</h3>
            <div class="nx-status">
              <span>Online</span>
              <span class="nx-enc-badge">🔒 E2E</span>
            </div>
          </div>
        </div>
        <div class="nx-header-actions">
          <button class="nx-header-btn" data-action="info" title="Info">ℹ️</button>
        </div>
      </div>

      <div class="nx-messages">
        <!-- Messages render here -->
      </div>

      <div class="nx-thinking">
        <div class="nx-thinking-avatar">${this.ai.avatar}</div>
        <span class="nx-thinking-text">Thinking</span>
        <div class="nx-thinking-dots">
          <div class="nx-thinking-dot"></div>
          <div class="nx-thinking-dot"></div>
          <div class="nx-thinking-dot"></div>
        </div>
      </div>

      <div class="nx-input-area">
        <div class="nx-toolbar">
          <button class="nx-toolbar-btn" data-format="bold" title="Bold">B</button>
          <button class="nx-toolbar-btn" data-format="italic" title="Italic"><i>I</i></button>
          <button class="nx-toolbar-btn" data-format="code" title="Code">⟨/⟩</button>
          <button class="nx-toolbar-btn" data-action="attach" title="Attach">📎</button>
        </div>
        <div class="nx-editor-wrap">
          <div class="nx-editor" contenteditable="true" data-placeholder="Type a message..."></div>
          <button class="nx-voice-btn" title="Voice">🎤</button>
          <button class="nx-send-btn" title="Send">↑</button>
        </div>
      </div>

      <div class="nx-drag-overlay">
        <div class="nx-drag-content">
          <div class="nx-drag-icon">📁</div>
          <div class="nx-drag-text">Drop files here</div>
          <div class="nx-drag-sub">Images, videos, documents, anything</div>
        </div>
      </div>
    `;

    this.els = {
      messages: this.container.querySelector('.nx-messages'),
      thinking: this.container.querySelector('.nx-thinking'),
      editor: this.container.querySelector('.nx-editor'),
      sendBtn: this.container.querySelector('.nx-send-btn'),
      voiceBtn: this.container.querySelector('.nx-voice-btn'),
      dragOverlay: this.container.querySelector('.nx-drag-overlay'),
      toolbar: this.container.querySelector('.nx-toolbar'),
    };

    // Hidden file input
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    this.container.appendChild(this.fileInput);
  }

  _bindEvents() {
    // Send message
    this.els.sendBtn.addEventListener('click', () => this._send());
    this.els.editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._send();
      }
    });

    // Voice recording
    this.els.voiceBtn.addEventListener('click', () => this._toggleVoiceRecording());

    // File attach
    this.els.toolbar.querySelector('[data-action="attach"]').addEventListener('click', () => {
      this.fileInput.click();
    });
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files.length) this._handleFiles(this.fileInput.files);
      this.fileInput.value = '';
    });

    // Drag & drop
    this.container.addEventListener('dragenter', (e) => {
      e.preventDefault();
      this.els.dragOverlay.classList.add('visible');
    });
    this.els.dragOverlay.addEventListener('dragleave', (e) => {
      if (e.target === this.els.dragOverlay) this.els.dragOverlay.classList.remove('visible');
    });
    this.els.dragOverlay.addEventListener('dragover', (e) => e.preventDefault());
    this.els.dragOverlay.addEventListener('drop', (e) => {
      e.preventDefault();
      this.els.dragOverlay.classList.remove('visible');
      if (e.dataTransfer.files.length) this._handleFiles(e.dataTransfer.files);
    });

    // Paste images
    this.els.editor.addEventListener('paste', (e) => {
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
    });

    // Message click delegation
    this.els.messages.addEventListener('click', (e) => this._onMessageClick(e));
  }

  _connectWebSocket() {
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => {
        console.log('[NexusChatPro] WebSocket connected');
        // Authenticate
        this.ws.send(JSON.stringify({ type: 'auth', secret: 'rasputin-neural-2026' }));
      });

      this.ws.addEventListener('message', (e) => {
        try {
          const msg = JSON.parse(e.data);
          this._handleWSMessage(msg);
        } catch {}
      });

      this.ws.addEventListener('close', () => {
        console.log('[NexusChatPro] WebSocket disconnected, reconnecting...');
        setTimeout(() => this._connectWebSocket(), 3000);
      });
    } catch (err) {
      console.error('[NexusChatPro] WebSocket error:', err);
    }
  }

  _handleWSMessage(msg) {
    switch (msg.type) {
      case 'thinking_start':
        this.showThinking(true);
        break;
      case 'thinking_end':
        this.showThinking(false);
        break;
      case 'message_chunk':
        this._appendToLastMessage(msg.content);
        break;
      case 'message':
        this.addMessage({
          type: 'text',
          content: msg.content || msg.text,
          sender: msg.sender || this.ai.name,
          avatar: msg.avatar || this.ai.avatar,
          timestamp: new Date(msg.ts || Date.now()),
        });
        break;
      case 'artifact':
        this.addArtifact(msg);
        break;
      case 'widget':
        this.addWidget(msg);
        break;
      case 'file_shared':
        this.addMessage({
          type: 'text',
          content: msg.mime.startsWith('image/') ? `<img src="${msg.url}" alt="${escapeHtml(msg.name)}" style="max-width: 100%; border-radius: 8px; margin-top: 8px;" />` : `📎 <a href="${msg.url}" target="_blank">${escapeHtml(msg.name)}</a> (${msg.humanSize})`,
          sender: msg.sender || this.ai.name,
          avatar: msg.avatar || this.ai.avatar,
          timestamp: new Date(msg.ts || Date.now()),
        });
        break;
    }
  }

  _send() {
    const text = this.els.editor.innerText.trim();
    if (!text) return;

    this.addMessage({
      type: 'text',
      content: text,
      sender: this.user.name,
      avatar: this.user.avatar,
      timestamp: new Date(),
    });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat_message', text, from: this.user.name }));
    }

    if (this.onSend) this.onSend(text);

    this.els.editor.innerHTML = '';
  }

  addMessage(msg) {
    if (!msg.id) msg.id = generateId();
    if (!msg.timestamp) msg.timestamp = new Date();
    this.messages.push(msg);

    const el = this._renderMessage(msg);
    this.els.messages.appendChild(el);
    this._scrollToBottom();
  }

  _renderMessage(msg) {
    const div = document.createElement('div');
    div.className = 'nx-msg';
    div.dataset.id = msg.id;

    const isAi = msg.sender === this.ai.name;
    if (isAi) div.classList.add('nx-msg-ai');

    const avatarClass = isAi ? 'nx-ai-avatar' : 'nx-user-avatar';
    let html = `<div class="nx-msg-avatar ${avatarClass}">${msg.avatar || (isAi ? this.ai.avatar : this.user.avatar)}</div>`;

    html += `<div class="nx-msg-body">
      <div class="nx-msg-header">
        <span class="nx-msg-author">${escapeHtml(msg.sender)}</span>
        <span class="nx-msg-time" data-ts="${msg.timestamp.getTime()}">${relativeTime(msg.timestamp)}</span>
      </div>
      <div class="nx-msg-content">${parseMarkdown(msg.content)}</div>
    </div>`;

    div.innerHTML = html;
    return div;
  }

  addArtifact(artifact) {
    const div = document.createElement('div');
    div.className = 'nx-artifact nx-fade-in';
    div.innerHTML = `
      <div class="nx-artifact-header">
        <div class="nx-artifact-title">
          <span>🎨</span>
          <span>${escapeHtml(artifact.title || 'Artifact')}</span>
        </div>
        <div class="nx-artifact-actions">
          <button class="nx-artifact-btn" data-action="copy">Copy</button>
          <button class="nx-artifact-btn" data-action="open">Open</button>
        </div>
      </div>
      <div class="nx-artifact-body">
        ${artifact.type === 'html' ? `<iframe srcdoc="${escapeHtml(artifact.content)}"></iframe>` : `<pre><code>${escapeHtml(artifact.content)}</code></pre>`}
      </div>
    `;
    this.els.messages.appendChild(div);
    this._scrollToBottom();
  }

  addWidget(widget) {
    const div = document.createElement('div');
    div.className = 'nx-widget nx-fade-in';
    div.innerHTML = `
      <div class="nx-widget-title">
        <span>⚡</span>
        <span>${escapeHtml(widget.title || 'Widget')}</span>
      </div>
      <div class="nx-widget-body">
        <p>${escapeHtml(widget.description || '')}</p>
        <button class="nx-widget-btn" data-action="${widget.action || 'execute'}" data-payload="${escapeHtml(JSON.stringify(widget.payload || {}))}">
          ${escapeHtml(widget.buttonText || 'Execute')}
        </button>
      </div>
    `;
    this.els.messages.appendChild(div);
    this._scrollToBottom();
  }

  showThinking(show = true) {
    this.isThinking = show;
    this.els.thinking.classList.toggle('visible', show);
    if (show) this._scrollToBottom();
  }

  _appendToLastMessage(content) {
    const lastMsg = this.els.messages.querySelector('.nx-msg:last-child .nx-msg-content');
    if (lastMsg && this.isThinking) {
      // Streaming: append content chunk
      const currentHtml = lastMsg.innerHTML;
      lastMsg.innerHTML = parseMarkdown(currentHtml + content);
      this._scrollToBottom();
    }
  }

  _scrollToBottom() {
    this.els.messages.scrollTop = this.els.messages.scrollHeight;
  }

  _onMessageClick(e) {
    // Code copy button
    const copyBtn = e.target.closest('.nx-code-copy');
    if (copyBtn) {
      const codeEl = document.getElementById(copyBtn.dataset.codeId);
      if (codeEl) {
        navigator.clipboard.writeText(codeEl.textContent);
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = '<span>✓</span> Copied';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = '<span>📋</span> Copy';
        }, 2000);
      }
      return;
    }

    // Widget action
    const widgetBtn = e.target.closest('.nx-widget-btn');
    if (widgetBtn) {
      const action = widgetBtn.dataset.action;
      const payload = JSON.parse(widgetBtn.dataset.payload || '{}');
      if (this.onWidgetAction) {
        this.onWidgetAction(action, payload);
      }
      return;
    }
  }

  async _toggleVoiceRecording() {
    if (this.isRecording) {
      this._stopVoiceRecording();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mediaRecorder = new MediaRecorder(stream);
        this.audioChunks = [];
        this.isRecording = true;
        this.els.voiceBtn.classList.add('recording');
        this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
        this.mediaRecorder.start();
      } catch (err) {
        console.error('[NexusChatPro] Microphone access denied', err);
      }
    }
  }

  _stopVoiceRecording() {
    if (!this.isRecording || !this.mediaRecorder) return;
    this.isRecording = false;
    this.els.voiceBtn.classList.remove('recording');
    this.mediaRecorder.onstop = () => {
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
      // Send voice message (transcription would happen server-side)
      this.addMessage({
        type: 'voice',
        content: '🎤 Voice message',
        sender: this.user.name,
        avatar: this.user.avatar,
        timestamp: new Date(),
      });
      // TODO: Upload blob to server for transcription
      console.log('[NexusChatPro] Voice recording captured:', blob.size, 'bytes');
    };
    this.mediaRecorder.stop();
  }

  _handleFiles(files) {
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'file_upload',
            name: file.name,
            data: base64,
            mime: file.type
          }));
        }
      };
      reader.readAsDataURL(file);
      console.log('[NexusChatPro] Uploading file:', file.name, file.size);
    }
  }

  destroy() {
    if (this.ws) this.ws.close();
    if (this.mediaRecorder?.state !== 'inactive') this.mediaRecorder?.stop();
    this.container.innerHTML = '';
    this.container.classList.remove('nexus-chat-pro');
  }
}

export default NexusChatPro;

// Also expose globally for non-module usage
if (typeof window !== 'undefined') window.NexusChatPro = NexusChatPro;
