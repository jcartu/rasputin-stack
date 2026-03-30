#!/usr/bin/env python3
"""
Agent Autopsy - Post-session AI analysis
Breakthrough feature: After every session, generate an executive summary:
- Performance metrics (duration, cost, tokens)
- Tool usage analysis
- Bottleneck identification
- Optimization suggestions
- Quality assessment

Usage:
    python3 agent_autopsy.py <session_key>
    python3 agent_autopsy.py --latest
    python3 agent_autopsy.py --auto (run for all recent sessions)
"""
import json
import sys
import os
from datetime import datetime, timedelta
from typing import Dict, Optional
import anthropic

# Paths
OPENCLAW_DIR = os.path.expanduser("~/.openclaw")
SESSION_LOGS_DIR = os.path.join(OPENCLAW_DIR, "agents", "main", "sessions")
AUTOPSY_OUTPUT_DIR = os.path.join(OPENCLAW_DIR, "workspace", "memory", "autopsies")

# Ensure output directory exists
os.makedirs(AUTOPSY_OUTPUT_DIR, exist_ok=True)

def load_session_log(session_key: str) -> Optional[Dict]:
    """Load session JSONL log"""
    log_path = os.path.join(SESSION_LOGS_DIR, f"{session_key}.jsonl")
    
    if not os.path.exists(log_path):
        print(f"❌ Session log not found: {log_path}")
        return None
    
    events = []
    with open(log_path, 'r') as f:
        for line in f:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    
    return {
        'session_key': session_key,
        'log_path': log_path,
        'events': events,
        'event_count': len(events)
    }

def extract_session_metrics(session_data: Dict) -> Dict:
    """Extract quantitative metrics from session"""
    events = session_data['events']
    
    metrics = {
        'total_events': len(events),
        'user_messages': 0,
        'assistant_messages': 0,
        'tool_calls': 0,
        'tool_results': 0,
        'errors': 0,
        'thinking_events': 0,
        'start_time': None,
        'end_time': None,
        'duration_seconds': 0,
        'total_tokens': 0,
        'input_tokens': 0,
        'output_tokens': 0,
        'total_cost': 0.0,
        'models_used': set(),
        'tools_used': {},
        'latencies': []
    }
    
    for event in events:
        event_type = event.get('type')
        
        # User messages
        if event_type == 'user_message':
            metrics['user_messages'] += 1
            if metrics['start_time'] is None:
                metrics['start_time'] = event.get('timestamp')
        
        # Assistant messages
        elif event_type == 'assistant_message':
            metrics['assistant_messages'] += 1
            metrics['end_time'] = event.get('timestamp')
        
        # Tool calls
        elif event_type == 'tool_call':
            metrics['tool_calls'] += 1
            tool_name = event.get('tool', {}).get('name', 'unknown')
            metrics['tools_used'][tool_name] = metrics['tools_used'].get(tool_name, 0) + 1
        
        # Tool results
        elif event_type == 'tool_result':
            metrics['tool_results'] += 1
            # Track latency if available
            duration = event.get('duration_ms')
            if duration:
                metrics['latencies'].append({
                    'tool': event.get('tool', {}).get('name', 'unknown'),
                    'ms': duration
                })
        
        # Errors
        elif event_type == 'error':
            metrics['errors'] += 1
        
        # Thinking
        elif event_type == 'thinking':
            metrics['thinking_events'] += 1
        
        # Usage tracking
        usage = event.get('usage', {})
        if usage:
            metrics['input_tokens'] += usage.get('input_tokens', 0)
            metrics['output_tokens'] += usage.get('output_tokens', 0)
            metrics['total_tokens'] += usage.get('total_tokens', 0)
        
        # Cost tracking
        cost = event.get('cost')
        if cost:
            metrics['total_cost'] += cost
        
        # Model tracking
        model = event.get('model')
        if model:
            metrics['models_used'].add(model)
    
    # Calculate duration
    if metrics['start_time'] and metrics['end_time']:
        try:
            start = datetime.fromisoformat(metrics['start_time'].replace('Z', '+00:00'))
            end = datetime.fromisoformat(metrics['end_time'].replace('Z', '+00:00'))
            metrics['duration_seconds'] = (end - start).total_seconds()
        except:
            pass
    
    # Convert sets to lists for JSON serialization
    metrics['models_used'] = list(metrics['models_used'])
    
    return metrics

