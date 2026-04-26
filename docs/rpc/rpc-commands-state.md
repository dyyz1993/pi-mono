# RPC 命令 - 状态与消息

> 本文档详细描述 RPC 协议中的状态查询和消息获取命令。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

## `get_state` - 获取当前会话状态

```json
{"id": "req_6", "type": "get_state"}
```

**响应**：
```json
{
  "id": "req_6",
  "type": "response",
  "command": "get_state",
  "success": true,
  "data": {
    "model": {
      "id": "claude-sonnet-4-5-20250929",
      "name": "Claude Sonnet 4.5",
      "api": "anthropic",
      "provider": "anthropic",
      "baseUrl": "",
      "reasoning": true,
      "input": ["text", "image"],
      "cost": { "input": 3.0, "output": 15.0, "cacheRead": 0.3, "cacheWrite": 3.75 },
      "contextWindow": 200000,
      "maxTokens": 8192
    },
    "thinkingLevel": "medium",
    "isStreaming": false,
    "isCompacting": false,
    "steeringMode": "one-at-a-time",
    "followUpMode": "one-at-a-time",
    "sessionFile": "/Users/x/.pi/agent/sessions/--path-to-project--/2025-01-20T10-30-00-000_uuid.jsonl",
    "sessionId": "0194abc2-def0-7xyz-b123-456789abcdef",
    "sessionName": "My Session",
    "autoCompactionEnabled": true,
    "messageCount": 12,
    "pendingMessageCount": 0
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | Model \| undefined | 当前使用的模型 |
| `thinkingLevel` | ThinkingLevel | 当前思考级别 |
| `isStreaming` | boolean | 是否正在流式输出 |
| `isCompacting` | boolean | 是否正在压缩上下文 |
| `steeringMode` | "all" \| "one-at-a-time" | steering 排队模式 |
| `followUpMode` | "all" \| "one-at-a-time" | followUp 排队模式 |
| `sessionFile` | string \| undefined | 会话文件路径 |
| `sessionId` | string | 会话唯一 ID |
| `sessionName` | string \| undefined | 会话显示名称 |
| `autoCompactionEnabled` | boolean | 自动压缩开关 |
| `messageCount` | number | 当前消息数 |
| `pendingMessageCount` | number | 排队消息数 |

---

## `get_messages` - 获取所有消息

```json
{"id": "req_28", "type": "get_messages"}
```

**响应**：
```json
{
  "id": "req_28",
  "type": "response",
  "command": "get_messages",
  "success": true,
  "data": {
    "messages": [
      {"role": "user", "content": [{"type": "text", "text": "hello"}], "timestamp": 1706000000000},
      {"role": "assistant", "content": [{"type": "text", "text": "Hi there!"}], "provider": "anthropic", "model": "claude-sonnet-4-5-20250929", "usage": {...}, "stopReason": "stop", "timestamp": 1706000001000},
      {"role": "toolResult", "toolCallId": "tc_001", "content": [{"type": "text", "text": "file contents..."}], "timestamp": 1706000002000}
    ]
  }
}
```

---
