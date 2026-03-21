/**
 * Lossless Memory - 完整评估示例
 * 
 * 运行方式：
 *   npx tsx example-evaluation.ts
 */

import { MemoryDatabase } from "./database.js";
import { DAGManager } from "./dag-manager.js";
import { MemorySystemEvaluator } from "./evaluator.js";
import { TestDatasetGenerator } from "./test-dataset-generator.js";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB = path.join(__dirname, "test-evaluation.db");

const CONFIG = {
  enabled: true,
  database: { path: TEST_DB, enableFTS5: false, enableVectors: false },
  summary: { provider: "openai", model: "gpt-4o-mini", maxTokens: 300, compressionRatio: 8 },
  search: { keywordWeight: 0.7, semanticWeight: 0.3, defaultLimit: 5 },
  performance: { cacheEmbeddings: true, batchSize: 32, lazyLoad: true },
};

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║   Lossless Memory - 完整评估系统                      ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

try { fs.unlinkSync(TEST_DB); } catch {}
try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}

const db = new MemoryDatabase(CONFIG);
const initResult = db.initialize();

if (!initResult.success) {
  console.error("❌ 数据库初始化失败:", initResult.error);
  process.exit(1);
}

console.log("✅ 数据库初始化成功\n");

const dag = new DAGManager(db, CONFIG);
dag.initializeForSession("evaluation-session");

console.log("📦 步骤 1: 创建测试数据\n");

const conversations = TestDatasetGenerator.generateConversations({
  nodeCount: 50,
  topicCount: 5,
  messagesPerTopic: 10,
  includeTimeOffset: true,
});

let entryIndex = 0;
const allEntryIds: string[] = [];
const createdNodes: Array<{ id: string; topic: string; content: string }> = [];

for (const conv of conversations) {
  console.log(`  创建对话: ${conv.topic} (${conv.messages.length} 条消息)`);
  
  const entryIds: string[] = [];
  for (let i = 0; i < conv.messages.length; i++) {
    entryIds.push(`msg-${entryIndex++}`);
  }
  allEntryIds.push(...entryIds);
  
  const l1Node = dag.createNode({
    type: "summary",
    level: 1,
    content: `关于${conv.topic}的讨论：${conv.messages.map(m => m.content).join("。")}`,
    childIds: entryIds,
    sessionEntryIds: entryIds,
    tokenCount: 100 + Math.floor(Math.random() * 50),
  });
  
  createdNodes.push({
    id: l1Node.id,
    topic: conv.topic,
    content: l1Node.content,
  });
  
  console.log(`    ✅ 创建 L1 节点: ${l1Node.id.slice(0, 8)}...`);
}

console.log("\n📦 步骤 2: 创建 L2 高层摘要\n");

const l1Nodes = dag.getNodesByLevel(1);
const l2Node = dag.createNode({
  type: "summary",
  level: 2,
  content: "整个对话涵盖了 API 认证、数据库优化、缓存策略、性能监控、微服务架构五个主题。用户系统架构逐渐清晰，关键技术决策已确定。",
  childIds: l1Nodes.map(n => n.id),
  sessionEntryIds: allEntryIds,
  tokenCount: 150,
});

console.log(`  ✅ 创建 L2 节点: ${l2Node.id.slice(0, 8)}...`);
console.log(`     覆盖 ${l1Nodes.length} 个 L1 节点`);
console.log(`     覆盖 ${allEntryIds.length} 条原始消息\n`);

for (const l1 of l1Nodes) {
  l1.parentIds = [l2Node.id];
  db.updateNode(l1);
}

console.log("══════════════════════════════════════════════════════");
console.log("📊 步骤 3: 运行完整评估");
console.log("══════════════════════════════════════════════════════\n");

const evaluator = new MemorySystemEvaluator(db, dag, CONFIG);

console.log("  🔍 生成测试数据集...");

const testCases: Array<{ id: string; query: string; relevantDocIds: string[] }> = [];

const topicKeywords = [
  { topic: "API 认证", keywords: ["认证", "token", "JWT", "OAuth", "安全"] },
  { topic: "数据库优化", keywords: ["数据库", "索引", "查询", "性能", "SQL"] },
  { topic: "缓存策略", keywords: ["缓存", "Redis", "过期", "命中率", "内存"] },
  { topic: "性能监控", keywords: ["监控", "指标", "告警", "日志", "APM"] },
  { topic: "微服务架构", keywords: ["微服务", "服务", "通信", "负载均衡", "容错"] },
];

for (const { topic, keywords } of topicKeywords) {
  const matchingNodes = createdNodes.filter(n => n.topic === topic);
  
  for (const keyword of keywords) {
    const relevantNodes = matchingNodes.filter(n => n.content.includes(keyword));
    
    if (relevantNodes.length > 0) {
      testCases.push({
        id: `test-${topic}-${keyword}`,
        query: keyword,
        relevantDocIds: relevantNodes.map(n => n.id),
      });
    }
  }
}

