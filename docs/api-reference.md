# API 参考文档

本文档提供 `@mariozechner/pi-ai` 和 `@mariozechner/pi-agent` 包的完整 API 参考。

## 目录

- [@mariozechner/pi-ai](#mariozechnerpi-ai)
  - [核心类型](#核心类型)
  - [Model](#model)
  - [Context](#context)
  - [Message](#message)
  - [Tool](#tool)
  - [StreamFunction](#streamfunction)
  - [EventStream](#eventstream)
  - [ApiRegistry](#apiregistry)
  - [工具函数](#工具函数)
- [@mariozechner/pi-agent](#mariozechnerpi-agent)
  - [Agent](#agent)
  - [AgentState](#agentstate)
  - [AgentConfig](#agentconfig)
  - [AgentEvent](#agentevent)
  - [AgentTool](#agenttool)
  - [AgentContext](#agentcontext)

---

## @mariozechner/pi-ai

### 核心类型

#### `Api`

```typescript
type KnownApi =
  | "openai-completions"
  | "mistral-conversations"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-gemini-cli"
  | "google-vertex";

type Api = KnownApi | (string & {});
```

API 类型标识符，用于区分不同的 LLM API 协议。

#### `Provider`

```typescript
type KnownProvider =
  | "amazon-bedrock"
  | "anthropic"
  | "google"
  | "google-gemini-cli"
  | "google-antigravity"
  | "google-vertex"
  | "openai"
  | "azure-openai-responses"
  | "openai-codex"
  | "github-copilot"
  | "xai"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "vercel-ai-gateway"
  | "zai"
  | "mistral"
  | "minimax"
  | "minimax-cn"
  | "huggingface"
  | "opencode"
  | "opencode-go"
  | "kimi-coding";

type Provider = KnownProvider | string;
```

Provider 标识符，用于区分不同的 LLM 服务提供商。

#### `ThinkingLevel`

```typescript
type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";
```

思考/推理级别，用于支持扩展思考的模型。

---

### Model

#### `Model<TApi>`

```typescript
interface Model<TApi extends Api = Api> {
  id: string;                  // 模型唯一标识符
  name: string;                // 显示名称
  api: TApi;                   // API 类型
  provider: Provider;          // 提供商
  baseUrl: string;             // API 基础 URL
  
  // 能力
  reasoning: boolean;          // 是否支持推理/思考
  
  // 输入类型
  input: ModelInputType[];
  
  // 成本配置（每百万 token）
  cost: ModelCost;
  
  // 上下文窗口
  contextWindow: number;       // 最大上下文 token 数
  maxTokens: number;           // 最大输出 token 数
}

type ModelInputType = "text" | "image";

interface ModelCost {
  input: number;               // 输入 token 成本
  output: number;              // 输出 token 成本
  cacheRead?: number;          // 缓存读取成本
  cacheWrite?: number;         // 缓存写入成本
}
```

模型配置，定义 LLM 的能力和参数。

#### 示例

```typescript
const claudeModel: Model<"anthropic-messages"> = {
  id: "claude-3-5-sonnet",
  name: "Claude 3.5 Sonnet",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  cost: {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  contextWindow: 200000,
  maxTokens: 8192,
};
```

---

### Context

#### `Context`

```typescript
interface Context {
  systemPrompt?: string;       // 系统提示
  messages: Message[];         // 消息历史
  tools?: Tool[];              // 可用工具
}
```

传递给 LLM 的上下文信息。

#### `Tool`

```typescript
interface Tool {
  name: string;                // 工具名称
  description: string;         // 工具描述
  parameters: TSchema;         // 参数 Schema（TypeBox）
}
```

LLM 工具定义。

---

### Message

#### `Message`

```typescript
type Message = UserMessage | AssistantMessage | ToolResultMessage;
```

消息联合类型。

#### `UserMessage`

```typescript
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
}
```

用户消息。

#### `AssistantMessage`

```typescript
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  responseId?: string;         // 响应 ID（用于缓存）
  usage: Usage;                // Token 使用统计
  stopReason: StopReason;      // 停止原因
  errorMessage?: string;       // 错误信息
  timestamp: number;           // 时间戳
}

type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

助手消息。

#### `ToolResultMessage`

```typescript
interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;          // 对应的工具调用 ID
  content: string;             // 结果内容
  isError: boolean;            // 是否为错误
}
```

工具结果消息。

#### 内容类型

```typescript
interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;      // 文本签名（用于缓存）
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;  // 思考签名（用于缓存）
  redacted?: boolean;          // 是否被安全过滤
}

interface ImageContent {
  type: "image";
  data: string;                // Base64 编码
  mimeType: string;            // MIME 类型
}

interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;   // 思考签名（Google 特定）
}
```

#### `Usage`

```typescript
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

Token 使用统计。

---

### StreamFunction

#### `StreamFunction<TApi, TOptions>`

```typescript
type StreamFunction<
  TApi extends Api = Api, 
  TOptions extends StreamOptions = StreamOptions
> = (
  model: Model<TApi>,
  context: Context,
  options?: TOptions
) => AssistantMessageEventStream;
```

流式响应函数类型。

**契约**：
- 必须返回 `AssistantMessageEventStream`
- 请求失败应编码在流中，不应抛出异常
- 错误终止必须产生 `stopReason: "error"` 的 `AssistantMessage`

#### `StreamOptions`

```typescript
interface StreamOptions {
  temperature?: number;        // 采样温度
  maxTokens?: number;          // 最大输出 token
  signal?: AbortSignal;        // 中断信号
  apiKey?: string;             // API 密钥
  
  // 传输
  transport?: Transport;       // 传输方式
  cacheRetention?: CacheRetention; // 缓存保留策略
  sessionId?: string;          // 会话 ID
  
  // 调试
  onPayload?: (payload: unknown, model: Model<Api>) => 
    unknown | undefined | Promise<unknown | undefined>;
  
  // 请求头
  headers?: Record<string, string>;
  
  // 重试
  maxRetryDelayMs?: number;    // 最大重试延迟
  
  // 元数据
  metadata?: Record<string, unknown>;
}

type Transport = "sse" | "websocket" | "auto";
type CacheRetention = "none" | "short" | "long";
```

流式请求选项。

#### `SimpleStreamOptions`

```typescript
interface SimpleStreamOptions extends StreamOptions {
  reasoning?: ThinkingLevel;   // 推理级别
  thinkingBudgets?: ThinkingBudgets; // 自定义思考预算
}

interface ThinkingBudgets {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
}
```

简化流式选项，支持思考级别。

---

### EventStream

#### `EventStream<TEvent, TResult>`

```typescript
class EventStream<TEvent, TResult> {
  // 推送事件
  push(event: TEvent): void;
  
  // 结束流并设置结果
  end(result: TResult): void;
  
  // 异步迭代
  [Symbol.asyncIterator](): AsyncIterator<TEvent>;
  
  // 等待结果
  result(): Promise<TResult>;
}
```

通用事件流类。

#### `AssistantMessageEventStream`

```typescript
type AssistantMessageEventStream = EventStream<
  AssistantMessageEvent,
  AssistantMessage
>;
```

特化的流类型，用于 LLM 响应。

#### `AssistantMessageEvent`

```typescript
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; partial: AssistantMessage }
  | { type: "text_delta"; partial: AssistantMessage; delta: string }
  | { type: "text_end"; partial: AssistantMessage }
  | { type: "thinking_start"; partial: AssistantMessage }
  | { type: "thinking_delta"; partial: AssistantMessage; delta: string }
  | { type: "thinking_end"; partial: AssistantMessage }
  | { type: "toolcall_start"; partial: AssistantMessage }
  | { type: "toolcall_delta"; partial: AssistantMessage; delta: string }
  | { type: "toolcall_end"; partial: AssistantMessage }
  | { type: "done"; partial: AssistantMessage }
  | { type: "error"; partial: AssistantMessage; error: Error };
```

助手消息事件类型。

---

### ApiRegistry

#### `apiRegistry`

```typescript
const apiRegistry: ApiRegistry;

interface ApiRegistry {
  // 注册 Provider
  register<TApi extends Api>(api: TApi, streamFn: StreamFunction<TApi>): void;
  
  // 获取 Provider
  get(api: Api): StreamFunction | undefined;
  
  // 检查是否已注册
  has(api: Api): boolean;
  
  // 列出所有注册的 API
  list(): Api[];
}
```

API 注册表，管理 Provider 映射。

#### 示例

```typescript
import { apiRegistry } from "@mariozechner/pi-ai";

// 注册自定义 Provider
apiRegistry.register("my-api", myStreamFunction);

// 检查是否已注册
if (apiRegistry.has("my-api")) {
  const streamFn = apiRegistry.get("my-api");
  const stream = streamFn!(model, context, options);
}
```

---

### 工具函数

#### `streamSimple`

```typescript
function streamSimple(
  model: Model,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream;
```

统一的流式入口，自动路由到正确的 Provider。

#### `convertToLlm`

```typescript
function convertToLlm(
  messages: AgentMessage[]
): Message[];
```

将 Agent 消息转换为 LLM 消息格式。

#### `validateToolArguments`

```typescript
function validateToolArguments(
  tool: AgentTool<any>,
  toolCall: AgentToolCall
): unknown;
```

验证工具调用参数。

---

## @mariozechner/pi-agent

### Agent

#### `Agent<TState>`

```typescript
class Agent<TState extends AgentState = AgentState> {
  constructor(config: AgentConfig<TState>);
  
  // 发送消息
  prompt(input: string | AgentMessage | AgentMessage[]): Promise<void>;
  
  // 继续当前对话
  continue(): Promise<void>;
  
  // 中断当前运行
  abort(): void;
  
  // 等待空闲
  waitForIdle(): Promise<void>;
  
  // 插入 Steering 消息
  steer(message: AgentMessage): void;
  
  // 添加 Follow-up 消息
  followUp(message: AgentMessage): void;
  
  // 订阅事件
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  ): () => void;
  
  // 获取当前状态
  get state(): Readonly<TState>;
  
  // 检查是否正在运行
  get isRunning(): boolean;
}
```

Agent 类，管理对话状态和循环。

#### 示例

```typescript
const agent = new Agent({
  initialState: {
    model: myModel,
    systemPrompt: "You are a helpful assistant.",
    messages: [],
    tools: [weatherTool],
    thinkingLevel: "medium",
  },
  streamFn: streamSimple,
});

// 订阅事件
const unsubscribe = agent.subscribe((event) => {
  console.log(event.type);
});

// 发送消息
await agent.prompt("Hello");

// 等待完成
await agent.waitForIdle();

// 取消订阅
unsubscribe();
```

---

### AgentState

#### `AgentState`

```typescript
interface AgentState {
  model: Model;                // 模型配置
  systemPrompt: string;        // 系统提示
  messages: AgentMessage[];    // 消息历史
  tools: AgentTool<any>[];     // 工具列表
  thinkingLevel: ThinkingLevel; // 思考级别
  apiKey?: string;             // API 密钥（可选）
}
```

Agent 状态定义。

#### 扩展状态

```typescript
interface MyState extends AgentState {
  userId: string;
  sessionData: Record<string, any>;
}

const agent = new Agent<MyState>({
  initialState: {
    model: myModel,
    systemPrompt: "...",
    messages: [],
    tools: [],
    thinkingLevel: "medium",
    userId: "user-123",
    sessionData: {},
  },
  // ...
});
```

---

### AgentConfig

#### `AgentConfig<TState>`

```typescript
interface AgentConfig<TState extends AgentState> {
  // 必需
  initialState: TState;
  
  // 流函数
  streamFn?: StreamFn;
  
  // 可选钩子
  getApiKey?: (provider: string) => Promise<string | undefined>;
  getTools?: (context: AgentContext) => Promise<AgentTool<any>[]>;
  
  // 上下文转换
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => Promise<AgentMessage[]>;
  
  // 消息转换
  convertToLlm?: (
    messages: AgentMessage[],
    signal?: AbortSignal
  ) => Promise<Message[]>;
  
  // 工具执行钩子
  beforeToolCall?: (
    info: {
      assistantMessage: AssistantMessage;
      toolCall: AgentToolCall;
      args: unknown;
      context: AgentContext;
    },
    signal?: AbortSignal
  ) => Promise<{ block: boolean; reason?: string } | void>;
  
  afterToolCall?: (
    info: {
      assistantMessage: AssistantMessage;
      toolCall: AgentToolCall;
      result: AgentToolResult;
      context: AgentContext;
    },
    signal?: AbortSignal
  ) => Promise<AgentToolResult>;
  
  // 工具执行模式
  toolExecution?: "parallel" | "sequential";
  
  // 消息队列模式
  messageQueueMode?: "all" | "one";
}

type StreamFn = (
  model: Model,
  context: AgentContext,
  options?: SimpleStreamOptions
) => AssistantMessageEventStream;
```

Agent 配置。

---

### AgentEvent

#### `AgentEvent`

```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_end"; message: AgentMessage }
  | { type: "message_update"; message: AssistantMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any };
```

Agent 事件类型。

#### 事件顺序

```
agent_start
  turn_start
    message_start (user)
    message_end (user)
    message_start (assistant)
      message_update (多次)
    message_end (assistant)
    [tool_execution_start]
    [tool_execution_update (多次)]
    [tool_execution_end]
    [message_start (toolResult)]
    [message_end (toolResult)]
  turn_end
agent_end
```

---

### AgentTool

#### `AgentTool<TResult>`

```typescript
interface AgentTool<TResult = any> {
  // 必需
  name: string;                // 工具名称（唯一标识）
  description: string;         // 工具描述（LLM 可见）
  parameters: TSchema;         // 参数 Schema（TypeBox）
  execute: (
    id: string,                // 工具调用 ID
    args: any,                 // 验证后的参数
    signal?: AbortSignal,      // 中断信号
    onPartialResult?: (partial: any) => void // 增量结果回调
  ) => Promise<TResult>;
  
  // 可选
  prepareArguments?: (args: Record<string, any>) => Record<string, any>;
  resultSchema?: TSchema;      // 结果 Schema
}
```

工具定义。

#### 示例

```typescript
import { AgentTool } from "@mariozechner/pi-agent";
import { Type } from "@sinclair/typebox";

const calculatorTool: AgentTool<{ result: number }> = {
  name: "calculate",
  description: "Evaluate a mathematical expression",
  
  parameters: Type.Object({
    expression: Type.String({
      description: "Mathematical expression to evaluate",
    }),
  }),
  
  async execute(id, args, signal) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    
    const result = evaluateExpression(args.expression);
    return { result };
  },
  
  prepareArguments(args) {
    return {
      expression: args.expression.trim(),
    };
  },
};
```

#### `AgentToolCall`

```typescript
interface AgentToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}
```

工具调用请求。

#### `AgentToolResult<TResult>`

```typescript
interface AgentToolResult<TResult = any> {
  type: "toolResult";
  toolCallId: string;
  result: TResult;
  isError: boolean;
}
```

工具调用结果。

---

### AgentContext

#### `AgentContext`

```typescript
interface AgentContext extends AgentState {
  // 运行时上下文
  messages: AgentMessage[];    // 当前消息历史
  tools: AgentTool<any>[];     // 当前工具列表
}
```

运行时上下文，继承自 `AgentState`。

---

### AgentMessage

#### `AgentMessage`

```typescript
type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;
```

Agent 消息类型（与 LLM Message 不同，包含时间戳）。

#### 与 LLM Message 的区别

| 特性 | AgentMessage | LLM Message |
|------|--------------|-------------|
| 时间戳 | ✅ 包含 | ❌ 不包含 |
| 用途 | 内部状态管理 | LLM API 请求 |
| 转换 | - | 通过 `convertToLlm` |

---

## Provider 选项

### Anthropic Options

```typescript
interface AnthropicOptions extends StreamOptions {
  thinking?: {
    type: "enabled";
    budget_tokens: number;
  };
}
```

### OpenAI Options

```typescript
interface OpenAICompletionsOptions extends StreamOptions {
  // 标准选项
}

interface OpenAIResponsesOptions extends StreamOptions {
  // 响应 API 特定选项
}
```

### Google Options

```typescript
interface GoogleOptions extends StreamOptions {
  thinking?: GoogleThinkingLevel;
}

type GoogleThinkingLevel = "none" | "minimal" | "low" | "medium" | "high";
```

### Bedrock Options

```typescript
interface BedrockOptions extends StreamOptions {
  region?: string;
  // AWS SDK 配置
}
```

---

## 类型导入

### @mariozechner/pi-ai

```typescript
// 核心类型
export type { Api, Provider, ThinkingLevel };
export type { Model, ModelCost, ModelInputType };
export type { Context, Tool };
export type { Message, UserMessage, AssistantMessage, ToolResultMessage };
export type { TextContent, ThinkingContent, ImageContent, ToolCall };
export type { Usage, StopReason };

// 流式类型
export type { StreamFunction, StreamOptions, SimpleStreamOptions };
export type { AssistantMessageEventStream, AssistantMessageEvent };
export { EventStream };

// 注册表
export { apiRegistry };

// 工具函数
export { streamSimple, convertToLlm, validateToolArguments };

// TypeBox
export { Type } from "@sinclair/typebox";
export type { Static, TSchema } from "@sinclair/typebox";
```

### @mariozechner/pi-agent

```typescript
// Agent 类
export { Agent };

// 状态类型
export type { AgentState, AgentConfig };

// 事件类型
export type { AgentEvent };

// 工具类型
export type { AgentTool, AgentToolCall, AgentToolResult };

// 上下文类型
export type { AgentContext, AgentMessage };
```

---

## 总结

本 API 参考文档涵盖了 `pi` 项目的所有核心类型和接口：

1. **AI 包**：提供底层抽象，包括 Model、Context、Message、StreamFunction 等
2. **Agent 包**：提供高层循环，包括 Agent、AgentState、AgentEvent、AgentTool 等
3. **Provider 集成**：通过 ApiRegistry 和 StreamFunction 实现可扩展性
4. **类型安全**：全面使用 TypeScript 和 TypeBox 确保类型正确性

通过这些 API，你可以构建复杂的 AI Agent 应用，同时保持代码的类型安全和可维护性。
