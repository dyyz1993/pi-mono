# Lossless Memory - 完整架构设计

## 📋 项目目标

构建一个完整的 DAG 上下文管理系统，包含：
1. **pi 插件** - 监听对话，生成摘要，存储数据
2. **Dashboard** - 可视化展示，搜索检索，统计分析
3. **后端服务** - API 接口，数据同步，向量搜索

---

## 🏗️ 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户界面层                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐      ┌─────────────────┐                  │
│  │ pi TUI          │      │ Web Dashboard   │                  │
│  │ (终端界面)      │      │ (React 应用)     │                  │
│  │                 │      │                 │                  │
│  │ - 对话交互      │      │ - 项目列表      │                  │
│  │ - 实时反馈      │      │ - DAG 可视化     │                  │
│  │ - 命令调用      │      │ - API 统计       │                  │
│  └────────┬────────┘      └────────┬────────┘                  │
│           │                        │                            │
└───────────┼────────────────────────┼────────────────────────────┘
            │                        │
            ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API 服务层                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────┐       │
│  │  Backend API Server (Hono + Node.js)                │       │
│  │                                                      │       │
│  │  REST API Endpoints:                                │       │
│  │  - GET  /api/projects       # 项目列表              │       │
│  │  - GET  /api/sessions       # 会话列表              │       │
│  │  - GET  /api/nodes          # DAG 节点              │       │
│  │  - POST /api/search         # 搜索检索              │       │
│  │  - GET  /api/stats          # 统计数据              │       │
│  │  - POST /api/embeddings     # 向量生成              │       │
│  │  - POST /api/summarize      # 摘要生成              │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
            │                        │
            ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                        业务逻辑层                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Plugin Core  │  │ Search Svc   │  │ Summary Svc  │         │
│  │              │  │              │  │              │         │
│  │ - 事件监听   │  │ - 关键词搜索 │  │ - LLM 调用     │         │
│  │ - DAG 生成    │  │ - 向量检索   │  │ - 摘要生成   │         │
│  │ - 数据同步   │  │ - 结果排序   │  │ - 分层压缩   │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │ Embedding Svc│  │ Sync Svc     │                            │
│  │              │  │              │                            │
│  │ - 向量生成   │  │ - 数据同步   │                            │
│  │ - 相似度计算 │  │ - 实时更新   │                            │
│  └──────────────┘  └──────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
            │                        │
            ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                        数据存储层                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ SQLite       │  │ Vector Store │  │ File System  │         │
│  │              │  │              │  │              │         │
│  │ - DAG 节点    │  │ - 向量嵌入   │  │ - pi 会话文件  │         │
│  │ - 会话索引   │  │ - 相似度索引 │  │ - 原始消息   │         │
│  │ - 统计信息   │  │ - 快速检索   │  │ - 配置信息   │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📦 技术栈选型

### 后端服务

| 组件 | 技术选型 | 说明 |
|------|---------|------|
| **框架** | Hono | 轻量级，支持 Node.js，类型安全 |
| **语言** | TypeScript | 与前端统一，类型安全 |
| **数据库** | SQLite (libsql) | 轻量，嵌入式，支持向量 |
| **向量搜索** | libsql-vector | SQLite 向量扩展 |
| **API 文档** | OpenAPI (Zod) | 自动生成 API 文档 |

### 外部服务

| 服务 | 提供商 | 用途 |
|------|-------|------|
| **向量嵌入** | SiliconFlow | Qwen3-Embedding-8B |
| **LLM** | pi 全局配置 | 摘要生成，使用用户配置的模型 |

---

## 🗂️ 项目结构

