# 多模型分层架构分析总结

## 核心问题回答

### Q: pi 是否有子任务的概念？
**A: 部分有**

**已有**：
- `ForkAgent` - 可以创建子 agent 执行特定任务
- 支持配置子 agent 的工具、权限、maxTurns 等

**缺失**：
- 没有明确的 `TaskType` 类型定义
- 没有任务分发器
- 没有任务队列管理
- 插件开发者需要自己实现任务分发逻辑

### Q: pi 是否有高阶模型用于管理分配的概念？
**A: 没有**

**现状**：
- 所有 agent 使用相同的模型
- ForkAgent 继承主 agent 的模型
- 没有模型角色分层（高阶/低阶）
- 没有基于任务复杂度的自动模型选择

### Q: pi 是否有三个维度的概念（任务类型、模型角色、能力分类）？
**A: 完全没有**

**缺失的类型定义**：
- 没有 `TaskType` 枚举（规划、编码、执行、压缩、提取等）
- 没有 `ModelRole` 枚举（编排器、工作者、审查者等）
- 没有 `ModelCapability` 类型（推理、编码、执行、分析等）

---

## 外部框架对比

### OpenCode (OpenInterpreter)
**架构**：
- **Orchestrator Model** - 任务分解、分配
- **Worker Models** - 具体执行
- 通过 LiteLLM 支持多提供商

**配置方式**：
```python
interpreter.llm.model = "claude-opus-4-6"  # 切换模型
interpreter.system_message += "..."        # 自定义系统提示
```

**特点**：
- 简单直接，通过 Python 对象配置
- 没有复杂的角色系统
- 模型切换是手动的

### Cline (VSCode Extension)
**架构**：
- **Fast Model** - 快速响应（Haiku）
- **Slow Model** - 深度思考（Opus）

**配置方式**：
- 在设置中配置多个 API 密钥
- 根据任务类型自动选择

**特点**：
- 只有两个层级（快/慢）
- 没有复杂的多角色系统
- 自动化程度较高

### Claude Code（概念）
**架构**：
- **Supervisor Agent** - 主控
- **Specialized Agents** - 专业化（代码、文件系统、工具等）

**配置方式**：
- 配置文件定义多个 agent
- 每个 agent 有独立的模型和工具

**特点**：
- 多角色系统
- 每个 agent 有明确的职责
- 需要配置多个 agent

### AutoGPT / BabyAGI
**架构**：
- **Controller** - 高层规划
- **Planner** - 任务分解
- **Executor** - 具体执行
- **Critic** - 结果评估

**特点**：
- 复杂的多层架构
- 适合自主代理场景
- 配置复杂

---

## 推荐的实现方案

### 方案概述
采用**轻量级类型定义 + 可选配置**的方式，保持向后兼容。

### 1. 类型定义（核心）

```typescript
// packages/coding-agent/src/core/model-roles.ts

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
  model: string;                  // 模型 ID (e.g., "anthropic/claude-opus-4-6")
  provider?: string;              // 提供商（从模型 ID 解析，可选）
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

/**
 * 任务类型到模型角色的映射
 */
export interface TaskTypeMapping {
  [taskType: string]: {
    role: ModelRole;
    workerName?: string;  // 如果有多个 worker，指定使用哪一个
  };
}
```

### 2. 扩展 ForkAgent（向后兼容）

```typescript
// packages/coding-agent/src/core/extensions/types.ts

export interface ForkAgentOptions {
  // === 现有字段（保持不变） ===
  systemPrompt?: string;
  inheritSystemPrompt?: boolean;
  tools?: string[];
  writePaths?: string[];
  bash?: "deny" | "readonly";
  maxTurns?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  shareContext?: boolean;

  // === 新增字段 ===
  /** 任务类型，用于自动选择模型 */
  taskType?: TaskType;

  /** 模型角色，用于自动选择模型 */
  role?: ModelRole;

  /** 需要的模型能力 */
  capabilities?: ModelCapability[];

  /** 直接覆盖模型（跳过自动选择） */
  overrideModel?: string;

  /** worker 名称（如果有多个 worker） */
  workerName?: string;
}
```

