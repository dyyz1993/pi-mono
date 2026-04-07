# 架构文档：@mariozechner/pi-ai 与 @mariozechner/pi-agent

本文档深入分析 `pi` 项目的核心架构，包括 AI 抽象层、Agent 系统和数据流转。

## 目录

1. [包结构概览](#包结构概览)
2. [核心类型系统](#核心类型系统)
3. [流式处理架构](#流式处理架构)
4. [Agent 循环机制](#agent-循环机制)
5. [Provider 实现模式](#provider-实现模式)
6. [工具调用系统](#工具调用系统)
7. [事件系统](#事件系统)
8. [数据流转详解](#数据流转详解)

---

## 包结构概览

### monorepo 结构

```
packages/
├── ai/           # 核心抽象层：类型定义、流式接口、Provider 实现
├── agent/        # Agent 循环：状态管理、工具执行、消息队列
├── cli/          # 命令行界面：用户交互、命令处理
├── config/       # 配置管理：模型配置、API 密钥
├── core/         # 核心功能：会话管理、持久化
├── mcp/          # Model Context Protocol 集成
├── tools/        # 内置工具：文件操作、代码执行等
└── utils/        # 通用工具函数
```

### 包依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI (用户入口)                        │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌───────────┐    ┌──────────┐    ┌───────────┐
│   Agent   │───▶│    AI    │◀───│   Tools   │
└───────────┘    └──────────┘    └───────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │Anthropic │  │  OpenAI  │  │  Google  │
  │ Provider │  │ Provider │  │ Provider │
  └──────────┘  └──────────┘  └──────────┘
```

---

## 核心类型系统

### 消息类型层级

```typescript
// packages/ai/src/types.ts

// ─────────────────────────────────────────────────────
// 用户消息
// ─────────────────────────────────────────────────────
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

// ─────────────────────────────────────────────────────
// 助手消息
// ─────────────────────────────────────────────────────
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;                    // 使用的 API 类型
  provider: Provider;          // 提供商名称
  model: string;               // 模型标识符
  responseId?: string;         // 响应 ID（用于缓存）
  usage: Usage;                // Token 使用统计
  stopReason: StopReason;      // 停止原因
  errorMessage?: string;       // 错误信息
  timestamp: number;
}

// ─────────────────────────────────────────────────────
// 内容块类型
// ─────────────────────────────────────────────────────
interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;      // 用于缓存签名
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;  // 用于缓存签名
  redacted?: boolean;          // 安全过滤标记
}

interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;   // Google 特定：思考上下文复用
}

// ─────────────────────────────────────────────────────
// 工具结果消息
// ─────────────────────────────────────────────────────
interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  result: any;
  isError: boolean;
  timestamp: number;
}
```

### Model 类型

```typescript
// packages/ai/src/models.ts
interface Model<TApi extends Api = Api> {
  id: string;                  // 模型唯一标识
  name: string;                // 显示名称
  api: TApi;                   // API 类型
  provider: Provider;          // 提供商
  baseUrl: string;             // API 基础 URL
  reasoning: boolean;          // 是否支持推理
  input: ModelInputType[];     // 支持的输入类型
  cost: ModelCost;             // 成本配置
  contextWindow: number;       // 上下文窗口大小
  maxTokens: number;           // 最大输出 token
}
```

### 关键设计决策

1. **联合类型而非继承**：使用 discriminated union 区分消息类型
2. **时间戳追踪**：每条消息都有精确的时间戳
3. **签名机制**：`textSignature` 和 `thinkingSignature` 用于多轮对话缓存
4. **使用量追踪**：每条消息都携带 token 使用统计

---

## 流式处理架构

### EventStream 实现

```typescript
// packages/ai/src/utils/event-stream.ts

class EventStream<TEvent, TResult> {
  private events: TEvent[] = [];
  private result?: TResult;
  private subscribers: Array<(event: TEvent) => void> = [];
  private resultSubscribers: Array<(result: TResult) => void> = [];
  
  // 判断是否结束
  private isEnd: (event: TEvent) => boolean;
  
  // 提取结果
  private extractResult: (event: TEvent) => TResult;
  
  // 迭代器协议实现
  async *[Symbol.asyncIterator]() {
    for await (const event of this.source) {
      this.events.push(event);
      for (const sub of this.subscribers) sub(event);
      if (this.isEnd(event)) {
        this.result = this.extractResult(event);
        for (const sub of this.resultSubscribers) sub(this.result);
      }
      yield event;
    }
  }
}
```

### AssistantMessageEventStream

```typescript
// 特化的流类型，用于 LLM 响应
type AssistantMessageEventStream = EventStream<
  AssistantMessageEvent,
  AssistantMessage
>;

// 事件类型
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

### 流式处理优势

1. **实时响应**：用户看到内容逐步呈现
2. **可取消**：支持 AbortSignal 中断
3. **资源高效**：不需要等待完整响应
4. **事件驱动**：灵活的事件订阅模式

---

## Agent 循环机制

### Agent 类核心架构

```typescript
// packages/agent/src/agent.ts

class Agent {
  // ─────────────────────────────────────────────────────
  // 状态管理
  // ─────────────────────────────────────────────────────
  private _state: MutableAgentState;
  
  // 消息队列
  private readonly steeringQueue: PendingMessageQueue;  // 插入当前轮次
  private readonly followUpQueue: PendingMessageQueue;  // 新开轮次
  
  // 事件监听器
  private readonly listeners: Set<AgentEventListener>;
  
  // 当前运行实例
  private activeRun?: ActiveRun;
  
  // ─────────────────────────────────────────────────────
  // 核心方法
  // ─────────────────────────────────────────────────────
  
  // 启动新对话
  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<void>;
  
  // 继续当前对话
  async continue(): Promise<void>;
  
  // 中断当前运行
  abort(): void;
  
  // 等待空闲
  async waitForIdle(): Promise<void>;
  
  // 消息队列操作
  steer(message: AgentMessage): void;   // 插入 steering 队列
  followUp(message: AgentMessage): void; // 插入 follow-up 队列
}
```

### 主循环实现

```typescript
// packages/agent/src/agent-loop.ts

async function runLoop(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<void> {
  let firstTurn = true;
  let pendingMessages = (await config.getSteeringMessages?.()) || [];

  // 外层循环：处理 follow-up 消息
  while (true) {
    let hasMoreToolCalls = true;

    // 内层循环：处理工具调用和 steering 消息
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      if (!firstTurn) {
        await emit({ type: "turn_start" });
      } else {
        firstTurn = false;
      }

      // 1. 处理待处理消息（注入到下一个助手响应前）
      if (pendingMessages.length > 0) {
        for (const message of pendingMessages) {
          await emit({ type: "message_start", message });
          await emit({ type: "message_end", message });
          currentContext.messages.push(message);
          newMessages.push(message);
        }
        pendingMessages = [];
      }

      // 2. 流式获取助手响应
      const message = await streamAssistantResponse(
        currentContext, config, signal, emit, streamFn
      );
      newMessages.push(message);

      // 3. 检查错误或中止
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        await emit({ type: "turn_end", message, toolResults: [] });
        await emit({ type: "agent_end", messages: newMessages });
        return;
      }

      // 4. 执行工具调用
      const toolCalls = message.content.filter(c => c.type === "toolCall");
      hasMoreToolCalls = toolCalls.length > 0;

      const toolResults: ToolResultMessage[] = [];
      if (hasMoreToolCalls) {
        toolResults.push(
          ...(await executeToolCalls(currentContext, message, config, signal, emit))
        );
        
        for (const result of toolResults) {
          currentContext.messages.push(result);
          newMessages.push(result);
        }
      }

      await emit({ type: "turn_end", message, toolResults });

      // 5. 检查 steering 消息
      pendingMessages = (await config.getSteeringMessages?.()) || [];
    }

    // 6. 检查 follow-up 消息
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      continue;
    }

    // 7. 没有更多消息，退出
    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}
```

### 循环流程图

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent Loop                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  turn_start     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │  Steering  │  │   Stream   │  │   Tool     │
     │  Messages  │──▶│  Response  │──▶│  Execution │
     └────────────┘  └────────────┘  └────────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    turn_end     │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
            ┌───────▼───────┐  ┌─────▼─────┐
            │  More Tools?  │  │ Follow-up │
            │  Or Steering? │  │ Messages? │
            └───────┬───────┘  └─────┬─────┘
                    │                 │
              ┌─────┴─────┐     ┌─────┴─────┐
              │           │     │           │
              ▼           ▼     ▼           ▼
           [Inner      [Check  [Outer    [Exit]
            Loop]      No]     Loop]
```

---

## Provider 实现模式

### Provider 接口契约

```typescript
// 所有 Provider 必须满足的契约
type StreamFunction<TApi extends Api, TOptions extends StreamOptions> = (
  model: Model<TApi>,
  context: Context,
  options?: TOptions
) => AssistantMessageEventStream;

interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}
```

### Anthropic Provider 示例

```typescript
// packages/ai/src/providers/anthropic.ts

export function streamAnthropic(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: AnthropicOptions
): AssistantMessageEventStream {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
  
  // 异步处理
  void (async () => {
    try {
      // 1. 构建请求载荷
      const payload = buildAnthropicPayload(model, context, options);
      
      // 2. 允许修改载荷（用于调试/测试）
      const modifiedPayload = await options?.onPayload?.(payload, model) ?? payload;
      
      // 3. 发起流式请求
      const response = await anthropicClient.messages.stream(modifiedPayload);
      
      // 4. 处理流事件
      for await (const event of response) {
        switch (event.type) {
          case "content_block_start":
            // 处理文本/思考/工具调用开始
            break;
          case "content_block_delta":
            // 处理增量内容
            break;
          case "content_block_stop":
            // 处理内容块结束
            break;
          case "message_start":
            // 发出 start 事件
            break;
          case "message_stop":
            // 发出 done 事件
            break;
        }
      }
      
      stream.end(finalMessage);
    } catch (error) {
      // 错误处理
      stream.push({ type: "error", partial: errorMessage, error });
      stream.end(errorMessage);
    }
  })();
  
  return stream;
}
```

### Provider 注册机制

```typescript
// packages/ai/src/api-registry.ts

class ApiRegistry {
  private providers: Map<Api, StreamFunction> = new Map();
  
  register<TApi extends Api>(
    api: TApi, 
    streamFn: StreamFunction<TApi>
  ): void {
    this.providers.set(api, streamFn);
  }
  
  get(api: Api): StreamFunction | undefined {
    return this.providers.get(api);
  }
}

// packages/ai/src/providers/register-builtins.ts
export function registerBuiltinProviders(registry: ApiRegistry): void {
  registry.register("anthropic-messages", streamAnthropic);
  registry.register("openai-completions", streamOpenAICompletions);
  registry.register("openai-responses", streamOpenAIResponses);
  registry.register("google-generative-ai", streamGoogle);
  registry.register("google-gemini-cli", streamGoogleGeminiCli);
  registry.register("google-vertex", streamGoogleVertex);
  registry.register("mistral-conversations", streamMistral);
  registry.register("bedrock-converse-stream", streamBedrock);
}
```

### 统一流式入口

```typescript
// packages/ai/src/stream.ts

export function streamSimple(
  model: Model,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  // 1. 从注册表获取对应 Provider
  const streamFn = apiRegistry.get(model.api);
  
  if (!streamFn) {
    // 立即返回错误流
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
    stream.push({ type: "error", partial: errorMessage, error });
    stream.end(errorMessage);
    return stream;
  }
  
  // 2. 调用 Provider 的流函数
  return streamFn(model, context, options);
}
```

---

## 工具调用系统

### Tool 定义

```typescript
// packages/agent/src/types.ts

interface AgentTool<TResult = any> {
  name: string;                          // 工具名称
  description: string;                   // 工具描述
  parameters: TSchema;                   // 参数 Schema（TypeBox）
  
  // 执行函数
  execute: (
    id: string,                          // 工具调用 ID
    args: any,                           // 验证后的参数
    signal?: AbortSignal,                // 中断信号
    onPartialResult?: (partial: any) => void  // 增量结果回调
  ) => Promise<TResult>;
  
  // 可选：参数预处理
  prepareArguments?: (args: Record<string, any>) => Record<string, any>;
  
  // 可选：结果 Schema
  resultSchema?: TSchema;
}

interface AgentToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}

interface AgentToolResult<TResult = any> {
  type: "toolResult";
  toolCallId: string;
  result: TResult;
  isError: boolean;
}
```

### 工具执行流程

```typescript
// packages/agent/src/agent-loop.ts

async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const toolCalls = assistantMessage.content.filter(c => c.type === "toolCall");
  
  // 根据配置选择执行模式
  if (config.toolExecution === "sequential") {
    return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
  }
  return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}
```

### 并行执行实现

```typescript
async function executeToolCallsParallel(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: AgentToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];
  const runnableCalls: PreparedToolCall[] = [];

  // 1. 预处理阶段（串行）
  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(
      currentContext, assistantMessage, toolCall, config, signal
    );
    
    if (preparation.kind === "immediate") {
      // 立即结果（如工具未找到）
      results.push(
        await emitToolCallOutcome(toolCall, preparation.result, preparation.isError, emit)
      );
    } else {
      runnableCalls.push(preparation);
    }
  }

  // 2. 执行阶段（并行）
  const runningCalls = runnableCalls.map(prepared => ({
    prepared,
    execution: executePreparedToolCall(prepared, signal, emit),
  }));

  // 3. 收集结果
  for (const running of runningCalls) {
    const executed = await running.execution;
    results.push(
      await finalizeExecutedToolCall(
        currentContext, assistantMessage, running.prepared, executed, config, signal, emit
      )
    );
  }

  return results;
}
```

### 参数验证

```typescript
// packages/ai/src/utils/validation.ts

