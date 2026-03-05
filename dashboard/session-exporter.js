#!/usr/bin/env node
// Session Export Module for ALFIE Nexus
// Exports sessions as formatted Markdown or JSON for sharing

const fs = require('fs');
const path = require('path');

class SessionExporter {
  constructor() {
    this.exportDir = path.join(__dirname, 'exports');
    
    // Ensure export directory exists
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
  }

  /**
   * Export session as formatted Markdown
   * @param {Object} sessionData - Full session data including messages, cost, tools
   * @param {Object} options - Export options (includeMetadata, includeSystem, etc.)
   * @returns {string} - Markdown formatted export
   */
  exportAsMarkdown(sessionData, options = {}) {
    const {
      includeMetadata = true,
      includeSystem = false,
      includeTools = true,
      includeCost = true,
      includeTimestamps = false,
    } = options;

    let markdown = '';

    // Header
    markdown += `# ALFIE Session Export\n\n`;
    
    if (includeMetadata) {
      markdown += `## Session Metadata\n\n`;
      markdown += `- **Session ID:** ${sessionData.sessionKey || 'unknown'}\n`;
      markdown += `- **Started:** ${sessionData.startTime ? new Date(sessionData.startTime).toLocaleString() : 'N/A'}\n`;
      markdown += `- **Duration:** ${this.formatDuration(sessionData.duration || 0)}\n`;
      markdown += `- **Messages:** ${sessionData.messages?.length || 0}\n`;
      
      if (includeCost && sessionData.totalCost) {
        markdown += `- **Total Cost:** $${sessionData.totalCost.toFixed(4)}\n`;
        markdown += `- **Model:** ${sessionData.model || 'N/A'}\n`;
        markdown += `- **Tokens:** ${sessionData.totalTokens || 'N/A'}\n`;
      }
      
      markdown += `\n---\n\n`;
    }

    // Messages
    markdown += `## Conversation\n\n`;
    
    if (sessionData.messages && sessionData.messages.length > 0) {
      sessionData.messages.forEach((msg, idx) => {
        // Skip system messages unless requested
        if (msg.role === 'system' && !includeSystem) return;
        
        // Format role
        const roleLabel = {
          user: '👤 User',
          assistant: '🤖 Assistant',
          system: '⚙️ System',
        }[msg.role] || msg.role;

        markdown += `### ${roleLabel}`;
        
        if (includeTimestamps && msg.timestamp) {
          markdown += ` · ${new Date(msg.timestamp).toLocaleTimeString()}`;
        }
        
        markdown += `\n\n`;
        markdown += `${msg.content}\n\n`;
        
        // Tool calls
        if (includeTools && msg.toolCalls && msg.toolCalls.length > 0) {
          markdown += `#### Tools Used:\n\n`;
          msg.toolCalls.forEach(tool => {
            markdown += `- **${tool.name}**`;
            if (tool.duration) {
              markdown += ` (${tool.duration}ms)`;
            }
            markdown += `\n`;
            if (tool.error) {
              markdown += `  - ⚠️ Error: ${tool.error}\n`;
            }
          });
          markdown += `\n`;
        }
        
        markdown += `---\n\n`;
      });
    } else {
      markdown += `*No messages in this session.*\n\n`;
    }

    // Session summary
    if (sessionData.summary || sessionData.autopsy) {
      markdown += `## Session Summary\n\n`;
      
      if (sessionData.autopsy) {
        markdown += `### Performance Analysis\n\n`;
        const autopsy = sessionData.autopsy;
        
        if (autopsy.metrics) {
          markdown += `- **Duration:** ${this.formatDuration(autopsy.metrics.duration || 0)}\n`;
          markdown += `- **Cost:** $${autopsy.metrics.cost?.toFixed(4) || '0.0000'}\n`;
          markdown += `- **Tools Called:** ${autopsy.metrics.toolCount || 0}\n`;
          markdown += `- **Errors:** ${autopsy.metrics.errorCount || 0}\n\n`;
        }
        
        if (autopsy.insights && autopsy.insights.length > 0) {
          markdown += `### Key Insights\n\n`;
          autopsy.insights.forEach(insight => {
            markdown += `- ${insight}\n`;
          });
          markdown += `\n`;
        }
        
        if (autopsy.optimizations && autopsy.optimizations.length > 0) {
          markdown += `### Optimization Suggestions\n\n`;
          autopsy.optimizations.forEach(opt => {
            const priority = opt.priority ? `[${opt.priority.toUpperCase()}]` : '';
            markdown += `- ${priority} ${opt.suggestion}`;
            if (opt.impact) {
              markdown += ` (Est. impact: ${opt.impact})`;
            }
            markdown += `\n`;
          });
          markdown += `\n`;
        }
      }
    }

    // Footer
    markdown += `---\n\n`;
    markdown += `*Exported from ALFIE Nexus on ${new Date().toLocaleString()}*\n`;
    markdown += `*Dashboard: https://dash.rasputin.to*\n`;

    return markdown;
  }

