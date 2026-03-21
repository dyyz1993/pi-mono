#!/usr/bin/env node
/**
 * 从 pi 的真实会话文件中读取消息
 * 转换成 DAG 格式供 Dashboard 使用
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SESSIONS_DIR = join(homedir(), '.pi/agent/sessions');

// 读取所有会话文件
function readAllSessions() {
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  console.log(`找到 ${files.length} 个会话文件`);
  
  const allMessages = [];
  
  for (const file of files) {
    const filePath = join(SESSIONS_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        // 只提取 message 类型的条目
        if (entry.type === 'message' && entry.message) {
          const textContent = entry.message.content
            ?.filter(c => c.type === 'text')
            ?.map(c => c.text)
            ?.join('') || '';
          
          // 跳过太短的消息
          if (textContent.length < 5) continue;
          
          allMessages.push({
            id: `msg-${allMessages.length + 1}`,
            role: entry.message.role,
            content: textContent,
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

// 自动分组消息到主题
function groupMessagesByTopic(messages) {
  const topics = {};
  let currentTopic = '未分类';
  let topicIndex = 0;
  
  // 简单的基于时间窗口的分组（每 10 条消息一个主题）
  messages.forEach((msg, i) => {
    if (i > 0 && i % 10 === 0) {
      topicIndex++;
      currentTopic = `主题-${topicIndex}`;
    }
    
    if (!topics[currentTopic]) {
      topics[currentTopic] = [];
    }
    topics[currentTopic].push(msg);
  });
  
  return topics;
}

// 生成 L1 摘要（模拟）
function generateL1Summaries(topicGroups) {
  const l1Nodes = [];
  
  Object.entries(topicGroups).forEach(([topic, messages], index) => {
    const preview = messages.slice(0, 3).map(m => m.content.slice(0, 50)).join('...');
    
    l1Nodes.push({
      id: `l1-${index + 1}`,
      level: 1,
      type: 'summary',
      content: `对话主题：${topic}\n\n主要内容：${preview}...`,
      tokenCount: messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
      childIds: messages.map(m => m.id),
      parentIds: ['l2-001'],
      siblingIds: [],
      keywords: [topic],
      topic: topic,
      createdAt: Date.now() - (topicGroups.length - index) * 1000
    });
  });
  
  // 更新兄弟节点引用
  l1Nodes.forEach((node, i) => {
    node.siblingIds = l1Nodes.filter((_, j) => j !== i).map(n => n.id);
  });
  
  return l1Nodes;
}

// 生成 L2 摘要
function generateL2Summary(l1Nodes, allMessages) {
  const topics = [...new Set(l1Nodes.map(n => n.topic))];
  const preview = l1Nodes.slice(0, 3).map(n => n.content.slice(0, 100)).join('\n');
  
  return {
    id: 'l2-001',
    level: 2,
    type: 'summary',
    content: `会话摘要\n\n涵盖主题：${topics.join(', ')}\n\n主要内容预览:\n${preview}`,
    tokenCount: allMessages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
    childIds: l1Nodes.map(n => n.id),
    descendantIds: [...l1Nodes.map(n => n.id), ...allMessages.map(m => m.id)],
    keywords: topics,
    topics: topics,
    createdAt: Date.now()
  };
}

// 转换消息为 L0 格式
function convertToL0(messages) {
  return messages.map(msg => ({
    ...msg,
    level: 0,
    tokenCount: Math.ceil(msg.content.length / 4),
    keywords: [],
    topic: '未分类'
  }));
}

// 主函数
function readAndConvert() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║     从 pi 真实会话读取数据                            ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  
  // 1. 读取所有会话
  const allMessages = readAllSessions();
  
  if (allMessages.length === 0) {
    console.log('⚠️  没有找到有效消息');
    return null;
  }
  
  // 2. 分组到主题
  const topicGroups = groupMessagesByTopic(allMessages);
  
  // 3. 生成 L1 节点
  const l1Nodes = generateL1Summaries(topicGroups);
  
  // 4. 生成 L2 节点
  const l2Node = generateL2Summary(l1Nodes, allMessages);
  
  // 5. 转换 L0 消息
  const l0Messages = convertToL0(allMessages);
  
  console.log('\n📊 生成结果:');
  console.log(`  L2 节点：1 个`);
  console.log(`  L1 节点：${l1Nodes.length} 个`);
  console.log(`  L0 消息：${l0Messages.length} 条`);
  console.log(`  总 Token: ${l2Node.tokenCount}`);
  
  // 6. 输出为 JSON
  const result = {
    l2: l2Node,
    l1: l1Nodes,
    l0: l0Messages,
    stats: {
      sessionCount: 1,
      messageCount: l0Messages.length,
      topicCount: l1Nodes.length,
      generatedAt: Date.now()
    }
  };
  
  // 7. 保存到文件
  const outputPath = join(process.cwd(), 'pi-sessions-data.json');
  // 注意：实际保存需要写入权限，这里只打印
  
  console.log(`\n✅ 数据已生成（可保存到 ${outputPath}）`);
  console.log('\n前 3 条消息示例:');
  l0Messages.slice(0, 3).forEach((msg, i) => {
    console.log(`\n  [${i+1}] ${msg.id} (${msg.role})`);
    console.log(`      ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
  });
  
  return result;
}

// 执行
const data = readAndConvert();

// 如果需要保存，取消下面的注释
// import { writeFileSync } from 'fs';
// writeFileSync('./pi-sessions-data.json', JSON.stringify(data, null, 2));

