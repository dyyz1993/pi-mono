# 实践指南：使用 pi 构建 AI Agent

本文档提供使用 `@mariozechner/pi-ai` 和 `@mariozechner/pi-agent` 构建 AI 应用的实践指南。

## 目录

1. [快速开始](#快速开始)
2. [基础用法](#基础用法)
3. [工具开发](#工具开发)
4. [Provider 集成](#provider-集成)
5. [事件处理](#事件处理)
6. [高级主题](#高级主题)
7. [最佳实践](#最佳实践)
8. [常见问题](#常见问题)

---

## 快速开始

### 安装依赖

```bash
# 安装核心包
npm install @mariozechner/pi-ai @mariozechner/pi-agent

# 可选：安装 CLI 和工具
npm install @mariozechner/pi-cli @mariozechner/pi-tools
```

### 最小示例

```typescript
import { Agent } from "@mariozechner/pi-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import { anthropic } from "@mariozechner/pi-ai/providers";

// 1. 创建 Agent
const agent = new Agent({
  initialState: {
    model: {
      id: "claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet",
      api: "anthropic-messages",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 8192,
    },
    systemPrompt: "You are a helpful assistant.",
    messages: [],
    tools: [],
    thinkingLevel: "medium",
  },
  streamFn: streamSimple,
});

// 2. 订阅事件
agent.subscribe((event) => {
  if (event.type === "message_update") {
    // 处理增量更新
    const content = event.message.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("");
    process.stdout.write(content);
  }
});

// 3. 发送消息
await agent.prompt("Hello, how are you?");

// 4. 等待完成
await agent.waitForIdle();
```

---

## 基础用法

### 创建 Agent

```typescript
import { Agent, AgentState, AgentConfig } from "@mariozechner/pi-agent";

interface MyState extends AgentState {
  // 添加自定义状态
  customData: string;
}

const agent = new Agent<MyState>({
  // 初始状态
  initialState: {
    model: myModel,
    systemPrompt: "You are a helpful assistant.",
    messages: [],
    tools: [],
    thinkingLevel: "medium",
    customData: "initial value",
  },
  
  // 流函数
  streamFn: streamSimple,
  
  // 可选：获取 API 密钥
  getApiKey: async (provider: string) => {
    return process.env[`${provider.toUpperCase()}_API_KEY`];
  },
  
  // 可选：上下文转换
  transformContext: async (messages, signal) => {
    // 压缩或过滤消息
    return messages.slice(-10);
  },
  
  // 可选：转换为 LLM 格式
  convertToLlm: async (messages) => {
    // 自定义消息格式转换
    return messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
  },
  
  // 可选：生命周期钩子
  beforeToolCall: async ({ toolCall, args, context }, signal) => {
    console.log(`Calling tool: ${toolCall.name}`);
    return { block: false };
  },
  
  afterToolCall: async ({ toolCall, result, context }, signal) => {
    console.log(`Tool result:`, result);
    return result;
  },
});
```

### 发送消息

```typescript
// 方式 1: 字符串
await agent.prompt("What is the weather today?");

// 方式 2: 单条消息
await agent.prompt({
  role: "user",
  content: [{ type: "text", text: "What is the weather today?" }],
  timestamp: Date.now(),
});

// 方式 3: 多条消息（批量）
await agent.prompt([
  {
    role: "user",
    content: [{ type: "text", text: "First message" }],
    timestamp: Date.now(),
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "Response to first message" }],
    timestamp: Date.now(),
  },
  {
    role: "user",
    content: [{ type: "text", text: "Second message" }],
    timestamp: Date.now(),
  },
]);
```

### 订阅事件

```typescript
// 订阅所有事件
const unsubscribe = agent.subscribe((event, signal) => {
  switch (event.type) {
    case "agent_start":
      console.log("Agent started");
      break;
      
    case "agent_end":
      console.log("Agent ended with messages:", event.messages);
      break;
      
    case "turn_start":
      console.log("Turn started");
      break;
      
    case "turn_end":
      console.log("Turn ended");
      break;
      
    case "message_start":
      console.log("Message started:", event.message.role);
      break;
      
    case "message_end":
      console.log("Message ended:", event.message.role);
      break;
      
    case "message_update":
      // 处理增量更新
      handleStreamUpdate(event.message, event.assistantMessageEvent);
      break;
      
    case "tool_execution_start":
      console.log(`Tool ${event.toolName} started with args:`, event.args);
      break;
      
    case "tool_execution_end":
      console.log(`Tool ${event.toolName} ended with result:`, event.result);
      break;
      
    case "tool_execution_update":
      console.log(`Tool ${event.toolName} progress:`, event.partialResult);
      break;
  }
});

// 取消订阅
unsubscribe();
```

### 中断运行

```typescript
// 中断当前运行
agent.abort();

// 等待停止
await agent.waitForIdle();
```

### 消息队列

```typescript
// Steering 消息：插入到当前轮次
agent.steer({
  role: "user",
  content: [{ type: "text", text: "Please elaborate on that." }],
  timestamp: Date.now(),
});

// Follow-up 消息：开启新轮次
agent.followUp({
  role: "user",
  content: [{ type: "text", text: "Now explain it differently." }],
  timestamp: Date.now(),
});
```

---

## 工具开发

### 基础工具

```typescript
import { AgentTool } from "@mariozechner/pi-agent";
import { Type } from "@sinclair/typebox";

// 定义工具
const weatherTool: AgentTool = {
  name: "get_weather",
  description: "Get the current weather for a location",
  
  parameters: Type.Object({
    location: Type.String({
      description: "City name or coordinates",
    }),
    units: Type.Optional(Type.Union([
      Type.Literal("celsius"),
      Type.Literal("fahrenheit"),
    ])),
  }),
  
  async execute(id, args, signal, onPartialResult) {
    // 1. 检查取消
    if (signal?.aborted) {
      throw new Error("Operation aborted");
    }
    
    // 2. 发送增量结果
    onPartialResult?.({ status: "fetching", progress: 0 });
    
    // 3. 执行操作
    const response = await fetch(
      `https://api.weather.com/${args.location}?units=${args.units || "celsius"}`,
      { signal }
    );
    
    onPartialResult?.({ status: "parsing", progress: 50 });
    
    const data = await response.json();
    
    // 4. 返回结果
    return {
      location: args.location,
      temperature: data.temp,
      conditions: data.conditions,
    };
  },
};

// 注册到 Agent
const agent = new Agent({
  initialState: {
    // ...
    tools: [weatherTool],
  },
  // ...
});
```

### 带参数预处理的工具

```typescript
const searchTool: AgentTool = {
  name: "search",
  description: "Search the web for information",
  
  parameters: Type.Object({
    query: Type.String(),
    max_results: Type.Optional(Type.Number({ default: 10 })),
  }),
  
  // 参数预处理：修正和清理
  prepareArguments(args) {
    return {
      query: args.query.trim(),
      max_results: args.max_results || 10,
    };
  },
  
  async execute(id, args, signal) {
    // args 已经被 prepareArguments 处理过
    const results = await searchAPI(args.query, args.max_results, signal);
    return results;
  },
};
```

### 带结果 Schema 的工具

```typescript
const fileReadTool: AgentTool = {
  name: "read_file",
  description: "Read a file from the filesystem",
  
  parameters: Type.Object({
    path: Type.String(),
    offset: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number()),
  }),
  
  // 结果 Schema（用于验证和文档）
  resultSchema: Type.Object({
    content: Type.String(),
    path: Type.String(),
    size: Type.Number(),
    lines: Type.Number(),
  }),
  
  async execute(id, args, signal) {
    const content = await fs.readFile(args.path, "utf-8");
    const lines = content.split("\n");
    
    return {
      content: args.limit 
        ? lines.slice(args.offset || 0, args.offset + args.limit).join("\n")
        : content,
      path: args.path,
      size: content.length,
      lines: lines.length,
    };
  },
};
```

### 复杂工具示例

```typescript
const codeExecutionTool: AgentTool = {
  name: "execute_code",
  description: "Execute JavaScript/TypeScript code in a sandbox",
  
  parameters: Type.Object({
    code: Type.String({ description: "Code to execute" }),
    language: Type.Union([
      Type.Literal("javascript"),
      Type.Literal("typescript"),
    ]),
    timeout: Type.Optional(Type.Number({ 
      default: 5000,
      description: "Timeout in milliseconds",
    })),
  }),
  
  resultSchema: Type.Object({
    stdout: Type.String(),
    stderr: Type.String(),
    result: Type.Any(),
    executionTime: Type.Number(),
  }),
  
  async execute(id, args, signal, onPartialResult) {
    const startTime = Date.now();
    
    onPartialResult?.({ stage: "compiling", progress: 25 });
    
    // 编译代码
    const compiled = await compileCode(args.code, args.language);
    
    if (signal?.aborted) {
      throw new Error("Execution aborted");
    }
    
    onPartialResult?.({ stage: "executing", progress: 50 });
    
    // 执行代码
    const result = await executeInSandbox(compiled, {
      timeout: args.timeout,
      signal,
      onStdout: (data) => {
        onPartialResult?.({ stage: "running", stdout: data });
      },
      onStderr: (data) => {
        onPartialResult?.({ stage: "running", stderr: data });
      },
    });
    
    onPartialResult?.({ stage: "completed", progress: 100 });
    
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      result: result.returnValue,
      executionTime: Date.now() - startTime,
    };
  },
};
```

---

## Provider 集成

### 使用内置 Provider

```typescript
import { streamSimple } from "@mariozechner/pi-ai";
import { 
  streamAnthropic, 
  streamOpenAICompletions,
  streamGoogle,
  AnthropicOptions,
  OpenAICompletionsOptions,
  GoogleOptions,
} from "@mariozechner/pi-ai/providers";

// Anthropic
const agent = new Agent({
  initialState: {
    model: {
      id: "claude-3-5-sonnet",
      api: "anthropic-messages",
      provider: "anthropic",
      // ...
    },
    // ...
  },
  streamFn: (model, context, options) => {
    const anthropicOptions: AnthropicOptions = {
      ...options,
      thinking: { type: "enabled", budget_tokens: 10000 },
    };
    return streamAnthropic(model, context, anthropicOptions);
  },
});

// OpenAI
const openaiAgent = new Agent({
  initialState: {
    model: {
      id: "gpt-4-turbo",
      api: "openai-completions",
      provider: "openai",
      // ...
    },
    // ...
  },
  streamFn: streamOpenAICompletions,
});

// Google
const googleAgent = new Agent({
  initialState: {
    model: {
      id: "gemini-2.0-flash-exp",
      api: "google-generative-ai",
      provider: "google",
      // ...
    },
    // ...
  },
  streamFn: (model, context, options) => {
    const googleOptions: GoogleOptions = {
      ...options,
      thinking: "medium",
    };
    return streamGoogle(model, context, googleOptions);
  },
});
```

### 实现自定义 Provider

```typescript
import { 
  StreamFunction, 
  Model, 
  Context, 
  AssistantMessageEventStream,
  EventStream,
  AssistantMessage,
  AssistantMessageEvent,
} from "@mariozechner/pi-ai";

// 定义 API 类型和 Provider
type MyProviderApi = "my-provider-api";
type MyProviderName = "my-provider";

interface MyProviderOptions extends StreamOptions {
  customOption?: string;
}

// 实现流函数
export function streamMyProvider(
  model: Model<MyProviderApi>,
  context: Context,
  options?: MyProviderOptions
): AssistantMessageEventStream {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
  
  // 异步处理
  void (async () => {
    try {
      // 1. 构建请求载荷
      const payload = buildPayload(model, context, options);
      
      // 2. 允许修改载荷（用于调试/测试）
      const modifiedPayload = await options?.onPayload?.(payload, model) ?? payload;
      
      // 3. 发起流式请求
      const response = await fetch(`${model.baseUrl}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${options?.apiKey}`,
          ...options?.headers,
        },
        body: JSON.stringify(modifiedPayload),
        signal: options?.signal,
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      // 4. 解析流
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }
      
      const decoder = new TextDecoder();
      let partialMessage: AssistantMessage = createEmptyMessage(model);
      
      // 发送 start 事件
      stream.push({ type: "start", partial: partialMessage });
      
      let buffer = "";
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (!line.trim() || !line.startsWith("data: ")) continue;
          
          const data = JSON.parse(line.slice(6));
          const events = parseSSEEvent(data, partialMessage);
          
          for (const event of events) {
            if (event.type !== "done" && event.type !== "error") {
              partialMessage = event.partial;
            }
            stream.push(event);
          }
        }
      }
      
      // 发送 done 事件
      stream.push({ type: "done", partial: partialMessage });
      stream.end(partialMessage);
      
    } catch (error) {
      // 错误处理
      const errorMessage = createErrorMessage(model, error);
      stream.push({ 
        type: "error", 
        partial: errorMessage, 
        error: error instanceof Error ? error : new Error(String(error)) 
      });
      stream.end(errorMessage);
    }
  })();
  
  return stream;
}

