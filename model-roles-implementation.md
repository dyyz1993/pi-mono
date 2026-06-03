// ============================================================
// 实现示例：多模型分层架构
// ============================================================
// 这个文件展示了如何实现多模型分层架构的核心部分
// 实际实现时需要根据项目结构调整

// ============================================================
// 1. 类型定义
// ============================================================

/**
 * packages/coding-agent/src/core/model-roles.ts
 */

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
  provider?: string;               // 提供商（可从 model 解析）
  capabilities: ModelCapability[];
  systemPrompt?: string;         // 专用系统提示
  temperature?: number;
  maxTokens?: number;
}

/**
 * Worker 配置（命名的 worker）
 */
export interface WorkerConfig extends ModelRoleConfig {
  name: string;                   // Worker 名称
  role: ModelRole.WORKER;         // 固定为 WORKER
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
 * 任务类型到模型角色的映射
 */
export interface TaskTypeMapping {
  [taskType: string]: {
    role: ModelRole;
    workerName?: string;
  };
}

/**
 * 模型分层配置
 */
export interface ModelTierConfig {
  version: number;
  enabled?: boolean;
  orchestrator?: ModelRoleConfig;
  workers?: WorkerConfig[];
  compression?: ModelRoleConfig;
  extraction?: ModelRoleConfig;
  taskTypeMapping?: TaskTypeMapping;
}

/**
 * 默认角色专用系统提示模板
 */
export const DEFAULT_ROLE_PROMPTS: Record<ModelRole, string> = {
  [ModelRole.ORCHESTRATOR]: `You are a task orchestrator.
Analyze the user's request, break it down into subtasks, and assign each subtask to an appropriate worker model.
Provide clear, actionable instructions for each subtask.`,

  [ModelRole.WORKER]: `You are a task execution specialist.
Follow the instructions provided by the orchestrator and complete the assigned task accurately and efficiently.`,

  [ModelRole.REVIEWER]: `You are a quality review specialist.
Review the provided work and identify any issues, improvements, or potential bugs.`,

  [ModelRole.COMPRESSOR]: `You are a context compression specialist.
Create concise summaries while preserving all critical information, decisions, and context.`,

  [ModelRole.EXTRACTOR]: `You are a data extraction specialist.
Extract structured information from unstructured text accurately and completely.`,
};

// ============================================================
// 2. 配置加载器
// ============================================================

/**
 * packages/coding-agent/src/core/model-role-loader.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ModelRegistry } from "./model-registry.js";
import type { Model } from "@dyyz1993/pi-ai";

export class ModelRoleLoader {
  private config: ModelTierConfig | null = null;

  constructor(
    private configPath: string,
    private modelRegistry: ModelRegistry,
  ) { }

  /**
   * 加载配置文件
   */
  load(): ModelTierConfig | null {
    if (!existsSync(this.configPath)) {
      return null;
    }

    try {
      const content = readFileSync(this.configPath, "utf-8");
      const config = JSON.parse(content) as ModelTierConfig;

      // 验证配置
      this.validateConfig(config);

      this.config = config;
      return config;
    } catch (error) {
      console.error("Failed to load model roles config:", error);
      return null;
    }
  }

  /**
   * 验证配置
   */
  private validateConfig(config: ModelTierConfig): void {
    if (config.version !== 1) {
      throw new Error(`Unsupported config version: ${config.version}`);
    }

    // 验证 orchestrator
    if (config.orchestrator) {
      if (!config.orchestrator.model) {
        throw new Error("Orchestrator config missing 'model'");
      }
      if (!config.orchestrator.capabilities?.length) {
        throw new Error("Orchestrator config missing 'capabilities'");
      }
    }

    // 验证 workers
    if (config.workers) {
      config.workers.forEach((worker, index) => {
        if (!worker.name) {
          throw new Error(`Worker at index ${index} missing 'name'`);
        }
        if (!worker.model) {
          throw new Error(`Worker '${worker.name}' missing 'model'`);
        }
        if (worker.role !== ModelRole.WORKER) {
          throw new Error(`Worker '${worker.name}' must have role 'worker'`);
        }
      });
    }

    // 验证 taskTypeMapping
    if (config.taskTypeMapping) {
      Object.entries(config.taskTypeMapping).forEach(([taskType, mapping]) => {
        if (!Object.values(TaskType).includes(taskType as TaskType)) {
          throw new Error(`Invalid task type: ${taskType}`);
        }
        if (!mapping.role) {
          throw new Error(`Task type '${taskType}' mapping missing 'role'`);
        }
        if (!Object.values(ModelRole).includes(mapping.role)) {
          throw new Error(`Invalid role for task type '${taskType}': ${mapping.role}`);
        }
      });
    }
  }

