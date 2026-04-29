# File Version Rollback — 设计文档

## 1. 背景与目标

pi-momo-fork 的 session 是 append-only JSONL 树结构。用户通过 `/tree` 回滚消息（移动 leaf 指针）或 `/fork` 创建新 session。但 **文件系统不跟着回滚**，导致消息说"创建了 foo.ts"，磁盘上却可能是更新后的版本。

本功能目标：**让文件变更可追踪、可恢复**，在回滚消息时提供选项让用户决定是否同时恢复文件。

## 2. 核心概念

### 2.1 两种操作的区别

| | Tree（回滚） | Fork（分叉） |
|---|---|---|
| 命令 | `/tree` | `/fork` |
| 触发事件 | `session_before_tree` → `session_tree` | `session_before_fork` |
| session | 同一个，不变 | 创建新的 |
| InternalGit store | 同一个 | 新建，复制父历史 |
| 磁盘操作 | **可能需要恢复文件** | 不修改文件 |
| commit 历史 | append 新的回滚 commit | 复制父的（到 fork 点） |
| 冲突风险 | 高（要覆盖磁盘文件） | 无 |

### 2.2 InternalGit 存储结构

```
~/.pi/agent/file-store/<sessionId>/
├── objects/           # 内容寻址存储（按 hash）
│   ├── a1/
│   │   └── b2c3d4e5  # 文件内容
│   └── f0/
│       └── 9e8d7c6b  # tree 数据
└── commits.jsonl      # append-only commit 日志
```

### 2.3 Commit 结构

```typescript
interface FileCommit {
  id: string;
  parentCommitId: string | null;
  sessionId: string;
  sessionEntryId: string;  // 关联到 session tree 的 entry
  turnIndex: number;
  treeHash: string;        // 该时刻的完整文件树 hash
  diff: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
  timestamp: string;
}
```

### 2.4 快照采集时机

```
turn_start → 清空 turnFiles
tool_call  → 记录文件"修改前"内容（edit/write）
tool_result → 记录文件"修改后"内容（write/edit/bash）
turn_end   → 批量提交：计算 diff → appendCommit → pi.appendEntry()
```

## 3. Tree 回滚 — 文件恢复流程

### 3.1 用户交互（三选一）

当用户通过 `/tree` 回滚到某个 entry 时，弹窗提供三个选项：

```
检测到 N 个文件在回滚点之后发生了变更：
- foo.ts (modified)
- bar.ts (added)
- baz.ts (deleted)

选择操作：
[1. 消息 + 文件一起回滚]  ← 消息回退 + 磁盘文件恢复
[2. 只回滚消息]           ← 仅移动 leaf，文件不动
[3. 压缩到该节点]         ← compact 功能，独立处理
```

### 3.2 文件恢复的内部流程

```
session_before_tree 触发
  → preparation.targetId = 目标 entryId
  → preparation.oldLeafId = 当前 leaf entryId

1. 查找 commit
   targetCommit = findCommitByEntryId(sessionId, targetId)
   currentCommit = findCommitByEntryId(sessionId, oldLeafId)

   如果 targetCommit 或 currentCommit 不存在 → 无快照数据，跳过文件恢复

2. 恢复两棵树
   targetTree = restoreTree(targetCommit.treeHash)  → 目标状态
   currentTree = restoreTree(currentCommit.treeHash) → 当前状态

3. 计算恢复 diff
   diff = computeDiff(currentTree, targetTree)
   → 需要告诉用户哪些文件会变

4. 冲突检测
   对于 diff 中涉及的每个文件：
   - 读磁盘内容 → hash
   - 与 currentTree 中记录的 hash 对比
   - 不一致 → 标记为 "dirty"（被外部修改过）

5. 用户选择
   选项 1（消息+文件回滚）：
     - clean 文件：直接恢复
     - dirty 文件：二次确认（强制恢复 / 跳过 / 取消）
     - 执行磁盘写回/删除
     - 追加回滚 commit（append-only）
   选项 2（只回滚消息）：
     - 不动文件，直接 return
   选项 3（压缩）：
     - 不动文件，触发 compact 逻辑（独立功能）

6. session_tree 触发（导航完成后）
   - leaf 已经移动到新位置
   - 后续 turn 从新 leaf 继续追踪
```

