#!/usr/bin/env node
/**
 * 生成测试数据到数据库（无 FTS5 依赖）
 */

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeFileSync, existsSync } from "node:fs";

const DB_PATH = join(homedir(), ".pi/agent/lossless-memory.db");
const TRACE_FILE = "/tmp/lossless-context-trace.jsonl";
const now = Date.now();
const sessionId = "test-" + now;

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║     生成测试数据                                    ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

const db = new DatabaseSync(DB_PATH);

// 简单 schema（无 FTS5）
db.exec(`
CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  level INTEGER NOT NULL,
  content TEXT NOT NULL,
  parent_ids TEXT,
  child_ids TEXT,
  created_at INTEGER NOT NULL,
  token_count INTEGER,
  session_id TEXT NOT NULL,
  session_entry_ids TEXT
);

CREATE TABLE IF NOT EXISTS session_index (
  session_id TEXT PRIMARY KEY,
  session_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  node_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0
);
`);

console.log("✅ 数据库就绪\n📦 插入测试节点...\n");

const nodes = [
  { id:"l2-001", level:2, type:"summary", content:"整个对话涵盖 API 设计、数据库优化、缓存策略、性能监控四大主题。采用 RESTful 规范、JWT+OAuth2.0 认证、Redis 缓存、Prometheus 监控方案。", tokens:120, children:4, entries:32 },
  { id:"l1-api", level:1, type:"summary", content:"API 设计：RESTful 规范，资源命名用名词复数，HTTP 状态码 200/201/400/404，URL 版本化/api/v1/，JWT+OAuth2.0 认证，Access Token 1 小时，Refresh Token 7 天。", tokens:98, children:8, entries:8 },
  { id:"l1-db", level:1, type:"summary", content:"数据库优化：EXPLAIN 分析查询，WHERE/JOIN 字段加索引，避免 SELECT*，连接池 max_connections=200，按用户 ID 哈希分表。", tokens:105, children:8, entries:8 },
  { id:"l1-cache", level:1, type:"summary", content:"缓存策略：Redis 热点数据 1 小时/冷数据 24 小时，穿透用布隆过滤器 + 空值，雪崩随机过期，击穿互斥锁 + 永不过期。", tokens:92, children:8, entries:8 },
  { id:"l1-monitor", level:1, type:"summary", content:"性能监控：Prometheus+Grafana，CPU/内存/磁盘/网络指标，告警 CPU>80%/内存>90%/磁盘>85%，ELK Stack 日志收集。", tokens:88, children:8, entries:8 },
];

const stmt = db.prepare(`INSERT OR REPLACE INTO memory_nodes VALUES (?,?,?,?,?,?,?,?,?,?)`);

nodes.forEach(n => {
  const entryIds = Array.from({length:n.entries},(_,i)=>`msg-${n.id}-${i}`);
  stmt.run(
    n.id, n.type, n.level, n.content,
    n.level===2 ? '["l1-api","l1-db","l1-cache","l1-monitor"]' : '["l2-001"]',
    JSON.stringify(entryIds.slice(0,n.children)),
    now - (3-n.level)*1000,
    n.tokens,
    sessionId,
    JSON.stringify(entryIds)
  );
  console.log(`  ✅ L${n.level}: ${n.id} (${n.tokens}t, ${n.children}子，${n.entries}消息)`);
});

db.prepare(`INSERT OR REPLACE INTO session_index VALUES (?,?,?,?,?,?)`).run(
  sessionId, sessionId, now, now, nodes.length, nodes.reduce((s,n)=>s+n.tokens,0)
);

db.close();

// Trace 数据
const trace = Array.from({length:16},(_,i)=>({
  turn:i+1, timestamp:new Date(now-i*60000).toISOString(),
  messages:i*2+1, totalTokens:12+i*5, modelContextWindow:196608
}));
writeFileSync(TRACE_FILE, trace.map(t=>JSON.stringify(t)).join('\n'));

console.log("\n✅ Trace 生成：" + trace.length + " 条\n");
console.log("══════════════════════════════════════════════════════");
console.log("📊 结果");
console.log("══════════════════════════════════════════════════════");
console.log("  节点：5 个 (1 个 L2 + 4 个 L1)");
console.log("  Token: " + nodes.reduce((s,n)=>s+n.tokens,0));
console.log("  Trace: " + trace.length + " 条");
console.log("\n🌐 刷新 Dashboard: http://localhost:17338\n");
console.log("💡 现在可以看到:");
console.log("   ✅ 可视化 DAG 图谱（L2 连接 4 个 L1）");
console.log("   ✅ DAG 列表（5 个节点）");
console.log("   ✅ 项目（1 个）");
console.log("   ✅ 跟踪（16 条记录）");
console.log("   ✅ 搜索（试搜'API','缓存'）\n");
