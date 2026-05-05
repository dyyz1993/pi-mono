# 多模型分层架构 - 快速参考

## 核心问题：三个维度的概念

你问的三个维度：

1. ✅ **子任务（Subtask）** - pi 有 `ForkAgent`，但没有类型定义
2. ❌ **高阶模型（High-level Model）** - pi 完全没有这个概念
3. ❌ **任务类型/角色分类** - pi 完全没有这个概念

## 当前 Pi 的状态

### 已有功能
```typescript
// ForkAgent - 可以创建子 agent
await forkAgent(prompt, {
  tools: ["read", "write"],
  maxTurns: 5,
  bash: "readonly",
});
```

### 缺失功能
- 没有 `TaskType` 类型（规划、编码、压缩、提取等）
- 没有 `ModelRole` 类型（编排器、工作者、压缩器等）
- 没有模型自动选择
- 没有配置文件支持

## 外部框架对比

| 框架 | 子任务 | 多模型 | 任务类型 | 配置方式 |
|------|--------|--------|----------|----------|
| **OpenCode** | ✅ | ✅ | ❌ | 代码配置 |
| **Cline** | ❌ | ✅ | ✅ | UI 配置 |
| **Claude Code** | ✅ | ✅ | ✅ | 文件配置 |
| **Pi (当前)** | ⚠️ | ❌ | ❌ | N/A |
| **Pi (建议)** | ✅ | ✅ | ✅ | 文件配置 |

## 推荐方案

### 核心类型定义

```typescript
// 1. 任务类型
enum TaskType {
  PLANNING = "planning",          // 规划任务
  CODING = "coding",              // 编码任务
  EXECUTION = "execution",        // 执行任务
  COMPRESSION = "compression",    // 压缩任务
  EXTRACTION = "extraction",      // 提取任务
}

// 2. 模型角色
enum ModelRole {
  ORCHESTRATOR = "orchestrator",  // 编排器
  WORKER = "worker",              // 工作者
  COMPRESSOR = "compressor",      // 压缩器
  EXTRACTOR = "extractor",        // 提取器
}

// 3. 模型能力
type ModelCapability =
  | "reasoning"      // 推理
  | "coding"         // 编码
  | "compression"    // 压缩
  | "extraction";    // 提取
```

### 配置文件示例

```json
// ~/.pi/agent/model-roles.json
{
  "version": 1,
  "enabled": true,

  "orchestrator": {
    "model": "anthropic/claude-opus-4-6",
    "capabilities": ["reasoning", "planning"]
  },

  "workers": [
    {
      "name": "code-worker",
      "model": "anthropic/claude-sonnet-4-5",
      "capabilities": ["coding", "execution"]
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
    "coding": { "role": "worker", "workerName": "code-worker" },
    "compression": { "role": "compressor" },
    "extraction": { "role": "extractor" }
  }
}
```

### 插件使用示例

```typescript
// 任务分发
import { TaskType } from "@dyyz1993/pi-coding-agent";

const results = await Promise.all([
  forkAgent("分析代码结构", { taskType: TaskType.ANALYSIS }),
  forkAgent("编写测试用例", { taskType: TaskType.CODING }),
  forkAgent("压缩上下文", { taskType: TaskType.COMPRESSION }),
]);

// 压缩
const summary = await forkAgent("总结对话", {
  taskType: TaskType.COMPRESSION,
  shareContext: true,
});

// 提取
const issues = await forkAgent("提取错误日志", {
  taskType: TaskType.EXTRACTION,
  systemPrompt: "返回 JSON 格式的错误列表",
});
```

## 实现步骤

### Phase 1: 类型定义（1-2 天）
- 创建 `packages/coding-agent/src/core/model-roles.ts`
- 定义 `TaskType`, `ModelRole`, `ModelCapability`
- 导出到 `packages/coding-agent/src/core/index.ts`

### Phase 2: 配置加载（2-3 天）
- 创建 `ModelRoleLoader` 类
- 加载 `~/.pi/agent/model-roles.json`
- 验证配置

### Phase 3: ForkAgent 增强（2-3 天）
- 扩展 `ForkAgentOptions` 添加 `taskType`, `role` 字段
- 创建 `ModelSelector` 类
- 实现自动模型选择

### Phase 4: 插件 API（1-2 天）
- 扩展 `ExtensionContext`
- 添加辅助函数
- 编写文档

### Phase 5: 内置工具更新（1-2 天）
- 更新 `/compact` 命令
- 添加 `/task` 命令

**总计**: 7-12 天

## 成本优化示例

使用专用模型可以大幅降低成本：

| 任务 | 传统方式（Opus） | 优化方式（Haiku） | 节省 |
|------|------------------|-------------------|------|
| 压缩上下文 | $0.15/次 | $0.0005/次 | 99.7% |
| 提取数据 | $0.10/次 | $0.0003/次 | 99.7% |
| 代码审查 | $0.08/次 | $0.02/次 | 75% |

## 向后兼容性

✅ **完全向后兼容**
- 所有新字段都是可选的
- 默认行为保持不变
- 不配置则使用原有逻辑

## 相关文件

我已经创建了以下文件：

1. `analysis-model-layering.md` - 详细分析
2. `analysis-summary.md` - 总结
3. `model-roles-implementation-example.ts` - 实现示例
4. `quick-reference.md` - 本文件

## 下一步建议

1. **创建 POC** - 实现 Phase 1 和 Phase 2
2. **收集反馈** - 让插件开发者试用
3. **迭代优化** - 根据反馈调整
4. **完善文档** - 编写详细指南

## 与你需求匹配度

你的需求：
- ✅ 子任务 - ForkAgent 已有，需要增强
- ✅ 高阶模型 - 需要添加
- ✅ 三个维度 - 需要添加类型定义
- ✅ 插件快速使用 - 可以实现
- ✅ 任务分发 - 可以实现
- ✅ 内容压缩 - 可以实现
- ✅ 数据提取 - 可以实现

**结论**: 需要实现，但工作量不大，建议采用渐进式实现。
