#!/usr/bin/env node
/**
 * 从真实 pi 会话文件读取数据
 * 生成 DAG 格式供 Dashboard 使用
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SESSIONS_DIR = join(homedir(), '.pi/agent/sessions');

function readPiSessions() {
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  console.log(`找到 ${files.length} 个会话文件`);
  
  const allMessages = [];
  
  for (const file of files.slice(0, 3)) { // 只读取最近 3 个会话
    const filePath = join(SESSIONS_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        if (entry.type === 'message' && entry.message) {
          const textContent = entry.message.content
            ?.filter(c => c && (c.type === 'text' || c.type === 'tool_use' || c.type === 'tool_result'))
            ?.map(c => {
              if (c.type === 'text') return c.text;
              if (c.type === 'tool_use') return `[工具调用] ${c.name}`;
              if (c.type === 'tool_result') return `[工具结果] ${c.content}`;
              return '';
            })
            ?.join('\n') || '';
          
          if (textContent.length < 3) continue;
          
          allMessages.push({
            id: `msg-${allMessages.length + 1}`,
            role: entry.message.role,
            type: entry.message.content?.[0]?.type || 'text',
            content: textContent.slice(0, 500),
            timestamp: entry.timestamp || Date.now(),
            sessionId: entry.id,
            sessionFile: file
          });
        }
      } catch (e) {
        // 跳过解析失败的行
      }
    }
  }
  
  console.log(`提取到 ${allMessages.length} 条有效消息`);
  return allMessages;
}

// 分组消息
function groupMessages(messages) {
  const groups = [];
  const GROUP_SIZE = 10;
  
  for (let i = 0; i < messages.length; i += GROUP_SIZE) {
    groups.push(messages.slice(i, i + GROUP_SIZE));
  }
  
  return groups;
}

// 生成数据结构
function generateDataStructure(messages) {
  const groups = groupMessages(messages);
  
  // L1 节点
  const l1Nodes = groups.map((group, index) => {
    const preview = group.slice(0, 2).map(m => m.content.slice(0, 80)).join('...');
    const toolMessages = group.filter(m => m.type === 'tool_result' || m.type === 'tool_use');
    
    return {
      id: `l1-${index + 1}`,
      level: 1,
      content: `对话片段 ${index + 1}\n\n${preview}...\n\n工具调用：${toolMessages.length} 次`,
      tokenCount: group.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
      childIds: group.map(m => m.id),
      topic: toolMessages.length > 0 ? '工具调用' : '普通对话',
      keywords: ['对话', '消息'],
      parentIds: ['l2-001'],
      siblingIds: groups.map((_, i) => `l1-${i + 1}`).filter((_, i) => i !== index)
    };
  });
  
  // L2 节点
  const l2Node = {
    id: 'l2-001',
    level: 2,
    content: `会话摘要\n\n共 ${messages.length} 条消息，分为 ${l1Nodes.length} 个片段`,
    tokenCount: messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
    childIds: l1Nodes.map(n => n.id),
    topics: ['对话', '工具调用'],
    keywords: ['会话', '消息']
  };
  
  // L0 消息
  const l0Messages = messages.map(m => ({
    ...m,
    level: 0,
    tokenCount: Math.ceil(m.content.length / 4),
    parentL1: `l1-${Math.floor((parseInt(m.id.split('-')[1]) - 1) / 10) + 1}`,
    timestamp: m.timestamp
  }));
  
  return { l2: l2Node, l1: l1Nodes, l0: l0Messages };
}

// 主函数
function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║     从真实 pi 会话读取数据                            ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  
  const messages = readPiSessions();
  
  if (messages.length === 0) {
    console.log('⚠️  没有找到有效消息');
    return;
  }
  
  const data = generateDataStructure(messages);
  
  console.log('\n📊 生成结果:');
  console.log(`  L2 节点：1 个`);
  console.log(`  L1 节点：${data.l1.length} 个`);
  console.log(`  L0 消息：${data.l0.length} 条`);
  
  console.log('\n消息类型统计:');
  const typeStats = {};
  data.l0.forEach(m => {
    typeStats[m.type] = (typeStats[m.type] || 0) + 1;
  });
  Object.entries(typeStats).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} 条`);
  });
  
  // 保存到 JSON 文件
  const outputPath = join(process.cwd(), 'real-pi-data.json');
  writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\n✅ 数据已保存到：${outputPath}`);
  
  console.log('\n前 5 条消息示例:');
  data.l0.slice(0, 5).forEach((msg, i) => {
    console.log(`\n  [${i+1}] ${msg.id} (${msg.role}) - ${msg.type}`);
    console.log(`      ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
  });
}

main();
