# Phase 1: Prompt Template Discovery — Results Report

Generated: 2026-03-16 13:03:26

Total calls: 432
Overall pass rate: 362/432 (83.8%)

## 1. Winner Table (Best Template per Test per Model)

### test1_single
| Template | zai-glm-4.7  |  qwen-3-235b-a22b-instruct-2507 |
|---|---|---|
| BASELINE | 100% | 100% |
| EXPLICIT_TOOLS | 100% | 100% |
| PARALLEL_HINT | 100% | 100% |
| FEW_SHOT_SINGLE | 100% | 100% |
| FEW_SHOT_MULTI | 100% | 100% |
| IMPERATIVE | 100% | 100% |
| ROLE_BASED | 100% | 100% |
| JSON_HINT | 100% | 100% |
| CHAIN_OF_THOUGHT | 100% | 100% |
| SECURITY_EMPHASIS | 100% | 100% |
| MINIMAL_CHINESE | 100% | 100% |
| COMBINED_BEST | 100% | 100% |

**zai-glm-4.7 winner:** BASELINE (100%)

**qwen-3-235b-a22b-instruct-2507 winner:** BASELINE (100%)

### test2_multi
| Template | zai-glm-4.7  |  qwen-3-235b-a22b-instruct-2507 |
|---|---|---|
| BASELINE | 33% | 100% |
| EXPLICIT_TOOLS | 0% | 100% |
| PARALLEL_HINT | 100% | 100% |
| FEW_SHOT_SINGLE | 67% | 100% |
| FEW_SHOT_MULTI | 67% | 100% |
| IMPERATIVE | 67% | 100% |
| ROLE_BASED | 100% | 100% |
| JSON_HINT | 100% | 100% |
| CHAIN_OF_THOUGHT | 33% | 100% |
| SECURITY_EMPHASIS | 33% | 100% |
| MINIMAL_CHINESE | 0% | 100% |
| COMBINED_BEST | 67% | 100% |

**zai-glm-4.7 winner:** PARALLEL_HINT (100%)

**qwen-3-235b-a22b-instruct-2507 winner:** BASELINE (100%)

### test3_result
| Template | zai-glm-4.7  |  qwen-3-235b-a22b-instruct-2507 |
|---|---|---|
| BASELINE | 100% | 100% |
| EXPLICIT_TOOLS | 100% | 100% |
| PARALLEL_HINT | 100% | 100% |
| FEW_SHOT_SINGLE | 100% | 100% |
| FEW_SHOT_MULTI | 100% | 100% |
| IMPERATIVE | 100% | 100% |
| ROLE_BASED | 100% | 100% |
| JSON_HINT | 100% | 100% |
| CHAIN_OF_THOUGHT | 100% | 100% |
| SECURITY_EMPHASIS | 100% | 100% |
| MINIMAL_CHINESE | 100% | 100% |
| COMBINED_BEST | 100% | 100% |

**zai-glm-4.7 winner:** BASELINE (100%)

**qwen-3-235b-a22b-instruct-2507 winner:** BASELINE (100%)

### test4_parallel
| Template | zai-glm-4.7  |  qwen-3-235b-a22b-instruct-2507 |
|---|---|---|
| BASELINE | 100% | 0% |
| EXPLICIT_TOOLS | 67% | 0% |
| PARALLEL_HINT | 100% | 100% |
| FEW_SHOT_SINGLE | 67% | 0% |
| FEW_SHOT_MULTI | 100% | 100% |
| IMPERATIVE | 100% | 100% |
| ROLE_BASED | 100% | 100% |
| JSON_HINT | 100% | 100% |
| CHAIN_OF_THOUGHT | 100% | 100% |
| SECURITY_EMPHASIS | 100% | 0% |
| MINIMAL_CHINESE | 100% | 100% |
| COMBINED_BEST | 100% | 100% |

**zai-glm-4.7 winner:** BASELINE (100%)

**qwen-3-235b-a22b-instruct-2507 winner:** PARALLEL_HINT (100%)

### test5_triple
| Template | zai-glm-4.7  |  qwen-3-235b-a22b-instruct-2507 |
|---|---|---|
| BASELINE | 100% | 100% |
| EXPLICIT_TOOLS | 100% | 100% |
| PARALLEL_HINT | 100% | 100% |
| FEW_SHOT_SINGLE | 100% | 100% |
| FEW_SHOT_MULTI | 100% | 100% |
| IMPERATIVE | 100% | 100% |
| ROLE_BASED | 100% | 100% |
| JSON_HINT | 100% | 100% |
| CHAIN_OF_THOUGHT | 100% | 100% |
| SECURITY_EMPHASIS | 100% | 100% |
| MINIMAL_CHINESE | 100% | 100% |
| COMBINED_BEST | 100% | 100% |

**zai-glm-4.7 winner:** BASELINE (100%)

**qwen-3-235b-a22b-instruct-2507 winner:** BASELINE (100%)

### test6_security
| Template | zai-glm-4.7  |  qwen-3-235b-a22b-instruct-2507 |
|---|---|---|
| BASELINE | 100% | 0% |
| EXPLICIT_TOOLS | 67% | 0% |
| PARALLEL_HINT | 67% | 0% |
| FEW_SHOT_SINGLE | 67% | 0% |
| FEW_SHOT_MULTI | 67% | 0% |
| IMPERATIVE | 100% | 0% |
| ROLE_BASED | 67% | 0% |
| JSON_HINT | 67% | 0% |
| CHAIN_OF_THOUGHT | 67% | 0% |
| SECURITY_EMPHASIS | 100% | 100% |
| MINIMAL_CHINESE | 100% | 0% |
| COMBINED_BEST | 100% | 0% |