  /**
   * 获取配置
   */
  getConfig(): ModelTierConfig | null {
    return this.config;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config?.enabled !== false;
  }
}

// ============================================================
// 3. 模型选择器
// ============================================================

/**
 * packages/coding-agent/src/core/model-selector.ts
 */

import type { ModelRegistry } from "./model-registry.js";
import type { Model } from "@dyyz1993/pi-ai";
import { DEFAULT_ROLE_PROMPTS } from "./model-roles.js";

export interface ModelSelection {
  model: Model<Api>;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export class ModelSelector {
  constructor(
    private config: ModelTierConfig | null,
    private modelRegistry: ModelRegistry,
  ) { }

  /**
   * 根据任务类型选择模型
   */
  selectForTaskType(taskType: TaskType): ModelSelection | null {
    if (!this.config?.taskTypeMapping) {
      return null;
    }

    const mapping = this.config.taskTypeMapping[taskType];
    if (!mapping) {
      return null;
    }

    return this.selectForRole(mapping.role, mapping.workerName);
  }

  /**
   * 根据角色选择模型
   */
  selectForRole(role: ModelRole, workerName?: string): ModelSelection | null {
    if (!this.config) {
      return null;
    }

    // 根据角色获取配置
    let config: ModelRoleConfig | undefined;

    switch (role) {
      case ModelRole.ORCHESTRATOR:
        config = this.config.orchestrator;
        break;
      case ModelRole.COMPRESSOR:
        config = this.config.compression;
        break;
      case ModelRole.EXTRACTOR:
        config = this.config.extraction;
        break;
      case ModelRole.WORKER:
        config = this.config.workers?.find(w => w.name === workerName);
        break;
    }

    if (!config) {
      return null;
    }

    // 解析模型 ID
    const model = this.resolveModel(config.model);
    if (!model) {
      console.error(`Failed to resolve model: ${config.model}`);
      return null;
    }

    // 返回选择
    return {
      model,
      systemPrompt: config.systemPrompt || DEFAULT_ROLE_PROMPTS[role],
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    };
  }

  /**
   * 解析模型
   */
  private resolveModel(modelRef: string): Model<Api> | null {
    // 格式: "provider/model" 或 "model"
    const parts = modelRef.split("/");

    if (parts.length === 2) {
      const [provider, modelId] = parts;
      return this.modelRegistry.getModel(provider, modelId);
    } else {
      // 尝试从当前会话的模型推断提供商
      // 或者在所有提供商中搜索
      return this.modelRegistry.findModelById(modelRef);
    }
  }
}

// ============================================================
// 4. 集成到 AgentSession
// ============================================================

/**
 * packages/coding-agent/src/core/agent-session.ts (修改部分)
 */

import { ModelRoleLoader, ModelSelector } from "./model-role-loader.js";
import type { ModelTierConfig } from "./model-roles.js";

export class AgentSession {
  // ... 现有字段 ...

  private modelRoleLoader: ModelRoleLoader;
  private modelSelector: ModelSelector;

  constructor(
    // ... 现有参数 ...
  ) {
    // ... 现有初始化 ...

    // 加载模型角色配置
    const configPath = join(
      this._settingsManager.configDir,
      "model-roles.json",
    );
    this.modelRoleLoader = new ModelRoleLoader(configPath, this._modelRegistry);
    const config = this.modelRoleLoader.load();

    this.modelSelector = new ModelSelector(config, this._modelRegistry);
  }

