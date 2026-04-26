# Pi Coding Agent - RPC Protocol Reference

> 本文档描述 pi coding agent 的 RPC 协议，用于构建 WebUI Server 对接。
> 协议基于 JSONL (JSON Lines)，通过 stdin/stdout 通信。

---

## 目录

- [1. 概述](#1-概述)
- [2. 协议格式](#2-协议格式)
- [3. 启动方式](#3-启动方式)
- [4. RPC 命令完整列表（stdin → agent）](#4-rpc-命令完整列表stdin--agent)
- [5. RPC 响应完整列表（agent → stdout）](#5-rpc-响应完整列表agent--stdout)
- [6. 流式事件（agent → stdout）](#6-流式事件agent--stdout)
- [7. Extension UI 交互协议](#7-extension-ui-交互协议)
- [8. SessionManager 静态 API（非 RPC，Server 层直接调用）](#8-sessionmanager-静态-api非-rpcserver-层直接调用)
- [9. 会话文件格式 (.jsonl)](#9-会话文件格式-jsonl)
- [10. 历史数据 vs 实时事件：数据结构差异与拼接方案](#10-历史数据-vs-实时事件数据结构差异与拼接方案)
- [11. WebUI 事件展示优先级](#11-webui-事件展示优先级)
- [12. 源码文件索引](#12-源码文件索引)

---

## 1. 概述

pi coding agent 支持通过 **RPC 模式** 进行无头（headless）运行。外部应用通过 JSONL 协议与 agent 交互：

```
WebUI <--WebSocket--> Server <--JSONL stdin/stdout--> pi --mode rpc
```

**数据流：**
- **输入（stdin）**：RPC 命令 + Extension UI 响应
- **输出（stdout）**：RPC 响应 + 流式事件 + Extension UI 请求
- **每条消息**：单行 JSON，以 `\n` 结尾（严格 LF 分割，不使用 readline）

---

## 2. 协议格式

### 输入格式（stdin）

```json
{"id": "req_1", "type": "prompt", "message": "hello"}
```

- `id`: 可选，用于请求-响应关联。建议格式 `req_<递增数字>`
- `type`: 命令类型（必填）

### 输出格式（stdout）

三种类型的消息：

1. **响应**（对应命令的回复）：
```json
{"id": "req_1", "type": "response", "command": "prompt", "success": true}
```

2. **流式事件**（agent 运行时实时推送）：
```json
{"type": "message_start", "message": {...}}
```

3. **Extension UI 请求**（需要客户端交互）：
```json
{"type": "extension_ui_request", "id": "uuid", "method": "confirm", "title": "...", "message": "..."}
```

---

## 3. 启动方式

```bash
# 基础启动
node dist/cli.js --mode rpc

# 指定工作目录
node dist/cli.js --mode rpc --cwd /path/to/project

# 指定 provider 和 model
node dist/cli.js --mode rpc --provider anthropic --model claude-sonnet-4-5-20250929

# 通过 RpcClient（TypeScript API）
```

**RpcClient 方式**（推荐用于 Node.js Server）：
```typescript
import { RpcClient } from "@dyyz1993/pi-coding-agent/modes/rpc/rpc-client";

const client = new RpcClient({
  cliPath: "dist/cli.js",
  cwd: "/path/to/project",
  provider: "anthropic",
  model: "claude-sonnet-4-5-20250929",
  env: { ANTHROPIC_API_KEY: "sk-..." },
});

await client.start();

// 订阅事件
client.onEvent((event) => {
  console.log("Event:", event.type);
});

// 发送命令
await client.prompt("hello");
await client.waitForIdle();
```

---

## 4. RPC 命令完整列表（stdin → agent）

### 4.1 对话（Prompting）

#### `prompt` - 发送消息

```json
{"id": "req_1", "type": "prompt", "message": "帮我写一个 hello world"}
```

带图片：
```json
{
  "id": "req_1",
  "type": "prompt",
  "message": "分析这张图片",
  "images": [
    {
      "type": "image",
      "image": "data:image/png;base64,iVBOR...",
      "mediaType": "image/png"
    }
  ],
  "streamingBehavior": "steer"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 否 | 请求关联 ID |
| `type` | "prompt" | 是 | 命令类型 |
| `message` | string | 是 | 用户消息文本 |
| `images` | ImageContent[] | 否 | 图片附件 |
| `streamingBehavior` | "steer" \| "followUp" | 否 | 当 agent 正在流式输出时，如何排队此消息 |

**响应**（异步，preflight 成功后才发）：
```json
{"id": "req_1", "type": "response", "command": "prompt", "success": true}
```
```json
{"id": "req_1", "type": "response", "command": "prompt", "success": false, "error": "No API key found for anthropic"}
```

> 注意：prompt 是异步命令，成功响应仅表示 preflight 通过。实际消息处理通过流式事件跟踪。

---

#### `steer` - 流式中断注入

在 agent 运行时注入消息，当前 assistant turn 完成工具调用后、下一次 LLM 调用前发送。

```json
{"id": "req_2", "type": "steer", "message": "等等，先不要改那个文件"}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | 是 | 注入消息文本 |
| `images` | ImageContent[] | 否 | 图片附件 |

**响应**：
```json
{"id": "req_2", "type": "response", "command": "steer", "success": true}
```

---

#### `follow_up` - 追加排队消息

在 agent 完成当前所有工作后追加处理。

```json
{"id": "req_3", "type": "follow_up", "message": "接下来帮我测试一下"}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | 是 | 追加消息文本 |
| `images` | ImageContent[] | 否 | 图片附件 |

**响应**：
```json
{"id": "req_3", "type": "response", "command": "follow_up", "success": true}
```

---

#### `abort` - 中断当前操作

```json
{"id": "req_4", "type": "abort"}
```

**响应**：
```json
{"id": "req_4", "type": "response", "command": "abort", "success": true}
```

---

#### `new_session` - 新建会话

```json
{"id": "req_5", "type": "new_session"}
```

带父会话关联：
```json
{"id": "req_5", "type": "new_session", "parentSession": "/path/to/parent.jsonl"}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `parentSession` | string | 否 | 父会话文件路径（用于 lineage 追踪） |

**响应**：
```json
{"id": "req_5", "type": "response", "command": "new_session", "success": true, "data": {"cancelled": false}}
```

> `cancelled: true` 表示扩展拦截了新建操作。

---

### 4.2 状态（State）

#### `get_state` - 获取当前会话状态

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

### 4.3 模型（Model）

#### `set_model` - 切换模型

```json
{"id": "req_7", "type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-5-20250929"}
```

**响应**：
```json
{
  "id": "req_7",
  "type": "response",
  "command": "set_model",
  "success": true,
  "data": {
    "id": "claude-sonnet-4-5-20250929",
    "name": "Claude Sonnet 4.5",
    "api": "anthropic",
    "provider": "anthropic",
    "reasoning": true,
    "contextWindow": 200000,
    "maxTokens": 8192
  }
}
```

**错误响应**：
```json
{"id": "req_7", "type": "response", "command": "set_model", "success": false, "error": "Model not found: anthropic/unknown-model"}
```

---

#### `cycle_model` - 循环切换下一个模型

```json
{"id": "req_8", "type": "cycle_model"}
```

**响应**：
```json
{
  "id": "req_8",
  "type": "response",
  "command": "cycle_model",
  "success": true,
  "data": {
    "model": { "id": "gpt-4o", "provider": "openai", "reasoning": false, "contextWindow": 128000, "maxTokens": 16384 },
    "thinkingLevel": "off",
    "isScoped": false
  }
}
```

无可用模型时 `data: null`。`isScoped: true` 表示使用 `--models` 限定的模型列表。

---

#### `get_available_models` - 获取可用模型列表

```json
{"id": "req_9", "type": "get_available_models"}
```

**响应**：
```json
{
  "id": "req_9",
  "type": "response",
  "command": "get_available_models",
  "success": true,
  "data": {
    "models": [
      {
        "id": "claude-sonnet-4-5-20250929",
        "name": "Claude Sonnet 4.5",
        "api": "anthropic",
        "provider": "anthropic",
        "reasoning": true,
        "input": ["text", "image"],
        "cost": { "input": 3.0, "output": 15.0, "cacheRead": 0.3, "cacheWrite": 3.75 },
        "contextWindow": 200000,
        "maxTokens": 8192
      },
      {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "api": "openai",
        "provider": "openai",
        "reasoning": false,
        "input": ["text", "image"],
        "cost": { "input": 2.5, "output": 10.0, "cacheRead": 1.25, "cacheWrite": 0 },
        "contextWindow": 128000,
        "maxTokens": 16384
      }
    ]
  }
}
```

---

### 4.4 思考模式（Thinking）

#### `set_thinking_level` - 设置思考级别

```json
{"id": "req_10", "type": "set_thinking_level", "level": "high"}
```

可选值：`"off"` | `"minimal"` | `"low"` | `"medium"` | `"high"` | `"xhigh"`

> 注意：`"xhigh"` 仅 OpenAI 特定模型支持。超出模型能力的级别会被自动钳制（clamp）。

**响应**：
```json
{"id": "req_10", "type": "response", "command": "set_thinking_level", "success": true}
```

---

#### `cycle_thinking_level` - 循环切换思考级别

```json
{"id": "req_11", "type": "cycle_thinking_level"}
```

**响应**：
```json
{"id": "req_11", "type": "response", "command": "cycle_thinking_level", "success": true, "data": {"level": "high"}}
```

---

### 4.5 排队模式（Queue Modes）

#### `set_steering_mode` - 设置 steering 排队模式

```json
{"id": "req_12", "type": "set_steering_mode", "mode": "all"}
```

- `"all"`: 一次性取出所有排队消息
- `"one-at-a-time"`: 每次只取一条（默认）

**响应**：
```json
{"id": "req_12", "type": "response", "command": "set_steering_mode", "success": true}
```

---

#### `set_follow_up_mode` - 设置 followUp 排队模式

```json
{"id": "req_13", "type": "set_follow_up_mode", "mode": "all"}
```

同上。

---

### 4.6 压缩（Compaction）

#### `compact` - 手动压缩上下文

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

#### `set_auto_compaction` - 开关自动压缩

```json
{"id": "req_15", "type": "set_auto_compaction", "enabled": true}
```

**响应**：
```json
{"id": "req_15", "type": "response", "command": "set_auto_compaction", "success": true}
```

---

### 4.7 重试（Retry）

#### `set_auto_retry` - 开关自动重试

```json
{"id": "req_16", "type": "set_auto_retry", "enabled": true}
```

---

#### `abort_retry` - 中止重试

```json
{"id": "req_17", "type": "abort_retry"}
```

---

### 4.8 Bash 执行

#### `bash` - 执行 bash 命令

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

#### `abort_bash` - 中止 bash 命令

```json
{"id": "req_19", "type": "abort_bash"}
```

---

### 4.9 会话管理（Session）

#### `get_session_stats` - 获取会话统计

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

#### `export_html` - 导出为 HTML

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

#### `switch_session` - 切换到指定会话

```json
{"id": "req_22", "type": "switch_session", "sessionPath": "/Users/x/.pi/agent/sessions/--path--/other-session.jsonl"}
```

**响应**：
```json
{"id": "req_22", "type": "response", "command": "switch_session", "success": true, "data": {"cancelled": false}}
```

> 切换后需要重新订阅事件（RPC 模式内部自动 rebind）。

---

#### `fork` - 从指定消息分叉

```json
{"id": "req_23", "type": "fork", "entryId": "abc12345"}
```

**响应**：
```json
{"id": "req_23", "type": "response", "command": "fork", "success": true, "data": {"text": "原始消息文本", "cancelled": false}}
```

---

#### `clone` - 克隆当前分支为新会话

```json
{"id": "req_24", "type": "clone"}
```

**响应**：
```json
{"id": "req_24", "type": "response", "command": "clone", "success": true, "data": {"cancelled": false}}
```

---

#### `get_fork_messages` - 获取可分叉的消息列表

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

#### `get_last_assistant_text` - 获取最后一条 assistant 消息文本

```json
{"id": "req_26", "type": "get_last_assistant_text"}
```

**响应**：
```json
{"id": "req_26", "type": "response", "command": "get_last_assistant_text", "success": true, "data": {"text": "好的，这是你的 hello world 代码..."}}
```

无 assistant 消息时 `text: null`。

---

#### `set_session_name` - 设置会话名称

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

### 4.10 消息（Messages）

#### `get_messages` - 获取所有消息

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

### 4.11 资源查询（Resources）

#### `get_skills` - 获取已加载技能

```json
{"id": "req_29", "type": "get_skills"}
```

**响应**：
```json
{
  "id": "req_29",
  "type": "response",
  "command": "get_skills",
  "success": true,
  "data": {
    "skills": [
      {
        "name": "react-patterns",
        "description": "React best practices and patterns",
        "filePath": "/path/to/skills/react-patterns/SKILL.md",
        "baseDir": "/path/to/skills/react-patterns",
        "sourceInfo": { "path": "...", "source": "user", "scope": "user", "origin": "top-level" },
        "disableModelInvocation": false
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 技能名称（小写 + 短横线） |
| `description` | string | 技能描述 |
| `filePath` | string | SKILL.md 文件路径 |
| `baseDir` | string | 技能目录路径 |
| `sourceInfo` | SourceInfo | 来源元数据（path/source/scope/origin） |
| `disableModelInvocation` | boolean | 是否禁用模型自动调用 |

> 技能来源：`~/.pi/skills/`（用户级）、`.pi/skills/`（项目级）、`--skill` 参数、扩展 `resources_discover` 事件。

---

#### `get_extensions` - 获取已加载扩展

```json
{"id": "req_30", "type": "get_extensions"}
```

**响应**：
```json
{
  "id": "req_30",
  "type": "response",
  "command": "get_extensions",
  "success": true,
  "data": {
    "extensions": [
      {
        "path": "/path/to/extension.ts",
        "resolvedPath": "/absolute/path/to/extension.ts",
        "sourceInfo": { "path": "...", "source": "project", "scope": "project", "origin": "top-level" },
        "toolNames": ["my_tool", "another_tool"],
        "commandNames": ["my-command"]
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | string | 扩展入口文件原始路径 |
| `resolvedPath` | string | 扩展入口文件绝对路径 |
| `sourceInfo` | SourceInfo | 来源元数据 |
| `toolNames` | string[] | 扩展注册的工具名称列表 |
| `commandNames` | string[] | 扩展注册的斜杠命令名称列表 |

> 与 `get_commands`（`source: "extension"`）的区别：`get_extensions` 返回扩展级别信息，包含该扩展注册的所有工具和命令名称；`get_commands` 返回的是扁平化的命令列表，混合了扩展命令、提示词模板和技能。

---

#### `get_tools` - 获取已注册工具

```json
{"id": "req_31", "type": "get_tools"}
```

**响应**：
```json
{
  "id": "req_31",
  "type": "response",
  "command": "get_tools",
  "success": true,
  "data": {
    "tools": [
      {
        "name": "bash",
        "label": "bash",
        "description": "Execute a bash command in the current working directory...",
        "sourceInfo": { "path": "...", "source": "builtin", "scope": "temporary", "origin": "top-level" }
      },
      {
        "name": "my_tool",
        "label": "My Tool",
        "description": "Does something custom",
        "sourceInfo": { "path": "/path/to/extension.ts", "source": "project", "scope": "project", "origin": "top-level" }
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 工具名称（LLM 调用时使用） |
| `label` | string | 人类可读标签（UI 显示） |
| `description` | string | 工具描述（给 LLM 的说明） |
| `sourceInfo` | SourceInfo | 来源元数据 |

> 包含内置工具（bash、read、write、edit 等）和扩展注册的工具。工具名称按首次注册去重。

---

### 4.12 命令列表（Commands）

#### `get_commands` - 获取可用命令

```json
{"id": "req_29", "type": "get_commands"}
```

**响应**：
```json
{
  "id": "req_29",
  "type": "response",
  "command": "get_commands",
  "success": true,
  "data": {
    "commands": [
      {
        "name": "compact",
        "description": "Compact session context",
        "source": "extension",
        "sourceInfo": { "type": "extension", "path": "/path/to/extension.ts" }
      },
      {
        "name": "review",
        "description": "Code review template",
        "source": "prompt",
        "sourceInfo": { "type": "prompt", "path": "/path/to/prompt.md" }
      },
      {
        "name": "skill:react-patterns",
        "description": "React best practices",
        "source": "skill",
        "sourceInfo": { "type": "skill", "path": "/path/to/skill.md" }
      }
    ]
  }
}
```

---

## 5. RPC 响应完整列表（agent → stdout）

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
| `get_state` | `RpcSessionState` | 见 4.2 |
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
| `get_commands` | `{ commands: RpcSlashCommand[] }` | |

---

## 6. 流式事件（agent → stdout）

这些事件 **不对应任何命令**，是 agent 运行时自动推送的。RPC 模式将 `AgentSessionEvent` 直接序列化输出。

### 6.1 Agent 生命周期事件（来自 `@dyyz1993/pi-agent-core`）

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

### 6.2 消息生命周期事件

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

### 6.3 工具执行事件

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

### 6.4 AgentSession 扩展事件（来自 `coding-agent` 层）

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

### 6.5 完整事件流时序示例

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

## 7. Extension UI 交互协议

扩展可能需要与用户交互。RPC 模式通过 `extension_ui_request` / `extension_ui_response` 实现。

### 7.1 Extension UI 请求（agent → stdout）

#### `select` - 选择列表

```json
{"type": "extension_ui_request", "id": "uuid-1", "method": "select", "title": "选择文件", "options": ["file1.ts", "file2.ts"], "timeout": 30000}
```

#### `confirm` - 确认对话框

```json
{"type": "extension_ui_request", "id": "uuid-2", "method": "confirm", "title": "确认删除", "message": "确定要删除这个文件吗？", "timeout": 30000}
```

#### `input` - 文本输入

```json
{"type": "extension_ui_request", "id": "uuid-3", "method": "input", "title": "输入文件名", "placeholder": "example.ts", "timeout": 30000}
```

#### `editor` - 多行编辑器

```json
{"type": "extension_ui_request", "id": "uuid-4", "method": "editor", "title": "编辑代码", "prefill": "// 在此编辑..."}
```

#### `notify` - 通知（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-5", "method": "notify", "message": "操作完成", "notifyType": "info"}
```

`notifyType`: `"info"` | `"warning"` | `"error"`

#### `setStatus` - 设置状态栏（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-6", "method": "setStatus", "statusKey": "build", "statusText": "Building..."}
```

清除状态：`"statusText": undefined`

#### `setWidget` - 设置小部件（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-7", "method": "setWidget", "widgetKey": "progress", "widgetLines": ["Step 1: Done", "Step 2: In Progress"], "widgetPlacement": "aboveEditor"}
```

清除 widget：`"widgetLines": undefined`

#### `setTitle` - 设置标题（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-8", "method": "setTitle", "title": "Pi - My Project"}
```

#### `set_editor_text` - 设置编辑器文本（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-9", "method": "set_editor_text", "text": "预填文本"}
```

---

### 7.2 Extension UI 响应（stdin → agent）

需要对带 `id` 的请求进行响应。

#### 选择响应

```json
{"type": "extension_ui_response", "id": "uuid-1", "value": "file1.ts"}
```

#### 确认响应

```json
{"type": "extension_ui_response", "id": "uuid-2", "confirmed": true}
```

#### 取消响应

```json
{"type": "extension_ui_response", "id": "uuid-1", "cancelled": true}
```

#### 输入响应

```json
{"type": "extension_ui_response", "id": "uuid-3", "value": "my-file.ts"}
```

---

### 7.3 Channel 数据协议

扩展之间可通过命名 channel 双向通信：

**Client → Agent:**
```json
{"type": "channel_data", "name": "my-channel", "data": {"action": "refresh"}}
```

**Agent → Client:**
```json
{"type": "channel_data", "name": "my-channel", "data": {"status": "done"}}
```

---

## 8. SessionManager 静态 API（非 RPC，Server 层直接调用）

这些 API 不通过 RPC 协议，而是 Server 层直接 import `SessionManager` 使用。

### 8.1 扫描所有项目

```typescript
import { SessionManager } from "../core/session-manager.js";

// 列出所有项目所有会话
const allSessions: SessionInfo[] = await SessionManager.listAll();

// 提取去重的项目列表
const projects = [...new Set(allSessions.map(s => s.cwd))];
```

### 8.2 获取指定项目的会话列表

```typescript
const sessions = await SessionManager.list("/path/to/project");

// 带进度回调
const sessions = await SessionManager.list(cwd, undefined, (loaded, total) => {
  console.log(`Loaded ${loaded}/${total}`);
});
```

### 8.3 打开会话并读取状态

```typescript
const sm = SessionManager.open("/path/to/session.jsonl");

// 获取 header
const header = sm.getHeader();
// { type: "session", version: 3, id: "uuid", timestamp: "...", cwd: "/path/to/project" }

// 获取上下文（消息 + 模型 + 思考级别）
const ctx = sm.buildSessionContext();
// { messages: AgentMessage[], thinkingLevel: "off", model: { provider: "anthropic", modelId: "..." } | null }

// 获取所有 entries
const entries = sm.getEntries();

// 获取树结构（用于分支浏览）
const tree = sm.getTree();

// 获取会话名称
const name = sm.getSessionName();
```

### 8.4 创建新会话

```typescript
const sm = SessionManager.create("/path/to/project");
// 自动在 ~/.pi/agent/sessions/--encoded-path--/ 下创建 .jsonl 文件
```

### 8.5 删除会话

```typescript
// 目前没有内置 delete API，直接删文件
import { unlinkSync } from "fs";
unlinkSync(sm.getSessionFile()!);
```

### 8.6 重命名会话

```typescript
const sm = SessionManager.open("/path/to/session.jsonl");
sm.appendSessionInfo("新的会话名称");
```

### 8.7 继续最近会话

```typescript
const sm = SessionManager.continueRecent("/path/to/project");
// 如果有最近会话则打开，否则新建
```

### 8.8 SessionInfo 完整结构

```typescript
interface SessionInfo {
  path: string;              // .jsonl 文件完整路径
  id: string;                // session UUID (v7)
  cwd: string;               // 工作目录
  name?: string;             // 用户自定义名称（session_info entry）
  parentSessionPath?: string;// 父会话路径（fork 来源）
  created: Date;             // 创建时间
  modified: Date;            // 最后修改时间
  messageCount: number;      // 消息总数
  firstMessage: string;      // 第一条用户消息文本
  allMessagesText: string;   // 所有消息文本拼接（用于搜索）
}
```

---

## 9. 会话文件格式 (.jsonl)

每个会话文件是 append-only 的 JSONL 文件，每行一个 JSON 对象。

### 文件命名

```
<ISO-timestamp-with-dashes>_<uuid-v7>.jsonl
```

示例：`2025-01-20T10-30-00-000_0194abc2-def0-7xyz-b123-456789abcdef.jsonl`

### 文件内容结构

```jsonl
{"type":"session","version":3,"id":"0194abc2-def0-7xyz-b123-456789abcdef","timestamp":"2025-01-20T10:30:00.000Z","cwd":"/path/to/project"}
{"type":"message","id":"abc12345","parentId":null,"timestamp":"2025-01-20T10:30:01.000Z","message":{"role":"user","content":[{"type":"text","text":"hello"}],"timestamp":1706000001000}}
{"type":"message","id":"def67890","parentId":"abc12345","timestamp":"2025-01-20T10:30:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}],"provider":"anthropic","model":"claude-sonnet-4-5-20250929","stopReason":"stop","usage":{...},"timestamp":1706000002000}}
{"type":"model_change","id":"ghi11111","parentId":"def67890","timestamp":"2025-01-20T10:35:00.000Z","provider":"openai","modelId":"gpt-4o"}
{"type":"thinking_level_change","id":"jkl22222","parentId":"ghi11111","timestamp":"2025-01-20T10:35:01.000Z","thinkingLevel":"high"}
{"type":"session_info","id":"mno33333","parentId":"jkl22222","timestamp":"2025-01-20T10:40:00.000Z","name":"My Session"}
```

### Entry 类型一览

| type | 说明 |
|------|------|
| `session` | 文件头（version, id, cwd） |
| `message` | LLM 消息（user/assistant/toolResult） |
| `model_change` | 模型切换记录 |
| `thinking_level_change` | 思考级别变更记录 |
| `compaction` | 上下文压缩摘要 |
| `branch_summary` | 分支切换时被放弃路径的摘要 |
| `custom` | 扩展自定义数据（不进入 LLM 上下文） |
| `custom_message` | 扩展自定义消息（进入 LLM 上下文） |
| `label` | 用户书签/标记 |
| `session_info` | 会话元数据（如显示名称） |
| `deletion` | 消息删除记录 |
| `segment_summary` | 消息段摘要 |

---

## 10. 源码文件索引

### RPC 协议层

| 文件 | 说明 |
|------|------|
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/modes/rpc/rpc-types.ts` | RPC 命令/响应/事件类型定义 |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/modes/rpc/rpc-mode.ts` | RPC 模式主逻辑（命令处理、扩展 UI 代理） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/modes/rpc/rpc-client.ts` | RPC 客户端（TypeScript API 封装） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/modes/rpc/jsonl.ts` | JSONL 序列化/反序列化工具 |

### Agent 核心

| 文件 | 说明 |
|------|------|
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/agent/src/types.ts` | AgentEvent, AgentState, AgentTool, ThinkingLevel 等核心类型 |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/agent/src/agent.ts` | Agent 类（事件系统、steer/followUp 队列、prompt/abort） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/agent/src/agent-loop.ts` | 底层 agent loop（LLM 调用循环） |

### AgentSession（coding-agent 层）

| 文件 | 说明 |
|------|------|
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session.ts` | AgentSession 类（会话持久化、模型管理、压缩、重试） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session-runtime.ts` | AgentSessionRuntime（模式无关的运行时宿主） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/session-manager.ts` | SessionManager（JSONL 会话文件管理、list/listAll/open/create） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/messages.ts` | 自定义消息类型（BashExecutionMessage, CustomMessage 等） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/bash-executor.ts` | Bash 执行器（BashResult 类型） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/compaction/compaction.ts` | 上下文压缩逻辑（CompactionResult 类型） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/extensions/index.ts` | 扩展系统类型导出 |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/extensions/channel-types.ts` | Channel 数据消息类型 |

### 配置与路径

| 文件 | 说明 |
|------|------|
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/config.ts` | 配置路径（getAgentDir, getSessionsDir, findCanonicalGitRoot） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/model-registry.ts` | 模型注册表（API key 解析、模型发现） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/settings-manager.ts` | 设置管理器（默认模型、重试设置等） |

### AI Provider 层

| 文件 | 说明 |
|------|------|
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/ai/src/types.ts` | Message, Model, Usage, AssistantMessage 等基础类型 |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/ai/src/providers/` | 各 LLM provider 实现 |

### Web UI 层

| 文件 | 说明 |
|------|------|
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/web-ui/src/ChatPanel.ts` | 聊天面板（Artifacts 集成） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/web-ui/src/components/AgentInterface.ts` | Agent 交互界面（消息列表、输入、状态） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/web-ui/src/components/MessageEditor.ts` | 消息编辑器 |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/web-ui/src/components/MessageList.ts` | 消息列表 |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/web-ui/src/components/StreamingMessageContainer.ts` | 流式消息容器 |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/web-ui/src/storage/` | 存储层（IndexedDB, settings, sessions） |
| `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/web-ui/example/src/main.ts` | WebUI 示例应用（完整集成示例） |

---

## 10. 历史数据 vs 实时事件：数据结构差异与拼接方案

### 10.1 核心结论

**历史数据和实时事件不能直接拼接**，需要一层转换：

| 维度 | 历史数据（.jsonl 文件） | 实时事件（RPC 推送） |
|------|------------------------|---------------------|
| **载体** | `SessionEntry[]`（树结构，每行一个 entry） | `AgentEvent` / `AgentSessionEvent` 流（扁平事件流） |
| **消息包裹** | `SessionMessageEntry` 包裹 `AgentMessage` | `message_end.message` 直接就是 `AgentMessage` |
| **额外数据** | compaction/deletion/label/branch_summary/model_change/thinking_level_change/custom 等 | tool_execution_start/update/end、agent_start/end、queue_update、compaction_start/end 等 |
| **读取方式** | `buildSessionContext()` 做树遍历+压缩+删除过滤 | 逐条事件流式到达 |

### 10.2 `buildSessionContext()` 是给 LLM 用的，不是给 UI 用的

`buildSessionContext()` 会**丢弃**以下 UI 需要的数据：

| Entry 类型 | `buildSessionContext` 处理 | UI 是否需要 |
|-----------|--------------------------|------------|
| `message` | ✅ 保留为 `AgentMessage` | ✅ 核心：消息内容 |
| `custom_message` | ✅ 转为 `CustomMessage` | ✅ 扩展消息 |
| `branch_summary` | ✅ 转为 `BranchSummaryMessage` | ✅ 分支切换提示 |
| `custom`（扩展私有数据） | ❌ **完全跳过** | ✅ 扩展状态恢复（如 ArtifactIndex） |
| `label`（用户书签） | ❌ **不输出** | ✅ 会话树书签导航 |
| `session_info`（会话名称） | ❌ **不输出** | ✅ 会话标题显示 |
| `deletion`（删除记录） | 仅用于**过滤掉**被删消息 | ✅ 可能需要显示"已删除"标记 |
| `model_change` | 只保留**最终值**，丢掉历史变更 | ✅ 显示模型变更时间线 |
| `thinking_level_change` | 只保留**最终值**，丢掉历史变更 | ✅ 显示思考模式变更时间线 |
| `compaction` | 旧消息被**丢弃**，只保留摘要 | ✅ 展示压缩了多少 token |
| `compaction.details` | 不在消息中体现 | ✅ 高级用户查看压缩质量 |

### 10.3 正确的 UI 数据获取方式

```typescript
const sm = SessionManager.open("/path/to/session.jsonl");

// ❌ 错误：丢数据，这是给 LLM 用的
const ctx = sm.buildSessionContext();

// ✅ 正确：获取全部原始 entries
const entries = sm.getEntries();     // SessionEntry[] — 所有原始数据
const tree = sm.getTree();           // SessionTreeNode[] — 带分支的完整树
const header = sm.getHeader();       // SessionHeader — id/cwd/version
const name = sm.getSessionName();    // string | undefined

// 从 entries 中分别提取 UI 需要的信息：
entries.filter(e => e.type === "message")               // 所有消息
entries.filter(e => e.type === "model_change")          // 模型变更历史
entries.filter(e => e.type === "thinking_level_change") // 思考级别历史
entries.filter(e => e.type === "custom")                // 扩展私有数据
entries.filter(e => e.type === "label")                 // 书签标记
entries.filter(e => e.type === "session_info")          // 会话元数据
entries.filter(e => e.type === "compaction")            // 压缩记录
entries.filter(e => e.type === "deletion")              // 删除记录
```

### 10.4 消息类型一致性

虽然 entries 和事件的数据结构不同，但**消息内容本身类型一致**：

```
历史: SessionMessageEntry.message  →  AgentMessage（从 .jsonl 读取）
实时: message_end.message          →  AgentMessage（从事件流获取）
                                        ↑ 类型相同，可直接拼接
```

**持久化映射**（`_processAgentEvent` 中）：

| AgentMessage.role | 持久化为 | 方法 |
|---|---|---|
| `"user"` | `SessionMessageEntry` (type:"message") | `appendMessage()` |
| `"assistant"` | `SessionMessageEntry` (type:"message") | `appendMessage()` |
| `"toolResult"` | `SessionMessageEntry` (type:"message") | `appendMessage()` |
| `"bashExecution"` | `SessionMessageEntry` (type:"message") | `appendMessage()` |
| `"custom"` | `CustomMessageEntry` (type:"custom_message") | `appendCustomMessageEntry()` |
| `"compactionSummary"` | `CompactionEntry` (type:"compaction") | `appendCompaction()` |
| `"branchSummary"` | `BranchSummaryEntry` (type:"branch_summary") | `branchWithSummary()` |

### 10.5 Server API 设计建议

```
# 方案A：返回原始 entries，前端自行处理
GET /api/sessions/:id
→ {
    header: SessionHeader,
    entries: SessionEntry[],      // 全部原始数据，不丢
    tree: SessionTreeNode[],      // 带分支的树
    sessionName: string | undefined
  }

# 方案B：分层返回
GET /api/sessions/:id/messages
→ AgentMessage[]                // 给消息渲染用（buildSessionContext）

GET /api/sessions/:id/full
→ SessionEntry[]                // 给 UI 用（全部原始数据：model_change/label/custom 等）
```

### 10.6 拼接实时数据的方案

```
1. 加载历史: getEntries() → 自行处理为 UI 可用结构
   消息部分: 过滤 type="message" 的 entry → 取 .message → 得到 AgentMessage[]

2. 设置 Agent 初始状态: new Agent({ initialState: { messages: historyMessages } })

3. 实时运行:
   - message_update 事件 → 渲染流式部分（StreamingMessageContainer）
   - message_end 事件   → 新 AgentMessage 自动进入 state.messages
   - model_change 等事件 → 推送给前端更新状态栏

4. 前端 MessageList 只看 AgentMessage[]
   不区分消息来自历史还是实时
```

### 10.7 实时事件中缺失的信息

实时 RPC 事件流 **没有推送** 这些 entry 级别的信息，Server 需要额外处理：

| 数据 | 如何获取 |
|------|---------|
| `model_change` | 通过 `get_state` 命令轮询，或对比前后 state 差异 |
| `thinking_level_change` | 同上 |
| `custom`（扩展数据） | 扩展通过 channel 协议或 `appendEntry` 自行管理 |
| `label` / `session_info` | 需要单独的 RPC 命令（`set_session_name` 已有） |
| `deletion` | 无 RPC 命令，仅 TUI 操作 |

---

## 11. WebUI 事件展示优先级

### 11.1 第一梯队：必须展示（直接影响用户理解和操作）

| 事件/数据 | 展示形式 | 完整 payload | 理由 |
|-----------|---------|-------------|------|
| **`message_start`** | 开始渲染消息气泡 | `{ type: "message_start"; message: AgentMessage }` | 消息渲染起点 |
| **`message_update`** | 流式更新文本/工具调用 | `{ type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }` | 实时流式输出 |
| **`message_end`** | 消息完成，加入稳定列表 | `{ type: "message_end"; message: AgentMessage }` | 消息渲染终点，触发持久化 |
| **`tool_execution_start`** | 工具执行指示器 | `{ type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }` | 用户需要知道 agent 在干什么 |
| **`tool_execution_update`** | 工具执行中间进度 | `{ type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }` | 长时间工具调用时给反馈 |
| **`tool_execution_end`** | 工具执行结果 | `{ type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }` | 用户审查 agent 操作 |
| **`compaction_start`** | 状态提示 "上下文压缩中..." | `{ type: "compaction_start"; reason: "manual" \| "threshold" \| "overflow" }` | 避免用户困惑为什么停顿 |
| **`compaction_end`** | 状态提示 "节省了 XX tokens" | `{ type: "compaction_end"; reason: string; result: CompactionResult \| undefined; aborted: boolean; willRetry: boolean; errorMessage?: string }` | 压缩结果通知 |
| **`auto_retry_start`** | 警告 "服务过载，第 2/3 次重试" | `{ type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }` | 用户需要知道为什么停了 |
| **`auto_retry_end`** (failure) | 错误提示 | `{ type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }` | 用户需要知道出错了 |

### 11.2 第二梯队：应该展示（提升体验和透明度）

| 事件/数据 | 展示形式 | 获取方式 | 理由 |
|-----------|---------|---------|------|
| **`model_change`** (历史 entry) | 时间线标记 "切换到 Claude Sonnet 4.5" | 历史entries中 `type: "model_change"`；实时通过 `get_state` 前后对比 | 用户需知道哪段对话用的什么模型 |
| **`thinking_level_change`** (历史 entry) | 状态栏思考模式指示器 | 历史entries中 `type: "thinking_level_change"`；实时通过 `get_state` 前后对比 | 用户需看到并控制思考深度 |
| **`queue_update`** | 排队消息数 "2 条排队消息" | 实时事件 `{ type: "queue_update"; steering: string[]; followUp: string[] }` | steer/followUp 排队状态 |
| **`agent_start`** | UI 状态切换：idle → thinking | 实时事件 `{ type: "agent_start" }` | 驱动 UI 状态机（动画、按钮禁用） |
| **`agent_end`** | UI 状态切换：thinking → idle | 实时事件 `{ type: "agent_end"; messages: AgentMessage[] }` | 恢复可操作状态 |
| **`bashExecution`** 消息 | 终端风格代码块 + 输出 | 消息中 `role: "bashExecution"`：`{ command, output, exitCode, cancelled, truncated, fullOutputPath }` | bash 是最常用工具，需突出展示 |

### 11.3 第三梯队：可选展示（高级用户/调试）

| 事件/数据 | 展示形式 | 获取方式 | 理由 |
|-----------|---------|---------|------|
| **`compaction`** entry 的 `details` | 折叠 "读取了 5 个文件，修改了 3 个" | 历史entry `{ type: "compaction"; details?: { readFiles: string[]; modifiedFiles: string[] } }` | 高级用户关心压缩质量 |
| **`label`** entry | 会话树中的标记点 | 历史entry `{ type: "label"; targetId: string; label: string \| undefined }` | TUI 中打了书签，WebUI 应显示 |
| **`session_info`** entry | 会话标题编辑 | 历史entry `{ type: "session_info"; name?: string }`；实时 RPC `set_session_name` | 会话管理 |
| **`custom`** entry | 扩展自行决定渲染 | 历史entry `{ type: "custom"; customType: string; data?: T }` | ArtifactIndex、扩展状态等 |
| **`deletion`** entry | 已删除消息灰色显示或隐藏 | 历史entry `{ type: "deletion"; targetIds: string[] }` | 用户可能想看到/恢复已删除内容 |
| **`branch_summary`** entry | 分支切换提示 | 历史entry `{ type: "branch_summary"; fromId: string; summary: string }` | 多分支导航时需要上下文 |

### 11.4 不需要展示的

| 事件/数据 | 理由 |
|-----------|------|
| **`turn_start/end`** | 内部概念，用户不关心"turn" |
| **`segment_summary`** | 内部压缩机制，对用户透明 |
| **`session`** header | 元数据，不需要展示 |
| **`custom_message`** (display=false) | 扩展标记不展示的消息 |

### 11.5 完整事件流 → UI 渲染映射

```
实时事件流（WebSocket 推送）                    UI 组件
──────────────────────────────                 ────────────────

agent_start                                 → 状态栏: idle → thinking
                                              输入框: disabled

message_start (user)                        → MessageList: 添加用户消息气泡
message_end (user)                          → MessageList: 用户消息稳定

message_start (assistant)                   → StreamingContainer: 开始
message_update (assistant)                  → StreamingContainer: 流式文本/工具调用
  └─ content.type="text"                    →   文本逐字渲染
  └─ content.type="thinking"                →   思维链折叠展示
  └─ content.type="toolCall"                →   工具调用卡片（等待执行）

tool_execution_start                        → 工具卡片: "正在执行 bash..."
tool_execution_update                       → 工具卡片: 部分输出
tool_execution_end                          → 工具卡片: 完整结果 + 错误状态

message_update (assistant, 继续流式)         → StreamingContainer: 工具结果后的继续输出
message_end (assistant)                     → MessageList: 助手消息稳定
                                              StreamingContainer: 清空

turn_end                                    → (内部，不展示)
turn_start (下一轮)                          → (内部，不展示)
  └─ 重复 message_start/update/end 循环

compaction_start                            → 状态提示: "上下文压缩中..."
compaction_end                              → 状态提示: "节省了 73000 tokens"

auto_retry_start                            → 警告提示: "服务过载，重试中 (2/3)..."
auto_retry_end                              → 成功: 静默; 失败: 错误提示

queue_update                                → 排队指示器: "2 条排队消息"

agent_end                                   → 状态栏: thinking → idle
                                              输入框: enabled
```

### 11.6 历史数据加载 → UI 渲染映射

```
getEntries() 返回 SessionEntry[]             UI 组件
────────────────────────────                 ────────────────

type: "message" (role: "user")             → 用户消息气泡
type: "message" (role: "assistant")        → 助手消息气泡 + 工具调用卡片
type: "message" (role: "toolResult")       → 工具结果（内联到对应助手消息）
type: "message" (role: "bashExecution")    → 终端风格代码块
type: "message" (role: "custom")           → 扩展自定义渲染
type: "custom_message"                     → 扩展自定义渲染

type: "model_change"                       → 时间线标记: "切换到 GPT-4o"
type: "thinking_level_change"              → 时间线标记: "思考模式: high"
type: "compaction"                         → 时间线标记: "上下文压缩 (节省 73K tokens)"
type: "label"                              → 会话树书签图标
type: "session_info"                       → 会话标题
type: "custom"                             → 扩展状态恢复（不可见）
type: "deletion"                           → 标记对应消息为已删除（灰色/隐藏）
type: "branch_summary"                     → 分支切换提示
type: "segment_summary"                    → 消息段摘要（替换被摘要的原始消息）

SessionHeader                              → 会话 ID / 项目路径 / 创建时间
```

---

## 12. 源码文件索引
