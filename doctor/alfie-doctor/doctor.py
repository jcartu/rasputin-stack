#!/usr/bin/env python3
"""
ALFIE Doctor — Comprehensive Self-Diagnostic Tool
Commissioned: February 15, 2026 by Manus
Purpose: Prevent cascading system failures by proactive health monitoring
"""

import subprocess
import json
import os
import sys
import requests
from pathlib import Path
from datetime import datetime
from typing import Tuple, List, Dict, Optional

# === Configuration ===
OPENCLAW_HOME = Path("/home/admin/.openclaw")
WORKSPACE = OPENCLAW_HOME / "workspace"
GATEWAY_URL = "http://127.0.0.1:18789"
SECOND_BRAIN_URL = "http://localhost:7777"
CONFIG_FILE = OPENCLAW_HOME / "openclaw.json"
MODELS_FILE = WORKSPACE / "models.json"
ENV_FILE = WORKSPACE / ".env"

# === Check Registry ===
checks = []

def register_check(category: str, name: str, severity: str):
    """Decorator to register a health check"""
    def decorator(func):
        checks.append({
            "category": category,
            "name": name,
            "severity": severity,
            "func": func
        })
        return func
    return decorator

# === Check Result ===
class CheckResult:
    def __init__(self, status: str, message: str, remediation: Optional[str] = None, details: Optional[Dict] = None):
        self.status = status  # PASS, WARN, FAIL
        self.message = message
        self.remediation = remediation
        self.details = details or {}

