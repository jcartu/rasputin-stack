/**
 * WORKSPACE ENHANCEMENT — Manus-style improvements
 * Makes workspace pane interactive with file browser, terminal enhancements, and project tracking
 */

// ═══ FILE BROWSER (Tree View) ═══
class FileBrowser {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.root = '/home/admin/.openclaw/workspace';
    this.expandedDirs = new Set();
    this.fileCache = new Map();
    this.init();
  }

  init() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%; background: var(--surface);">
        <div style="padding: 8px; border-bottom: 1px solid var(--glass-border); display: flex; gap: 8px; align-items: center;">
          <input type="text" id="file-search" placeholder="Search files..." 
            style="flex: 1; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 6px; padding: 6px 10px; color: var(--text); font-size: 0.7rem; font-family: var(--font-mono);">
          <button onclick="fileBrowser.refresh()" style="background: var(--glass); border: 1px solid var(--glass-border); border-radius: 6px; padding: 6px 10px; color: var(--cyan); font-size: 0.7rem; cursor: pointer;">↻</button>
        </div>
        <div id="file-tree" style="flex: 1; overflow-y: auto; padding: 8px; font-family: var(--font-mono); font-size: 0.7rem;"></div>
      </div>
    `;
    
    this.treeContainer = document.getElementById('file-tree');
    this.searchInput = document.getElementById('file-search');
    this.searchInput.addEventListener('input', () => this.handleSearch());
    
    this.loadDirectory(this.root);
  }

  async loadDirectory(path, parentElement = null) {
    try {
      const response = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error('Failed to load directory');
      
      const files = await response.json();
      this.fileCache.set(path, files);
      
      if (!parentElement) {
        this.renderTree(files);
      } else {
        this.renderChildren(files, parentElement);
      }
    } catch (error) {
      console.error('Error loading directory:', error);
      if (!parentElement) {
        this.treeContainer.innerHTML = '<div style="color: var(--text-ghost); padding: 8px;">Error loading files</div>';
      }
    }
  }

  renderTree(files) {
    this.treeContainer.innerHTML = '';
    files.forEach(file => {
      const item = this.createFileItem(file, 0);
      this.treeContainer.appendChild(item);
    });
  }

  createFileItem(file, depth) {
    const item = document.createElement('div');
    const isDir = file.type === 'directory';
    const isExpanded = this.expandedDirs.has(file.path);
    
    item.dataset.path = file.path;
    item.style.cssText = `
      padding: 4px 8px 4px ${8 + depth * 16}px;
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.1s;
    `;
    
    item.innerHTML = `
      ${isDir ? (isExpanded ? '▼' : '▶') : ''}
      <span style="opacity: 0.7;">${this.getFileIcon(file)}</span>
      <span style="color: ${isDir ? 'var(--cyan)' : 'var(--text)'}; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</span>
      <span style="color: var(--text-ghost); font-size: 0.6rem;">${this.formatSize(file.size)}</span>
    `;
    
    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--glass)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });
    
    if (isDir) {
      item.addEventListener('click', () => this.toggleDirectory(file.path, item, depth));
    } else {
      item.addEventListener('click', () => this.openFile(file.path));
    }
    
    return item;
  }

  async toggleDirectory(path, element, depth) {
    if (this.expandedDirs.has(path)) {
      this.expandedDirs.delete(path);
      // Remove children
      let next = element.nextSibling;
      while (next && next.dataset.path && next.dataset.path.startsWith(path + '/')) {
        const toRemove = next;
        next = next.nextSibling;
        toRemove.remove();
      }
      element.querySelector('span:first-child').textContent = '▶';
    } else {
      this.expandedDirs.add(path);
      element.querySelector('span:first-child').textContent = '▼';
      
      // Load children
      const response = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`);
      const files = await response.json();
      
      let insertAfter = element;
      files.forEach(file => {
        const child = this.createFileItem(file, depth + 1);
        insertAfter.after(child);
        insertAfter = child;
      });
    }
  }

  getFileIcon(file) {
    if (file.type === 'directory') return '📁';
    const ext = file.name.split('.').pop().toLowerCase();
    const icons = {
      md: '📝', txt: '📄', json: '🔧', js: '🟨', py: '🐍',
      html: '🌐', css: '🎨', sh: '⚡', yaml: '⚙️', yml: '⚙️',
      png: '🖼️', jpg: '🖼️', svg: '🎨', mp4: '🎬'
    };
    return icons[ext] || '📄';
  }

  formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
    return (bytes / (1024 * 1024)).toFixed(1) + 'M';
  }

  async openFile(path) {
    // If it's a viewable file, open in preview
    const ext = path.split('.').pop().toLowerCase();
    if (['html', 'md', 'txt'].includes(ext)) {
      const url = `/api/files/view?path=${encodeURIComponent(path)}`;
      window.loadWorkspaceUrl(url, path.split('/').pop());
    } else {
      // Show file info in terminal
      window.addWorkspaceTerminal(`📄 ${path}`, false);
    }
  }

  handleSearch() {
    const query = this.searchInput.value.toLowerCase();
    const items = this.treeContainer.querySelectorAll('[data-path]');
    
    items.forEach(item => {
      const path = item.dataset.path;
      const name = path.split('/').pop().toLowerCase();
      item.style.display = (name.includes(query) || !query) ? 'flex' : 'none';
    });
  }

  refresh() {
    this.fileCache.clear();
    this.expandedDirs.clear();
    this.loadDirectory(this.root);
  }
}

