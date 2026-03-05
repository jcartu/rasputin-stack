# ALFIE Nexus Dashboard Layout Fix

## Issues Fixed:

1. **Layout consolidated to ONE SCREEN (6 rows instead of 9)**
   - Removed redundant "GPU PERFORMANCE" gauges panel
   - Removed redundant "SYSTEM METRICS" panel (data is in TOP panel)
   - Everything fits in viewport with proper sizing

2. **Ecosystem "Loading ecosystem..." never removed**
   - Fixed: Empty label is now removed when first data arrives

3. **NVTOP/TOP panels cut off at bottom**
   - Moved to rows 5-6 (were 7-9)
   - Now visible on screen

4. **Smart responsive sizing**
   - All bento-cards use `min-height: 0` and `overflow: hidden/auto`
   - Stream scroll uses `flex: 1; overflow-y: auto`
   - Charts and graphs fill their containers properly

5. **Layout grid uses fr units**
   - Grid height = `calc(100vh - 60px - 70px)` (minus header + voice bar)
   - Rows use fractional units to stretch and fill

## New Layout Structure:

```
ROWS 1-3: Neural Stream (left 7col) | GPU Status (right 5col, row 1)
                                     | Sub-Agents (right 5col, row 2)  
                                     | Second Brain (right 5col, row 3)
ROW 4:    Cost (left 4col)          | Ecosystem (mid 4col)  | GPU Chart (right 4col)
ROWS 5-6: NVTOP (left 6col)         | TOP (right 6col)
```

Total: 6 rows, everything fits on one screen without scrolling.