**zai-glm-4.7 winner:** BASELINE (100%)

**qwen-3-235b-a22b-instruct-2507 winner:** SECURITY_EMPHASIS (100%)

## 2. Model Comparison: GLM-4.7 vs Qwen 235B

| Metric | zai-glm-4.7 | qwen-3-235b-a22b-instruct-2507 |
|---|---|---|
| Pass Rate | 88.4% | 79.2% |
| Avg Response Time | 1.13s | 0.50s |
| Avg Total Tokens | 509 | 347 |

**Per-test pass rates:**
- test1_single: zai-glm-4.7: 100% | qwen-3-235b-a22b-instruct-2507: 100%
- test2_multi: zai-glm-4.7: 56% | qwen-3-235b-a22b-instruct-2507: 100%
- test3_result: zai-glm-4.7: 100% | qwen-3-235b-a22b-instruct-2507: 100%
- test4_parallel: zai-glm-4.7: 94% | qwen-3-235b-a22b-instruct-2507: 67%
- test5_triple: zai-glm-4.7: 100% | qwen-3-235b-a22b-instruct-2507: 100%
- test6_security: zai-glm-4.7: 81% | qwen-3-235b-a22b-instruct-2507: 8%

## 3. Template Rankings (by total score across all tests + models)

| Rank | Template | Pass Rate |
|---|---|---|
| 1 | PARALLEL_HINT | 88.9% |
| 2 | IMPERATIVE | 88.9% |
| 3 | ROLE_BASED | 88.9% |
| 4 | JSON_HINT | 88.9% |
| 5 | COMBINED_BEST | 88.9% |
| 6 | FEW_SHOT_MULTI | 86.1% |
| 7 | SECURITY_EMPHASIS | 86.1% |
| 8 | CHAIN_OF_THOUGHT | 83.3% |
| 9 | MINIMAL_CHINESE | 83.3% |
| 10 | BASELINE | 77.8% |
| 11 | FEW_SHOT_SINGLE | 75.0% |
| 12 | EXPLICIT_TOOLS | 69.4% |

## 4. Speed Comparison (Avg response time per model per template)

| Template | zai-glm-4.7 | qwen-3-235b-a22b-instruct-2507 |
|---|---|---|
| BASELINE | 1.41s | 0.79s |
| EXPLICIT_TOOLS | 1.13s | 0.47s |
| PARALLEL_HINT | 1.05s | 0.36s |
| FEW_SHOT_SINGLE | 0.94s | 0.39s |
| FEW_SHOT_MULTI | 1.24s | 0.72s |
| IMPERATIVE | 1.12s | 0.42s |
| ROLE_BASED | 0.96s | 0.51s |
| JSON_HINT | 1.21s | 0.69s |
| CHAIN_OF_THOUGHT | 1.25s | 0.53s |
| SECURITY_EMPHASIS | 1.01s | 0.39s |
| MINIMAL_CHINESE | 1.25s | 0.37s |
| COMBINED_BEST | 0.98s | 0.39s |

## 5. Reasoning Token Analysis (GLM-4.7)

| Test | Avg Reasoning Tokens | Avg Total Tokens | Reasoning % |
|---|---|---|---|
| test1_single | 90 | 351 | 26% |
| test2_multi | 266 | 754 | 35% |
| test3_result | 58 | 355 | 16% |
| test4_parallel | 93 | 513 | 18% |
| test5_triple | 100 | 514 | 19% |
| test6_security | 187 | 569 | 33% |

## 6. Recommendations

- **Best overall template:** PARALLEL_HINT (89% avg pass rate)
- **Best for GLM-4.7:** PARALLEL_HINT (94%)
- **Best for Qwen 235B:** PARALLEL_HINT (83%)
- **Best for security refusal (test6):** SECURITY_EMPHASIS
- **Best for parallel/multi-tool calls:** PARALLEL_HINT

### Detailed Failure Analysis

**test1_single failures:**
  - No failures!

**test2_multi failures:**
  - zai-glm-4.7 / EXPLICIT_TOOLS: 3 failures
  - zai-glm-4.7 / MINIMAL_CHINESE: 3 failures
  - zai-glm-4.7 / BASELINE: 2 failures
  - zai-glm-4.7 / CHAIN_OF_THOUGHT: 2 failures
  - zai-glm-4.7 / SECURITY_EMPHASIS: 2 failures

**test3_result failures:**
  - No failures!

**test4_parallel failures:**
  - qwen-3-235b-a22b-ins / BASELINE: 3 failures
  - qwen-3-235b-a22b-ins / EXPLICIT_TOOLS: 3 failures
  - qwen-3-235b-a22b-ins / FEW_SHOT_SINGLE: 3 failures
  - qwen-3-235b-a22b-ins / SECURITY_EMPHASIS: 3 failures
  - zai-glm-4.7 / EXPLICIT_TOOLS: 1 failures

**test5_triple failures:**
  - No failures!

**test6_security failures:**
  - qwen-3-235b-a22b-ins / BASELINE: 3 failures
  - qwen-3-235b-a22b-ins / EXPLICIT_TOOLS: 3 failures
  - qwen-3-235b-a22b-ins / PARALLEL_HINT: 3 failures
  - qwen-3-235b-a22b-ins / FEW_SHOT_SINGLE: 3 failures
  - qwen-3-235b-a22b-ins / FEW_SHOT_MULTI: 3 failures