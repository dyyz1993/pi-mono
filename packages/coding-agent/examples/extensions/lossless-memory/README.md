# Lossless Memory Extension for Pi

基于 DAG（有向无环图）分层摘要系统的无损记忆管理扩展，灵感来自 Lossless Claw。

## 功能特性

### 核心功能

- **无损存储**: 所有原始消息永久保存于 SQLite 数据库
- **智能压缩**: DAG 分层摘要系统（L1-L4），自动压缩旧消息
- **全文检索**: FTS5 搜索引擎，支持关键词和相关性排序
- **精准追溯**: 沿 DAG 链路展开摘要，恢复原始消息详情
- **上下文优化**: 动态装配"最近原文 + 必要摘要"，控制在 token 限制内

### 工具

| 工具名 | 功能 | 示例 |
|--------|------|------|
| `pi_memory_search` | 关键词搜索历史消息 | 查找特定指令、代码片段 |
| `pi_memory_expand` | 展开摘要节点为原始消息 | 查看某个决策的完整上下文 |
| `pi_memory_stats` | 查看记忆 DAG 统计信息 | 监控压缩效果 |

### 命令

| 命令 | 功能 |
|------|------|
| `/memory-search <关键词>` | 快速搜索记忆 |
| `/memory-stats` | 查看统计信息 |
| `/memory-clear` | 清除当前会话记忆数据 |

---

## 安装

### 1. 复制扩展

```bash
# 全局安装（所有项目可用）
cp -r packages/coding-agent/examples/extensions/lossless-memory \
    ~/.pi/agent/extensions/lossless-memory

# 或项目本地安装
cp -r packages/coding-agent/examples/extensions/lossless-memory \
    .pi/extensions/lossless-memory
```

### 2. 安装依赖

```bash
cd ~/.pi/agent/extensions/lossless-memory
npm install
```

### 3. 验证安装

启动 pi，看到以下提示表示安装成功：

```
Lossless Memory 已加载
```

状态栏显示：
```
记忆：就绪
```

---

## 配置

在 `~/.pi/agent/settings.json` 中添加：

```json
{
  "losslessMemory": {
    "enabled": true,
    "database": {
      "path": "~/.pi/agent/lossless-memory.db",
      "enableFTS5": true,
      "enableVectors": false
    },
    "summary": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "maxTokens": 300,
      "compressionRatio": 8
    },
    "search": {
      "keywordWeight": 0.7,
      "semanticWeight": 0.3,
      "defaultLimit": 5
    },
    "performance": {
      "cacheEmbeddings": true,
      "batchSize": 32,
      "lazyLoad": true
    }
  }
}
```

### 配置选项说明

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 启用/禁用扩展 |
| `database.path` | string | `~/.pi/agent/lossless-memory.db` | SQLite 数据库路径 |
| `database.enableFTS5` | boolean | `true` | 启用 FTS5 全文搜索 |
| `database.enableVectors` | boolean | `false` | 启用向量搜索（实验性） |
| `summary.provider` | string | `"openai"` | 摘要模型提供商 |
| `summary.model` | string | `"gpt-4o-mini"` | 摘要模型 |
| `summary.maxTokens` | number | `300` | 摘要最大 token 数 |
| `summary.compressionRatio` | number | `8` | 压缩比例（8 条消息→1 摘要） |

---

## 使用指南

### 1. 自动压缩

当对话接近 token 上限时，扩展自动触发压缩：

```
用户：继续之前的工作...

[系统检测到上下文过多]
→ 自动生成 L1 摘要（8 条消息→1 摘要）
→ 创建 DAG 节点并保存
→ 用摘要替换旧消息
```

### 2. 搜索记忆

使用工具搜索：

```
/工具：pi_memory_search
参数：
  query: "API 认证"
  maxResults: 5
```

或使用命令快速搜索：

```
/memory-search API 认证
```

### 3. 展开摘要

查看摘要的原始消息：

```
/工具：pi_memory_expand
参数：
  nodeId: "abc123..."
  maxDepth: 5
  maxTokens: 2000
```

### 4. 查看统计

```
/memory-stats
```

输出示例：
```
记忆统计:
节点数：42
最大层级：L3
根节点：2
总 Token: 12500
条目覆盖：156
```

---

## 工作原理

### DAG 分层结构

```
层级 L4 (顶层摘要)
├─ 层级 L3 (高层摘要)
│  ├─ 层级 L2 (中层摘要)
│  │  ├─ 层级 L1 (基础摘要，每 8 条消息)
│  │  │  ├─ 原始消息 1-8
│  │  │  └─ 原始消息 9-16
│  │  └─ 层级 L1 (基础摘要)
│  │     └─ 原始消息 17-24
│  └─ 层级 L2 (中层摘要)
└─ 层级 L3 (高层摘要)
```

### 压缩流程