```
lossless-memory/
├── backend/                    # 后端服务
│   ├── src/
│   │   ├── index.ts           # 入口文件
│   │   ├── server.ts          # Hono 服务器
│   │   ├── routes/            # API 路由
│   │   │   ├── projects.ts    # 项目相关 API
│   │   │   ├── sessions.ts    # 会话相关 API
│   │   │   ├── nodes.ts       # DAG 节点 API
│   │   │   ├── search.ts      # 搜索 API
│   │   │   ├── stats.ts       # 统计 API
│   │   │   └── embeddings.ts  # 向量 API
│   │   ├── services/          # 业务逻辑
│   │   │   ├── retrieval.ts   # 检索服务
│   │   │   ├── summarization.ts # 摘要服务
│   │   │   ├── embedding.ts   # 向量服务
│   │   │   └── sync.ts        # 同步服务
│   │   ├── database/          # 数据库
│   │   │   ├── schema.ts      # 数据库模式
│   │   │   ├── migrations/    # 迁移文件
│   │   │   └── repository.ts  # 数据访问层
│   │   └── utils/             # 工具函数
│   ├── package.json
│   └── tsconfig.json
│
├── plugin/                     # pi 插件 (已有代码)
│   └── src/
│       ├── index.ts           # 插件入口
│       ├── database.ts        # 数据库操作
│       ├── dag-manager.ts     # DAG 管理
│       └── types.ts           # 类型定义
│
├── dashboard/                  # 前端 Dashboard (重命名自 src/client)
│   ├── src/
│   │   ├── pages/             # 页面组件
│   │   ├── components/        # 通用组件
│   │   ├── hooks/             # React Hooks
│   │   ├── api/               # API 客户端
│   │   └── types/             # TypeScript 类型
│   ├── package.json
│   └── vite.config.ts
│
└── shared/                     # 共享代码
    ├── types/                 # 共享类型定义
    └── utils/                 # 共享工具函数
```

---

## 🔌 API 接口设计

### 项目相关

```typescript
// GET /api/projects
// 获取所有项目列表
Response: {
  projects: Project[];
}

// GET /api/projects/:id
// 获取单个项目详情
Response: Project & {
  sessions: Session[];
  stats: ProjectStats;
}
```

### DAG 节点相关

```typescript
// GET /api/nodes
// 获取 DAG 节点（支持过滤）
Query: {
  level?: number;
  sessionId?: string;
  projectPath?: string;
}
Response: Node[];

// GET /api/nodes/:id
// 获取单个节点详情
Response: Node & {
  children: Node[];
  parent?: Node;
  messages: Message[];
}
```

### 搜索相关

```typescript
// POST /api/search
// 搜索节点和消息
Body: {
  query: string;
  filters?: {
    levels?: number[];
    projects?: string[];
    timeRange?: { from: number; to: number };
  };
  limit?: number;
}
Response: {
  results: SearchResult[];
  total: number;
}
```

### 向量相关

```typescript
// POST /api/embeddings/generate
// 生成文本向量
Body: {
  text: string;
  model?: string; // 默认 Qwen3-Embedding-8B
}
Response: {
  embedding: number[];
  model: string;
  usage: { tokens: number };
}

// POST /api/embeddings/similarity
// 计算向量相似度
Body: {
  vector1: number[];
  vector2: number[];
}
Response: {
  similarity: number; // 0-1 之间的相似度分数
}
```

### 统计相关

```typescript
// GET /api/stats/overview
// 获取总体统计
Response: {
  totalProjects: number;
  totalSessions: number;
  totalNodes: number;
  totalMessages: number;
  totalTokens: number;
}

// GET /api/stats/usage
// 获取 API 使用统计
Query: {
  range?: '7d' | '30d' | '90d';
}
Response: {
  embeddings: {
    calls: number;
    tokens: number;
    cost: number;
  };
  llm: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}
```

---

## 📊 数据库设计

### 核心表结构

```sql
-- 项目表
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 会话表
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  message_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- DAG 节点表
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  level INTEGER NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  session_id TEXT NOT NULL,
  parent_ids TEXT, -- JSON 数组
  child_ids TEXT,  -- JSON 数组
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- 消息表
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  node_id TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(id)
);

-- 向量表 (使用 libsql-vector 扩展)
CREATE TABLE embeddings (
  node_id TEXT PRIMARY KEY,
  embedding F32_BLOB(4096), -- 4096 维向量
  FOREIGN KEY (node_id) REFERENCES nodes(id)
);

-- 创建向量索引
CREATE INDEX embeddings_idx ON embeddings (
  embedding vector_cosine_ops
);

-- API 使用统计表
CREATE TABLE api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  service TEXT NOT NULL, -- 'embedding' | 'llm'
  calls INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0
);
```

---

## 🔄 数据流

### 1. pi 插件 → 后端服务