export function validateToolArguments(
  tool: AgentTool<any>, 
  toolCall: AgentToolCall
): unknown {
  const schema = tool.parameters;
  
  if (!schema) {
    return toolCall.arguments;
  }
  
  // 使用 TypeBox 验证
  const valid = Value.Check(schema, toolCall.arguments);
  
  if (!valid) {
    // 尝试修复
    const fixed = Value.Decode(schema, toolCall.arguments);
    return fixed;
  }
  
  return toolCall.arguments;
}
```

---

## 事件系统

### AgentEvent 类型

```typescript
// packages/agent/src/types.ts

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

### 事件发射时序

```
prompt() 调用
    │
    ├── agent_start
    │
    ├── turn_start
    │   ├── message_start (user)
    │   ├── message_end (user)
    │   │
    │   ├── [流式响应开始]
    │   │   message_start (assistant, partial)
    │   │   ├── text_start / thinking_start / toolcall_start
    │   │   │   ├── text_delta / thinking_delta / toolcall_delta (多次)
    │   │   │   └── text_end / thinking_end / toolcall_end
    │   │   └── message_update (多次)
    │   ├── message_end (assistant, final)
    │   │
    │   ├── [工具执行]
    │   │   tool_execution_start
    │   │   tool_execution_update (可选，多次)
    │   │   tool_execution_end
    │   │   │
    │   │   ├── message_start (toolResult)
    │   │   └── message_end (toolResult)
    │   │
    │   └── turn_end
    │
    ├── [如果有多轮工具调用]
    │   turn_start
    │   ...
    │   turn_end
    │
    └── agent_end
```

