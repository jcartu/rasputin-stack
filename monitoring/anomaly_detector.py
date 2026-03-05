#!/usr/bin/env python3
"""
anomaly_detector.py — DOW-Aware Time-Series Anomaly Detection (v2)
==================================================================
Compares today's metrics against historical baselines against same-DOW historical data,
using the v4 forecast engine for context (holiday/payday awareness).

Key improvements over v1:
1. Queries BOTH multiple data sources
2. Uses business-query.sh (reliable) instead of mcporter (intermittent timeouts)
3. Adds v4 forecast engine context (DOW name, holiday, payday, curve position)
4. Retry logic on DB failures (3 attempts)

Thresholds:
    Z_THRESHOLD      = -2.0   (alert if >2 std devs below same-DOW same-hour mean)
    MIN_SAMPLES      = 2      (need at least 2 historical data points)
    HISTORICAL_WEEKS = 4      (compare against last 4 same-DOW occurrences)
    MORNING_GRACE_HOUR = 7    (MSK — skip before 07:00, volume too thin)
"""

import subprocess
import json
import sys
import math
import time
from datetime import datetime, timedelta, date
from decimal import Decimal

# ── Config ─────────────────────────────────────────────────────────────────
Z_THRESHOLD             = -2.0
MIN_SAMPLES             = 2
HISTORICAL_WEEKS        = 4
MORNING_GRACE_HOUR      = 7     # MSK
DATA_STALENESS_HOURS    = 2     # Alert if data older than 2 hours (same for both platforms)
# SourceB stores timestamps in UTC-5 (EST), SourceA in UTC
PLATFORM_UTC_OFFSET     = {"source_b": -5, "source_a": 0}
DB_RETRIES              = 3
DB_RETRY_DELAY          = 5     # seconds

VERBOSE    = "--verbose" in sys.argv or "-v" in sys.argv
DRY_RUN    = "--dry-run" in sys.argv
ALERT_ONLY = "--alert-only" in sys.argv

QUERY_SCRIPT = os.environ.get("QUERY_SCRIPT", "/path/to/query.sh")

# v4 forecast engine
sys.path.insert(0, "/path/to/workspace/business-dashboard")
try:
    from forecast_engine import (
        get_holiday_multiplier, get_payday_multiplier,
        DOW_HOURLY_CUM
    )
    HAS_V4 = True
except ImportError:
    HAS_V4 = False

DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DOW_MULTS = {0: 0.909, 1: 0.999, 2: 1.062, 3: 1.072, 4: 1.150, 5: 0.999, 6: 0.810}


# ── DB access via business-query.sh (more reliable than mcporter) ─────────────
def query(sql: str) -> list:
    """Run SQL with retry logic. Returns list of row dicts."""
    if DRY_RUN:
        print(f"[DRY-RUN] {sql[:120].strip()}...", file=sys.stderr)
        return []

    for attempt in range(1, DB_RETRIES + 1):
        try:
            result = subprocess.run(
                ["bash", QUERY_SCRIPT, sql],
                capture_output=True, text=True, timeout=45
            )
            if result.returncode != 0:
                print(f"[DB] Attempt {attempt}/{DB_RETRIES} failed: {result.stderr[:200]}", file=sys.stderr)
                if attempt < DB_RETRIES:
                    time.sleep(DB_RETRY_DELAY)
                continue

            raw = result.stdout.strip()
            if not raw:
                return []
            # business-query.sh returns Python repr with Decimal/datetime objects
            import datetime as _dt
            safe = raw.replace(': null', ': None').replace(':null', ':None')
            safe = safe.replace(': true', ': True').replace(':true', ':True')
            safe = safe.replace(': false', ': False').replace(':false', ':False')
            parsed = eval(safe, {"__builtins__": {}, "Decimal": Decimal,
                                  "datetime": _dt, "date": _dt.date, "None": None})
            # Convert Decimal/datetime to JSON-friendly types
            cleaned = []
            for row in parsed:
                cr = {}
                for k, v in row.items():
                    if isinstance(v, Decimal): cr[k] = float(v)
                    elif hasattr(v, 'isoformat'): cr[k] = str(v)
                    else: cr[k] = v
                cleaned.append(cr)
            return cleaned
        except subprocess.TimeoutExpired:
            print(f"[DB] Attempt {attempt}/{DB_RETRIES} timed out", file=sys.stderr)
            if attempt < DB_RETRIES:
                time.sleep(DB_RETRY_DELAY)
        except Exception as e:
            print(f"[DB] Attempt {attempt}/{DB_RETRIES} error: {e}", file=sys.stderr)
            if attempt < DB_RETRIES:
                time.sleep(DB_RETRY_DELAY)

    return None  # All retries failed