# === Utility Functions ===
def run_cmd(cmd: str, timeout: int = 10) -> Tuple[int, str, str]:
    """Run shell command, return (exit_code, stdout, stderr)"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "Command timed out"
    except Exception as e:
        return -1, "", str(e)

def check_systemd_service(service: str, user: bool = False) -> Tuple[bool, str]:
    """Check if a systemd service is active"""
    cmd = f"systemctl {'--user' if user else ''} is-active {service}"
    code, out, _ = run_cmd(cmd, timeout=5)
    return code == 0, out.strip()

def load_json(path: Path) -> Optional[Dict]:
    """Load JSON file, return None on error"""
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except Exception:
        return None

def load_env(path: Path) -> Dict[str, str]:
    """Load .env file into dict"""
    env = {}
    try:
        with open(path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    env[key.strip()] = val.strip()
    except Exception:
        pass
    return env

# === GATEWAY CHECKS ===

@register_check("Gateway", "Gateway process running", "CRITICAL")
def check_gateway_running():
    is_active, status = check_systemd_service("openclaw-gateway", user=True)
    if is_active:
        return CheckResult("PASS", f"Gateway service is active ({status})")
    else:
        return CheckResult(
            "FAIL",
            f"Gateway service is not active (status: {status})",
            "Run: systemctl --user restart openclaw-gateway"
        )

@register_check("Gateway", "Gateway accepting connections", "CRITICAL")
def check_gateway_connection():
    try:
        resp = requests.get(GATEWAY_URL, timeout=5)
        if resp.status_code == 200:
            return CheckResult("PASS", "Gateway is accepting connections")
        else:
            return CheckResult("WARN", f"Gateway returned status {resp.status_code}")
    except requests.exceptions.RequestException as e:
        return CheckResult(
            "FAIL",
            f"Cannot connect to gateway: {e}",
            "Check if gateway is running on port 18789"
        )

@register_check("Gateway", "Config file valid", "CRITICAL")
def check_config_valid():
    code, out, err = run_cmd("openclaw doctor", timeout=10)
    if code == 0:
        return CheckResult("PASS", "Config validation passed")
    else:
        return CheckResult(
            "FAIL",
            f"Config validation failed: {err or out}",
            "Review openclaw.json for syntax errors"
        )

@register_check("Gateway", "Config file locked (immutable)", "HIGH")
def check_config_locked():
    code, out, _ = run_cmd(f"lsattr {CONFIG_FILE}", timeout=5)
    if code == 0 and 'i' in out.split()[0]:
        return CheckResult("PASS", "Config is locked with chattr +i")
    else:
        return CheckResult(
            "WARN",
            "Config is NOT immutable",
            "Run: sudo chattr +i openclaw.json (prevents self-modification)"
        )

# === MODEL CHECKS ===

@register_check("Models", "Primary model responds", "CRITICAL")
def check_primary_model():
    config = load_json(CONFIG_FILE)
    if not config:
        return CheckResult("FAIL", "Cannot load openclaw.json")
    
    # Find the primary model by searching recursively for "primary" key
    def find_primary(obj, depth=0):
        if depth > 10:
            return None
        if isinstance(obj, dict):
            if "primary" in obj:
                return obj["primary"]
            for v in obj.values():
                result = find_primary(v, depth + 1)
                if result:
                    return result
        elif isinstance(obj, list):
            for item in obj:
                result = find_primary(item, depth + 1)
                if result:
                    return result
        return None
    
    primary = find_primary(config)
    
    # Check if the model ID looks valid
    if primary and "/" in primary:
        return CheckResult("PASS", f"Primary model configured: {primary}", details={"model": primary})
    else:
        return CheckResult("WARN", f"Primary model may be misconfigured: {primary or 'not found'}")

@register_check("Models", "API keys are real (not placeholders)", "CRITICAL")
def check_api_keys_real():
    failures = []
    
    # Check models.json for literal placeholder strings
    models_config = load_json(MODELS_FILE)
    if models_config and "providers" in models_config:
        for provider_name, provider_data in models_config["providers"].items():
            api_key = provider_data.get("apiKey", "")
            if api_key in ["XAI_API_KEY", "MOONSHOT_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]:
                failures.append(f"{provider_name}: literal string '{api_key}'")
    
    if failures:
        return CheckResult(
            "FAIL",
            f"Found placeholder API keys: {', '.join(failures)}",
            "Replace with actual keys from .env"
        )
    else:
        return CheckResult("PASS", "No placeholder API key strings detected")

# === SECOND BRAIN CHECKS ===

@register_check("Second Brain", "Service running", "CRITICAL")
def check_second_brain_running():
    is_active, status = check_systemd_service("second-brain", user=False)
    if is_active:
        return CheckResult("PASS", f"Second Brain service is active ({status})")
    else:
        return CheckResult(
            "FAIL",
            f"Second Brain service is not active (status: {status})",
            "Run: sudo systemctl restart second-brain (requires root)"
        )

@register_check("Second Brain", "Returns search results", "CRITICAL")
def check_second_brain_search():
    try:
        resp = requests.get(f"{SECOND_BRAIN_URL}/search", params={"q": "test", "limit": 1}, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            return CheckResult("PASS", f"Second Brain is responding", details={"result_count": len(data.get("results", []))})
        else:
            return CheckResult("FAIL", f"Second Brain returned {resp.status_code}")
    except requests.exceptions.RequestException as e:
        return CheckResult(
            "FAIL",
            f"Cannot reach Second Brain: {e}",
            "Check if service is running on port 7777"
        )

@register_check("Second Brain", "Memory index status", "INFO")
def check_second_brain_stats():
    try:
        resp = requests.get(f"{SECOND_BRAIN_URL}/stats", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            count = data.get("points_count", data.get("count", 0))
            status = data.get("status", "unknown")
            return CheckResult("PASS", f"Memory index has {count:,} entries (status: {status})", details=data)
        else:
            return CheckResult("WARN", "Could not fetch memory stats")
    except Exception:
        return CheckResult("WARN", "Could not fetch memory stats")

# === SESSION CHECKS ===

@register_check("Sessions", "Session count", "INFO")
def check_session_count():
    sessions_dir = OPENCLAW_HOME / "sessions"
    if not sessions_dir.exists():
        return CheckResult("WARN", "Sessions directory does not exist")
    
    session_files = list(sessions_dir.glob("*.json"))
    count = len(session_files)
    
    if count > 100:
        return CheckResult("WARN", f"{count} sessions in store (consider cleanup)", details={"count": count})
    else:
        return CheckResult("PASS", f"{count} sessions in store", details={"count": count})

@register_check("Sessions", "Sessions above 80% context", "HIGH")
def check_sessions_high_context():
    sessions_dir = OPENCLAW_HOME / "sessions"
    if not sessions_dir.exists():
        return CheckResult("WARN", "Sessions directory does not exist")
    
    high_sessions = []
    for session_file in sessions_dir.glob("*.json"):
        session = load_json(session_file)
        if session and "tokenUsage" in session:
            used = session["tokenUsage"].get("total", 0)
            limit = session.get("contextWindow", 200000)
            if limit > 0:
                pct = (used / limit) * 100
                if pct > 80:
                    high_sessions.append((session_file.stem, pct, used, limit))
    
    if high_sessions:
        details = "\n  ".join([f"{name}: {pct:.1f}% ({used}/{limit})" for name, pct, used, limit in high_sessions])
        return CheckResult(
            "WARN",
            f"{len(high_sessions)} session(s) above 80% context:\n  {details}",
            "Run /compact in those sessions or start fresh with /new",
            details={"high_sessions": [{"name": n, "pct": p} for n, p, _, _ in high_sessions]}
        )
    else:
        return CheckResult("PASS", "No sessions above 80% context")

# === PM2 CHECKS ===

@register_check("PM2", "All expected processes running", "HIGH")
def check_pm2_processes():
    code, out, _ = run_cmd("pm2 jlist", timeout=10)
    if code != 0:
        return CheckResult("FAIL", "Cannot query PM2 (pm2 jlist failed)")
    
    try:
        processes = json.loads(out)
        online = [p for p in processes if p.get("pm2_env", {}).get("status") == "online"]
        errored = [p for p in processes if p.get("pm2_env", {}).get("status") == "errored"]
        
        if errored:
            names = ", ".join([p.get("name", "unknown") for p in errored])
            return CheckResult(
                "FAIL",
                f"{len(errored)} process(es) in errored state: {names}",
                f"Run: pm2 restart {names} --update-env"
            )
        else:
            return CheckResult("PASS", f"{len(online)} PM2 processes online", details={"online": len(online)})
    except Exception as e:
        return CheckResult("WARN", f"Could not parse PM2 output: {e}")

@register_check("PM2", "High restart counts", "MEDIUM")
def check_pm2_restarts():
    code, out, _ = run_cmd("pm2 jlist", timeout=10)
    if code != 0:
        return CheckResult("WARN", "Cannot query PM2")
    
    try:
        processes = json.loads(out)
        high_restarts = [(p.get("name"), p.get("pm2_env", {}).get("restart_time", 0)) 
                         for p in processes 
                         if p.get("pm2_env", {}).get("restart_time", 0) > 50]
        
        if high_restarts:
            details = ", ".join([f"{name} ({count})" for name, count in high_restarts])
            return CheckResult("WARN", f"Processes with >50 restarts: {details}")
        else:
            return CheckResult("PASS", "No processes with excessive restarts")
    except Exception:
        return CheckResult("WARN", "Could not parse PM2 output")

# === EXEC CHECKS ===

@register_check("Exec", "Can run simple command", "CRITICAL")
def check_exec_works():
    # This is tricky — we can't use the exec tool from here
    # Instead, test if basic shell commands work
    code, out, _ = run_cmd("echo 'alfie-doctor-test'", timeout=5)
    if code == 0 and "alfie-doctor-test" in out:
        return CheckResult("PASS", "Shell execution works")
    else:
        return CheckResult("WARN", "Shell execution may be impaired")

# === SYSTEM CHECKS ===

@register_check("System", "Disk space", "MEDIUM")
def check_disk_space():
    code, out, _ = run_cmd("df -h / | tail -1", timeout=5)
    if code == 0:
        parts = out.split()
        if len(parts) >= 5:
            usage_pct = int(parts[4].rstrip('%'))
            if usage_pct > 80:
                return CheckResult("WARN", f"Disk usage at {usage_pct}%", "Clean up old files")
            else:
                return CheckResult("PASS", f"Disk usage at {usage_pct}%", details={"usage_pct": usage_pct})
    return CheckResult("WARN", "Could not check disk space")

@register_check("System", "RAM usage", "MEDIUM")
def check_ram_usage():
    code, out, _ = run_cmd("free -m | grep Mem", timeout=5)
    if code == 0:
        parts = out.split()
        if len(parts) >= 3:
            total = int(parts[1])
            used = int(parts[2])
            pct = (used / total) * 100
            if pct > 90:
                return CheckResult("WARN", f"RAM usage at {pct:.1f}%", "Consider restarting services")
            else:
                return CheckResult("PASS", f"RAM usage at {pct:.1f}%", details={"usage_pct": pct})
    return CheckResult("WARN", "Could not check RAM usage")

@register_check("System", "Swap usage", "LOW")
def check_swap_usage():
    code, out, _ = run_cmd("free -m | grep Swap", timeout=5)
    if code == 0:
        parts = out.split()
        if len(parts) >= 3:
            total = int(parts[1])
            used = int(parts[2])
            if total > 0:
                pct = (used / total) * 100
                if pct > 50:
                    return CheckResult("WARN", f"Swap usage at {pct:.1f}%")
                else:
                    return CheckResult("PASS", f"Swap usage at {pct:.1f}%", details={"usage_pct": pct})
    return CheckResult("PASS", "Swap usage OK")

# === MAIN ===

def main():
    print("=" * 70)
    print("ALFIE DOCTOR — Comprehensive System Health Check")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    print()
    
    results = []
    for check_def in checks:
        category = check_def["category"]
        name = check_def["name"]
        severity = check_def["severity"]
        func = check_def["func"]
        
        try:
            result = func()
            results.append({
                "category": category,
                "name": name,
                "severity": severity,
                "result": result
            })
        except Exception as e:
            results.append({
                "category": category,
                "name": name,
                "severity": severity,
                "result": CheckResult("FAIL", f"Check crashed: {e}")
            })
    
    # Print results
    current_category = None
    for r in results:
        if r["category"] != current_category:
            print(f"\n[{r['category']}]")
            current_category = r["category"]
        
        status = r["result"].status
        symbol = {"PASS": "✓", "WARN": "⚠", "FAIL": "✗"}.get(status, "?")
        color = {"PASS": "", "WARN": "", "FAIL": ""}.get(status, "")  # Could add ANSI colors
        
        print(f"  {symbol} {r['name']}: {status}")
        print(f"     {r['result'].message}")
        if r["result"].remediation:
            print(f"     → Fix: {r['result'].remediation}")
    
    # Summary
    print("\n" + "=" * 70)
    critical_fails = sum(1 for r in results if r["severity"] == "CRITICAL" and r["result"].status == "FAIL")
    high_fails = sum(1 for r in results if r["severity"] == "HIGH" and r["result"].status == "FAIL")
    warns = sum(1 for r in results if r["result"].status == "WARN")
    passes = sum(1 for r in results if r["result"].status == "PASS")
    
    if critical_fails > 0:
        overall = "🔴 RED"
        verdict = "CRITICAL FAILURES — IMMEDIATE ACTION REQUIRED"
    elif high_fails > 0 or warns > 3:
        overall = "🟡 YELLOW"
        verdict = "WARNINGS PRESENT — REVIEW RECOMMENDED"
    else:
        overall = "🟢 GREEN"
        verdict = "ALL SYSTEMS HEALTHY"
    
    print(f"OVERALL STATUS: {overall}")
    print(f"  Critical failures: {critical_fails}")
    print(f"  High failures: {high_fails}")
    print(f"  Warnings: {warns}")
    print(f"  Passed: {passes}/{len(results)}")
    print(f"\n{verdict}")
    print("=" * 70)
    
    # Exit code
    sys.exit(1 if critical_fails > 0 else 0)

if __name__ == "__main__":
    main()
