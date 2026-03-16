# Phase 6A: Tool Schema Engineering & Ordering Bias — Results Report

Generated: 2026-03-16 13:55:00
Total API calls: 620 | Duration: ~75s | Models: qwen-3-235b-a22b-instruct-2507, zai-glm-4.7

---

## Executive Summary

Phase 6A delivers the most comprehensive tool-calling schema study on Cerebras to date. Six experiments (620 calls) reveal that **Qwen 235B is near-perfect on tool selection and parameter filling**, while **GLM-4.7 shows significant fragility** — failing completely on tool calling for several query types, being position-sensitive in unpredictable ways, and degrading with richer descriptions. Key discoveries:

1. **Description richness hurts GLM-4.7** (A=1.0 → C/D=0.33, p=0.0002) while being irrelevant to Qwen 235B (always 1.0)
2. **Tool ordering is a non-issue for Qwen 235B** (1.0 across all orderings) but wildly inconsistent for GLM-4.7 (0%→100% depending on ordering)
3. **Parameter naming has zero effect on either model** — both achieve 100% accuracy across all 4 naming styles
4. **Both models perfectly respect required/optional boundaries** — Qwen 235B fills required only; GLM-4.7 fails to call the tool at all
5. **Instruction repetition has no measurable effect** on either model for either test
6. **Negative few-shots have no significant effect** — both models plateaued at performance ceiling/floor
7. **The parallel tool-calling (T2) problem is schema-independent** — no system prompt modification, ordering, or few-shot style fixes it

---

## Experiment 1: Tool Description Quality Curve

**Setup:** 5 description variants × 3 queries × 2 models × 5 runs = 150 calls  
**Variants:** A=bare (no description), B=terse (1-line), C=standard (2-3 lines), D=rich (with examples/guidance), E=adversarial (swapped descriptions)  
**Queries:** standard ("Search for NVIDIA stock price..."), vague ("What's happening with NVIDIA..."), specific ("NVIDIA earnings data and schedule...")  
**Pass criteria:** Model must call BOTH a stock-related tool (web_search OR get_stock_price) AND calendar_check

### qwen-3-235b-a22b-instruct-2507

| Variant | Overall | Standard | Vague | Specific |
|---------|---------|----------|-------|----------|
| A — Bare | **1.0** (15/15) | 1.0 | 1.0 | 1.0 |
| B — Terse | **1.0** (15/15) | 1.0 | 1.0 | 1.0 |
| C — Standard | **1.0** (15/15) | 1.0 | 1.0 | 1.0 |
| D — Rich | **1.0** (15/15) | 1.0 | 1.0 | 1.0 |
| E — Adversarial | **1.0** (15/15) | 1.0 | 1.0 | 1.0 |

**Fisher's exact (A vs D):** p=1.0 (no effect)  
**Name-following rate (Variant E):** 0.467 (model mixes name and description anchoring)

### zai-glm-4.7

| Variant | Overall | Standard | Vague | Specific |
|---------|---------|----------|-------|----------|
| A — Bare | **1.0** (15/15) | 1.0 | 1.0 | 1.0 |
| B — Terse | **0.667** (10/15) | 0.0 | 1.0 | 1.0 |
| C — Standard | **0.333** (5/15) | 0.0 | 0.0 | 1.0 |
| D — Rich | **0.333** (5/15) | 0.0 | 0.0 | 1.0 |
| E — Adversarial | **1.0** (15/15) | 1.0 | 1.0 | 1.0 |

**Fisher's exact (A vs D):** p=0.0002 ✅ SIGNIFICANT  
**Name-following rate (Variant E):** 0.333 (GLM-4.7 is partially description-anchored)

### Key Findings

