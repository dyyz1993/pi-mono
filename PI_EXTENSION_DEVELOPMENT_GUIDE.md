# Pi 扩展开发完整指南

## 一、扩展系统架构概览

### 1.1 核心设计理念

Pi 的扩展系统基于**事件驱动架构**，允许开发者在不修改核心代码的情况下扩展功能：

```
┌─────────────────────────────────────────────────────────┐
│                    pi 主程序                              │
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
pi 启动
  │
  ├─► 发现扩展 (discoverAndLoadExtensions)
  │    ├─~/.pi/agent/extensions/*.ts
  │    ├─~/.pi/agent/extensions/*/index.ts
  │    ├─.pi/extensions/*.ts
  │    └─.pi/extensions/*/index.ts
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
| **启动时** | pi 启动 | `resources_discover` 事件 |
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

## 三、在哪里植入扩展

### 3.1 生命周期植入点总览

根据文档中的生命周期事件，植入点分为以下几类：

#### 3.1.1 资源发现阶段
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

#### 3.1.2 会话管理阶段
**事件**: `session_start`, `session_before_switch`, `session_switch`, 
`session_before_fork`, `session_fork`, `session_before_compact`, 
`session_compact`, `session_before_tree`, `session_tree`, `session_shutdown`

**植入示例**:
```typescript
// 会话开始时恢复状态
pi.on("session_start", async (_event, ctx) => {
  // 从会话历史中恢复扩展状态
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "my-state") {
      restoreState(entry.data);
    }
  }
});

// 会话切换前确认
pi.on("session_before_switch", async (event, ctx) => {
  if (event.reason === "new") {
    const ok = await ctx.ui.confirm("清空？", "删除所有消息？");
    if (!ok) return { cancel: true }; // 取消切换
  }
});

// 会话结束时保存状态
pi.on("session_shutdown", async (_event, ctx) => {
  pi.appendEntry("my-state", saveState());
});
```

#### 3.1.3 用户输入处理阶段
**事件**: `input`, `before_agent_start`, `user_bash`

**植入示例**:
```typescript
// 输入转换
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

// 修改系统提示词
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

// 拦截用户 bash 命令
pi.on("user_bash", (event, ctx) => {
  if (event.command.startsWith("ssh ")) {
    return { operations: createRemoteBashOps() }; // 使用自定义操作
  }
});
```

#### 3.1.4 Agent 循环阶段
**事件**: `context`, `agent_start`, `agent_end`, 
`turn_start`, `turn_end`, 
`message_start`, `message_update`, `message_end`

**植入示例**:
```typescript
// 修改发送给 LLM 的上下文
pi.on("context", async (event, ctx) => {
  const filtered = event.messages.filter(m => !shouldPrune(m));
  return { messages: filtered };
});

// 监听消息流
pi.on("message_update", async (event, ctx) => {
  if (event.assistantMessageEvent.type === "text_delta") {
    // 实时更新 UI
  }
});
```

#### 3.1.5 工具调用阶段
**事件**: `tool_call`, `tool_execution_start`, 
`tool_execution_update`, `tool_execution_end`, 
`tool_result`, `model_select`

**植入示例**:
```typescript
// 工具调用拦截（权限检查）
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("bash", event)) {
    if (event.input.command.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("危险命令", "允许执行 rm -rf？");
      if (!ok) return { block: true, reason: "用户阻止" };
    }
  }
});

// 修改工具结果
pi.on("tool_result", async (event, ctx) => {
  if (event.toolName === "read") {
    // 添加语法高亮标记
    return {
      content: [{ type: "text", text: addSyntaxHighlighting(event.content) }],
    };
  }
});

// 模型切换通知
pi.on("model_select", async (event, ctx) => {
  const prev = event.previousModel 
    ? `${event.previousModel.provider}/${event.previousModel.id}`
    : "none";
  const next = `${event.model.provider}/${event.model.id}`;
  ctx.ui.notify(`模型已切换 (${event.source}): ${prev} -> ${next}`, "info");
});
```

#### 3.1.6 自定义工具注册
**方法**: `pi.registerTool()`

**植入示例**:
```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

pi.registerTool({
  name: "deploy",
  label: "部署应用",
  description: "将应用部署到指定环境",
  parameters: Type.Object({
    environment: StringEnum(["dev", "staging", "prod"] as const),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    ctx.ui.setStatus("deploy", `正在部署到 ${params.environment}...`);
    
    try {
      const result = await pi.exec("npm", ["run", "deploy", params.environment]);
      return {
        content: [{ type: "text", text: `部署成功！` }],
        details: { exitCode: result.code },
      };
    } finally {
      ctx.ui.setStatus("deploy", undefined);
    }
  },
  
  // 自定义渲染
  renderCall(args, theme) {
    return new Text(theme.fg("toolTitle", `部署 ${args.environment}`), 0, 0);
  },
  renderResult(result, { expanded, isPartial }, theme) {
    if (isPartial) return new Text("处理中...", 0, 0);
    return new Text(theme.fg("success", "✓ 部署完成"), 0, 0);
  },
});
```

#### 3.1.7 自定义命令注册
**方法**: `pi.registerCommand()`

**植入示例**:
```typescript
pi.registerCommand("stats", {
  description: "显示会话统计",
  getArgumentCompletions: (prefix) => {
    // 参数自动完成
    return [{ value: "tokens", label: "tokens" }];
  },
  handler: async (args, ctx) => {
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} 条消息`, "info");
  },
});
```

#### 3.1.8 快捷键注册
**方法**: `pi.registerShortcut()`

**植入示例**:
```typescript
pi.registerShortcut("ctrl+shift+p", {
  description: "切换计划模式",
  handler: async (ctx) => {
    ctx.ui.notify("已切换计划模式");
  },
});
```

#### 3.1.9 消息渲染器注册
**方法**: `pi.registerMessageRenderer()`

**植入示例**:
```typescript
pi.registerMessageRenderer("custom-notification", (message, options, theme) => {
  return new Text(theme.fg("accent", message.content), 0, 0);
});
```

---

## 四、扩展开发实战

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

- 避免在 `context` 事件中进行重计算
- 使用信号检查取消：`if (signal?.aborted) return;`
- 工具输出必须截断（默认 50KB/2000 行）

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

---

## 八、常见问题

### Q1: 扩展何时被加载？
**A**: pi 启动时自动发现，或通过 `-e` 参数显式加载。

### Q2: 如何调试扩展错误？
**A**: 使用 `--verbose` 标志，或捕获异常并显示：
```typescript
try {
  // 代码
} catch (error) {
  ctx.ui.notify(error.message, "error");
}
```

### Q3: 扩展可以访问哪些模块？
**A**: 
- Node.js 内置模块 (`node:fs`, `node:path` 等)
- `@mariozechner/pi-*` 包
- 扩展的 `node_modules/` 中的依赖

### Q4: 如何分发扩展？
**A**: 创建 Pi Package，发布到 npm 或 git：
```bash
pi install npm:@foo/my-pi-package
pi install git:github.com/user/repo
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

Pi 的扩展系统通过以下方式实现高度可扩展性：

1. **事件驱动**: 覆盖生命周期的每个关键节点
2. **工具注册**: 动态添加 LLM 能力
3. **UI 定制**: 完全控制界面组件
4. **会话持久**: 跨重启的状态管理
5. **热重载**: 无需重启 pi 即可更新扩展

通过合理使用这些机制，你可以将 pi 塑造成完全符合你工作流的工具。
