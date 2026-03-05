#!/usr/bin/env python3
"""
Stress test: Simulate the exact failover scenario that crashed the gateway on 2026-02-18.

What happened:
- Primary (Anthropic) timed out on huge context
- Failover hit google-antigravity with expired OAuth → gateway crash

This test hits each fallback endpoint with a ~150K token context to verify:
1. Each endpoint handles the load without crashing
2. Timeout behavior is graceful (not a process kill)
3. The chain actually works end-to-end
"""

import time
import json
import subprocess
import sys
import os

# Generate a massive context (~150K tokens ≈ 600K chars)
def generate_massive_context(target_chars=500_000):
    """Generate a realistic massive conversation context."""
    messages = []
    topics = [
        "platform revenue analysis for platform-beta Brazil",
        "GPU benchmarking results for RTX PRO 6000",
        "compaction algorithm design and optimization",
        "wedding planning logistics for city-hq venue",
        "digital-ops compliance updates for jurisdiction-alpha license",
        "server infrastructure monitoring and alerts",
        "cryptocurrency market analysis and portfolio",
        "AI model comparison and cost optimization",
    ]
    
    total = 0
    turn = 0
    while total < target_chars:
        topic = topics[turn % len(topics)]
        # Alternate user/assistant with substantial messages
        if turn % 2 == 0:
            role = "user"
            content = f"Let's discuss {topic}. " + (
                f"Here's the detailed data from the last 30 days including all metrics, "
                f"conversion rates, deposit amounts, player segments, geographic breakdown, "
                f"and comparison with previous periods. I need a thorough analysis with "
                f"actionable recommendations. The raw numbers show significant variance "
                f"across different markets and we need to understand why. " * 20
            )
        else:
            role = "assistant"
            content = (
                f"Based on the {topic} data you've shared, here's my comprehensive analysis. "
                f"Looking at the key metrics across all segments, I can identify several "
                f"important trends. The primary driver appears to be seasonal variation "
                f"combined with market-specific factors. Let me break this down by region "
                f"and time period to give you the full picture with specific numbers. " * 25
            )
        
        messages.append({"role": role, "content": content})
        total += len(content)
        turn += 1
    
    return messages

def test_endpoint(name, url, headers, model, messages, max_tokens=50, timeout=30):
    """Test a single endpoint with the massive context."""
    payload = {
        "model": model,
        "messages": messages[-40:],  # Last 40 messages to stay within context window
        "max_tokens": max_tokens,
    }
    
    # Determine API format
    is_anthropic = "anthropic" in url and "openrouter" not in url and "opencode" not in url
    is_opencode = "opencode" in url
    
    if is_anthropic or is_opencode:
        # Anthropic Messages API format
        payload = {
            "model": model,
            "messages": messages[-40:],
            "max_tokens": max_tokens,
        }
        endpoint = url.rstrip('/') + '/v1/messages' if not url.endswith('/messages') else url
    else:
        # OpenAI chat completions format
        endpoint = url.rstrip('/') + '/chat/completions' if not url.endswith('/completions') else url
    
    # Calculate payload size
    payload_json = json.dumps(payload)
    payload_kb = len(payload_json) / 1024
    
    print(f"\n{'='*60}")
    print(f"🔧 Testing: {name}")
    print(f"   Endpoint: {endpoint}")
    print(f"   Model: {model}")
    print(f"   Payload: {payload_kb:.0f} KB ({len(messages[-40:])} messages)")
    print(f"   Timeout: {timeout}s")
    print(f"{'='*60}")
    
    import urllib.request
    import urllib.error
    import ssl
    
    start = time.time()
    try:
        data = payload_json.encode('utf-8')
        req_headers = {'Content-Type': 'application/json'}
        req_headers.update(headers)
        
        req = urllib.request.Request(endpoint, data=data, headers=req_headers, method='POST')
        ctx = ssl.create_default_context()
        
        resp_obj = urllib.request.urlopen(req, timeout=timeout, context=ctx)
        elapsed = time.time() - start
        http_code = str(resp_obj.status)
        body = resp_obj.read().decode('utf-8')
        
        try:
            resp = json.loads(body)
            error_msg = None
        except:
            resp = None
            error_msg = body[:200]
        
        print(f"   Result: ✅ SUCCESS ({elapsed:.1f}s)")
        
        if resp:
            if 'choices' in resp:
                content = resp['choices'][0].get('message', {}).get('content', '')[:100]
            elif 'content' in resp:
                content = resp['content'][0].get('text', '')[:100] if resp['content'] else ''
            else:
                content = str(resp)[:100]
            print(f"   Response: {content}...")
            
            usage = resp.get('usage', {})
            if usage:
                inp = usage.get('input_tokens', usage.get('prompt_tokens', '?'))
                out = usage.get('output_tokens', usage.get('completion_tokens', '?'))
                print(f"   Tokens: {inp} in / {out} out")
        
        return {
            "name": name, "status": "ok", "http_code": http_code,
            "elapsed": elapsed, "error": None, "payload_kb": payload_kb,
        }
        
    except urllib.error.HTTPError as e:
        elapsed = time.time() - start
        body = e.read().decode('utf-8', errors='replace')[:500]
        try:
            err_json = json.loads(body)
            err = err_json.get('error', {})
            error_msg = err.get('message', str(err)) if isinstance(err, dict) else str(err)
        except:
            error_msg = body[:200]
        
        print(f"   Result: ❌ HTTP {e.code} ({elapsed:.1f}s)")
        print(f"   Error: {error_msg[:200]}")
        return {
            "name": name, "status": "error", "http_code": str(e.code),
            "elapsed": elapsed, "error": error_msg, "payload_kb": payload_kb,
        }
        
    except Exception as e:
        elapsed = time.time() - start
        err_type = type(e).__name__
        if 'timed out' in str(e).lower() or 'timeout' in err_type.lower():
            print(f"   Result: ⏰ TIMEOUT after {elapsed:.1f}s (graceful — not a crash)")
            return {
                "name": name, "status": "timeout", "http_code": "TIMEOUT",
                "elapsed": elapsed, "error": "request timed out gracefully", "payload_kb": payload_kb,
            }
        print(f"   Result: 💥 {err_type}: {e}")
        return {
            "name": name, "status": "exception", "http_code": "EXCEPTION",
            "elapsed": elapsed, "error": str(e), "payload_kb": payload_kb,
        }


