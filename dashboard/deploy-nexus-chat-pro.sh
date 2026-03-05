#!/bin/bash
# Deploy Nexus Chat Pro — Next-Gen Dashboard Chat System
# Usage: ./deploy-nexus-chat-pro.sh

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Deploying Nexus Chat Pro v2.0"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Verify files exist
echo "✓ Verifying files..."
if [ ! -f "public/nexus-chat-pro.js" ]; then
  echo "❌ Error: public/nexus-chat-pro.js not found"
  exit 1
fi

if [ ! -f "server.js" ]; then
  echo "❌ Error: server.js not found"
  exit 1
fi

# 2. Backup existing server.js
echo "✓ Backing up server.js..."
cp server.js server.js.backup-$(date +%Y%m%d-%H%M%S)

# 3. Check if npm dependencies are installed
echo "✓ Checking dependencies..."
if ! npm list katex &>/dev/null; then
  echo "⚠ Installing katex..."
  npm install katex
fi

if ! npm list prismjs &>/dev/null; then
  echo "⚠ Installing prismjs..."
  npm install prismjs
fi

# 4. Test server.js syntax
echo "✓ Testing server.js syntax..."
node -c server.js || { echo "❌ Syntax error in server.js"; exit 1; }

# 5. Restart alfie-nexus via pm2
echo "✓ Restarting alfie-nexus..."
if command -v pm2 &>/dev/null; then
  if pm2 list | grep -q "alfie-nexus"; then
    pm2 restart alfie-nexus
    sleep 2
    pm2 logs alfie-nexus --lines 20 --nostream
  else
    echo "⚠ alfie-nexus not running in pm2, starting it..."
    pm2 start server.js --name alfie-nexus --node-args="--max-old-space-size=4096"
    pm2 save
  fi
else
  echo "⚠ pm2 not found, restarting manually..."
  pkill -f "node.*server.js" || true
  nohup node server.js > server.log 2>&1 &
  sleep 2
  tail -20 server.log
fi

# 6. Verify WebSocket is listening
echo "✓ Checking WebSocket port 9001..."
sleep 1
if nc -z localhost 9001 2>/dev/null; then
  echo "✅ WebSocket server is listening on port 9001"
else
  echo "❌ WebSocket server not responding on port 9001"
  exit 1
fi

# 7. Create test HTML page
echo "✓ Creating test page..."
cat > public/chat-test.html <<'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nexus Chat Pro — Test</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #0a0a0f; color: #e8e9ed; }
    #container { width: 100vw; height: 100vh; }
    .banner { position: absolute; top: 10px; left: 10px; background: rgba(139,92,246,0.15); padding: 12px 20px; border-radius: 12px; border: 1px solid rgba(139,92,246,0.3); z-index: 1000; }
    .banner h1 { font-size: 14px; font-weight: 600; color: #a78bfa; }
  </style>
</head>
<body>
  <div class="banner">
    <h1>✦ Nexus Chat Pro v2.0 — Test Interface</h1>
  </div>
  <div id="container"></div>

  <script type="module">
    import { NexusChatPro } from './nexus-chat-pro.js';

    const chat = new NexusChatPro({
      container: document.getElementById('container'),
      wsUrl: 'ws://localhost:9001',
      user: { name: 'admin', avatar: '👤' },
      ai: { name: 'Rasputin', avatar: '🧠' },
      onSend: (text) => {
        console.log('[Test] User sent:', text);
      },
      onWidgetAction: (action, payload) => {
        console.log('[Test] Widget action:', action, payload);
        alert(`Widget Action: ${action}\nPayload: ${JSON.stringify(payload, null, 2)}`);
      }
    });

    // Demo: Add welcome message
    setTimeout(() => {
      chat.addMessage({
        content: `# Welcome to Nexus Chat Pro! 🚀

This is a **next-generation** chat interface with:

- Full Markdown + LaTeX support: $E = mc^2$
- Syntax-highlighted code blocks
- Drag-and-drop file uploads
- Voice recording
- Streaming "Thinking" states
- Actionable widgets

Try sending a message or drag-dropping an image!`,
        sender: 'Rasputin',
        avatar: '🧠'
      });

      // Demo: Add a widget
      setTimeout(() => {
        chat.addWidget({
          title: 'Test Widget',
          description: 'Click the button to trigger a widget action.',
          action: 'test_action',
          payload: { demo: true, timestamp: Date.now() },
          buttonText: '🎯 Test Action'
        });
      }, 1000);

      // Demo: Add an artifact
      setTimeout(() => {
        chat.addArtifact({
          title: 'Interactive Demo',
          type: 'html',
          content: '<html><body style="font-family:sans-serif;padding:20px;background:#1a1a2e;color:#eee;"><h1>🎨 HTML Artifact</h1><p>This is a sandboxed iframe preview.</p><button onclick="alert(\\'Hello from artifact!\\')">Click Me</button></body></html>'
        });
      }, 2000);
    }, 500);

    // Expose chat instance for console testing
    window.chat = chat;
    console.log('✦ Chat instance available as window.chat');
  </script>
</body>
</html>
EOF

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 Test Interface: http://localhost:9001/chat-test.html"
echo "🌐 Main Dashboard: https://dash.rasputin.to"
echo ""
echo "📝 Next Steps:"
echo "  1. Open the test interface in your browser"
echo "  2. Check browser console for 'Authenticated ✓'"
echo "  3. Send a test message"
echo "  4. Drag-drop an image"
echo "  5. Click the 🎤 icon to test voice recording"
echo ""
echo "📚 Documentation: memory/rich_communication_protocol.md"
echo ""
echo "💡 Troubleshooting:"
echo "  - Check pm2 logs: pm2 logs alfie-nexus"
echo "  - Check WebSocket: nc -v localhost 9001"
echo "  - Browser console: Should show '[NexusChatPro] WebSocket connected'"
echo ""