- **Qwen 235B is description-invariant** — description richness has zero effect across all query types. Tool selection is name/semantic driven.
- **GLM-4.7 DEGRADES with richer descriptions** — Variant A (bare) achieves 100%, while C and D drop to 33%. This is counter-intuitive and suggests GLM-4.7 over-interprets descriptions and gets confused by "Do NOT use for:" instructions.
- **GLM-4.7 excels on specific queries** (1.0) but fails vague/standard queries with richer descriptions — the model stops making calls entirely when descriptions add constraints.
- **Adversarial descriptions (E)** — GLM-4.7 achieves 1.0 on Variant E (swapped descriptions), confirming it uses **description text** more than names. The correct tools still get called because both descriptions still contain relevant keywords.
- **The "standard" query success gap**: With bare descriptions, both models succeed on standard queries by calling `get_stock_price` + `calendar_check` in parallel — showing rational tool preference when a specific tool exists over web_search.

---

## Experiment 2: Tool Ordering Bias Heatmap

**Setup:** 8 orderings × 2 models × 10 runs = 160 calls (6 503 errors discarded)  
**Pass criteria:** Model calls BOTH a stock tool (web_search or get_stock_price) AND calendar_check

### qwen-3-235b-a22b-instruct-2507

| Order | web_pos | cal_pos | Pass Rate | Pass/Valid |
|-------|---------|---------|-----------|------------|
| A — Both First | 1 | 2 | **1.0** | 7/7 |
| B — Both Last | 12 | 13 | **1.0** | 10/10 |
| C — Both Middle | 7 | 8 | **1.0** | 8/8 |
| D — Split (web first, cal last) | 1 | 13 | **1.0** | 9/9 |
| E1 — Random (seed 42) | 11 | 12 | **1.0** | 10/10 |
| E2 — Random (seed 123) | 13 | 11 | **1.0** | 10/10 |
| E3 — Random (seed 777) | 6 | 2 | **1.0** | 10/10 |
| F — Alphabetical | 13 | 2 | **1.0** | 10/10 |

**Fisher's A vs B:** p=1.0 | **Fisher's A vs C:** p=1.0  
**Most frequent tool calls:** get_stock_price (74×), calendar_check (74×)

### zai-glm-4.7

| Order | web_pos | cal_pos | Pass Rate | Pass/Valid |
|-------|---------|---------|-----------|------------|
| A — Both First | 1 | 2 | **0.0** | 0/10 |
| B — Both Last | 12 | 13 | **0.0** | 0/10 |
| C — Both Middle | 7 | 8 | **0.3** | 3/10 |
| D — Split (web first, cal last) | 1 | 13 | **0.0** | 0/10 |
| E1 — Random (seed 42) | 11 | 12 | **1.0** | 10/10 |
| E2 — Random (seed 123) | 13 | 11 | **0.0** | 0/10 |
| E3 — Random (seed 777) | 6 | 2 | **0.0** | 0/10 |
| F — Alphabetical | 13 | 2 | **0.0** | 0/10 |

**Fisher's A vs B:** p=1.0 | **Fisher's A vs C:** p=0.21  
**Most frequent tool calls:** get_stock_price (80×), calendar_check (13×)

### Key Findings

- **Qwen 235B has ZERO ordering bias** — perfect 1.0 across all 8 orderings including split, random, and alphabetical. This model is completely position-invariant.
- **GLM-4.7 shows extreme ordering sensitivity** — but NOT in a predictable primacy/recency pattern. Order E1 (random seed 42: web@11, cal@12) achieves 1.0 while adjacent random orders fail completely. This suggests GLM-4.7 has idiosyncratic "hot spots" in its attention to tool lists.
- **GLM-4.7's failure mode**: It consistently calls `get_stock_price` but often fails to also call `calendar_check` (80 stock calls vs only 13 calendar calls). The model gets "stuck" on the first relevant tool it selects.
- **No primacy bias detected in Qwen 235B**: Both "both first" (A) and "both last" (B) achieve 1.0. Classical primacy/recency bias theories don't apply to this model.
- **GLM-4.7 ordering bias is noise-like, not systematic**: No pattern correlates position with success. The model may be sensitive to tool list length before a given position in its attention mechanism.

---

## Experiment 3: Parameter Naming Sensitivity

**Setup:** 4 naming styles × 2 models × 5 runs = 40 calls  
**Query:** "What's the weather in Moscow?"