def generate_autopsy_report(session_data: Dict, metrics: Dict) -> str:
    """Use Claude to generate executive summary"""
    api_key = os.getenv('ANTHROPIC_API_KEY')
    if not api_key:
        return "⚠️ ANTHROPIC_API_KEY not set - cannot generate AI analysis"
    
    # Prepare context for Claude
    context = f"""Analyze this completed AI agent session:

## Session Metrics
- Duration: {metrics['duration_seconds']:.1f}s
- Messages: {metrics['user_messages']} user, {metrics['assistant_messages']} assistant
- Tool calls: {metrics['tool_calls']} executed, {metrics['tool_results']} completed
- Tokens: {metrics['total_tokens']:,} total ({metrics['input_tokens']:,} in, {metrics['output_tokens']:,} out)
- Cost: ${metrics['total_cost']:.4f}
- Models: {', '.join(metrics['models_used']) if metrics['models_used'] else 'none'}
- Errors: {metrics['errors']}
- Thinking events: {metrics['thinking_events']}

## Tool Usage
"""
    
    if metrics['tools_used']:
        for tool, count in sorted(metrics['tools_used'].items(), key=lambda x: x[1], reverse=True):
            context += f"- {tool}: {count}x\n"
    else:
        context += "- No tools used\n"
    
    context += "\n## Latency Data\n"
    if metrics['latencies']:
        avg_latency = sum(l['ms'] for l in metrics['latencies']) / len(metrics['latencies'])
        slowest = max(metrics['latencies'], key=lambda x: x['ms'])
        context += f"- Average tool latency: {avg_latency:.0f}ms\n"
        context += f"- Slowest tool: {slowest['tool']} ({slowest['ms']:.0f}ms)\n"
    else:
        context += "- No latency data available\n"
    
    # Sample a few events for qualitative analysis
    context += "\n## Sample Events (first 5 user/assistant exchanges)\n"
    exchange_count = 0
    for event in session_data['events']:
        if event.get('type') in ['user_message', 'assistant_message']:
            content = event.get('content', '')[:200]
            context += f"- [{event['type']}] {content}...\n"
            if event.get('type') == 'assistant_message':
                exchange_count += 1
            if exchange_count >= 5:
                break
    
    # Ask Claude to analyze
    prompt = f"""{context}

Generate a concise executive summary (3-5 paragraphs) covering:
1. **Performance Overview**: Duration, cost, efficiency
2. **Tool Usage Analysis**: Which tools were most used, any issues?
3. **Bottleneck Identification**: What slowed things down?
4. **Optimization Suggestions**: 2-3 concrete recommendations
5. **Quality Assessment**: Was the session successful? Any red flags?

Be specific, actionable, and technical. This is for the developer."""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        
        return response.content[0].text
    except Exception as e:
        return f"⚠️ Error generating AI analysis: {e}"

def format_autopsy_report(session_key: str, metrics: Dict, ai_analysis: str) -> str:
    """Format complete autopsy report"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    report = f"""# Agent Autopsy Report
**Session:** `{session_key}`  
**Generated:** {timestamp}

---

## 📊 Quick Stats

| Metric | Value |
|--------|-------|
| Duration | {metrics['duration_seconds']:.1f}s |
| Cost | ${metrics['total_cost']:.4f} |
| Messages | {metrics['user_messages']} user, {metrics['assistant_messages']} assistant |
| Tool Calls | {metrics['tool_calls']} executed |
| Tokens | {metrics['total_tokens']:,} total |
| Errors | {metrics['errors']} |
| Models | {', '.join(metrics['models_used']) if metrics['models_used'] else 'N/A'} |

---

## 🔧 Tool Usage Breakdown

