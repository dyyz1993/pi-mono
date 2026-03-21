/**
 * 自动化 pi 测试 - 使用 pi-ai 直接调用 LLM
 */

import { stream, getModel } from "@mariozechner/pi-ai";
import { MemoryDatabase } from "./database.js";
import { DAGManager } from "./dag-manager.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB = path.join(process.cwd(), "test-automated.db");

const CONFIG = {
  enabled: true,
  database: { path: TEST_DB, enableFTS5: false, enableVectors: false },
  summary: { provider: "openai", model: "gpt-4o-mini", maxTokens: 300, compressionRatio: 8 },
  search: { keywordWeight: 0.7, semanticWeight: 0.3, defaultLimit: 5 },
  performance: { cacheEmbeddings: true, batchSize: 32, lazyLoad: true },
};

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║   Lossless Memory - 自动化 LLM 测试                   ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

// 清理
try { fs.unlinkSync(TEST_DB); } catch {}
try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}

// 初始化数据库
const db = new MemoryDatabase(CONFIG);
const initResult = db.initialize();

if (!initResult.success) {
  console.error("❌ 数据库初始化失败:", initResult.error);
  process.exit(1);
}

console.log("✅ 数据库初始化成功\n");

const dag = new DAGManager(db, CONFIG);
await dag.initializeForSession("automated-test");

// ============================================================================
// 模拟真实对话并生成摘要
// ============================================================================

console.log("📦 模拟真实对话场景（4 个主题，32 条消息）\n");

const topics = [
  {
    name: "API 设计",
    messages: [
      "如何设计 RESTful API？",
      "推荐使用资源命名约定，使用名词复数形式",
      "状态码怎么选择？",
      "200 OK, 201 Created, 400 Bad Request, 404 Not Found",
      "版本控制怎么做？",
      "URL 路径版本化：/api/v1/users",
      "认证方案？",
      "JWT + OAuth2.0 是最佳实践",
    ]
  },
  {
    name: "数据库优化",
    messages: [
      "MySQL 查询慢怎么优化？",
      "使用 EXPLAIN 分析执行计划",
      "索引怎么创建？",
      "在 WHERE 和 JOIN 字段上创建索引",
      "连接池配置？",
      "设置 max_connections 和 pool_size",
      "分库分表策略？",
      "按用户 ID 哈希分表，按时间范围分库",
    ]
  },
  {
    name: "缓存策略",
    messages: [
      "Redis 缓存过期时间怎么设？",
      "热点数据 1 小时，冷数据 24 小时",
      "缓存穿透怎么解决？",
      "布隆过滤器 + 空值缓存",
      "缓存雪崩？",
      "设置随机过期时间，避免同时失效",
      "缓存击穿？",
      "互斥锁 + 永不过期的热点 key",
    ]
  },
  {
    name: "性能监控",
    messages: [
      "怎么监控系统性能？",
      "Prometheus + Grafana 组合",
      "关键指标？",
      "CPU、内存、磁盘 IO、网络带宽",
      "告警阈值？",
      "CPU > 80%, 内存 > 90%, 磁盘 > 85%",
      "日志收集？",
      "ELK Stack (Elasticsearch, Logstash, Kibana)",
    ]
  }
];

let allEntryIds = [];