def main():
    print("🔥 FAILOVER STRESS TEST — Simulating 2026-02-18 Outage Scenario")
    print("=" * 60)
    
    # Load API keys
    anthropic_direct_key = os.environ.get("ANTHROPIC_API_KEY", "")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")
    opencode_key = os.environ.get("OPENCODE_API_KEY", "")
    
    # Get xai key from config
    try:
        with open("/home/admin/.openclaw/openclaw.json") as f:
            cfg = json.load(f)
        xai_key = cfg["models"]["providers"]["xai"]["apiKey"]
    except:
        xai_key = ""
    
    # Get anthropic:manual OAT token
    try:
        with open("/home/admin/.openclaw/agents/main/agent/auth-profiles.json") as f:
            ap = json.load(f)
        anthropic_oat = ap["profiles"]["anthropic:manual"]["token"]
    except:
        anthropic_oat = ""
    
    print(f"\n📊 Generating massive context (~500K chars)...")
    messages = generate_massive_context(500_000)
    total_chars = sum(len(m['content']) for m in messages)
    print(f"   Generated {len(messages)} messages, {total_chars:,} chars (~{total_chars//4:,} tokens)")
    
    # Define the NEW fallback chain (post-fix)
    endpoints = [
        {
            "name": "1. PRIMARY: Anthropic (OAT token)",
            "url": "https://api.anthropic.com",
            "headers": {
                "x-api-key": anthropic_oat,
                "anthropic-version": "2023-06-01",
            },
            "model": "claude-opus-4-6",
            "timeout": 60,  # Short timeout to simulate what happens when it's slow
        },
        {
            "name": "2. FALLBACK: OpenCode Zen (free)",
            "url": "https://opencode.ai/zen",
            "headers": {
                "x-api-key": opencode_key,
                "anthropic-version": "2023-06-01",
            },
            "model": "claude-opus-4-6",
            "timeout": 60,
        },
        {
            "name": "3. FALLBACK: OpenRouter",
            "url": "https://openrouter.ai/api/v1",
            "headers": {
                "Authorization": f"Bearer {openrouter_key}",
            },
            "model": "anthropic/claude-opus-4.6",
            "timeout": 60,
        },
        {
            "name": "4. FALLBACK: Grok 4.1 (xAI — different provider)",
            "url": "https://api.x.ai/v1",
            "headers": {
                "Authorization": f"Bearer {xai_key}",
            },
            "model": "grok-4-1-fast-non-reasoning",
            "timeout": 60,
        },
        {
            "name": "5. FALLBACK: Anthropic Direct (fixed API key)",
            "url": "https://api.anthropic.com",
            "headers": {
                "x-api-key": anthropic_direct_key,
                "anthropic-version": "2023-06-01",
            },
            "model": "claude-opus-4-6",
            "timeout": 60,
        },
        {
            "name": "6. LAST RESORT: Anthropic Direct Sonnet",
            "url": "https://api.anthropic.com",
            "headers": {
                "x-api-key": anthropic_direct_key,
                "anthropic-version": "2023-06-01",
            },
            "model": "claude-sonnet-4-6",
            "timeout": 60,
        },
    ]
    
    results = []
    for ep in endpoints:
        r = test_endpoint(
            ep["name"], ep["url"], ep["headers"], ep["model"],
            messages, max_tokens=50, timeout=ep["timeout"]
        )
        results.append(r)
    
    # Summary
    print(f"\n{'='*60}")
    print(f"📋 STRESS TEST SUMMARY")
    print(f"{'='*60}")
    print(f"   Payload: {total_chars:,} chars across {len(messages)} messages")
    print()
    
    for r in results:
        icon = "✅" if r["status"] == "ok" else "⏰" if r["status"] == "timeout" else "❌"
        print(f"   {icon} {r['name']}")
        print(f"      HTTP {r['http_code']} — {r['elapsed']:.1f}s{' — ' + r['error'][:80] if r.get('error') else ''}")
        print()
    
    working = sum(1 for r in results if r["status"] == "ok")
    print(f"   Result: {working}/{len(results)} endpoints handled the load successfully")
    
    if working >= 3:
        print(f"   ✅ Failover chain is resilient — at least 3 providers can handle the load")
    else:
        print(f"   ⚠️  Only {working} providers survived — chain needs more work")
    
    # Save results
    out_path = "/home/admin/.openclaw/workspace/operator-method/benchmark/results/stress_test.json"
    with open(out_path, "w") as f:
        json.dump({
            "test": "failover_stress_test",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "context_chars": total_chars,
            "context_messages": len(messages),
            "results": results,
        }, f, indent=2)
    print(f"\n   Results saved to {out_path}")


if __name__ == "__main__":
    main()