# ── Data Freshness Check ────────────────────────────────────────────────────
def get_latest_transaction_time(platform: str) -> tuple:
    """
    Get the latest transaction timestamp for a platform.
    Returns (timestamp_str, hours_ago) or (None, None) if query fails.
    """
    if platform == "source_b":
        sql = "SELECT MAX(ts) as latest FROM source_b.transaction_deposit"
    elif platform == "source_a":
        sql = "SELECT MAX(created_at) as latest FROM source_a.transactions WHERE type='deposit'"
    else:
        return None, None

    result = query(sql)
    if not result or not result[0] or result[0].get("latest") is None:
        return None, None

    latest_str = str(result[0]["latest"])
    # Parse timestamp - handle PostgreSQL timestamp format
    # Format: 2026-03-02 18:30:45.123456 or 2026-03-02 18:30:45
    try:
        if "." in latest_str:
            latest_dt = datetime.strptime(latest_str[:19], "%Y-%m-%d %H:%M:%S")
        else:
            latest_dt = datetime.strptime(latest_str, "%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return None, None

    # Adjust for platform timezone: SourceB stores in UTC-5 (EST), SourceA in UTC
    tz_offset = PLATFORM_UTC_OFFSET.get(platform, 0)
    latest_dt_utc = latest_dt + timedelta(hours=-tz_offset)  # Convert to UTC

    from datetime import timezone
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    hours_ago = (now_utc - latest_dt_utc).total_seconds() / 3600

    return latest_dt_utc, hours_ago


def check_data_freshness() -> dict:
    """
    Check data freshness for both platforms.
    Returns dict with platform -> (is_stale, latest_time_str, hours_ago)
    """
    freshness = {}
    for platform in ["source_b", "source_a"]:
        latest_dt, hours_ago = get_latest_transaction_time(platform)
        if latest_dt is None:
            freshness[platform] = (True, "never", float('inf'))
        else:
            is_stale = hours_ago > DATA_STALENESS_HOURS
            time_str = latest_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
            freshness[platform] = (is_stale, time_str, hours_ago)
    return freshness


# ── Stats ───────────────────────────────────────────────────────────────────
def mean(values):
    return sum(values) / len(values) if values else 0.0

def stddev(values):
    if len(values) < 2:
        return 0.0
    m = mean(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / len(values))

def zscore_check(label, emoji, today_val, hist_vals):
    if not hist_vals or len(hist_vals) < MIN_SAMPLES:
        return False, f"{emoji} {label}: {today_val:,.0f}  (need more history)"

    m = mean(hist_vals)
    s = stddev(hist_vals)
    pct = (today_val / m * 100) if m > 0 else 0.0

    if s > 0:
        z = (today_val - m) / s
        z_str = f"z={z:+.1f}\u03c3"
        is_anomaly = z < Z_THRESHOLD
    else:
        z_str = "\u03c3=0"
        is_anomaly = (pct < 70.0)

    marker = "\U0001f534" if is_anomaly else emoji
    detail = f"{marker} {label}: {today_val:,.0f} vs {DOW_SHORT[datetime.now().weekday()]} avg {m:,.0f} ({pct:.0f}%, {z_str})"
    return is_anomaly, detail


# ── Queries (BOTH platforms, same-hour window) ──────────────────────────────
def deposits_ds_sql(date_expr, hour_limit):
    """SourceA deposits up to hour_limit (MSK)."""
    utc_hour = (hour_limit - 3) % 24
    return f"SELECT COUNT(*) AS deps, ROUND(COALESCE(SUM(amount_eur),0)::numeric, 2) AS vol_eur, COUNT(*) FILTER (WHERE is_first_deposit) AS ftds FROM source_a.transactions WHERE type = 'deposit' AND status = 'approved' AND created_at >= {date_expr} AND created_at < {date_expr} + ({utc_hour} + 1) * INTERVAL '1 hour'"


def deposits_rv_sql(date_expr, hour_limit):
    """SourceB deposits up to hour_limit (MSK)."""
    utc_hour = (hour_limit - 3) % 24
    return f"SELECT COUNT(*) AS deps, ROUND(COALESCE(SUM(amount_eur),0)::numeric, 2) AS vol_eur FROM source_b.transaction_deposit WHERE status = 'COMPLETE' AND ts >= {date_expr} AND ts < {date_expr} + ({utc_hour} + 1) * INTERVAL '1 hour'"


def signups_ds_sql(date_expr, hour_limit):
    utc_hour = (hour_limit - 3) % 24
    return f"SELECT COUNT(*) AS signups FROM source_a.members WHERE created_at >= {date_expr} AND created_at < {date_expr} + ({utc_hour} + 1) * INTERVAL '1 hour'"


def signups_rv_sql(date_expr, hour_limit):
    utc_hour = (hour_limit - 3) % 24
    return f"SELECT COUNT(*) AS signups FROM source_b.users WHERE created >= {date_expr} AND created < {date_expr} + ({utc_hour} + 1) * INTERVAL '1 hour'"


def fetch_combined(date_expr, hour_limit):
    """Fetch deposits + signups from both platforms, return combined dict."""
    ds_dep = query(deposits_ds_sql(date_expr, hour_limit))
    rv_dep = query(deposits_rv_sql(date_expr, hour_limit))
    ds_sig = query(signups_ds_sql(date_expr, hour_limit))
    rv_sig = query(signups_rv_sql(date_expr, hour_limit))

    def val(rows, key):
        if rows and isinstance(rows, list) and rows[0]:
            return float(str(rows[0].get(key, 0) or 0))
        return 0.0

    return {
        "deposits": val(ds_dep, "deps") + val(rv_dep, "deps"),
        "vol_eur": val(ds_dep, "vol_eur") + val(rv_dep, "vol_eur"),
        "ftds": val(ds_dep, "ftds"),  # Only SourceA tracks FTDs
        "signups": val(ds_sig, "signups") + val(rv_sig, "signups"),
    }


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    now = datetime.now()  # Server is in MSK
    cur_hour_msk = now.hour
    dow = now.weekday()
    dow_name = DOW_NAMES[dow]
    dow_short = DOW_SHORT[dow]
    time_label = now.strftime("%b %d, %H:%M MSK")

    if cur_hour_msk < MORNING_GRACE_HOUR:
        if not ALERT_ONLY:
            print(f"\u23f8\ufe0f Grace period \u2014 before {MORNING_GRACE_HOUR:02d}:00 MSK, skipping")
        sys.exit(0)

    # ── Check data freshness BEFORE anomaly detection ─────────────────────
    freshness = check_data_freshness()
    stale_platforms = [p for p, (is_stale, _, _) in freshness.items() if is_stale]

    if ALERT_ONLY and stale_platforms:
        # In alert-only mode, report stale data and do NOT run z-score analysis
        for platform in stale_platforms:
            _, time_str, hours_ago = freshness[platform]
            platform_display = "SourceB" if platform == "source_b" else "SourceA"
            print(f"\u26a0\ufe0f [{platform_display}] data feed stale since {time_str} ({hours_ago:.1f} hours ago)")
        sys.exit(1)

    elif stale_platforms:
        # Non-alert-only mode: warn but continue
        for platform in stale_platforms:
            _, time_str, hours_ago = freshness[platform]
            platform_display = "SourceB" if platform == "source_b" else "SourceA"
            print(f"\u26a0\ufe0f WARNING: [{platform_display}] data feed stale since {time_str} ({hours_ago:.1f} hours ago) - continuing anyway")

    # ── Fetch today (both platforms, separate queries) ──────────────────
    today = fetch_combined("CURRENT_DATE", cur_hour_msk)

    if today is None:
        print("\u26a0\ufe0f DB connection failed after 3 retries \u2014 check business-query.sh and tunnel")
        sys.exit(1)

    today_deps = today["deposits"]
    today_vol = today["vol_eur"]
    today_ftds = today["ftds"]
    today_signups = today["signups"]

    # ── Fetch history (same DOW, same hour window, both platforms) ────────
    hist_vol = []
    hist_deps = []
    hist_ftds = []
    hist_signups = []

    for w in range(1, HISTORICAL_WEEKS + 1):
        offset = w * 7
        h = fetch_combined(f"CURRENT_DATE - {offset}", cur_hour_msk)
        if h:
            hist_deps.append(h["deposits"])
            hist_vol.append(h["vol_eur"])
            hist_ftds.append(h["ftds"])
            hist_signups.append(h["signups"])

    # ── Anomaly detection ────────────────────────────────────────────────
    checks = [
        ("Deposits",    "\U0001f4b0", today_deps,    hist_deps),
        ("Volume (\u20ac)", "\U0001f4b6", today_vol,     hist_vol),
        ("FTDs",        "\U0001f195", today_ftds,    hist_ftds),
        ("Signups",     "\U0001f464", today_signups, hist_signups),
    ]

    anomalies = []
    all_details = []
    for label, emoji, today_v, hist_v in checks:
        is_anom, detail = zscore_check(label, emoji, today_v, hist_v)
        all_details.append(detail)
        if is_anom:
            anomalies.append(detail)

    # ── v4 Forecast Engine Context ──────────────────────────────────────
    context_lines = []
    if HAS_V4:
        # DOW curve position
        curve = DOW_HOURLY_CUM.get(dow, DOW_HOURLY_CUM[0])
        hour_idx = min(23, cur_hour_msk)
        frac = curve[hour_idx]
        context_lines.append(f"\U0001f4c8 {dow_short} curve: {frac*100:.0f}% done at {cur_hour_msk:02d}:00 MSK (DOW mult: {DOW_MULTS.get(dow, 1.0):.2f}x)")

        # Holiday
        today_date = now.date()
        hol_mult, hol_name = get_holiday_multiplier(today_date)
        if hol_name:
            context_lines.append(f"\U0001f384 Holiday: {hol_name} ({hol_mult}x)")

        # Payday
        dim = 31 if now.month in (1,3,5,7,8,10,12) else 30 if now.month in (4,6,9,11) else 28
        pay_mult = get_payday_multiplier(now.day, dim)
        if pay_mult > 1.0:
            context_lines.append(f"\U0001f4b0 Payday: {pay_mult}x (day {now.day} of month)")

    # ── Format output ─────────────────────────────────────────────────────
    window_str = f"00:00\u2013{cur_hour_msk+1:02d}:00 MSK vs last {HISTORICAL_WEEKS} {dow_name}s (same window, both platforms)"

    if anomalies:
        lines = [
            f"\U0001f534 ANOMALY ALERT \u2014 {time_label}",
            f"\U0001f4c5 {window_str}",
            "",
            *anomalies,
        ]
        if context_lines:
            lines += ["", "\U0001f9e0 Context:"] + context_lines
        if VERBOSE:
            lines += ["", "\U0001f4ca Full breakdown:"] + all_details
        print("\n".join(lines))
        sys.exit(1)
    else:
        if not ALERT_ONLY:
            lines = [
                f"\u2705 All normal \u2014 {time_label}",
                f"\U0001f4c5 {window_str}",
                "",
                *all_details,
            ]
            if context_lines:
                lines += [""] + context_lines
            print("\n".join(lines))
        # ALERT_ONLY + no anomaly = silent exit 0


if __name__ == "__main__":
    main()
