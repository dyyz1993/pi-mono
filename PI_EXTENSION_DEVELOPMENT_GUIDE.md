# PI 扩展开发完整指南

> 本指南基于 PI 官方扩展系统文档和最佳实践整理

## 目录

1. [架构概览](#一架构概览)
2. [扩展生命周期](#二扩展生命周期)
3. [植入点详解](#三植入点详解)
4. [实战开发](#四实战开发)
5. [最佳实践](#五最佳实践)
6. [高级主题](#六高级主题)
7. [调试技巧](#七调试技巧)
8. [常见问题](#八常见问题)

---

## 一、架构概览

### 1.1 核心设计理念

PI 的扩展系统基于**事件驱动架构**，允许开发者在不修改核心代码的情况下扩展功能：

```
┌─────────────────────────────────────────────────────────┐
│                    PI 主程序                              │
├─────────────────────────────────────────────────────────┤
│  生命周期事件 → ExtensionRunner → 扩展处理器              │
│  用户输入      → 扩展拦截/转换                            │
│  工具调用      → 扩展注册/拦截/修改                       │
│  UI 渲染        → 扩展自定义组件                          │
└─────────────────────────────────────────────────────────┘
```

### 1.2 扩展能力矩阵

| 能力类别 | 具体功能 | API 方法 |
|---------|---------|---------|
| **事件订阅** | 生命周期、工具、会话、消息事件 | `pi.on()` |
| **工具注册** | 自定义 LLM 可调用的工具 | `pi.registerTool()` |
| **命令注册** | 自定义 `/command` 命令 | `pi.registerCommand()` |
| **快捷键** | 全局键盘快捷键 | `pi.registerShortcut()` |
| **CLI 参数** | 命令行参数定义 | `pi.registerFlag()` |
| **UI 交互** | 对话框、通知、状态栏、组件 | `ctx.ui.*` |
| **消息渲染** | 自定义消息类型渲染 | `pi.registerMessageRenderer()` |
| **会话管理** | 持久化状态、标签、命名 | `pi.appendEntry()`, `pi.setLabel()` |
| **模型管理** | 切换模型、注册 Provider | `pi.setModel()`, `pi.registerProvider()` |

---

## 二、扩展生命周期

### 2.1 完整生命周期流程图

```
PI 启动
  │
  ├─► 发现扩展 (discoverAndLoadExtensions)
  │    ├─ ~/.pi/agent/extensions/*.ts
  │    ├─ ~/.pi/agent/extensions/*/index.ts
  │    ├─ .pi/extensions/*.ts
  │    └─ .pi/extensions/*/index.ts
  │
  ├─► 加载扩展 (loader.ts)
  │    ├─ 使用 jiti 加载 TypeScript/JavaScript
  │    ├─ 执行扩展工厂函数：export default function(pi: ExtensionAPI)
  │    └─ 收集注册的工具、命令、事件处理器
  │
  ├─► session_start 事件
  │    └─ 扩展初始化、状态恢复
  │
  └─► 运行循环 (runner.ts)
       │
       ├─► 用户输入
       │    ├─ 检查扩展命令 (优先)
       │    ├─ input 事件 (可拦截/转换)
       │    ├─ 技能/模板扩展
       │    └─ before_agent_start 事件
       │
       ├─► Agent 循环
       │    ├─ context 事件 (修改上下文)
       │    ├─ turn_start/turn_end
       │    ├─ message_start/update/end
       │    ├─ tool_call 事件 (可拦截)
       │    ├─ tool_execution_start/update/end
       │    └─ tool_result 事件 (可修改结果)
       │
       ├─► 会话操作
       │    ├─ session_before_switch/fork/tree/compact
       │    └─ session_switch/fork/tree/compact
       │
       └─► session_shutdown 事件
            └─ 清理资源、保存状态
```

### 2.2 扩展加载时机

| 阶段 | 触发器 | 可扩展点 |
|-----|--------|---------|
| **启动时** | PI 启动 | `resources_discover` 事件 |
| **会话初始化** | `session_start` | 恢复状态、初始化 UI |
| **热重载** | `/reload` 命令 | 重新加载扩展、触发 `session_shutdown` → `session_start` |
| **运行时** | 动态注册 | `pi.registerProvider()` |

### 2.3 事件处理顺序

```typescript
// 同一事件有多个扩展处理器时的执行顺序
// 1. 按照扩展加载顺序执行
// 2. 某些事件支持结果链接 (如 tool_result, before_agent_start)
// 3. 错误不会中断其他扩展的执行

pi.on("tool_result", async (event, ctx) => {
  // 第一个扩展看到原始结果
  return { content: [...modified] }; // 下一个扩展看到修改后的结果
});
```

---

## 三、植入点详解

### 3.1 资源发现阶段

**事件**: `resources_discover`

**用途**: 动态提供技能、提示模板、主题路径

```typescript
pi.on("resources_discover", async (event, ctx) => {
  return {
    skillPaths: ["/path/to/skills"],
    promptPaths: ["/path/to/prompts"],
    themePaths: ["/path/to/themes"],
  };
});
```

### 3.2 会话管理阶段

**事件**: 
- `session_start` - 会话开始
- `session_before_switch` - 会话切换前
- `session_switch` - 会话切换后
- `session_before_fork` - 会话分叉前
- `session_fork` - 会话分叉后
- `session_before_compact` - 会话压缩前
- `session_compact` - 会话压缩后
- `session_before_tree` - 会话树操作前
- `session_tree` - 会话树操作后
- `session_shutdown` - 会话结束

**示例：会话开始时恢复状态**

```typescript
pi.on("session_start", async (_event, ctx) => {
  // 从会话历史中恢复扩展状态
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "my-state") {
      restoreState(entry.data);
    }
  }
});
```

**示例：会话切换前确认**

```typescript
pi.on("session_before_switch", async (event, ctx) => {
  if (event.reason === "new") {
    const ok = await ctx.ui.confirm("清空？", "删除所有消息？");
    if (!ok) return { cancel: true }; // 取消切换
  }
});
```

**示例：会话结束时保存状态**

```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  pi.appendEntry("my-state", saveState());
});
```

### 3.3 用户输入处理阶段

**事件**:
- `input` - 用户输入处理
- `before_agent_start` - Agent 启动前
- `user_bash` - 用户 Bash 命令

**示例：输入转换**

```typescript
pi.on("input", async (event, ctx) => {
  if (event.text.startsWith("?quick ")) {
    return {
      action: "transform",
      text: `简要回答：${event.text.slice(7)}`,
    };
  }
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" }; // 跳过 LLM
  }
  return { action: "continue" };
});
```

**示例：修改系统提示词**

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    message: {
      customType: "extension-context",
      content: "额外上下文信息",
      display: true,
    },
    systemPrompt: event.systemPrompt + "\n\n本次对话的特殊指示...",
  };
});
```

**示例：拦截用户 bash 命令**

```typescript
pi.on("user_bash", (event, ctx) => {
  if (event.command.startsWith("ssh ")) {
    return { operations: createRemoteBashOps() }; // 使用自定义操作
  }
});
```

### 3.4 Agent 循环阶段

**事件**:
- `context` - 修改发送给 LLM 的上下文
- `agent_start` - Agent 启动
- `agent_end` - Agent 结束
- `turn_start` - 对话轮次开始
- `turn_end` - 对话轮次结束
- `message_start` - 消息开始
- `message_update` - 消息更新（流式）
- `message_end` - 消息结束

**示例：修改上下文**

```typescript
pi.on("context", async (event, ctx) => {
  const filtered = event.messages.filter(m => !shouldPrune(m));
  return { messages: filtered };
});
```

**示例：监听消息流**

```typescript
pi.on("message_update", async (event, ctx) => {
  if (event.assistantMessageEvent.type === "text_delta") {
    // 实时更新 UI
    console.log("收到文本片段:", event.assistantMessageEvent.text);
  }
});
```

### 3.5 工具调用阶段

**事件**:
- `tool_call` - 工具调用（可拦截）
- `tool_execution_start` - 工具执行开始
- `tool_execution_update` - 工具执行更新
- `tool_execution_end` - 工具执行结束
- `tool_result` - 工具结果（可修改）
- `model_select` - 模型切换

**示例：工具调用拦截（权限检查）**

```typescript
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("bash", event)) {
    if (event.input.command.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("危险命令", "允许执行 rm -rf？");
      if (!ok) return { block: true, reason: "用户阻止" };
    }
  }
});
```

**示例：修改工具结果**

```typescript
pi.on("tool_result", async (event, ctx) => {
  if (event.toolName === "read") {
    // 添加语法高亮标记
    return {
      content: [{ type: "text", text: addSyntaxHighlighting(event.content) }],
    };
  }
});
```

**示例：模型切换通知**

```typescript
pi.on("model_select", async (event, ctx) => {
  const prev = event.previousModel 
    ? `${event.previousModel.provider}/${event.previousModel.id}`
    : "none";
  const next = `${event.model.provider}/${event.model.id}`;
  ctx.ui.notify(`模型已切换 (${event.source}): ${prev} -> ${next}`, "info");
});
```

### 3.6 自定义工具注册

**方法**: `pi.registerTool()`

**完整示例：**

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "atonal";

pi.registerTool({
  name: "deploy",
  label: "部署应用",
  description: "将应用部署到指定环境",
  parameters: Type.Object({
    environment: StringEnum(["dev", "staging", "prod"] as const),
    force: Type.Optional(Type.Boolean({ description: "强制部署" })),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    ctx.ui.setStatus("deploy", `正在部署到 ${params.environment}...`);
    
    try {
      // 检查取消信号
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "部署已取消" }] };
      }
      
      // 执行部署
      const result = await pi.exec("npm", ["run", "deploy", params.environment]);
      
      return {
        content: [{ type: "text", text: `部署成功！\n${result.stdout}` }],
        details: { exitCode: result.code },
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `部署失败: ${error.message}` }],
        isError: true,
      };
    } finally {
      ctx.ui.setStatus("deploy", undefined);
    }
  },
  
  // 自定义渲染（调用时）
  renderCall(args, theme) {
    return new Text(theme.fg("toolTitle", `部署 ${args.environment}`), 0, 0);
  },
  
  // 自定义渲染（结果）
  renderResult(result, { expanded, isPartial }, theme) {
    if (isPartial) return new Text("处理中...", 0, 0);
    if (result.isError) {
      return new Text(theme.fg("error", "✗ 部署失败"), 0, 0);
    }
    return new Text(theme.fg("success", "✓ 部署完成"), 0, 0);
  },
});
```

### 3.7 自定义命令注册

**方法**: `pi.registerCommand()`

```typescript
pi.registerCommand("stats", {
  description: "显示会话统计",
  getArgumentCompletions: (prefix) => {
    return [
      { value: "tokens", label: "Token 统计" },
      { value: "messages", label: "消息统计" },
    ].filter(item => item.value.startsWith(prefix));
  },
  handler: async (args, ctx) => {
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} 条消息`, "info");
  },
});
```

### 3.8 快捷键注册

**方法**: `pi.registerShortcut()`

```typescript
pi.registerShortcut("ctrl+shift+p", {
  description: "切换计划模式",
  handler: async (ctx) => {
    ctx.ui.notify("已切换计划模式");
  },
});
```

### 3.9 消息渲染器注册

**方法**: `pi.registerMessageRenderer()`

```typescript
pi.registerMessageRenderer("custom-notification", (message, options, theme) => {
  return new Text(theme.fg("accent", message.content), 0, 0);
});
```

---

## 四、实战开发

### 4.1 扩展结构

#### 方式 1: 单文件扩展
```
~/.pi/agent/extensions/
└── my-extension.ts
```

#### 方式 2: 目录结构（多文件）
```
~/.pi/agent/extensions/
└── my-extension/
    ├── package.json       # 声明依赖
    ├── package-lock.json
    ├── node_modules/      # 依赖
    └── src/
        ├── index.ts       # 入口
        ├── tools.ts       # 工具定义
        └── utils.ts       # 辅助函数
