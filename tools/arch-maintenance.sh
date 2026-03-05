#!/bin/bash
# Arch Linux Daily Maintenance — runs at 6 AM MSK
# Safe operations only. Never auto-upgrades packages.
set -uo pipefail

REPORT=""
ALERTS=""

# 1. Check for available updates
PACMAN_UPDATES=$(pacman -Qu 2>/dev/null | wc -l)
AUR_UPDATES=$(yay -Qua 2>/dev/null | wc -l)
TOTAL=$((PACMAN_UPDATES + AUR_UPDATES))

if [ "$TOTAL" -gt 0 ]; then
  REPORT+="📦 **$TOTAL updates available** ($PACMAN_UPDATES pacman, $AUR_UPDATES AUR)\n"
  if [ "$PACMAN_UPDATES" -gt 0 ]; then
    # Check if kernel or nvidia are in the update list
    CRITICAL=$(pacman -Qu 2>/dev/null | grep -E "^(linux |nvidia|glibc )" || true)
    if [ -n "$CRITICAL" ]; then
      ALERTS+="⚠️ **Kernel/NVIDIA/glibc update pending** — needs reboot after install:\n$(echo "$CRITICAL" | head -5)\n"
    fi
  fi
fi

# 2. Clean pacman cache (keep last 2 versions)
CLEANED=$(sudo paccache -r 2>&1 | grep "finished" || echo "nothing to clean")
CACHE_SIZE=$(sudo du -sh /var/cache/pacman/pkg/ 2>/dev/null | cut -f1)
REPORT+="🗑 Cache: $CACHE_SIZE ($CLEANED)\n"

# 3. Trim journal to 200MB
JOURNAL_FREED=$(sudo journalctl --vacuum-size=200M 2>&1 | grep "freed" | tail -1 || echo "already under 200M")
REPORT+="📋 Journal: $JOURNAL_FREED\n"

# 4. Check orphans
ORPHANS=$(pacman -Qtdq 2>/dev/null | wc -l)
if [ "$ORPHANS" -gt 0 ]; then
  REPORT+="👻 $ORPHANS orphan packages (review: pacman -Qtdq)\n"
fi

# 5. Check failed systemd services
FAILED=$(systemctl --failed --no-legend 2>/dev/null | wc -l)
if [ "$FAILED" -gt 0 ]; then
  ALERTS+="🔴 $FAILED failed systemd service(s):\n$(systemctl --failed --no-legend 2>/dev/null)\n"
fi

# 6. Check disk usage
DISK_PCT=$(df / --output=pcent | tail -1 | tr -d ' %')
if [ "$DISK_PCT" -gt 85 ]; then
  ALERTS+="💾 Disk at ${DISK_PCT}% — needs attention\n"
fi

# 7. Check pm2 services
PM2_ERRORED=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
procs = json.load(sys.stdin)
errored = [p['name'] for p in procs if p.get('pm2_env',{}).get('status') == 'errored']
if errored: print(', '.join(errored))
" 2>/dev/null || true)
if [ -n "$PM2_ERRORED" ]; then
  ALERTS+="🔴 pm2 errored: $PM2_ERRORED\n"
fi

# Output
if [ -n "$ALERTS" ]; then
  echo -e "$ALERTS\n$REPORT"
  exit 1  # non-zero = has alerts worth sending
else
  echo -e "$REPORT"
  exit 0  # clean = just log it
fi
