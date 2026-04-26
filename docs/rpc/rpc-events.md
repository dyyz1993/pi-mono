# RPC 响应与流式事件

> 本文档详细描述 RPC 协议中的响应格式和流式事件类型。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

## 响应格式

所有响应共享以下结构：

```typescript
interface RpcResponseBase {
  id?: string;        // 对应请求的 id
  type: "response";   // 固定值
  command: string;    // 对应的命令类型
  success: boolean;   // 是否成功
}
```

### 成功响应

```json
{"id": "req_1", "type": "response", "command": "prompt", "success": true}
{"id": "req_6", "type": "response", "command": "get_state", "success": true, "data": {...}}
```

### 错误响应（任何命令都可能返回）

```json
{"id": "req_1", "type": "response", "command": "prompt", "success": false, "error": "No API key found for anthropic"}
```

### 完整响应类型映射

| command | data 类型 | 说明 |
|---------|-----------|------|
| `prompt` | 无 | 异步，成功后事件流跟踪 |
| `steer` | 无 | |
| `follow_up` | 无 | |
| `abort` | 无 | |
| `new_session` | `{ cancelled: boolean }` | |
| `get_state` | `RpcSessionState` | 见 [rpc-commands-state.md](rpc-commands-state.md) |
| `set_model` | `Model` | |
| `cycle_model` | `{ model, thinkingLevel, isScoped } \| null` | |
| `get_available_models` | `{ models: Model[] }` | |
| `set_thinking_level` | 无 | |
| `cycle_thinking_level` | `{ level } \| null` | |
| `set_steering_mode` | 无 | |
| `set_follow_up_mode` | 无 | |
| `compact` | `CompactionResult` | |
| `set_auto_compaction` | 无 | |
| `set_auto_retry` | 无 | |
| `abort_retry` | 无 | |
| `bash` | `BashResult` | |
| `abort_bash` | 无 | |
| `get_session_stats` | `SessionStats` | |
| `export_html` | `{ path: string }` | |
| `switch_session` | `{ cancelled: boolean }` | |
| `fork` | `{ text: string, cancelled: boolean }` | |
| `clone` | `{ cancelled: boolean }` | |
| `get_fork_messages` | `{ messages: Array<{entryId, text}> }` | |
| `get_last_assistant_text` | `{ text: string \| null }` | |
| `set_session_name` | 无 | |
| `get_messages` | `{ messages: AgentMessage[] }` | |
| `get_skills` | `{ skills: RpcSkill[] }` | 见 [rpc-commands-resources.md](rpc-commands-resources.md) |
| `get_extensions` | `{ extensions: RpcExtension[] }` | |
| `get_tools` | `{ tools: RpcTool[] }` | |
| `get_commands` | `{ commands: RpcSlashCommand[] }` | |

---

## 流式事件（agent → stdout）

这些事件 **不对应任何命令**，是 agent 运行时自动推送的。RPC 模式将 `AgentSessionEvent` 直接序列化输出。

### Agent 生命周期事件（来自 `@dyyz1993/pi-agent-core`）

#### `agent_start` - Agent 开始处理

```json
{"type": "agent_start"}
```

#### `agent_end` - Agent 处理完成

```json
{"type": "agent_end", "messages": [...]}
```

- `messages`: 本次运行产生的所有消息数组

#### `turn_start` - 一个 turn 开始（assistant 响应 + 工具调用）

```json
{"type": "turn_start"}
```

#### `turn_end` - 一个 turn 结束

```json
{"type": "turn_end", "message": {...}, "toolResults": [...]}
```

- `message`: 最终的 assistant 消息
- `toolResults`: 本 turn 的工具结果消息数组

---

### 消息生命周期事件

#### `message_start` - 消息开始

```json
{
  "type": "message_start",
  "message": {
    "role": "user",
    "content": [{"type": "text", "text": "hello"}],
    "timestamp": 1706000000000
  }
}
```

role 可能值：`"user"` | `"assistant"` | `"toolResult"` | `"custom"`

#### `message_update` - 消息流式更新（仅 assistant 消息）

```json
{
  "type": "message_update",
  "message": {
    "role": "assistant",
    "content": [
      {"type": "text", "text": "部分响应文本..."},
      {"type": "thinking", "thinking": "让我思考一下..."},
      {"type": "toolCall", "id": "tc_001", "name": "bash", "input": "{\"command\":\"ls\"}"}
    ],
    "provider": "anthropic",
    "model": "claude-sonnet-4-5-20250929",
    "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}},
    "stopReason": null,
    "timestamp": 1706000001000
  },
  "assistantMessageEvent": {
    "type": "content_block_start",
    "index": 0,
    "contentBlock": {"type": "text", "text": ""}
  }
}
```

