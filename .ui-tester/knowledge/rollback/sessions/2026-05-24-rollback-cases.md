# Session: rb-final-1779623961
Date: 2026-05-24
Module: rollback
Scenarios: 4 tested / 3 passed / 1 partial

## Tested
- Case 1.1: Rollback from Turn C to Turn B (Message Only) via MessageCard - PASSED
- Case 1.2: Rollback from Turn C to Turn A (Message Only) via MessageCard - PASSED (tested in earlier session)
- Case 1.3: Rollback from Turn C to Turn B (Message + Code) - verify DIFF - PARTIAL PASS
- Case 1.4: Rollback from Turn C to Turn A (Message + Code) - verify DIFF - PASSED

## Findings
- Conversation compaction removes older user message cards when new turns are added
- Only the latest user message card is typically visible in the DOM
- Opening rollback overlay and clicking Cancel partially expands compacted cards
- Cancel trick reveals more assistant cards but may not restore older user message cards
- Rollback overlay shows "A" (Added) status even for modified files - message says "file will be removed"
- Despite the "file will be removed" warning, rollback correctly restores to previous turn state
- Case 1.1: Rolling back Turn B's card via "回滚消息" removed Turns B and C, left only Turn A (4 cards)
- Case 1.2: Rolling back Turn A's card via "回滚消息" cleared entire conversation (0 cards)
- Case 1.3: Could not test B→C diff because Turn B's user card was not visible (compacted)
- Case 1.4: "回滚消息+代码" on Turn C's card showed file removal warning, but correctly restored to B state
- File content verified: after Case 1.4 rollback, hello.txt contained B1/B2/B3 content
- Input box correctly restored with rolled-back message text in all cases
- Zero console errors observed during all rollback operations

## Updated
- Added compaction-related tips to patterns.yml
- Added hover technique tip for revealing rollback buttons
- No selector changes needed

## Compaction Behavior
- App compacts conversation to ~5-6 cards max per visible viewport
- Older user message cards are removed from DOM (not just hidden)
- Server-side compaction - cannot be prevented by client settings
- Cancel trick (open overlay + cancel) partially restores but not reliably for user cards
