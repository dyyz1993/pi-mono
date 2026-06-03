# 多模型分层架构分析

## 问题背景

用户希望了解 pi 是否有以下三个维度的概念：

1. **子任务（Subtask）** - 任务分解和分层
2. **高阶模型（High-level Model）** - 用于管理和分配任务的模型
3. **任务类型/角色分类** - 不同的任务类型可以使用不同的处理策略

用户希望在插件中能够快速使用这些概念，用于：
- 任务分发
- 内容压缩
- 数据提取

## 当前 Pi 的实现状态

### 已有功能

#### 1. ForkAgent（子代理/子任务）
```typescript
// packages/coding-agent/src/core/extensions/types.ts

export interface ForkAgentOptions {
  systemPrompt?: string;
  inheritSystemPrompt?: boolean;
  tools?: string[];
  writePaths?: string[];
  bash?: "deny" | "readonly";
  maxTurns?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  shareContext?: boolean;
}

export interface ForkAgentResult {
  text: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
}
```

**用途**：从主 agent fork 出一个子 agent 来执行特定任务。

**限制**：
- 没有明确的"高阶模型"概念
- 子 agent 继承或使用相同的模型
- 没有任务类型分类
- 没有任务分发的自动机制

#### 2. Scoped Models（范围限定模型）
```typescript
// packages/coding-agent/src/core/model-resolver.ts

export interface ScopedModel {
  model: Model<Api>;
  thinkingLevel?: ThinkingLevel;
}
```

**用途**：通过 Ctrl+P 快速切换多个预设模型。

**限制**：
- 仅支持手动切换
- 没有基于任务类型的自动选择

#### 3. Model Registry
```typescript
// packages/coding-agent/src/core/model-registry.ts
```

**用途**：管理多个提供商的模型。

**限制**：
- 模型没有"能力"或"角色"分类
- 没有基于场景的推荐机制

### 缺失的功能

1. **明确的任务类型枚举**
   - 没有 `TaskType` 或 `ModelRole` 类型定义
   - 没有基于任务类型的配置

2. **高阶/低阶模型分层**
   - 没有 `ModelTier` 或 `ModelLevel` 概念
   - 没有自动模型选择策略

3. **任务分发器**
   - 没有基于任务类型的自动路由机制
   - 没有任务队列管理

4. **插件友好的类型导出**
   - 插件开发者需要自己实现这些概念

## 外部框架参考

### 1. OpenCode (OpenInterpreter)
#### 多模型架构
OpenCode 使用以下分层：
- **Orchestrator Model** - 高阶模型，用于：
  - 任务分解
  - 子任务分配
  - 结果整合
- **Worker Models** - 低阶模型，用于：
  - 具体代码执行
  - 文件操作
  - 工具调用

#### 配置示例
```yaml
models:
  orchestrator:
    provider: anthropic
    model: claude-opus-4-6
    role: planner
    capabilities: [reasoning, planning]

  worker:
    provider: openai
    model: gpt-4o
    role: executor
    capabilities: [coding, execution]
```

### 2. Claude Code
#### 分层概念
Claude Code 的分层：
- **Supervisor Agent** - 主控
  - 理解用户意图
  - 分解任务
  - 协调子 agent

- **Specialized Agents** - 专业化
  - `CodeAgent` - 代码生成
  - `FileSystemAgent` - 文件操作
  - `ToolAgent` - 工具调用
  - `RefinementAgent` - 结果优化

#### 配置示例
```json
{
  "agents": {
    "supervisor": {
      "model": "claude-opus-4-6",
      "system_prompt": "...",
      "tools": ["task_dispatcher", "result_aggregator"]
    },
    "code": {
      "model": "claude-sonnet-4-5",
      "system_prompt": "...",
      "tools": ["read", "write", "edit"]
    },
    "tools": {
      "model": "claude-haiku-4",
      "system_prompt": "...",
      "tools": ["bash", "git"]
    }
  }
}
```

### 3. AutoGPT / BabyAGI
#### 任务分层
- **Controller** - 高层规划
- **Planner** - 任务分解
- **Executor** - 具体执行
- **Critic** - 结果评估