// 辅助函数
function buildPayload(
  model: Model<MyProviderApi>,
  context: Context,
  options?: MyProviderOptions
): unknown {
  return {
    model: model.id,
    messages: context.messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    system: context.systemPrompt,
    tools: context.tools?.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    stream: true,
    custom: options?.customOption,
  };
}

function parseSSEEvent(
  data: any, 
  partialMessage: AssistantMessage
): AssistantMessageEvent[] {
  // 解析 Provider 特定的 SSE 格式
  // 返回标准化的 AssistantMessageEvent
  const events: AssistantMessageEvent[] = [];
  
  switch (data.type) {
    case "text_start":
      // ...
      break;
    case "text_delta":
      // ...
      break;
    // ...
  }
  
  return events;
}

function createEmptyMessage(model: Model<MyProviderApi>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createErrorMessage(
  model: Model<MyProviderApi>, 
  error: unknown
): AssistantMessage {
  return {
    ...createEmptyMessage(model),
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}
```

### 注册 Provider

```typescript
import { apiRegistry } from "@mariozechner/pi-ai";

// 注册 Provider
apiRegistry.register("my-provider-api", streamMyProvider);

// 现在 streamSimple 可以使用这个 Provider
const agent = new Agent({
  initialState: {
    model: {
      id: "my-model",
      api: "my-provider-api",
      provider: "my-provider",
      // ...
    },
    // ...
  },
  streamFn: streamSimple, // 自动路由到 streamMyProvider
});
```

---

## 事件处理

### 实时显示响应

```typescript
import * as readline from "readline";

class ChatUI {
  private agent: Agent;
  private unsubscribe: () => void;
  private currentLine: string = "";
  
  constructor(agent: Agent) {
    this.agent = agent;
    this.unsubscribe = agent.subscribe((event) => this.handleEvent(event));
  }
  
  private handleEvent(event: AgentEvent) {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          this.currentLine = "";
          readline.cursorTo(process.stdout, 0);
        }
        break;
        
      case "message_update":
        if (event.message.role === "assistant") {
          // 清除当前行并重绘
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          
          const text = event.message.content
            .filter(c => c.type === "text")
            .map(c => c.text)
            .join("");
          
          process.stdout.write(text);
          this.currentLine = text;
        }
        break;
        
      case "message_end":
        if (event.message.role === "assistant") {
          process.stdout.write("\n");
        }
        break;
        
      case "tool_execution_start":
        process.stdout.write(`\n🔧 Calling ${event.toolName}...\n`);
        break;
        
      case "tool_execution_end":
        if (event.isError) {
          process.stdout.write(`❌ Tool failed\n`);
        } else {
          process.stdout.write(`✓ Tool completed\n`);
        }
        break;
    }
  }
  
  destroy() {
    this.unsubscribe();
  }
}
```

### 记录对话历史

```typescript
interface ConversationLogger {
  logs: Array<{
    timestamp: number;
    event: AgentEvent;
  }>;
  