### 事件监听器

```typescript
// packages/agent/src/agent.ts

class Agent {
  private readonly listeners = new Set<
    (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  >();
  
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private async emit(event: AgentEvent, signal: AbortSignal): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event, signal);
    }
  }
}
```

---

## 数据流转详解

### 完整请求流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 用户输入                                                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Agent.prompt()                                               │
│    - 标准化输入为 AgentMessage[]                                 │
│    - 创建 ActiveRun                                             │
│    - 发射 agent_start 事件                                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. runAgentLoop()                                               │
│    - 添加用户消息到 context                                      │
│    - 发射 message_start/message_end 事件                        │
│    - 进入主循环                                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. streamAssistantResponse()                                    │
│    ├─ transformContext() 可选转换（如上下文压缩）                │
│    ├─ convertToLlm() 转换 AgentMessage[] → Message[]            │
│    └─ streamFn(model, context, options)                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Provider (如 Anthropic)                                      │
│    ├─ 构建 API 请求载荷                                          │
│    ├─ 发起流式 HTTP 请求                                         │
│    └─ 解析 SSE 事件                                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. EventStream 处理                                             │
│    ├─ start: 创建 partial AssistantMessage                      │
│    ├─ text_start/thinking_start/toolcall_start                  │
│    ├─ text_delta/thinking_delta/toolcall_delta (增量更新)       │
│    ├─ text_end/thinking_end/toolcall_end                        │
│    └─ done/error: 最终化 AssistantMessage                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Agent 事件处理                                               │
│    ├─ message_start/message_end                                 │
│    ├─ message_update (传递流事件给监听器)                        │
│    └─ 检查工具调用                                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                    ┌────┴────┐
                    │有工具?  │
                    └────┬────┘
                         │
              ┌──────────┴──────────┐
              │ 是                  │ 否
              ▼                     ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│ 8. executeToolCalls()   │  │ 9. 检查队列             │