```

#### 方式 3: Pi Package（可分享）
```json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./src/index.ts"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

### 4.2 最小扩展示例

```typescript
// ~/.pi/agent/extensions/hello.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function(pi: ExtensionAPI) {
  // 1. 事件监听
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Hello Extension 已加载!", "info");
  });

  // 2. 自定义工具
  pi.registerTool({
    name: "hello",
    label: "打招呼",
    description: "向某人打招呼",
    parameters: Type.Object({
      name: Type.String({ description: "姓名" }),
    }),
    async execute(toolCallId, params) {
      return {
        content: [{ type: "text", text: `你好，${params.name}!` }],
      };
    },
  });

  // 3. 自定义命令
  pi.registerCommand("hello", {
    description: "打招呼",
    handler: async (args, ctx) => {
      ctx.ui.notify(`你好，${args || "世界"}!`, "info");
    },
  });
}
```

### 4.3 完整扩展示例：Git 检查点

```typescript
// ~/.pi/agent/extensions/git-checkpoint.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function(pi: ExtensionAPI) {
  let checkpointCount = 0;

  // 恢复状态
  pi.on("session_start", async (_event, ctx) => {
    checkpointCount = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.toolName === "git_checkpoint") {
        checkpointCount++;
      }
    }
    ctx.ui.setStatus("git-checkpoint", `检查点：${checkpointCount}`);
  });

  // 拦截工具调用
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      const confirmed = await ctx.ui.confirm(
        "文件修改",
        `确认修改 ${event.input.path}？`,
        { timeout: 10000 }
      );
      if (!confirmed) {
        return { block: true, reason: "用户拒绝" };
      }
    }
  });

  // 工具执行后创建 Git 检查点
  pi.on("tool_execution_end", async (event, ctx) => {
    if (["write", "edit"].includes(event.toolName)) {
      await pi.exec("git", ["add", "-A"]);
      const result = await pi.exec("git", [
        "commit",
        "-m",
        `Auto-checkpoint #${++checkpointCount}`,
      ]);
      
      pi.appendEntry("checkpoint", {
        count: checkpointCount,
        hash: result.stdout.slice(0, 7),
      });
      
      ctx.ui.setStatus("git-checkpoint", `检查点：${checkpointCount}`);
    }
  });

  // 清理
  pi.on("session_shutdown", async () => {
    ctx.ui.setStatus("git-checkpoint", undefined);
  });
}
```

---

## 五、最佳实践

### 5.1 状态管理

**推荐**: 将状态存储在工具结果的 `details` 中

```typescript
pi.registerTool({
  async execute(toolCallId, params) {
    return {
      content: [{ type: "text", text: "完成" }],
      details: { items: [...items] }, // 用于重建状态
    };
  },
});
```

### 5.2 错误处理

```typescript
pi.on("tool_call", async (event, ctx) => {
  try {
    // 处理逻辑
  } catch (error) {
    ctx.ui.notify(`错误：${error.message}`, "error");
    return { block: true, reason: error.message };
  }
});
```

### 5.3 性能优化

- ❌ 避免在 `context` 事件中进行重计算
- ✅ 使用信号检查取消：`if (signal?.aborted) return;`
- ✅ 工具输出必须截断（默认 50KB/2000 行）

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  // 长时间操作前检查取消
  if (signal?.aborted) {
    return { content: [{ type: "text", text: "已取消" }] };
  }
  
  // 大量输出时截断
  const output = longOutput.slice(0, 50000);
  return {
    content: [{ type: "text", text: output + "\n... (截断)" }],
  };
}
```