### 3.3 回滚 commit 是追加的

回滚操作本身产生一个新 commit，不删除任何旧 commit：

```jsonl
{"id":"c001","treeHash":"h1","sessionEntryId":"e1",...}
{"id":"c002","treeHash":"h2","sessionEntryId":"e3",...}
{"id":"c003","treeHash":"h3","sessionEntryId":"e5",...}
{"id":"c-rollback-1","parentCommitId":"c003","treeHash":"h1","turnIndex":-1,...}
```

## 4. Fork — session 继承

### 4.1 流程

```
session_before_fork 触发
  → event.entryId = fork 点的 entryId

1. 创建 session-B 的 InternalGit store
   childGit = InternalGit.create(storeRoot, sessionBId)

2. 复制 commit 历史（到 fork 点为止）
   parentCommits = readCommits().filter(c => sessionId === parentId && c.sessionEntryId <= forkEntryId)
   for each commit → childGit.appendCommit(commit)

3. objects 目录处理
   方案：在 fork 时把需要的 object 文件 hard link 过去
   （hash 相同 → 内容相同 → 硬链接省空间，修改时 copy-on-write 自然隔离）

4. 文件不动
   fork 时磁盘文件就是当前状态，不需要修改
```

## 5. Bash 工具盲区

### 5.1 问题

LLM 通过 bash 工具执行 `sed -i`、`npm install` 等操作时：
- `toolName` 是 `"bash"`，没有 `input.path`
- 无法从事件中提取具体改了哪些文件

### 5.2 方案：turn_start 全量快照 + turn_end 对比

```
turn_start:
  → 扫描所有已追踪文件 → 记录 { path: hash } 作为 baseline

turn_end:
  → 再次扫描已追踪文件 → 计算与 baseline 的 diff
  → 如果有变更，追加 commit
```

不追踪新文件（因为不知道 bash 创建了什么文件），但能检测到已追踪文件被 bash 修改。

### 5.3 未来优化（可选）

- 集成 `git stash create` 作为完整快照兜底
- 通过 `fs.watch` 实时监控文件变更
- 在 bash 工具返回后解析 diff

## 6. 测试场景

### 6.1 Tree 回滚文件恢复（P0 — 最高优先级）

| # | 场景 | 预期 |
|---|------|------|
| T1 | 回滚到早期 entry，被追踪的文件恢复到旧版本 | `foo.ts` 从 v2 → v1 |
| T2 | 回滚后，fork 点之后新增的文件被删除 | `bar.ts`（在 e3 新增）回滚到 e1 时被删除 |
| T3 | 回滚时，不在追踪范围内的文件不受影响 | `untracked.ts` 不被触碰 |
| T4 | 回滚产生 append-only 的 rollback commit | 旧 commit 不变，新增 rollback commit |
| T5 | 无快照数据的 entry 回滚时不崩溃 | 找不到 commit → 跳过文件恢复 |

### 6.2 冲突检测（P0）

| # | 场景 | 预期 |
|---|------|------|
| C1 | 回滚时文件被外部编辑器修改 → 检测到 dirty | 标记 dirty，提示用户 |
| C2 | dirty 文件用户选择"跳过" → 该文件不恢复 | 其他文件恢复，dirty 的不动 |
| C3 | dirty 文件用户选择"强制恢复" → 覆盖写入 | 写回旧版本 |
| C4 | 所有文件都是 dirty → 用户取消 → 全部不恢复 | 磁盘不变 |

### 6.3 用户交互三选一（P0）

