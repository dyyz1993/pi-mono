#!/usr/bin/env node
/**
 * 从会话文件加载真实消息内容到数据库
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DB_PATH = join(homedir(), ".pi/agent/lossless-memory.db");
const SESSIONS_DIR = join(homedir(), ".pi/agent/sessions");

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║     从会话文件加载真实消息                          ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

// 添加消息内容表
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS message_contents (
  message_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_session ON message_contents(session_id);
`);

console.log("✅ 消息表已准备\n📂 扫描会话文件...\n");

if (!existsSync(SESSIONS_DIR)) {
  console.log("❌ 会话目录不存在：" + SESSIONS_DIR);
  process.exit(0);
}

const sessionFiles = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
console.log("找到 " + sessionFiles.length + " 个会话文件\n");

let totalMessages = 0;
let insertedMessages = 0;

for (const file of sessionFiles) {
  const filePath = join(SESSIONS_DIR, file);
  console.log("📄 处理：" + file);
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    
    let messageIndex = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        // 提取消息内容
        if (entry.type === 'message' && entry.message) {
          const msg = entry.message;
          const role = msg.role;
          const textContent = msg.content?.[0]?.text || '';
          
          if (textContent && (role === 'user' || role === 'assistant')) {
            const messageId = `msg-${file.replace('.jsonl','')}-${messageIndex}`;
            
            totalMessages++;
            
            // 插入数据库
            try {
              db.prepare(`
                INSERT OR REPLACE INTO message_contents 
                (message_id, session_id, role, content, timestamp)
                VALUES (?, ?, ?, ?, ?)
              `).run(
                messageId,
                file,
                role,
                textContent,
                entry.timestamp || Date.now()
              );
              insertedMessages++;
            } catch (e) {
              // 忽略插入错误
            }
            
            messageIndex++;
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    
    console.log("   ✅ " + messageIndex + " 条消息\n");
  } catch (e) {
    console.log("   ❌ 读取失败：" + e.message + "\n");
  }
}

db.close();

console.log("══════════════════════════════════════════════════════");
console.log("📊 结果");
console.log("══════════════════════════════════════════════════════");
console.log("  总消息数：" + totalMessages);
console.log("  已插入：" + insertedMessages);
console.log("\n🌐 现在刷新 Dashboard 应该能看到真实消息内容了！\n");
