#!/usr/bin/env node
/**
 * 生成测试数据 - 通过真实 pi 对话
 */

import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

const DB_PATH = join(homedir(), ".pi/agent/lossless-memory.db");
const TRACE_FILE = "/tmp/lossless-context-trace.jsonl";

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║     生成测试数据 - 真实 pi 对话                       ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

// 清理旧 trace
try { unlinkSync(TRACE_FILE); } catch {}

// 测试对话内容
const conversations = [
  "你好，我们来测试 Lossless Memory 扩展的上下文管理功能",
  "我想了解一下 API 设计的最佳实践，能给我一些建议吗？",
  "那么 RESTful API 的命名规范应该是怎样的？",
  "HTTP 状态码怎么选择比较合适？比如 200 201 400 这些",
  "API 版本控制怎么做比较好？URL 路径还是 Header？",
  "认证方案用什么好？JWT 还是 Session？",
  "OAuth2.0 的流程能详细解释一下吗？",
  "数据库优化有什么好的建议？MySQL 查询很慢",
  "索引怎么创建？什么字段应该加索引？",
  "连接池怎么配置？max_connections 设置多少合适？",
  "缓存策略怎么设计？Redis 过期时间怎么设？",
  "缓存穿透、雪崩、击穿分别怎么解决？",
  "性能监控怎么做？用什么工具监控 CPU 内存？",
  "Prometheus 和 Grafana 怎么配合使用？",
  "日志收集系统怎么搭建？ELK Stack 复杂吗？",
];

console.log("📝 准备进行 " + conversations.length + " 轮对话测试...\n");

// 降低阈值以便触发压缩
const indexPath = join(process.cwd(), "src/index.ts");
let indexContent = "";
if (existsSync(indexPath)) {
  indexContent = writeFileSync(indexPath, 
    readFileSync(indexPath, 'utf-8').replace(
      /const threshold = 0.0001/g, 
      'const threshold = 0.00001'  // 更低阈值，更容易触发
    ),
    'utf-8'
  );
  console.log("✅ 已降低压缩阈值\n");
}

console.log("🚀 启动 pi 进行对话测试...\n");
console.log("对话内容预览:");
conversations.slice(0, 5).forEach((c, i) => console.log(`  ${i+1}. ${c.slice(0, 50)}...`));
console.log("  ... 共 " + conversations.length + " 条\n");

// 启动 pi
const pi = spawn("pi", [
  "--extension", join(process.cwd(), "src/index.ts"),
  "--no-session"
], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: "0" }
});

let output = "";
let messageIndex = 0;

pi.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  
  // 检测 pi 就绪
  if (text.includes("escape") && messageIndex === 0) {
    console.log("✅ pi 已启动，开始发送消息...\n");
    sendMessage();
  }
  
  // 检测回复完成
  if (text.includes("pi-mono") || text.includes("Working...")) {
    setTimeout(() => {
      if (messageIndex < conversations.length) {
        sendMessage();
      } else {
        finish();
      }
    }, 3000);
  }
});

pi.stderr.on('data', (data) => {
  console.error("错误:", data.toString());
});

function sendMessage() {
  if (messageIndex >= conversations.length) {
    finish();
    return;
  }
  
  const msg = conversations[messageIndex];
  console.log(`📤 [${messageIndex + 1}/${conversations.length}] ${msg.slice(0, 60)}...`);
  pi.stdin.write(msg + "\n");
  messageIndex++;
}

function finish() {
  console.log("\n✅ 对话完成！等待 10 秒让数据写入...\n");
  setTimeout(() => {
    pi.kill();
    checkResults();
  }, 10000);
}

function checkResults() {
  console.log("══════════════════════════════════════════════════════");
  console.log("📊 检查结果");
  console.log("══════════════════════════════════════════════════════\n");
  
  // 检查 trace 文件
  if (existsSync(TRACE_FILE)) {
    const { readFileSync } = require("fs");
    const content = readFileSync(TRACE_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    console.log("✅ Trace 文件：" + lines.length + " 轮对话记录\n");
    console.log("最后 5 条记录:");
    lines.slice(-5).forEach(l => {
      const d = JSON.parse(l);
      console.log(`  第${d.turn}轮：${d.messages}条消息，${d.totalTokens} tokens`);
    });
  } else {
    console.log("❌ Trace 文件不存在\n");
  }
  
  console.log("\n🌐 现在访问 Dashboard 查看数据:");
  console.log("   http://localhost:17338\n");
  
  console.log("💡 提示:");
  console.log("   - 切换到 'DAG 列表' Tab 查看节点");
  console.log("   - 切换到 '跟踪' Tab 查看对话记录");
  console.log("   - 如果有压缩触发，'可视化' Tab 会显示图谱\n");
}

// 超时处理
setTimeout(() => {
  console.log("\n⚠️  超时，强制结束...\n");
  pi.kill();
  checkResults();
  process.exit(0);
}, 120000);
