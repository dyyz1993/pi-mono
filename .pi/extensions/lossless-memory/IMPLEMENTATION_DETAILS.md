# DAG 检索系统 - 实现细节说明

## 重要说明

**当前状态**: ⚠️ **Mock 数据演示阶段**

- ✅ 前端 Dashboard 已实现
- ✅ Mock 数据结构已定义
- ✅ UI 交互已实现
- ❌ **后端检索服务未实现**
- ❌ **向量嵌入未实现**
- ❌ **LLM 集成未实现**

---

## 检索流程 vs 实现状态

### 步骤 1: 关键词提取

**流程**: 用户问题 → 分词 → 同义扩展

**对应方法**:
```typescript
// 已实现 ✅ (仅 Mock)
function extractKeywords(query: string): string[] {
  return query.split(/[\s,，？?!]+/).filter(word => word.length > 1);
}

function expandKeywords(keywords: string[]): string[] {
  const synonyms: Record<string, string[]> = {
    'JWT': ['Token', '认证', 'OAuth2'],
    // ... 手动定义的同义词
  };
  // ... 简单扩展逻辑
}
```

**实现状态**:
- [x] 基础分词 - ✅ 已实现（简单 split）
- [ ] 中文分词 - ❌ 未实现（需要 `node-segment` 或 `jieba`）
- [x] 同义扩展 - ✅ 已实现（手动定义词典）
- [ ] LLM 扩展 - ❌ 未实现（需要调用 LLM API）

**外部依赖**:
- 无（当前使用简单实现）
- 未来需要：`node-segment` (中文分词) 或 OpenAI API (语义扩展)

**位置**: `src/client/pages/DashboardPage.tsx` (前端 Mock)

---

### 步骤 2: L2 检索

**流程**: 遍历 L2 节点 → 计算相关性 → 返回匹配结果

**对应方法**:
```typescript
// 已实现 ✅ (仅 Mock)
async function retrieveL2(keywords: string[]): Promise<L2Result[]> {
  const l2Node = MOCK_NODES_L2;  // ← 硬编码的 Mock 数据
  const score = calculateRelevance(l2Node, keywords);
  if (score > 0.3) {
    return [{ node: l2Node, score: score, ... }];
  }
  return [];
}

function calculateRelevance(node: any, keywords: string[]): number {
  // 简单的关键词匹配计分
  let score = 0;
  score += 0.6 * (matchedKeywords.length / keywords.length);
  // ...
  return score;
}
```

**实现状态**:
- [x] L2 节点存储 - ✅ 已实现（MOCK_NODES_L2 常量）
- [x] 关键词匹配 - ✅ 已实现（字符串 includes）
- [x] 相关性评分 - ✅ 已实现（简单计分）
- [ ] 向量相似度 - ❌ 未实现
- [ ] 数据库查询 - ❌ 未实现（当前使用内存数据）

**外部依赖**:
- 无（当前使用内存中的 Mock 数据）
- 未来需要：SQLite/PostgreSQL (持久化存储)

**位置**: `src/client/pages/DashboardPage.tsx` (前端 Mock)

---

### 步骤 3: L1 检索

**流程**: 获取 L2 的 childIds → 遍历 L1 节点 → 计算相关性 → 返回结果

**对应方法**:
```typescript
// 已实现 ✅ (仅 Mock)
async function retrieveL1(l2Results: L2Result[], keywords: string[]): Promise<L1Result[]> {
  const l1Results: L1Result[] = [];
  for (const l2Result of l2Results) {
    const childIds = l2Result.node.childIds;  // ← 从 Mock 数据获取
    const childNodes = childIds.map(id => getNodeById(id)).filter(Boolean);
    for (const node of childNodes) {
      const score = calculateRelevance(node, keywords);
      if (score > 0.3) {
        l1Results.push({ node, score, ... });
      }
    }
  }
  return l1Results.sort((a, b) => b.score - a.score);
}

function getNodeById(id: string) {
  if (id.startsWith('l1-')) return MOCK_NODES_L1.find(n => n.id === id);
  // ...
}
```

