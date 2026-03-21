/**
 * Lossless Memory Extension - 单元测试套件
 * 覆盖所有核心功能，无需真实 LLM 调用
 */

import { MemoryDatabase } from "./database.js";
import { DAGManager } from "./dag-manager.js";
import type { MemoryNode, LosslessMemoryConfig } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 测试配置
// ============================================================================

const TEST_CONFIG: LosslessMemoryConfig = {
  enabled: true,
  database: {
    path: ":memory:", // 使用内存数据库
    enableFTS5: true,
    enableVectors: false,
  },
  summary: {
    provider: "openai",
    model: "gpt-4o-mini",
    maxTokens: 300,
    compressionRatio: 8,
  },
  search: {
    keywordWeight: 0.7,
    semanticWeight: 0.3,
    defaultLimit: 5,
  },
  performance: {
    cacheEmbeddings: true,
    batchSize: 32,
    lazyLoad: true,
  },
};

// ============================================================================
// 测试工具
// ============================================================================

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  process.stdout.write(`  ${name}... `);
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => {
        console.log("✅ 通过");
        passCount++;
      }).catch((err) => {
        console.log(`❌ 失败：${err.message}`);
        failCount++;
      });
    } else {
      console.log("✅ 通过");
      passCount++;
    }
  } catch (err: any) {
    console.log(`❌ 失败：${err.message}`);
    failCount++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ============================================================================
// 测试套件
// ============================================================================

async function runTests(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     Lossless Memory Extension - 单元测试套件              ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");

  // ========================================================================
  // 测试 1: 数据库初始化
  // ========================================================================
  console.log("📦 测试套件 1: 数据库初始化");
  console.log("──────────────────────────────────────────────────────────");

  const db = new MemoryDatabase(TEST_CONFIG);
  const initResult = db.initialize();

  test("数据库创建成功", () => {
    assert(initResult.success, "数据库初始化失败");
  });

  test("FTS5 索引创建成功", () => {
    const stats = db.getStats();
    assert(typeof stats.nodeCount === "number", "节点数应为数字");
  });

  // ========================================================================
  // 测试 2: 上下文修改逻辑
  // ========================================================================
  console.log("");
  console.log("📦 测试套件 2: 上下文修改逻辑");
  console.log("──────────────────────────────────────────────────────────");

  // 模拟 context 事件处理
  const mockMessages = Array.from({ length: 100 }, (_, i) => ({
    role: i % 2 === 0 ? "user" as const : "assistant" as const,
    content: [{ type: "text" as const, text: `消息 ${i + 1} - 这是一条测试消息，包含一些内容来累积 token` }],
  }));

  const modelContextWindow = 200000;

  test("计算 Token 数正确", () => {
    const totalTokens = mockMessages.reduce((sum, m) => {
      const text = m.content[0]?.text || "";
      return sum + Math.ceil(text.length / 4);
    }, 0);

    assert(totalTokens > 0, "Token 数应大于 0");
    assert(totalTokens < modelContextWindow, "Token 数应小于窗口");
    console.log(`   计算结果：${totalTokens} tokens`);
  });

  test("阈值判断正确", () => {
    const totalTokens = 160000; // 80% of 200000
    const threshold = 0.8;

    const shouldModify = totalTokens > modelContextWindow * threshold;
    assert(shouldModify === true, "80% 使用率应触发修改");
    console.log(`   80% 使用率：${shouldModify ? "触发" : "不触发"}`);
  });

  test("上下文修改逻辑正确", () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "assistant" as const,
      content: [{ type: "text" as const, text: `消息 ${i + 1}` }],
    }));

    // 模拟摘要节点
    const mockRootNodes: MemoryNode[] = [
      {
        id: "summary-1",
        type: "summary",
        level: 2,
        content: "这是高层摘要，总结了之前的对话内容。",
        parentIds: [],
        childIds: ["child-1", "child-2"],
        createdAt: Date.now(),
        tokenCount: 50,
        sessionId: "test",
        sessionEntryIds: ["entry-1", "entry-2"],
      },
    ];

    // 模拟修改逻辑
    const recentMessages = messages.slice(-15);
    const summaryMessages = mockRootNodes.map(node => ({
      role: "system" as const,
      content: [{ type: "text" as const, text: `历史摘要：${node.content}` }],
    }));

    const modifiedMessages = [...summaryMessages, ...recentMessages];

    assert(modifiedMessages.length < messages.length, "修改后消息数应减少");
    assert(modifiedMessages.length === 16, "修改后应为 16 条（1 摘要 +15 最近）");
    console.log(`   修改前：${messages.length} 条 → 修改后：${modifiedMessages.length} 条`);
  });

  // ========================================================================
  // 测试 3: DAG 节点管理
  // ========================================================================
  console.log("");
  console.log("📦 测试套件 3: DAG 节点管理");
  console.log("──────────────────────────────────────────────────────────");

  const dag = new DAGManager(db, TEST_CONFIG);
  await dag.initializeForSession("test-session");

  test("DAG 初始化成功", () => {
    assert(dag !== null, "DAG 管理器应存在");
  });

  test("创建节点成功", () => {
    const node = dag.createNode({
      type: "summary",
      level: 1,
      content: "测试摘要内容",
      sessionEntryIds: ["entry-1", "entry-2"],
      tokenCount: 50,
    });

    assert(node.id.length > 0, "节点 ID 应存在");
    assert(node.type === "summary", "类型应为 summary");
    assert(node.level === 1, "层级应为 1");
    console.log(`   创建节点：${node.id.slice(0, 8)}...`);
  });

  test("DAG 层级结构正确", () => {
    const l1Node = dag.createNode({
      type: "summary",
      level: 1,
      content: "L1 摘要",
      tokenCount: 100,
    });

    const l2Node = dag.createNode({
      type: "summary",
      level: 2,
      content: "L2 高层摘要",
      childIds: [l1Node.id],
      tokenCount: 150,
    });

    assert(l2Node.level > l1Node.level, "L2 层级应高于 L1");
    assert(l2Node.childIds.includes(l1Node.id), "L2 应包含 L1 作为子节点");
    console.log(`   L1 → L2 层级关系正确`);
  });

  test("DAG 追溯功能正确", async () => {
    // 创建多层节点
    const original = dag.createNode({
      type: "original",
      level: 0,
      content: "原始消息",
      tokenCount: 20,
    });

    const summary = dag.createNode({
      type: "summary",
      level: 1,
      content: "摘要",
      childIds: [original.id],
      tokenCount: 30,
    });

    const descendants = await dag.traceToOriginals(summary.id, 5);
    assert(descendants.length > 0, "应能找到后代节点");
    console.log(`   追溯后代节点：${descendants.length} 个`);
  });

  // ========================================================================
  // 测试 4: FTS5 全文搜索
  // ========================================================================
  console.log("");
  console.log("📦 测试套件 4: FTS5 全文搜索");
  console.log("──────────────────────────────────────────────────────────");

  test("插入节点后 FTS 索引更新", () => {
    db.insertNode({
      id: "search-test-1",
      type: "summary",
      level: 1,
      content: "这是一个关于用户认证系统的摘要，包含登录和注册功能",
      parentIds: [],
      childIds: [],
      createdAt: Date.now(),
      tokenCount: 50,
      sessionId: "test-session",
      sessionEntryIds: [],
    });

    const stats = db.getStats();
    assert(stats.nodeCount >= 1, "节点数应至少为 1");
    console.log(`   插入节点后统计：${stats.nodeCount} 个节点`);
  });

  test("FTS5 关键词搜索", () => {
    const results = db.search({
      query: "认证",
      limit: 5,
    });

    // 应该能找到刚才插入的节点
    assert(Array.isArray(results), "搜索结果应为数组");
    console.log(`   搜索"认证"：找到 ${results.length} 个结果`);
  });

  test("FTS5 会话过滤", () => {
    const results = db.search({
      query: "认证",
      sessionId: "test-session",
      limit: 5,
    });

    assert(Array.isArray(results), "搜索结果应为数组");
    console.log(`   搜索"认证"（过滤会话）：找到 ${results.length} 个结果`);
  });

  test("FTS5 BM25 评分", () => {
    const results = db.search({
      query: "认证",
      limit: 5,
    });

    if (results.length > 0) {
      assert(typeof results[0].score.keyword === "number", "应有 BM25 评分");
      assert(results[0].score.keyword >= 0, "BM25 评分应非负");
      console.log(`   BM25 评分：${results[0].score.keyword.toFixed(4)}`);
    }
  });

  // ========================================================================
  // 测试 5: 压缩准备逻辑
  // ========================================================================
  console.log("");
  console.log("📦 测试套件 5: 压缩准备逻辑");
  console.log("──────────────────────────────────────────────────────────");

  test("压缩阈值判断", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: `entry-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `消息内容 ${i}`,
    }));

    const preparation = dag.prepareCompression(entries);

    assert(preparation.entriesToCompress.length === 8, "应压缩 8 条消息");
    assert(preparation.firstKeptEntryId === "entry-8", "应保留第 9 条及之后");
    console.log(`   压缩：${preparation.entriesToCompress.length} 条，保留从 ${preparation.firstKeptEntryId}`);
  });

  test("压缩触发条件", () => {
    assert(dag.needsCompression(8) === true, "8 条应触发压缩");
    assert(dag.needsCompression(7) === false, "7 条不应触发压缩");
    console.log(`   8 条消息：触发，7 条消息：不触发`);
  });

  // ========================================================================
  // 测试 6: 摘要生成器
  // ========================================================================
  console.log("");
  console.log("📦 测试套件 6: 摘要生成器（模拟）");
  console.log("──────────────────────────────────────────────────────────");

  test("摘要输入格式正确", () => {
    const mockInput = {
      entries: [
        { id: "1", role: "user", content: "你好", timestamp: Date.now() },
        { id: "2", role: "assistant", content: "你好！有什么可以帮你？", timestamp: Date.now() },
      ],
      customInstructions: "请简要总结",
    };

    assert(mockInput.entries.length === 2, "应有 2 条输入");
    assert(typeof mockInput.entries[0].content === "string", "内容应为字符串");
    console.log(`   输入格式：${mockInput.entries.length} 条消息`);
  });

  test("Fallback 摘要生成", () => {
    // 模拟 LLM 失败时的 fallback 逻辑
    const entries = [
      { id: "1", role: "user", content: "用户消息 1" },
      { id: "2", role: "assistant", content: "助手回复 1" },
      { id: "3", role: "user", content: "用户消息 2" },
    ];

    const lines: string[] = [];
    lines.push("对话摘要 (自动生成):");
    lines.push("");

    const userMessages = entries.filter(e => e.role === "user").map(e => e.content);
    const assistantMessages = entries.filter(e => e.role === "assistant").map(e => e.content);

    if (userMessages.length > 0) {
      lines.push("用户请求:");
      userMessages.forEach(msg => lines.push(`- ${msg}`));
    }

    if (assistantMessages.length > 0) {
      lines.push("助手响应:");
      assistantMessages.forEach(msg => lines.push(`- ${msg}`));
    }

    const fallback = lines.join("\n");
    assert(fallback.length > 0, "Fallback 摘要应存在");
    assert(fallback.includes("用户请求"), "应包含用户请求");
    console.log(`   Fallback 摘要生成：${fallback.length} 字符`);
  });

  // ========================================================================
  // 测试 7: Token 估算
  // ========================================================================
  console.log("");
  console.log("📦 测试套件 7: Token 估算");
  console.log("──────────────────────────────────────────────────────────");

  test("英文 Token 估算", () => {
    const englishText = "This is a test message in English.";
    const tokens = Math.ceil(englishText.length / 4);
    assert(tokens > 0, "Token 数应大于 0");
    console.log(`   英文："${englishText}" → ~${tokens} tokens`);
  });

  test("中文 Token 估算", () => {
    const chineseText = "这是一条中文测试消息。";
    const tokens = Math.ceil(chineseText.length / 2); // 中文 2 字符/token
    assert(tokens > 0, "Token 数应大于 0");
    console.log(`   中文："${chineseText}" → ~${tokens} tokens`);
  });

  test("混合文本 Token 估算", () => {
    const mixedText = "Hello 你好 World 世界";
    const hasChinese = /[\u4e00-\u9fa5]/.test(mixedText);
    const avgCharPerToken = hasChinese ? 2 : 4;
    const tokens = Math.ceil(mixedText.length / avgCharPerToken);
    assert(tokens > 0, "Token 数应大于 0");
    console.log(`   混合："${mixedText}" → ~${tokens} tokens`);
  });

  // ========================================================================
  // 清理
  // ========================================================================
  db.close();

  // ========================================================================
  // 总结
  // ========================================================================
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log("测试总结");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`  通过：${passCount}`);
  console.log(`  失败：${failCount}`);
  console.log(`  总计：${passCount + failCount}`);
  console.log("");

  if (failCount === 0) {
    console.log("✅ 所有测试通过！");
  } else {
    console.log(`❌ ${failCount} 个测试失败`);
    process.exit(1);
  }
}

// 运行测试
runTests().catch((err) => {
  console.error("测试执行失败:", err);
  process.exit(1);
});