│    ├─ 准备阶段          │  │    ├─ Steering?         │
│    ├─ 并行/串行执行     │  │    ├─ Follow-up?        │
│    ├─ 发射工具事件      │  │    └─ 无 → 结束        │
│    └─ 返回工具结果      │  └─────────────────────────┘
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 10. 添加 ToolResultMessage 到 context                           │
│     └─ 返回步骤 4 继续流式响应                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 消息转换流程

```
用户输入 (string | AgentMessage | AgentMessage[])
    │
    ▼
normalizePromptInput()
    │
    ├─ string → [{ role: "user", content: [{ type: "text", text: ... }] }]
    ├─ AgentMessage → [AgentMessage]
    └─ AgentMessage[] → AgentMessage[]
    │
    ▼
AgentMessage (内部格式)
    │
    ├─ UserMessage: { role: "user", content: ..., timestamp }
    ├─ AssistantMessage: { role: "assistant", content: [...], ... }
    └─ ToolResultMessage: { role: "toolResult", toolCallId, result, ... }
    │
    ▼
convertToLlm() (可选 transformContext 后)
    │
    ├─ 过滤只保留 role: "user" | "assistant" | "toolResult"
    │
    ▼
Message (Provider 格式)
    │
    ├─ { role: "user", content: string | ContentPart[] }
    ├─ { role: "assistant", content: ContentPart[], ... }
    └─ { role: "toolResult", toolCallId: string, content: ... }
    │
    ▼
Provider.buildPayload()
    │
    ▼
API Request JSON
```