**实现状态**:
- [x] 引用路径导航 - ✅ 已实现（通过 childIds 数组）
- [x] L1 节点存储 - ✅ 已实现（MOCK_NODES_L1 常量）
- [x] 按 ID 查询 - ✅ 已实现（Array.find）
- [ ] 批量查询优化 - ❌ 未实现
- [ ] 向量检索 - ❌ 未实现

**外部依赖**:
- 无

**位置**: `src/client/pages/DashboardPage.tsx` (前端 Mock)

---

### 步骤 4: L0 检索

**流程**: 获取 L1 的 childIds → 遍历消息 → 全文搜索 → 返回结果

**对应方法**:
```typescript
// 已实现 ✅ (仅 Mock)
async function retrieveL0(l1Results: L1Result[], keywords: string[]): Promise<L0Result[]> {
  const l0Results: L0Result[] = [];
  for (const l1Result of l1Results) {
    const childIds = l1Result.node.childIds;  // ['msg-1', ..., 'msg-8']
    const childMessages = childIds.map(id => getNodeById(id)).filter(Boolean);
    for (const msg of childMessages) {
      const score = calculateMessageRelevance(msg, keywords);
      if (score > 0.5) {
        l0Results.push({ node: msg, score, ... });
      }
    }
  }
  return l0Results.sort((a, b) => b.score - a.score).slice(0, 10);
}

function calculateMessageRelevance(msg: Message, keywords: string[]): number {
  let score = 0;
  // 完整匹配
  const exactMatch = keywords.some(k => msg.content.includes(k));
  score += exactMatch ? 0.5 : 0;
  // 关键词密度
  const keywordCount = keywords.reduce((count, k) => 
    count + (msg.content.match(new RegExp(k, 'gi')) || []).length, 0
  );
  score += 0.3 * Math.min(keywordCount / msg.content.length * 100, 1);
  return score;
}
```

**实现状态**:
- [x] L0 消息存储 - ✅ 已实现（MOCK_MESSAGES 常量）
- [x] 全文搜索 - ✅ 已实现（正则匹配）
- [x] 相关性评分 - ✅ 已实现（关键词密度）
- [ ] FTS5 全文索引 - ❌ 未实现（SQLite 功能）
- [ ] 向量搜索 - ❌ 未实现

**外部依赖**:
- 无

**位置**: `src/client/pages/DashboardPage.tsx` (前端 Mock)

---

### 步骤 5: 结果组装

**流程**: 聚合 L2/L1/L0 结果 → 添加引用路径 → 返回给 Agent

**对应方法**:
```typescript
// 已实现 ✅ (仅 Mock)
async function retrieveByHierarchy(keywords: string[]): Promise<RetrievalResult> {
  const l2Results = await retrieveL2(keywords);
  const l1Results = await retrieveL1(l2Results, keywords);
  const l0Results = await retrieveL0(l1Results, keywords);
  
  return {
    l2: l2Results.map(r => r.node),
    l1: l1Results.map(r => ({ ...r.node, _score: r.score, _parent: r.parentL2 })),
    l0: l0Results.map(r => ({ ...r.node, _score: r.score, _parentL1: r.parentL1 })),
    stats: {
      l2Count: l2Results.length,
      l1Count: l1Results.length,
      l0Count: l0Results.length
    }
  };
}
```

**实现状态**:
- [x] 结果聚合 - ✅ 已实现
- [x] 引用路径添加 - ✅ 已实现（_parent, _parentL1）
- [x] 统计信息 - ✅ 已实现
- [ ] 结果缓存 - ❌ 未实现
- [ ] 流式返回 - ❌ 未实现

**外部依赖**:
- 无

**位置**: `src/client/pages/DashboardPage.tsx` (前端 Mock)

---

## 完整方法调用链