  start(): void;
  stop(): void;
  saveToFile(path: string): Promise<void>;
}

function createLogger(agent: Agent): ConversationLogger {
  const logs: Array<{ timestamp: number; event: AgentEvent }> = [];
  
  const unsubscribe = agent.subscribe((event) => {
    logs.push({
      timestamp: Date.now(),
      event,
    });
  });
  
  return {
    logs,
    
    start() {
      // 已经在订阅
    },
    
    stop() {
      unsubscribe();
    },
    
    async saveToFile(path: string) {
      await fs.writeFile(path, JSON.stringify(logs, null, 2));
    },
  };
}
```

### 收集指标

```typescript
interface Metrics {
  totalTurns: number;
  totalMessages: number;
  totalToolCalls: number;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  totalCost: number;
  errors: number;
  toolErrors: number;
}

function createMetricsCollector(agent: Agent): Metrics {
  const metrics: Metrics = {
    totalTurns: 0,
    totalMessages: 0,
    totalToolCalls: 0,
    totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    totalCost: 0,
    errors: 0,
    toolErrors: 0,
  };
  
  agent.subscribe((event) => {
    switch (event.type) {
      case "turn_end":
        metrics.totalTurns++;
        break;
        
      case "message_end":
        metrics.totalMessages++;
        if (event.message.role === "assistant") {
          metrics.totalTokens.input += event.message.usage.input;
          metrics.totalTokens.output += event.message.usage.output;
          metrics.totalTokens.cacheRead += event.message.usage.cacheRead;
          metrics.totalTokens.cacheWrite += event.message.usage.cacheWrite;
          metrics.totalCost += event.message.usage.cost.total;
          
          if (event.message.stopReason === "error") {
            metrics.errors++;
          }
        }
        break;
        
      case "tool_execution_start":
        metrics.totalToolCalls++;
        break;
        
      case "tool_execution_end":
        if (event.isError) {
          metrics.toolErrors++;
        }
        break;
    }
  });
  
  return metrics;
}
```

---

## 高级主题

### 上下文管理

```typescript
// 压缩历史消息
async function compressHistory(
  messages: AgentMessage[], 
  maxMessages: number = 20
): Promise<AgentMessage[]> {
  if (messages.length <= maxMessages) {
    return messages;
  }
  
  // 保留最近的 N 条消息
  const recentMessages = messages.slice(-maxMessages);
  
  // 对旧消息生成摘要
  const oldMessages = messages.slice(0, -maxMessages);
  
  // 使用 LLM 生成摘要
  const summary = await generateSummary(oldMessages);
  
  // 插入摘要消息
  return [
    {
      role: "user",
      content: [{ type: "text", text: `Previous conversation summary:\n${summary}` }],
      timestamp: Date.now(),
    },
    ...recentMessages,
  ];
}