console.log(`     生成了 ${testCases.length} 个测试用例\n`);

console.log("  📈 运行评估...");
const result = await evaluator.runFullEvaluation(testCases);

console.log("\n══════════════════════════════════════════════════════");
console.log("📊 评估报告");
console.log("══════════════════════════════════════════════════════\n");

evaluator.printReport(result);

console.log("══════════════════════════════════════════════════════");
console.log("📋 评估结果分析");
console.log("══════════════════════════════════════════════════════\n");

const score = result.overallScore;
let grade = "";
let emoji = "";

if (score >= 0.9) {
  grade = "优秀 (A+)";
  emoji = "🌟";
} else if (score >= 0.8) {
  grade = "良好 (A)";
  emoji = "✨";
} else if (score >= 0.7) {
  grade = "中等 (B)";
  emoji = "👍";
} else if (score >= 0.6) {
  grade = "及格 (C)";
  emoji = "⚠️";
} else {
  grade = "需要改进 (D)";
  emoji = "❌";
}

console.log(`总体评级: ${emoji} ${grade}`);
console.log(`评分: ${(score * 100).toFixed(2)}/100\n`);

console.log("各维度表现:");
console.log(`  🔍 检索质量:   ${(result.categories.retrieval.recallAt5 * 0.3 + result.categories.retrieval.precisionAt5 * 0.3 + result.categories.retrieval.mrr * 0.2 + result.categories.retrieval.ndcg * 0.2).toFixed(2)}`);
console.log(`  🌳 DAG 结构:   ${(result.categories.dagStructure.depthBalance * 0.3 + (1 - result.categories.dagStructure.orphanNodes / Math.max(dag.getNodeCount(), 1)) * 0.3 + Math.min(result.categories.dagStructure.avgCompressionRatio / 5, 1) * 0.2 + Math.min(result.categories.dagStructure.tokenSavings / 50, 1) * 0.2).toFixed(2)}`);
console.log(`  📝 摘要质量:   ${(result.categories.summaryQuality.informationRetention * 0.4 + result.categories.summaryQuality.expandAccuracy * 0.3 + result.categories.summaryQuality.semanticCoherence * 0.3).toFixed(2)}`);
console.log(`  ⏰ 时间一致性: ${(result.categories.temporal.temporalOrderAccuracy * 0.4 + result.categories.temporal.memoryRetentionScore * 0.3 + (1 - Math.min(result.categories.temporal.decayRate, 1)) * 0.3).toFixed(2)}\n`);

if (result.recommendations.length > 0) {
  console.log("优先改进项:");
  result.recommendations.slice(0, 3).forEach((rec, i) => {
    console.log(`  ${i + 1}. ${rec}`);
  });
  console.log("");
}

console.log("══════════════════════════════════════════════════════");
console.log("🎯 下一步建议");
console.log("══════════════════════════════════════════════════════\n");

if (score < 0.7) {
  console.log("  1. 优先解决检索质量问题，提高 Recall 和 Precision");
  console.log("  2. 检查 DAG 结构，确保没有孤立节点");
  console.log("  3. 优化摘要生成策略，提高信息保持率");
} else if (score < 0.85) {
  console.log("  1. 微调检索算法，提升 MRR 和 NDCG");
  console.log("  2. 优化压缩策略，提高 token 节省率");
  console.log("  3. 增强时间一致性，降低记忆衰减率");
} else {
  console.log("  1. 系统表现优秀，可以投入生产使用");
  console.log("  2. 持续监控关键指标，确保稳定性");
  console.log("  3. 探索更高级的优化策略（如语义搜索）");
}
console.log("");

console.log("══════════════════════════════════════════════════════");
console.log("📊 详细测试场景");
console.log("══════════════════════════════════════════════════════\n");

const allScenarios = TestDatasetGenerator.generateAllTestScenarios();
console.log("可用测试场景:");
for (const [name, cases] of allScenarios) {
  console.log(`  - ${name}: ${cases.length} 个测试用例`);
}
console.log("");

console.log("══════════════════════════════════════════════════════");
console.log("✅ 评估完成！");
console.log("══════════════════════════════════════════════════════\n");

db.close();
try { fs.unlinkSync(TEST_DB); } catch {}
try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}

console.log("提示:");
console.log("  - 可以通过调整 CONFIG 参数来测试不同配置");
console.log("  - 使用 TestDatasetGenerator 生成更多测试场景");
console.log("  - 查看 evaluator.ts 了解评估指标的详细定义");
console.log("");