### 4. Cline (VSCode extension)
#### 模型角色
- `fastModel` - 快速响应（Haiku）
- `slowModel` - 深度思考（Opus）
- 基于任务复杂度自动切换

## 建议的实现方案

### 方案 1：轻量级类型定义（推荐）

在 `packages/coding-agent/src/core/` 添加新类型：

```typescript
// model-roles.ts

/**
 * 模型能力标签
 */
export type ModelCapability =
  | "reasoning"      // 推理规划
  | "coding"         // 代码生成
  | "execution"      // 工具执行
  | "analysis"       // 数据分析
  | "compression"    // 内容压缩
  | "extraction"    // 数据提取
  | "validation"    // 验证检查
  | "summarization"; // 总结归纳

/**
 * 模型角色/层级
 */
export enum ModelRole {
  ORCHESTRATOR = "orchestrator",  // 编排器：任务分解、分配
  WORKER = "worker",              // 工作者：具体执行
  REVIEWER = "reviewer",          // 审查者：质量检查
  COMPRESSOR = "compressor",      // 压缩器：上下文压缩
  EXTRACTOR = "extractor",        // 提取器：数据提取
}

/**
 * 任务类型
 */
export enum TaskType {
  PLANNING = "planning",          // 规划任务
  CODING = "coding",              // 编码任务
  EXECUTION = "execution",        // 执行任务
  ANALYSIS = "analysis",          // 分析任务
  COMPRESSION = "compression",    // 压缩任务
  EXTRACTION = "extraction",      // 提取任务
  VALIDATION = "validation",      // 验证任务
  REVIEW = "review",              // 审查任务
}

/**
 * 模型角色配置
 */
export interface ModelRoleConfig {
  role: ModelRole;
  model: string;                  // 模型 ID
  provider: string;               // 提供商
  capabilities: ModelCapability[];
  systemPrompt?: string;         // 可选的专用系统提示
  temperature?: number;
  maxTokens?: number;
}

/**
 * 任务配置
 */
export interface TaskConfig {
  type: TaskType;
  requiredCapabilities: ModelCapability[];
  preferredRole?: ModelRole;
  estimatedComplexity?: number;   // 1-10
}

/**
 * 模型分层配置
 */
export interface ModelTierConfig {
  orchestrator?: ModelRoleConfig;     // 高阶模型
  workers?: ModelRoleConfig[];        // 低阶模型池
  compression?: ModelRoleConfig;      // 压缩专用模型
  extraction?: ModelRoleConfig;       // 提取专用模型
}
```

### 方案 2：扩展 ForkAgent

```typescript
// packages/coding-agent/src/core/extensions/types.ts

export interface ForkAgentOptions {
  // 现有字段...

  // 新增字段
  role?: ModelRole;              // 指定子 agent 的角色
  taskType?: TaskType;           // 任务类型
  capabilities?: ModelCapability[]; // 需要的能力

  // 或者直接指定模型（覆盖自动选择）
  overrideModel?: string;
}
```

### 方案 3：配置文件支持

```json
// ~/.pi/agent/model-roles.json
{
  "version": 1,
  "orchestrator": {
    "model": "anthropic/claude-opus-4-6",
    "systemPrompt": "You are a task orchestrator...",
    "capabilities": ["reasoning", "planning"]
  },
  "workers": [
    {
      "name": "code-worker",
      "model": "anthropic/claude-sonnet-4-5",
      "capabilities": ["coding", "execution"]
    },
    {
      "name": "analysis-worker",
      "model": "openai/gpt-4o",
      "capabilities": ["analysis", "extraction"]
    }
  ],
  "compression": {
    "model": "anthropic/claude-haiku-4",
    "capabilities": ["compression"]
  },
  "extraction": {
    "model": "anthropic/claude-haiku-4",
    "capabilities": ["extraction"]
  },
  "taskTypeMapping": {
    "planning": { "role": "orchestrator" },
    "coding": { "role": "worker", "name": "code-worker" },
    "execution": { "role": "worker", "name": "code-worker" },
    "analysis": { "role": "worker", "name": "analysis-worker" },
    "compression": { "role": "compression" },
    "extraction": { "role": "extraction" }
  }
}
```