  /**
   * Fork agent（增强版）
   */
  async forkAgent(promptText: string, options?: ForkAgentOptions): Promise<ForkAgentResult> {
    // 检查是否启用模型角色
    if (this.modelRoleLoader.isEnabled()) {
      // 尝试根据任务类型或角色选择模型
      let modelSelection: ModelSelection | null = null;

      if (options?.taskType) {
        modelSelection = this.modelSelector.selectForTaskType(options.taskType);
      } else if (options?.role) {
        modelSelection = this.modelSelector.selectForRole(options.role, options.workerName);
      }

      // 如果找到了模型选择，使用它
      if (modelSelection) {
        return this.forkAgentWithModel(promptText, modelSelection, options);
      }
    }

    // 如果没有启用或没有找到匹配的模型，使用原有逻辑
    return this.forkAgentWithCurrentModel(promptText, options);
  }

  /**
   * 使用指定模型 fork agent
   */
  private async forkAgentWithModel(
    promptText: string,
    modelSelection: ModelSelection,
    options?: ForkAgentOptions,
  ): Promise<ForkAgentResult> {
    const { model, systemPrompt, temperature, maxTokens } = modelSelection;

    // 构建系统提示
    let effectiveSystemPrompt = systemPrompt;
    if (options?.systemPrompt) {
      effectiveSystemPrompt = `${systemPrompt}\n\n${options.systemPrompt}`;
    } else if (options?.inheritSystemPrompt) {
      effectiveSystemPrompt = `${systemPrompt}\n\n${this.systemPrompt}`;
    }

    // 构建选项
    const forkOptions: ForkAgentOptions = {
      ...options,
      systemPrompt: effectiveSystemPrompt,
      maxTokens: options?.maxTokens ?? maxTokens,
    };

    // 使用指定模型创建 forked agent
    // 这里需要修改原有的 forkAgent 逻辑以支持指定模型
    // 伪代码：
    const forkedAgent = new Agent({
      getApiKey: () => this.getApiKey(model),
      initialState: {
        systemPrompt: effectiveSystemPrompt,
        model,
        thinkingLevel: "off" as const,
      },
      // ...
    });

    // ... 其余逻辑 ...
  }

  /**
   * 使用当前会话模型 fork agent（原有逻辑）
   */
  private async forkAgentWithCurrentModel(
    promptText: string,
    options?: ForkAgentOptions,
  ): Promise<ForkAgentResult> {
    // ... 原有实现 ...
  }
}

// ============================================================
// 5. 导出给插件使用
// ============================================================

/**
 * packages/coding-agent/src/core/index.ts
 */

export {
  // 类型
  type ModelCapability,
  enum ModelRole,
  enum TaskType,
  type ModelRoleConfig,
  type WorkerConfig,
  type TaskConfig,
  type TaskTypeMapping,
  type ModelTierConfig,

  // 工具函数
  DEFAULT_ROLE_PROMPTS,
} from "./model-roles.js";

// ============================================================
// 6. 插件使用示例
// ============================================================

/**
 * 示例插件：任务分发器
 */

import { Extension, Type } from "@dyyz1993/pi-coding-agent";
import { TaskType, ModelRole } from "@dyyz1993/pi-coding-agent";

export default function register(extension: Extension) {
  extension.registerTool({
    name: "dispatch-tasks",
    description: "Dispatch multiple tasks to appropriate worker models",
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        description: Type.String(),
        taskType: Type.Enum(TaskType),
      })),
    }),
    async execute(params, context) {
      const { forkAgent } = context;

      const results = await Promise.all(
        params.tasks.map(async (task) => {
          // 自动根据任务类型选择合适的模型
          const result = await forkAgent(task.description, {
            taskType: task.type,
            tools: ["read", "write", "edit"],
          });

          return {
            taskType: task.type,
            description: task.description,
            result: result.text,
            usage: result.usage,
          };
        }),
      );

      return {
        success: true,
        results,
        totalCost: results.reduce((sum, r) => sum + r.usage.cost, 0),
      };
    },
  });
}