### 上下文管理

```typescript
interface AgentContext {
  systemPrompt: string;
  model: Model;
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  thinkingLevel: ThinkingLevel;
  apiKey?: string;
}

// 上下文转换示例：上下文压缩
async function compressContext(
  messages: AgentMessage[], 
  signal?: AbortSignal
): Promise<AgentMessage[]> {
  // 1. 保留最近 N 条消息
  // 2. 对旧消息生成摘要
  // 3. 替换为摘要消息
  return compressedMessages;
}

// Agent 配置
const agent = new Agent({
  transformContext: compressContext,
  // ...
});
```

---

## 关键设计模式

### 1. 事件驱动架构

```typescript
// 发布-订阅模式
class Agent {
  subscribe(listener: EventListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private async emit(event: AgentEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event, this.signal);
    }
  }
}
```

### 2. 策略模式（工具执行）

```typescript
type ToolExecutionMode = "parallel" | "sequential";

function executeToolCalls(
  context: AgentContext,
  message: AssistantMessage,
  config: AgentLoopConfig,
  // ...
): Promise<ToolResultMessage[]> {
  if (config.toolExecution === "sequential") {
    return executeToolCallsSequential(...);
  }
  return executeToolCallsParallel(...);
}
```

### 3. 责任链模式（Provider 解析）

```typescript
// API 注册表充当责任链
class ApiRegistry {
  private providers: Map<Api, StreamFunction> = new Map();
  
  resolve(model: Model): StreamFunction {
    const fn = this.providers.get(model.api);
    if (!fn) throw new Error(`Unknown API: ${model.api}`);
    return fn;
  }
}
```

### 4. 观察者模式（流事件）

```typescript
class EventStream {
  private subscribers: Array<(event: TEvent) => void> = [];
  
  push(event: TEvent): void {
    for (const sub of this.subscribers) {
      sub(event);
    }
  }
  
  subscribe(handler: (event: TEvent) => void): void {
    this.subscribers.push(handler);
  }
}
```

### 5. 命令模式（消息队列）

```typescript
class PendingMessageQueue {
  private messages: AgentMessage[] = [];
  
  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }
  
  drain(): AgentMessage[] {
    // 根据模式返回一条或全部
    return this.mode === "all" 
      ? this.messages.splice(0) 
      : this.messages.splice(0, 1);
  }
}
```

---

## 扩展指南

### 添加新的 Provider

1. **定义 API 类型**：
```typescript
// types.ts
export type KnownApi = ... | "my-provider-api";
export type KnownProvider = ... | "my-provider";
```