| # | 场景 | 预期 |
|---|------|------|
| U1 | 选择"只回滚消息" → 文件不变 | leaf 移动，磁盘不动 |
| U2 | 选择"消息+文件回滚" → 文件恢复 | leaf 移动 + 磁盘恢复 |
| U3 | 无文件变更的回滚 → 不弹窗 | diff 为空，跳过提示 |

### 6.4 Fork 继承（P1）

| # | 场景 | 预期 |
|---|------|------|
| F1 | Fork 后子 session 有父的 commit 历史（到 fork 点） | childStore.readCommits() 包含父的 commit |
| F2 | 子 session 新增 commit 不影响父 session | 父 store 不变 |
| F3 | 子 session 能 restoreTree 到父的任意历史 commit | 恢复正确 |
| F4 | Fork 时不修改磁盘文件 | 磁盘不变 |

### 6.5 Bash 盲区（P1）

| # | 场景 | 预期 |
|---|------|------|
| B1 | 已追踪文件被 bash `sed -i` 修改 → turn_end 检测到变更 | diff 包含该文件 |
| B2 | 已追踪文件被 bash 删除 → turn_end 检测到删除 | diff.deleted 包含该文件 |
| B3 | bash 创建新文件 → 不在追踪范围内 | 不追踪（符合预期） |

### 6.6 快照采集（已实现，补充边界场景）

| # | 场景 | 预期 |
|---|------|------|
| S1 | 空 turn（无文件变更）→ 不产生 commit | readCommits() 不增加 |
| S2 | 同一文件同一 turn 内多次 edit → 只取最终状态 | commit 里是最终内容 |
| S3 | write 创建新文件 → tool_call 时文件不存在 | before=null，after=内容 |
| S4 | edit 修改已存在文件 → tool_call 时读到旧内容 | before=旧内容，after=新内容 |

### 6.7 持久化与恢复（已实现，补充场景）

| # | 场景 | 预期 |
|---|------|------|
| P1 | session resume → 从 custom entries 重建快照索引 | snapshotsByEntry 恢复 |
| P2 | session reload → InternalGit store 从磁盘恢复 | commits/objects 完整 |

## 7. 任务拆分

### Task 1: 修正 file-snapshot 扩展事件绑定
- 把文件恢复逻辑从 `session_before_fork` 移到 `session_before_tree`
- 重写 `session_before_fork` 只做 store 继承
- 修改 `examples/extensions/file-snapshot.ts`

### Task 2: Tree 回滚文件恢复 — 测试 + 实现（TDD）
- 写测试：T1-T5, C1-C4, U1-U3
- 实现 `session_before_tree` handler
- 实现冲突检测 + 用户交互
- 运行测试直到全绿

### Task 3: Fork 继承 — 测试 + 实现（TDD）
- 写测试：F1-F4
- 实现 `session_before_fork` handler（store 复制 + object 继承）
- 运行测试直到全绿

### Task 4: Bash 盲区兜底 — 测试 + 实现（TDD）
- 写测试：B1-B3
- 实现 turn_start baseline + turn_end diff
- 运行测试直到全绿

### Task 5: 边界场景补充
- 写测试：S1-S4, P1-P2
- 补充实现
- 全量测试通过

### Task 6: 集成验证 + npm run check
- 所有测试文件一起跑
- `npm run check` 通过
- biome lint 无新增 warning

## 8. 文件清单

| 文件 | 作用 | 状态 |
|------|------|------|
| `src/core/file-store/internal-git.ts` | InternalGit 类（对象存储/commit/tree/diff） | ✅ 已实现，37 测试通过 |
| `examples/extensions/file-snapshot.ts` | 文件快照扩展 | ⚠️ 需修正事件绑定 |
| `test/file-store/internal-git.test.ts` | InternalGit 单元测试 | ✅ 37 测试通过 |
| `test/suite/file-snapshot-extension.test.ts` | 扩展集成测试 | ✅ 8 测试通过，需补充新场景 |
