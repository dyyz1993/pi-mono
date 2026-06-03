---

# RPC 命令 - 模型与思考模式

> 本文档详细描述 RPC 协议中的模型切换、思考级别和排队模式命令。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

## 模型管理

### `set_model` - 切换模型

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

### `cycle_model` - 循环切换下一个模型

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

### `get_available_models` - 获取可用模型列表

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

## 思考模式

### `set_thinking_level` - 设置思考级别

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

### `cycle_thinking_level` - 循环切换思考级别

```json
{"id": "req_11", "type": "cycle_thinking_level"}
```

**响应**：
```json
{"id": "req_11", "type": "response", "command": "cycle_thinking_level", "success": true, "data": {"level": "high"}}
```

---

## 排队模式

### `set_steering_mode` - 设置 steering 排队模式

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

### `set_follow_up_mode` - 设置 followUp 排队模式

```json
{"id": "req_13", "type": "set_follow_up_mode", "mode": "all"}
```

同上。

---
