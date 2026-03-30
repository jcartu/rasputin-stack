const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'public', 'index.html');
const indexContent = fs.readFileSync(indexPath, 'utf8');

// 1. Find the chat container
const chatCardRegex = /<div class="bento-card" id="chat-card">[\s\S]*?<\/div>/;
const newChatContainer = `<div class="bento-card" id="chat-card" style="padding:0; overflow:hidden; display:flex; flex-direction:column;">
      <div id="nexus-chat-container" style="flex:1; min-height:0;"></div>
    </div>`;

let updatedContent = indexContent.replace(chatCardRegex, newChatContainer);

// 2. Inject the script module before </body>
const moduleScript = `
<script type="module">
  import { NexusChatPro } from './nexus-chat-pro.js';
  
  // Wait for DOM
  window.addEventListener('load', () => {
    const container = document.getElementById('nexus-chat-container');
    if (!container) return;
    
    window.chatPro = new NexusChatPro({
      container: container,
      wsUrl: 'ws://' + window.location.hostname + ':9001',
      user: { name: 'admin', avatar: '👤' },
      ai: { name: 'Rasputin', avatar: '🧠' }
    });
    
    console.log('✦ Nexus Chat Pro integrated into main dashboard');
  });
</script>
</body>`;

updatedContent = updatedContent.replace('</body>', moduleScript);

// 3. Optional: Disable the old chat logic to prevent conflict
// We just find where addChatBubble/sendMessage are defined and return early or rename them
// but since the container is gone, the old code will likely just fail silently or we can just let it be.

fs.writeFileSync(indexPath, updatedContent);
console.log('✓ Injected Nexus Chat Pro into index.html');
