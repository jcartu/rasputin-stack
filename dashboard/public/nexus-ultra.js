/**
 * ✦ NEXUS ULTRA — Next-Generation Chat Interface
 * Version: ULTRA-PREMIUM (5-Stage Evolution Complete)
 * 
 * Iteration 1: Core (Markdown, D&D, Streaming)
 * Iteration 2: Visual Polish (Animations, Cyberpunk/Gumballer, Icons)
 * Iteration 3: Media (Images, Video, Voice Waveforms)
 * Iteration 4: Artifacts (Claude-style slide-out panel)
 * Iteration 5: Widgets (Interactive buttons, charts, real-time feedback)
 * 
 * Built for: Rasputin Neural Dashboard v4
 * Target: Ultra-premium quality exceeding Claude.ai/ChatGPT/Perplexity
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚡ ULTRA-PREMIUM STYLES — Cyberpunk/Gumballer Theme
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NEXUS_ULTRA_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700;800&display=swap');
@import url('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css');
@import url('https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css');

:root {
  /* Ultra Color System — Gumballer Cyberpunk */
  --ultra-void: #05050a;
  --ultra-base: #0a0a12;
  --ultra-surface: #0f0f1a;
  --ultra-elevated: #141422;
  --ultra-raised: #1a1a2e;
  
  --ultra-text: #f0f0f5;
  --ultra-text-dim: rgba(240,240,245,0.7);
  --ultra-text-ghost: rgba(240,240,245,0.4);
  --ultra-text-whisper: rgba(240,240,245,0.2);
  
  /* Vibrant Accents */
  --ultra-purple: #a78bfa;
  --ultra-purple-bright: #c4b5fd;
  --ultra-cyan: #06b6d4;
  --ultra-cyan-bright: #22d3ee;
  --ultra-pink: #f472b6;
  --ultra-pink-bright: #f9a8d4;
  --ultra-green: #34d399;
  --ultra-green-bright: #6ee7b7;
  --ultra-amber: #fbbf24;
  --ultra-amber-bright: #fcd34d;
  --ultra-red: #f87171;
  --ultra-red-bright: #fca5a5;
  --ultra-blue: #60a5fa;
  --ultra-orange: #fb923c;
  
  /* Glass & Glow */
  --ultra-glass: rgba(255,255,255,0.03);
  --ultra-glass-strong: rgba(255,255,255,0.06);
  --ultra-glass-border: rgba(255,255,255,0.1);
  --ultra-glow-purple: 0 0 40px rgba(167,139,250,0.4);
  --ultra-glow-cyan: 0 0 40px rgba(6,182,212,0.4);
  --ultra-glow-pink: 0 0 40px rgba(244,114,182,0.4);
  --ultra-glow-green: 0 0 40px rgba(52,211,153,0.4);
  
  /* Typography */
  --ultra-font-display: 'Space Grotesk', system-ui, sans-serif;
  --ultra-font-body: 'Inter', system-ui, sans-serif;
  --ultra-font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  
  /* Spacing & Radius */
  --ultra-radius: 16px;
  --ultra-radius-sm: 10px;
  --ultra-radius-lg: 24px;
  --ultra-radius-xl: 32px;
  
  /* Transitions */
  --ultra-snap: cubic-bezier(0.16, 1, 0.3, 1);
  --ultra-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ultra-smooth: cubic-bezier(0.22, 1, 0.36, 1);
  
  /* Shadows */
  --ultra-shadow: 0 8px 48px rgba(0,0,0,0.6);
  --ultra-shadow-lg: 0 16px 80px rgba(0,0,0,0.8);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

.nexus-ultra {
  display: flex;
  height: 100vh;
  width: 100vw;
  background: var(--ultra-void);
  color: var(--ultra-text);
  font-family: var(--ultra-font-body);
  font-size: 15px;
  line-height: 1.65;
  position: relative;
  overflow: hidden;
}

/* ━━━ Scrollbar ━━━ */
.nexus-ultra ::-webkit-scrollbar { width: 6px; height: 6px; }
.nexus-ultra ::-webkit-scrollbar-track { background: transparent; }
.nexus-ultra ::-webkit-scrollbar-thumb {
  background: rgba(167,139,250,0.3);
  border-radius: 3px;
  transition: background 0.2s;
}
.nexus-ultra ::-webkit-scrollbar-thumb:hover {
  background: rgba(167,139,250,0.5);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ⚡ MAIN CHAT AREA
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

.ultra-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  transition: margin-right 0.4s var(--ultra-smooth);
}

.ultra-main.artifact-open {
  margin-right: 45%;
}

/* ━━━ Header ━━━ */
.ultra-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
  background: linear-gradient(135deg, var(--ultra-base), var(--ultra-surface));
  border-bottom: 1px solid var(--ultra-glass-border);
  backdrop-filter: blur(20px);
  z-index: 20;
}

