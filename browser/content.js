// Content script for Memory Capture Extension
(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        SERVER_URL: 'http://localhost:7779',
        BATCH_SIZE: 5,
        BATCH_TIMEOUT: 30000,
        MIN_CONTENT_LENGTH: 50
    };
    
    // State management
    let pageData = {
        url: window.location.href,
        title: document.title,
        content: '',
        timestamp: new Date().toISOString(),
        domain: window.location.hostname,
        path: window.location.pathname,
        scrollDepth: 0,
        timeSpent: 0,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight
        }
    };
    
    let contentBatch = [];
    let lastBatchTime = Date.now();
    let sessionStartTime = Date.now();
    
    // Utility functions
    function extractMainContent() {
        // Remove scripts, styles, and navigation elements
        const elementsToRemove = ['script', 'style', 'nav', 'header', 'footer', 'aside', '.advertisement', '.ads', '.social-share'];
        const tempDoc = document.cloneNode(true);
        
        elementsToRemove.forEach(selector => {
            const elements = tempDoc.querySelectorAll(selector);
            elements.forEach(el => el.remove());
        });
        
        // Extract text from main content areas
        const contentSelectors = ['main', 'article', '.content', '.post-content', '.entry-content', '#content'];
        let content = '';
        
        for (const selector of contentSelectors) {
            const element = tempDoc.querySelector(selector);
            if (element) {
                content = element.innerText;
                break;
            }
        }
        
        // Fallback to body text if no main content found
        if (!content) {
            content = tempDoc.body.innerText;
        }
        
        return content.trim();
    }
    
    function extractKeywords(text) {
        // Simple keyword extraction - can be enhanced
        const words = text.toLowerCase().split(/\s+/);
        const wordFreq = {};
        
        words.forEach(word => {
            if (word.length > 3 && !isCommonWord(word)) {
                wordFreq[word] = (wordFreq[word] || 0) + 1;
            }
        });
        
        return Object.entries(wordFreq)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([word]) => word);
    }
    
    function isCommonWord(word) {
        const commonWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use'];
        return commonWords.includes(word);
    }
    
    function getPageMetadata() {
        const metadata = {
            description: '',
            author: '',
            publishedDate: '',
            modifiedDate: '',
            readingTime: 0,
            language: document.documentElement.lang || 'en',
            charset: document.characterSet || document.charset,
            viewport: document.querySelector('meta[name="viewport"]')?.content || '',
            keywords: [],
            tags: []
        };
        
        // Extract meta tags
        const metaTags = document.querySelectorAll('meta');
        metaTags.forEach(tag => {
            const name = tag.getAttribute('name') || tag.getAttribute('property') || '';
            const content = tag.getAttribute('content') || '';
            
            switch (name.toLowerCase()) {
                case 'description':
                case 'og:description':
                case 'twitter:description':
                    metadata.description = content;
                    break;
                case 'author':
                    metadata.author = content;
                    break;
                case 'keywords':
                    metadata.keywords = content.split(',').map(k => k.trim());
                    break;
                case 'article:published_time':
                case 'datepublished':
                    metadata.publishedDate = content;
                    break;
                case 'article:modified_time':
                case 'datemodified':
                    metadata.modifiedDate = content;
                    break;
                case 'article:tag':
                    metadata.tags.push(content);
                    break;
            }
        });
        
        // Calculate reading time (approx. 200 words per minute)
        const wordCount = pageData.content.split(/\s+/).length;
        metadata.readingTime = Math.ceil(wordCount / 200);
        
        return metadata;
    }
    
    function trackEngagement() {
        // Track scroll depth
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        const currentScroll = window.pageYOffset;
        const scrollPercentage = scrollHeight > 0 ? (currentScroll / scrollHeight) * 100 : 0;
        
        pageData.scrollDepth = Math.max(pageData.scrollDepth, scrollPercentage);
        pageData.timeSpent = Math.floor((Date.now() - sessionStartTime) / 1000);
    }
    
    function createContentPackage() {
        const content = extractMainContent();
        
        if (content.length < CONFIG.MIN_CONTENT_LENGTH) {
            return null;
        }
        
        pageData.content = content;
        pageData.metadata = getPageMetadata();
        pageData.keywords = extractKeywords(content);
        
        return {
            ...pageData,
            contentHash: simpleHash(content),
            engagement: {
                scrollDepth: pageData.scrollDepth,
                timeSpent: pageData.timeSpent,
                clicks: 0, // Can be enhanced with click tracking
                interactions: 0
            }
        };
    }
    
    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(16);
    }
    
    async function sendToServer(data) {
        try {
            const response = await fetch(`${CONFIG.SERVER_URL}/api/capture`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('Content captured successfully:', result);
            return result;
        } catch (error) {
            console.error('Failed to send content to server:', error);
            throw error;
        }
    }
    
    function addToBatch(contentPackage) {
        contentBatch.push(contentPackage);
        
        // Send batch if it's full or timeout reached
        if (contentBatch.length >= CONFIG.BATCH_SIZE || 
            (Date.now() - lastBatchTime) >= CONFIG.BATCH_TIMEOUT) {
            sendBatch();
        }
    }
    
    async function sendBatch() {
        if (contentBatch.length === 0) return;
        
        const batch = [...contentBatch];
        contentBatch = [];
        lastBatchTime = Date.now();
        
        try {
            await sendToServer({
                type: 'batch',
                items: batch,
                timestamp: new Date().toISOString(),
                count: batch.length
            });
        } catch (error) {
            // If batch fails, add items back to queue
            contentBatch.unshift(...batch);
            console.error('Batch send failed, items queued for retry');
        }
    }
    
    // Event listeners
    function setupEventListeners() {
        // Track scroll depth
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(trackEngagement, 100);
        });
        
        // Track time spent
        setInterval(trackEngagement, 1000);
        
        // Capture before page unload
        window.addEventListener('beforeunload', () => {
            trackEngagement();
            sendBatch(); // Send any remaining content
        });
        
        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                trackEngagement();
                sendBatch();
            }
        });
    }
    
    // Initialize content capture
    function initializeContentCapture() {
        // Wait for page to load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', captureContent);
        } else {
            captureContent();
        }
        
        // Set up periodic capture for dynamic content
        setInterval(() => {
            if (pageData.url !== window.location.href) {
                // URL changed, capture new page
                pageData.url = window.location.href;
                pageData.title = document.title;
                pageData.timestamp = new Date().toISOString();
                pageData.domain = window.location.hostname;
                pageData.path = window.location.pathname;
                captureContent();
            }
        }, 5000);
    }
    
    function captureContent() {
        const contentPackage = createContentPackage();
        
        if (contentPackage) {
            addToBatch(contentPackage);
            console.log('Content captured for Second Brain:', {
                url: contentPackage.url,
                title: contentPackage.title,
                contentLength: contentPackage.content.length,
                keywords: contentPackage.keywords
            });
        }
    }
    
    // Initialize the content script
    function init() {
        console.log('MemCapture\'s Eye - Second Brain content script initialized');
        
        setupEventListeners();
        initializeContentCapture();
        
        // Send initial heartbeat
        sendToServer({
            type: 'heartbeat',
            url: window.location.href,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            }
        }).catch(error => {
            console.error('Initial heartbeat failed:', error);
        });
    }
    
    // Start the content script
    init();
})();