### 5.4 测试扩展

```bash
# 直接加载扩展
pi -e ./my-extension.ts

# 调试模式（查看详细日志）
pi -e ./my-extension.ts --verbose

# 热重载
/reload
```

---

## 六、高级主题

### 6.1 覆盖内置工具

```typescript
pi.registerTool({
  name: "read", // 覆盖内置 read 工具
  label: "Read File",
  description: "读取文件内容",
  parameters: Type.Object({
    path: Type.String(),
  }),
  async execute(toolCallId, params) {
    // 添加日志
    console.log(`读取：${params.path}`);
    // 调用内置逻辑或自定义实现
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(params.path, "utf-8");
    return {
      content: [{ type: "text", text: content }],
    };
  },
});
```

### 6.2 远程执行

```typescript
import { createBashTool } from "@mariozechner/pi-coding-agent";

const sshBash = createBashTool(cwd, {
  spawnHook: ({ command, cwd, env }) => ({
    command: `ssh user@host "cd ${cwd} && ${command}"`,
    cwd,
    env,
  }),
});

pi.registerTool({
  ...sshBash,
  // 重写执行逻辑
});
```

### 6.3 跨扩展通信

```typescript
// 扩展 A
pi.events.emit("my:event", { data: "value" });

// 扩展 B
pi.events.on("my:event", (data) => {
  console.log("收到事件:", data);
});
```