.ultra-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.ultra-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--ultra-purple), var(--ultra-pink));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  position: relative;
  box-shadow: var(--ultra-glow-purple);
  animation: ultra-pulse-glow 3s infinite;
}

@keyframes ultra-pulse-glow {
  0%, 100% { box-shadow: 0 0 20px rgba(167,139,250,0.4); }
  50% { box-shadow: 0 0 40px rgba(167,139,250,0.7); }
}

.ultra-avatar::after {
  content: '';
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 14px;
  height: 14px;
  background: var(--ultra-green);
  border: 3px solid var(--ultra-base);
  border-radius: 50%;
  box-shadow: 0 0 12px rgba(52,211,153,0.6);
}

.ultra-header-info h1 {
  font-family: var(--ultra-font-display);
  font-size: 18px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--ultra-purple-bright), var(--ultra-cyan-bright));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.02em;
}

.ultra-header-info .ultra-status {
  font-size: 13px;
  color: var(--ultra-text-dim);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.ultra-enc-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  background: rgba(52,211,153,0.12);
  border: 1px solid rgba(52,211,153,0.3);
  border-radius: 12px;
  color: var(--ultra-green);
  box-shadow: 0 0 16px rgba(52,211,153,0.2);
}

.ultra-header-actions {
  display: flex;
  gap: 8px;
}

.ultra-icon-btn {
  width: 40px;
  height: 40px;
  border: 1px solid var(--ultra-glass-border);
  background: var(--ultra-glass);
  color: var(--ultra-text-dim);
  border-radius: var(--ultra-radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s var(--ultra-snap);
  font-size: 18px;
}

.ultra-icon-btn:hover {
  background: var(--ultra-glass-strong);
  border-color: var(--ultra-purple);
  color: var(--ultra-purple-bright);
  box-shadow: var(--ultra-glow-purple);
  transform: translateY(-2px);
}

.ultra-icon-btn.active {
  background: rgba(167,139,250,0.15);
  border-color: var(--ultra-purple);
  color: var(--ultra-purple-bright);
  box-shadow: var(--ultra-glow-purple);
}

/* ━━━ Messages Area ━━━ */
.ultra-messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  scroll-behavior: smooth;
  position: relative;
}

/* ━━━ Message Bubble ━━━ */
.ultra-msg {
  display: flex;
  gap: 14px;
  padding: 12px 16px;
  border-radius: var(--ultra-radius);
  position: relative;
  transition: all 0.3s var(--ultra-smooth);
  animation: ultra-msg-slide-in 0.5s var(--ultra-spring);
  opacity: 0;
  animation-fill-mode: forwards;
}

@keyframes ultra-msg-slide-in {
  0% { opacity: 0; transform: translateY(20px) scale(0.96); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

.ultra-msg:hover {
  background: var(--ultra-glass);
}

.ultra-msg-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  margin-top: 4px;
  position: relative;
  transition: transform 0.3s var(--ultra-spring);
}

.ultra-msg:hover .ultra-msg-avatar {
  transform: scale(1.08) rotate(5deg);
}

.ultra-msg-avatar.ai {
  background: linear-gradient(135deg, rgba(167,139,250,0.2), rgba(6,182,212,0.15));
  box-shadow: 0 0 24px rgba(167,139,250,0.3);
  border: 2px solid rgba(167,139,250,0.2);
}

.ultra-msg-avatar.ai::after {
  content: '✦';
  position: absolute;
  bottom: -3px;
  right: -3px;
  font-size: 12px;
  color: var(--ultra-cyan-bright);
  background: var(--ultra-base);
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 12px rgba(6,182,212,0.5);
}

.ultra-msg-avatar.user {
  background: var(--ultra-glass-strong);
  border: 2px solid var(--ultra-glass-border);
}

.ultra-msg-body {
  flex: 1;
  min-width: 0;
}

.ultra-msg-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}