2. **实现 StreamFunction**：
```typescript
// providers/my-provider.ts
export function streamMyProvider(
  model: Model<"my-provider-api">,
  context: Context,
  options?: MyProviderOptions
): AssistantMessageEventStream {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
  
  void (async () => {
    try {
      // 1. 构建请求
      const payload = buildPayload(model, context, options);
      
      // 2. 调用 API
      const response = await fetch(url, { ... });
      
      // 3. 解析流
      for await (const chunk of response.body) {
        const events = parseChunk(chunk);
        for (const event of events) {
          stream.push(event);
        }
      }
      
      stream.end(finalMessage);
    } catch (error) {
      stream.push({ type: "error", ... });
      stream.end(errorMessage);
    }
  })();
  
  return stream;
}
```

3. **注册 Provider**：
```typescript
// providers/register-builtins.ts
export function registerBuiltinProviders(registry: ApiRegistry): void {
  // ...
  registry.register("my-provider-api", streamMyProvider);
}
```

### 添加新的工具

```typescript
// tools/my-tool.ts
export const myTool: AgentTool<MyResult> = {
  name: "my_tool",
  description: "执行某项操作",
  parameters: Type.Object({
    input: Type.String({ description: "输入参数" }),
    options: Type.Optional(Type.Object({
      flag: Type.Boolean(),
    })),
  }),
  
  async execute(id, args, signal, onPartialResult) {
    // 1. 验证参数已自动完成
    
    // 2. 执行操作
    const result = await performOperation(args, signal);
    
    // 3. 可选：发送增量结果
    onPartialResult?.({ progress: 50 });
    
    // 4. 返回最终结果
    return result;
  },
  
  // 可选：参数预处理
  prepareArguments(args) {
    return {
      ...args,
      input: args.input.trim().toLowerCase(),
    };
  },
};
```

---

## 性能考量

### 1. 流式处理优化

- **增量更新**：只传输变化的内容
- **背压处理**：EventStream 支持异步迭代
- **取消支持**：所有异步操作支持 AbortSignal

### 2. 上下文管理

- **消息截断**：transformContext 可压缩历史
- **缓存签名**：利用 thinkingSignature 复用思考
- **工具过滤**：只发送相关工具定义

### 3. 并发控制

- **工具并行执行**：独立工具同时运行
- **流事件串行**：保证事件顺序
- **队列管理**：steering/follow-up 队列解耦

---

## 测试策略

### 单元测试

```typescript
// 测试流处理
describe("EventStream", () => {
  it("should emit events in order", async () => {
    const stream = new EventStream<TestEvent, TestResult>();
    const events: TestEvent[] = [];
    
    for await (const event of stream) {
      events.push(event);
    }
    
    expect(events).toEqual([...]);
  });
});

// 测试工具执行
describe("executeToolCalls", () => {
  it("should execute tools in parallel", async () => {
    const results = await executeToolCallsParallel(
      context,
      message,
      config,
      undefined,
      emit
    );
    
    expect(results.length).toBe(2);
    // 验证并行执行
    expect(executionOrder).not.toBeSequential();
  });
});
```

### 集成测试

```typescript
// 测试完整 Agent 循环
describe("Agent", () => {
  it("should complete a conversation turn", async () => {
    const agent = new Agent({
      initialState: {
        model: testModel,
        tools: [testTool],
      },
      streamFn: mockStreamFn,
    });
    
    const events: AgentEvent[] = [];
    agent.subscribe((event) => {
      events.push(event);
    });
    
    await agent.prompt("Hello");
    
    expect(events).toContainEqual({ type: "agent_start" });
    expect(events).toContainEqual({ type: "agent_end" });
  });
});
```

---

## 总结

`@mariozechner/pi-ai` 和 `@mariozechner/pi-agent` 提供了一个灵活、可扩展的 AI Agent 框架：

1. **清晰的抽象层**：AI 包提供底层抽象，Agent 包提供高层循环
2. **流式优先**：所有操作都支持流式处理，提供实时反馈
3. **事件驱动**：通过事件系统实现松耦合
4. **可扩展性**：Provider 和工具都可以轻松扩展
5. **类型安全**：使用 TypeScript 和 TypeBox 确保类型正确性

这个架构适合构建复杂的 AI 应用，同时保持代码的可维护性和可测试性。
