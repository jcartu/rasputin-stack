"""
Business metric projection engine v3.
Uses the v4 forecast engine's DOW-specific curves, payday, and holiday data.
Shared by daily report + high-value event alerts.
"""
import sys
import json
from datetime import datetime, timedelta

# Add dashboard dir to import forecast engine
sys.path.insert(0, "/path/to/workspace/business-dashboard")

DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

def _get_forecast_data():
    """Load the latest forecast detail from data.json (refreshed by fetch_data.py)."""
    try:
        with open("/path/to/workspace/business-dashboard/data.json") as f:
            d = json.load(f)
        return d.get("forecast_detail", {})
    except:
        return {}


def _get_dow_curve_pct(dow, hour_float):
    """Get cumulative % done for a specific DOW and fractional hour using v4 curves."""
    try:
        from forecast_engine import DOW_HOURLY_CUM
        curve = DOW_HOURLY_CUM.get(dow, DOW_HOURLY_CUM[0])
        hour_idx = min(23, int(hour_float))
        frac = curve[hour_idx]
        if hour_idx < 23:
            frac_within = hour_float - hour_idx
            frac += frac_within * (curve[hour_idx + 1] - curve[hour_idx])
        return frac
    except:
        return hour_float / 24  # Fallback to linear


def _get_holiday_info(dt=None):
    """Get holiday multiplier and name for a given date."""
    try:
        from forecast_engine import get_holiday_multiplier, get_payday_multiplier
        if dt is None:
            dt = datetime.now().date()
        elif hasattr(dt, 'date'):
            dt = dt.date()
        hol_mult, hol_name = get_holiday_multiplier(dt)
        days_in_month = 31 if dt.month in (1,3,5,7,8,10,12) else 30 if dt.month in (4,6,9,11) else 28
        pay_mult = get_payday_multiplier(dt.day, days_in_month)
        return hol_mult, hol_name, pay_mult
    except:
        return 1.0, None, 1.0


