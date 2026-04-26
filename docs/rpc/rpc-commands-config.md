# RPC 命令 - 设置、上下文、工具、排队与 Flag

> 本文档详细描述 RPC 协议中的配置管理、上下文监控、工具管理、排队管理和扩展 Flag 命令。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

## 设置管理

### `get_settings` - 获取设置

```json
{"id": "req_1", "type": "get_settings"}
```

带 scope：
```json
{"id": "req_1", "type": "get_settings", "scope": "global"}
{"id": "req_1", "type": "get_settings", "scope": "project"}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scope` | "global" \| "project" | 否 | 不传则返回全局设置 |

**响应**：
```json
{
  "id": "req_1",
  "type": "response",
  "command": "get_settings",
  "success": true,
  "data": {
    "defaultProvider": "anthropic",
    "defaultModel": "claude-sonnet-4-5-20250929",
    "defaultThinkingLevel": "medium",
    "steeringMode": "one-at-a-time",
    "followUpMode": "one-at-a-time",
    "theme": "default",
    "compaction": { "enabled": true, "reserveTokens": 16384, "keepRecentTokens": 20000 },
    "retry": { "enabled": true, "maxRetries": 3, "baseDelayMs": 2000, "maxDelayMs": 60000 },
    "hideThinkingBlock": false,
    "packages": [],
    "extensions": [],
    "skills": [],
    "prompts": [],
    "enabledModels": []
  }
}
```

> Settings 对象字段较多，以上仅为示例。完整字段参考 `packages/coding-agent/src/core/settings-manager.ts` 中的 `Settings` 接口。

---

### `set_settings` - 修改设置

运行时覆盖设置，立即生效。

```json
{"id": "req_2", "type": "set_settings", "settings": {"hideThinkingBlock": true}}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `settings` | Partial\<Settings\> | 是 | 要修改的设置字段 |
| `scope` | "global" \| "project" | 否 | 预留，当前均为全局覆盖 |

**响应**：
```json
{"id": "req_2", "type": "response", "command": "set_settings", "success": true}
```

> `applyOverrides` 修改的是运行时设置，持久化由 SettingsManager 内部处理。

---

## 上下文与提示

### `get_context_usage` - 获取上下文窗口使用率

```json
{"id": "req_3", "type": "get_context_usage"}
```

**响应**：
```json
{
  "id": "req_3",
  "type": "response",
  "command": "get_context_usage",
  "success": true,
  "data": {
    "tokens": 15000,
    "contextWindow": 200000,
    "percent": 7.5
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `tokens` | number \| null | 当前使用的 token 数（压缩后可能为 null） |
| `contextWindow` | number | 模型的上下文窗口大小 |
| `percent` | number \| null | 使用百分比（tokens 为 null 时也为 null） |

> WebUI 可用此命令展示"上下文进度条"。

---

### `get_system_prompt` - 获取实际注入的 system prompt

```json
{"id": "req_4", "type": "get_system_prompt"}
```

**响应**：
```json
{
  "id": "req_4",
  "type": "response",
  "command": "get_system_prompt",
  "success": true,
  "data": {
    "systemPrompt": "You are a helpful coding assistant...",
    "appendSystemPrompt": ["Additional instructions from extension..."]
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `systemPrompt` | string | 主 system prompt 内容（来自 AGENTS.md 或配置） |
| `appendSystemPrompt` | string[] | 追加的 system prompt 列表（来自扩展等） |

---

### `get_agents_files` - 获取 AGENTS.md 内容

```json
{"id": "req_5", "type": "get_agents_files"}
```

**响应**：
```json
{
  "id": "req_5",
  "type": "response",
  "command": "get_agents_files",
  "success": true,
  "data": {
    "agentsFiles": [
      { "path": "/path/to/AGENTS.md", "content": "# Development Rules\n..." },
      { "path": "/path/to/subdir/AGENTS.md", "content": "..." }
    ]
  }
}
```

---

## 工具管理

### `get_active_tools` - 获取当前启用的工具

```json
{"id": "req_6", "type": "get_active_tools"}
```

**响应**：
```json
{
  "id": "req_6",
  "type": "response",
  "command": "get_active_tools",
  "success": true,
  "data": {
    "toolNames": ["bash", "read", "write", "edit", "glob", "grep"]
  }
}
```

---

### `set_active_tools` - 动态启用/禁用工具

```json
{"id": "req_7", "type": "set_active_tools", "toolNames": ["bash", "read"]}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `toolNames` | string[] | 是 | 要启用的工具名称列表（不在列表中的工具将被禁用） |

**响应**：
```json
{"id": "req_7", "type": "response", "command": "set_active_tools", "success": true}
```

---

## 排队管理

### `get_queue` - 获取排队中的消息

```json
{"id": "req_8", "type": "get_queue"}
```

**响应**：
```json
{
  "id": "req_8",
  "type": "response",
  "command": "get_queue",
  "success": true,
  "data": {
    "steering": ["等等，先不要改那个文件"],
    "followUp": ["接下来帮我测试一下", "再帮我加个测试"]
  }
}
```

---

### `clear_queue` - 清空排队消息

```json
{"id": "req_9", "type": "clear_queue"}
```

**响应**：返回被清空的消息（同 `get_queue` 格式）。

```json
{
  "id": "req_9",
  "type": "response",
  "command": "clear_queue",
  "success": true,
  "data": {
    "steering": ["等等，先不要改那个文件"],
    "followUp": ["接下来帮我测试一下"]
  }
}
```

---

## 扩展 Flag

### `get_flags` - 获取扩展注册的 flag 定义

```json
{"id": "req_10", "type": "get_flags"}
```

**响应**：
```json
{
  "id": "req_10",
  "type": "response",
  "command": "get_flags",
  "success": true,
  "data": {
    "flags": [
      {
        "name": "autoFormat",
        "description": "Auto-format code after editing",
        "type": "boolean",
        "default": true,
        "extensionPath": "/path/to/extension.ts"
      }
    ]
  }
}
```

---

### `get_flag_values` - 获取 flag 当前值

```json
{"id": "req_11", "type": "get_flag_values"}
```

**响应**：
```json
{
  "id": "req_11",
  "type": "response",
  "command": "get_flag_values",
  "success": true,
  "data": {
    "values": {
      "autoFormat": true,
      "language": "typescript"
    }
  }
}
```

---

### `set_flag` - 设置 flag 值

```json
{"id": "req_12", "type": "set_flag", "name": "autoFormat", "value": false}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | flag 名称 |
| `value` | boolean \| string | 是 | 要设置的值 |

**响应**：
```json
{"id": "req_12", "type": "response", "command": "set_flag", "success": true}
```

---

## 重载

### `reload` - 重载扩展/技能/设置资源

修改配置文件后，触发重载使更改生效。

```json
{"id": "req_13", "type": "reload"}
```

**响应**：
```json
{"id": "req_13", "type": "response", "command": "reload", "success": true}
```

> reload 会重新加载 settings、resourceLoader、扩展等，并重新绑定扩展上下文。可能需要几秒。