### 3. 配置文件支持（可选）

```json
// ~/.pi/agent/model-roles.json
{
  "version": 1,
  "enabled": true,

  // 编排器配置（高阶模型）
  "orchestrator": {
    "model": "anthropic/claude-opus-4-6",
    "capabilities": ["reasoning", "planning"],
    "systemPrompt": "You are a task orchestrator. Analyze the user's request, break it down into subtasks, and assign each subtask to an appropriate worker model.",
    "temperature": 0.7
  },

  // 工作者配置（低阶模型）
  "workers": [
    {
      "name": "code-worker",
      "model": "anthropic/claude-sonnet-4-5",
      "capabilities": ["coding", "execution"],
      "systemPrompt": "You are a code generation specialist. Write clean, well-documented code following best practices.",
      "temperature": 0.3
    },
    {
      "name": "analysis-worker",
      "model": "openai/gpt-4o",
      "capabilities": ["analysis", "extraction"],
      "systemPrompt": "You are a data analysis specialist. Extract and analyze information accurately.",
      "temperature": 0.2
    }
  ],

  // 压缩专用模型
  "compression": {
    "model": "anthropic/claude-haiku-4",
    "capabilities": ["compression"],
    "systemPrompt": "You are a context compression specialist. Create concise summaries while preserving key information.",
    "temperature": 0.1,
    "maxTokens": 4000
  },

  // 提取专用模型
  "extraction": {
    "model": "anthropic/claude-haiku-4",
    "capabilities": ["extraction"],
    "systemPrompt": "You are a data extraction specialist. Extract structured information from unstructured text.",
    "temperature": 0.1
  },

  // 任务类型到模型的映射
  "taskTypeMapping": {
    "planning": { "role": "orchestrator" },
    "coding": { "role": "worker", "workerName": "code-worker" },
    "execution": { "role": "worker", "workerName": "code-worker" },
    "analysis": { "role": "worker", "workerName": "analysis-worker" },
    "compression": { "role": "compression" },
    "extraction": { "role": "extraction" },
    "validation": { "role": "worker", "workerName": "analysis-worker" },
    "review": { "role": "worker", "workerName": "analysis-worker" }
  }
}
```

### 4. 默认配置（向后兼容）

```typescript
// 如果没有配置文件，使用默认行为：
// 1. 所有 forkAgent 使用当前会话的模型
// 2. 忽略 taskType、role 等字段
// 3. 完全向后兼容
```

---

## 插件使用示例

### 示例 1：任务分发

```typescript
import { TaskType } from "@dyyz1993/pi-coding-agent";

export function register(extension: Extension) {
  extension.registerTool({
    name: "parallel-task",
    description: "Execute multiple tasks in parallel with appropriate models",
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        description: Type.String(),
        taskType: Type.Enum(TaskType),
      })),
    }),
    async execute(params, context) {
      const { forkAgent } = context;

      // 根据任务类型自动选择模型
      const results = await Promise.all(
        params.tasks.map(task =>
          forkAgent(task.description, {
            taskType: task.type,  // 自动选择合适的模型
            tools: ["read", "write"],
          })
        )
      );

      return { results };
    },
  });
}
```

### 示例 2：专用压缩

```typescript
import { TaskType } from "@dyyz1993/pi-coding-agent";

export function register(extension: Extension) {
  extension.registerTool({
    name: "smart-compact",
    description: "Compact session using dedicated compression model",
    parameters: Type.Object({}),
    async execute(params, context) {
      const { forkAgent } = context;

      const compressed = await forkAgent(
        "Summarize the conversation concisely...",
        {
          taskType: TaskType.COMPRESSION,  // 自动使用 Haiku
          shareContext: true,
        }
      );

      return { summary: compressed.text };
    },
  });
}
```

### 示例 3：数据提取

