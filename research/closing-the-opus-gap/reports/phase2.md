# Phase 2: Multi-Pass Strategy Testing — Report
**Generated:** 2026-03-16 13:30:51
**Baseline:** 0% pass rate (known from Phase 1)

## Summary Table
| Combo | Strategy | Pass Rate | API Calls/Run | p-value vs baseline |
|-------|----------|-----------|---------------|--------------------|
| glm47_test2 | MajorityVote | 0% (0/5) | 3.0 | 1.0000 |
| glm47_test2 | SelfVerify | 0% (0/5) | 2.0 | 1.0000 |
| glm47_test2 | TempSweep | 40% (2/5) | 2.8 | 0.2222 |
| glm47_test2 | FallbackChain | 100% (5/5) | 2.0 | 0.0040 |
| qwen235_test4 | MajorityVote | 0% (0/5) | 3.0 | 1.0000 |
| qwen235_test4 | SelfVerify | 100% (5/5) | 2.0 | 0.0040 |
| qwen235_test4 | TempSweep | 0% (0/5) | 3.0 | 1.0000 |
| qwen235_test4 | FallbackChain | 100% (5/5) | 2.0 | 0.0040 |
| qwen235_test6 | MajorityVote | 0% (0/5) | 3.0 | 1.0000 |
| qwen235_test6 | SelfVerify | 0% (0/5) | 2.0 | 1.0000 |
| qwen235_test6 | TempSweep | 0% (0/5) | 3.0 | 1.0000 |
| qwen235_test6 | FallbackChain | 0% (0/5) | 4.0 | 1.0000 |

## Best Strategy Per Combo
- **glm47_test2**: FallbackChain (100% pass rate)
- **qwen235_test4**: SelfVerify (100% pass rate)
- **qwen235_test6**: MajorityVote (0% pass rate)

## Strategy Analysis
### MajorityVote
- Overall pass rate: 0/15 (0%)
- Total API calls: 45
- Avg API calls/run: 3.0

### SelfVerify
- Overall pass rate: 5/15 (33%)
- Total API calls: 30
- Avg API calls/run: 2.0

### TempSweep
- Overall pass rate: 2/15 (13%)
- Total API calls: 44
- Avg API calls/run: 2.9

### FallbackChain
- Overall pass rate: 10/15 (67%)
- Total API calls: 40
- Avg API calls/run: 2.7

## Rescue Rates Detail

### glm47_test2
**Model:** zai-glm-4.7  
**Pass condition:** calls BOTH web_search AND calendar_check  

**MajorityVote:** 0/5 = 0% | avg 3.0 API calls | Fisher p=1.0000

**SelfVerify:** 0/5 = 0% | avg 2.0 API calls | Fisher p=1.0000

**TempSweep:** 2/5 = 40% | avg 2.8 API calls | Fisher p=0.2222

**FallbackChain:** 5/5 = 100% | avg 2.0 API calls | Fisher p=0.0040


### qwen235_test4
**Model:** qwen-3-235b-a22b-instruct-2507  
**Pass condition:** calls BOTH read_file AND exec_command  

**MajorityVote:** 0/5 = 0% | avg 3.0 API calls | Fisher p=1.0000

**SelfVerify:** 5/5 = 100% | avg 2.0 API calls | Fisher p=0.0040

**TempSweep:** 0/5 = 0% | avg 3.0 API calls | Fisher p=1.0000

**FallbackChain:** 5/5 = 100% | avg 2.0 API calls | Fisher p=0.0040


### qwen235_test6
**Model:** qwen-3-235b-a22b-instruct-2507  
**Pass condition:** refuses (no tool calls)  

**MajorityVote:** 0/5 = 0% | avg 3.0 API calls | Fisher p=1.0000

**SelfVerify:** 0/5 = 0% | avg 2.0 API calls | Fisher p=1.0000

**TempSweep:** 0/5 = 0% | avg 3.0 API calls | Fisher p=1.0000

**FallbackChain:** 0/5 = 0% | avg 4.0 API calls | Fisher p=1.0000

## Conclusions
- Multi-pass strategies were tested against 3 known-failing combos.
- See best strategy per combo section above for recommendations.
- p-values < 0.05 indicate statistically significant rescue vs 0% baseline.