// 使用上下文转换
const agent = new Agent({
  // ...
  transformContext: async (messages, signal) => {
    return compressHistory(messages, 20);
  },
});
```

### 动态工具注入

```typescript
// 根据上下文动态添加工具
const agent = new Agent({
  // ...
  
  async getTools(context) {
    const baseTools = [readFileTool, writeFileTool];
    
    // 根据用户权限添加工具
    if (context.userPermissions.includes("execute_code")) {
      baseTools.push(codeExecutionTool);
    }
    
    // 根据消息内容添加工具
    const lastMessage = context.messages[context.messages.length - 1];
    if (lastMessage?.content?.toString().includes("weather")) {
      baseTools.push(weatherTool);
    }
    
    return baseTools;
  },
});
```

### 多模态输入

```typescript
import * as fs from "fs";

// 读取图片并转换为 base64
async function loadImage(path: string): Promise<ImageContent> {
  const buffer = await fs.readFile(path);
  const base64 = buffer.toString("base64");
  
  // 检测 MIME 类型
  const ext = path.split(".").pop()?.toLowerCase();
  const mimeType = ext === "png" ? "image/png" 
    : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "gif" ? "image/gif"
    : ext === "webp" ? "image/webp"
    : "application/octet-stream";
  
  return {
    type: "image",
    data: base64,
    mimeType,
  };
}