/**
 * 示例插件：智能压缩
 */

import { Extension, Type } from "@dyyz1993/pi-coding-agent";
import { TaskType } from "@dyyz1993/pi-coding-agent";

export default function register(extension: Extension) {
  extension.registerTool({
    name: "smart-compact",
    description: "Compress context using a dedicated compression model",
    parameters: Type.Object({
      instructions: Type.Optional(Type.String()),
    }),
    async execute(params, context) {
      const { forkAgent, session } = context;

      // 获取最近的对话历史
      const recentMessages = session.getRecentMessages(20);
      const contextText = recentMessages
        .map(m => `${m.role}: ${m.content}`)
        .join("\n\n");

      // 使用压缩专用模型
      const instructions = params.instructions ||
        "Summarize the conversation concisely, preserving all key information, decisions, and context.";

      const result = await forkAgent(
        `${instructions}\n\nConversation:\n${contextText}`,
        {
          taskType: TaskType.COMPRESSION,
          shareContext: true,
          maxTokens: 4000,
        }
      );

      return {
        summary: result.text,
        originalTokens: result.usage.input,
        compressedTokens: result.usage.output,
        cost: result.usage.cost,
      };
    },
  });
}

/**
 * 示例插件：数据提取
 */

import { Extension, Type } from "@dyyz1993/pi-coding-agent";
import { TaskType } from "@dyyz1993/pi-coding-agent";

export default function register(extension: Extension) {
  extension.registerTool({
    name: "extract-issues",
    description: "Extract structured issues from error logs",
    parameters: Type.Object({
      logs: Type.String(),
      format: Type.Enum(["json", "markdown"]),
    }),
    async execute(params, context) {
      const { forkAgent } = context;

      const prompt = params.format === "json"
        ? "Extract all issues as a JSON array. Each issue should have: severity (error/warning/info), message, and location."
        : "Extract all issues and format them as a markdown table with columns: Severity, Message, Location.";

      const result = await forkAgent(
        `${prompt}\n\nLogs:\n${params.logs}`,
        {
          taskType: TaskType.EXTRACTION,
          temperature: 0.1,
        }
      );

      return {
        format: params.format,
        content: result.text,
        cost: result.usage.cost,
      };
    },
  });
}

// ============================================================
// 7. 配置文件示例
// ============================================================

/**
 * ~/.pi/agent/model-roles.json
 */

const exampleConfig = {
  "version": 1,
  "enabled": true,

  "orchestrator": {
    "model": "anthropic/claude-opus-4-6",
    "capabilities": ["reasoning", "planning"],
    "systemPrompt": "You are a task orchestrator. Analyze the user's request, break it down into subtasks, and assign each subtask to an appropriate worker model. Provide clear, actionable instructions for each subtask.",
    "temperature": 0.7
  },

  "workers": [
    {
      "name": "code-worker",
      "role": "worker",
      "model": "anthropic/claude-sonnet-4-5",
      "capabilities": ["coding", "execution"],
      "systemPrompt": "You are a code generation specialist. Write clean, well-documented code following best practices.",
      "temperature": 0.3
    },
    {
      "name": "analysis-worker",
      "role": "worker",
      "model": "openai/gpt-4o",
      "capabilities": ["analysis", "extraction", "validation"],
      "systemPrompt": "You are a data analysis specialist. Extract and analyze information accurately.",
      "temperature": 0.2
    }
  ],

  "compression": {
    "role": "compressor",
    "model": "anthropic/claude-haiku-4",
    "capabilities": ["compression"],
    "systemPrompt": "You are a context compression specialist. Create concise summaries while preserving all critical information, decisions, and context.",
    "temperature": 0.1,
    "maxTokens": 4000
  },

  "extraction": {
    "role": "extractor",
    "model": "anthropic/claude-haiku-4",
    "capabilities": ["extraction"],
    "systemPrompt": "You are a data extraction specialist. Extract structured information from unstructured text.",
    "temperature": 0.1
  },

  "taskTypeMapping": {
    "planning": { "role": "orchestrator" },
    "coding": { "role": "worker", "workerName": "code-worker" },
    "execution": { "role": "worker", "workerName": "code-worker" },
    "analysis": { "role": "worker", "workerName": "analysis-worker" },
    "compression": { "role": "compressor" },
    "extraction": { "role": "extractor" },
    "validation": { "role": "worker", "workerName": "analysis-worker" },
    "review": { "role": "worker", "workerName": "analysis-worker" }
  }
};

