# RpcClient 实战指南：服务端集成、数据恢复与数据结构对比

> 本文档面向需要构建 Web UI Server 的开发者，提供完整的 RpcClient 集成方案。
> 重点解决三个问题：
> 1. 如何初始化和使用 RpcClient
> 2. 页面刷新后如何完美恢复数据（历史 + 实时衔接）
> 3. 三种数据源的结构差异与正确用法
>
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)
> API 参考：[rpc-client-api.md](rpc-client-api.md)

---

## 目录

- [1. 服务端集成架构](#1-服务端集成架构)
- [2. 三种数据源对比](#2-三种数据源对比)
- [3. SessionManager vs session.jsonl：数据结构详解](#3-sessionmanager-vs-sessionjsonl数据结构详解)
- [4. RpcClient 完整初始化与使用](#4-rpclient-完整初始化与使用)
- [5. 页面刷新恢复方案](#5-页面刷新恢复方案)
- [6. 数据结构一致性保证](#6-数据结构一致性保证)
- [7. 常见错误与避坑指南](#7-常见错误与避坑指南)
- [8. 完整示例代码](#8-完整示例代码)

---

## 1. 服务端集成架构

```
┌──────────┐     WebSocket      ┌──────────────────┐    JSONL stdin/stdout    ┌────────────────┐
│  Web UI  │ ◄───────────────► │  你的 Server     │ ◄──────────────────────► │  pi --mode rpc │
│ (Browser)│                    │  (RpcClient)     │                          │  (子进程)       │
└──────────┘                    │                  │                          └────────────────┘
                                │  职责：           │
                                │  1. 持有 Client  │
                                │  2. 转发事件     │
                                │  3. 断线不杀进程  │
                                └──────────────────┘
```

**核心原则**：RpcClient 是长生命周期对象，Web UI 可以随时断开/重连，RpcClient 和它的子进程不需要重启。

---

## 2. 三种数据源对比

服务端可以接触到三种数据源，它们的结构和用途完全不同：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        三种数据源全景图                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  数据源 A: getMessages()           返回类型: AgentMessage[]                  │
│  ━━━━━━━━━━━━━━━━━━━              来源: agent.state.messages（内存）        │
│  → 内存中的完整消息数组                                                       │
│  → 包含已持久化的 + 正在 streaming 的                                         │
│  → 没有 envelope 包裹，直接就是消息本身                                        │
│                                                                             │
│  数据源 B: session.jsonl 文件       返回类型: FileEntry[] (JSON Lines)       │
│  ━━━━━━━━━━━━━━━━━━━━━━           来源: 磁盘文件，append-only                │
│  → 持久化的全部 entry（不只是消息）                                             │
│  → 消息被 SessionMessageEntry envelope 包裹                                   │
│  → 还包含 model_change, compaction, label, custom 等非消息 entry              │
│  → 只有 message_end 后才写入                                                   │
│                                                                             │
│  数据源 C: onEvent() 流式事件       返回类型: AgentEvent 流                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━          来源: AgentSession 实时推送               │
│  → 实时事件流（agent_start, message_update, message_end, ...）                │
│  → message_end.message 是 AgentMessage（与 getMessages 同类型）               │
│  → 从进程启动就开始流出，永不停止                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 核心结构差异

| 维度 | `getMessages()` | session.jsonl | `onEvent()` 流 |
|------|-----------------|---------------|----------------|
| **返回类型** | `AgentMessage[]` | `SessionEntry[]`（多种 type） | `AgentEvent` 流 |
| **消息包裹** | 直接就是 `AgentMessage` | `SessionMessageEntry { type, id, parentId, timestamp, message }` 包裹 | `message_end.message` 直接是 `AgentMessage` |
| **包含范围** | 仅消息 | 消息 + 元数据变更 + 压缩记录 + 扩展数据 + ... | 消息 + 工具执行 + 状态变更 + ... |
| **更新时机** | 调用时读内存快照 | `message_end` 后写磁盘 | 持续实时推送 |
| **streaming 半成品** | ✅ 包含 | ❌ 不包含（只有 message_end 才写） | ✅ 通过 message_update 推送 |
| **树结构信息** | ❌ 扁平数组 | ✅ id/parentId 构成树 | ❌ 扁平事件 |

### 结构示例对比

同一条用户消息，在三种数据源中的样子：

```typescript
// ====== 数据源 A: getMessages() 返回的 AgentMessage ======
{
  id: "msg_abc123",
  role: "user",
  content: [{ type: "text", text: "帮我分析代码" }],
  timestamp: 1706000001000
}

// ====== 数据源 B: session.jsonl 中的 SessionMessageEntry ======
{
  type: "message",           // ← envelope 标识
  id: "entry_xyz789",        // ← entry 自身 id（与消息 id 不同！）
  parentId: "entry_prev",    // ← 树结构父节点
  timestamp: "2025-01-20T10:30:01.000Z",  // ← entry 时间戳
  message: {                 // ← 消息本体嵌套在这里
    id: "msg_abc123",
    role: "user",
    content: [{ type: "text", text: "帮我分析代码" }],
    timestamp: 1706000001000
  }
}

// ====== 数据源 C: message_start 事件 ======
{
  type: "message_start",     // ← 事件类型
  message: {                 // ← 消息本体
    id: "msg_abc123",
    role: "user",
    content: [{ type: "text", text: "帮我分析代码" }],
    timestamp: 1706000001000
  }
}

// ====== 数据源 C: message_end 事件 ======
{
  type: "message_end",       // ← 事件类型
  message: {                 // ← 消息本体（最终完整版）
    id: "msg_abc123",
    role: "user",
    content: [{ type: "text", text: "帮我分析代码" }],
    timestamp: 1706000001000
  }
}
```

**关键发现**：

1. `getMessages()` 和 `message_end.message` 是**同一类型**（`AgentMessage`），可以直接拼接
2. `session.jsonl` 的消息多了一层 envelope（`SessionMessageEntry`），需要 `.message` 取出
3. Entry 的 `id` 和 message 的 `id` 是**两个不同的 id**，不要混淆

---

## 3. SessionManager vs session.jsonl：数据结构详解

### SessionManager 是什么

`SessionManager` 是一个操作 `.jsonl` 会话文件的类。有两种使用方式：

```typescript
// 方式 1: 通过 SessionManager 静态 API（直接读文件）
import { SessionManager } from "@dyyz1993/pi-coding-agent/core/session-manager";
const sm = SessionManager.open("/path/to/session.jsonl");
const entries = sm.getEntries();   // SessionEntry[]

// 方式 2: 通过 RpcClient（远程获取）
const messages = await client.getMessages();  // AgentMessage[]
```

### getEntries() 返回的完整结构

```typescript
const entries = sm.getEntries();
// 返回类型: SessionEntry[]
// 这是 session.jsonl 文件中每行 JSON 的解析结果

// 每种 entry 的结构：
```

| Entry Type | 结构 | 说明 |
|-----------|------|------|
| `session` | `{ type: "session", version: 3, id, timestamp, cwd }` | 文件头 |
| `message` | `{ type: "message", id, parentId, timestamp, message: AgentMessage }` | **消息包裹在 .message 中** |
| `model_change` | `{ type: "model_change", id, parentId, timestamp, provider, modelId }` | 模型切换 |
| `thinking_level_change` | `{ type: "thinking_level_change", id, parentId, timestamp, thinkingLevel }` | 思考级别变更 |
| `compaction` | `{ type: "compaction", id, parentId, timestamp, summary, firstKeptEntryId, tokensBefore, details? }` | 上下文压缩 |
| `branch_summary` | `{ type: "branch_summary", id, parentId, timestamp, fromId, summary, details? }` | 分支摘要 |
| `custom` | `{ type: "custom", id, parentId, timestamp, customType, data? }` | 扩展私有数据 |
| `custom_message` | `{ type: "custom_message", id, parentId, timestamp, customType, content, details?, display }` | 扩展消息 |
| `label` | `{ type: "label", id, parentId, timestamp, targetId, label }` | 书签 |
| `session_info` | `{ type: "session_info", id, parentId, timestamp, name? }` | 会话元数据 |
| `deletion` | `{ type: "deletion", id, parentId, timestamp, targetIds }` | 删除记录 |

### 直接读取 session.jsonl 文件 vs SessionManager API

两者数据**完全一致**。`SessionManager` 的 `getEntries()` 就是解析 `.jsonl` 文件的每一行：

```typescript
// 手动读取（不推荐）
const content = readFileSync("session.jsonl", "utf8");
const entries = content.trim().split("\n").map(line => JSON.parse(line));

// SessionManager 读取（推荐）
const sm = SessionManager.open("session.jsonl");
const entries = sm.getEntries();
// 结果完全一致，但 SessionManager 还提供树结构、header 解析等能力
```

### getMessages() vs session.jsonl entries：取消息的正确方式

```typescript
// ❌ 错误方式 1：把 session.jsonl 的 entry 直接当消息用
const entries = sm.getEntries();
const messages = entries.filter(e => e.type === "message");
// messages[0].content  ← 错误！entry 没有 content
// messages[0].message.content  ← 正确，但要记得 .message

// ❌ 错误方式 2：把 entry.id 当作 message.id
const entry = entries.find(e => e.type === "message");
// entry.id 是 entry 的 id（如 "entry_abc"）
// entry.message.id 是消息的 id（如 "msg_xyz"）
// 这两个 ID 不同！事件流中用的是 message.id

// ✅ 正确方式 1：从 entries 取消息
const entries = sm.getEntries();
const agentMessages = entries
  .filter((e): e is SessionMessageEntry => e.type === "message")
  .map(e => e.message);  // ← 取 .message 得到 AgentMessage

// ✅ 正确方式 2：通过 RpcClient（推荐，包含 streaming 半成品）
const messages = await client.getMessages();  // 直接就是 AgentMessage[]
```

### 为什么不应该用 buildSessionContext() 做 UI 渲染

```typescript
// ❌ 这是给 LLM 用的，会丢数据
const ctx = sm.buildSessionContext();
// ctx.messages 是 AgentMessage[]，但：
// - 丢失了 custom/label/session_info/model_change 等 entry
// - 被压缩的旧消息被替换为摘要
// - deletion 标记的消息被过滤掉
// - model_change 只保留最终值

// ✅ UI 应该用 getEntries() 获取全部原始数据
const entries = sm.getEntries();
// 或者用 getMessages() 获取当前内存中的完整消息列表
```

---

## 4. RpcClient 完整初始化与使用

### 服务端启动

```typescript
import { RpcClient } from "@dyyz1993/pi-coding-agent/modes/rpc/rpc-client";

// 服务启动时初始化一次，长生命周期
const client = new RpcClient({
  cliPath: "dist/cli.js",
  cwd: "/path/to/project",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
});

await client.start();

// 注册事件转发（一直运行，不受 WS 连接影响）
client.onEvent((event) => {
  // 转发给所有已连接的 WS 客户端
  broadcastToClients(event);
});
```

### 核心方法调用模式

```typescript
// 发消息（不等待完成）
await client.prompt("帮我分析代码");

// 等待完成
await client.waitForIdle();

// 或者一步到位
const events = await client.promptAndWait("帮我分析代码");
```

### 获取数据的三种场景

```typescript
// 场景 1：获取当前所有消息（含 streaming 半成品）
const messages: AgentMessage[] = await client.getMessages();

// 场景 2：获取运行状态
const state = await client.getState();
// state.isStreaming: boolean — 是否还在运行
// state.messageCount: number — 消息数量
// state.model: { provider, id } — 当前模型

// 场景 3：实时事件流（通过 onEvent 持续接收）
client.onEvent((event) => {
  switch (event.type) {
    case "message_start":
      // 新消息开始 → event.message
      break;
    case "message_update":
      // 流式更新 → event.message（完整消息，不是 delta）
      //           → event.assistantMessageEvent（delta 信息）
      break;
    case "message_end":
      // 消息完成 → event.message（最终完整版本）
      break;
    case "agent_end":
      // 全部完成 → event.messages（所有消息的最终快照）
      break;
  }
});
```

---

## 5. 页面刷新恢复方案

### 时序图

```
时间 ──────────────────────────────────────────────────────────────────►

Web UI (旧)              Server (RpcClient)                 Agent 进程
    │                         │                                 │
    │  prompt("分析代码")      │                                 │
    │──────────────────────►  │  client.prompt()                │
    │                         │───────────────────────────────► │
    │                         │                                 │ agent_start
    │  ◄─ message_start       │  ◄─ message_start              │ message_start (user)
    │  ◄─ message_update ...  │  ◄─ message_update             │ message_update (delta)
    │  ◄─ message_update ...  │  ◄─ message_update             │
    │                         │                                 │
    │  ✕ 页面刷新              │                                 │
    │  ═══════════════        │                                 │
    │                         │                                 │
    │                         │  ⚠️ 进程不停！事件继续流           │ 仍在运行...
    │                         │  （没有 WS 客户端，事件被丢弃）     │
    │                         │                                 │
    │  WS 重连                 │                                 │
    │──────────────────────►  │                                 │
    │                         │                                 │
    │                         │  ① getMessages()                │
    │                         │───────────────────────────────► │
    │                         │  ◄─ { messages: [...] }         │
    │                         │     包含：user msg +             │
    │                         │     partial assistant msg       │
    │                         │                                 │
    │                         │  ② getState()                   │
    │                         │───────────────────────────────► │
    │                         │  ◄─ { isStreaming: true, ... }  │
    │                         │                                 │
    │  ◄─ init { messages,    │                                 │
    │           isStreaming }  │                                 │
    │                         │                                 │
    │  渲染历史 + 半成品消息   │                                 │
    │  显示 "正在思考..."      │                                 │
    │                         │                                 │
    │  ◄─ message_update      │  ◄─ message_update             │ message_update
    │  (自动更新对应消息)      │                                 │
    │                         │                                 │
    │  ◄─ message_end         │  ◄─ message_end                │ message_end
    │  (最终确认)             │                                 │
    │                         │                                 │
    │  ◄─ agent_end           │  ◄─ agent_end                  │ agent_end
    │  隐藏 spinner ✓         │                                 │
```

### 恢复步骤代码

```typescript
// WS 客户端连接时（包括首次连接和刷新重连）
function handleClientConnect(ws: WebSocket) {
  // Step 1: 获取快照
  const [messages, state] = await Promise.all([
    client.getMessages(),
    client.getState(),
  ]);

  // Step 2: 发送初始化数据
  ws.send(JSON.stringify({
    type: "init",
    messages,  // AgentMessage[] — 完整消息列表
    state: {
      isStreaming: state.isStreaming,
      model: state.model,
      messageCount: state.messageCount,
    },
  }));

  // Step 3: 后续事件由全局 onEvent 转发，无需额外操作
  // 全局 onEvent 在 client.start() 后就已注册
}
```

### 前端处理逻辑

```typescript
// 收到 init 后
function handleInit(data: { messages: AgentMessage[]; state: SessionState }) {
  // 直接渲染所有消息
  for (const msg of data.messages) {
    renderMessage(msg);
    // 最后一条 assistant 消息可能只有一半文字
    // 没关系，后续 message_update 会整体替换
  }

  // 状态指示
  if (data.state.isStreaming) {
    showSpinner();
  }
}

// 收到后续事件后
function handleEvent(event: AgentEvent) {
  switch (event.type) {
    case "message_start":
      // 新消息，追加到列表
      appendMessage(event.message);
      break;

    case "message_update":
      // 用 message.id 找到已渲染的消息，整体替换
      updateMessage(event.message.id, event.message);
      break;

    case "message_end":
      // 最终完整消息，整体替换
      updateMessage(event.message.id, event.message);
      break;

    case "tool_execution_start":
      showToolIndicator(event.toolCallId, event.toolName, event.args);
      break;

    case "tool_execution_end":
      updateToolResult(event.toolCallId, event.result, event.isError);
      break;

    case "agent_end":
      hideSpinner();
      break;
  }
}
```

### 为什么不会丢数据

```
getMessages() 调用时刻                    后续事件
       │                                     │
       ▼                                     ▼
  内存快照: msg_A (完整)                message_update: msg_A (更新后)
           msg_B (partial, id="b1")     message_end: msg_B (完整, id="b1")
                                               msg_C (新消息)

  时间顺序严格保证：
  1. getMessages() 返回时，快照是那一刻的确切状态
  2. 后续事件都是快照之后产生的
  3. 快照中的 partial 消息和后续 update 的消息 id 相同
  4. 前端按 id 整体替换，不存在追加导致的重复
```

### 为什么不会重复

```
快照中:
  messages: [
    { id: "user_1", role: "user", content: "分析代码" },
    { id: "asst_1", role: "assistant", content: "我来帮你分析...当前进度到这里" }
    //                  ↑ 这是 streaming 到此刻的累积文本
  ]

后续事件:
  message_update: { message: { id: "asst_1", content: "我来帮你分析...当前进度到这里...继续输出" } }
  //               ↑ 同一个 id="asst_1"，content 是更新后的完整内容

前端处理:
  renderMessage(asst_1, "我来帮你分析...当前进度到这里")  // init 时渲染
  updateMessage(asst_1, "我来帮你分析...当前进度到这里...继续输出")  // update 时整体替换
  // 不是追加！是按 id 找到后整体替换 content
```

---

## 6. 数据结构一致性保证

以下一致性由架构设计保证，经过测试验证（`test/rpc.test.ts`, `test/rpc-resources.test.ts`）：

### 一致性 1: getMessages() = message_end 事件的累积

```
当 agent 空闲时（isStreaming = false）:

  getMessages() 返回的 AgentMessage[]
  ≡
  所有 message_end.message 的累积
  ≡
  session.jsonl 中 type="message" 的 entries 取 .message
```

### 一致性 2: streaming 期间 getMessages() 包含更多数据

```
当 agent 运行中时（isStreaming = true）:

  getMessages() 返回的 AgentMessage[]
  ⊃
  session.jsonl 中 type="message" 的 entries 取 .message

  差异部分 = 正在 streaming 的消息（还没触发 message_end，还没写磁盘）
```

### 一致性 3: message_update 中的 message 字段是完整对象

```
message_update 事件:
  event.message          → 完整的 AgentMessage（含到此刻的所有累积内容）
  event.assistantMessageEvent → delta 信息（text_delta, tool_call 等）

  不要只看 delta！前端应该用 event.message 整体替换，
  event.assistantMessageEvent 仅用于判断变化类型。
```

### 一致性 4: 最终一致性在 agent_end

```
agent_end 事件:
  event.messages → AgentMessage[] — 与 getMessages() 完全一致

  这是最终快照，可用于校正前端状态。
```

---

## 7. 常见错误与避坑指南

### 错误 1: 混用 entry.id 和 message.id

```typescript
// ❌ 错误：entry.id 和 message.id 是不同的东西
const entries = sm.getEntries();
const entry = entries.find(e => e.type === "message");
// entry.id = "entry_abc123"     ← entry 的 ID（树结构用）
// entry.message.id = "msg_xyz"  ← 消息的 ID（事件流中用）

// 事件流中用的是 message.id，不是 entry.id
// 前端按 message.id 做消息匹配和更新
```

### 错误 2: 从 session.jsonl 取消息时忘记 .message

```typescript
// ❌ 错误
const entries = sm.getEntries();
const messages = entries.filter(e => e.type === "message");
messages[0].content  // undefined! entry 没有 content

// ✅ 正确
const agentMessages = entries
  .filter((e): e is SessionMessageEntry => e.type === "message")
  .map(e => e.message);  // ← 取 .message
agentMessages[0].content  // 正确
```

### 错误 3: 用 buildSessionContext() 做 UI 渲染

```typescript
// ❌ 错误：丢失 compaction 前的旧消息、custom entry、label 等
const ctx = sm.buildSessionContext();
const messages = ctx.messages;

// ✅ 正确：用 getEntries() 获取全部原始数据
const entries = sm.getEntries();
// 或者用 getMessages() 获取当前内存中的完整消息列表
```

### 错误 4: 把 message_update 当 delta 追加

```typescript
// ❌ 错误：delta 追加会导致重复
let text = existingMessage.content;
text += event.assistantMessageEvent.delta;  // 可能重复

// ✅ 正确：整体替换
updateMessage(event.message.id, event.message);
// event.message 是更新后的完整消息，直接替换
```

### 错误 5: WS 断开时 kill 进程

```typescript
// ❌ 错误：刷新一次就重启一次，丢失 streaming 状态
ws.on("close", async () => {
  await client.stop();
});

// ✅ 正确：断开 WS 不影响进程，重连时拉快照恢复
ws.on("close", () => {
  // 什么都不做，client 继续运行
});

ws.on("connect", async () => {
  const messages = await client.getMessages();
  const state = await client.getState();
  ws.send({ type: "init", messages, state });
});
```

### 错误 6: 用 session.jsonl 的消息时间戳排序

```typescript
// ❌ session.jsonl 是 append-only，但 compaction/fork 会产生分支
// entry 有 id/parentId 构成树结构，不是简单的线性列表

// ✅ 用 getMessages() 获取线性消息列表（已经处理好了分支）
// ✅ 或用 getTree() 获取完整树结构用于分支浏览
```

---

## 8. 完整示例代码

### 服务端最小实现

```typescript
import { RpcClient } from "@dyyz1993/pi-coding-agent/modes/rpc/rpc-client";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";

// 全局唯一，长生命周期
const client = new RpcClient({
  cliPath: "dist/cli.js",
  cwd: process.env.PROJECT_DIR,
  provider: "anthropic",
  model: "claude-sonnet-4-5",
});

await client.start();

// 已连接的 WS 客户端
const clients = new Set<WebSocket>();

// 全局事件转发
client.onEvent((event: AgentEvent) => {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    ws.send(data);
  }
});

// WebSocket 连接处理
function handleConnect(ws: WebSocket) {
  clients.add(ws);

  // 初始化：发送快照
  (async () => {
    const [messages, state] = await Promise.all([
      client.getMessages(),
      client.getState(),
    ]);
    ws.send(JSON.stringify({
      type: "init",
      messages,
      state: {
        isStreaming: state.isStreaming,
        model: state.model,
        messageCount: state.messageCount,
      },
    }));
  })();

  // 接收前端消息
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    switch (msg.type) {
      case "prompt":
        client.prompt(msg.message, msg.images);
        break;
      case "steer":
        client.steer(msg.message);
        break;
      case "abort":
        client.abort();
        break;
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    // 不 kill client！
  });
}
```

### 前端最小实现

```typescript
let ws: WebSocket;
const messageMap = new Map<string, AgentMessage>();

function connect() {
  ws = new WebSocket("ws://localhost:3000");

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "init") {
      // 初始化：渲染快照
      messageMap.clear();
      for (const msg of data.messages) {
        messageMap.set(msg.id, msg);
      }
      renderAll();
      if (data.state.isStreaming) {
        showSpinner();
      }
      return;
    }

    // 实时事件处理
    switch (data.type) {
      case "message_start":
        messageMap.set(data.message.id, data.message);
        renderAll();
        break;

      case "message_update":
        messageMap.set(data.message.id, data.message);
        renderAll();
        break;

      case "message_end":
        messageMap.set(data.message.id, data.message);
        renderAll();
        break;

      case "agent_start":
        showSpinner();
        break;

      case "agent_end":
        hideSpinner();
        break;

      case "tool_execution_start":
        showToolStatus(data.toolCallId, data.toolName);
        break;

      case "tool_execution_end":
        hideToolStatus(data.toolCallId, data.result);
        break;
    }
  };

  ws.onclose = () => {
    setTimeout(connect, 1000);  // 自动重连
  };
}

function sendPrompt(text: string) {
  ws.send(JSON.stringify({ type: "prompt", message: text }));
}

function renderAll() {
  const container = document.getElementById("messages");
  container.innerHTML = "";
  for (const [id, msg] of messageMap) {
    const el = createMessageElement(msg);
    container.appendChild(el);
  }
}
```

---

## 测试验证

| 测试文件 | 验证内容 |
|---------|---------|
| `test/rpc.test.ts` | start/stop, getMessages 与 session.jsonl 的一致性, message_end 写入 |
| `test/rpc-resources.test.ts` | getMessages, getState, getForkMessages 等查询方法 |
| `test/rpc-data-consistency.test.ts` | 三种数据源结构对比、streaming 期间 getMessages 包含半成品、刷新恢复模拟 |
| `test/rpc-jsonl.test.ts` | JSONL 帧协议正确性 |

运行测试：

```bash
cd packages/coding-agent

# 需要 ANTHROPIC_API_KEY
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rpc.test.ts
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rpc-data-consistency.test.ts

# 不需要 API key
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rpc-jsonl.test.ts
```