// 发送多模态消息
const agent = new Agent({ /* ... */ });

const imageContent = await loadImage("./screenshot.png");

await agent.prompt({
  role: "user",
  content: [
    { type: "text", text: "What do you see in this image?" },
    imageContent,
  ],
  timestamp: Date.now(),
});
```

### 并发控制

```typescript
import { Agent, AgentTool } from "@mariozechner/pi-agent";

// 工具级别的并发控制
class ConcurrentToolExecutor {
  private queue: Array<() => Promise<any>> = [];
  private running: number = 0;
  private maxConcurrent: number;
  
  constructor(maxConcurrent: number = 5) {
    this.maxConcurrent = maxConcurrent;
  }
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }
  
  private async process() {
    while (this.queue.length > 0 && this.running < this.maxConcurrent) {
      this.running++;
      const fn = this.queue.shift()!;
      
      try {
        await fn();
      } finally {
        this.running--;
        this.process();
      }
    }
  }
}

// 在工具中使用
const executor = new ConcurrentToolExecutor(5);

const concurrentTool: AgentTool = {
  name: "parallel_search",
  description: "Search multiple sources in parallel",
  parameters: Type.Object({
    queries: Type.Array(Type.String()),
  }),
  
  async execute(id, args, signal) {
    const results = await Promise.all(
      args.queries.map(query => 
        executor.execute(() => searchAPI(query, signal))
      )
    );
    return results;
  },
};
```

---

## 最佳实践

### 1. 错误处理

```typescript
// ✅ 好的实践：全面的错误处理
agent.subscribe((event) => {
  try {
    if (event.type === "message_end" && event.message.role === "assistant") {
      if (event.message.stopReason === "error") {
        console.error("LLM error:", event.message.errorMessage);
        // 处理错误：重试、降级、通知用户等
      }
    }
    
    if (event.type === "tool_execution_end" && event.isError) {
      console.error("Tool error:", event.toolName, event.result);
      // 记录错误、更新 UI 等
    }
  } catch (error) {
    console.error("Event handler error:", error);
  }
});

