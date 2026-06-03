---

# RpcClient TypeScript API 参考

> 本文档描述 `RpcClient` 类的完整 TypeScript API，包括构造参数、所有方法签名、入参/出参类型，以及经过测试验证的真实示例。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)
> 源码位置：`packages/coding-agent/src/modes/rpc/rpc-client.ts`
> 测试文件：`packages/coding-agent/test/rpc*.test.ts`

---

## 目录

- [1. 概述](#1-概述)
- [2. 构造函数参数 (RpcClientOptions)](#2-构造函数参数-rpclientoptions)
- [3. 生命周期方法](#3-生命周期方法)
- [4. 事件订阅](#4-事件订阅)
- [5. 对话方法](#5-对话方法)
- [6. 模型管理](#6-模型管理)
- [7. 思考级别](#7-思考级别)
- [8. 排队模式](#8-排队模式)
- [9. 压缩与重试](#9-压缩与重试)
- [10. Bash 执行](#10-bash-执行)
- [11. 会话管理](#11-会话管理)
- [12. 消息查询](#12-消息查询)
- [13. 资源查询](#13-资源查询)
- [14. 设置管理](#14-设置管理)
- [15. 上下文与提示](#15-上下文与提示)
- [16. 工具管理](#16-工具管理)
- [17. 排队管理](#17-排队管理)
- [18. 扩展 Flag](#18-扩展-flag)
- [19. 其他](#19-其他)
- [20. 辅助方法](#20-辅助方法)
- [21. Channel 通信](#21-channel-通信)
- [22. 完整使用示例](#22-完整使用示例)
- [23. 测试验证](#23-测试验证)

---

## 1. 概述

`RpcClient` 是 pi coding agent 的 TypeScript SDK 客户端。它通过 spawn 子进程启动 `--mode rpc` 模式的 agent，然后通过 stdin/stdout JSONL 协议通信。

**两种调用方式对比**：

| 方式 | 类 | 是否需要子进程 | 适用场景 |
|------|------|---------------|---------|
| RPC 客户端 | `RpcClient` | 是（spawn） | WebUI Server、独立进程隔离 |
| 进程内直接调用 | `AgentSession` | 否 | 同进程集成（如 `mom` 包） |

**导入方式**：

```typescript
import { RpcClient } from "@dyyz1993/pi-coding-agent/modes/rpc/rpc-client";
// 或从源码
import { RpcClient } from "../src/modes/rpc/rpc-client.js";
```

---

## 2. 构造函数参数 (RpcClientOptions)

```typescript
const client = new RpcClient(options?: RpcClientOptions);
```

**所有参数均为可选**，无必填项。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `cliPath` | `string` | `"dist/cli.js"` | CLI 入口文件路径 |
| `cwd` | `string` | `undefined` | Agent 工作目录 |
| `env` | `Record<string, string>` | `undefined` | 额外环境变量（合并到 `process.env`） |
| `provider` | `string` | `undefined` | LLM 提供商（如 `"anthropic"`、`"openai"`） |
| `model` | `string` | `undefined` | 模型 ID（如 `"claude-sonnet-4-5"`） |
| `args` | `string[]` | `undefined` | 额外 CLI 参数 |

**构造示例**（来源：`test/rpc.test.ts:20-27`）：

```typescript
const client = new RpcClient({
  cliPath: join(__dirname, "..", "dist", "cli.js"),
  cwd: join(__dirname, ".."),
  env: { PI_CODING_AGENT_DIR: sessionDir },
  provider: "anthropic",
  model: "claude-sonnet-4-5",
});
```

**最简构造**（不指定 provider/model，使用默认配置）：

```typescript
const client = new RpcClient({
  cliPath: "dist/cli.js",
  cwd: "/path/to/project",
});
```

> **注意**：provider 和 model 仅作为初始默认值，后续可通过 `setModel()` 动态切换，无需重启进程。

---

## 3. 生命周期方法

### `start()` - 启动 Agent 进程

```typescript
async start(): Promise<void>
```

Spawn 子进程并建立 JSONL 通信。重复调用会抛出 `"Client already started"` 错误。

**入参**：无（配置通过构造函数传入）

**出参**：`Promise<void>`

**错误场景**：进程立即退出时抛出错误，包含 stderr 内容。

来源：`test/rpc.test.ts:37`

```typescript
await client.start();
```

### `stop()` - 停止 Agent 进程

```typescript
async stop(): Promise<void>
```

发送 SIGTERM 停止子进程，最多等待 1 秒后 SIGKILL 强制终止。清理所有 pending 请求。

来源：`test/rpc.test.ts:30`

```typescript
await client.stop();
```

### `getStderr()` - 获取 stderr 输出

```typescript
getStderr(): string
```

返回子进程累计的 stderr 输出，用于调试。

---

## 4. 事件订阅

### `onEvent()` - 订阅 Agent 事件

```typescript
onEvent(listener: (event: AgentEvent) => void): () => void
```

**入参**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `listener` | `(event: AgentEvent) => void` | 事件回调函数 |

**出参**：unsubscribe 函数 `() => void`

**示例**（来源：`test/rpc-example.ts:22-37`）：

```typescript
const unsubscribe = client.onEvent((event) => {
  if (event.type === "message_update") {
    const { assistantMessageEvent } = event;
    if (assistantMessageEvent.type === "text_delta") {
      process.stdout.write(assistantMessageEvent.delta);
    }
  }

  if (event.type === "tool_execution_start") {
    console.log(`\n[Tool: ${event.toolName}]`);
  }

  if (event.type === "tool_execution_end") {
    console.log(`[Result: ${JSON.stringify(event.result).slice(0, 200)}...]\n`);
  }

  if (event.type === "agent_end") {
    console.log("\n--- Agent finished ---");
  }
});

// 取消订阅
unsubscribe();
```

---

## 5. 对话方法

### `prompt()` - 发送消息

```typescript
async prompt(message: string, images?: ImageContent[]): Promise<void>
```

**入参**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | `string` | 是 | 用户消息 |
| `images` | `ImageContent[]` | 否 | 附带的图片 |

**出参**：`Promise<void>`（发送即返回，不等待完成。流式事件通过 `onEvent` 接收）

来源：`test/rpc.test.ts:51`

```typescript
await client.prompt("Reply with just the word 'hello'");
// 事件通过 onEvent 流式接收
await client.waitForIdle();
```

### `steer()` - 流式中断注入

```typescript
async steer(message: string, images?: ImageContent[]): Promise<void>
```

在 Agent 流式输出过程中注入中断消息。

```typescript
await client.steer("Actually, focus on the error handling instead");
```

### `followUp()` - 追加排队消息

```typescript
async followUp(message: string, images?: ImageContent[]): Promise<void>
```

在 Agent 完成当前回复后追加处理的消息。

```typescript
await client.followUp("Now explain the same in Chinese");
```

### `abort()` - 中断当前操作

```typescript
async abort(): Promise<void>
```

```typescript
await client.abort();
```

### `newSession()` - 新建会话

```typescript
async newSession(parentSession?: string): Promise<{ cancelled: boolean }>
```

**入参**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `parentSession` | `string` | 否 | 父会话路径，用于血缘追踪 |

**出参**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `cancelled` | `boolean` | 是否被扩展取消 |

来源：`test/rpc.test.ts:240-256`

```typescript
// 先发一个 prompt
await client.promptAndWait("Hello");

// 检查有消息
let state = await client.getState();
expect(state.messageCount).toBeGreaterThan(0);

// 新建会话
await client.newSession();

// 消息已清空
state = await client.getState();
expect(state.messageCount).toBe(0);
```

---

## 6. 模型管理

### `setModel()` - 切换模型

```typescript
async setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }>
```

**入参**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `provider` | `string` | 是 | 提供商名称 |
| `modelId` | `string` | 是 | 模型 ID |

**出参**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | `string` | 当前提供商 |
| `id` | `string` | 当前模型 ID |

**错误**：未知模型时 `throw Error`

来源：`test/rpc-resources.test.ts:93-107`

```typescript
// 正常切换
const models = await client.getAvailableModels();
const m = models[0];
const model = await client.setModel(m.provider, m.id);
// model = { provider: "anthropic", id: "claude-sonnet-4-5" }

// 未知模型会抛错
await expect(client.setModel("nonexistent", "no-such-model")).rejects.toThrow();
```

### `cycleModel()` - 循环切换下一个模型

```typescript
async cycleModel(): Promise<{
  model: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
  isScoped: boolean;
} | null>
```

**出参**：切换后的模型信息，或 `null`（无可切换模型）。

### `getAvailableModels()` - 获取可用模型列表

```typescript
async getAvailableModels(): Promise<ModelInfo[]>
```

**出参** `ModelInfo`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | `string` | 提供商 |
| `id` | `string` | 模型 ID |
| `contextWindow` | `number` | 上下文窗口大小 |
| `reasoning` | `boolean` | 是否支持推理 |

来源：`test/rpc.test.ts:212-225`

```typescript
const models = await client.getAvailableModels();
// models = [
//   { provider: "anthropic", id: "claude-sonnet-4-5", contextWindow: 200000, reasoning: true },
//   { provider: "openai", id: "gpt-4o", contextWindow: 128000, reasoning: false },
//   ...
// ]

for (const model of models) {
  expect(model.provider).toBeDefined();
  expect(model.id).toBeDefined();
  expect(model.contextWindow).toBeGreaterThan(0);
  expect(typeof model.reasoning).toBe("boolean");
}
```

---

## 7. 思考级别

### `setThinkingLevel()` - 设置思考级别

```typescript
async setThinkingLevel(level: ThinkingLevel): Promise<void>
```

**入参** `ThinkingLevel`：`"off"` | `"low"` | `"medium"` | `"high"`

来源：`test/rpc.test.ts:184-193`

```typescript
await client.setThinkingLevel("high");

const state = await client.getState();
expect(state.thinkingLevel).toBe("high");
```

### `cycleThinkingLevel()` - 循环切换思考级别

```typescript
async cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null>
```

来源：`test/rpc.test.ts:195-210`

```typescript
const initialState = await client.getState();
const initialLevel = initialState.thinkingLevel;

const result = await client.cycleThinkingLevel();
expect(result).toBeDefined();
expect(result!.level).not.toBe(initialLevel);

const newState = await client.getState();
expect(newState.thinkingLevel).toBe(result!.level);
```

---

## 8. 排队模式

### `setSteeringMode()` - 设置 steering 排队模式

```typescript
async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void>
```

来源：`test/rpc-resources.test.ts:130-135`

```typescript
await client.setSteeringMode("one-at-a-time");

const state = await client.getState();
expect(state.steeringMode).toBe("one-at-a-time");
```

### `setFollowUpMode()` - 设置 followUp 排队模式

```typescript
async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void>
```

来源：`test/rpc-resources.test.ts:137-142`

```typescript
await client.setFollowUpMode("one-at-a-time");

const state = await client.getState();
expect(state.followUpMode).toBe("one-at-a-time");
```

---

## 9. 压缩与重试

### `compact()` - 手动压缩上下文

```typescript
async compact(customInstructions?: string): Promise<CompactionResult>
```

**入参**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `customInstructions` | `string` | 否 | 自定义压缩指令 |

**出参** `CompactionResult`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `summary` | `string` | 压缩摘要 |
| `tokensBefore` | `number` | 压缩前 token 数 |

来源：`test/rpc.test.ts:89-117`

```typescript
await client.promptAndWait("Say hello");

const result = await client.compact();
expect(result.summary).toBeDefined();
expect(result.tokensBefore).toBeGreaterThan(0);
```

### `setAutoCompaction()` - 开关自动压缩

```typescript
async setAutoCompaction(enabled: boolean): Promise<void>
```

来源：`test/rpc-resources.test.ts:148-157`

```typescript
await client.setAutoCompaction(false);
let state = await client.getState();
expect(state.autoCompactionEnabled).toBe(false);

await client.setAutoCompaction(true);
state = await client.getState();
expect(state.autoCompactionEnabled).toBe(true);
```

### `setAutoRetry()` - 开关自动重试

```typescript
async setAutoRetry(enabled: boolean): Promise<void>
```

```typescript
await client.setAutoRetry(false);
await client.setAutoRetry(true);
```

### `abortRetry()` - 中止重试

```typescript
async abortRetry(): Promise<void>
```

---

## 10. Bash 执行

### `bash()` - 执行 bash 命令

```typescript
async bash(command: string): Promise<BashResult>
```

**入参**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | `string` | 是 | 要执行的 bash 命令 |

**出参** `BashResult`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `output` | `string` | 命令标准输出 |
| `exitCode` | `number` | 退出码 |
| `cancelled` | `boolean` | 是否被取消 |

来源：`test/rpc.test.ts:119-126`

```typescript
const result = await client.bash("echo hello");
expect(result.output.trim()).toBe("hello");
expect(result.exitCode).toBe(0);
expect(result.cancelled).toBe(false);
```

Bash 输出会自动注入到 Agent 上下文中（来源：`test/rpc.test.ts:160-182`）：

```typescript
const uniqueValue = `unique-${Date.now()}`;
await client.bash(`echo ${uniqueValue}`);

// Agent 能看到 bash 输出
const events = await client.promptAndWait(
  "What was the exact output of the echo command I just ran?"
);
// Agent 回复会包含 uniqueValue
```

### `abortBash()` - 中止 bash 命令

```typescript
async abortBash(): Promise<void>
```

---

## 11. 会话管理

### `getState()` - 获取会话状态

```typescript
async getState(): Promise<RpcSessionState>
```

**出参** `RpcSessionState`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | `Model \| undefined` | 当前模型信息 |
| `thinkingLevel` | `ThinkingLevel` | 当前思考级别 |
| `isStreaming` | `boolean` | 是否正在流式输出 |
| `isCompacting` | `boolean` | 是否正在压缩 |
| `steeringMode` | `"all" \| "one-at-a-time"` | steering 排队模式 |
| `followUpMode` | `"all" \| "one-at-a-time"` | followUp 排队模式 |
| `sessionFile` | `string \| undefined` | 会话文件路径 |
| `sessionId` | `string` | 会话 ID |
| `sessionName` | `string \| undefined` | 会话名称 |
| `autoCompactionEnabled` | `boolean` | 是否启用自动压缩 |
| `messageCount` | `number` | 消息数量 |
| `pendingMessageCount` | `number` | 排队消息数量 |

来源：`test/rpc-resources.test.ts:34-48`

```typescript
const state = await client.getState();
expect(state.model).toBeDefined();
expect(typeof state.model?.provider).toBe("string");
expect(typeof state.model?.id).toBe("string");
expect(state.isStreaming).toBe(false);
expect(state.isCompacting).toBe(false);
expect(["all", "one-at-a-time"]).toContain(state.steeringMode);
expect(["all", "one-at-a-time"]).toContain(state.followUpMode);
expect(state.sessionId).toBeDefined();
expect(typeof state.messageCount).toBe("number");
expect(typeof state.autoCompactionEnabled).toBe("boolean");
```

### `getSessionStats()` - 获取会话统计

```typescript
async getSessionStats(): Promise<SessionStats>
```

来源：`test/rpc.test.ts:227-238`

```typescript
await client.promptAndWait("Hello");

const stats = await client.getSessionStats();
expect(stats.sessionFile).toBeDefined();
expect(stats.sessionId).toBeDefined();
expect(stats.userMessages).toBeGreaterThanOrEqual(1);
expect(stats.assistantMessages).toBeGreaterThanOrEqual(1);
```

### `exportHtml()` - 导出为 HTML

```typescript
async exportHtml(outputPath?: string): Promise<{ path: string }>
```

来源：`test/rpc.test.ts:258-269`

```typescript
await client.promptAndWait("Hello");

const result = await client.exportHtml();
expect(result.path).toBeDefined();
expect(result.path.endsWith(".html")).toBe(true);
expect(existsSync(result.path)).toBe(true);
```

### `switchSession()` - 切换到指定会话

```typescript
async switchSession(sessionPath: string): Promise<{ cancelled: boolean }>
```

### `fork()` - 从指定消息分叉

```typescript
async fork(entryId: string): Promise<{ text: string; cancelled: boolean }>
```

### `clone()` - 克隆当前分支

```typescript
async clone(): Promise<{ cancelled: boolean }>
```

来源：`test/rpc-client-clone.test.ts:10-28`

```typescript
const result = await client.clone();
expect(result).toEqual({ cancelled: false });
```

### `getForkMessages()` - 获取可分叉的消息列表

```typescript
async getForkMessages(): Promise<Array<{ entryId: string; text: string }>>
```

来源：`test/rpc-resources.test.ts:67-71`

```typescript
const msgs = await client.getForkMessages();
expect(Array.isArray(msgs)).toBe(true);
```

### `getLastAssistantText()` - 获取最后一条 assistant 文本

```typescript
async getLastAssistantText(): Promise<string | null>
```

来源：`test/rpc.test.ts:271-284`

```typescript
// 初始为 null/undefined
let text = await client.getLastAssistantText();
expect(text).toBeUndefined();

// 发送 prompt 后
await client.promptAndWait("Reply with just: test123");
text = await client.getLastAssistantText();
expect(text).toContain("test123");
```

### `setSessionName()` - 设置会话名称

```typescript
async setSessionName(name: string): Promise<void>
```

来源：`test/rpc.test.ts:286-320`

```typescript
await client.promptAndWait("Reply with just 'ok'");

await client.setSessionName("my-test-session");

const state = await client.getState();
expect(state.sessionName).toBe("my-test-session");
```

---

## 12. 消息查询

### `getMessages()` - 获取所有消息

```typescript
async getMessages(): Promise<AgentMessage[]>
```

来源：`test/rpc-resources.test.ts:54-59`

```typescript
// 新会话为空
const messages = await client.getMessages();
expect(Array.isArray(messages)).toBe(true);
expect(messages.length).toBe(0);
```

---

## 13. 资源查询

### `getCommands()` - 获取可用命令

```typescript
async getCommands(): Promise<RpcSlashCommand[]>
```

**出参** `RpcSlashCommand`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 命令名（不含 `/`） |
| `description` | `string \| undefined` | 描述 |
| `source` | `"extension" \| "prompt" \| "skill"` | 来源类型 |
| `sourceInfo` | `SourceInfo` | 来源元数据 |

来源：`test/rpc-resources.test.ts:195-205`

```typescript
const commands = await client.getCommands();
for (const cmd of commands) {
  expect(cmd).toHaveProperty("name");
  expect(cmd).toHaveProperty("source");
  expect(["extension", "prompt", "skill"]).toContain(cmd.source);
  expect(cmd).toHaveProperty("sourceInfo");
}
```

### `getSkills()` - 获取已加载技能

```typescript
async getSkills(): Promise<RpcSkill[]>
```

**出参** `RpcSkill`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 技能名称 |
| `description` | `string` | 描述 |
| `filePath` | `string` | 文件路径 |
| `baseDir` | `string` | 基础目录 |
| `sourceInfo` | `SourceInfo` | 来源元数据 |
| `disableModelInvocation` | `boolean` | 是否禁止模型调用 |

来源：`test/rpc-resources.test.ts:211-227`

```typescript
const skills = await client.getSkills();
for (const skill of skills) {
  expect(typeof skill.name).toBe("string");
  expect(typeof skill.description).toBe("string");
  expect(typeof skill.filePath).toBe("string");
  expect(typeof skill.baseDir).toBe("string");
  expect(typeof skill.disableModelInvocation).toBe("boolean");
  expect(skill.sourceInfo).toHaveProperty("path");
  expect(skill.sourceInfo).toHaveProperty("source");
  expect(skill.sourceInfo).toHaveProperty("scope");
  expect(skill.sourceInfo).toHaveProperty("origin");
}
```

### `getExtensions()` - 获取已加载扩展

```typescript
async getExtensions(): Promise<RpcExtension[]>
```

**出参** `RpcExtension`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 扩展路径 |
| `resolvedPath` | `string` | 解析后的路径 |
| `sourceInfo` | `SourceInfo` | 来源元数据 |
| `toolNames` | `string[]` | 注册的工具名列表 |
| `commandNames` | `string[]` | 注册的命令名列表 |

来源：`test/rpc-resources.test.ts:245-260`

```typescript
const extensions = await client.getExtensions();
for (const ext of extensions) {
  expect(typeof ext.path).toBe("string");
  expect(typeof ext.resolvedPath).toBe("string");
  expect(Array.isArray(ext.toolNames)).toBe(true);
  expect(Array.isArray(ext.commandNames)).toBe(true);
}
```

### `getTools()` - 获取已注册工具

```typescript
async getTools(): Promise<RpcTool[]>
```

**出参** `RpcTool`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 工具名称 |
| `label` | `string` | 显示标签 |
| `description` | `string` | 描述 |
| `sourceInfo` | `SourceInfo` | 来源元数据 |

来源：`test/rpc-resources.test.ts:266-280`

```typescript
const tools = await client.getTools();
for (const tool of tools) {
  expect(typeof tool.name).toBe("string");
  expect(typeof tool.label).toBe("string");
  expect(typeof tool.description).toBe("string");
  expect(tool.sourceInfo).toHaveProperty("path");
}
```

**工具与扩展的一致性**（来源：`test/rpc-resources.test.ts:282-291`）：

```typescript
const tools = await client.getTools();
const extensions = await client.getExtensions();
const toolNames = new Set(tools.map((t) => t.name));
const extToolNames = extensions.flatMap((e) => e.toolNames);
// 所有扩展声明的工具都能在 getTools 中找到
for (const extToolName of extToolNames) {
  expect(toolNames.has(extToolName)).toBe(true);
}
```

---

## 14. 设置管理

### `getSettings()` - 获取设置

```typescript
async getSettings(scope?: "global" | "project"): Promise<Record<string, unknown>>
```

来源：`test/rpc-extended-commands.test.ts:35-58`

```typescript
// 合并设置（默认）
const settings = await client.getSettings();
expect(settings).toBeDefined();
expect(typeof settings).toBe("object");

// 全局设置
const globalSettings = await client.getSettings("global");

// 项目设置
const projectSettings = await client.getSettings("project");
```

### `setSettings()` - 修改设置

```typescript
async setSettings(settings: Record<string, unknown>, scope?: "global" | "project"): Promise<void>
```

来源：`test/rpc-extended-commands.test.ts:60-72`

```typescript
// 运行时覆盖
await client.setSettings({ hideThinkingBlock: true });

// 指定 scope
await client.setSettings({ hideThinkingBlock: false }, "global");
```

---

## 15. 上下文与提示

### `getContextUsage()` - 获取上下文使用率

```typescript
async getContextUsage(): Promise<RpcContextUsage>
```

**出参** `RpcContextUsage`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `tokens` | `number \| null` | 已用 token 数 |
| `contextWindow` | `number` | 上下文窗口大小 |
| `percent` | `number \| null` | 使用百分比 |

来源：`test/rpc-extended-commands.test.ts:79-96`

```typescript
const usage = await client.getContextUsage();
expect(typeof usage.contextWindow).toBe("number");
if (usage.percent !== null) {
  expect(typeof usage.percent).toBe("number");
  expect(usage.percent).toBeGreaterThanOrEqual(0);
}
```

### `getSystemPrompt()` - 获取系统提示

```typescript
async getSystemPrompt(): Promise<{ systemPrompt: string; appendSystemPrompt: string[] }>
```

来源：`test/rpc-extended-commands.test.ts:102-111`

```typescript
const promptInfo = await client.getSystemPrompt();
expect(typeof promptInfo.systemPrompt).toBe("string");
expect(Array.isArray(promptInfo.appendSystemPrompt)).toBe(true);
```

### `getAgentsFiles()` - 获取 AGENTS.md 内容

```typescript
async getAgentsFiles(): Promise<Array<{ path: string; content: string }>>
```

来源：`test/rpc-extended-commands.test.ts:209-217`

```typescript
const result = await client.getAgentsFiles();
expect(Array.isArray(result)).toBe(true);
```

---

## 16. 工具管理

### `getActiveTools()` - 获取启用的工具

```typescript
async getActiveTools(): Promise<string[]>
```

来源：`test/rpc-extended-commands.test.ts:117-124`

```typescript
const tools = await client.getActiveTools();
expect(Array.isArray(tools)).toBe(true);
```

### `setActiveTools()` - 动态启用/禁用工具

```typescript
async setActiveTools(toolNames: string[]): Promise<void>
```

来源：`test/rpc-extended-commands.test.ts:126-139`

```typescript
const before = await client.getActiveTools();
expect(before.length).toBeGreaterThan(0);

const subset = before.slice(0, 2);
await client.setActiveTools(subset);

const after = await client.getActiveTools();
expect(after.sort()).toEqual(subset.sort());
```

---

## 17. 排队管理

### `getQueue()` - 获取排队消息

```typescript
async getQueue(): Promise<{ steering: string[]; followUp: string[] }>
```

来源：`test/rpc-extended-commands.test.ts:145-156`

```typescript
const queue = await client.getQueue();
expect(Array.isArray(queue.steering)).toBe(true);
expect(Array.isArray(queue.followUp)).toBe(true);
expect(queue.steering.length).toBe(0);
expect(queue.followUp.length).toBe(0);
```

### `clearQueue()` - 清空排队消息

```typescript
async clearQueue(): Promise<{ steering: string[]; followUp: string[] }>
```

来源：`test/rpc-extended-commands.test.ts:158-167`

```typescript
const cleared = await client.clearQueue();
expect(Array.isArray(cleared.steering)).toBe(true);
expect(Array.isArray(cleared.followUp)).toBe(true);
```

---

## 18. 扩展 Flag

### `getFlags()` - 获取扩展注册的 flag 定义

```typescript
async getFlags(): Promise<RpcExtensionFlag[]>
```

**出参** `RpcExtensionFlag`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | Flag 名称 |
| `description` | `string \| undefined` | 描述 |
| `type` | `"boolean" \| "string"` | 类型 |
| `default` | `boolean \| string \| undefined` | 默认值 |
| `extensionPath` | `string` | 所属扩展路径 |

来源：`test/rpc-extended-commands.test.ts:173-181`

```typescript
const flags = await client.getFlags();
expect(Array.isArray(flags)).toBe(true);
```

### `getFlagValues()` - 获取 flag 当前值

```typescript
async getFlagValues(): Promise<Record<string, boolean | string>>
```

来源：`test/rpc-extended-commands.test.ts:183-191`

```typescript
const values = await client.getFlagValues();
expect(typeof values).toBe("object");
```

### `setFlag()` - 设置 flag 值

```typescript
async setFlag(name: string, value: boolean | string): Promise<void>
```

```typescript
await client.setFlag("myFlag", true);
await client.setFlag("myStringFlag", "value");
```

---

## 19. 其他

### `reload()` - 重载资源

```typescript
async reload(): Promise<void>
```

重载扩展、技能、设置等资源。

来源：`test/rpc-extended-commands.test.ts:197-203`

```typescript
await client.reload();
```

---

## 20. 辅助方法

### `waitForIdle()` - 等待 Agent 完成

```typescript
waitForIdle(timeout = 60000): Promise<void>
```

等待 `agent_end` 事件。超时（默认 60 秒）时 reject。

```typescript
await client.prompt("Hello");
await client.waitForIdle(); // 等待 agent 完成回复
```

### `collectEvents()` - 收集事件直到完成

```typescript
collectEvents(timeout = 60000): Promise<AgentEvent[]>
```

收集所有事件直到 `agent_end`。

来源：`test/rpc.test.ts:51`

```typescript
const events = await client.promptAndWait("Hello");
// events 包含所有流式事件
```

### `promptAndWait()` - 发送消息并等待完成

```typescript
async promptAndWait(message: string, images?: ImageContent[], timeout = 60000): Promise<AgentEvent[]>
```

等价于 `collectEvents()` + `prompt()`，返回所有事件。

```typescript
const events = await client.promptAndWait("Reply with just 'hello'", undefined, 30000);
```

---

## 21. Channel 通信

### `channel()` - 获取 Channel 对象

```typescript
channel(name: string): Pick<Channel, "name" | "send" | "onReceive" | "invoke" | "call">
```

扩展间双向通信通道。

```typescript
const ch = client.channel("my-channel");

// 监听服务端推送事件
const unsub = ch.onReceive((data) => {
  console.log("Received:", data);
});

// 单向发送消息（fire-and-forget）
ch.send({ action: "ping" });

// RPC 调用（等待响应）— 使用 call() 自动注入 __call 路由字段
const response = await ch.call("query", { param: "value" }, 30000);

// 低级 invoke（需手动指定 __call，推荐使用 call() 代替）
// const response = await ch.invoke({ __call: "query", param: "value" }, 30000);

// 取消监听
unsub();
```

---

## 22. 完整使用示例

### 基础对话（来源：`test/rpc-example.ts`）

```typescript
import { RpcClient } from "@dyyz1993/pi-coding-agent/modes/rpc/rpc-client";

const client = new RpcClient({
  cliPath: "dist/cli.js",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  args: ["--no-session"],
});

// 流式输出
client.onEvent((event) => {
  if (event.type === "message_update") {
    const { assistantMessageEvent } = event;
    if (assistantMessageEvent.type === "text_delta") {
      process.stdout.write(assistantMessageEvent.delta);
    }
  }
});

await client.start();

const state = await client.getState();
console.log(`Model: ${state.model?.provider}/${state.model?.id}`);

// 发送消息并等待
const events = await client.promptAndWait("Explain TypeScript generics briefly");
console.log("\nDone, received", events.length, "events");

await client.stop();
```

### 动态切换模型并执行 Bash

```typescript
const client = new RpcClient({
  cliPath: "dist/cli.js",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
});

await client.start();

// 查看可用模型
const models = await client.getAvailableModels();

// 切换模型
await client.setModel("openai", "gpt-4o");

// 执行 bash
const result = await client.bash("ls -la");
console.log(result.output);

// 发送 prompt（使用新模型）
await client.promptAndWait("Summarize the current directory");

await client.stop();
```

### 会话管理

```typescript
await client.start();

// 设置会话名称
await client.setSessionName("code-review-session");

// 发送消息
await client.promptAndWait("Review the code in src/index.ts");

// 获取状态
const state = await client.getState();
console.log(`Messages: ${state.messageCount}, Streaming: ${state.isStreaming}`);

// 导出 HTML
const html = await client.exportHtml();
console.log(`Exported to: ${html.path}`);

// 新建会话（清空消息）
await client.newSession();

await client.stop();
```

---

## 23. 测试验证

以下测试文件覆盖了 `RpcClient` 的所有方法，确保入参/出参的准确性：

| 测试文件 | 覆盖范围 |
|---------|---------|
| `test/rpc.test.ts` | `start`, `stop`, `getState`, `prompt`, `compact`, `bash`, `setThinkingLevel`, `cycleThinkingLevel`, `getAvailableModels`, `getSessionStats`, `newSession`, `exportHtml`, `getLastAssistantText`, `setSessionName` |
| `test/rpc-extended-commands.test.ts` | `getSettings`, `setSettings`, `getContextUsage`, `getSystemPrompt`, `getActiveTools`, `setActiveTools`, `getQueue`, `clearQueue`, `getFlags`, `getFlagValues`, `reload`, `getAgentsFiles` |
| `test/rpc-resources.test.ts` | `getState`, `getMessages`, `getLastAssistantText`, `getForkMessages`, `getSessionStats`, `getAvailableModels`, `setModel`, `setThinkingLevel`, `cycleThinkingLevel`, `setSteeringMode`, `setFollowUpMode`, `setAutoCompaction`, `setAutoRetry`, `setSessionName`, `bash`, `getCommands`, `getSkills`, `getExtensions`, `getTools`, `newSession` |
| `test/rpc-client-clone.test.ts` | `clone` |
| `test/rpc-prompt-response-semantics.test.ts` | `prompt` 响应语义（成功/失败/排队） |
| `test/rpc-jsonl.test.ts` | JSONL 帧协议 |

运行测试：

```bash
cd packages/coding-agent

# 运行全部 RPC 测试（需要 ANTHROPIC_API_KEY）
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rpc.test.ts
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rpc-extended-commands.test.ts
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rpc-resources.test.ts
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rpc-client-clone.test.ts
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rpc-prompt-response-semantics.test.ts
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rpc-jsonl.test.ts

# 交互式示例
npx tsx test/rpc-example.ts
```
