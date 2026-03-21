/**
 * Lossless Memory - LLM 增强评估示例
 * 
 * 运行方式：
 *   npx tsx example-llm-evaluation.ts
 */

import { MemoryDatabase } from "./database.js";
import { DAGManager } from "./dag-manager.js";
import { MemorySystemEvaluator } from "./evaluator.js";
import { LLMEvaluator } from "./llm-evaluator.js";
import { TestDatasetGenerator } from "./test-dataset-generator.js";
import { completeSimple, type Model } from "@mariozechner/pi-ai";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB = path.join(__dirname, "test-llm-evaluation.db");

const CONFIG = {
  enabled: true,
  database: { path: TEST_DB, enableFTS5: false, enableVectors: false },
  summary: { provider: "openai", model: "gpt-4o-mini", maxTokens: 300, compressionRatio: 8 },
  search: { keywordWeight: 0.7, semanticWeight: 0.3, defaultLimit: 5 },
  performance: { cacheEmbeddings: true, batchSize: 32, lazyLoad: true },
};

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║   Lossless Memory - LLM 增强评估系统                  ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

console.log("⚠️  注意: 此脚本需要配置 LLM API Key\n");
console.log("请确保已设置以下环境变量之一:");
console.log("  - OPENAI_API_KEY");
console.log("  - ANTHROPIC_API_KEY");
console.log("  - GOOGLE_API_KEY\n");

const modelId = process.env.MODEL_ID || "gpt-4o-mini";
const apiProvider = process.env.API_PROVIDER || "openai";

console.log(`使用模型: ${modelId} (${apiProvider})\n`);

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
dag.initializeForSession("llm-evaluation-session");

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
console.log("📊 步骤 3: 运行基础评估");
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

console.log("  📈 运行基础评估...");
const basicResult = await evaluator.runFullEvaluation(testCases);

console.log("\n══════════════════════════════════════════════════════");
console.log("📊 基础评估报告");
console.log("══════════════════════════════════════════════════════\n");

evaluator.printReport(basicResult);

console.log("══════════════════════════════════════════════════════");
console.log("🤖 步骤 4: 运行 LLM 增强评估");
console.log("══════════════════════════════════════════════════════\n");

console.log("  ⏳ 正在调用 LLM 进行深度评估...\n");

try {
  const model: Model = {
    id: modelId,
    api: apiProvider as any,
    name: modelId,
    contextLength: 128000,
    maxOutputTokens: 4096,
    inputPrice: 0.0001,
    outputPrice: 0.0002,
  };

  const llmEvaluator = new LLMEvaluator(db, dag, CONFIG, model);
  const llmResult = await llmEvaluator.runLLMEvaluation();

  llmEvaluator.printLLMReport(llmResult);

  console.log("══════════════════════════════════════════════════════");
  console.log("📊 综合评估总结");
  console.log("══════════════════════════════════════════════════════\n");

  const basicScore = basicResult.overallScore;
  const llmQualityScore =
    (llmResult.summaryQuality.clarity +
      llmResult.summaryQuality.completeness +
      llmResult.summaryQuality.coherence +
      llmResult.summaryQuality.actionability) /
    4 /
    100;
  const llmRetentionScore =
    (llmResult.informationRetention.keyFacts +
      llmResult.informationRetention.decisions +
      llmResult.informationRetention.constraints +
      llmResult.informationRetention.preferences) /
    4 /
    100;

  const combinedScore = basicScore * 0.6 + llmQualityScore * 0.25 + llmRetentionScore * 0.15;

  console.log(`基础评估得分: ${(basicScore * 100).toFixed(2)}/100`);
  console.log(`LLM 质量得分: ${(llmQualityScore * 100).toFixed(2)}/100`);
  console.log(`LLM 保持率得分: ${(llmRetentionScore * 100).toFixed(2)}/100`);
  console.log(`综合得分: ${(combinedScore * 100).toFixed(2)}/100\n`);

  if (combinedScore >= 0.8) {
    console.log("✅ 系统表现优秀，可以投入生产使用");
  } else if (combinedScore >= 0.6) {
    console.log("⚠️  系统表现良好，但仍有改进空间");
  } else {
    console.log("❌ 系统需要改进，请参考上述建议");
  }
  console.log("");

  if (llmResult.suggestions.length > 0) {
    console.log("优先改进建议:");
    llmResult.suggestions.slice(0, 3).forEach((suggestion, i) => {
      console.log(`  ${i + 1}. ${suggestion}`);
    });
    console.log("");
  }
} catch (error) {
  console.error("❌ LLM 评估失败:", error);
  console.log("\n可能的原因:");
  console.log("  1. 未设置 API Key");
  console.log("  2. API Key 无效");
  console.log("  3. 网络连接问题");
  console.log("  4. 模型不可用\n");
  console.log("请检查环境变量设置后重试。\n");
}

console.log("══════════════════════════════════════════════════════");
console.log("✅ 评估完成！");
console.log("══════════════════════════════════════════════════════\n");

db.close();
try { fs.unlinkSync(TEST_DB); } catch {}
try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}

console.log("提示:");
console.log("  - 设置 MODEL_ID 环境变量来选择模型 (默认: gpt-4o-mini)");
console.log("  - 设置 API_PROVIDER 环境变量来选择提供商 (默认: openai)");
console.log("  - 确保设置了相应的 API Key 环境变量");
console.log("");