### 6.4 Provider 注册

```typescript
pi.registerProvider("my-proxy", {
  baseUrl: "https://proxy.example.com",
  apiKey: "PROXY_API_KEY",
  api: "anthropic-messages",
  models: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude 4 Sonnet (代理)",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0 },
      contextWindow: 200000,
      maxTokens: 16384,
    },
  ],
});
```

---

## 七、调试技巧

### 7.1 查看扩展加载

```bash
# 列出已加载的扩展
pi list

# 查看启动日志
pi --verbose
```

### 7.2 SQLite 数据库检查

```bash
# 查看会话数据库
sqlite3 ~/.pi/agent/sessions/<session-id>.jsonl
SELECT * FROM custom_entries WHERE custom_type = 'my-state';
```

### 7.3 热重载调试

```typescript
// 在扩展中添加命令触发重载
pi.registerCommand("reload-self", {
  handler: async (_args, ctx) => {
    await ctx.reload();
  },
});
```

### 7.4 日志记录

```typescript
// 使用 console.log 和 --verbose 查看
pi.on("tool_call", async (event, ctx) => {
  console.log("[my-extension] Tool called:", event.toolName);
  // ...
});
```

---

## 八、常见问题

### Q1: 扩展何时被加载？

**A**: PI 启动时自动发现，或通过 `-e` 参数显式加载。

