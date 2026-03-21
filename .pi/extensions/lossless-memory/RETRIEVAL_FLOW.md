# DAG 检索流程详解

## 核心问题

**Agent 如何从 L2 检索到 L1，再从 L1 检索到 L0？**

答案：**通过引用路径 + 关键词搜索 + 层级导航**

---

## 检索系统架构

```
┌─────────────────────────────────────────────────────────┐
│  用户问题："JWT 有效期是多久？"                          │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  1. 关键词提取                                          │
│     - 分词：["JWT", "有效期"]                           │
│     - 同义扩展：["JWT", "Token", "有效期", "过期时间"]  │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  2. L2 检索（顶层过滤）                                 │
│     - 搜索 L2 的 keywords 和 topics                      │
│     - 匹配度评分：0.85（命中"认证"主题）                 │
│     - 结果：[l2-001]                                    │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  3. L1 检索（基于 L2 的子节点）                          │
│     - 获取 l2-001 的 childIds: [l1-1, l1-2, ..., l1-6]  │
│     - 在子节点中搜索关键词                              │
│     - 匹配度评分：                                       │
│       - l1-1 (API 设计): 0.95 ← 命中"JWT"               │
│       - l1-5 (安全认证): 0.75 ← 命中"JWT"              │
│       - 其他：< 0.3                                     │
│     - 结果：[l1-1, l1-5]                                │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  4. L0 检索（基于 L1 的子节点）                          │
│     - 获取 l1-1 的 childIds: [msg-1, ..., msg-8]        │
│     - 在子节点中全文搜索                                │
│     - 匹配度评分：                                       │
│       - msg-8: 0.98 ← 包含"JWT 有效期 1 小时"            │
│       - msg-7: 0.65 ← 包含"JWT"                        │
│       - 其他：< 0.3                                     │
│     - 结果：[msg-8, msg-7]                              │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│  5. 结果组装                                            │
│     - L2: l2-001 (高层摘要)                             │
│     - L1: l1-1 (直接相关), l1-5 (可能相关)              │
│     - L0: msg-8 (最相关), msg-7 (上下文)                │
│     - 返回给 Agent                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 检索代码实现

### 步骤 1: 关键词提取

```typescript
// 检索入口函数
async function retrieveContext(userQuery: string): Promise<RetrievalResult> {
  // 1. 提取关键词
  const keywords = extractKeywords(userQuery);
  // keywords = ["JWT", "有效期"]
  
  // 2. 扩展同义词
  const expandedKeywords = expandKeywords(keywords);
  // expandedKeywords = ["JWT", "Token", "有效期", "过期时间", "认证"]
  
  // 3. 执行层级检索
  const result = await retrieveByHierarchy(expandedKeywords);
  
  return result;
}

function extractKeywords(query: string): string[] {
  // 使用分词器或简单分割
  return query
    .split(/[\s,，？?!]+/)
    .filter(word => word.length > 1);
}

function expandKeywords(keywords: string[]): string[] {
  const synonyms: Record<string, string[]> = {
    'JWT': ['Token', '认证', 'OAuth2'],
    '有效期': ['过期时间', '失效时间', 'duration'],
    'API': ['接口', 'RESTful', 'HTTP'],
    '数据库': ['MySQL', 'PostgreSQL', 'DB'],
    '缓存': ['Redis', 'Cache', '缓冲'],
    // ...
  };
  
  const expanded = new Set(keywords);
  keywords.forEach(kw => {
    synonyms[kw]?.forEach(syn => expanded.add(syn));
  });
  
  return Array.from(expanded);
}
```

### 步骤 2: L2 检索（顶层过滤）

```typescript
async function retrieveL2(keywords: string[]): Promise<L2Result[]> {
  const l2Node = MOCK_NODES_L2;  // 通常只有一个 L2
  
  // 计算匹配度
  const score = calculateRelevance(l2Node, keywords);
  
  if (score > 0.3) {  // 阈值过滤
    return [{
      node: l2Node,
      score: score,
      matchedKeywords: keywords.filter(k => 
        l2Node.keywords.some(lk => lk.includes(k))
      )
    }];
  }
  
  return [];
}