1. **检测**: 当消息数达到压缩阈值（默认 8 条）
2. **提取**: 提取最早的 N 条消息
3. **摘要**: 调用 LLM 生成摘要
4. **存储**: 创建 DAG 节点，保存到 SQLite
5. **链接**: 建立父子节点关系
6. **替换**: 用摘要替换原始消息

### 检索流程

1. **关键词搜索**: FTS5 全文搜索，BM25 评分
2. **语义搜索**（可选）: 向量相似度计算
3. **合并排序**: 加权合并两种结果
4. **返回摘要**: 返回相关摘要节点
5. **追溯原文**: 通过 `pi_memory_expand` 展开

---

## 技术架构

```
┌─────────────────────────────────────────┐
│           Pi Coding Agent               │
├─────────────────────────────────────────┤
│  扩展系统 (ExtensionAPI)                │
├─────────────────────────────────────────┤
│  Lossless Memory Extension              │
│  ├─ index.ts (主入口 + 事件处理)        │
│  ├─ database.ts (SQLite + FTS5)         │
│  ├─ dag-manager.ts (DAG 节点管理)        │
│  ├─ summary-generator.ts (LLM 摘要)      │
│  ├─ search-tool.ts (搜索工具)           │
│  ├─ expand-tool.ts (展开工具)           │
│  └─ types.ts (类型定义)                 │
├─────────────────────────────────────────┤
│  SQLite Database                        │
│  ├─ memory_nodes (DAG 节点)              │
│  ├─ memory_fts (FTS5 索引)               │
│  ├─ memory_embeddings (向量数据)        │
│  └─ session_index (会话索引)            │
└─────────────────────────────────────────┘
```

---

## 文件结构

```
lossless-memory/
├── package.json              # 包配置和依赖
├── README.md                 # 本文档
└── src/
    ├── index.ts              # 扩展主入口
    ├── types.ts              # 类型定义
    ├── database.ts           # SQLite 数据库层
    ├── dag-manager.ts        # DAG 节点管理
    ├── summary-generator.ts  # 摘要生成器
    ├── search-tool.ts        # 搜索工具
    ├── expand-tool.ts        # 展开工具
    └── better-sqlite3.d.ts   # 类型声明
```

---

## 成本估算

假设每天 100 条消息，每条平均 200 tokens：

```
摘要生成：
- L1 摘要：100/8 = 12.5 个/天
- 每个 L1 摘要成本：200 tokens × $0.00015/1K = $0.00003
- 每天摘要成本：12.5 × $0.00003 = $0.000375
- 每月摘要成本：~$0.01

存储成本：
- SQLite 数据库：~10MB/月 (免费)

总成本：< $0.50/月
```

---

## 故障排查

### 扩展未加载

检查启动日志：

```bash
pi --verbose
```

查看是否有错误信息。

### 数据库错误

```bash
# 删除数据库重新初始化
rm ~/.pi/agent/lossless-memory.db
```

### 搜索不到结果

确保 FTS5 已启用：

```bash
sqlite3 ~/.pi/agent/lossless-memory.db "SELECT * FROM memory_fts LIMIT 5;"
```

### 摘要未生成

检查 LLM API 配置是否正确，查看日志：

```bash
# 查看详细日志
pi --verbose
```

---

## 开发指南

### 本地开发

```bash
# 1. 克隆仓库
cd packages/coding-agent/examples/extensions/lossless-memory

# 2. 安装依赖
npm install

# 3. 测试扩展
pi -e ./src/index.ts

# 4. 热重载
/reload
```

### 添加新功能

1. 在 `src/` 下创建新模块
2. 在 `index.ts` 中导入并注册
3. 测试功能
4. 更新文档

### 调试技巧

```typescript
// 添加日志输出
console.log("[LosslessMemory] 调试信息:", data);

// 使用 UI 通知
ctx.ui.notify("调试信息", "info");

// 设置状态栏
ctx.ui.setStatus("lossless-memory", "调试中...");
```

---

## 与 Lossless Claw 的对比

| 特性 | Lossless Claw (OpenClaw) | Lossless Memory (Pi) |
|------|-------------------------|---------------------|
| 存储 | 独立 SQLite | SQLite + 会话 JSONL |
| 检索 | FTS5 | FTS5 + 可选向量 |
| 压缩触发 | 接近 token 上限 | `session_before_compact` |
| 上下文装配 | 动态查询 | `context` 事件 |
| 安装 | npm 包 | 扩展文件 |

---

## 许可证

MIT

## 致谢

灵感来自 [Lossless Claw](https://github.com/Martian-Engineering/lossless-claw)

---

## 更新日志

### v0.1.0 (2026-03-20)
- 初始版本
- SQLite 数据库 + FTS5 搜索
- DAG 分层摘要管理
- 搜索和展开工具
- 自动压缩和上下文优化
