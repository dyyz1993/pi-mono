# Pi 扩展系统完整机制

## 概述

Pi 的扩展系统允许开发者通过 TypeScript 模块扩展 AI 编程助手的功能。扩展可以：
- 注册自定义工具（让 LLM 调用）
- 订阅生命周期事件
- 添加命令、快捷键和 CLI 标志
- 自定义消息渲染

## 核心架构

### 三层结构

```
ExtensionLoader (加载器)
    ↓ 创建扩展实例
ExtensionRunner (运行器)
    ↓ 管理运行时
ExtensionAPI (扩展 API)
    ↓ 提供给扩展使用
```

**ExtensionLoader** (`src/core/extensions/loader.ts`)
- 扫描并加载扩展模块
- 调用扩展的 `setup()` 函数
- 创建共享的运行时状态（`ExtensionRuntime`）
- 提供 `loadExtensions()` - 启动时加载所有扩展

**ExtensionRunner** (`src/core/extensions/runner.ts`)
- 管理扩展的事件分发
- 绑定核心功能（session, model, tools 等）
- 提供工具执行上下文
- 提供 `initialize()` - 绑定核心功能到运行时

**ExtensionAPI** (`src/core/extensions/types.ts`)
- 扩展可访问的 API 接口
- 包含 `on()` 订阅事件、`registerTool()` 注册工具等
- 在扩展 `setup()` 函数中作为 `pi` 参数传入

## 扩展生命周期

### 1. 扫描阶段（`discoverExtensions`）

```typescript
// 按优先级扫描扩展目录：
// 1. ~/.config/pi/extensions/*.js
// 2. ~/.pi/extensions/*.js
// 3. ./node_modules/@pi-extensions/*/index.js
// 4. ./pi-extensions/*/index.js
```

每个扩展模块应导出 `setup` 函数：
```typescript
export function setup(pi: ExtensionAPI) {
  // 注册工具、事件处理等
}
```

### 2. 加载阶段（`loadExtensions`）

```typescript
// 创建运行时状态（ExtensionRuntime）
const runtime: ExtensionRuntime = {
  flagValues: new Map(),
  pendingProviderRegistrations: [],
  registerProvider: ...,
  unregisterProvider: ...,
  // ... action stubs (会在 runner.initialize() 中替换)
  sendMessage: () => { throw new Error(...) },
  sendUserMessage: () => { throw new Error(...) },
  // ...
};

// 对每个扩展：
for (const extensionPath of extensionPaths) {
  const module = await import(extensionPath);
  const extension: Extension = {
    path: extensionPath,
    resolvedPath: ...,
    sourceInfo: createSourceInfo(extensionPath, { source: "extension" }),
    handlers: new Map(),      // 事件处理器
    tools: new Map(),         // 注册的工具
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  };
  
  // 创建 ExtensionAPI
  const pi = createExtensionAPI(extension, runtime);
  
  // 调用扩展的 setup 函数
  await module.setup(pi);
  
  extensions.push(extension);
}
```

### 3. 初始化阶段（`runner.initialize`）

```typescript
// 在 AgentSession 创建后调用
runner.initialize({
  getCwd: () => this._cwd,
  getSessionManager: () => this.sessionManager,
  getModel: () => this.model,
  // ... 绑定所有核心功能
  sendMessage: (msg) => this._sendMessage(msg),
  sendUserMessage: (content, options) => this._sendUserMessage(content, options),
  // ...
});

// 处理之前排队的 provider 注册
for (const { name, config } of runtime.pendingProviderRegistrations) {
  this._modelRegistry.registerProvider(name, ...);
}
```

### 4. 运行阶段

- **事件分发**：触发事件时，运行器调用所有已注册的处理器
- **工具执行**：LLM 调用工具时，运行器提供执行上下文
- **命令处理**：用户执行命令时，运行器提供命令上下文

## 工具注册机制

### ToolDefinition 接口

```typescript
interface ToolDefinition<TParams, TDetails, TState> {
  name: string;              // 工具名称（LLM 调用）
  label: string;             // UI 显示标签
  description: string;       // 给 LLM 的描述
  parameters: TSchema;       // TypeBox 参数 schema
  
  promptSnippet?: string;    // 系统提示片段
  promptGuidelines?: string[]; // 使用指南
  
  prepareArguments?: (args: unknown) => Static<TParams>;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext
  ) => Promise<AgentToolResult<TDetails>>;
  
  renderCall?: (args, theme, context) => Component;
  renderResult?: (result, options, theme, context) => Component;
}
```

