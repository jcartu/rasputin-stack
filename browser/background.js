// Memory Capture - Background Service Worker
// Handles memory capture and storage

const CONFIG = {
  SERVER_URL: 'http://localhost:7779',
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  BATCH_SIZE: 10,
  FLUSH_INTERVAL: 30000, // 30 seconds
  MAX_QUEUE_SIZE: 100
};

class MemoryCapture {
  constructor() {
    this.captureQueue = [];
    this.isProcessing = false;
    this.captureCount = 0;
    this.serverStatus = 'unknown';
    this.init();
  }

  init() {
    console.log('[MemCapture] Background service starting...');
    
    // Set up periodic flush
    setInterval(() => this.flushQueue(), CONFIG.FLUSH_INTERVAL);
    
    // Check server status on startup
    this.checkServerStatus();
    
    // Listen for messages from content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async response
    });

    // Listen for tab updates
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        this.handleTabComplete(tab);
      }
    });

    // Listen for navigation events
    chrome.webNavigation.onCompleted.addListener((details) => {
      if (details.frameId === 0) { // Only main frame
        chrome.tabs.get(details.tabId, (tab) => {
          this.handleTabComplete(tab);
        });
      }
    });

    console.log('[MemCapture] Background service initialized');
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'capture':
          await this.queueCapture(message.data);
          sendResponse({ success: true });
          break;
        
        case 'getStats':
          const stats = await this.getStats();
          sendResponse({ success: true, stats });
          break;
        
        case 'checkStatus':
          await this.checkServerStatus();
          sendResponse({ success: true, status: this.serverStatus });
          break;
        
        case 'search':
          const results = await this.searchMemories(message.query);
          sendResponse({ success: true, results });
          break;
        
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('[MemCapture] Message handling error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async queueCapture(data) {
    // Skip sensitive pages
    if (this.isSensitiveUrl(data.url)) {
      console.log('[MemCapture] Skipping sensitive page:', data.url);
      return;
    }

    // Add to queue
    this.captureQueue.push({
      ...data,
      timestamp: new Date().toISOString(),
      id: Date.now() + Math.random()
    });

    // Update capture count
    this.captureCount++;
    
    // Save to storage
    await this.saveToStorage();

    // Process queue if it's getting large
    if (this.captureQueue.length >= CONFIG.BATCH_SIZE) {
      this.flushQueue();
    }

    console.log(`[MemCapture] Queued capture (${this.captureQueue.length} in queue)`);
  }

  async flushQueue() {
    if (this.isProcessing || this.captureQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    
    try {
      const batch = this.captureQueue.splice(0, CONFIG.BATCH_SIZE);
      await this.sendBatchToServer(batch);
      
      // Save updated queue
      await this.saveToStorage();
      
      console.log(`[MemCapture] Sent batch of ${batch.length} memories`);
    } catch (error) {
      console.error('[MemCapture] Batch send error:', error);
      // Put items back in queue for retry
      this.captureQueue.unshift(...batch);
    } finally {
      this.isProcessing = false;
    }
  }

  async sendBatchToServer(batch) {
    const payload = {
      pages: batch.map(item => ({
        url: item.url,
        title: item.title,
        content: item.content,
        domain: item.domain,
        timestamp: item.timestamp
      }))
    };

    await this.makeRequest(`${CONFIG.SERVER_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async makeRequest(url, options, attempt = 1) {
    try {
      const response = await fetch(url, {
        ...options,
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt < CONFIG.RETRY_ATTEMPTS) {
        console.log(`[MemCapture] Request failed, retrying (${attempt}/${CONFIG.RETRY_ATTEMPTS})...`);
        await this.delay(CONFIG.RETRY_DELAY * attempt);
        return this.makeRequest(url, options, attempt + 1);
      }
      throw error;
    }
  }

  async checkServerStatus() {
    try {
      const response = await this.makeRequest(`${CONFIG.SERVER_URL}/health`);
      this.serverStatus = response.status === 'ok' ? 'online' : 'offline';
      console.log(`[MemCapture] Server status: ${this.serverStatus}`);
    } catch (error) {
      this.serverStatus = 'offline';
      console.error('[MemCapture] Server check failed:', error);
    }
  }

  async searchMemories(query) {
    try {
      const response = await this.makeRequest(
        `${CONFIG.SERVER_URL}/search?q=${encodeURIComponent(query)}&limit=10`
      );
      return response.results || [];
    } catch (error) {
      console.error('[MemCapture] Search error:', error);
      return [];
    }
  }

  async getStats() {
    const storage = await chrome.storage.local.get(['captureCount']);
    return {
      captureCount: storage.captureCount || 0,
      queueSize: this.captureQueue.length,
      serverStatus: this.serverStatus
    };
  }

  async saveToStorage() {
    await chrome.storage.local.set({
      captureQueue: this.captureQueue,
      captureCount: this.captureCount,
      lastSave: new Date().toISOString()
    });
  }

  async loadFromStorage() {
    const storage = await chrome.storage.local.get(['captureQueue', 'captureCount']);
    this.captureQueue = storage.captureQueue || [];
    this.captureCount = storage.captureCount || 0;
    console.log(`[MemCapture] Loaded ${this.captureQueue.length} items from queue`);
  }

  handleTabComplete(tab) {
    // Skip chrome://, about:, etc.
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
      return;
    }

    // Skip if already processed recently
    if (this.recentlyProcessed(tab.url)) {
      return;
    }

    // Send message to content script to capture
    chrome.tabs.sendMessage(tab.id, { action: 'capture' }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not loaded, inject it
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(err => console.log('[MemCapture] Script injection failed:', err));
      }
    });
  }

  isSensitiveUrl(url) {
    const sensitivePatterns = [
      /login/i,
      /signin/i,
      /password/i,
      /bank/i,
      /payment/i,
      /checkout/i,
      /billing/i,
      /admin/i,
      /private/i,
      /secure/i,
      /\.pdf$/i,
      /\.mp4$/i,
      /\.mp3$/i,
      /localhost/i,
      /127\.0\.0\.1/i
    ];

    return sensitivePatterns.some(pattern => pattern.test(url));
  }

  recentlyProcessed(url) {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    // Check if we've seen this URL recently
    return this.captureQueue.some(item => 
      item.url === url && (now - new Date(item.timestamp).getTime()) < fiveMinutes
    );
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Initialize the memory capture system
const memoryCapture = new MemoryCapture();

// Load saved data on startup
memoryCapture.loadFromStorage();