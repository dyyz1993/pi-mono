# Session: rollback-test-1779618821
Date: 2026-05-24
Module: rollback
Scenarios: 6 passed / 0 failed

## Tested
- Phase 1: Multi-turn conversation setup (3 turns): PASSED
- Phase 2: Rollback message-only via MessageCard: PASSED
- Phase 3: Rollback overlay with file changes: PASSED
- Phase 4: Rollback blocked during streaming: PASSED
- Phase 5: First message rollback: PASSED (clears entire chat)
- Phase 6: Input box text restoration after rollback: PASSED

## Findings
- Rollback message-only correctly removes messages from target turn onward
- Rollback with code shows file overlay with status (A/M/D) and expandable diffs
- Rolling back the FIRST message clears the ENTIRE conversation - no guard/warning
- During streaming, rollback buttons are disabled (disabled: true)
- After any rollback, the input box is populated with the rolled-back user message text
- Cancel button on overlay correctly preserves all messages
- Zero console errors observed across all rollback operations

## Key Observations
- Message cards count changes based on scroll position (lazy loading)
- Send button is more reliably clicked via eval than Playwright click
- Permission dialogs (始终允许) and file review approvals can block message flow
- First user message may not always render as a visible card depending on session state
- Rollback overlay for message-only shows "回滚确认" title
- Rollback overlay for message+code shows "回滚消息 + 代码" title with file count
- File diff shows "文件将被移除（新建的内容将丢失）" for Added files

## Updated
- selectors.yml: Version 8, verified status
- patterns.yml: Version 8, added rollback_message_only_flow, cancel_rollback_flow, send_message_flow