### 注册流程

```typescript
// 扩展中注册
pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "Does something useful",
  parameters: Type.Object({
    action: Type.String(),
    target: Type.Optional(Type.String())
  }),
  promptSnippet: "my_tool: does something useful",
  promptGuidelines: ["Use my_tool when you need to do something"],
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // params.action, params.target 已验证
    // ctx.cwd, ctx.sessionManager, ctx.model 等可用
    
    // 返回结果
    return {
      content: [{ type: "text", text: "Done!" }],
      details: { ... }  // 可选的自定义详情
    };
  }
});
```

### 工具注册表刷新（`_refreshToolRegistry`）

```typescript
// 当扩展加载/卸载、工具启用/禁用时调用
private _refreshToolRegistry(options?: { 
  activeToolNames?: string[];
  includeAllExtensionTools?: boolean;
}): void {
  // 1. 收集所有工具
  const registeredTools = this._extensionRunner?.getAllRegisteredTools() ?? [];
  const allCustomTools = [
    ...registeredTools,
    ...this._customTools  // SDK 自定义工具
  ];
  
  // 2. 构建 ToolDefinitions Map
  this._toolDefinitions = new Map([
    ...this._baseToolDefinitions,  // 内置工具
    ...allCustomTools.map(t => [t.definition.name, t])
  ]);
  
  // 3. 提取工具提示信息
  this._toolPromptSnippets = extractSnippets(this._toolDefinitions);
  this._toolPromptGuidelines = extractGuidelines(this._toolDefinitions);
  
  // 4. 构建 ToolRegistry（包装后的 AgentTool）
  this._toolRegistry = new Map([
    ...wrapBaseTools(this._baseToolDefinitions),
    ...wrapExtensionTools(allCustomTools, this._extensionRunner)
  ]);
  
  // 5. 更新激活工具列表
  this.setActiveToolsByName(nextActiveToolNames);
}
```

### 系统提示生成

工具的 `promptSnippet` 和 `promptGuidelines` 会被注入到系统提示中：

```typescript
private _rebuildSystemPrompt(toolNames: string[]): string {
  const toolSnippets: Record<string, string> = {};
  const promptGuidelines: string[] = [];
  
  for (const name of toolNames) {
    const snippet = this._toolPromptSnippets.get(name);
    if (snippet) toolSnippets[name] = snippet;
    
    const guidelines = this._toolPromptGuidelines.get(name);
    if (guidelines) promptGuidelines.push(...guidelines);
  }
  
  return buildSystemPrompt({
    cwd: this._cwd,
    skills: loadedSkills,
    contextFiles: loadedContextFiles,
    selectedTools: toolNames,
    toolSnippets,
    promptGuidelines
  });
}
```

### 工具包装（`wrapToolDefinition`）

扩展工具通过包装器转换为 `AgentTool`：

```typescript
// 扩展工具的包装
function wrapRegisteredTool(tool: RegisteredTool, runner: ExtensionRunner): AgentTool {
  return wrapToolDefinition(tool.definition, () => runner.createContext());
}

// 通用包装器
function wrapToolDefinition(definition: ToolDefinition, createContext: () => ExtensionContext): AgentTool {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    execute: async (toolCallId, params, signal, onUpdate) => {
      // 1. 可选的参数预处理
      if (definition.prepareArguments) {
        params = definition.prepareArguments(params);
      }
      
      // 2. 创建执行上下文
      const ctx = createContext();
      
      // 3. 执行工具
      return await definition.execute(toolCallId, params, signal, onUpdate, ctx);
    }
  };
}
```

### 执行上下文（`ExtensionContext`）

工具执行时接收的上下文：

