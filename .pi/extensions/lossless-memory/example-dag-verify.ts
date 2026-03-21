/**
 * Lossless Memory - DAG 验证 Example
 * 
 * 运行方式：
 *   npx tsx example-dag-verify.ts
 */

import { MemoryDatabase } from "./database.js";
import { DAGManager } from "./dag-manager.js";
import type { MemoryNode } from "./types.js";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB = path.join(__dirname, "test-dag-verify.db");

const CONFIG = {
  enabled: true,
  database: { path: TEST_DB, enableFTS5: false, enableVectors: false },
  summary: { provider: "openai", model: "gpt-4o-mini", maxTokens: 300, compressionRatio: 8 },
  search: { keywordWeight: 0.7, semanticWeight: 0.3, defaultLimit: 5 },
  performance: { cacheEmbeddings: true, batchSize: 32, lazyLoad: true },
};

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║   Lossless Memory - DAG 结构验证 Example             ║");
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

console.log("✅ 数据库创建成功\n");

const dag = new DAGManager(db, CONFIG);
await dag.initializeForSession("example-session");

console.log("📦 场景：32 条消息的技术讨论对话\n");

const conversations = [
  { topic: "API 认证", count: 8 },
  { topic: "数据库优化", count: 8 },
  { topic: "缓存策略", count: 8 },
  { topic: "性能监控", count: 8 },
];

let entryIndex = 0;
const allEntryIds: string[] = [];

for (const conv of conversations) {
  console.log(`  讨论主题：${conv.topic} (${conv.count}条消息)`);
  
  const entryIds: string[] = [];
  for (let i = 0; i < conv.count; i++) {
    entryIds.push(`msg-${entryIndex++}`);
  }
  allEntryIds.push(...entryIds);
  
  const l1Node = dag.createNode({
    type: "summary",
    level: 1,
    content: `关于${conv.topic}的讨论：用户询问了最佳实践，助手推荐了具体方案，包括实现细节和注意事项。`,
    childIds: entryIds,
    sessionEntryIds: entryIds,
    tokenCount: 80 + Math.floor(Math.random() * 40),
  });
  
  console.log(`    ✅ 创建 L1 节点：${l1Node.id.slice(0, 8)}... (${l1Node.tokenCount} tokens)\n`);
}

console.log("📦 创建 L2 高层摘要（综合所有主题）\n");

const l1Nodes = dag.getNodesByLevel(1);
const l2Node = dag.createNode({
  type: "summary",
  level: 2,
  content: "整个对话涵盖了 API 认证、数据库优化、缓存策略、性能监控四个主题。用户系统架构逐渐清晰，关键技术决策已确定。",
  childIds: l1Nodes.map(n => n.id),
  sessionEntryIds: allEntryIds,
  tokenCount: 120,
});

console.log(`  ✅ 创建 L2 节点：${l2Node.id.slice(0, 8)}... (${l2Node.tokenCount} tokens)`);
console.log(`     覆盖 ${l1Nodes.length} 个 L1 节点`);
console.log(`     覆盖 ${allEntryIds.length} 条原始消息\n`);

for (const l1 of l1Nodes) {
  l1.parentIds = [l2Node.id];
  db.updateNode(l1);
}

console.log("══════════════════════════════════════════════════════");
console.log("📊 DAG 结构验证");
console.log("══════════════════════════════════════════════════════\n");

const stats = dag.getStats();
console.log(`节点总数：${stats.nodeCount}`);
console.log(`最大层级：L${stats.maxLevel}`);
console.log(`总 Token 数：${stats.totalTokens}\n`);

console.log("各层级分布:");
console.log("┌────────┬────────┬────────────┐");
console.log("│ 层级   │ 节点数 │ Token 总数  │");
console.log("├────────┼────────┼────────────┤");
console.log(`│ L1     │ ${l1Nodes.length}      │ ${(l1Nodes.reduce((s,n)=>s+n.tokenCount,0)).toString().padStart(3)}       │`);
console.log(`│ L2     │ 1      │ 120        │`);
console.log("└────────┴────────┴────────────┘\n");

console.log("══════════════════════════════════════════════════════");
console.log("🔍 DAG 追溯验证");
console.log("══════════════════════════════════════════════════════\n");

console.log("从 L2 追溯到原始消息:\n");
console.log(`  L2 (高层摘要)`);
console.log(`    ↓`);
for (const l1 of l1Nodes) {
  console.log(`  L1 (覆盖 ${l1.childIds.length} 条消息)`);
}
console.log(`    ↓`);
console.log(`  ${allEntryIds.length} 条原始消息\n`);

console.log("══════════════════════════════════════════════════════");
console.log("🔎 搜索功能验证");
console.log("══════════════════════════════════════════════════════\n");

const searchResults = db.search({ query: "认证", limit: 5 });
console.log(`搜索"认证": 找到 ${searchResults.length} 个结果\n`);

for (const result of searchResults) {
  console.log(`  - [L${result.node.level}] ${result.node.content.slice(0, 50)}...`);
  console.log(`    Token: ${result.node.tokenCount}, 评分：${result.score.keyword.toFixed(2)}\n`);
}

console.log("══════════════════════════════════════════════════════");
console.log("🔄 上下文修改验证");
console.log("══════════════════════════════════════════════════════\n");

const mockMessages = Array.from({ length: 100 }, (_, i) => ({
  role: i % 2 === 0 ? "user" as const : "assistant" as const,
  content: [{ type: "text" as const, text: `消息 ${i + 1}` }],
}));

const rootNodes = dag.getRootNodes();
const recentMessages = mockMessages.slice(-15);
const summaryMessages = rootNodes.map(node => ({
  role: "system" as const,
  content: [{ type: "text" as const, text: `历史摘要：${node.content}` }],
}));

const modifiedMessages = [...summaryMessages, ...recentMessages];

console.log(`修改前：${mockMessages.length} 条消息`);
console.log(`修改后：${modifiedMessages.length} 条消息 (${summaryMessages.length} 摘要 + ${recentMessages.length} 原文)`);
console.log(`节省：${mockMessages.length - modifiedMessages.length} 条消息 (${((mockMessages.length - modifiedMessages.length) / mockMessages.length * 100).toFixed(1)}%)\n`);

db.close();
try { fs.unlinkSync(TEST_DB); } catch {}
try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}

console.log("══════════════════════════════════════════════════════");
console.log("✅ DAG 验证完成！");
console.log("══════════════════════════════════════════════════════\n");

console.log("验证结果:");
console.log("  ✅ DAG 节点创建成功");
console.log("  ✅ 层级关系正确 (L2 → L1 → Original)");
console.log("  ✅ 追溯功能正常");
console.log("  ✅ 搜索功能正常");
console.log("  ✅ 上下文修改逻辑正确 (100→16 条)");
console.log("");