## 插件使用示例

### 示例 1：使用子任务分发

```typescript
// 在插件中
export function register(extension: Extension) {
  extension.registerTool({
    name: "parallel-code-generation",
    description: "Generate code for multiple files in parallel",
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        file: Type.String(),
        description: Type.String(),
        taskType: Type.Enum(TaskType),
      })),
    }),
    async execute(params, context) {
      const { forkAgent } = context;

      // 根据任务类型选择合适的模型
      const results = await Promise.all(
        params.tasks.map(task =>
          forkAgent(task.description, {
            taskType: task.type,  // 自动选择模型
            tools: ["read", "write"],
            writePaths: [task.file],
          })
        )
      );

      return { results };
    },
  });
}
```

### 示例 2：使用压缩器

```typescript
export function register(extension: Extension) {
  extension.registerTool({
    name: "smart-compact",
    description: "Compact session using dedicated compression model",
    parameters: Type.Object({}),
    async execute(params, context) {
      const { forkAgent } = context;

      // 使用专用压缩模型
      const compressed = await forkAgent(
        "Summarize the following conversation...",
        {
          taskType: TaskType.COMPRESSION,  // 自动选择压缩模型
          shareContext: true,
          maxTokens: 4000,
        }
      );

      return { summary: compressed.text };
    },
  });
}
```

### 示例 3：使用提取器

```typescript
export function register(extension: Extension) {
  extension.registerTool({
    name: "extract-issues",
    description: "Extract issues from error logs",
    parameters: Type.Object({
      logs: Type.String(),
    }),
    async execute(params, context) {
      const { forkAgent } = context;

      const issues = await forkAgent(
        `Extract structured issues from these logs:\n${params.logs}`,
        {
          taskType: TaskType.EXTRACTION,  // 自动选择提取模型
          systemPrompt: "You are a data extraction specialist...",
        }
      );

      return { issues: JSON.parse(issues.text) };
    },
  });
}
```

## 实现步骤

### Phase 1: 类型定义
1. 创建 `packages/coding-agent/src/core/model-roles.ts`
2. 定义 `TaskType`, `ModelRole`, `ModelCapability` 等
3. 导出到 `packages/coding-agent/src/core/index.ts`

### Phase 2: 配置加载
1. 添加 `~/.pi/agent/model-roles.json` 配置支持
2. 在 `ModelRegistry` 中添加角色配置加载
3. 添加默认配置（向后兼容）

### Phase 3: ForkAgent 增强
1. 扩展 `ForkAgentOptions` 支持角色和任务类型
2. 实现模型自动选择逻辑
3. 添加角色专用的 system prompt 模板

### Phase 4: 插件 API
1. 扩展 `ExtensionContext` 添加便捷方法
2. 添加 `createTask()`, `dispatchTask()` 等辅助函数
3. 编写插件开发文档和示例

### Phase 5: 内置工具更新
1. 更新 `/compact` 使用压缩模型
2. 添加 `/task` 命令用于任务分发
3. 添加 `/workers` 命令查看配置

## 向后兼容性

- 所有新配置都是可选的
- 默认行为保持不变
- 现有插件无需修改即可继续工作
- 新功能通过 `ForkAgentOptions` 的扩展字段启用

## 总结

**当前状态**：
- ✅ 有 `ForkAgent` 可以创建子 agent
- ❌ 没有明确的任务类型分类
- ❌ 没有高阶/低阶模型分层
- ❌ 没有插件友好的类型定义

**建议方向**：
- 添加类型定义（轻量级）
- 支持配置文件（可选）
- 扩展 `ForkAgent` API
- 保持向后兼容

**用户价值**：
- 插件开发者可以快速实现任务分发
- 可以使用专用模型进行压缩、提取等操作
- 可以根据任务类型自动选择最合适的模型
- 与 OpenCode、Claude Code 等框架保持一致的体验