.ultra-msg-author {
  font-family: var(--ultra-font-display);
  font-weight: 700;
  font-size: 16px;
  background: linear-gradient(135deg, var(--ultra-text), var(--ultra-text-dim));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ultra-msg.ai .ultra-msg-author {
  background: linear-gradient(135deg, var(--ultra-purple-bright), var(--ultra-cyan-bright));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ultra-msg-time {
  font-size: 12px;
  color: var(--ultra-text-ghost);
  font-weight: 500;
}

/* ━━━ Message Content — Rich Markdown ━━━ */
.ultra-msg-content {
  color: var(--ultra-text);
  line-height: 1.8;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.ultra-msg-content p { margin-bottom: 14px; }
.ultra-msg-content p:last-child { margin-bottom: 0; }

.ultra-msg-content strong {
  font-weight: 700;
  color: var(--ultra-purple-bright);
}

.ultra-msg-content em { font-style: italic; color: var(--ultra-cyan-bright); }

.ultra-msg-content a {
  color: var(--ultra-purple-bright);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: all 0.25s;
  position: relative;
}

.ultra-msg-content a:hover {
  border-bottom-color: var(--ultra-purple-bright);
  text-shadow: 0 0 8px rgba(167,139,250,0.5);
}

.ultra-msg-content code {
  font-family: var(--ultra-font-mono);
  font-size: 13.5px;
  background: rgba(167,139,250,0.12);
  color: var(--ultra-purple-bright);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(167,139,250,0.25);
  box-shadow: 0 0 12px rgba(167,139,250,0.15);
}

.ultra-msg-content h1, .ultra-msg-content h2, .ultra-msg-content h3 {
  font-family: var(--ultra-font-display);
  font-weight: 700;
  margin: 20px 0 12px;
  background: linear-gradient(135deg, var(--ultra-text), var(--ultra-purple-bright));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ultra-msg-content h1 { font-size: 26px; }
.ultra-msg-content h2 { font-size: 22px; }
.ultra-msg-content h3 { font-size: 18px; }

.ultra-msg-content ul, .ultra-msg-content ol {
  padding-left: 26px;
  margin: 14px 0;
}

.ultra-msg-content li {
  margin: 8px 0;
  padding-left: 6px;
}

.ultra-msg-content li::marker {
  color: var(--ultra-purple);
}

.ultra-msg-content blockquote {
  border-left: 4px solid var(--ultra-purple);
  padding: 12px 18px;
  margin: 16px 0;
  background: rgba(167,139,250,0.08);
  border-radius: 0 var(--ultra-radius-sm) var(--ultra-radius-sm) 0;
  color: var(--ultra-text-dim);
  position: relative;
  box-shadow: 0 0 20px rgba(167,139,250,0.1);
}

/* ━━━ Code Blocks ━━━ */
.ultra-code-block {
  margin: 18px 0;
  border-radius: var(--ultra-radius);
  overflow: hidden;
  border: 1px solid var(--ultra-glass-border);
  background: rgba(0,0,0,0.6);
  box-shadow: var(--ultra-shadow);
  transition: all 0.3s var(--ultra-smooth);
}

.ultra-code-block:hover {
  box-shadow: var(--ultra-shadow-lg), var(--ultra-glow-purple);
  border-color: var(--ultra-purple);
  transform: translateY(-2px);
}

.ultra-code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px;
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid var(--ultra-glass-border);
}

.ultra-code-lang {
  font-family: var(--ultra-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--ultra-purple-bright);
  text-transform: uppercase;
  letter-spacing: 1.5px;
}

.ultra-code-copy {
  background: transparent;
  border: 1px solid var(--ultra-glass-border);
  color: var(--ultra-text-dim);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 8px;
  transition: all 0.25s var(--ultra-snap);
  display: flex;
  align-items: center;
  gap: 6px;
}

.ultra-code-copy:hover {
  background: var(--ultra-glass-strong);
  border-color: var(--ultra-purple);
  color: var(--ultra-purple-bright);
  box-shadow: var(--ultra-glow-purple);
  transform: translateY(-1px);
}

.ultra-code-copy.copied {
  background: rgba(52,211,153,0.15);
  border-color: var(--ultra-green);
  color: var(--ultra-green);
  box-shadow: var(--ultra-glow-green);
}

.ultra-code-block pre {
  margin: 0;
  padding: 20px 22px;
  overflow-x: auto;
  font-family: var(--ultra-font-mono);
  font-size: 14px;
  line-height: 1.7;
  background: transparent !important;
}

/* ━━━ Thinking Indicator ━━━ */
.ultra-thinking {
  display: none;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  margin: 12px 0;
  background: linear-gradient(135deg, rgba(167,139,250,0.08), rgba(6,182,212,0.06));
  border: 1px solid rgba(167,139,250,0.2);
  border-radius: var(--ultra-radius);
  box-shadow: 0 0 32px rgba(167,139,250,0.2);
  animation: ultra-thinking-pulse 2s infinite;
}

@keyframes ultra-thinking-pulse {
  0%, 100% { box-shadow: 0 0 24px rgba(167,139,250,0.2); }
  50% { box-shadow: 0 0 48px rgba(167,139,250,0.4); }
}

.ultra-thinking.visible { display: flex; }

.ultra-thinking-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--ultra-purple), var(--ultra-cyan));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  animation: ultra-thinking-rotate 3s linear infinite;
}

@keyframes ultra-thinking-rotate {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.ultra-thinking-text {
  font-size: 15px;
  font-weight: 600;
  background: linear-gradient(135deg, var(--ultra-purple-bright), var(--ultra-cyan-bright));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ultra-thinking-dots {
  display: flex;
  gap: 6px;
}

.ultra-thinking-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ultra-purple);
  animation: ultra-dot-bounce 1.4s infinite;
}

.ultra-thinking-dot:nth-child(2) { animation-delay: 0.2s; }
.ultra-thinking-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes ultra-dot-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-10px); opacity: 1; box-shadow: 0 0 12px var(--ultra-purple); }
}