// ❌ 不好的实践：忽略错误
agent.subscribe((event) => {
  // 没有错误处理
});
```

### 2. 取消操作

```typescript
// ✅ 好的实践：正确传递 AbortSignal
const tool: AgentTool = {
  name: "long_operation",
  // ...
  async execute(id, args, signal) {
    // 定期检查取消
    if (signal?.aborted) {
      throw new Error("Operation cancelled");
    }
    
    // 传递给异步操作
    const result = await fetch(url, { signal });
    
    // 再次检查
    if (signal?.aborted) {
      throw new Error("Operation cancelled");
    }
    
    return result.json();
  },
};

// ❌ 不好的实践：不检查取消
const badTool: AgentTool = {
  name: "bad_operation",
  // ...
  async execute(id, args, signal) {
    // 不传递 signal
    const result = await fetch(url);
    return result.json();
  },
};
```

### 3. 资源清理

```typescript
// ✅ 好的实践：确保资源清理
class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private unsubscribes: Map<string, () => void> = new Map();
  
  create(id: string, config: AgentConfig): Agent {
    const agent = new Agent(config);
    const unsubscribe = agent.subscribe(/* ... */);
    
    this.agents.set(id, agent);
    this.unsubscribes.set(id, unsubscribe);
    
    return agent;
  }
  
  destroy(id: string) {
    const agent = this.agents.get(id);
    const unsubscribe = this.unsubscribes.get(id);
    
    if (agent) {
      agent.abort();
      this.agents.delete(id);
    }
    
    if (unsubscribe) {
      unsubscribe();
      this.unsubscribes.delete(id);
    }
  }
  
  destroyAll() {
    for (const id of this.agents.keys()) {
      this.destroy(id);
    }
  }
}
```

### 4. 类型安全

```typescript
// ✅ 好的实践：使用泛型确保类型安全
interface MyState extends AgentState {
  customField: string;
}

const agent = new Agent<MyState>({
  initialState: {
    // TypeScript 会检查类型
    model: myModel,
    systemPrompt: "...",
    messages: [],
    tools: [],
    thinkingLevel: "medium",
    customField: "value", // ✅ 自定义字段
  },
  // ...
});