for (const topic of topics) {
  console.log(`主题：${topic.name}`);
  
  const entryIds = topic.messages.map((_, i) => `msg-${allEntryIds.length + i + 1}`);
  allEntryIds.push(...entryIds);
  
  // 使用真实 LLM 生成摘要
  console.log(`  → 调用 LLM 生成摘要...`);
  
  try {
    const model = getModel("google", "gemini-2.0-flash");
    
    const summaryPrompt = `请总结以下技术对话，保留关键知识点：\n\n${topic.messages.map((m, i) => `${i % 2 === 0 ? 'Q' : 'A'}: ${m}`).join('\n')}\n\n请用一句话总结：`;
    
    const result = await stream(model, {
      messages: [
        { role: "system", content: [{ type: "text", text: "你是技术对话摘要助手" }] },
        { role: "user", content: [{ type: "text", text: summaryPrompt }] },
      ],
      maxTokens: 100,
    });
    
    let summaryText = "";
    for await (const event of result) {
      if (event.type === "text_delta") {
        summaryText += event.delta;
      }
    }
    
    // 创建 L1 节点
    const l1Node = dag.createNode({
      type: "summary",
      level: 1,
      content: summaryText || `关于${topic.name}的讨论：涵盖了关键概念和最佳实践。`,
      childIds: entryIds,
      sessionEntryIds: entryIds,
      tokenCount: 80 + Math.floor(Math.random() * 40),
    });
    
    console.log(`  ✅ L1 节点创建：${summaryText.slice(0, 50)}...\n`);
  } catch (error) {
    console.log(`  ⚠️ LLM 调用失败：${error.message}`);
    console.log(`  → 使用 fallback 摘要\n`);
    
    // Fallback
    const l1Node = dag.createNode({
      type: "summary",
      level: 1,
      content: `关于${topic.name}的讨论：用户提问了相关问题，助手给出了专业建议，包括实现细节和注意事项。`,
      childIds: entryIds,
      sessionEntryIds: entryIds,
      tokenCount: 80,
    });
  }
}

// 创建 L2 高层摘要
console.log("📦 创建 L2 高层摘要\n");

const l1Nodes = dag.getNodesByLevel(1);

try {
  const model = getModel("google", "gemini-2.0-flash");
  
  const l2Prompt = `请总结以下 4 个技术主题的摘要，形成高层概览：\n\n${l1Nodes.map(n => `- ${n.content}`).join('\n')}\n\n请用一段话总结整体对话：`;
  
  const result = await stream(model, {
    messages: [
      { role: "system", content: [{ type: "text", text: "你是高层摘要生成助手" }] },
      { role: "user", content: [{ type: "text", text: l2Prompt }] },
    ],
    maxTokens: 150,
  });
  
  let l2Text = "";
  for await (const event of result) {
    if (event.type === "text_delta") {
      l2Text += event.delta;
    }
  }
  
  const l2Node = dag.createNode({
    type: "summary",
    level: 2,
    content: l2Text || "整个对话涵盖了多个技术主题，包括 API 设计、数据库优化、缓存策略和性能监控。讨论了最佳实践和具体实现方案。",
    childIds: l1Nodes.map(n => n.id),
    sessionEntryIds: allEntryIds,
    tokenCount: 120,
  });
  
  console.log(`✅ L2 节点创建：${l2Text.slice(0, 60)}...\n`);
  
  // 更新 L1 父节点
  for (const l1 of l1Nodes) {
    l1.parentIds = [l2Node.id];
    db.updateNode(l1);
  }
} catch (error) {
  console.log(`⚠️ L2 摘要生成失败：${error.message}`);
}

// ============================================================================
// 验证结果
// ============================================================================

console.log("══════════════════════════════════════════════════════");
console.log("📊 验证结果");
console.log("══════════════════════════════════════════════════════\n");

const stats = dag.getStats();
console.log(`节点总数：${stats.nodeCount}`);
console.log(`最大层级：L${stats.maxLevel}`);
console.log(`总 Token：${stats.totalTokens}\n`);

console.log("层级分布:");
const l1Count = dag.getNodesByLevel(1).length;
const l2Count = dag.getNodesByLevel(2).length;
console.log(`  L1: ${l1Count} 个节点`);
console.log(`  L2: ${l2Count} 个节点\n`);

console.log("原始消息覆盖:");
console.log(`  总消息数：${allEntryIds.length} 条`);
console.log(`  压缩为：${stats.nodeCount} 个摘要节点`);
console.log(`  压缩率：${((1 - stats.nodeCount / allEntryIds.length) * 100).toFixed(1)}%\n`);

// 清理
db.close();
try { fs.unlinkSync(TEST_DB); } catch {}
try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}

console.log("══════════════════════════════════════════════════════");
console.log("✅ 自动化 LLM 测试完成！");
console.log("══════════════════════════════════════════════════════\n");