```typescript
interface ExtensionContext {
  ui: ExtensionUIContext;          // UI 交互方法
  hasUI: boolean;                  // UI 是否可用
  cwd: string;                     // 当前工作目录
  sessionManager: ReadonlySessionManager;
  modelRegistry: ModelRegistry;
  model: Model | undefined;        // 当前模型
  isIdle(): boolean;               // agent 是否空闲
  signal: AbortSignal | undefined; // 取消信号
  abort(): void;                   // 取消当前操作
  hasPendingMessages(): boolean;
  shutdown(): void;                // 优雅退出
  getContextUsage(): ContextUsage | undefined;
  compact(options?: CompactOptions): void;
  getSystemPrompt(): string;       // 当前系统提示
}
```

## 事件系统

### 事件类型

扩展可以订阅的事件：

```typescript
// 资源事件
"resources_discover"  // 发现额外资源路径

// 会话事件
"session_directory"   // 会话目录解析
"session_start"       // 会话启动/加载/重载
"session_before_switch" // 会话切换前（可取消）
"session_before_fork" // 会话分叉前（可取消）
"session_before_compact" // 上下文压缩前（可取消）
"session_compact"     // 上下文压缩完成
"session_shutdown"    // 进程退出
"session_before_tree" // 树导航前（可取消）
"session_tree"        // 树导航完成

// Agent 事件
"context"             // LLM 调用前（可修改消息）
"before_provider_request" // Provider 请求前
"before_agent_start"  // Agent 启动前
"agent_start"         // Agent 循环开始
"agent_end"           // Agent 循环结束
"turn_start"          // 轮次开始
"turn_end"            // 轮次结束
"message_start"       // 消息开始
"message_update"      // 消息更新（流式）
"message_end"         // 消息结束

// 工具事件
"tool_execution_start"   // 工具开始执行
"tool_execution_update"  // 工具执行更新
"tool_execution_end"     // 工具执行结束
"tool_call"          // 工具调用前（可阻止）
"tool_result"        // 工具结果（可修改）

// 其他事件
"model_select"       // 模型切换
"user_bash"          // 用户 bash 命令
"input"              // 用户输入
```

### 事件处理

```typescript
// 简单事件
pi.on("agent_start", (event, ctx) => {
  console.log("Agent started");
});

// 带返回值的事件
pi.on("tool_call", (event, ctx) => {
  if (event.toolName === "bash" && event.input.command.includes("rm")) {
    return { block: true, reason: "Dangerous command" };
  }
});

// 修改事件数据
pi.on("tool_result", (event, ctx) => {
  if (event.toolName === "bash") {
    // 修改工具结果
    return {
      content: [{ type: "text", text: "Modified: " + event.content[0].text }]
    };
  }
});
```

### 事件分发机制

```typescript
// runner.ts
async dispatchEvent<E extends ExtensionEvent>(
  eventType: E["type"],
  event: E
): Promise<any> {
  const results = [];
  
  for (const extension of this._extensions) {
    const handlers = extension.handlers.get(eventType) ?? [];
    for (const handler of handlers) {
      try {
        const ctx = this.createContext();
        const result = await handler(event, ctx);
        results.push(result);
      } catch (error) {
        this._handleExtensionError(extension, eventType, error);
      }
    }
  }
  
  return results;
}
```

## 自定义消息渲染

扩展可以注册自定义消息渲染器：

```typescript
// 1. 发送自定义消息
pi.sendMessage({
  customType: "myapp.status",
  content: "Operation completed",
  details: { count: 42, status: "success" }
});

// 2. 注册渲染器
pi.registerMessageRenderer("myapp.status", (message, options, theme) => {
  const data = message.details as { count: number; status: string };
  return new BoxComponent({
    children: [
      `Status: ${data.status}`,
      `Count: ${data.count}`
    ]
  });
});
```

## 命令系统

### 注册命令

```typescript
pi.registerCommand("mycommand", {
  description: "My custom command",
  async handler(args, ctx) {
    // ctx 是 ExtensionCommandContext，包含额外方法：
    // - waitForIdle()
    // - newSession()
    // - fork()
    // - navigateTree()
    // - switchSession()
    // - reload()
    
    console.log(`Command executed with args: ${args}`);
  },
  
  // 可选：参数自动补全
  getArgumentCompletions(prefix) {
    return [
      { text: "option1", description: "First option" },
      { text: "option2", description: "Second option" }
    ];
  }
});
```

### 执行命令

```bash
# 用户执行
/mycommand arg1 arg2
```

## 快捷键和标志

### 快捷键