// ═══ TERMINAL ENHANCEMENTS ═══
class EnhancedTerminal {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.history = [];
    this.maxLines = 1000;
    this.init();
  }

  init() {
    if (!this.container) return;
    
    // Add terminal controls
    const controls = document.createElement('div');
    controls.style.cssText = 'position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; z-index: 10;';
    controls.innerHTML = `
      <button onclick="enhancedTerminal.clear()" style="background: var(--glass); border: 1px solid var(--glass-border); border-radius: 4px; padding: 4px 8px; color: var(--text-3); font-size: 0.6rem; cursor: pointer;">Clear</button>
      <button onclick="enhancedTerminal.export()" style="background: var(--glass); border: 1px solid var(--glass-border); border-radius: 4px; padding: 4px 8px; color: var(--text-3); font-size: 0.6rem; cursor: pointer;">Export</button>
    `;
    this.container.parentElement.style.position = 'relative';
    this.container.parentElement.insertBefore(controls, this.container);
  }

  addLine(text, isError = false, timestamp = true) {
    const line = {
      text,
      isError,
      timestamp: timestamp ? new Date() : null
    };
    this.history.push(line);
    
    if (this.history.length > this.maxLines) {
      this.history.shift();
    }
    
    // Use existing window.addWorkspaceTerminal but enhance it
    const timestampPrefix = timestamp ? `<span style="color: var(--text-ghost); font-size: 0.6rem;">[${new Date().toLocaleTimeString()}]</span> ` : '';
    window.addWorkspaceTerminal(timestampPrefix + text, isError);
  }

  clear() {
    this.history = [];
    if (this.container) {
      this.container.innerHTML = '<div style="color: #00e5ff; opacity: 0.6; font-size: 0.65rem;">[ TERMINAL CLEARED ]</div>';
    }
  }

  export() {
    const content = this.history.map(line => {
      const ts = line.timestamp ? `[${line.timestamp.toISOString()}] ` : '';
      return ts + line.text;
    }).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terminal-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ═══ PROJECT TRACKER ═══
class ProjectTracker {
  constructor() {
    this.projects = [];
    this.loadProjects();
  }

  async loadProjects() {
    try {
      const response = await fetch('/api/projects/list');
      if (response.ok) {
        this.projects = await response.json();
        this.render();
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  }

  render() {
    // Add projects tab if not exists
    const workspaceCard = document.getElementById('workspace-card');
    if (!workspaceCard) return;
    
    const tabContainer = workspaceCard.querySelector('.card-title > div');
    if (!tabContainer.querySelector('[data-tab="projects"]')) {
      const projectsTab = document.createElement('button');
      projectsTab.className = 'workspace-tab';
      projectsTab.dataset.tab = 'projects';
      projectsTab.textContent = 'Projects';
      projectsTab.onclick = () => switchWorkspaceTab('projects');
      tabContainer.appendChild(projectsTab);
      
      // Add projects pane
      const workspaceContent = document.getElementById('workspace-content');
      const projectsPane = document.createElement('div');
      projectsPane.id = 'workspace-projects';
      projectsPane.className = 'workspace-pane';
      projectsPane.style.cssText = 'display: none; width: 100%; height: 100%; overflow-y: auto; padding: 12px;';
      workspaceContent.appendChild(projectsPane);
    }
    
    this.renderProjects();
  }

  renderProjects() {
    const pane = document.getElementById('workspace-projects');
    if (!pane) return;
    
    if (this.projects.length === 0) {
      pane.innerHTML = '<div style="color: var(--text-ghost); font-size: 0.7rem; text-align: center; padding: 20px;">No active projects</div>';
      return;
    }
    
    pane.innerHTML = this.projects.map(project => `
      <div style="background: var(--surface); border: 1px solid var(--glass-border); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="font-size: 1.2rem;">${project.icon || '📦'}</span>
          <span style="color: var(--cyan); font-weight: 600; font-size: 0.8rem;">${project.name}</span>
          <span style="margin-left: auto; background: ${project.status === 'active' ? 'var(--green)' : 'var(--text-ghost)'}; color: #000; padding: 2px 8px; border-radius: 4px; font-size: 0.6rem; font-weight: 600;">${project.status.toUpperCase()}</span>
        </div>
        <div style="color: var(--text-2); font-size: 0.65rem; margin-bottom: 8px;">${project.description || ''}</div>
        ${project.url ? `<a href="${project.url}" target="_blank" style="color: var(--cyan); font-size: 0.65rem; text-decoration: none;">🔗 ${project.url}</a>` : ''}
      </div>
    `).join('');
  }

  addProject(project) {
    this.projects.push(project);
    this.render();
  }
}

// ═══ INITIALIZE ═══
let fileBrowser, enhancedTerminal, projectTracker;

document.addEventListener('DOMContentLoaded', () => {
  // Wait a bit for main dashboard to load
  setTimeout(() => {
    fileBrowser = new FileBrowser('workspace-files');
    enhancedTerminal = new EnhancedTerminal('workspace-terminal');
    projectTracker = new ProjectTracker();
  }, 1000);
});

// ═══ SERVER INTEGRATION (needs backend support) ═══
// Add these endpoints to server.js:
/*

// File browser endpoints
app.get('/api/files/list', authenticateToken, async (req, res) => {
  const { path } = req.query;
  if (!path || !path.startsWith('/home/admin/.openclaw/workspace')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  
  try {
    const files = await fs.readdir(path, { withFileTypes: true });
    const fileList = await Promise.all(files.map(async (file) => {
      const filePath = `${path}/${file.name}`;
      const stats = await fs.stat(filePath);
      return {
        name: file.name,
        path: filePath,
        type: file.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modified: stats.mtime
      };
    }));
    res.json(fileList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files/view', authenticateToken, async (req, res) => {
  const { path } = req.query;
  if (!path || !path.startsWith('/home/admin/.openclaw/workspace')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  
  try {
    const content = await fs.readFile(path, 'utf-8');
    const ext = path.split('.').pop().toLowerCase();
    
    if (ext === 'md') {
      // Convert markdown to HTML (you'll need a markdown library)
      res.send(`<html><body style="background:#0a0a0f;color:#fff;padding:20px;font-family:system-ui;"><pre>${content}</pre></body></html>`);
    } else if (ext === 'html') {
      res.send(content);
    } else {
      res.send(`<html><body style="background:#0a0a0f;color:#0dff92;padding:20px;font-family:monospace;"><pre>${content}</pre></body></html>`);
    }
  } catch (error) {
    res.status(500).send(`<html><body style="background:#0a0a0f;color:#ff3d71;padding:20px;">Error: ${error.message}</body></html>`);
  }
});

app.get('/api/projects/list', authenticateToken, async (req, res) => {
  // Load from projects.json or similar
  try {
    const projects = JSON.parse(await fs.readFile('/home/admin/.openclaw/workspace/projects.json', 'utf-8'));
    res.json(projects);
  } catch {
    res.json([]);
  }
});

*/
