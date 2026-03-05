#!/bin/bash
# Benchmark Qwen3-235B vs Qwen2.5-72B
# Measures: time to first token, tok/s generation, quality on 3 tasks

set -e
RESULTS="/home/admin/.openclaw/workspace/artifacts/qwen3_benchmark_$(date +%Y%m%d_%H%M).md"
mkdir -p "$(dirname $RESULTS)"

run_bench() {
    local MODEL=$1
    local PROMPT=$2
    local LABEL=$3
    
    echo "⏱ Testing $MODEL: $LABEL"
    local START=$(date +%s%N)
    local OUTPUT=$(echo "$PROMPT" | timeout 120 ollama run "$MODEL" --nowordwrap 2>/dev/null)
    local END=$(date +%s%N)
    
    local WORDS=$(echo "$OUTPUT" | wc -w)
    local ELAPSED=$(( (END - START) / 1000000 ))
    local ELAPSED_S=$(echo "scale=1; $ELAPSED / 1000" | bc)
    local TOK=$(echo "scale=0; $WORDS * 1.3 / 1" | bc)  # rough token estimate
    local TPS=$(echo "scale=1; $TOK * 1000 / $ELAPSED" | bc)
    
    echo "  → ${WORDS} words | ${ELAPSED_S}s | ~${TPS} tok/s"
    echo "$OUTPUT" | head -3
    echo "---"
    
    # Return result
    echo "| $MODEL | $LABEL | ${ELAPSED_S}s | ~${TPS} tok/s | $(echo "$OUTPUT" | head -1) |"
}

echo "# Qwen3-235B vs Qwen2.5-72B Benchmark" > "$RESULTS"
echo "Date: $(date)" >> "$RESULTS"
echo "" >> "$RESULTS"

# Task 1: Speed test (short output)
echo "## Speed Test (100-token response)" >> "$RESULTS"
echo "| Model | Task | Time | Speed | Sample |" >> "$RESULTS"
echo "|-------|------|------|-------|--------|" >> "$RESULTS"

P1="Explain MoE (Mixture of Experts) neural networks in exactly 80 words."
run_bench "qwen2.5:72b"  "$P1" "speed-short" >> "$RESULTS"
run_bench "qwen3:235b"   "$P1" "speed-short" >> "$RESULTS"

# Task 2: Reasoning/coding
echo "" >> "$RESULTS"
echo "## Reasoning Test" >> "$RESULTS"
echo "| Model | Task | Time | Speed | Sample |" >> "$RESULTS"
echo "|-------|------|------|-------|--------|" >> "$RESULTS"

P2="Write a Python function that checks if an digital-ops player deposit is suspicious based on: amount, frequency, and country. Return a risk score 0-100 with reasoning."
run_bench "qwen2.5:72b" "$P2" "reasoning" >> "$RESULTS"
run_bench "qwen3:235b"  "$P2" "reasoning" >> "$RESULTS"

# Task 3: Multi-step reasoning
echo "" >> "$RESULTS"
echo "## Multi-step Reasoning" >> "$RESULTS"
echo "| Model | Task | Time | Speed | Sample |" >> "$RESULTS"
echo "|-------|------|------|-------|--------|" >> "$RESULTS"

P3="You are a platform compliance officer. Our Brazil brand platform-beta has 5,200 sites blocked by Anatel. Our jurisdiction-alpha license #157707 expires in October 2026. PIX payments are being blocked. List the top 3 immediate actions in priority order with specific implementation steps."
run_bench "qwen2.5:72b" "$P3" "multi-step" >> "$RESULTS"
run_bench "qwen3:235b"  "$P3" "multi-step" >> "$RESULTS"

echo "" >> "$RESULTS"
echo "---" >> "$RESULTS"
echo "Benchmark complete. Saved to: $RESULTS"
cat "$RESULTS"