```typescript
pi.registerShortcut("ctrl+shift+m", {
  description: "Toggle my feature",
  handler(ctx) {
    console.log("Shortcut triggered!");
  }
});
```

### CLI 标志

```typescript
pi.registerFlag("myflag", {
  type: "string",
  description: "My custom flag",
  default: "default-value"
});

// 在事件处理器中读取
pi.on("session_start", (event, ctx) => {
  const value = pi.getFlag("myflag");
  console.log(`Flag value: ${value}`);
});
```

## Provider 注册

扩展可以注册自定义模型提供商：

```typescript
pi.registerProvider("my-proxy", {
  baseUrl: "https://proxy.example.com",
  apiKey: "PROXY_API_KEY",
  api: "anthropic-messages",
  models: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude 4 Sonnet (proxy)",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ]
});

// 或仅覆盖现有 provider 的 baseUrl
pi.registerProvider("anthropic", {
  baseUrl: "https://my-anthropic-proxy.com"
});

// 注销 provider
pi.unregisterProvider("my-proxy");
```

## 工具动态管理

扩展可以在运行时管理工具：

```typescript
// 获取当前激活的工具
const activeTools = pi.getActiveTools();
// ["read", "write", "edit", "bash", "grep", "find", "ls", "my_tool"]

// 获取所有工具信息
const allTools = pi.getAllTools();
// [{ name: "read", parameters: {...}, sourceInfo: {...} }, ...]

// 设置激活工具
pi.setActiveTools(["read", "write", "bash"]);

// 刷新工具注册表（通常不需要手动调用）
pi.refreshTools();
```

## 最佳实践

### 1. 错误处理

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  try {
    // 执行操作
    const result = await someAsyncOperation();
    return {
      content: [{ type: "text", text: JSON.stringify(result) }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
}
```

### 2. 流式更新

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  const chunks = [];
  
  for (let i = 0; i < 10; i++) {
    if (signal?.aborted) break;
    
    const chunk = await getChunk(i);
    chunks.push(chunk);
    
    // 发送更新
    onUpdate?.({
      type: "update",
      partialResult: { chunks, progress: (i + 1) / 10 }
    });
  }
  
  return {
    content: [{ type: "text", text: "Complete" }],
    details: { chunks }
  };
}
```

### 3. 取消支持

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  const controller = new AbortController();
  
  // 合并取消信号
  const combinedSignal = signal 
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  
  try {
    const result = await fetch(url, { signal: combinedSignal });
    return { content: [{ type: "text", text: await result.text() }] };
  } catch (error) {
    if (error.name === "AbortError") {
      return { 
        content: [{ type: "text", text: "Operation cancelled" }],
        isError: true 
      };
    }
    throw error;
  }
}
```

### 4. 资源清理

```typescript
let cleanup: (() => void) | undefined;

pi.on("session_start", (event, ctx) => {
  // 设置资源
  cleanup = setupResource();
});

pi.on("session_shutdown", (event, ctx) => {
  // 清理资源
  cleanup?.();
});
```

## 调试技巧

### 1. 查看工具注册

```typescript
pi.on("session_start", (event, ctx) => {
  console.log("Active tools:", pi.getActiveTools());
  console.log("All tools:", pi.getAllTools().map(t => t.name));
});
```

### 2. 拦截工具调用

```typescript
pi.on("tool_call", (event, ctx) => {
  console.log("Tool call:", event.toolName, event.input);
  
  // 修改参数
  if (event.toolName === "bash") {
    event.input.command = "echo 'modified: " + event.input.command + "'";
  }
});
```

### 3. 监控消息流

```typescript
pi.on("message_update", (event, ctx) => {
  if (event.message.role === "assistant") {
    console.log("Assistant update:", event.assistantMessageEvent);
  }
});
```

## 总结

Pi 的扩展系统设计精巧，提供了：

1. **完整的生命周期管理**：从加载、初始化到运行
2. **灵活的工具注册**：支持自定义 schema、渲染、流式更新
3. **强大的事件系统**：可拦截、修改、取消各种操作
4. **丰富的上下文**：工具和事件处理器都能访问核心功能
5. **动态管理**：运行时可以启用/禁用工具

通过这个系统，开发者可以深度集成自定义功能，扩展 Pi 的能力边界。
