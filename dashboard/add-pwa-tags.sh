#!/bin/bash
# Add PWA meta tags to all HTML files in public/

PWA_TAGS='<!-- PWA Meta Tags -->
<meta name="theme-color" content="#0a0a0f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">
<link rel="apple-touch-icon" href="/icon-192.png">'

SW_REGISTRATION='<!-- Service Worker Registration -->
<script>
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js")
      .then(reg => console.log("✅ Service worker registered:", reg.scope))
      .catch(err => console.error("❌ Service worker registration failed:", err));
  });
}
</script>'

cd "$(dirname "$0")/public"

for file in *.html; do
  # Skip if already has PWA tags
  if grep -q "PWA Meta Tags" "$file"; then
    echo "⏭️  Skipping $file (already has PWA tags)"
    continue
  fi
  
  # Skip login.html, offline.html, and index.html (already done)
  if [[ "$file" == "login.html" || "$file" == "offline.html" || "$file" == "index.html" ]]; then
    echo "⏭️  Skipping $file (manually configured)"
    continue
  fi
  
  echo "✏️  Adding PWA tags to $file"
  
  # Add PWA tags after <title> tag
  sed -i "/<title>/a\\
$PWA_TAGS" "$file"
  
  # Add service worker registration before </body>
  sed -i "s|</body>|$SW_REGISTRATION\\n</body>|" "$file"
done

echo "✅ PWA tags added to all HTML files!"
