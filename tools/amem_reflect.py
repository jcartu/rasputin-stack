#!/usr/bin/env python3
"""
A-MEM Reflection System
Periodic self-analysis of memories for patterns, lessons, and insights
"""
import json
import subprocess
import sys
import argparse
from datetime import datetime, timedelta
from collections import Counter

QDRANT_ENDPOINT = "http://localhost:6333"
COLLECTION = "second_brain"

def fetch_recent_memories(days=7, limit=100):
    """Fetch memories from the last N days"""
    try:
        now = datetime.now()
        start_date = now - timedelta(days=days)
        
        # Use scroll to get recent memories
        scroll_payload = {
            "limit": limit,
            "with_payload": True,
            "with_vector": False,
            "filter": {
                "must": [
                    {
                        "key": "date",
                        "range": {
                            "gte": start_date.isoformat()
                        }
                    }
                ]
            }
        }
        
        cmd = ['curl', '-s', f'{QDRANT_ENDPOINT}/collections/{COLLECTION}/points/scroll',
               '-H', 'Content-Type: application/json', '-d', json.dumps(scroll_payload)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        data = json.loads(result.stdout)
        
        points = data.get('result', {}).get('points', [])
        return points
    except Exception as e:
        print(f"❌ Error fetching memories: {e}", file=sys.stderr)
        return []

def analyze_patterns(memories):
    """Analyze memories for recurring patterns"""
    patterns = {
        'categories': Counter(),
        'topics': Counter(),
        'people': Counter(),
        'sentiments': Counter(),
        'sources': Counter(),
        'hourly_activity': Counter()
    }
    
    high_importance = []
    action_items = []
    lessons = []
    decisions = []
    
    for memory in memories:
        payload = memory.get('payload', {})
        
        # Count categories
        category = payload.get('category')
        if category:
            patterns['categories'][category] += 1
        
        # Count topics
        topics = payload.get('topics', [])
        for topic in topics:
            patterns['topics'][topic] += 1
        
        # Count people
        people = payload.get('people_mentioned', [])
        for person in people:
            patterns['people'][person] += 1
        
        # Count sentiments
        sentiment = payload.get('sentiment', 'neutral')
        patterns['sentiments'][sentiment] += 1
        
        # Count sources
        source = payload.get('source', 'unknown')
        patterns['sources'][source] += 1
        
        # Track hourly activity
        date_str = payload.get('date', '')
        if date_str:
            try:
                dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                patterns['hourly_activity'][dt.hour] += 1
            except:
                pass
        
        # Collect special items
        importance = payload.get('importance', 0)
        if importance >= 80:
            high_importance.append((payload.get('text', ''), importance))
        
        if category == 'lesson':
            lessons.append(payload.get('text', ''))
        
        if category == 'decision':
            decisions.append(payload.get('text', ''))
        
        actions = payload.get('action_items', [])
        if actions:
            action_items.extend(actions)
    
    return patterns, high_importance, action_items, lessons, decisions

def identify_mistakes(memories):
    """Look for patterns indicating mistakes or problems"""
    mistakes = []
    problem_keywords = ['error', 'failed', 'mistake', 'wrong', 'problem', 'bug', 'issue', 'broken']
    
    for memory in memories:
        payload = memory.get('payload', {})
        text = payload.get('text', '').lower()
        
        if any(keyword in text for keyword in problem_keywords):
            date_str = payload.get('date', '')
            try:
                dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                date_display = dt.strftime('%Y-%m-%d')
            except:
                date_display = 'Unknown date'
            
            mistakes.append({
                'date': date_display,
                'text': payload.get('text', ''),
                'category': payload.get('category', 'unknown')
            })
    
    return mistakes

def generate_reflection(days, memories, patterns, high_importance, action_items, lessons, decisions, mistakes):
    """Generate reflection summary"""
    reflection = []
    reflection.append("# 🧠 A-MEM Reflection Report")
    reflection.append(f"Period: Last {days} days")
    reflection.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    reflection.append(f"\n{'=' * 70}\n")
    
    # Overview
    reflection.append("## 📊 Overview")
    reflection.append(f"Total memories analyzed: {len(memories)}")
    reflection.append(f"High importance (≥80): {len(high_importance)}")
    reflection.append(f"Lessons learned: {len(lessons)}")
    reflection.append(f"Decisions made: {len(decisions)}")
    reflection.append(f"Action items: {len(action_items)}")
    reflection.append(f"Potential issues: {len(mistakes)}\n")
    
    # Category breakdown
    reflection.append("## 🏷️  Memory Categories")
    for category, count in patterns['categories'].most_common():
        pct = (count / len(memories)) * 100
        reflection.append(f"  {category:12} : {count:3} ({pct:.1f}%)")
    reflection.append("")
    
    # Top topics
    reflection.append("## 🎯 Top Topics")
    for topic, count in patterns['topics'].most_common(10):
        reflection.append(f"  {topic:20} : {count}")
    reflection.append("")
    
    # People interactions
    if patterns['people']:
        reflection.append("## 👥 People Mentioned")
        for person, count in patterns['people'].most_common(5):
            reflection.append(f"  {person:15} : {count} times")
        reflection.append("")
    
    # Sentiment analysis
    reflection.append("## 😊 Sentiment Distribution")
    total_sentiment = sum(patterns['sentiments'].values())
    for sentiment, count in patterns['sentiments'].items():
        pct = (count / total_sentiment) * 100
        emoji = {'positive': '😊', 'negative': '😞', 'neutral': '😐'}.get(sentiment, '🤷')
        reflection.append(f"  {emoji} {sentiment:10} : {count:3} ({pct:.1f}%)")
    reflection.append("")
    
    # Activity pattern
    if patterns['hourly_activity']:
        reflection.append("## ⏰ Activity Pattern (by hour)")
        sorted_hours = sorted(patterns['hourly_activity'].items())
        for hour, count in sorted_hours[:10]:  # Top 10 hours
            bar = '█' * (count // 2)
            reflection.append(f"  {hour:02d}:00 : {bar} ({count})")
        reflection.append("")
    
    # High importance memories
    if high_importance:
        reflection.append("## ⭐ High Importance Memories")
        for text, importance in sorted(high_importance, key=lambda x: x[1], reverse=True)[:5]:
            reflection.append(f"  [{importance}] {text[:100]}{'...' if len(text) > 100 else ''}")
        reflection.append("")
    
    # Decisions made
    if decisions:
        reflection.append("## 🎯 Key Decisions")
        for decision in decisions[:5]:
            reflection.append(f"  • {decision[:150]}{'...' if len(decision) > 150 else ''}")
        reflection.append("")
    
    # Lessons learned
    if lessons:
        reflection.append("## 📚 Lessons Learned")
        for lesson in lessons[:5]:
            reflection.append(f"  • {lesson[:150]}{'...' if len(lesson) > 150 else ''}")
        reflection.append("")
    
    # Mistakes/problems
    if mistakes:
        reflection.append("## ⚠️  Issues & Mistakes")
        for mistake in mistakes[:5]:
            reflection.append(f"  [{mistake['date']}] {mistake['text'][:120]}{'...' if len(mistake['text']) > 120 else ''}")
        reflection.append("")
    
    # Action items
    if action_items:
        reflection.append("## ✅ Action Items Mentioned")
        unique_actions = list(set(action_items))[:10]
        for action in unique_actions:
            reflection.append(f"  • {action[:100]}{'...' if len(action) > 100 else ''}")
        reflection.append("")
    
    # Insights
    reflection.append("## 💡 Insights & Recommendations")
    
    # Most active topics
    if patterns['topics']:
        top_topic = patterns['topics'].most_common(1)[0][0]
        reflection.append(f"  • Most discussed topic: **{top_topic}**")
    
    # Sentiment trend
    pos = patterns['sentiments'].get('positive', 0)
    neg = patterns['sentiments'].get('negative', 0)
    if pos > neg * 2:
        reflection.append(f"  • Overall sentiment is positive ({pos} vs {neg}) 😊")
    elif neg > pos:
        reflection.append(f"  • Watch for negative sentiment ({neg} negative events) 😞")
    
    # Action items vs completion
    if action_items:
        reflection.append(f"  • {len(action_items)} action items mentioned - review for completion")
    
    # Learning rate
    if lessons:
        reflection.append(f"  • {len(lessons)} lessons captured - good learning behavior! 📚")
    
    return "\n".join(reflection)

def reflect(days=7, save_to_file=None):
    """Main reflection function"""
    print(f"🔍 Fetching memories from last {days} days...\n")
    
    memories = fetch_recent_memories(days)
    
    if not memories:
        print("❌ No memories found for the specified period")
        return
    
    print(f"✅ Analyzing {len(memories)} memories...\n")
    
    patterns, high_importance, action_items, lessons, decisions = analyze_patterns(memories)
    mistakes = identify_mistakes(memories)
    
    reflection = generate_reflection(
        days, memories, patterns, high_importance,
        action_items, lessons, decisions, mistakes
    )
    
    print(reflection)
    
    if save_to_file:
        with open(save_to_file, 'w') as f:
            f.write(reflection)
        print(f"\n💾 Reflection saved to: {save_to_file}")

def main():
    parser = argparse.ArgumentParser(description='A-MEM Reflection System')
    parser.add_argument('--days', type=int, default=7, help='Number of days to reflect on (default: 7)')
    parser.add_argument('--save', type=str, help='Save reflection to file')
    
    args = parser.parse_args()
    
    reflect(days=args.days, save_to_file=args.save)

if __name__ == "__main__":
    main()
