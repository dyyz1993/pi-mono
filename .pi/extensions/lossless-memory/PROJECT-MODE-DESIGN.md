# Lossless Memory - 项目维度重构方案

## 当前问题

- ❌ 数据库全局共享，所有项目数据混在一起
- ❌ 无法按项目筛选 DAG 节点
- ❌ Dashboard 显示混乱

## 重构方案

### 1. Session ID 规范化

**当前**: `test-session-1234567890` (时间戳)  
**改为**: `{project-path-hash}-{timestamp}`

```
示例:
- pi-mono-a1b2c3-1774083509
- my-project-d4e5f6-1774083600
```

### 2. 项目元数据表

```sql
CREATE TABLE projects (
  project_path TEXT PRIMARY KEY,      -- 项目绝对路径
  project_name TEXT NOT NULL,         -- 项目名称 (最后一级目录)
  first_seen INTEGER NOT NULL,        -- 首次使用时间
  last_seen INTEGER NOT NULL,         -- 最后使用时间
  session_count INTEGER DEFAULT 0,    -- 会话数
  node_count INTEGER DEFAULT 0,       -- DAG 节点数
  total_tokens INTEGER DEFAULT 0      -- 总 Token
);
```

### 3. 扩展增强

在 `src/index.ts` 中添加：

```typescript
// 每次会话开始时，识别当前项目
pi.on("session_start", async (_event, ctx) => {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const projectHash = hash(cwd);
  
  // 生成项目维度的 session ID
  const sessionId = `${projectName}-${projectHash}-${Date.now()}`;
  
  // 记录项目元数据
  await recordProject(projectName, cwd);
});
```

### 4. Dashboard 改进

- **项目选择器** - 顶部下拉框选择项目
- **项目统计** - 每个项目的独立统计
- **DAG 过滤** - 只显示选中项目的节点
- **项目切换** - API 支持 `?project=pi-mono` 参数

### 5. API 改造

```javascript
// 当前
GET /api/data
GET /api/nodes

// 改造后
GET /api/data?project=pi-mono
GET /api/projects           // 获取所有项目列表
GET /api/projects/:name     // 获取特定项目数据
```

## 实现优先级

1. **高** - 添加 projects 表，记录项目元数据
2. **高** - 规范 session_id 格式（包含项目信息）
3. **中** - Dashboard 添加项目选择器
4. **中** - API 支持项目过滤
5. **低** - 项目间数据迁移工具

## 预期效果

```
Dashboard v5 - 项目维度

┌────────────────────────────────────────┐
│ 🧠 Lossless Memory Dashboard           │
├────────────────────────────────────────┤
│ 📁 项目：[pi-mono ▼]  [my-app ▼]  [+]  │
├────────────────────────────────────────┤
│ 📊 pi-mono                              │
│ ├─ 5 节点                               │
│ ├─ 12 会话                              │
│ └─ 15,234 tokens                        │
├────────────────────────────────────────┤
│ 🎨 DAG 图谱 (仅显示 pi-mono)            │
│ [L2] ──→ [L1] [L1]                     │
└────────────────────────────────────────┘
```