/* ━━━ Media — Images ━━━ */
.ultra-img {
  margin: 16px 0;
  max-width: 560px;
  border-radius: var(--ultra-radius);
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--ultra-glass-border);
  transition: all 0.4s var(--ultra-smooth);
  position: relative;
}

.ultra-img:hover {
  box-shadow: var(--ultra-shadow-lg), var(--ultra-glow-purple);
  transform: scale(1.02) translateY(-4px);
  border-color: var(--ultra-purple);
}

.ultra-img img {
  width: 100%;
  display: block;
  transition: transform 0.4s var(--ultra-smooth);
}

.ultra-img:hover img {
  transform: scale(1.05);
}

/* ━━━ Media — Video ━━━ */
.ultra-video {
  margin: 16px 0;
  max-width: 640px;
  border-radius: var(--ultra-radius);
  overflow: hidden;
  border: 1px solid var(--ultra-glass-border);
  background: #000;
  box-shadow: var(--ultra-shadow);
}

.ultra-video video {
  width: 100%;
  display: block;
}

/* ━━━ Media — Voice Waveform ━━━ */
.ultra-voice {
  margin: 16px 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  background: var(--ultra-glass);
  border: 1px solid var(--ultra-glass-border);
  border-radius: 24px;
  max-width: 400px;
  transition: all 0.3s var(--ultra-smooth);
}

.ultra-voice:hover {
  background: var(--ultra-glass-strong);
  border-color: var(--ultra-purple);
  box-shadow: var(--ultra-glow-purple);
}

.ultra-voice-play {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--ultra-purple), var(--ultra-cyan));
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  transition: all 0.25s var(--ultra-snap);
  box-shadow: 0 4px 16px rgba(167,139,250,0.4);
}

.ultra-voice-play:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 24px rgba(167,139,250,0.6);
}

.ultra-voice-wave {
  flex: 1;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 2px;
}

.ultra-voice-bar {
  width: 3px;
  border-radius: 2px;
  background: var(--ultra-text-ghost);
  transition: all 0.15s;
}

.ultra-voice-bar.active {
  background: var(--ultra-purple);
  box-shadow: 0 0 8px var(--ultra-purple);
}

.ultra-voice-time {
  font-size: 12px;
  font-weight: 600;
  color: var(--ultra-text-dim);
  font-family: var(--ultra-font-mono);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ⚡ ITERATION 4: ARTIFACT ENGINE (Claude-style slide-out panel)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

.ultra-artifact-panel {
  position: fixed;
  right: 0;
  top: 0;
  width: 45%;
  height: 100vh;
  background: var(--ultra-base);
  border-left: 1px solid var(--ultra-glass-border);
  transform: translateX(100%);
  transition: transform 0.4s var(--ultra-smooth);
  z-index: 100;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 48px rgba(0,0,0,0.8);
}

.ultra-artifact-panel.open {
  transform: translateX(0);
}

.ultra-artifact-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  background: var(--ultra-surface);
  border-bottom: 1px solid var(--ultra-glass-border);
}

.ultra-artifact-title {
  font-family: var(--ultra-font-display);
  font-size: 17px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--ultra-cyan-bright), var(--ultra-purple-bright));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  display: flex;
  align-items: center;
  gap: 10px;
}

.ultra-artifact-actions {
  display: flex;
  gap: 8px;
}

.ultra-artifact-body {
  flex: 1;
  overflow: auto;
  padding: 24px;
}

.ultra-artifact-body iframe {
  width: 100%;
  min-height: 600px;
  border: 1px solid var(--ultra-glass-border);
  border-radius: var(--ultra-radius);
  background: white;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ⚡ ITERATION 5: INTERACTIVE WIDGETS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

.ultra-widget {
  margin: 18px 0;
  padding: 20px 24px;
  background: linear-gradient(135deg, rgba(52,211,153,0.08), rgba(6,182,212,0.06));
  border: 1px solid rgba(52,211,153,0.3);
  border-radius: var(--ultra-radius-lg);
  box-shadow: 0 8px 32px rgba(52,211,153,0.2);
  transition: all 0.3s var(--ultra-smooth);
  position: relative;
  overflow: hidden;
}

.ultra-widget::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--ultra-green), var(--ultra-cyan));
  box-shadow: 0 0 16px var(--ultra-green);
}

.ultra-widget:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 48px rgba(52,211,153,0.3), var(--ultra-glow-green);
  border-color: var(--ultra-green);
}