加载路径优先级：
1. `-e` 参数指定的文件
2. `~/.pi/agent/extensions/*.ts`
3. `~/.pi/agent/extensions/*/index.ts`
4. `.pi/extensions/*.ts`
5. `.pi/extensions/*/index.ts`
6. Pi Package 中的扩展

### Q2: 如何调试扩展错误？

**A**: 使用 `--verbose` 标志，或捕获异常并显示：

```typescript
try {
  // 代码
} catch (error) {
  ctx.ui.notify(error.message, "error");
  console.error("[my-extension] Error:", error);
}
```

### Q3: 扩展可以访问哪些模块？

**A**: 
- ✅ Node.js 内置模块 (`node:fs`, `node:path`, `node:child_process` 等)
- ✅ `@mariozechner/pi-*` 包
- ✅ 扩展的 `node_modules/` 中的依赖
- ❌ PI 核心内部模块

### Q4: 如何分发扩展？

**A**: 创建 Pi Package，发布到 npm 或 git：

```bash
# 打包
npm pack

# 从 npm 安装
pi install npm:@foo/my-pi-package

# 从 Git 安装
pi install git:github.com/user/repo

# 从本地文件安装
pi install ./my-pi-package-1.0.0.tgz
```

### Q5: 如何处理工具调用的并发？

**A**: 使用工具 ID 和状态管理：

```typescript
const toolStates = new Map<string, any>();

pi.registerTool({
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    toolStates.set(toolCallId, { status: "running" });
    
    try {
      // 长时间操作
      onUpdate({ content: [{ type: "text", text: "进行中..." }] });
      
      const result = await longOperation();
      return { content: [{ type: "text", text: result }] };
    } finally {
      toolStates.delete(toolCallId);
    }
  },
});
```

### Q6: 如何自定义工具的 UI 渲染？

**A**: 使用 `renderCall` 和 `renderResult`：

```typescript
pi.registerTool({
  name: "my-tool",
  // ...
  renderCall(args, theme) {
    // 自定义调用时的显示
    return new Text(
      theme.fg("toolTitle", "🔧 执行: ") +
      theme.fg("accent", args.action),
      0, 0
    );
  },
  renderResult(result, { expanded, isPartial }, theme) {
    // 自定义结果的显示
    if (isPartial) {
      return new Text(theme.fg("muted", "⏳ 处理中..."), 0, 0);
    }
    if (result.isError) {
      return new Text(theme.fg("error", "✗ 失败"), 0, 0);
    }
    return new Text(theme.fg("success", "✓ 成功"), 0, 0);
  },
});
```

---

## 九、参考资源

- **官方文档**: [docs/extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- **示例扩展**: [examples/extensions/](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
- **类型定义**: [src/core/extensions/types.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts)
- **加载器**: [src/core/extensions/loader.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/loader.ts)
- **运行器**: [src/core/extensions/runner.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/runner.ts)

---

## 十、总结

PI 的扩展系统通过以下方式实现高度可扩展性：

1. **事件驱动**: 覆盖生命周期的每个关键节点
2. **工具注册**: 动态添加 LLM 能力
3. **UI 定制**: 完全控制界面组件
4. **会话持久**: 跨重启的状态管理
5. **热重载**: 无需重启 PI 即可更新扩展

通过合理使用这些机制，你可以将 PI 塑造成完全符合你工作流的工具。
