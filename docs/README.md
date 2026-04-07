# pi 项目文档索引

本目录包含 `@mariozechner/pi-ai` 和 `@mariozechner/pi-agent` 包的完整文档。

## 文档列表

### [架构文档](./architecture.md)

深入分析项目的核心架构，包括：

- 包结构概览与依赖关系
- 核心类型系统（消息、模型、工具等）
- 流式处理架构（EventStream 实现）
- Agent 循环机制（主循环、队列管理）
- Provider 实现模式（契约、注册、统一入口）
- 工具调用系统（定义、执行、验证）
- 事件系统（类型、发射时序）
- 数据流转详解（完整请求流程、消息转换）

**适合**：想要深入理解项目内部实现的开发者。

---

### [数据流与交互图解](./data-flow-diagrams.md)

使用 Mermaid 图表展示数据流和交互模式，包括：

- 整体架构图（包依赖、运行时组件）
- 消息生命周期（转换流程、时序图）
- Agent 循环详解（流程图、队列模式）
- 工具执行流程（并行 vs 串行、钩子系统）
- Provider 交互（选择机制、流式事件转换）
- 事件系统（类型层次、发射顺序、监听器模式）
- 流式处理（EventStream 结构、异步迭代器协议）
- 并发与取消（AbortSignal 传播、ActiveRun 管理）
- 缓存机制（Prompt Caching 签名、命中率优化）

**适合**：喜欢通过图表理解系统的开发者。

---

### [实践指南](./practical-guide.md)

使用 pi 构建 AI Agent 的实践指南，包括：

- 快速开始（最小示例）
- 基础用法（创建 Agent、发送消息、订阅事件）
- 工具开发（基础工具、参数预处理、复杂工具）
- Provider 集成（内置 Provider、自定义 Provider）
- 事件处理（实时显示、日志记录、指标收集）
- 高级主题（上下文管理、动态工具、多模态、并发控制）
- 最佳实践（错误处理、取消操作、资源清理、类型安全）
- 常见问题（FAQ）

**适合**：想要使用 pi 构建应用的开发者。

---

### [API 参考](./api-reference.md)

完整的 API 参考文档，包括：

- @mariozechner/pi-ai
  - 核心类型（Api, Provider, ThinkingLevel）
  - Model（接口、示例）
  - Context 和 Tool
  - Message（UserMessage, AssistantMessage, ToolResultMessage）
  - StreamFunction（契约、选项）
  - EventStream（类、事件类型）
  - ApiRegistry（注册表接口）
  - 工具函数

- @mariozechner/pi-agent
  - Agent（类、方法、示例）
  - AgentState（接口、扩展）
  - AgentConfig（配置选项、钩子）
  - AgentEvent（类型、顺序）
  - AgentTool（定义、示例）
  - AgentContext

- Provider 选项（Anthropic, OpenAI, Google, Bedrock）
- 类型导入汇总

**适合**：需要查阅具体 API 的开发者。

---

## 快速导航

### 我想...

- **开始使用** → [实践指南：快速开始](./practical-guide.md#快速开始)
- **理解架构** → [架构文档](./architecture.md)
- **查看图表** → [数据流与交互图解](./data-flow-diagrams.md)
- **开发工具** → [实践指南：工具开发](./practical-guide.md#工具开发)
- **集成 Provider** → [实践指南：Provider 集成](./practical-guide.md#provider-集成)
- **查阅 API** → [API 参考](./api-reference.md)
- **解决问题** → [实践指南：常见问题](./practical-guide.md#常见问题)
- **学习最佳实践** → [实践指南：最佳实践](./practical-guide.md#最佳实践)

### 我想理解...

- **消息如何流转** → [架构文档：数据流转详解](./architecture.md#数据流转详解)
- **Agent 循环如何工作** → [架构文档：Agent 循环机制](./architecture.md#agent-循环机制)
- **工具如何执行** → [架构文档：工具调用系统](./architecture.md#工具调用系统)
- **流式处理如何实现** → [架构文档：流式处理架构](./architecture.md#流式处理架构)
- **事件如何发射** → [架构文档：事件系统](./architecture.md#事件系统)
- **如何实现自定义 Provider** → [实践指南：实现自定义 Provider](./practical-guide.md#实现自定义-provider)

### 我想查看...

- **包依赖关系图** → [数据流与交互图解：整体架构](./data-flow-diagrams.md#整体架构)
- **消息转换流程图** → [数据流与交互图解：消息生命周期](./data-flow-diagrams.md#消息生命周期)
- **Agent 循环流程图** → [数据流与交互图解：Agent 循环详解](./data-flow-diagrams.md#agent-循环详解)
- **工具执行时序图** → [数据流与交互图解：工具执行流程](./data-flow-diagrams.md#工具执行流程)
- **事件发射时序图** → [数据流与交互图解：事件系统](./data-flow-diagrams.md#事件系统)
- **流式处理流程图** → [数据流与交互图解：流式处理](./data-flow-diagrams.md#流式处理)

---

## 核心概念速查

### Agent

管理对话状态和循环的核心类。

```typescript
const agent = new Agent({
  initialState: {
    model: myModel,
    systemPrompt: "...",
    messages: [],
    tools: [],
    thinkingLevel: "medium",
  },
  streamFn: streamSimple,
});

await agent.prompt("Hello");
```

### EventStream

流式事件处理的基础类。

```typescript
const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();

stream.push({ type: "text_delta", delta: "Hello", partial: message });
stream.end(message);

for await (const event of stream) {
  console.log(event);
}
```

### AgentTool

工具定义接口。

```typescript
const myTool: AgentTool = {
  name: "my_tool",
  description: "Does something",
  parameters: Type.Object({ input: Type.String() }),
  async execute(id, args, signal) {
    return { result: "done" };
  },
};
```

### Provider

LLM 提供商实现。

```typescript
export function streamMyProvider(
  model: Model,
  context: Context,
  options?: StreamOptions
): AssistantMessageEventStream {
  const stream = new EventStream();
  // 实现流式处理
  return stream;
}

apiRegistry.register("my-api", streamMyProvider);
```

---

## 示例代码位置

完整的示例代码可以在以下位置找到：

- **基础示例**：[实践指南：基础用法](./practical-guide.md#基础用法)
- **工具示例**：[实践指南：工具开发](./practical-guide.md#工具开发)
- **Provider 示例**：[实践指南：实现自定义 Provider](./practical-guide.md#实现自定义-provider)
- **事件处理示例**：[实践指南：事件处理](./practical-guide.md#事件处理)

---

## 版本信息

- 文档版本：1.0.0
- 最后更新：2025-01-XX
- 适用包版本：
  - @mariozechner/pi-ai: latest
  - @mariozechner/pi-agent: latest

---

## 贡献

如果您发现文档有误或需要补充，欢迎提交 Issue 或 Pull Request。

---

## 许可证

本文档遵循与项目相同的许可证。