.ultra-widget-title {
  font-family: var(--ultra-font-display);
  font-size: 17px;
  font-weight: 700;
  color: var(--ultra-green-bright);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.ultra-widget-desc {
  color: var(--ultra-text-dim);
  margin-bottom: 16px;
  line-height: 1.6;
}

.ultra-widget-btn {
  background: linear-gradient(135deg, var(--ultra-green), var(--ultra-cyan));
  border: none;
  color: white;
  cursor: pointer;
  font-size: 15px;
  font-weight: 700;
  padding: 12px 24px;
  border-radius: var(--ultra-radius);
  transition: all 0.25s var(--ultra-snap);
  box-shadow: 0 4px 20px rgba(52,211,153,0.4);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ultra-widget-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 28px rgba(52,211,153,0.6);
}

.ultra-widget-btn:active {
  transform: translateY(0);
}

/* Mini Chart Container */
.ultra-chart {
  margin: 18px 0;
  padding: 20px;
  background: var(--ultra-glass);
  border: 1px solid var(--ultra-glass-border);
  border-radius: var(--ultra-radius);
  box-shadow: var(--ultra-shadow);
}

.ultra-chart canvas {
  max-width: 100%;
  height: auto;
}

/* Progress Bar */
.ultra-progress {
  margin: 18px 0;
  padding: 16px 20px;
  background: var(--ultra-glass);
  border: 1px solid var(--ultra-glass-border);
  border-radius: var(--ultra-radius);
}

.ultra-progress-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
}

.ultra-progress-bar {
  height: 8px;
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.ultra-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ultra-purple), var(--ultra-cyan));
  border-radius: 4px;
  transition: width 0.5s var(--ultra-smooth);
  box-shadow: 0 0 16px rgba(167,139,250,0.6);
  position: relative;
}

.ultra-progress-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
  animation: ultra-progress-shimmer 2s infinite;
}

@keyframes ultra-progress-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ⚡ INPUT AREA
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

.ultra-input-area {
  padding: 20px 28px 24px;
  background: linear-gradient(135deg, var(--ultra-base), var(--ultra-surface));
  border-top: 1px solid var(--ultra-glass-border);
  backdrop-filter: blur(20px);
}

.ultra-toolbar {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.ultra-toolbar-btn {
  width: 36px;
  height: 36px;
  border: 1px solid var(--ultra-glass-border);
  background: var(--ultra-glass);
  color: var(--ultra-text-dim);
  border-radius: var(--ultra-radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s var(--ultra-snap);
  font-weight: 700;
}

.ultra-toolbar-btn:hover {
  background: var(--ultra-glass-strong);
  border-color: var(--ultra-purple);
  color: var(--ultra-purple-bright);
  box-shadow: var(--ultra-glow-purple);
  transform: translateY(-2px);
}

.ultra-editor-wrap {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  background: var(--ultra-glass);
  border: 2px solid var(--ultra-glass-border);
  border-radius: var(--ultra-radius-lg);
  padding: 14px 18px;
  transition: all 0.3s var(--ultra-smooth);
}

.ultra-editor-wrap:focus-within {
  border-color: var(--ultra-purple);
  box-shadow: var(--ultra-glow-purple);
  background: var(--ultra-glass-strong);
}

.ultra-editor {
  flex: 1;
  max-height: 200px;
  min-height: 24px;
  overflow-y: auto;
  outline: none;
  color: var(--ultra-text);
  font-family: var(--ultra-font-body);
  font-size: 15px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.ultra-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--ultra-text-ghost);
  pointer-events: none;
}

.ultra-send-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--ultra-purple), var(--ultra-cyan));
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
  transition: all 0.25s var(--ultra-snap);
  box-shadow: 0 4px 20px rgba(167,139,250,0.5);
}

.ultra-send-btn:hover {
  transform: scale(1.1) translateY(-2px);
  box-shadow: 0 8px 32px rgba(167,139,250,0.7);
}

.ultra-send-btn:active {
  transform: scale(0.95);
}

.ultra-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ultra-voice-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: transparent;
  border: 2px solid var(--ultra-glass-border);
  color: var(--ultra-text-dim);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  transition: all 0.25s var(--ultra-snap);
}

.ultra-voice-btn:hover {
  border-color: var(--ultra-purple);
  color: var(--ultra-purple-bright);
  box-shadow: var(--ultra-glow-purple);
  transform: scale(1.05);
}

.ultra-voice-btn.recording {
  background: var(--ultra-red);
  border-color: var(--ultra-red);
  color: white;
  animation: ultra-recording-pulse 1.5s infinite;
}

@keyframes ultra-recording-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(248,113,113,0.7); }
  50% { box-shadow: 0 0 0 16px rgba(248,113,113,0); }
}

/* ━━━ Drag & Drop Overlay ━━━ */
.ultra-drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(5,5,10,0.96);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 200;
  border: 3px dashed var(--ultra-purple);
  border-radius: var(--ultra-radius-xl);
  margin: 20px;
  backdrop-filter: blur(12px);
}

.ultra-drag-overlay.visible { display: flex; }

.ultra-drag-content {
  text-align: center;
  animation: ultra-drag-float 2s ease-in-out infinite;
}

@keyframes ultra-drag-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-16px); }
}

.ultra-drag-icon {
  font-size: 80px;
  margin-bottom: 20px;
  filter: drop-shadow(0 0 32px var(--ultra-purple));
}

