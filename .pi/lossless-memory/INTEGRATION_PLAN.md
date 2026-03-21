# Lossless Memory - 集成方案

## 📊 现有插件工作原理

### 插件架构

```
pi 运行时
   │
   ├─► 加载插件 (index.ts)
   │      │
   │      ├─► 监听 pi 事件
   │      │   - session_start
   │      │   - session_before_compact
   │      │   - context
   │      │   - session_shutdown
   │      │
   │      ├─► 调用工具
   │      │   - pi_memory_search (搜索)
   │      │   - pi_memory_stats (统计)
   │      │   - pi_memory_expand (展开)
   │      │
   │      └─► 写入 SQLite
   │          (~/.pi/agent/lossless-memory.db)
   │
   └─► pi 会话文件
       (~/.pi/agent/sessions/*.jsonl)
```

### 数据存储

**SQLite 数据库** (`~/.pi/agent/lossless-memory.db`):
```sql
-- memory_nodes 表
- id TEXT PRIMARY KEY
- level INTEGER (0=L0, 1=L1, 2=L2)
- type TEXT (summary|message)
- content TEXT
- parent_ids TEXT (JSON)
- child_ids TEXT (JSON)
- session_id TEXT
- session_entry_ids TEXT (JSON)
- created_at INTEGER
- token_count INTEGER

-- session_index 表
- session_id TEXT PRIMARY KEY
- session_path TEXT
- created_at INTEGER
- last_accessed INTEGER
- node_count INTEGER
- total_tokens INTEGER
```

### 关键发现

✅ **好消息**:
1. 插件已经实现了完整的 DAG 生成逻辑
2. 使用 SQLite 存储，数据持久化
3. 监听 pi 事件，自动触发压缩
4. 数据库位置：`~/.pi/agent/lossless-memory.db`

⚠️ **需要做的**:
1. Dashboard 直接读取同一个 SQLite 数据库
2. 不需要复杂的后端服务
3. 只需要一个轻量级 API 层

---

## 🏗️ 集成架构 (简化版)

```
┌─────────────────────────────────────────────────────────┐
│                    用户界面层                            │
├─────────────────┬───────────────────────────────────────┤
│                 │                                       │
│  pi TUI         │   Web Dashboard                       │
│  (终端)         │   (React @ localhost:5173)            │
│                 │                                       │
│  ┌───────────┐  │   ┌────────────────────────────────┐ │
│  │ 插件代码  │  │   │ Dashboard 前端                 │ │
│  │           │  │   │                                │ │
│  │ - 监听事件│  │   │ - 项目列表                     │ │
│  │ - 生成 DAG│  │   │ - 项目详情                     │ │
│  │ - 写入 DB │  │   │ - DAG 可视化                    │ │
│  └─────┬─────┘  │   │ - API 统计                      │ │
│        │        │   └────────────┬───────────────────┘ │
│        │        │                │                      │
│        ▼        │                ▼                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │          SQLite 数据库 (共享)                    │   │
│  │                                                  │   │
│  │  ~/.pi/agent/lossless-memory.db                 │   │
│  │                                                  │   │
│  │  - memory_nodes (DAG 节点)                       │   │
│  │  - session_index (会话索引)                      │   │
│  │  - metadata (元数据)                             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 集成策略

### 方案选择

**✅ 推荐方案：直接读取共享数据库**

```
pi 插件 ──写入──► SQLite ◄──读取── Dashboard
                数据库
```

**优点**:
- ✅ 简单，不需要复杂的后端服务
- ✅ 实时，插件写入后立即可见
- ✅ 可靠，SQLite 支持并发读取
- ✅ 快速，本地文件系统访问

**❌ 不推荐：通过 API 同步**

```
pi 插件 ──HTTP──► 后端服务 ◄──HTTP── Dashboard
```

**缺点**:
- ❌ 复杂，需要维护后端服务
- ❌ 延迟，需要额外的网络调用
- ❌ 不可靠，服务可能宕机
- ❌ 冗余，数据需要复制

---

## 📦 实现方案

### 1. 创建共享类型库

位置：`shared/types.ts`

```typescript
// 插件和 Dashboard 共享的类型定义
export interface MemoryNode {
  id: string;
  level: number;
  type: 'summary' | 'message';
  content: string;
  parentIds: string[];
  childIds: string[];
  sessionId: string;
  sessionEntryIds: string[];
  createdAt: number;
  tokenCount: number;
}

export interface Session {
  sessionId: string;
  sessionPath: string;
  createdAt: number;
  lastAccessed: number;
  nodeCount: number;
  totalTokens: number;
}

export interface Project {
  path: string;
  name: string;
  sessionCount: number;
  messageCount: number;
  lastActive: number;
}
```

### 2. 创建数据库读取层

位置：`dashboard/src/lib/database.ts`

```typescript
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MemoryNode, Session, Project } from '../shared/types';

const DB_PATH = join(homedir(), '.pi/agent/lossless-memory.db');

export class DashboardDatabase {
  private db: DatabaseSync;
  
  constructor() {
    this.db = new DatabaseSync(DB_PATH);
  }
  
  // 获取所有项目
  getProjects(): Project[] {
    const stmt = this.db.prepare(`
      SELECT 
        session_path as path,
        COUNT(*) as sessionCount,
        SUM(node_count) as messageCount,
        MAX(last_accessed) as lastActive
      FROM session_index
      GROUP BY session_path
    `);
    return stmt.all() as Project[];
  }
  