```typescript
import { TaskType } from "@dyyz1993/pi-coding-agent";

export function register(extension: Extension) {
  extension.registerTool({
    name: "extract-issues",
    description: "Extract structured issues from logs",
    parameters: Type.Object({
      logs: Type.String(),
    }),
    async execute(params, context) {
      const { forkAgent } = context;

      const result = await forkAgent(
        `Extract issues from:\n${params.logs}`,
        {
          taskType: TaskType.EXTRACTION,  // 自动使用提取模型
          systemPrompt: "Return JSON array of issues with {severity, message, location}",
        }
      );

      return { issues: JSON.parse(result.text) };
    },
  });
}
```

---

## 实现步骤

### Phase 1: 类型定义（1-2 天）
1. 创建 `packages/coding-agent/src/core/model-roles.ts`
2. 定义所有类型和枚举
3. 导出到 `packages/coding-agent/src/core/index.ts`
4. 添加 TypeScript 测试

### Phase 2: 配置加载（2-3 天）
1. 扩展 `ModelRegistry` 添加角色配置加载
2. 创建配置文件加载器
3. 添加默认配置逻辑
4. 添加配置验证

### Phase 3: ForkAgent 增强（2-3 天）
1. 扩展 `ForkAgentOptions` 类型
2. 实现模型自动选择逻辑
3. 添加角色专用系统提示
4. 更新文档

### Phase 4: 插件 API（1-2 天）
1. 扩展 `ExtensionContext`
2. 添加辅助函数
3. 编写插件开发文档
4. 创建示例插件

### Phase 5: 内置工具更新（1-2 天）
1. 更新 `/compact` 命令
2. 添加 `/task` 命令
3. 添加 `/workers` 命令
4. 更新用户文档

**总计**: 7-12 天

---

## 向后兼容性保证

### 完全向后兼容
- 所有新字段都是可选的
- 默认行为保持不变
- 现有插件无需修改

### 渐进式采用
- Phase 1 完成后，插件开发者可以立即使用类型
- Phase 3 完成后，可以使用 `taskType` 参数
- Phase 4 完成后，可以使用便捷 API

---

## 用户价值

### 对插件开发者
1. **快速实现任务分发** - 通过 `taskType` 自动选择模型
2. **专用模型支持** - 压缩、提取等使用廉价模型
3. **类型安全** - 完整的 TypeScript 类型定义
4. **易于扩展** - 可以添加自定义任务类型和模型角色

### 对最终用户
1. **成本优化** - 用合适的模型做合适的事
2. **性能提升** - 快速模型处理简单任务
3. **质量保证** - 高阶模型处理复杂任务
4. **灵活配置** - 可以自定义模型分层

---

## 与外部框架对比

| 特性 | pi（当前） | pi（建议） | OpenCode | Cline | Claude Code |
|------|-----------|-----------|----------|-------|-------------|
| 子任务 | ✅ ForkAgent | ✅ + 类型 | ✅ | ❌ | ✅ |
| 多模型 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 任务类型 | ❌ | ✅ | ❌ | ✅ | ✅ |
| 模型角色 | ❌ | ✅ | ❌ | ✅ | ✅ |
| 配置文件 | ❌ | ✅ | 代码 | UI | ✅ |
| 插件友好 | ⚠️ | ✅ | ✅ | N/A | N/A |
| 向后兼容 | N/A | ✅ | N/A | N/A | N/A |

---

## 建议的下一步

1. **创建 POC** - 先实现一个最小可用的原型
2. **收集反馈** - 让插件开发者试用
3. **迭代优化** - 根据反馈调整设计
4. **完善文档** - 编写详细的开发指南
5. **示例插件** - 创建几个示例插件展示用法

---

## 总结

**当前问题**：
- ✅ 有 ForkAgent 可以创建子 agent
- ❌ 没有任务类型分类
- ❌ 没有模型角色分层
- ❌ 插件开发者需要自己实现

**推荐方案**：
- 添加类型定义（轻量级）
- 支持配置文件（可选）
- 扩展 ForkAgent API
- 保持向后兼容

**价值**：
- 插件开发者可以快速实现任务分发
- 使用专用模型降低成本
- 根据任务类型自动选择模型
- 与主流框架保持一致的体验
