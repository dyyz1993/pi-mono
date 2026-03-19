# Session Undo/Redo Extension

支持撤销、重做、回滚和分享功能的扩展，使用 Git 进行高效的文件版本管理。

## 功能

| 命令 | 功能 | Git 模式 | 非 Git 模式 |
|------|------|---------|-----------|
| `/undo` | 撤销上一次的文件修改 | ✅ 完全支持 | ⚠️ 有限支持 |
| `/redo` | 重做已撤销的修改 | ✅ 完全支持 | ⚠️ 有限支持 |
| `/rollback <entry-id>` | 回滚到指定对话节点 | ✅ 完全支持 | ❌ 不支持 |
| `/share` | 导出会话和文件变更摘要 | ✅ 完整导出 | ⚠️ 基础导出 |

## 工作原理

### Git 模式（推荐）

```
对话流程：
┌─────────────────────────────────────────────────────────┐
│ Turn 1: 用户"帮我修改 auth.ts"                           │
│  → 修改了 auth.ts, utils.ts                             │
│  → Git Commit: abc123                                   │
│  → Snapshot: { entryId: "a1b2", commit: "abc123" }      │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Turn 2: 用户"有 bug，回滚"                                │
│  → /undo                                                │
│  → Git Reset: HEAD~1                                    │
│  → 文件恢复到 abc123 的状态                              │
└─────────────────────────────────────────────────────────┘
```

**关键机制：**
1. **不存储文件副本** - 只记录 Git Commit Hash
2. **使用 Git 原生功能** - `git reset --hard`, `git diff`
3. **元数据极小** - 每个 snapshot 约 200-500 字节
4. **完整历史追溯** - 可以回滚到任何对话节点

### 非 Git 模式

```
对话流程：
┌─────────────────────────────────────────────────────────┐
│ Turn 1: 用户"帮我修改 auth.ts"                           │
│  → 捕获 diff: -old code +new code                       │
│  → Snapshot: { entryId: "a1b2", diff: "--- auth.ts..." }│
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Turn 2: 用户"有 bug，回滚"                                │
│  → /undo                                                │
│  → patch -R < diff (反向应用)                           │
│  → 文件恢复到之前的状态                                  │
└─────────────────────────────────────────────────────────┘
```

**限制：**
- 只记录差异，不保存完整文件
- 对于大文件变更可能失败
- 不支持跨文件依赖的回滚
- **强烈建议在 Git 项目中使用**

## 安装使用

### 方式 1: 全局安装
```bash
cp session-undo.ts ~/.pi/agent/extensions/
pi /reload
```

### 方式 2: 项目级安装
```bash
cp session-undo.ts .pi/extensions/
pi /reload
```

### 前提条件

**Git 模式（推荐）：**
```bash
git init  # 如果不是 git 仓库
git add .
git commit -m "Initial commit"  # 需要至少一个 commit
```

**非 Git 模式：**
```bash
# 无需特殊配置，但功能有限
```

## 使用示例

### 示例 1: 基本撤销

```bash
# 让 AI 修改代码
pi "帮我重构用户认证模块"

# 发现有问题，撤销
pi /undo
# → 确认：This will revert 3 file change(s).
# → Undo successful

# 如果改变主意，可以重做
pi /redo
# → Redo successful
```

### 示例 2: 回滚到特定节点

```bash
# 查看历史节点
pi /tree
# → 显示所有对话节点的树形结构
# → 选择一个节点，记录 entryId (如：a1b2c3d4)

# 回滚到该节点
pi /rollback a1b2c3d4
# → 确认：Entry: a1b2c3d4, Time: 2024-12-03 14:30, Files: 5
# → 回滚成功，同时切换到该对话节点
```

### 示例 3: 分享会话

```bash
# 导出会话和文件变更
pi /share
# → 输入导出路径：session-export.md
# → Exported to /path/to/project/session-export.md

# 导出的内容包含：
# - 会话元数据
# - 文件变更统计
# - Git 状态
# - 可选：完整 diff
```

## 存储机制

### Session JSONL 中的存储

```json
{"type":"custom","customType":"session-undo-state","data":{
  "history": [
    {
      "entryId": "a1b2c3d4",
      "timestamp": 1701609000000,
      "changes": [
        {
          "path": "src/auth.ts",
          "action": "modified",
          "gitCommit": "abc123def456"
        }
      ],
      "gitBranch": "main",
      "gitCommit": "abc123def456"
    }
  ],
  "undoStack": [],
  "currentTurnIndex": 0
}}
```

**空间占用：**
- 每个 turn: 200-500 字节（只存 hash，不存文件内容）
- 100 个 turn: 约 20-50 KB
- 1000 个 turn: 约 200-500 KB

### Git 仓库中的存储

```
.git/
  ├── objects/        # Git 对象（文件内容）
  ├── refs/           # 分支和标签
  └── logs/           # 操作日志
```

**注意：** 扩展本身不创建额外的 Git 对象，使用现有的 Git 历史。

## 与其他扩展的兼容

### ✅ 兼容
- Git Checkpoint 扩展
- File Watcher 扩展
- Dynamic Context 扩展

### ⚠️ 注意事项
- 如果同时使用多个 Git 相关扩展，避免重复创建 commit
- `/share` 可能与其他导出功能冲突

## 高级配置

### 跳过某些文件的跟踪

修改扩展代码，添加过滤：

```typescript
const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/*.log",
  "**/package-lock.json",
];

// 在 captureTurnSnapshot 中添加过滤
const changes = allChanges.filter((change) => {
  return !IGNORE_PATTERNS.some((pattern) => 
    minimatch(change.path, pattern)
  );
});
```

### 自动创建检查点

```typescript
// 在每个 turn_start 时自动创建 git checkpoint
pi.on("turn_start", async () => {
  await createGitCheckpoint(`Auto-checkpoint before turn`);
});
```

## 故障排除

### 问题 1: `/undo` 提示 "Nothing to undo"

**原因：** 没有捕获到文件变更

**解决：**
```bash
# 检查是否是 git 仓库
git status

# 如果不是，初始化
git init
git add .
git commit -m "Initial commit"
```

### 问题 2: `/rollback` 失败

**原因：** 非 Git 模式不支持回滚

**解决：**
```bash
# 转换为 Git 模式
git init
git add .
git commit -m "Initial commit"
```

### 问题 3: 撤销后文件损坏

**原因：** diff 应用失败

**解决：**
```bash
# 手动恢复
git checkout HEAD -- <file>

# 或者使用 /rollback 到更早的节点
pi /rollback <earlier-entry-id>
```

## 性能优化

### 大项目优化

对于大型项目（>1000 文件），建议：

1. **使用 .gitignore 排除无关文件**
```bash
# .gitignore
node_modules/
dist/
*.log
coverage/
```

2. **限制跟踪的文件数量**
```typescript
const MAX_TRACKED_FILES = 100;
const changes = allChanges.slice(0, MAX_TRACKED_FILES);
```

3. **使用增量快照**
```typescript
// 只记录相对上一个快照的变化
if (isGitRepo) {
  const prevCommit = state.history[state.currentTurnIndex]?.gitCommit;
  const diff = await pi.exec("git", ["diff", prevCommit, "HEAD"]);
}
```

## 未来计划

- [ ] 支持选择性撤销（只撤销某些文件）
- [ ] 支持分支合并
- [ ] 可视化 diff 查看器
- [ ] 自动冲突解决
- [ ] 云同步撤销历史

## 许可证

MIT
