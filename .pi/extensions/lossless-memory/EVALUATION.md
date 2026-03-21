# Lossless Memory 评估系统

## 概述

本评估系统提供两种评估方式：

1. **基础评估** - 不需要 LLM，快速评估检索质量和 DAG 结构
2. **LLM 增强评估** - 使用 LLM 深度评估摘要质量和信息保持率

## 快速开始

### 基础评估（无需 API Key）

```bash
npx tsx .pi/extensions/lossless-memory/example-evaluation.ts
```

**评估内容：**
- ✅ 检索质量（Recall@K, Precision@K, MRR, NDCG）
- ✅ DAG 结构（层级深度、孤立节点、压缩效率）
- ✅ 时间一致性（时间顺序、记忆保持）
- ✅ 检索延迟分析

**输出示例：**
```
总体评分: 46.21/100

🔍 检索质量评估
  Recall@5:    100.00%
  Precision@5: 77.45%
  MRR:         81.37%
  NDCG:        86.20%
  平均延迟:     0.05ms

🌳 DAG 结构评估
  最大深度:     2
  孤立节点:     1
  平均压缩比:   0.70x
```

### LLM 增强评估（需要 API Key）

```bash
# 设置 API Key（选择一个）
export OPENAI_API_KEY="your-key"
export ANTHROPIC_API_KEY="your-key"
export GOOGLE_API_KEY="your-key"

# 可选：指定模型
export MODEL_ID="gpt-4o-mini"
export API_PROVIDER="openai"

# 运行评估
npx tsx .pi/extensions/lossless-memory/example-llm-evaluation.ts
```

**额外评估内容：**
- 🤖 摘要质量（清晰度、完整性、连贯性、可操作性）
- 🤖 信息保持率（关键事实、决策记录、约束条件、用户偏好）
- 🤖 智能改进建议

**输出示例：**
```
🤖 LLM 增强评估报告

📝 摘要质量评估 (LLM)
  清晰度:       85.00/100
  完整性:       78.00/100
  连贯性:       82.00/100
  可操作性:     75.00/100

💾 信息保持率评估 (LLM)
  关键事实:     80.00/100
  决策记录:     85.00/100
  约束条件:     70.00/100
  用户偏好:     75.00/100

💡 LLM 改进建议
  1. 优化摘要生成策略，提高信息保持率
  2. 改进 DAG 结构，减少孤立节点
  3. 增强检索算法，提升召回率
```

## 评估指标说明

### 基础评估指标

#### 检索质量
- **Recall@K**: 前K个结果中包含的相关文档比例
- **Precision@K**: 前K个结果中相关文档的比例
- **MRR**: 第一个相关结果的排名倒数
- **NDCG**: 考虑排序的检索质量
- **延迟**: 检索响应时间（P50/P95/P99）

#### DAG 结构
- **最大深度**: DAG 的最大层级
- **深度平衡度**: 各层级节点分布的均衡程度
- **孤立节点**: 没有父节点的非根节点数量
- **平均压缩比**: 子节点 token 数 / 父节点 token 数
- **Token 节省率**: 通过摘要节省的 token 百分比

#### 时间一致性
- **时间顺序准确率**: 节点时间戳的正确性
- **记忆保持分数**: 基于时间的记忆衰减评估
- **衰减率**: 记忆随时间衰减的速度

### LLM 增强评估指标

#### 摘要质量（LLM 评估）
- **清晰度**: 摘要是否清晰易懂
- **完整性**: 是否保留了所有关键信息
- **连贯性**: 逻辑结构是否合理
- **可操作性**: 是否包含足够的细节

#### 信息保持率（LLM 评估）
- **关键事实**: 具体事实、数据、代码片段的保持
- **决策记录**: 决策及其依据的记录
- **约束条件**: 技术和时间约束的记录
- **用户偏好**: 用户偏好和特殊要求的记录

## 评估工具

### MemorySystemEvaluator

基础评估器，提供快速、无依赖的评估。

```typescript
import { MemorySystemEvaluator } from "./evaluator.js";

const evaluator = new MemorySystemEvaluator(db, dag, config);
const result = await evaluator.runFullEvaluation(testCases);
evaluator.printReport(result);
```

### LLMEvaluator

LLM 增强评估器，提供深度质量评估。

```typescript
import { LLMEvaluator } from "./llm-evaluator.js";
import { Model } from "@mariozechner/pi-ai";

const model: Model = {
  id: "gpt-4o-mini",
  api: "openai",
  // ... 其他配置
};

const llmEvaluator = new LLMEvaluator(db, dag, config, model);
const llmResult = await llmEvaluator.runLLMEvaluation();
llmEvaluator.printLLMReport(llmResult);
```

### TestDatasetGenerator

测试数据生成器，提供多种测试场景。

```typescript
import { TestDatasetGenerator } from "./test-dataset-generator.js";

// 基础测试
const basicCases = TestDatasetGenerator.generateTestCases();

// 大规模测试
const largeCases = TestDatasetGenerator.generateLargeDataset(100);

// 时间序列测试
const temporalCases = TestDatasetGenerator.generateTemporalTestCases();

// 干扰测试
const interferenceCases = TestDatasetGenerator.generateInterferenceTestCases();
```

## 自定义评估

### 创建自定义测试用例

```typescript
const customTestCases = [
  {
    id: "custom-1",
    query: "用户认证",
    relevantDocIds: ["node-id-1", "node-id-2"],
    expectedAnswer: "使用 JWT 认证",
  },
];

const result = await evaluator.runFullEvaluation(customTestCases);
```

### 自定义评估指标

```typescript
// 只评估检索质量
const retrievalMetrics = await evaluator.evaluateRetrieval(testCases);

// 只评估 DAG 结构
const dagMetrics = evaluator.evaluateDAGStructure();

// 只评估摘要质量
const summaryMetrics = await evaluator.evaluateSummaryQuality();
```

## 性能优化建议

### 基础评估优化
1. 使用批量查询减少数据库访问
2. 缓存常用查询结果
3. 使用索引加速检索

### LLM 评估优化
1. 减少评估样本数量（默认 3 个）
2. 使用更快的模型（如 gpt-4o-mini）
3. 并行处理多个评估请求
4. 缓存 LLM 评估结果

## 故障排查

### 检索质量为 0%
- 检查测试数据是否与实际节点匹配
- 确认数据库中有足够的数据
- 验证搜索功能是否正常

### LLM 评估失败
- 检查 API Key 是否正确设置
- 确认网络连接正常
- 验证模型是否可用
- 查看错误日志获取详细信息

### DAG 结构异常
- 检查孤立节点数量
- 验证父子节点关系
- 确认压缩策略是否正确执行

## 最佳实践

1. **定期评估**: 在每次重要更新后运行评估
2. **对比测试**: 使用相同测试集对比不同配置的效果
3. **渐进优化**: 优先解决评分最低的维度
4. **持续监控**: 建立评估历史记录，跟踪改进趋势

## 扩展评估

可以扩展评估系统以支持：

1. **自定义评估指标**: 添加特定领域的评估维度
2. **A/B 测试**: 对比不同策略的效果
3. **用户反馈**: 集成用户满意度评估
4. **性能基准**: 建立性能基准线，监控性能退化

## 相关文件

- `evaluator.ts` - 基础评估器
- `llm-evaluator.ts` - LLM 增强评估器
- `test-dataset-generator.ts` - 测试数据生成器
- `example-evaluation.ts` - 基础评估示例
- `example-llm-evaluation.ts` - LLM 增强评估示例