  /**
   * Export session as JSON
   * @param {Object} sessionData - Full session data
   * @param {boolean} pretty - Pretty print JSON
   * @returns {string} - JSON export
   */
  exportAsJSON(sessionData, pretty = true) {
    const exportData = {
      meta: {
        exportVersion: '1.0',
        exportedAt: new Date().toISOString(),
        source: 'ALFIE Nexus',
      },
      session: sessionData,
    };

    return JSON.stringify(exportData, null, pretty ? 2 : 0);
  }

  /**
   * Save export to file
   * @param {string} content - Export content
   * @param {string} filename - Filename
   * @returns {string} - Full path to saved file
   */
  saveExport(content, filename) {
    const filepath = path.join(this.exportDir, filename);
    fs.writeFileSync(filepath, content, 'utf8');
    return filepath;
  }

  /**
   * Generate shareable export (sanitized)
   * @param {Object} sessionData - Session data
   * @param {Object} options - Sanitization options
   * @returns {Object} - Sanitized session data
   */
  generateShareable(sessionData, options = {}) {
    const {
      removePersonalInfo = true,
      removeCost = false,
      anonymize = false,
    } = options;

    const sanitized = JSON.parse(JSON.stringify(sessionData)); // Deep clone

    if (removePersonalInfo && sanitized.messages) {
      sanitized.messages = sanitized.messages.map(msg => {
        let content = msg.content;
        
        // Remove email addresses
        content = content.replace(/[\w.+-]+@[\w.-]+\.[\w.-]+/g, '[EMAIL]');
        
        // Remove phone numbers (basic)
        content = content.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
        
        // Remove API keys / tokens (basic pattern)
        content = content.replace(/\b[A-Za-z0-9]{32,}\b/g, '[API_KEY]');
        
        return { ...msg, content };
      });
    }

    if (removeCost) {
      delete sanitized.totalCost;
      delete sanitized.costBreakdown;
      if (sanitized.autopsy) {
        delete sanitized.autopsy.metrics.cost;
      }
    }

    if (anonymize) {
      sanitized.sessionKey = 'ANONYMIZED';
      sanitized.userId = 'anonymous';
    }

    return sanitized;
  }

  /**
   * Format duration in human-readable form
   * @param {number} ms - Duration in milliseconds
   * @returns {string} - Formatted duration
   */
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  }

  /**
   * Generate session comparison markdown
   * @param {Object} session1 - First session
   * @param {Object} session2 - Second session
   * @returns {string} - Comparison markdown
   */
  compareSessionsMarkdown(session1, session2) {
    let markdown = `# Session Comparison\n\n`;
    
    markdown += `| Metric | Session 1 | Session 2 | Difference |\n`;
    markdown += `|--------|-----------|-----------|------------|\n`;
    
    const metrics = [
      {
        label: 'Duration',
        s1: this.formatDuration(session1.duration || 0),
        s2: this.formatDuration(session2.duration || 0),
        diff: this.formatDuration(Math.abs((session1.duration || 0) - (session2.duration || 0))),
      },
      {
        label: 'Cost',
        s1: `$${(session1.totalCost || 0).toFixed(4)}`,
        s2: `$${(session2.totalCost || 0).toFixed(4)}`,
        diff: `$${Math.abs((session1.totalCost || 0) - (session2.totalCost || 0)).toFixed(4)}`,
      },
      {
        label: 'Messages',
        s1: session1.messages?.length || 0,
        s2: session2.messages?.length || 0,
        diff: Math.abs((session1.messages?.length || 0) - (session2.messages?.length || 0)),
      },
      {
        label: 'Tools',
        s1: session1.toolCallCount || 0,
        s2: session2.toolCallCount || 0,
        diff: Math.abs((session1.toolCallCount || 0) - (session2.toolCallCount || 0)),
      },
    ];

    metrics.forEach(m => {
      markdown += `| ${m.label} | ${m.s1} | ${m.s2} | ${m.diff} |\n`;
    });

    markdown += `\n`;
    
    return markdown;
  }
}

module.exports = SessionExporter;
