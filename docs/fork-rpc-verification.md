# Fork RPC 验证报告

## 日期: 2026-04-28

## 改动文件

### pi-momo-fork (后端)
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts` — fork case: 先 appendSessionInfo 再 rebindSession, 返回 newSessionFile/newSessionId, flush() 强制写盘
- `packages/coding-agent/src/modes/rpc/rpc-client.ts` — fork() 返回类型加 newSessionFile? newSessionId?
- `packages/coding-agent/src/core/session-manager.ts` — 新增 flush() public 方法

### pi-agent-chat (前端)
- `src/shared/modules/agent.ts` — agent.fork result 类型加 newSessionFile? newSessionId?
- `src/mainview/components/chat/MessageCard.tsx` — handleFork 加 loadSessionsForProject + setActiveSession + loadSessionMessages

## RPC 验证结果

### 无扩展测试
```
Session name after R1: say hello and nothing else
Session name after R2: say hello and nothing else
Fork result: {"text":"say hello and nothing else","cancelled":false}
Session name AFTER fork: fork: say hello and nothing else
```

### 带 auto-session-title 扩展测试
```
session_rename events: 3
  "undefined" → "Simple Hello Command"
  "Simple Hello Command" → "say hello and nothing else"
  "say hello and nothing else" → "fork: say hello and nothing else"
✅ PASS
```

### 带 newSessionFile/newSessionId 返回
```json
{
  "text": "say hello and nothing else",
  "cancelled": false,
  "newSessionFile": "~/.pi/agent/sessions/.../2026-04-28T04-14-41-401Z_xxx.jsonl",
  "newSessionId": "019dd24b-e0f9-7065-840a-d20cc02c2a76"
}
File exists: true
session_info.name = "fork: say hello and nothing else"
```

### RPC 事件范本 (完整事件类型)
```
extension_ui_request, message_start, message_end, agent_start,
turn_start, message_update, turn_end, session_rename, agent_end,
auto_retry_start, extension_error
```

### session_rename 时序
```
"undefined" → "Simple Hello Command"     (auto-session-title 生成)
"Simple Hello Command" → "say hello..."  (被覆盖)
"say hello..." → "fork: say hello..."    (fork 命名)
```

## RPC 测试脚本
```bash
node /tmp/test-fork-final.mjs
```

## UI 层已知问题 (待后续修复)

### 1. resolveEntryId 位置匹配偏移
- Tree 含 model_change/thinking_level_change/custom_message 等非 message entries
- 前端用 `assistantMsgIdx` 按 message 列表位置匹配 tree entries，位置偏移
- 导致传给 fork 的 entryId 对应的 entry 不是 user message → "Invalid entry ID for forking"

### 2. session 切换后事件订阅
- fork 后 session ID 变了, 但 agent.event 订阅仍绑定旧 sessionId
- session_rename 事件无法匹配到新 session
- 已通过 loadSessionsForProject (磁盘扫描) 绕过, 但需要实际验证 UI 效果