```
用户对话
   │
   ▼
pi 插件监听 session_start/session_end
   │
   ▼
生成 DAG 摘要 (调用 LLM)
   │
   ▼
写入 SQLite 数据库
   │
   ▼
触发同步事件 → 后端服务
                   │
                   ▼
              生成向量嵌入 (SiliconFlow)
                   │
                   ▼
              存入向量索引
```

### 2. Dashboard → 后端服务

```
用户操作
   │
   ▼
Dashboard 调用 API
   │
   ▼
后端服务处理请求
   │
   ├─► 读取 SQLite (节点/会话)
   │
   ├─► 向量搜索 (相似度匹配)
   │
   └─► 返回 JSON 数据
   │
   ▼
Dashboard 渲染展示
```

---

## 📅 开发计划

### Phase 1: 后端基础 (预计 2 天)

**目标**: 创建后端 API 服务，实现基本 CRUD

- [ ] 搭建 Hono 服务器
- [ ] 配置 SQLite 数据库
- [ ] 实现项目 API
- [ ] 实现会话 API
- [ ] 实现节点 API
- [ ] Dashboard 切换到真实 API

### Phase 2: 搜索功能 (预计 2 天)

**目标**: 实现关键词搜索和向量搜索

- [ ] 集成 libsql-vector
- [ ] 实现关键词搜索 API
- [ ] 实现向量生成 API
- [ ] 实现向量相似度搜索
- [ ] Dashboard 搜索功能改造

### Phase 3: pi 插件集成 (预计 2 天)

**目标**: 插件和后端服务数据同步

- [ ] 插件写入共享数据库
- [ ] 实现数据同步机制
- [ ] 实现事件监听
- [ ] 实时数据更新

### Phase 4: LLM 集成 (预计 1 天)

**目标**: 集成 pi 的 LLM 生成摘要

- [ ] 调用 pi API 生成摘要
- [ ] 实现分层摘要逻辑
- [ ] 优化摘要质量
- [ ] 缓存机制

### Phase 5: 优化和测试 (预计 1 天)

**目标**: 性能优化，测试验收

- [ ] 性能优化
- [ ] 错误处理
- [ ] 日志系统
- [ ] 端到端测试
- [ ] 文档完善

---

## 👥 分工建议

### 方案 A: 单人开发 (推荐)

```
你 (全栈开发)
├── 后端服务 (2 天)
├── 搜索功能 (2 天)
├── 插件集成 (2 天)
├── LLM 集成 (1 天)
└── 测试优化 (1 天)
总计：8 天
```

### 方案 B: 双人协作

```
开发者 A (后端)
├── 后端服务搭建
├── 数据库设计
├── API 实现
└── 搜索功能

开发者 B (前端 + 插件)
├── Dashboard API 对接
├── pi 插件改造
├── LLM 集成
└── UI 优化

总计：4 天 (并行开发)
```

---

## 🎯 下一步行动

### 立即开始 (Phase 1)

1. **创建后端目录结构**
   ```bash
   mkdir -p backend/src/{routes,services,database,utils}
   ```

2. **初始化后端项目**
   ```bash
   cd backend
   npm init -y
   npm install hono @hono/node-server better-sqlite3
   npm install -D typescript @types/node
   ```

3. **创建第一个 API**
   ```typescript
   // backend/src/index.ts
   import { serve } from '@hono/node-server';
   import { app } from './server';
   
   serve(app, (info) => {
     console.log(`Server running on http://localhost:${info.port}`);
   });
   ```

---

## 📝 风险和挑战

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **向量搜索性能** | 高 | 使用 libsql-vector，建立索引 |
| **数据同步冲突** | 中 | 使用事务，乐观锁 |
| **LLM 调用成本** | 中 | 缓存摘要结果，按需生成 |
| **pi 插件兼容性** | 低 | 充分测试，版本控制 |

---

## ✅ 验收标准

### 功能验收

- [ ] Dashboard 显示真实数据
- [ ] 搜索返回相关结果
- [ ] 向量搜索工作正常
- [ ] pi 插件数据同步
- [ ] 统计页面数据准确

### 性能验收

- [ ] API 响应 < 100ms
- [ ] 搜索响应 < 500ms
- [ ] 向量搜索 < 1s
- [ ] 支持 1000+ 会话

### 质量验收

- [ ] TypeScript 类型安全
- [ ] 单元测试覆盖 > 70%
- [ ] 错误处理完善
- [ ] 日志记录完整