// ============================================================
// 8. 单元测试示例
// ============================================================

/**
 * packages/coding-agent/test/model-roles.test.ts
 */

import { describe, it, expect } from "vitest";
import { ModelRoleLoader, ModelSelector } from "../src/core/model-role-loader.js";
import { TaskType, ModelRole } from "../src/core/model-roles.js";

describe("ModelRoleLoader", () => {
  it("should load valid config", () => {
    const loader = new ModelRoleLoader("/path/to/config.json", mockModelRegistry);
    const config = loader.load();

    expect(config).not.toBeNull();
    expect(config?.version).toBe(1);
    expect(config?.orchestrator).toBeDefined();
    expect(config?.workers).toHaveLength(2);
  });

  it("should return null if config file does not exist", () => {
    const loader = new ModelRoleLoader("/nonexistent/config.json", mockModelRegistry);
    const config = loader.load();

    expect(config).toBeNull();
  });

  it("should validate config structure", () => {
    const loader = new ModelRoleLoader("/invalid/config.json", mockModelRegistry);

    expect(() => loader.load()).toThrow();
  });
});

describe("ModelSelector", () => {
  it("should select model for task type", () => {
    const selector = new ModelSelector(validConfig, mockModelRegistry);

    const selection = selector.selectForTaskType(TaskType.COMPRESSION);

    expect(selection).not.toBeNull();
    expect(selection?.model.id).toBe("claude-haiku-4");
  });

  it("should select model for role", () => {
    const selector = new ModelSelector(validConfig, mockModelRegistry);

    const selection = selector.selectForRole(ModelRole.ORCHESTRATOR);

    expect(selection).not.toBeNull();
    expect(selection?.model.id).toBe("claude-opus-4-6");
  });

  it("should select specific worker", () => {
    const selector = new ModelSelector(validConfig, mockModelRegistry);

    const selection = selector.selectForRole(ModelRole.WORKER, "code-worker");

    expect(selection).not.toBeNull();
    expect(selection?.model.id).toBe("claude-sonnet-4-5");
  });

  it("should return null for non-existent worker", () => {
    const selector = new ModelSelector(validConfig, mockModelRegistry);

    const selection = selector.selectForRole(ModelRole.WORKER, "non-existent");

    expect(selection).toBeNull();
  });
});

// Mock objects for testing
const mockModelRegistry = {
  getModel: (provider: string, modelId: string) => ({
    id: modelId,
    provider,
  }),
  findModelById: (modelId: string) => ({
    id: modelId,
    provider: "anthropic",
  }),
} as any;

const validConfig = {
  version: 1,
  enabled: true,
  orchestrator: {
    role: ModelRole.ORCHESTRATOR,
    model: "anthropic/claude-opus-4-6",
    capabilities: ["reasoning", "planning"],
  },
  workers: [
    {
      role: ModelRole.WORKER,
      name: "code-worker",
      model: "anthropic/claude-sonnet-4-5",
      capabilities: ["coding", "execution"],
    },
  ],
  compression: {
    role: ModelRole.COMPRESSOR,
    model: "anthropic/claude-haiku-4",
    capabilities: ["compression"],
  },
  extraction: {
    role: ModelRole.EXTRACTOR,
    model: "anthropic/claude-haiku-4",
    capabilities: ["extraction"],
  },
  taskTypeMapping: {
    planning: { role: ModelRole.ORCHESTRATOR },
    coding: { role: ModelRole.WORKER, workerName: "code-worker" },
    compression: { role: ModelRole.COMPRESSOR },
    extraction: { role: ModelRole.EXTRACTOR },
  },
};