"""
    
    if metrics['tools_used']:
        for tool, count in sorted(metrics['tools_used'].items(), key=lambda x: x[1], reverse=True)[:10]:
            report += f"- **{tool}**: {count}x\n"
    else:
        report += "*No tools used*\n"
    
    report += "\n---\n\n## 🤖 AI Analysis\n\n"
    report += ai_analysis
    
    report += "\n\n---\n\n## 📈 Latency Analysis\n\n"
    
    if metrics['latencies']:
        avg_latency = sum(l['ms'] for l in metrics['latencies']) / len(metrics['latencies'])
        slowest = max(metrics['latencies'], key=lambda x: x['ms'])
        fastest = min(metrics['latencies'], key=lambda x: x['ms'])
        
        report += f"- **Average:** {avg_latency:.0f}ms\n"
        report += f"- **Slowest:** {slowest['tool']} ({slowest['ms']:.0f}ms)\n"
        report += f"- **Fastest:** {fastest['tool']} ({fastest['ms']:.0f}ms)\n"
        
        # Histogram-style visualization
        if len(metrics['latencies']) >= 5:
            sorted_latencies = sorted(metrics['latencies'], key=lambda x: x['ms'], reverse=True)
            report += "\n**Top 5 Slowest Calls:**\n"
            for i, lat in enumerate(sorted_latencies[:5], 1):
                bar = '█' * (lat['ms'] // 100)
                report += f"{i}. {lat['tool']}: {bar} {lat['ms']:.0f}ms\n"
    else:
        report += "*No latency data collected*\n"
    
    report += "\n---\n\n*Generated by Agent Autopsy v1.0*\n"
    
    return report

def save_autopsy(session_key: str, report: str) -> str:
    """Save autopsy report to file"""
    filename = f"{session_key}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    filepath = os.path.join(AUTOPSY_OUTPUT_DIR, filename)
    
    with open(filepath, 'w') as f:
        f.write(report)
    
    return filepath

def get_latest_session_key() -> Optional[str]:
    """Find most recent session log"""
    if not os.path.exists(SESSION_LOGS_DIR):
        return None
    
    logs = [f for f in os.listdir(SESSION_LOGS_DIR) if f.endswith('.jsonl')]
    if not logs:
        return None
    
    # Sort by modification time
    logs.sort(key=lambda f: os.path.getmtime(os.path.join(SESSION_LOGS_DIR, f)), reverse=True)
    
    return logs[0].replace('.jsonl', '')

def run_autopsy(session_key: str, verbose: bool = False) -> Optional[str]:
    """Execute full autopsy workflow"""
    if verbose:
        print(f"🔬 Running autopsy for session: {session_key}")
    
    # Load session
    session_data = load_session_log(session_key)
    if not session_data:
        return None
    
    if verbose:
        print(f"📊 Loaded {session_data['event_count']} events")
    
    # Extract metrics
    metrics = extract_session_metrics(session_data)
    if verbose:
        print(f"📈 Extracted metrics: {metrics['total_tokens']:,} tokens, ${metrics['total_cost']:.4f} cost")
    
    # Generate AI analysis
    if verbose:
        print("🤖 Generating AI analysis...")
    ai_analysis = generate_autopsy_report(session_data, metrics)
    
    # Format report
    report = format_autopsy_report(session_key, metrics, ai_analysis)
    
    # Save report
    filepath = save_autopsy(session_key, report)
    if verbose:
        print(f"✅ Autopsy saved: {filepath}")
    
    return filepath

def main():
    """CLI entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Agent Autopsy - Post-session AI analysis'
    )
    parser.add_argument('session_key', nargs='?', help='Session key to analyze')
    parser.add_argument('--latest', action='store_true', help='Analyze most recent session')
    parser.add_argument('--auto', action='store_true', help='Analyze all sessions from last 24h')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    
    args = parser.parse_args()
    
    # Determine session(s) to analyze
    session_keys = []
    
    if args.latest:
        key = get_latest_session_key()
        if key:
            session_keys.append(key)
        else:
            print("❌ No recent sessions found")
            sys.exit(1)
    
    elif args.auto:
        # Find all sessions from last 24h
        if not os.path.exists(SESSION_LOGS_DIR):
            print("❌ Session logs directory not found")
            sys.exit(1)
        
        cutoff = datetime.now() - timedelta(days=1)
        logs = [f for f in os.listdir(SESSION_LOGS_DIR) if f.endswith('.jsonl')]
        
        for log in logs:
            path = os.path.join(SESSION_LOGS_DIR, log)
            mtime = datetime.fromtimestamp(os.path.getmtime(path))
            if mtime > cutoff:
                session_keys.append(log.replace('.jsonl', ''))
        
        if not session_keys:
            print("ℹ️  No sessions from last 24h")
            sys.exit(0)
        
        print(f"Found {len(session_keys)} sessions from last 24h")
    
    elif args.session_key:
        session_keys.append(args.session_key)
    
    else:
        parser.print_help()
        sys.exit(1)
    
    # Run autopsy for each session
    results = []
    for key in session_keys:
        filepath = run_autopsy(key, verbose=args.verbose)
        if filepath:
            results.append(filepath)
            if not args.verbose:
                print(f"✅ {key}: {filepath}")
    
    if results:
        print(f"\n🎉 Generated {len(results)} autopsy report(s)")
    else:
        print("❌ No autopsies generated")

if __name__ == "__main__":
    main()
