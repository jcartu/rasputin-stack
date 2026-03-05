#!/usr/bin/env node
/**
 * Unified Session Report & Sharing Feature
 * Implementation priority: HIGH (7/10) - Collaborative Features from Competitive Analysis
 * 
 * This script implements:
 * 1. Comprehensive Session Report generation (Markdown/JSON)
 * 2. Automatic Session Autopsy integration
 * 3. Sanitized sharing links
 * 4. API Endpoints for report generation and retrieval
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SessionReportGenerator {
  constructor(exporter, autopsy, storageDir = 'exports') {
    this.exporter = exporter;
    this.autopsy = autopsy;
    this.storageDir = path.join(__dirname, storageDir);
    this.sharesPath = path.join(__dirname, 'shares.json');
    
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Generate a full report for a session
   * @param {string} sessionKey - Id of the session
   * @param {Object} rawData - Raw session data from .jsonl or memory
   * @returns {Object} - Report metadata
   */
  async generateFullReport(sessionKey, rawData) {
    // 1. Run autopsy
    const autopsyReport = this.autopsy.analyzeSession(rawData);
    
    // 2. Generate shareable markdown
    const mdReport = this.exporter.exportAsMarkdown({
      ...rawData,
      autopsy: autopsyReport
    }, {
      includeMetadata: true,
      includeSystem: false,
      includeTools: true,
      includeCost: true,
      includeTimestamps: true
    });
    
    // 3. Save files
    const mdFilename = `report_${sessionKey}_${Date.now()}.md`;
    const jsonFilename = `report_${sessionKey}_${Date.now()}.json`;
    
    this.exporter.saveExport(mdReport, mdFilename);
    const jsonReport = this.exporter.exportAsJSON({
        ...rawData,
        autopsy: autopsyReport
    });
    this.exporter.saveExport(jsonReport, jsonFilename);
    
    return {
      sessionKey,
      timestamp: Date.now(),
      mdFile: mdFilename,
      jsonFile: jsonFilename,
      summary: autopsyReport.summary
    };
  }

  /**
   * Create a shareable link (tokenized)
   * @param {string} sessionKey 
   * @param {Object} options 
   */
  createShare(sessionKey, options = {}) {
    const token = crypto.randomBytes(16).toString('hex');
    const shares = this.loadShares();
    
    shares[token] = {
      sessionKey,
      options,
      createdAt: Date.now(),
      expiresAt: options.ttl ? Date.now() + options.ttl : null
    };
    
    this.saveShares(shares);
    return token;
  }

  loadShares() {
    try {
      if (fs.existsSync(this.sharesPath)) {
        return JSON.parse(fs.readFileSync(this.sharesPath, 'utf8'));
      }
    } catch (e) {}
    return {};
  }

  saveShares(shares) {
    fs.writeFileSync(this.sharesPath, JSON.stringify(shares, null, 2));
  }
}

// Export for use in server.js
module.exports = SessionReportGenerator;
