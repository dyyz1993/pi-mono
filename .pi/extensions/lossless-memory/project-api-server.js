#!/usr/bin/env node
/**
 * Lossless Memory - 项目维度 API Server (Mock + 真实数据混合)
 * 端口：17339
 */

import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const PORT = 17339;
const DB_PATH = join(homedir(), ".pi/agent/lossless-memory.db");
const SESSIONS_DIR = join(homedir(), ".pi/agent/sessions");

// Mock 项目数据
let PROJECTS = [
  {
    path: '/Users/xuyingzhou/Project/temporary/pi-mono',
    name: 'pi-mono',
    lastSeen: Date.now(),
    sessions: 1,
    nodes: 0,
    tokens: 7060,
    sizeMB: 0.5
  }
];

// 加载真实项目数据
function loadProjects() {
  try {
    if (!existsSync(SESSIONS_DIR)) return PROJECTS;
    
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
    const projectMap = new Map();
    
    for (const file of files) {
      const filePath = join(SESSIONS_DIR, file);
      const stats = require('fs').statSync(filePath);
      
      // 简化：所有会话归到 pi-mono 项目
      const proj = projectMap.get('pi-mono') || { ...PROJECTS[0], sessions: 0 };
      proj.sessions++;
      proj.lastSeen = Math.max(proj.lastSeen, stats.mtimeMs);
      projectMap.set('pi-mono', proj);
    }
    
    if (projectMap.size > 0) {
      PROJECTS = Array.from(projectMap.values());
    }
  } catch (e) {
    console.error("加载项目失败:", e.message);
  }
  
  return PROJECTS;
}

// 从数据库加载节点
function loadNodes(projectPath) {
  try {
    if (!existsSync(DB_PATH)) return [];
    
    const db = new DatabaseSync(DB_PATH);
    const rows = db.prepare('SELECT * FROM memory_nodes ORDER BY level DESC').all();
    db.close();
    
    return rows.map(r => ({
      id: r.id,
      level: r.level,
      type: r.type,
      content: r.content,
      tokenCount: r.token_count || 0,
      childIds: r.child_ids ? JSON.parse(r.child_ids) : [],
      sessionEntryIds: r.session_entry_ids ? JSON.parse(r.session_entry_ids) : []
    }));
  } catch (e) {
    return [];
  }
}

// 加载会话列表
function loadSessions(projectPath) {
  try {
    if (!existsSync(SESSIONS_DIR)) return [];
    
    const files = readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const filePath = join(SESSIONS_DIR, f);
        const stats = require('fs').statSync(filePath);
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l);
        
        return {
          id: f.replace('.jsonl', ''),
          name: f,
          messages: lines.length,
          tokens: Math.ceil(lines.length * 50),
          lastSeen: stats.mtimeMs,
          size: stats.size
        };
      })
      .sort((a, b) => b.lastSeen - a.lastSeen);
    
    return files;
  } catch (e) {
    return [];
  }
}

// API 处理
function handleApi(url, res) {
  const u = new URL(url, 'http://localhost:'+PORT);
  const project = u.searchParams.get('project') || PROJECTS[0]?.path;
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (u.pathname === '/api/projects') {
    loadProjects();
    res.end(JSON.stringify(PROJECTS));
  }
  else if (u.pathname === '/api/data') {
    const nodes = loadNodes(project);
    const sessions = loadSessions(project);
    const projectData = PROJECTS.find(p => p.path === project) || PROJECTS[0];
    
    res.end(JSON.stringify({
      stats: {
        nodeCount: nodes.length,
        maxLevel: nodes.reduce((m,n) => Math.max(m, n.level||0), 0),
        totalTokens: nodes.reduce((s,n) => s + n.tokenCount, 0),
        sessionCount: sessions.length,
        messageCount: sessions.reduce((s,x) => s + x.messages, 0),
        sizeMB: sessions.reduce((s,x) => s + x.size, 0) / 1024 / 1024
      },
      nodes,
      sessions,
      project: projectData
    }));
  }
  else if (u.pathname === '/api/nodes') {
    res.end(JSON.stringify(loadNodes(project)));
  }
  else if (u.pathname === '/api/sessions') {
    res.end(JSON.stringify(loadSessions(project)));
  }
  else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

// HTTP 服务器
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.end();
    return;
  }
  
  if ((req.url || '/').startsWith('/api/')) {
    handleApi(req.url || '/', res);
    return;
  }
  
  // 静态文件服务（Dashboard 前端）
  const filePath = join(process.cwd(), 'dashboard', req.url === '/' ? 'index.html' : req.url);
  
  try {
    const content = readFileSync(filePath);
    const ext = filePath.split('.').pop();
    const contentType = {
      'html': 'text/html',
      'js': 'application/javascript',
      'css': 'text/css',
      'json': 'application/json'
    }[ext] || 'text/plain';
    
    res.setHeader('Content-Type', contentType + '; charset=utf-8');
    res.end(content);
  } catch (e) {
    res.statusCode = 404;
    res.end('Not found: ' + filePath);
  }
});

// 启动
console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║   Lossless Memory - 项目维度 Dashboard v5          ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

server.listen(PORT, () => {
  console.log("🌐 访问：http://localhost:" + PORT);
  console.log("📁 项目维度设计");
  console.log("🎨 Tailwind CSS 界面");
  console.log("📊 项目选择器");
  console.log("🎨 DAG 可视化");
  console.log("\n💡 提示：首次加载显示 Mock 数据，真实数据需要 pi 对话生成\n");
});