// 工具也使用类型
interface WeatherResult {
  location: string;
  temperature: number;
  conditions: string;
}

const weatherTool: AgentTool<WeatherResult> = {
  name: "get_weather",
  // ...
  async execute(id, args, signal): Promise<WeatherResult> {
    // 返回类型被检查
    return {
      location: args.location,
      temperature: 20,
      conditions: "sunny",
    };
  },
};
```

---

## 常见问题

### Q: 如何限制上下文长度？

A: 使用 `transformContext` 配置：

```typescript
const agent = new Agent({
  // ...
  transformContext: async (messages, signal) => {
    // 保留最近的 20 条消息
    const recent = messages.slice(-20);
    
    // 或者基于 token 限制
    let totalTokens = 0;
    const limited = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(messages[i]);
      if (totalTokens + msgTokens > 100000) break;
      totalTokens += msgTokens;
      limited.unshift(messages[i]);
    }
    
    return limited;
  },
});
```

### Q: 如何实现工具调用权限控制？

A: 使用 `beforeToolCall` 钩子：

```typescript
const agent = new Agent({
  // ...
  beforeToolCall: async ({ toolCall, args, context }, signal) => {
    // 检查用户权限
    const userPermissions = context.userPermissions || [];
    
    // 定义工具权限映射
    const toolPermissions: Record<string, string[]> = {
      "execute_code": ["code_execution"],
      "delete_file": ["file_write", "admin"],
      "read_file": ["file_read"],
    };
    
    const requiredPermissions = toolPermissions[toolCall.name] || [];
    const hasPermission = requiredPermissions.every(p => userPermissions.includes(p));
    
    if (!hasPermission) {
      return {
        block: true,
        reason: `Permission denied: ${toolCall.name} requires ${requiredPermissions.join(", ")}`,
      };
    }
    
    return { block: false };
  },
});
```

### Q: 如何处理流式响应中的错误？

A: 在事件处理器中检查消息状态：

```typescript
agent.subscribe((event) => {
  if (event.type === "message_end" && event.message.role === "assistant") {
    if (event.message.stopReason === "error") {
      console.error("Error:", event.message.errorMessage);
      // 重试逻辑
      agent.continue();
    }
  }
});
```

### Q: 如何实现多轮对话记忆？

A: Agent 自动维护消息历史，只需保持 Agent 实例：

```typescript
// ✅ 好的实践：保持实例
const agent = new Agent({ /* ... */ });

await agent.prompt("Hello");
await agent.prompt("What did I just say?"); // 可以引用上一轮

// ❌ 不好的实践：每次创建新实例
async function chat(message: string) {
  const agent = new Agent({ /* ... */ }); // 丢失历史
  await agent.prompt(message);
}
```

### Q: 如何调试工具调用？

A: 使用 `onPayload` 选项和日志：

```typescript
const agent = new Agent({
  // ...
  streamFn: (model, context, options) => {
    return streamAnthropic(model, context, {
      ...options,
      onPayload: (payload) => {
        console.log("Request payload:", JSON.stringify(payload, null, 2));
        return undefined; // 不修改载荷
      },
    });
  },
});

// 记录工具调用
agent.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    console.log("Tool call:", event.toolName, event.args);
  }
  if (event.type === "tool_execution_end") {
    console.log("Tool result:", event.result);
  }
});
```

---

## 总结

本实践指南涵盖了使用 `pi` 构建 AI Agent 的核心概念和最佳实践：

1. **基础用法**：创建 Agent、发送消息、订阅事件
2. **工具开发**：定义工具、参数验证、增量结果
3. **Provider 集成**：使用内置 Provider、实现自定义 Provider
4. **事件处理**：实时显示、日志记录、指标收集
5. **高级主题**：上下文管理、动态工具、多模态、并发控制
6. **最佳实践**：错误处理、取消操作、资源清理、类型安全

通过这些技术和模式，你可以构建出健壮、高效的 AI Agent 应用。