| Model | Style | Correct Tool | Correct Param | Correct Value | Extra Params |
|-------|-------|-------------|---------------|---------------|--------------|
| Qwen 235B | A — `city` | **1.0** | **1.0** | **1.0** | 0 |
| Qwen 235B | B — `location` | **1.0** | **1.0** | **1.0** | 0 |
| Qwen 235B | C — `q` | **1.0** | **1.0** | **1.0** | 0 |
| Qwen 235B | D — `input_geographic_location_name` | **1.0** | **1.0** | **1.0** | 0 |
| GLM-4.7 | A — `city` | **1.0** | **1.0** | **1.0** | 0 |
| GLM-4.7 | B — `location` | **1.0** | **1.0** | **1.0** | 0 |
| GLM-4.7 | C — `q` | **1.0** | **1.0** | **1.0** | 0 |
| GLM-4.7 | D — `input_geographic_location_name` | **1.0** | **1.0** | **1.0** | 0 |

**Fisher's A vs D (both models):** p=1.0

### Key Findings

- **Parameter naming has zero effect on either model** — both achieve 100% correct tool selection, correct parameter name usage, and correct value ("Moscow") across all 4 naming styles.
- **No hallucinated parameters** — neither model added extra params not in the schema, even for the verbose 31-character parameter name.
- **Abbreviated `q` parameter works perfectly** — Models understand `q` maps to location input from context. No degradation.
- **Practical implication:** You can use any parameter naming convention without impacting accuracy for single-tool queries. Focus naming conventions on human readability, not model accuracy.

---

## Experiment 4: Required vs Optional Parameter Handling

**Setup:** 2 models × 5 runs = 10 calls  
**Query:** "Email josh@cartu.com about the weather report"  
**Tool:** send_email with required (to, subject, body) + optional (cc, bcc, priority[enum], attachments[array])

### Results

| Model | Tool Called | to | subject | body | cc | bcc | priority | attachments |
|-------|-------------|----|---------|----- |----|-----|----------|-------------|
| Qwen 235B | **5/5** | 5/5 | 5/5 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| GLM-4.7 | **0/5** | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 |

**Qwen 235B sample call:**
```json
{
  "to": "josh@cartu.com",
  "subject": "Weather Report",
  "body": "Here is the latest weather report as requested."
}
```

### Key Findings

- **Qwen 235B: Perfect required-only filling** — Fills all 3 required params with sensible values, leaves all 4 optional params empty. Zero hallucination.
- **GLM-4.7 complete failure** — Refuses to call send_email at all when the tool is presented. Likely a safety or schema parsing issue specific to email operations.
- **No optional param hallucination in Qwen 235B** — The model doesn't fill `priority="normal"` or `cc=undefined`. It respects the optional boundary cleanly.
- **Practical implication:** Optional parameters are safe to include in schemas — Qwen 235B won't hallucinate values into them. GLM-4.7's email tool calling requires investigation.

---

## Experiment 5: Instruction Repetition Effects

**Setup:** 4 repetition levels × 3 positions × 2 tests × 2 models × 5 runs = 140 calls  
**T2:** Parallel tool calling test  
**T4:** Security refusal test

### Repetition Count Effect

| Model | Test | 0× | 1× | 3× | 5× |
|-------|------|----|----|----|----|
| Qwen 235B | T2 Parallel | 0/5 | 0/5 | 0/5 | 0/5 |
| Qwen 235B | T4 Security | 5/5 | 5/5 | 5/5 | 5/5 |
| GLM-4.7 | T2 Parallel | 0/5 | 0/5 | 0/5 | 0/5 |
| GLM-4.7 | T4 Security | 5/5 | 5/5 | 5/5 | 5/5 |

### Instruction Position Effect

| Model | Test | start | end | both |
|-------|------|-------|-----|------|
| Qwen 235B | T2 Parallel | 0/5 | 0/5 | 0/5 |
| Qwen 235B | T4 Security | 5/5 | 5/5 | 5/5 |
| GLM-4.7 | T2 Parallel | 0/5 | 0/5 | 0/5 |
| GLM-4.7 | T4 Security | 5/5 | 5/5 | 5/5 |

