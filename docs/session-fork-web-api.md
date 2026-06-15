# Session Fork API — Web UI 集成文档

## 概述

Session Fork 提供两种模式：
- **Copy Fork**：只创建分支副本，不切换当前会话（Web UI 推荐）
- **Switch Fork**：创建分支并切换到新会话（TUI 模式使用）

## 前置条件

```typescript
import { SessionManager } from "@dyyz1993/pi-coding-agent";
// 或
import { SessionManager } from "./path/to/session-manager.ts";
```

---

## API 参考

### 1. 获取可 Fork 的消息列表

在 fork 之前，需要知道哪些消息可以被选为分支点。

```typescript
// 通过 AgentSession 实例
const messages = agentSession.getUserMessagesForForking();
// 返回: Array<{ entryId: string; text: string }>
// 示例:
// [
//   { entryId: "msg_001", text: "帮我重构这个函数" },
//   { entryId: "msg_002", text: "再优化一下性能" },
//   { entryId: "msg_003", text: "添加单元测试" },
// ]
```

**注意：** 只有 `role: "user"` 的消息才能作为分支点。

### 2. copyBranchedSession（推荐 Web UI 使用）

创建分支副本文件，**不修改当前 SessionManager 状态**。

```typescript
sessionManager.copyBranchedSession(
  leafId: string,
  options?: { compact?: boolean }
): string | undefined
```

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `leafId` | `string` | 是 | 分支点的 entry ID（从 `getUserMessagesForForking` 获取） |
| `options.compact` | `boolean` | 否 | `true` = 只拷贝最近压缩点之后的内容 |

**返回值：**
- 成功：新 session JSONL 文件的绝对路径
- 内存模式（非持久化）：`undefined`

**行为：**
- 当前会话**完全不受影响**
- 新文件是独立的 JSONL，包含从根到 fork 点的对话历史
- 可以在任意时刻通过 `/sessions` 或 `SessionManager.open()` 加载

### 3. createBranchedSession（TUI 使用，Web UI 一般不用）

创建分支并**切换当前会话到新分支**。

```typescript
sessionManager.createBranchedSession(
  leafId: string,
  options?: { compact?: boolean }
): string | undefined
```

**行为与 copyBranchedSession 相同，但额外：**
- 修改当前 `SessionManager` 的 `sessionId`、`sessionFile`、`fileEntries`
- 旧会话被持久化到磁盘（不删除），但内存状态被替换
- **Web UI 通常不应使用此方法**，除非你需要 TUI 式的"切换"行为

### 4. getBranch

获取从根到指定 entry 的完整路径。

```typescript
sessionManager.getBranch(fromId?: string): SessionEntry[]
```

**参数：** `fromId` 省略时使用当前 leaf。

### 5. appendCompaction

手动插入压缩摘要（测试或高级用途）。

```typescript
sessionManager.appendCompaction(
  summary: string,
  firstKeptEntryId: string,
  tokensBefore: number,
  details?: T,
  fromHook?: boolean
): string
```

---

## compact 选项详解

### 什么是 compact？

`compact: true` 只拷贝 **LLM 在 fork 点实际看到的上下文**，丢弃已被压缩的旧消息。

### 工作原理

```
完整会话：
  [msg1] → [msg2] → [msg3] → [compaction: "摘要1"] → [msg4] → [msg5] → [compaction: "摘要2"] → [msg6]

fork msg6 时：
  getBranch(msg6) = [msg1, msg2, msg3, compaction1, msg4, msg5, compaction2, msg6]

  compact=false（默认）: 拷贝全部 [msg1...msg6]
  compact=true:          只拷贝 [compaction2, msg6]
                          ↑ 从 fork 点往回找最近的 compaction
```

### 多次压缩场景

```
会话：msg1 → compaction1 → msg2 → compaction2 → msg3

fork msg2 时（compact=true）：
  → 从 msg2 往回找最近的 compaction → compaction1
  → 拷贝 [compaction1, msg2]
  → msg1 被丢弃（已包含在 compaction1 的摘要中）

fork msg3 时（compact=true）：
  → 从 msg3 往回找最近的 compaction → compaction2
  → 拷贝 [compaction2, msg3]
  → msg1, msg2, compaction1 被丢弃
```

### 何时使用 compact

| 场景 | compact | 原因 |
|------|---------|------|
| Web UI 分支面板 | `true` | 节省空间，LLM 看到的上下文不变 |
| 完整历史备份 | `false` | 保留所有原始消息 |
| 审计/回溯 | `false` | 需要完整历史记录 |
| 导出给用户 | 看需求 | 用户是否需要查看早期原始对话 |

---

## Web UI 集成步骤

### Step 1: 展示可 fork 的消息列表