```
用户输入："JWT 有效期是多久？"
    │
    ├─ retrieveContext(query)                    ← DashboardPage.tsx
    │   │
    │   ├─ extractKeywords(query)                ← 简单 split
    │   │   └─ expandKeywords(keywords)          ← 手动同义词典
    │   │
    │   ├─ retrieveByHierarchy(keywords)         ← 主检索函数
    │   │   │
    │   │   ├─ retrieveL2(keywords)              ← 内存数据查找
    │   │   │   └─ calculateRelevance(node, kw)  ← 简单计分
    │   │   │
    │   │   ├─ retrieveL1(l2Results, keywords)   ← 遍历 childIds
    │   │   │   ├─ getNodeById(id)               ← Array.find
    │   │   │   └─ calculateRelevance(node, kw)  ← 简单计分
    │   │   │
    │   │   └─ retrieveL0(l1Results, keywords)   ← 遍历 childIds
    │   │       ├─ getNodeById(id)               ← Array.find
    │   │       └─ calculateMessageRelevance()   ← 正则匹配
    │   │
    │   └─ 返回 RetrievalResult
    │
    └─ 构造 Agent 提示词
        └─ 使用 L2/L1/L0 结果
```

**所有方法位置**:
- `retrieveContext()` - DashboardPage.tsx (未单独提取，内联在组件中)
- `extractKeywords()` - DashboardPage.tsx (未实现，仅示例)
- `retrieveByHierarchy()` - DashboardPage.tsx (未实现，仅示例)
- 所有检索方法 - 当前都在前端 Mock，**没有独立的后端服务**

---

## 缺失的实现

### 1. 后端检索服务 ❌

**需要创建**:
```
src/server/
├── services/
│   ├── retrieval.service.ts    ← 检索服务
│   ├── embedding.service.ts    ← 向量嵌入服务
│   └── llm.service.ts          ← LLM 调用服务
└── routes/
    └── retrieval.routes.ts     ← API 路由
```

**状态**: ❌ 未实现

---

### 2. 向量嵌入服务 ❌

**需要实现**:
```typescript
// src/server/services/embedding.service.ts
import { OpenAI } from 'openai';

class EmbeddingService {
  private openai: OpenAI;
  
  async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text
    });
    return response.data[0].embedding;
  }
  
  async cosineSimilarity(a: number[], b: number[]): Promise<number> {
    // 计算余弦相似度
  }
}
```

**状态**: ❌ 未实现  
**外部依赖**: OpenAI API (或本地向量模型)

---

### 3. 持久化存储 ❌

**当前**: 使用内存中的 Mock 数据常量  
**需要**: SQLite/PostgreSQL 存储

**数据库表结构**:
```sql
-- L2 节点表
CREATE TABLE l2_nodes (
  id TEXT PRIMARY KEY,
  content TEXT,
  keywords TEXT[],  -- 数组类型
  topics TEXT[],
  created_at INTEGER
);

-- L1 节点表
CREATE TABLE l1_nodes (
  id TEXT PRIMARY KEY,
  content TEXT,
  keywords TEXT[],
  topic TEXT,
  parent_ids TEXT[],    -- 引用 L2
  sibling_ids TEXT[],   -- 引用其他 L1
  child_ids TEXT[],     -- 引用 L0
  created_at INTEGER
);

-- L0 消息表
CREATE TABLE l0_messages (
  id TEXT PRIMARY KEY,
  role TEXT,
  content TEXT,
  topic TEXT,
  parent_l1 TEXT,       -- 引用 L1
  l1_path TEXT[],       -- 引用路径
  l2_path TEXT[],       -- 引用路径
  keywords TEXT[],
  timestamp INTEGER
);

-- 向量索引表 (用于语义搜索)
CREATE TABLE embeddings (
  node_id TEXT PRIMARY KEY,
  embedding FLOAT[],    -- 向量数组
  FOREIGN KEY (node_id) REFERENCES l2_nodes(id)
);
```

**状态**: ❌ 未实现  
**外部依赖**: SQLite (node:sqlite) 或 PostgreSQL

---

### 4. LLM 集成 ❌

**需要实现**:
```typescript
// src/server/services/llm.service.ts
import { stream } from '@mariozechner/pi-ai';

class LLMService {
  async summarize(messages: Message[]): Promise<string> {
    const result = await stream(model, {
      messages: [
        { role: 'system', content: '请总结以下对话...' },
        { role: 'user', content: messages.map(m => m.content).join('\n') }
      ]
    });
    // 处理流式响应...
  }
  
  async expandKeywords(keywords: string[]): Promise<string[]> {
    // 使用 LLM 扩展同义词
  }
}
```

