---

# RPC 命令 - 压缩、重试、Bash 与会话管理

> 本文档详细描述 RPC 协议中的压缩、重试、Bash 执行和会话管理命令。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

## 压缩（Compaction）

### `compact` - 手动压缩上下文

```json
{"id": "req_14", "type": "compact"}
```

带自定义指令：
```json
{"id": "req_14", "type": "compact", "customInstructions": "保留所有代码相关的讨论"}
```

**响应**：
```json
{
  "id": "req_14",
  "type": "response",
  "command": "compact",
  "success": true,
  "data": {
    "summary": "会话讨论了...",
    "tokensBefore": 85000,
    "tokensAfter": 12000,
    "messagesKept": 8,
    "messagesCompacted": 25
  }
}
```

> CompactionResult 的精确字段请参考源码 `compaction.ts`。

---

### `set_auto_compaction` - 开关自动压缩

```json
{"id": "req_15", "type": "set_auto_compaction", "enabled": true}
```

**响应**：
```json
{"id": "req_15", "type": "response", "command": "set_auto_compaction", "success": true}
```

---

## 重试（Retry）

### `set_auto_retry` - 开关自动重试

```json
{"id": "req_16", "type": "set_auto_retry", "enabled": true}
```

### `abort_retry` - 中止重试

```json
{"id": "req_17", "type": "abort_retry"}
```

---

## Bash 执行

### `bash` - 执行 bash 命令

```json
{"id": "req_18", "type": "bash", "command": "ls -la src/"}
```

**响应**：
```json
{
  "id": "req_18",
  "type": "response",
  "command": "bash",
  "success": true,
  "data": {
    "stdout": "total 24\ndrwxr-xr-x  5 user  staff  160 Jan 20 10:00 .\n...",
    "stderr": "",
    "exitCode": 0,
    "signal": null,
    "timedOut": false
  }
}
```

> BashResult 的精确字段请参考源码 `bash-executor.ts`。

---

### `abort_bash` - 中止 bash 命令

```json
{"id": "req_19", "type": "abort_bash"}
```

---

## 会话管理（Session）

### `get_session_stats` - 获取会话统计

```json
{"id": "req_20", "type": "get_session_stats"}
```

**响应**：
```json
{
  "id": "req_20",
  "type": "response",
  "command": "get_session_stats",
  "success": true,
  "data": {
    "sessionFile": "/Users/x/.pi/agent/sessions/--path--/session.jsonl",
    "sessionId": "uuid-here",
    "userMessages": 5,
    "assistantMessages": 5,
    "toolCalls": 12,
    "toolResults": 12,
    "totalMessages": 22,
    "tokens": {
      "input": 15000,
      "output": 8000,
      "cacheRead": 5000,
      "cacheWrite": 2000,
      "total": 30000
    },
    "cost": 0.125
  }
}
```

---

### `export_html` - 导出为 HTML

```json
{"id": "req_21", "type": "export_html"}
```

指定输出路径：
```json
{"id": "req_21", "type": "export_html", "outputPath": "/tmp/session.html"}
```

**响应**：
```json
{"id": "req_21", "type": "response", "command": "export_html", "success": true, "data": {"path": "/tmp/session.html"}}
```

---

### `switch_session` - 切换到指定会话

```json
{"id": "req_22", "type": "switch_session", "sessionPath": "/Users/x/.pi/agent/sessions/--path--/other-session.jsonl"}
```

**响应**：
```json
{"id": "req_22", "type": "response", "command": "switch_session", "success": true, "data": {"cancelled": false}}
```

> 切换后需要重新订阅事件（RPC 模式内部自动 rebind）。

---

### `fork` - 从指定消息分叉

```json
{"id": "req_23", "type": "fork", "entryId": "abc12345"}
```

**响应**：
```json
{"id": "req_23", "type": "response", "command": "fork", "success": true, "data": {"text": "原始消息文本", "cancelled": false}}
```

---

### `clone` - 克隆当前分支为新会话

```json
{"id": "req_24", "type": "clone"}
```

**响应**：
```json
{"id": "req_24", "type": "response", "command": "clone", "success": true, "data": {"cancelled": false}}
```

---

### `get_fork_messages` - 获取可分叉的消息列表

```json
{"id": "req_25", "type": "get_fork_messages"}
```

**响应**：
```json
{
  "id": "req_25",
  "type": "response",
  "command": "get_fork_messages",
  "success": true,
  "data": {
    "messages": [
      {"entryId": "abc12345", "text": "帮我写一个 hello world"},
      {"entryId": "def67890", "text": "再帮我加个测试"}
    ]
  }
}
```

---

### `get_last_assistant_text` - 获取最后一条 assistant 消息文本

```json
{"id": "req_26", "type": "get_last_assistant_text"}
```

**响应**：
```json
{"id": "req_26", "type": "response", "command": "get_last_assistant_text", "success": true, "data": {"text": "好的，这是你的 hello world 代码..."}}
```

无 assistant 消息时 `text: null`。

---

### `set_session_name` - 设置会话名称

```json
{"id": "req_27", "type": "set_session_name", "name": "项目重构讨论"}
```

**响应**：
```json
{"id": "req_27", "type": "response", "command": "set_session_name", "success": true}
```

**错误**：
```json
{"id": "req_27", "type": "response", "command": "set_session_name", "success": false, "error": "Session name cannot be empty"}
```

---