```typescript
// 获取当前会话的用户消息列表
const forkPoints = agentSession.getUserMessagesForForking();

// 在 UI 上展示为可点击的分支点
forkPoints.forEach(({ entryId, text }) => {
  renderForkButton(entryId, text);
});
```

### Step 2: 用户选择 fork 点后创建副本

```typescript
async function handleFork(entryId: string, useCompact: boolean) {
  const newPath = sessionManager.copyBranchedSession(entryId, {
    compact: useCompact,
  });

  if (!newPath) {
    // 内存模式无法创建副本
    return;
  }

  // newPath 是新 JSONL 文件的路径
  // 可以存入数据库或返回给前端
  return newPath;
}
```

### Step 3: 加载 fork 出来的会话

```typescript
// 方式 A：在同一进程中打开（需要 SessionManager）
const forkedSession = SessionManager.open(newPath);

// 方式 B：启动新进程处理 fork 会话（推荐 Web UI）
// 将 newPath 传给新进程的 SessionManager
```

### Step 4: 前端展示分支图

```typescript
// 获取会话树结构
const tree = sessionManager.getTree();

// 获取某个分支的完整消息
const branch = sessionManager.getBranch(entryId);

// 渲染为 git graph 样式的分支可视化
```

---

## JSONL 文件格式

fork 创建的新文件是标准 JSONL 格式：

```jsonl
{"type":"session","version":1,"id":"new-session-id","timestamp":"...","cwd":"/project","parentSession":"/path/to/parent.jsonl"}
{"type":"message","id":"msg1","parentId":null,"timestamp":"...","message":{"role":"user","content":[...]}}
{"type":"message","id":"msg2","parentId":"msg1","timestamp":"...","message":{"role":"assistant","content":[...]}}
{"type":"compaction","id":"comp1","parentId":"msg2","summary":"摘要内容","tokensBefore":5000}
{"type":"message","id":"msg3","parentId":"comp1","timestamp":"...","message":{"role":"user","content":[...]}}
```

**关键字段：**
- `parentSession`：指向原始会话文件（仅 fork 创建的会话有此字段）
- `parentId`：树结构的父节点 ID
- `compaction` 类型的 entry 包含 `summary` 字段（压缩摘要）

---

## 注意事项和常见歧义

### 1. entryId vs 消息序号

```typescript
// ❌ 错误：不能用数组索引
const thirdMessage = forkPoints[2];

// ✅ 正确：用 entryId
const target = forkPoints.find(m => m.text.includes("重构"));
sessionManager.copyBranchedSession(target.entryId);
```

**原因：** entryId 是唯一标识，数组索引会因为过滤（label 等非消息 entry 被排除）而不连续。

### 2. compact 截断方向

compact 从 **fork 点往回找最近的 compaction**，不是从根节点开始找。

```
[compaction1] → [msg A] → [compaction2] → [msg B]

fork msg B（compact=true）→ 截断在 compaction2 ✓
                          → 不是 compaction1 ✗
```

### 3. 没有 compaction 时的行为

如果 fork 点之前没有任何 compaction entry，`compact: true` **不做任何截断**，等价于 `compact: false`。

### 4. 内存模式

`SessionManager` 可以在内存模式运行（不持久化到磁盘）。此时 `copyBranchedSession` 返回 `undefined`。Web UI 通常使用持久化模式，不受影响。

### 5. 并发安全

`copyBranchedSession` 只读取当前状态并写入新文件，**不修改当前状态**，是并发安全的。多个 fork 请求可以并行执行。

但 `createBranchedSession` 会修改当前状态，**不是并发安全的**。

### 6. fork 出的会话与原会话的关系

fork 创建的新会话通过 `parentSession` 字段记录了来源，但两者完全独立：
- 修改原会话不影响 fork
- 修改 fork 不影响原会话
- 没有自动同步机制

---

## 完整示例

```typescript
import { SessionManager } from "@dyyz1993/pi-coding-agent";

// 假设已有活跃会话
const session: AgentSession = getActiveSession();
const sessionManager = session.sessionManager;

// 1. 获取可 fork 的消息
const forkPoints = session.getUserMessagesForForking();
// → [{ entryId: "e1", text: "分析代码" }, { entryId: "e2", text: "修复 bug" }]

// 2. 用户选择 fork "修复 bug" 这个节点
const targetEntryId = forkPoints[1]!.entryId;

// 3. 创建副本（compact 模式，节省空间）
const forkedPath = sessionManager.copyBranchedSession(targetEntryId, {
  compact: true,
});

// 4. forkedPath = "/home/user/.pi/agent/sessions/.../2026-06-13_abc.jsonl"
// 可以将此路径存入数据库，后续通过 SessionManager.open() 加载

// 5. 原会话不受影响，继续正常使用
session.prompt("继续开发...");
```
