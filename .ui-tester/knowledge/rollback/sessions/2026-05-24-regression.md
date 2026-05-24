# Session: rollback-regression-2026-05-24
Date: 2026-05-24
Module: rollback
Scenarios: 1 passed / 2 REGRESSION (fixes not working)

## Tested
- FIX 1 (BUG-1): First message rollback guard: **REGRESSION** - Guard not working
  - Clicking "回滚消息" on first message OPENS overlay instead of showing notification
  - No notification/toast appeared
  - Overlay shows standard confirmation dialog
- FIX 1 Step 3: Second message rollback still works: **PASS**
  - Turn B removed correctly, 2 cards remain
- FIX 2 (BUG-3): Deleted file diff in rollback overlay: **REGRESSION** - Not showing diff
  - Delete turn rollback shows file as "A" (Added) with "文件将被移除" text
  - Modify turn rollback also shows "A" status with no diff content
  - No line-by-line diff (+/- markers) when expanding file entry
- Console errors: **NONE** detected

## Findings
- FIX 1 (first message guard) is NOT deployed or NOT working
- FIX 2 (deleted file diff) is NOT deployed or NOT working
- Compaction still aggressively removes older user message cards from DOM
- Scrolling container to top reveals compacted cards
- Permission dialogs (始终允许) may block rollback operations until approved
- Session stability: browser may navigate to about:blank if token not pre-set in localStorage

## Updated
- Updated patterns.yml to version 9 with regression findings
- Added session log for 2026-05-24 regression test
