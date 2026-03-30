#!/usr/bin/env python3
"""Deterministic infrastructure health check. Outputs JSON array of check results."""
import os
import subprocess
import json
import urllib.request

LLM_PROXY_PORT = int(os.environ.get("LLM_PROXY_PORT", "8889"))
checks = []

# 1. LLM Proxy
try:
    r = urllib.request.urlopen(f'http://localhost:{LLM_PROXY_PORT}/health', timeout=5)
    checks.append({'service': 'llm-proxy', 'status': 'ok', 'port': LLM_PROXY_PORT})
except Exception as e:
    checks.append({'service': 'llm-proxy', 'status': 'down', 'error': str(e), 'port': LLM_PROXY_PORT})

# 2. Ollama
try:
    r = urllib.request.urlopen('http://localhost:11434/api/tags', timeout=5)
    data = json.loads(r.read())
    model_count = len(data.get('models', []))
    checks.append({'service': 'ollama', 'status': 'ok', 'models': model_count, 'port': 11434})
except Exception as e:
    checks.append({'service': 'ollama', 'status': 'down', 'error': str(e), 'port': 11434})

# 3. Hybrid Brain
try:
    r = urllib.request.urlopen('http://localhost:7777/search?q=healthcheck&limit=1', timeout=10)
    data = json.loads(r.read())
    hits = data.get('stats', {}).get('qdrant_hits', 0) + data.get('stats', {}).get('graph_hits', 0)
    checks.append({'service': 'hybrid-brain', 'status': 'ok', 'port': 7777, 'hits': hits})
except Exception as e:
    checks.append({'service': 'hybrid-brain', 'status': 'down', 'error': str(e), 'port': 7777})

# 4. GPU check
try:
    out = subprocess.check_output(
        ['nvidia-smi', '--query-gpu=name,memory.used,memory.total,temperature.gpu',
         '--format=csv,noheader,nounits'], text=True, timeout=10)
    for i, line in enumerate(out.strip().split('\n')):
        parts = [p.strip() for p in line.split(',')]
        temp = int(parts[3])
        checks.append({
            'service': f'gpu{i}', 'status': 'warning' if temp > 85 else 'ok',
            'name': parts[0], 'vram_used_mb': int(parts[1]),
            'vram_total_mb': int(parts[2]), 'temp_c': temp
        })
except Exception as e:
    checks.append({'service': 'gpu', 'status': 'error', 'error': str(e)})

# 5. Disk
try:
    out = subprocess.check_output(['df', '-h', '/'], text=True, timeout=5)
    line = out.strip().split('\n')[1].split()
    pct = int(line[4].rstrip('%'))
    checks.append({
        'service': 'disk', 'status': 'warning' if pct > 85 else 'ok',
        'used_pct': pct, 'avail': line[3]
    })
except Exception as e:
    checks.append({'service': 'disk', 'status': 'error', 'error': str(e)})

# 6. PM2 errored processes
try:
    out = subprocess.check_output(['pm2', 'jlist'], text=True, timeout=10)
    procs = json.loads(out)
    errored = [p['name'] for p in procs if p.get('pm2_env', {}).get('status') == 'errored']
    stopped = [p['name'] for p in procs if p.get('pm2_env', {}).get('status') == 'stopped']
    checks.append({
        'service': 'pm2', 'status': 'warning' if errored else 'ok',
        'errored': errored, 'stopped': stopped, 'total': len(procs)
    })
except Exception as e:
    checks.append({'service': 'pm2', 'status': 'error', 'error': str(e)})

# Summary
failures = [c for c in checks if c['status'] != 'ok']
summary = {
    'total_checks': len(checks),
    'failures': len(failures),
    'all_healthy': len(failures) == 0,
    'alerts': [f"⚠️ {c['service']}: {c.get('error', c['status'])}" for c in failures]
}

print(json.dumps({'checks': checks, 'summary': summary}))
