# Monitoring & Anomaly Detection

Infrastructure health monitoring and day-of-week-aware statistical anomaly detection for business metrics.

## Components

### `anomaly_detector.py` — DOW-Aware Statistical Anomaly Detection

The key insight: business metrics have strong day-of-week patterns. A Monday that's 30% below the weekly average might be perfectly normal, but a Friday at the same level is a red alert.

**Algorithm:**
1. Query today's cumulative metrics from multiple data sources (with retry logic)
2. Pull same-DOW historical data for the past N weeks (default: 4)
3. Compute z-score against same-DOW same-hour distribution
4. Factor in holiday multipliers and payday effects
5. Alert when z-score exceeds threshold (default: -2.0 std devs)

**Features:**
- Multi-source data aggregation with timezone-aware timestamp normalization
- Data freshness monitoring (alerts if data is stale)
- Configurable z-score thresholds and minimum sample requirements
- Optional v4 forecast engine context (DOW curves, holiday/payday awareness)
- Retry logic with exponential backoff for DB queries
- Morning grace period (skip alerts before sufficient volume)

### `forecasting.py` — Temporal Pattern Forecasting

Projects daily/monthly business metrics using day-of-week-specific curves.

**Math:**
- DOW multipliers (empirically derived): Mon=0.91x, Tue=1.00x, Wed=1.06x, Thu=1.07x, Fri=1.15x, Sat=1.00x, Sun=0.81x
- Hourly cumulative curves per DOW (24 data points each) — not linear, captures real intraday patterns
- Holiday multiplier database (country-specific holidays affect volume differently)
- Payday calendar effects (month-end, DACH payday ramp, US mid-month)
- Projection: `current_value / curve_pct_at_current_hour`

### `infra_health.py` — Infrastructure Health Check

Quick status check for all critical services (LLM proxy, Ollama, Qdrant, embeddings, reranker, etc.).

## What Makes This Novel

1. **DOW-aware anomaly detection** — most alerting systems compare against a flat average. This compares Mondays to Mondays, Fridays to Fridays, at the same hour. Dramatically reduces false positives.

2. **Temporal pattern stacking** — DOW curves × holiday multipliers × payday effects × hourly cumulative curves. Four temporal signals combined for realistic projections.

3. **Multi-source with freshness monitoring** — doesn't just check if metrics are anomalous, also checks if the data pipeline itself is healthy (stale data = silent failure).