function calculateRelevance(node: any, keywords: string[]): number {
  let score = 0;
  
  // 关键词匹配（权重 0.6）
  const matchedKeywords = keywords.filter(k =>
    node.keywords.some(nk => nk.includes(k)) ||
    node.content.includes(k)
  );
  score += 0.6 * (matchedKeywords.length / keywords.length);
  
  // 主题匹配（权重 0.3）
  const matchedTopics = keywords.filter(k =>
    node.topics?.some(t => t.includes(k))
  );
  score += 0.3 * (matchedTopics.length / keywords.length);
  
  // 时间衰减（权重 0.1，越新越相关）
  const timeScore = 1 - (Date.now() - node.createdAt) / (30 * 24 * 60 * 60 * 1000);
  score += 0.1 * timeScore;
  
  return score;
}
```

### 步骤 3: L1 检索（基于 L2 的子节点）

```typescript
async function retrieveL1(l2Results: L2Result[], keywords: string[]): Promise<L1Result[]> {
  const l1Results: L1Result[] = [];
  
  // 遍历每个 L2 结果的子节点
  for (const l2Result of l2Results) {
    const childIds = l2Result.node.childIds;  // ['l1-1', 'l1-2', ..., 'l1-6']
    
    // 获取所有子节点
    const childNodes = childIds.map(id => getNodeById(id)).filter(Boolean);
    
    // 计算每个子节点的相关性
    for (const node of childNodes) {
      const score = calculateRelevance(node, keywords);
      
      if (score > 0.3) {
        l1Results.push({
          node: node,
          score: score,
          matchedKeywords: keywords.filter(k =>
            node.keywords.some(nk => nk.includes(k))
          ),
          parentL2: l2Result.node.id,  // ← 引用路径
          siblingIds: node.siblingIds   // ← 兄弟节点
        });
      }
    }
  }
  
  // 按相关性排序
  return l1Results.sort((a, b) => b.score - a.score);
}
```

### 步骤 4: L0 检索（基于 L1 的子节点）

```typescript
async function retrieveL0(l1Results: L1Result[], keywords: string[]): Promise<L0Result[]> {
  const l0Results: L0Result[] = [];
  
  // 遍历每个 L1 结果的子节点
  for (const l1Result of l1Results) {
    const childIds = l1Result.node.childIds;  // ['msg-1', ..., 'msg-8']
    
    // 获取所有子消息
    const childMessages = childIds.map(id => getNodeById(id)).filter(Boolean);
    
    // 全文搜索（更精确的匹配）
    for (const msg of childMessages) {
      const score = calculateMessageRelevance(msg, keywords);
      
      if (score > 0.5) {  // L0 的阈值更高
        l0Results.push({
          node: msg,
          score: score,
          matchedKeywords: keywords.filter(k =>
            msg.content.includes(k)
          ),
          parentL1: l1Result.node.id,  // ← 引用路径
          parentL2: l1Result.parentL2   // ← 完整路径
        });
      }
    }
  }
  
  // 按相关性排序，取前 10 条
  return l0Results.sort((a, b) => b.score - a.score).slice(0, 10);
}

function calculateMessageRelevance(msg: Message, keywords: string[]): number {
  let score = 0;
  
  // 完整匹配（权重 0.5）
  const exactMatch = keywords.some(k => msg.content.includes(k));
  score += exactMatch ? 0.5 : 0;
  
  // 关键词密度（权重 0.3）
  const keywordCount = keywords.reduce((count, k) => 
    count + (msg.content.match(new RegExp(k, 'gi')) || []).length, 0
  );
  score += 0.3 * Math.min(keywordCount / msg.content.length * 100, 1);
  
  // 时间衰减（权重 0.2）
  const timeScore = 1 - (Date.now() - msg.timestamp) / (7 * 24 * 60 * 60 * 1000);
  score += 0.2 * timeScore;
  
  return score;
}
```

### 步骤 5: 结果组装

```typescript
async function retrieveByHierarchy(keywords: string[]): Promise<RetrievalResult> {
  // 逐层检索
  const l2Results = await retrieveL2(keywords);
  const l1Results = await retrieveL1(l2Results, keywords);
  const l0Results = await retrieveL0(l1Results, keywords);
  
  // 组装结果
  return {
    l2: l2Results.map(r => r.node),
    l1: l1Results.map(r => ({
      ...r.node,
      _score: r.score,
      _matchedKeywords: r.matchedKeywords,
      _parent: r.parentL2,
      _siblings: r.siblingIds
    })),
    l0: l0Results.map(r => ({
      ...r.node,
      _score: r.score,
      _matchedKeywords: r.matchedKeywords,
      _parentL1: r.parentL1,
      _parentL2: r.parentL2
    })),
    query: {
      original: keywords.join(' '),
      expanded: keywords
    },
    stats: {
      l2Count: l2Results.length,
      l1Count: l1Results.length,
      l0Count: l0Results.length,
      searchTime: Date.now()
    }
  };
}
```

---

## 实际检索示例

### 用户问题："JWT 有效期是多久？"

**检索过程**:

```typescript
// 1. 关键词提取
keywords = ["JWT", "有效期"]
expanded = ["JWT", "Token", "有效期", "过期时间", "认证"]

