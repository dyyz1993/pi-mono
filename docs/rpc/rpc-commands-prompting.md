# RPC 命令 - 对话（Prompting）

> 本文档详细描述 RPC 协议中的对话类命令。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

## `prompt` - 发送消息

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

## `steer` - 流式中断注入

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

## `follow_up` - 追加排队消息

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

## `abort` - 中断当前操作

```json
{"id": "req_4", "type": "abort"}
```

**响应**：
```json
{"id": "req_4", "type": "response", "command": "abort", "success": true}
```

---

## `new_session` - 新建会话

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