**状态**: ❌ 未实现  
**外部依赖**: @mariozechner/pi-ai (pi 的 AI 包)

---

## 当前实现总结

| 功能模块 | 状态 | 位置 | 依赖 |
|---------|------|------|------|
| 关键词提取 | ⚠️ Mock | DashboardPage.tsx | 无 |
| 同义扩展 | ⚠️ Mock | DashboardPage.tsx | 手动词典 |
| L2 检索 | ⚠️ Mock | DashboardPage.tsx | 内存数据 |
| L1 检索 | ⚠️ Mock | DashboardPage.tsx | 内存数据 |
| L0 检索 | ⚠️ Mock | DashboardPage.tsx | 内存数据 |
| 引用路径 | ✅ 已定义 | 数据结构中 | 无 |
| 相关性评分 | ⚠️ Mock | DashboardPage.tsx | 简单计分 |
| 后端服务 | ❌ 未实现 | - | - |
| 向量嵌入 | ❌ 未实现 | - | OpenAI API |
| 持久化存储 | ❌ 未实现 | - | SQLite |
| LLM 集成 | ❌ 未实现 | - | @mariozechner/pi-ai |

**图例**:
- ✅ 已实现（生产可用）
- ⚠️ Mock 实现（仅演示）
- ❌ 未实现

---

## 下一步实现计划

### Phase 1: 后端基础 (优先级：高)
1. [ ] 创建检索服务 (`src/server/services/retrieval.service.ts`)
2. [ ] 创建 API 路由 (`src/server/routes/retrieval.routes.ts`)
3. [ ] 实现 SQLite 存储（使用现有的 `node:sqlite`）
4. [ ] 从 Mock 数据迁移到数据库

### Phase 2: 向量搜索 (优先级：中)
1. [ ] 创建嵌入服务 (`src/server/services/embedding.service.ts`)
2. [ ] 集成 OpenAI Embedding API
3. [ ] 为所有节点生成向量
4. [ ] 实现余弦相似度搜索

### Phase 3: LLM 集成 (优先级：中)
1. [ ] 创建 LLM 服务 (`src/server/services/llm.service.ts`)
2. [ ] 实现摘要生成
3. [ ] 实现关键词扩展
4. [ ] 实现智能检索（LLM 判断相关性）

### Phase 4: 优化 (优先级：低)
1. [ ] 实现结果缓存
2. [ ] 实现懒加载
3. [ ] 性能优化（批量查询、索引）
4. [ ] 监控和日志

---

## 快速验证方法

**当前可以测试的功能**:
1. ✅ 前端 Dashboard 界面
2. ✅ DAG 可视化
3. ✅ 点击节点查看详情
4. ✅ 引用路径展示（Mock 数据）
5. ✅ 搜索功能（Mock 数据）

**测试命令**:
```bash
cd /Users/xuyingzhou/Project/temporary/pi-mono/.pi/lossless-memory
npm run dev
# 访问 http://localhost:5173
```

** limitations**:
- 所有数据都是 Mock 的
- 刷新页面后数据重置
- 无法持久化存储
- 检索仅限于预定义的 48 条消息
- 没有真实的 LLM 调用

---

## 联系信息

**实现位置汇总**:
- 前端 UI: `/Users/xuyingzhou/Project/temporary/pi-mono/.pi/lossless-memory/src/client/pages/DashboardPage.tsx`
- Mock 数据：同上（内联在组件中）
- 文档：`/Users/xuyingzhou/Project/temporary/pi-mono/.pi/extensions/lossless-memory/`

**需要实现的后端文件**:
- `src/server/services/retrieval.service.ts` ← 待创建
- `src/server/services/embedding.service.ts` ← 待创建
- `src/server/services/llm.service.ts` ← 待创建
- `src/server/routes/retrieval.routes.ts` ← 待创建