// 2. L2 检索
l2Results = [{
  node: l2-001,
  score: 0.85,
  matched: ["认证"]
}]

// 3. L1 检索（搜索 l2-001 的 6 个子节点）
l1Results = [
  { node: l1-1, score: 0.95, matched: ["JWT", "认证"] },  // API 设计
  { node: l1-5, score: 0.75, matched: ["JWT", "认证"] }   // 安全认证
]

// 4. L0 检索（搜索 l1-1 的 8 条消息）
l0Results = [
  { node: msg-8, score: 0.98, matched: ["JWT", "有效期"] },
  { node: msg-7, score: 0.65, matched: ["JWT"] }
]

// 5. 返回结果
{
  l2: [l2-001],
  l1: [l1-1, l1-5],
  l0: [msg-8, msg-7],
  stats: { l2Count: 1, l1Count: 2, l0Count: 2 }
}
```

---

## 检索策略优化

### 策略 1: 懒加载（按需检索）

```typescript
// 第一遍：只检索 L2
const l2Results = await retrieveL2(keywords);

// 如果 L2 匹配度低，直接返回
if (l2Results[0]?.score < 0.3) {
  return { l2: l2Results, l1: [], l0: [] };
}

// 第二遍：检索 L1（只有 L2 匹配度高时才执行）
const l1Results = await retrieveL1(l2Results, keywords);

// 第三遍：检索 L0（只有 L1 匹配度高时才执行）
if (l1Results[0]?.score > 0.7) {
  const l0Results = await retrieveL0(l1Results, keywords);
}
```

### 策略 2: 缓存热门检索

```typescript
const cache = new Map<string, RetrievalResult>();

async function retrieveWithCache(query: string): Promise<RetrievalResult> {
  // 检查缓存
  const cached = cache.get(query);
  if (cached && Date.now() - cached.stats.searchTime < 5 * 60 * 1000) {
    return cached;  // 5 分钟内的缓存直接返回
  }
  
  // 执行检索
  const result = await retrieveContext(query);
  
  // 存入缓存
  cache.set(query, result);
  
  return result;
}
```

### 策略 3: 语义搜索（向量检索）

```typescript
// 为每个节点生成向量嵌入
const embeddings = {
  'l2-001': await embed(l2-001.content),
  'l1-1': await embed(l1-1.content),
  'msg-1': await embed(msg-1.content),
  // ...
};

// 语义相似度搜索
async function semanticSearch(query: string, threshold: number = 0.7) {
  const queryEmbedding = await embed(query);
  
  const results = [];
  for (const [nodeId, embedding] of Object.entries(embeddings)) {
    const similarity = cosineSimilarity(queryEmbedding, embedding);
    if (similarity > threshold) {
      results.push({ nodeId, similarity });
    }
  }
  
  return results.sort((a, b) => b.similarity - a.similarity);
}
```

---

## 完整检索流程图

```
用户问题
   │
   ▼
┌─────────────────┐
│ 1. 关键词提取   │
│    - 分词       │
│    - 同义扩展   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. L2 检索       │
│    - 关键词匹配  │
│    - 主题过滤   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. L1 检索       │
│    - 子节点遍历  │
│    - 相关性评分  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. L0 检索       │
│    - 全文搜索   │
│    - 密度计算   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 5. 结果组装     │
│    - 层级聚合   │
│    - 引用路径   │
│    - 评分排序   │
└────────┬────────┘
         │
         ▼
    返回给 Agent
```

---

## 关键要点总结

1. **检索是逐层进行的**：L2 → L1 → L0
2. **每一层都使用引用路径**：childIds, parentIds
3. **相关性评分逐级提高阈值**：L2(0.3) → L1(0.5) → L0(0.7)
4. **支持懒加载优化**：不需要每次都检索到 L0
5. **完整的引用路径**：每个结果都包含 parent 和 siblings