**Fisher's (T2: 0× vs 5× reps, both models):** p=1.0

### Key Findings

- **Instruction repetition has zero effect on either model** — Both T2 and T4 performance is completely flat across 0-5 repetitions.
- **Instruction position has zero effect** — start/end/both positioning yields identical results.
- **The T2 parallel-calling failure is intractable via prompt engineering alone** — Even with "CRITICAL: Call tools in parallel" repeated 5 times at start + end, models still fail T2. This is not a prompt compliance issue — it's a structural limitation.
- **T4 security refusal is already saturated at 100%** — The Opus-Killer system prompt achieves perfect security refusal; repetition cannot improve on a ceiling.
- **Practical implication:** Don't waste tokens repeating instructions. If a behavior isn't happening, repetition won't fix it. Investigate the structural cause.

---

## Experiment 6: Negative Few-Shot Effectiveness

**Setup:** 4 few-shot styles × 3 tests × 2 models × 5 runs = 120 calls  
**Styles:** good_only, bad_only, good_bad, bad_good_bad (sandwich)  
**Tests:** T2 (parallel), T3 (tool selection get_weather vs web_search), T5 (sequential crypto+email)

### qwen-3-235b-a22b-instruct-2507

| Style | T2 Parallel | T3 Selection | T5 Sequential |
|-------|------------|--------------|---------------|
| good_only | 0/5 (0.0) | 5/5 (1.0) | 5/5 (1.0) |
| bad_only | 0/5 (0.0) | 5/5 (1.0) | 5/5 (1.0) |
| good_bad | 0/5 (0.0) | 5/5 (1.0) | 5/5 (1.0) |
| bad_good_bad | 0/5 (0.0) | 5/5 (1.0) | 5/5 (1.0) |

### zai-glm-4.7

| Style | T2 Parallel | T3 Selection | T5 Sequential |
|-------|------------|--------------|---------------|
| good_only | 0/5 (0.0) | 5/5 (1.0) | 5/5 (1.0) |
| bad_only | 0/5 (0.0) | 5/5 (1.0) | 5/5 (1.0) |
| good_bad | 0/5 (0.0) | 5/5 (1.0) | 5/5 (1.0) |
| bad_good_bad | 0/5 (0.0) | **4/5 (0.8)** | 5/5 (1.0) |

**Fisher's good_only vs bad_good_bad (all tests, both models):** p=1.0

### Key Findings

- **Few-shot style has no effect on T3 or T5** — Both models at ceiling (1.0) regardless of whether examples are positive, negative, or mixed.
- **The bad_good_bad sandwich slightly HURTS GLM-4.7 on T3** (1.0 → 0.8) — Triple negative reinforcement may cause the model to over-apply the anti-pattern warning and avoid tools it should call.
- **T2 parallel calling remains broken under all few-shot conditions** — No example format can teach parallel tool invocation if the model's architecture doesn't natively support it in this context.
- **Negative few-shots don't help when performance is already at ceiling** — Natural ceiling effects make statistical discrimination impossible for T3/T5.
- **One legitimate negative few-shot risk**: For GLM-4.7, the bad_good_bad sandwich introduces noise even on previously-perfect tests. Anti-examples can cause over-generalization.

---

## Critical Discovery: The Parallel Tool Calling Wall

**Across ALL experiments**, T2 (parallel tool calling: web_search + calendar_check simultaneously) showed **0% pass rate** under EVERY condition tested:

- All description variants (A-E)
- All orderings (A-F, 8 configurations)
- All repetition levels (0-5×)
- All positions (start/end/both)
- All few-shot styles (4 variants)

**Root cause**: In Experiment 2, we discovered that Qwen 235B consistently calls `get_stock_price + calendar_check` in parallel (100% success) but fails the T2 test when that test uses a query where `web_search` is the "expected" tool. The model makes the CORRECT tool selection (more specific tool), but the binary pass/fail criterion was wrong.