def format_projections(today_usd, mtd_usd, avg_daily_7d, prev_month_total=1983681, prev_month_days=28, current_hour=None):
    """Return formatted projection lines for reports using v4 forecast engine."""
    now = datetime.now()
    if current_hour is None:
        current_hour = now.hour + now.minute / 60
    
    dow = now.weekday()
    dow_name = DOW_NAMES[dow]
    day_of_month = now.day
    days_in_month = 31 if now.month in [1, 3, 5, 7, 8, 10, 12] else 30 if now.month in [4, 6, 9, 11] else 28
    
    lines = []
    
    # Get DOW-specific curve completion %
    pct = _get_dow_curve_pct(dow, current_hour)
    
    # Get holiday/payday info
    hol_mult, hol_name, pay_mult = _get_holiday_info()
    
    # Try to get the forecast engine's projection
    fc = _get_forecast_data()
    fc_projected = fc.get("today_projected")
    fc_dow_expected = fc.get("today_dow_expected")
    fc_forecast_mid = fc.get("forecast_mid")
    dow_avg = fc.get("dow_averages", {}).get(dow_name) or avg_daily_7d
    dow_mult = fc.get("dow_multipliers", {}).get(dow_name, 1.0)
    
    if pct and pct > 0.05:
        # Use forecast engine projection if available, else curve-based
        if fc_projected and fc_projected > 0:
            projected = fc_projected
        else:
            projected = today_usd / pct if pct > 0.1 else today_usd * 2
        
        pct_display = pct * 100
        
        # Compare to DOW average (not 7-day avg �� that mixes all DOWs)
        compare_avg = dow_avg or avg_daily_7d
        if compare_avg and compare_avg > 0:
            vs_avg = (projected / compare_avg) * 100
            expected_now = compare_avg * pct
            
            if vs_avg >= 110:
                lines.append(f"\U0001f7e2 Strong {dow_name} — tracking ${projected:,.0f} ({vs_avg:.0f}% of {dow_name} avg ${compare_avg:,.0f})")
            elif vs_avg >= 90:
                lines.append(f"\u26aa On pace — tracking ${projected:,.0f} ({vs_avg:.0f}% of {dow_name} avg ${compare_avg:,.0f})")
            elif vs_avg >= 75:
                lines.append(f"\U0001f7e1 Slightly slow {dow_name} — tracking ${projected:,.0f} ({vs_avg:.0f}% of avg ${compare_avg:,.0f})")
            else:
                lines.append(f"\U0001f534 Slow {dow_name} — tracking ${projected:,.0f} ({vs_avg:.0f}% of avg ${compare_avg:,.0f})")
            
            lines.append(f"\u23f1 ${today_usd:,.0f} so far ({pct_display:.0f}% of {dow_name} curve) \u00b7 expected ${expected_now:,.0f} at this point")
        else:
            lines.append(f"\u23f1 ${today_usd:,.0f} at {pct_display:.0f}% of {dow_name} curve \u2192 projected ${projected:,.0f}")
    else:
        if avg_daily_7d and avg_daily_7d > 0:
            lines.append(f"\u23f1 Early — ${today_usd:,.0f} so far ({dow_name}, avg ${dow_avg or avg_daily_7d:,.0f})")
    
    # DOW context line
    if dow_mult:
        strength = "weakest" if dow_mult < 0.92 else "below avg" if dow_mult < 0.98 else "average" if dow_mult < 1.02 else "above avg" if dow_mult < 1.10 else "strongest"
        lines.append(f"\U0001d4d3\U0001d4de\U0001d4e6 {dow_name} = {strength} day ({dow_mult:.2f}x)")
    
    # Payday + Holiday context
    context_parts = []
    if pay_mult > 1.0:
        if day_of_month >= 28:
            context_parts.append(f"\U0001f4b0 Month-end payday boost ({pay_mult}x)")
        elif day_of_month >= 25:
            context_parts.append(f"\U0001f4b0 DACH payday ramp ({pay_mult}x)")
        elif day_of_month <= 2:
            context_parts.append(f"\U0001f4b0 Post-payday carry ({pay_mult}x)")
        elif day_of_month in (14, 15, 16):
            context_parts.append(f"\U0001f4b0 US mid-month pay ({pay_mult}x)")
    if hol_name:
        emoji = "\U0001f4c8" if hol_mult > 1.0 else "\U0001f4c9" if hol_mult < 1.0 else "\U0001d4d7"
        context_parts.append(f"{emoji} {hol_name} ({hol_mult}x)")
    if context_parts:
        lines.append(" \u00b7 ".join(context_parts))
    
    # Rate per hour
    if current_hour >= 3:
        rate = today_usd / current_hour
        lines.append(f"\U0001f4b0 Rate: ${rate:,.0f}/hr")
    
    # MTD + monthly projection (use forecast engine if available)
    if day_of_month > 0 and mtd_usd > 0:
        if fc_forecast_mid and fc_forecast_mid > 0:
            monthly_projected = fc_forecast_mid
        elif avg_daily_7d and avg_daily_7d > 0:
            monthly_projected = avg_daily_7d * days_in_month
        else:
            monthly_projected = (mtd_usd / day_of_month) * days_in_month
        
        lines.append(f"\U0001f4c5 MTD: ${mtd_usd:,.0f} ({day_of_month} day{'s' if day_of_month > 1 else ''})")
        lines.append(f"\U0001f3af Month est: ${monthly_projected:,.0f} (prev: ${prev_month_total:,.0f})")
    
    # Upcoming events (next 3 days)
    upcoming = []
    for i in range(1, 4):
        future = (now + timedelta(days=i)).date()
        h_mult, h_name, p_mult = _get_holiday_info(future)
        if h_name:
            future_dow = DOW_NAMES[future.weekday()]
            upcoming.append(f"{future_dow} {future.day}: {h_name} ({h_mult}x)")
    if upcoming:
        lines.append(f"\U0001f4c6 Coming up: {' | '.join(upcoming)}")
    
    return lines


if __name__ == "__main__":
    print("=== Test Projection ===")
    lines = format_projections(27661, 99232, 81764)
    for l in lines:
        print(l)
