#!/usr/bin/env python3
"""
ALFIE Dashboard Page Fixer - Comprehensive Edition
Fixes navigation and fetch credentials in all sub-pages
"""

import re
from pathlib import Path

PUBLIC_DIR = Path("/home/admin/.openclaw/workspace/alfie-dashboard/public")

PAGES = [
    "execute.html",
    "research.html",
    "playground.html",
    "replay.html",
    "agents.html",
    "knowledge.html",
    "templates.html",
    "council.html",
    "remote.html"
]

def fix_nav(content):
    """Replace hardcoded navigation with placeholder div"""
    # Pattern 1: Standard topbar div structure
    nav_patterns = [
        # Matches full topbar div with nested elements
        r'<div class="(topbar|header)"[^>]*>.*?</div>\s*\n*\s*(?=<div class="(main|container|sidebar|page|layout|grid))',
        # More specific pattern for nested structure
        r'<div class="(topbar|header)"[^>]*>(?:(?!</div>).)*(?:<a [^>]*>.*?</a>|<div [^>]*>.*?</div>|<span [^>]*>.*?</span>|<button [^>]*>.*?</button>)*\s*</div>\s*\n*(?=\s*<div class="(main|sidebar))'
    ]
    
    for pattern in nav_patterns:
        match = re.search(pattern, content, re.DOTALL | re.MULTILINE)
        if match:
            content = re.sub(pattern, '<div id="topbar"></div>\n\n', content, count=1, flags=re.DOTALL | re.MULTILINE)
            return content, True
    
    return content, False

def fix_fetch_calls(content):
    """Add credentials: 'include' to all fetch() calls"""
    count = 0
    
    # Pattern 1: fetch with existing options object
    def add_credentials_to_options(match):
        nonlocal count
        url = match.group(1)
        options = match.group(2)
        
        # Skip if already has credentials
        if 'credentials' in options:
            return match.group(0)
        
        count += 1
        # Add credentials before closing brace
        # Handle both with and without trailing comma
        if options.strip().endswith(','):
            return f"fetch({url}, {{{options} credentials: 'include'}})"
        else:
            return f"fetch({url}, {{{options}, credentials: 'include'}})"
    
    # Match fetch(url, {...})
    content = re.sub(
        r'fetch\s*\(\s*([^,)]+?)\s*,\s*\{([^}]*?)\}\s*\)',
        add_credentials_to_options,
        content
    )
    
    # Pattern 2: fetch without options object (simple GET)
    def add_credentials_simple(match):
        nonlocal count
        url = match.group(1)
        
        # Skip if this is part of a larger match we already processed
        if 'credentials' in match.group(0):
            return match.group(0)
        
        # Check if next character is a comma (meaning it has options already)
        if match.group(0).rstrip().endswith(','):
            return match.group(0)
        
        count += 1
        return f"fetch({url}, {{ credentials: 'include' }})"
    
    # Match fetch(url) - but be careful not to match if it's followed by a comma
    content = re.sub(
        r'fetch\s*\(\s*([^,)]+?)\s*\)(?!\s*,)',
        add_credentials_simple,
        content
    )
    
    return content, count

def process_page(filename):
    """Process a single page"""
    filepath = PUBLIC_DIR / filename
    
    print(f"\n🔧 Processing {filename}...")
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original_content = content
        
        # Fix navigation
        content, nav_fixed = fix_nav(content)
        if nav_fixed:
            print("  ✓ Replaced hardcoded navigation with placeholder")
        else:
            print("  ⚠ Could not auto-replace nav (might need manual fix)")
        
        # Fix fetch calls
        content, fetch_count = fix_fetch_calls(content)
        if fetch_count > 0:
            print(f"  ✓ Fixed {fetch_count} fetch() calls")
        else:
            print("  → No fetch calls needed fixing")
        
        # Write back only if changes were made
        if content != original_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"  ✅ {filename} updated successfully")
        else:
            print(f"  → No changes needed for {filename}")
            
    except Exception as e:
        print(f"  ❌ Error: {e}")

def main():
    print("🚀 ALFIE Dashboard Comprehensive Page Fixer\n")
    print(f"Processing {len(PAGES)} pages...\n")
    
    for page in PAGES:
        process_page(page)
    
    print("\n✨ Processing complete!\n")
    print("📋 Next steps:")
    print("  1. Review changes with: git diff public/")
    print("  2. Test pages in browser")
    print("  3. Check console for errors")
    print("  4. Restart: pm2 restart alfie-nexus")
    print()

if __name__ == "__main__":
    main()