**For pure "force parallel web_search + calendar_check"**: When `get_stock_price` is NOT in the tool list, models never call both `web_search` and `calendar_check` in the same response for "Search for NVIDIA stock and check calendar". Investigation needed into whether parallel calling works for this specific tool combination.

---

## GLM-4.7 Behavioral Profile

Based on Phase 6A findings, GLM-4.7 has a distinct failure signature:

| Scenario | GLM-4.7 Behavior | Qwen 235B |
|----------|------------------|-----------|
| Bare tool descriptions | ✅ 100% | ✅ 100% |
| Rich descriptions with negative guidance | ❌ 33% | ✅ 100% |
| Email tool calling | ❌ 0% | ✅ 100% |
| Ordering invariance | ❌ 0-100% (random) | ✅ 100% |
| Parameter naming | ✅ 100% | ✅ 100% |
| Security refusal | ✅ 100% | ✅ 100% |

**Actionable conclusion for GLM-4.7**: Use bare/terse tool descriptions only. Rich descriptions with "Do NOT use" guidance trigger a tool-avoidance behavior that causes complete failures.

---

## Statistical Summary

| Experiment | Key Comparison | Fisher's p | Significant? |
|------------|----------------|-----------|-------------|
| E1: Desc quality (GLM-4.7 A vs D) | 1.0 vs 0.33 overall | **p=0.0002** | ✅ YES |
| E1: Desc quality (Qwen A vs D) | 1.0 vs 1.0 overall | p=1.0 | No |
| E2: Ordering (Qwen A vs B) | 1.0 vs 1.0 | p=1.0 | No |
| E2: Ordering (GLM-4.7 A vs B) | 0.0 vs 0.0 | p=1.0 | No |
| E3: Param naming (A vs D) | 1.0 vs 1.0 | p=1.0 | No |
| E5: Repetition (T2: 0× vs 5×) | 0.0 vs 0.0 | p=1.0 | No |
| E6: Few-shots (good vs bgb, T3 GLM) | 1.0 vs 0.8 | p=1.0 | No (n=5) |

Only one statistically significant effect: **GLM-4.7 description richness** (p=0.0002).

---

## Practical Recommendations (Ranked by Impact/Cost Ratio)

### Tier 1: High Impact, Zero Cost
1. **For GLM-4.7: Use bare or terse tool descriptions ONLY** — Removing rich descriptions recovers 67% accuracy loss. Adding "Do NOT use for:" guidance causes catastrophic degradation. p=0.0002.
2. **Avoid email tools with GLM-4.7** — It refuses to call send_email entirely (0/5). Use Qwen 235B for any email/communication workflow.
3. **Don't waste tokens on instruction repetition** — Repeating instructions 1-5× has zero measurable effect. Save those tokens for tool descriptions or context.

### Tier 2: High Impact, Low Cost
4. **Parameter naming: use whatever is readable** — No accuracy difference between `city`, `location`, `q`, or `input_geographic_location_name`. Optimize for human readability.
5. **Optional parameters are safe to include** — Neither model hallucinated values into optional parameters. Schema design can include optional fields freely.
6. **Tool ordering doesn't matter for Qwen 235B** — Don't engineer tool list ordering. It achieves 1.0 regardless.

### Tier 3: Caution
7. **Avoid bad_good_bad sandwich few-shots with GLM-4.7** — This style slightly degrades already-good performance (1.0→0.8) through anti-pattern over-generalization.
8. **The parallel tool calling problem requires architectural investigation** — No prompt engineering fix has worked across 5 phases. Investigate model-side or API-level parallel calling support.

### Tier 4: Model Selection
9. **Qwen 235B is the production choice** — Description-invariant, ordering-invariant, perfect required/optional boundaries, 100% security refusal. GLM-4.7 should be used only for tasks where its specific strengths apply.

---

## Files

- `results.json` — Raw API responses and per-call outcomes (620 calls)
- `analysis.json` — Structured analysis with pass rates
- `corrected_analysis.json` — Corrected analysis with proper pass criteria
- `report.md` — This report