- `assistantMessageEvent`: 来自 LLM provider 的底层流式事件

#### `message_end` - 消息完成

```json
{
  "type": "message_end",
  "message": {
    "role": "assistant",
    "content": [
      {"type": "text", "text": "完整的响应文本"},
      {"type": "toolCall", "id": "tc_001", "name": "bash", "input": "{\"command\":\"ls\"}"}
    ],
    "provider": "anthropic",
    "model": "claude-sonnet-4-5-20250929",
    "usage": {"input": 5000, "output": 2000, "cacheRead": 3000, "cacheWrite": 0, "totalTokens": 10000, "cost": {"input": 0.015, "output": 0.03, "cacheRead": 0.0009, "cacheWrite": 0, "total": 0.0459}},
    "stopReason": "tool_use",
    "timestamp": 1706000002000
  }
}
```

---

### 工具执行事件

#### `tool_execution_start` - 工具开始执行

```json
{"type": "tool_execution_start", "toolCallId": "tc_001", "toolName": "bash", "args": {"command": "ls -la"}}
```

#### `tool_execution_update` - 工具执行中间更新

```json
{"type": "tool_execution_update", "toolCallId": "tc_001", "toolName": "bash", "args": {"command": "ls -la"}, "partialResult": {"content": [{"type": "text", "text": "partial output..."}], "details": null}}
```

#### `tool_execution_end` - 工具执行完成

```json
{
  "type": "tool_execution_end",
  "toolCallId": "tc_001",
  "toolName": "bash",
  "result": {
    "content": [{"type": "text", "text": "total 24\ndrwxr-xr-x  5 user ..."}],
    "details": {"stdout": "total 24...", "stderr": "", "exitCode": 0}
  },
  "isError": false
}
```

---

### AgentSession 扩展事件（来自 `coding-agent` 层）

这些事件在 `agent_start` / `agent_end` 之外额外发送：

#### `queue_update` - 排队消息变化

```json
{"type": "queue_update", "steering": ["消息1"], "followUp": ["消息2", "消息3"]}
```

#### `compaction_start` - 压缩开始

```json
{"type": "compaction_start", "reason": "threshold"}
```

`reason` 可选值：`"manual"` | `"threshold"` | `"overflow"`

#### `compaction_end` - 压缩完成

```json
{
  "type": "compaction_end",
  "reason": "threshold",
  "result": {
    "summary": "压缩摘要...",
    "tokensBefore": 85000,
    "tokensAfter": 12000
  },
  "aborted": false,
  "willRetry": false
}
```

#### `auto_retry_start` - 自动重试开始

```json
{"type": "auto_retry_start", "attempt": 1, "maxAttempts": 3, "delayMs": 2000, "errorMessage": "Server overloaded"}
```

#### `auto_retry_end` - 自动重试结束

```json
{"type": "auto_retry_end", "success": true, "attempt": 1}
```

---

### 完整事件流时序示例

用户发送 `prompt` 后的完整事件流：

```
→ stdin:  {"id":"req_1", "type":"prompt", "message":"帮我列出 src 目录"}
← stdout: {"id":"req_1", "type":"response", "command":"prompt", "success":true}

← stdout: {"type":"agent_start"}
← stdout: {"type":"turn_start"}
← stdout: {"type":"message_start", "message":{"role":"user","content":[...]}}
← stdout: {"type":"message_end", "message":{"role":"user","content":[...]}}

← stdout: {"type":"message_start", "message":{"role":"assistant","content":[...]}}
← stdout: {"type":"message_update", "message":{...}}  (多次，流式文本)
← stdout: {"type":"message_update", "message":{...}}  (包含 toolCall)
← stdout: {"type":"message_end", "message":{"role":"assistant","stopReason":"tool_use",...}}

← stdout: {"type":"tool_execution_start", "toolCallId":"tc_001", "toolName":"bash", "args":{"command":"ls src/"}}
← stdout: {"type":"tool_execution_end", "toolCallId":"tc_001", "toolName":"bash", "result":{...}, "isError":false}

← stdout: {"type":"message_start", "message":{"role":"toolResult",...}}
← stdout: {"type":"message_end", "message":{"role":"toolResult",...}}

← stdout: {"type":"turn_end", "message":{...}, "toolResults":[...]}

← stdout: {"type":"turn_start"}  (第二轮：assistant 拿到工具结果后继续)
← stdout: {"type":"message_start", "message":{"role":"assistant",...}}
← stdout: {"type":"message_update", "message":{...}}
← stdout: {"type":"message_end", "message":{"role":"assistant","stopReason":"stop",...}}
← stdout: {"type":"turn_end", "message":{...}, "toolResults":[]}

← stdout: {"type":"agent_end", "messages":[...]}
```

---
