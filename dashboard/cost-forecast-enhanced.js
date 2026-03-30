/**
 * Enhanced Cost Forecasting System
 * - User-configurable budgets with persistence
 * - Multi-threshold alerts (50%, 75%, 90%, 100%)
 * - Trend analysis with confidence scoring
 * - "Days until budget exhausted" predictions
 * - Historical spending patterns
 */

const fs = require('fs');
const path = require('path');

const BUDGET_FILE = path.join(__dirname, '.budget_settings.json');
const FORECAST_CACHE_FILE = path.join(__dirname, '.forecast_cache.json');

// Default budget settings
let budgetSettings = {
  monthlyBudget: 200,  // $200/month default
  alertThresholds: [0.5, 0.75, 0.9, 1.0],  // Alert at 50%, 75%, 90%, 100%
  lastAlertSent: {},  // Track when alerts were sent to avoid spam
  enabled: true,
};

// Load budget settings
function loadBudgetSettings() {
  try {
    if (fs.existsSync(BUDGET_FILE)) {
      const data = fs.readFileSync(BUDGET_FILE, 'utf8');
      budgetSettings = { ...budgetSettings, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('[BUDGET] Failed to load settings:', e.message);
  }
}

// Save budget settings
function saveBudgetSettings() {
  try {
    fs.writeFileSync(BUDGET_FILE, JSON.stringify(budgetSettings, null, 2), 'utf8');
  } catch (e) {
    console.error('[BUDGET] Failed to save settings:', e.message);
  }
}

// Update budget settings
function updateBudgetSettings(updates) {
  budgetSettings = { ...budgetSettings, ...updates };
  saveBudgetSettings();
  return budgetSettings;
}

/**
 * Enhanced cost forecast calculation
 * @param {Array} costHistory - Array of {ts, cost, delta} objects
 * @param {number} lifetimeCost - Current lifetime cost
 * @returns {Object} Forecast data with projections and alerts
 */
function calculateEnhancedForecast(costHistory, lifetimeCost) {
  const now = Date.now();
  const msPerHour = 60 * 60 * 1000;
  const msPerDay = 24 * msPerHour;
  const msPerWeek = 7 * msPerDay;
  const mmedical-sampleonth = 30 * msPerDay;
  
  // Time windows
  const oneDayAgo = now - msPerDay;
  const sevenDaysAgo = now - msPerWeek;
  const thirtyDaysAgo = now - mmedical-sampleonth;
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  
  // Filter history by time periods
  const last24h = costHistory.filter(e => e.ts > oneDayAgo);
  const last7d = costHistory.filter(e => e.ts > sevenDaysAgo);
  const last30d = costHistory.filter(e => e.ts > thirtyDaysAgo);
  const thisMonth = costHistory.filter(e => e.ts > startOfMonth);
  
  // Calculate burn rates ($/hour)
  const calculateBurnRate = (history) => {
    if (history.length < 2) return 0;
    const timeDelta = (history[history.length - 1].ts - history[0].ts) / msPerHour;
    const costDelta = history[history.length - 1].cost - history[0].cost;
    return timeDelta > 0 ? costDelta / timeDelta : 0;
  };
  
  const burnRate24h = calculateBurnRate(last24h);
  const burnRate7d = calculateBurnRate(last7d);
  const burnRate30d = calculateBurnRate(last30d);
  
  // Weighted average (favor recent data)
  const avgBurnRate = burnRate24h > 0 ? 
    (burnRate24h * 0.6 + burnRate7d * 0.3 + burnRate30d * 0.1) : 
    (burnRate7d > 0 ? burnRate7d : burnRate30d);
  
  // Projections
  const dailyRate = avgBurnRate * 24;
  const weeklyRate = avgBurnRate * 24 * 7;
  const monthlyRate = avgBurnRate * 24 * 30;
  
  const projectedToday = lifetimeCost + (avgBurnRate * 24);
  const projectedWeek = lifetimeCost + weeklyRate;
  const projectedMonth = lifetimeCost + monthlyRate;
  
  // Month-to-date spending
  const monthToDate = thisMonth.length > 0 ? 
    thisMonth.reduce((sum, e) => sum + e.delta, 0) : 0;
  
  // Days remaining in month
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const currentDay = new Date().getDate();
  const daysRemainingInMonth = daysInMonth - currentDay;
  
  // Budget analysis
  const budget = budgetSettings.monthlyBudget;
  const budgetUsedPercent = monthToDate / budget;
  const budgetRemaining = budget - monthToDate;
  const projectedMonthEnd = monthToDate + (dailyRate * daysRemainingInMonth);
  const projectedOverage = Math.max(0, projectedMonthEnd - budget);
  
  // Days until budget exhausted (if spending continues at current rate)
  const daysUntilBudgetExhausted = budgetRemaining > 0 && dailyRate > 0 ? 
    budgetRemaining / dailyRate : Infinity;
  
  // Confidence scoring
  const dataPoints24h = last24h.length;
  const dataPoints7d = last7d.length;
  let confidence = 'low';
  if (dataPoints24h >= 24) confidence = 'high';  // 24+ hours of data
  else if (dataPoints7d >= 48) confidence = 'medium';  // 2+ days
  
  // Trend analysis (is spending accelerating or decelerating?)
  let trend = 'stable';
  if (burnRate24h > burnRate7d * 1.2) trend = 'accelerating';
  else if (burnRate24h < burnRate7d * 0.8) trend = 'decelerating';
  
  // Alert generation
  const alerts = [];
  
  // Budget threshold alerts
  budgetSettings.alertThresholds.forEach(threshold => {
    if (budgetUsedPercent >= threshold) {
      const thresholdPct = (threshold * 100).toFixed(0);
      const severity = threshold >= 1.0 ? 'critical' : threshold >= 0.9 ? 'high' : 'medium';
      alerts.push({
        type: 'budget_threshold',
        severity,
        message: `${thresholdPct}% of monthly budget used ($${monthToDate.toFixed(2)} / $${budget})`,
        threshold,
      });
    }
  });
  
  // Overage projection alert
  if (projectedOverage > 0) {
    alerts.push({
      type: 'projected_overage',
      severity: 'high',
      message: `Projected to exceed budget by $${projectedOverage.toFixed(2)} (${((projectedOverage / budget) * 100).toFixed(0)}%)`,
      overageAmount: projectedOverage,
    });
  }
  
  // Days until exhaustion alert
  if (daysUntilBudgetExhausted < 7 && daysUntilBudgetExhausted > 0) {
    alerts.push({
      type: 'budget_exhaustion',
      severity: daysUntilBudgetExhausted < 3 ? 'critical' : 'high',
      message: `Budget will be exhausted in ${daysUntilBudgetExhausted.toFixed(1)} days at current rate`,
      daysRemaining: daysUntilBudgetExhausted,
    });
  }
  
  // Trend acceleration alert
  if (trend === 'accelerating' && burnRate24h > burnRate7d * 1.5) {
    alerts.push({
      type: 'spending_acceleration',
      severity: 'medium',
      message: `Spending accelerating: ${((burnRate24h / burnRate7d - 1) * 100).toFixed(0)}% faster than 7-day average`,
      accelerationFactor: burnRate24h / burnRate7d,
    });
  }
  
  // Historical spending pattern (last 30 days by day)
  const dailySpending = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = now - (i * msPerDay);
    const dayEnd = dayStart + msPerDay;
    const dayHistory = costHistory.filter(e => e.ts >= dayStart && e.ts < dayEnd);
    const daySpend = dayHistory.reduce((sum, e) => sum + e.delta, 0);
    
    dailySpending.push({
      date: new Date(dayStart).toISOString().split('T')[0],
      spend: daySpend,
      timestamp: dayStart,
    });
  }
  
  // Weekly comparison
  const lastWeekSpend = last7d.reduce((sum, e) => sum + e.delta, 0);
  const prevWeekHistory = costHistory.filter(e => 
    e.ts >= sevenDaysAgo - msPerWeek && e.ts < sevenDaysAgo
  );
  const prevWeekSpend = prevWeekHistory.reduce((sum, e) => sum + e.delta, 0);
  const weekOverWeekChange = prevWeekSpend > 0 ? 
    ((lastWeekSpend - prevWeekSpend) / prevWeekSpend) * 100 : 0;
  
  return {
    // Current stats
    currentCost: lifetimeCost,
    monthToDateSpend: monthToDate,
    
    // Burn rates
    burnRatePerHour: avgBurnRate,
    burnRatePerDay: dailyRate,
    burnRatePerWeek: weeklyRate,
    burnRatePerMonth: monthlyRate,
    
    // Projections
    projectedToday,
    projectedWeek,
    projectedMonth,
    projectedMonthEnd,
    
    // Budget analysis
    budget,
    budgetUsedPercent,
    budgetRemaining,
    budgetUsedDollars: monthToDate,
    projectedOverage,
    daysUntilBudgetExhausted: daysUntilBudgetExhausted === Infinity ? null : daysUntilBudgetExhausted,
    daysRemainingInMonth,
    
    // Metadata
    confidence,
    trend,
    lastUpdated: now,
    dataPoints: {
      last24h: dataPoints24h,
      last7d: dataPoints7d,
      last30d: last30d.length,
    },
    
    // Alerts
    alerts,
    hasAlerts: alerts.length > 0,
    criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
    
    // Historical data
    dailySpending,
    weekOverWeekChange,
    lastWeekSpend,
    prevWeekSpend,
    
    // Rate comparisons
    rates: {
      last24h: burnRate24h * 24,
      last7d: burnRate7d * 24,
      last30d: burnRate30d * 24,
    },
  };
}

// Cache last forecast to avoid recalculation
let forecastCache = null;
let forecastCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

function getCachedForecast(costHistory, lifetimeCost) {
  const now = Date.now();
  if (forecastCache && (now - forecastCacheTime) < CACHE_TTL) {
    return forecastCache;
  }
  
  forecastCache = calculateEnhancedForecast(costHistory, lifetimeCost);
  forecastCacheTime = now;
  
  // Save to disk for persistence
  try {
    fs.writeFileSync(FORECAST_CACHE_FILE, JSON.stringify(forecastCache, null, 2), 'utf8');
  } catch (e) {}
  
  return forecastCache;
}

// Initialize
loadBudgetSettings();

module.exports = {
  calculateEnhancedForecast,
  getCachedForecast,
  updateBudgetSettings,
  getBudgetSettings: () => budgetSettings,
};