  // 获取会话列表
  getSessions(projectPath?: string): Session[] {
    let sql = 'SELECT * FROM session_index';
    if (projectPath) {
      sql += ' WHERE session_path LIKE ?';
    }
    sql += ' ORDER BY last_accessed DESC';
    
    const stmt = this.db.prepare(sql);
    if (projectPath) {
      return stmt.all(`%${projectPath}%`) as Session[];
    }
    return stmt.all() as Session[];
  }
  
  // 获取 DAG 节点
  getNodes(sessionId?: string): MemoryNode[] {
    let sql = 'SELECT * FROM memory_nodes';
    if (sessionId) {
      sql += ' WHERE session_id = ?';
    }
    sql += ' ORDER BY level DESC, created_at ASC';
    
    const stmt = this.db.prepare(sql);
    const rows = sessionId ? stmt.all(sessionId) : stmt.all();
    
    return rows.map((row: any) => ({
      ...row,
      parentIds: JSON.parse(row.parent_ids || '[]'),
      childIds: JSON.parse(row.child_ids || '[]'),
      sessionEntryIds: JSON.parse(row.session_entry_ids || '[]')
    }));
  }
  
  // 搜索节点
  searchNodes(keyword: string, limit: number = 20) {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_nodes
      WHERE content LIKE ?
      ORDER BY level ASC
      LIMIT ?
    `);
    return stmt.all(`%${keyword}%`, limit);
  }
  
  // 获取统计信息
  getStats() {
    const stats = {
      projects: this.db.prepare('SELECT COUNT(*) as count FROM session_index GROUP BY session_path').all().length,
      sessions: this.db.prepare('SELECT COUNT(*) as count FROM session_index').get() as any,
      nodes: this.db.prepare('SELECT COUNT(*) as count FROM memory_nodes').get() as any,
      tokens: this.db.prepare('SELECT COALESCE(SUM(token_count), 0) as total FROM memory_nodes').get() as any
    };
    return stats;
  }
}
```

### 3. 创建 API 服务 (可选)

位置：`dashboard/src/server/api.ts`

```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { DashboardDatabase } from '../lib/database';

const app = new Hono();
const db = new DashboardDatabase();

// 获取项目列表
app.get('/api/projects', (c) => {
  const projects = db.getProjects();
  return c.json({ projects });
});

// 获取会话列表
app.get('/api/sessions', (c) => {
  const projectPath = c.req.query('projectPath');
  const sessions = db.getSessions(projectPath);
  return c.json({ sessions });
});

// 获取 DAG 节点
app.get('/api/nodes', (c) => {
  const sessionId = c.req.query('sessionId');
  const nodes = db.getNodes(sessionId);
  return c.json({ nodes });
});

// 搜索
app.post('/api/search', async (c) => {
  const { query, limit = 20 } = await c.req.json();
  const results = db.searchNodes(query, limit);
  return c.json({ results });
});

// 统计信息
app.get('/api/stats', (c) => {
  const stats = db.getStats();
  return c.json({ stats });
});

// 启动服务器
serve(app, { port: 3001 }, () => {
  console.log('API Server running on http://localhost:3001');
});
```

### 4. Dashboard 调用 API

位置：`dashboard/src/lib/api.ts`

```typescript
const API_BASE = 'http://localhost:3001';

export async function fetchProjects() {
  const res = await fetch(`${API_BASE}/api/projects`);
  return res.json();
}

export async function fetchSessions(projectPath?: string) {
  const url = new URL(`${API_BASE}/api/sessions`);
  if (projectPath) {
    url.searchParams.set('projectPath', projectPath);
  }
  const res = await fetch(url);
  return res.json();
}

export async function fetchNodes(sessionId?: string) {
  const url = new URL(`${API_BASE}/api/nodes`);
  if (sessionId) {
    url.searchParams.set('sessionId', sessionId);
  }
  const res = await fetch(url);
  return res.json();
}

export async function search(query: string, limit = 20) {
  const res = await fetch(`${API_BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit })
  });
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/api/stats`);
  return res.json();
}
```

---

## 📅 实施步骤

### Step 1: 创建共享类型 (30 分钟)

```bash
cd ~/.pi/lossless-memory
mkdir -p src/shared
# 创建类型文件
```

### Step 2: 创建数据库读取层 (1 小时)

```bash
mkdir -p src/lib
# 创建 database.ts
# 测试读取现有数据库
```

### Step 3: 创建 API 服务 (2 小时)

```bash
npm install hono @hono/node-server
mkdir -p src/server
# 创建 api.ts
# 测试 API endpoints
```

### Step 4: Dashboard 切换到 API (2 小时)

```bash
mkdir -p src/lib
# 创建 api.ts
# 修改现有页面调用 API 而非 Mock 数据
```

### Step 5: 测试和验证 (1 小时)

```bash
# 启动 pi，创建新对话
# 验证 Dashboard 显示新数据
# 测试搜索功能
```

---

## ✅ 验收标准

### 功能验收

- [ ] Dashboard 显示真实项目列表
- [ ] 点击项目显示真实会话
- [ ] DAG 图谱显示真实节点
- [ ] 搜索返回真实结果
- [ ] 统计数据准确

### 集成验收

- [ ] pi 插件写入数据
- [ ] Dashboard 立即看到新数据
- [ ] 无数据同步延迟
- [ ] 无数据丢失

---

## 🎯 下一步

**立即开始 Step 1**:
1. 创建共享类型目录
2. 复制插件的 types.ts
3. Dashboard 导入共享类型

**准备好了吗？** 👇