.ultra-drag-text {
  font-family: var(--ultra-font-display);
  font-size: 28px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--ultra-purple-bright), var(--ultra-cyan-bright));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 10px;
}

.ultra-drag-sub {
  font-size: 16px;
  color: var(--ultra-text-dim);
}

/* ━━━ Utilities ━━━ */
.ultra-hidden { display: none !important; }

/* ━━━ Mobile Responsiveness ━━━ */
@media (max-width: 1024px) {
  .ultra-artifact-panel {
    width: 100%;
  }
  .ultra-main.artifact-open {
    margin-right: 0;
  }
}
`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚡ UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function generateId() {
  return 'ultra_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
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

// Load external dependencies
let katex, Prism, Chart;

function loadDeps() {
  if (!window.katex) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
    s.onload = () => { katex = window.katex; };
    document.head.appendChild(s);
  } else katex = window.katex;

  if (!window.Prism) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js';
    s.setAttribute('data-manual', 'true');
    s.onload = () => {
      ['javascript','python','bash','css','markup','json','typescript','rust','go'].forEach(l => {
        const sc = document.createElement('script');
        sc.src = `https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-${l}.min.js`;
        document.head.appendChild(sc);
      });
      Prism = window.Prism;
    };
    document.head.appendChild(s);
  } else Prism = window.Prism;

  if (!window.Chart) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = () => { Chart = window.Chart; };
    document.head.appendChild(s);
  } else Chart = window.Chart;
}

// Markdown parser with LaTeX
function parseMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // LaTeX
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    try {
      return katex ? katex.renderToString(tex, { displayMode: true, throwOnError: false }) : `$$${tex}$$`;
    } catch { return `$$${tex}$$`; }
  });
  html = html.replace(/\$([^\$\n]+?)\$/g, (_, tex) => {
    try {
      return katex ? katex.renderToString(tex, { displayMode: false, throwOnError: false }) : `$${tex}$`;
    } catch { return `$${tex}$`; }
  });

  // Code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = generateId();
    let hl = escapeHtml(code.trim());
    if (Prism && lang && Prism.languages[lang]) {
      try { hl = Prism.highlight(code.trim(), Prism.languages[lang], lang); } catch {}
    }
    return `<div class="ultra-code-block"><div class="ultra-code-header"><span class="ultra-code-lang">${lang||'text'}</span><button class="ultra-code-copy" data-id="${id}">📋 Copy</button></div><pre id="${id}"><code>${hl}</code></pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold/Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(^|[^"=])((https?:\/\/)[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Lists
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/(<\/(h[1-3]|ul|blockquote|div|pre)>)<br>/g, '$1');

  return html;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚡ NEXUS ULTRA CLASS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class NexusUltra {
  constructor(opts = {}) {
    this.container = opts.container;
    this.wsUrl = opts.wsUrl || 'ws://localhost:9001';
    this.user = opts.user || { name: 'User', avatar: '👤' };
    this.ai = opts.ai || { name: 'Rasputin', avatar: '🧠' };
    this.onSend = opts.onSend || null;
    this.onWidgetAction = opts.onWidgetAction || null;

    this.messages = [];
    this.artifacts = [];
    this.currentArtifact = null;
    this.ws = null;
    this.isThinking = false;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];

    this._init();
  }

  _init() {
    loadDeps();
    this._injectStyles();
    this._buildDOM();
    this._bindEvents();
    this._connectWS();
  }

  _injectStyles() {
    if (document.getElementById('nexus-ultra-styles')) return;
    const style = document.createElement('style');
    style.id = 'nexus-ultra-styles';
    style.textContent = NEXUS_ULTRA_STYLES;
    document.head.appendChild(style);
  }

  _buildDOM() {
    this.container.innerHTML = '';
    this.container.classList.add('nexus-ultra');

    this.container.innerHTML = `
      <div class="ultra-main">
        <div class="ultra-header">
          <div class="ultra-header-left">
            <div class="ultra-avatar">${this.ai.avatar}</div>
            <div class="ultra-header-info">
              <h1>${escapeHtml(this.ai.name)}</h1>
              <div class="ultra-status">
                <span>Online</span>
                <span class="ultra-enc-badge">🔒 E2E</span>
              </div>
            </div>
          </div>
          <div class="ultra-header-actions">
            <button class="ultra-icon-btn" data-action="artifacts" title="Artifacts">📋</button>
            <button class="ultra-icon-btn" data-action="info" title="Info">ℹ️</button>
          </div>
        </div>

        <div class="ultra-messages"></div>

        <div class="ultra-thinking">
          <div class="ultra-thinking-avatar">${this.ai.avatar}</div>
          <span class="ultra-thinking-text">Thinking</span>
          <div class="ultra-thinking-dots">
            <div class="ultra-thinking-dot"></div>
            <div class="ultra-thinking-dot"></div>
            <div class="ultra-thinking-dot"></div>
          </div>
        </div>

        <div class="ultra-input-area">
          <div class="ultra-toolbar">
            <button class="ultra-toolbar-btn" data-format="bold" title="Bold">B</button>
            <button class="ultra-toolbar-btn" data-format="italic" title="Italic"><i>I</i></button>
            <button class="ultra-toolbar-btn" data-format="code" title="Code">⟨/⟩</button>
            <button class="ultra-toolbar-btn" data-action="attach" title="Attach">📎</button>
          </div>
          <div class="ultra-editor-wrap">
            <div class="ultra-editor" contenteditable="true" data-placeholder="Type a message..."></div>
            <button class="ultra-voice-btn" title="Voice">🎤</button>
            <button class="ultra-send-btn" title="Send">↑</button>
          </div>
        </div>

        <div class="ultra-drag-overlay">
          <div class="ultra-drag-content">
            <div class="ultra-drag-icon">📁</div>
            <div class="ultra-drag-text">Drop files here</div>
            <div class="ultra-drag-sub">Images, videos, documents, code</div>
          </div>
        </div>
      </div>

      <div class="ultra-artifact-panel">
        <div class="ultra-artifact-header">
          <div class="ultra-artifact-title">
            <span>🎨</span>
            <span>Artifact</span>
          </div>
          <div class="ultra-artifact-actions">
            <button class="ultra-icon-btn" data-action="artifact-close">✕</button>
          </div>
        </div>
        <div class="ultra-artifact-body"></div>
      </div>
    `;

    this.els = {
      main: this.container.querySelector('.ultra-main'),
      messages: this.container.querySelector('.ultra-messages'),
      thinking: this.container.querySelector('.ultra-thinking'),
      editor: this.container.querySelector('.ultra-editor'),
      sendBtn: this.container.querySelector('.ultra-send-btn'),
      voiceBtn: this.container.querySelector('.ultra-voice-btn'),
      dragOverlay: this.container.querySelector('.ultra-drag-overlay'),
      artifactPanel: this.container.querySelector('.ultra-artifact-panel'),
      artifactBody: this.container.querySelector('.ultra-artifact-body'),
      artifactTitle: this.container.querySelector('.ultra-artifact-title span:last-child'),
    };

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    this.container.appendChild(this.fileInput);
  }

  _bindEvents() {
    this.els.sendBtn.addEventListener('click', () => this._send());
    this.els.editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
    });

    this.els.voiceBtn.addEventListener('click', () => this._toggleVoice());

    this.container.querySelector('[data-action="attach"]').addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files.length) this._handleFiles(this.fileInput.files);
      this.fileInput.value = '';
    });

    // Drag & drop
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

    // Paste
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

    // Artifact panel
    this.container.querySelector('[data-action="artifacts"]').addEventListener('click', () => {
      if (this.artifacts.length > 0) this.showArtifact(this.artifacts[this.artifacts.length - 1]);
    });
    this.container.querySelector('[data-action="artifact-close"]').addEventListener('click', () => this.closeArtifact());

    // Message clicks
    this.els.messages.addEventListener('click', (e) => this._onMsgClick(e));
  }

  _connectWS() {
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => {
        console.log('[NexusUltra] Connected');
        this.ws.send(JSON.stringify({ type: 'auth', secret: 'rasputin-neural-2026' }));
      });
      this.ws.addEventListener('message', (e) => {
        try {
          const msg = JSON.parse(e.data);
          this._handleWSMsg(msg);
        } catch {}
      });
      this.ws.addEventListener('close', () => {
        console.log('[NexusUltra] Disconnected, reconnecting...');
        setTimeout(() => this._connectWS(), 3000);
      });
    } catch (err) {
      console.error('[NexusUltra] WS error:', err);
    }
  }

  _handleWSMsg(msg) {
    switch (msg.type) {
      case 'thinking_start': this.showThinking(true); break;
      case 'thinking_end': this.showThinking(false); break;
      case 'message': this.addMessage({ content: msg.content || msg.text, sender: this.ai.name }); break;
      case 'artifact': this.addArtifact(msg); break;
      case 'widget': this.addWidget(msg); break;
    }
  }

  _send() {
    const text = this.els.editor.innerText.trim();
    if (!text) return;
    this.addMessage({ content: text, sender: this.user.name, avatar: this.user.avatar });
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
    const el = this._renderMsg(msg);
    this.els.messages.appendChild(el);
    this._scrollBottom();
  }

  _renderMsg(msg) {
    const div = document.createElement('div');
    div.className = 'ultra-msg';
    div.dataset.id = msg.id;
    div.style.animationDelay = '0.' + (this.messages.length % 10) + 's';

    const isAi = msg.sender === this.ai.name;
    if (isAi) div.classList.add('ai');

    const avatarClass = isAi ? 'ai' : 'user';
    let html = `<div class="ultra-msg-avatar ${avatarClass}">${msg.avatar || (isAi ? this.ai.avatar : this.user.avatar)}</div>`;

    html += `<div class="ultra-msg-body">
      <div class="ultra-msg-header">
        <span class="ultra-msg-author">${escapeHtml(msg.sender)}</span>
        <span class="ultra-msg-time">${relativeTime(msg.timestamp)}</span>
      </div>
      <div class="ultra-msg-content">${parseMarkdown(msg.content)}</div>
    </div>`;

    div.innerHTML = html;
    return div;
  }

  addArtifact(art) {
    this.artifacts.push(art);
    this.showArtifact(art);
  }

  showArtifact(art) {
    this.currentArtifact = art;
    this.els.artifactTitle.textContent = art.title || 'Artifact';
    if (art.type === 'html') {
      this.els.artifactBody.innerHTML = `<iframe srcdoc="${escapeHtml(art.content)}" sandbox="allow-scripts"></iframe>`;
    } else {
      this.els.artifactBody.innerHTML = `<pre><code>${escapeHtml(art.content)}</code></pre>`;
    }
    this.els.artifactPanel.classList.add('open');
    this.els.main.classList.add('artifact-open');
  }

  closeArtifact() {
    this.els.artifactPanel.classList.remove('open');
    this.els.main.classList.remove('artifact-open');
  }

  addWidget(w) {
    const div = document.createElement('div');
    div.className = 'ultra-widget ultra-msg';
    div.style.animationDelay = '0.' + (this.messages.length % 10) + 's';
    div.innerHTML = `
      <div class="ultra-widget-title">
        <span>${w.icon || '⚡'}</span>
        <span>${escapeHtml(w.title || 'Widget')}</span>
      </div>
      <div class="ultra-widget-desc">${escapeHtml(w.description || '')}</div>
      <button class="ultra-widget-btn" data-action="${w.action}" data-payload='${JSON.stringify(w.payload || {})}'>
        ${escapeHtml(w.buttonText || 'Execute')}
      </button>
    `;
    this.els.messages.appendChild(div);
    this._scrollBottom();
  }

  addProgress(label, pct) {
    const div = document.createElement('div');
    div.className = 'ultra-progress ultra-msg';
    div.innerHTML = `
      <div class="ultra-progress-label">
        <span>${escapeHtml(label)}</span>
        <span>${pct}%</span>
      </div>
      <div class="ultra-progress-bar">
        <div class="ultra-progress-fill" style="width:${pct}%"></div>
      </div>
    `;
    this.els.messages.appendChild(div);
    this._scrollBottom();
  }

  showThinking(show) {
    this.isThinking = show;
    this.els.thinking.classList.toggle('visible', show);
    if (show) this._scrollBottom();
  }

  _scrollBottom() {
    this.els.messages.scrollTop = this.els.messages.scrollHeight;
  }

  _onMsgClick(e) {
    const copyBtn = e.target.closest('.ultra-code-copy');
    if (copyBtn) {
      const code = document.getElementById(copyBtn.dataset.id);
      if (code) {
        navigator.clipboard.writeText(code.textContent);
        copyBtn.classList.add('copied');
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.textContent = '📋 Copy';
        }, 2000);
      }
      return;
    }

    const widgetBtn = e.target.closest('.ultra-widget-btn');
    if (widgetBtn) {
      const action = widgetBtn.dataset.action;
      const payload = JSON.parse(widgetBtn.dataset.payload || '{}');
      if (this.onWidgetAction) this.onWidgetAction(action, payload);
      return;
    }

    const img = e.target.closest('.ultra-img');
    if (img) {
      // Open lightbox
      return;
    }
  }

  async _toggleVoice() {
    if (this.isRecording) {
      this._stopVoice();
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
        console.error('[NexusUltra] Mic access denied', err);
      }
    }
  }

  _stopVoice() {
    if (!this.isRecording || !this.mediaRecorder) return;
    this.isRecording = false;
    this.els.voiceBtn.classList.remove('recording');
    this.mediaRecorder.onstop = () => {
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
      this.addMessage({ content: '🎤 Voice message', sender: this.user.name, avatar: this.user.avatar });
      console.log('[NexusUltra] Voice recorded:', blob.size, 'bytes');
    };
    this.mediaRecorder.stop();
  }

  _handleFiles(files) {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        const div = document.createElement('div');
        div.className = 'ultra-img ultra-msg';
        div.innerHTML = `<img src="${url}" alt="${escapeHtml(file.name)}" />`;
        this.els.messages.appendChild(div);
        this._scrollBottom();
      } else {
        this.addMessage({ content: `📎 ${escapeHtml(file.name)} (${(file.size/1024/1024).toFixed(2)}MB)`, sender: this.user.name });
      }
    }
  }

  destroy() {
    if (this.ws) this.ws.close();
    if (this.mediaRecorder?.state !== 'inactive') this.mediaRecorder?.stop();
    this.container.innerHTML = '';
    this.container.classList.remove('nexus-ultra');
  }
}

export default NexusUltra;
