# Pi Coding Agent - RPC Protocol Reference

> 本文档描述 pi coding agent 的 RPC 协议，用于构建 WebUI Server 对接。
> 协议基于 JSONL (JSON Lines)，通过 stdin/stdout 通信。

---

## 目录

- [1. 概述](#1-概述)
- [2. 协议格式](#2-协议格式)
- [3. 启动方式](#3-启动方式)
- [4. RPC 命令详细文档](#4-rpc-命令详细文档)
- [5. 响应格式与流式事件](#5-响应格式与流式事件)
- [6. Extension UI 交互协议](#6-extension-ui-交互协议)
- [7. SessionManager 与会话文件格式](#7-sessionmanager-与会话文件格式)
- [8. 历史数据、WebUI 展示与源码索引](#8-历史数据webui-展示与源码索引)

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

## 4. RPC 命令详细文档

以下命令按功能分组，点击链接查看详细的请求/响应格式和字段说明。

### 4.1 对话（Prompting）

| 命令 | 说明 | 详细文档 |
|------|------|---------|
| `prompt` | 发送消息（支持图片、排队行为） | [rpc-commands-prompting.md](rpc/rpc-commands-prompting.md) |
| `steer` | 流式中断注入 | 同上 |
| `follow_up` | 追加排队消息 | 同上 |
| `abort` | 中断当前操作 | 同上 |
| `new_session` | 新建会话 | 同上 |

### 4.2 状态与消息（State & Messages）

| 命令 | 说明 | 详细文档 |
|------|------|---------|
| `get_state` | 获取当前会话状态（模型、思考级别、排队等） | [rpc-commands-state.md](rpc/rpc-commands-state.md) |
| `get_messages` | 获取所有消息 | 同上 |

### 4.3 模型与思考模式（Model & Thinking）

| 命令 | 说明 | 详细文档 |
|------|------|---------|
| `set_model` | 切换模型 | [rpc-commands-model.md](rpc/rpc-commands-model.md) |
| `cycle_model` | 循环切换下一个模型 | 同上 |
| `get_available_models` | 获取可用模型列表 | 同上 |
| `set_thinking_level` | 设置思考级别 | 同上 |
| `cycle_thinking_level` | 循环切换思考级别 | 同上 |
| `set_steering_mode` | 设置 steering 排队模式 | 同上 |
| `set_follow_up_mode` | 设置 followUp 排队模式 | 同上 |

### 4.4 压缩、重试、Bash（Compaction, Retry, Bash）

| 命令 | 说明 | 详细文档 |
|------|------|---------|
| `compact` | 手动压缩上下文 | [rpc-commands-session.md](rpc/rpc-commands-session.md) |
| `set_auto_compaction` | 开关自动压缩 | 同上 |
| `set_auto_retry` | 开关自动重试 | 同上 |
| `abort_retry` | 中止重试 | 同上 |
| `bash` | 执行 bash 命令 | 同上 |
| `abort_bash` | 中止 bash 命令 | 同上 |

### 4.5 会话管理（Session）

| 命令 | 说明 | 详细文档 |
|------|------|---------|
| `get_session_stats` | 获取会话统计 | [rpc-commands-session.md](rpc/rpc-commands-session.md) |
| `export_html` | 导出为 HTML | 同上 |
| `switch_session` | 切换到指定会话 | 同上 |
| `fork` | 从指定消息分叉 | 同上 |
| `clone` | 克隆当前分支 | 同上 |
| `get_fork_messages` | 获取可分叉的消息列表 | 同上 |
| `get_last_assistant_text` | 获取最后一条 assistant 文本 | 同上 |
| `set_session_name` | 设置会话名称 | 同上 |

### 4.6 资源查询（Resources）

| 命令 | 说明 | 详细文档 |
|------|------|---------|
| `get_skills` | 获取已加载技能 | [rpc-commands-resources.md](rpc/rpc-commands-resources.md) |
| `get_extensions` | 获取已加载扩展 | 同上 |
| `get_tools` | 获取已注册工具 | 同上 |
| `get_commands` | 获取可用命令 | 同上 |

---

## 5. 响应格式与流式事件

详见：[rpc-events.md](rpc/rpc-events.md)

包含：
- 通用响应结构（`RpcResponseBase`）
- 成功/错误响应格式
- 完整响应类型映射表（30+ 命令的 data 类型）
- 流式事件：`agent_start/end`、`turn_start/end`、`message_start/update/end`、`tool_execution_*`、`queue_update`、`compaction_*`、`auto_retry_*`
- 完整事件流时序示例

---

## 6. Extension UI 交互协议

详见：[rpc-extension-ui.md](rpc/rpc-extension-ui.md)

包含：
- UI 请求方法：`select`、`confirm`、`input`、`editor`、`notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text`
- UI 响应格式
- Channel 数据协议

---

## 7. SessionManager 与会话文件格式

详见：[rpc-session-manager.md](rpc/rpc-session-manager.md)

包含：
- SessionManager 静态 API（扫描、列表、打开、创建、删除、重命名）
- SessionInfo 完整结构
- .jsonl 文件命名和内容格式
- Entry 类型一览（12 种）

---

## 8. 历史数据、WebUI 展示与源码索引

详见：[rpc-data-guide.md](rpc/rpc-data-guide.md)

包含：
- 历史数据 vs 实时事件的核心差异
- `buildSessionContext()` vs `getEntries()` 的正确用法
- 消息类型一致性与持久化映射
- Server API 设计建议
- 实时数据拼接方案
- WebUI 事件展示优先级（三个梯队）
- 事件流 → UI 渲染映射
- 历史数据 → UI 渲染映射
- 完整源码文件索引（RPC 层、Agent 核心、coding-agent 层、配置、AI Provider、Web UI）
