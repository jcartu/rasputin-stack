# ALFIE Nexus Dashboard - Testing Checklist

## 🧪 Quick Test Guide

Use this checklist to verify all pages are working correctly after the overhaul.

---

## ✅ Visual Consistency Check

Visit each page and verify the navigation bar:

```bash
# Dashboard (main)
http://dash.rasputin.to/

# All sub-pages
http://dash.rasputin.to/browser.html
http://dash.rasputin.to/execute.html
http://dash.rasputin.to/research.html
http://dash.rasputin.to/playground.html
http://dash.rasputin.to/replay.html
http://dash.rasputin.to/agents.html
http://dash.rasputin.to/knowledge.html
http://dash.rasputin.to/templates.html
http://dash.rasputin.to/council.html
http://dash.rasputin.to/remote.html
```

### Navigation Bar Should Have:
- [ ] Logo: "🧠 ALFIE NEXUS" (gradient purple→cyan)
- [ ] All 11 pages listed:
  - [ ] 📊 Dashboard
  - [ ] 🌐 Browser
  - [ ] ⚡ Execute
  - [ ] 🔬 Research
  - [ ] 🎯 Playground
  - [ ] 🔄 Replay
  - [ ] 🤖 Agents
  - [ ] 📚 Knowledge
  - [ ] 📝 Templates
  - [ ] 🏛️ **Council** (was missing before)
  - [ ] 🖥️ **Remote** (was missing before)
- [ ] Current page highlighted with purple accent
- [ ] Consistent glassmorphism backdrop blur effect
- [ ] Mobile: Hamburger menu on narrow screens

---

## 🔐 Authentication Test

### Test API calls send cookies:

1. **Open Browser DevTools** → Network tab
2. **Visit any page** (e.g., `/execute.html`)
3. **Trigger an API action:**
   - Execute: Run code
   - Research: Submit query
   - Browser: Launch session
   - Agents: View active agents
4. **Check Network request:**
   - [ ] Request Headers → `Cookie` includes `authToken`
   - [ ] Response status → `200 OK` (not `401 Unauthorized`)

### If you see 401 errors:
```bash
# Check server logs
pm2 logs alfie-nexus

# Restart if needed
pm2 restart alfie-nexus
```

---

## 🎯 Functional Tests

### Browser Page
- [ ] Click "Launch" → Creates browser session
- [ ] Enter URL → Navigates and shows screenshot
- [ ] Click screenshot → Sends click action
- [ ] History sidebar → Shows past navigations

### Execute Page
- [ ] Select language (Python/JS/Bash)
- [ ] Enter code
- [ ] Click "Run" → Executes and shows output
- [ ] History sidebar → Shows past executions
- [ ] Export/Share buttons → Work without errors

### Research Page
- [ ] Enter research question
- [ ] Click "Research" → Shows progress steps
- [ ] Queries panel → Displays search queries
- [ ] Sources panel → Shows fetched sources
- [ ] Report → Renders markdown synthesis
- [ ] History sidebar → Shows past queries

### Playground Page
- [ ] Select multiple models
- [ ] Enter prompt
- [ ] Click "Run" → Shows responses from all models
- [ ] Response cards → Display model name, timing, output

### Replay Page
- [ ] Session picker → Loads available sessions
- [ ] Click "Load" → Loads session messages
- [ ] Play controls → Step through messages
- [ ] Timeline scrubbing → Works
- [ ] Export/Share → No errors

### Agents Page
- [ ] Stats bar → Shows active/total/idle counts
- [ ] Spawn form → Can submit new agent task
- [ ] Agent cards → Display session info
- [ ] Click card → Expands transcript

### Knowledge Page
- [ ] Sidebar → Shows file tree
- [ ] Click file → Loads content
- [ ] Markdown files → Rendered with syntax highlighting
- [ ] Search → Filters file list

### Templates Page
- [ ] Template cards → Display correctly
- [ ] Click template → Opens modal
- [ ] Fill form → No validation errors
- [ ] Run template → Shows progress steps

### Council Page
- [ ] Question input → Can type query
- [ ] Mode selector → Auto/Synthesis/Council
- [ ] Model picker → Can select models
- [ ] Convene → Starts deliberation
- [ ] Results → Shows verdict + responses

### Remote Page
- [ ] Status cards → Show server health
- [ ] Device table → Lists connected devices
- [ ] Setup commands → Displayed correctly

---

## 🌐 Cross-Browser Testing

Test in multiple browsers:

- [ ] **Chrome/Edge** (Chromium)
- [ ] **Firefox**
- [ ] **Safari** (if on macOS)
- [ ] **Mobile browsers** (responsive hamburger menu)

---

## 📱 Responsive Testing

Resize browser window or use DevTools device emulation:

### Desktop (≥1200px)
- [ ] Full navigation visible
- [ ] All nav links displayed inline

### Tablet (768px - 1199px)
- [ ] Hamburger menu appears
- [ ] Nav links hidden, accessible via menu
- [ ] Layout adjusts gracefully

### Mobile (<768px)
- [ ] Hamburger menu active
- [ ] Single column layouts
- [ ] Sidebars hidden or collapsible

---

## 🐛 Error Handling

### Check browser console for errors:
```
F12 → Console tab
```

Should see:
- [ ] No JavaScript errors (red X)
- [ ] No 404 for CSS/JS files
- [ ] No CORS errors
- [ ] Shared nav loads successfully

### Common issues to look for:
- `❌ shared-styles.css not found` → Check file exists
- `❌ shared-nav.js not found` → Check file exists
- `❌ 401 Unauthorized` → Check credentials in fetch()
- `❌ CORS error` → Check server allows credentials

---

## 🔄 Final Verification

```bash
# 1. Check server status
pm2 status alfie-nexus

# 2. Check server logs (last 50 lines)
pm2 logs alfie-nexus --lines 50

# 3. Verify port 9001 is listening
netstat -tlnp | grep 9001

# 4. Test health endpoint
curl http://localhost:9001/api/health
```

---

## 📊 Performance Check

### Load times (target <2s):
- [ ] Initial page load
- [ ] Navigation between pages
- [ ] API responses

### Network waterfall:
- [ ] CSS loads first (blocking)
- [ ] JS loads after
- [ ] No duplicate requests

---

## ✅ Sign-Off

Once all tests pass:

- [ ] All 11 pages load correctly
- [ ] Navigation is consistent across all pages
- [ ] All API calls work (auth cookies sent)
- [ ] No console errors
- [ ] Mobile responsive
- [ ] Cross-browser compatible

**Date tested:** _______________  
**Tested by:** _______________  
**Result:** ✅ PASS / ❌ FAIL  

---

**If any tests fail:**

1. Check `OVERHAUL_REPORT.md` for details
2. Review browser console for errors
3. Check `pm2 logs alfie-nexus` for server errors
4. Compare with `.backup` files if needed
5. Report issues to the main agent

**Server restart:**
```bash
pm2 restart alfie-nexus
pm2 logs alfie-nexus --lines 100
```
