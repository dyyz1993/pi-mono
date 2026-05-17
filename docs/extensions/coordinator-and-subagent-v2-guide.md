# Coordinator + Subagent-v2 Extension Guide

> Pi Agent 多会话协调与子任务委派实战指南

---

## 目录

1. [架构概览](#1-架构概览)
2. [Coordinator 扩展](#2-coordinator-扩展)
   - [核心概念](#21-核心概念)
   - [工具清单](#22-工具清单)
   - [Channel 通信协议](#23-channel-通信协议)
   - [任务状态机](#24-任务状态机)
   - [上下文注入机制](#25-上下文注入机制)
   - [实战流程](#26-实战流程)
3. [Subagent-v2 扩展](#3-subagent-v2-扩展)
   - [核心概念](#31-核心概念)
   - [工具清单](#32-工具清单)
   - [Agent 发现机制](#33-agent-发现机制)
   - [执行模式](#34-执行模式)
   - [超时与优雅退出](#35-超时与优雅退出)
   - [Session 持久化与恢复](#36-session-持久化与恢复)
   - [实战流程](#37-实战流程)
4. [两者对比与选择指南](#4-两者对比与选择指南)
5. [全局扩展部署规范](#5-全局扩展部署规范)
6. [故障排查](#6-故障排查)

---

## 1. 架构概览

```
┌──────────────────────────────────────────────────────────┐
│                     主 Session (pi)                       │
│                                                          │
│  ┌─────────────────┐     ┌──────────────────────────┐   │
│  │   Coordinator   │     │     Subagent-v2           │   │
│  │                 │     │                           │   │
│  │ 多会话协调器     │     │ 子任务委派器              │   │
│  │ - 任务追踪      │     │ - Agent 发现              │   │
│  │ - 双向通信      │     │ - 前台/后台执行            │   │
│  │ - 状态管理      │     │ - 超时控制                │   │
│  │ - 上下文注入    │     │ - Session 持久化          │   │
│  └────────┬────────┘     └────────────┬─────────────┘   │
│           │                           │                  │
│           │  Channel (coordinator)    │  Channel (subagent)
│           │                           │                  │
│  ─────────┼───────────────────────────┼────────────────  │
│           │     RpcClient (JSONL)      │                  │
│           ▼                           ▼                  │
│  ┌─────────────────┐     ┌──────────────────────────┐   │
│  │ 委派 Session A   │     │ 子 Agent (explore/plan)   │   │
│  │ (独立 pi 进程)   │     │ (独立 pi 进程, RPC 模式) │   │
│  └─────────────────┘     └──────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

**核心区别**:
- **Coordinator**: 管理"会话级"任务，主 session 通过 channel 与委派 session 双向通信
- **Subagent-v2**: 管理"Agent 级"任务，启动指定 agent profile 的独立进程执行特定任务

---

## 2. Coordinator 扩展

### 2.1 核心概念

Coordinator 是一个多会话协调器，它允许主 session 将任务委派给后台 session，并通过 typed channel 进行双向通信。

**关键特性**:
- 任务持久化（JSON 文件，session 级别）
- 双向消息传递（主 → 委派、委派 → 主）
- 自动重连（已停止的 session 收到消息时自动重启）
- 上下文自动注入（活跃任务信息注入 LLM 系统提示词）
- 完成信号检测（`[completed]`/`[done]`/`task completed`）
- 5 分钟自动过期（已停止/已完成的任务从上下文中清除）

**源码位置**: `packages/coding-agent/extensions/coordinator/`
- `index.ts` (330 行) — 扩展入口、工具注册、事件处理
- `handler.ts` (255 行) — TaskStore、server channel handlers
- `types.ts` (80 行) — 类型定义、Channel 契约

### 2.2 工具清单

| # | 工具名 | 参数 | 返回值 | 说明 |
|---|--------|------|--------|------|
| 1 | `session_delegate` | `task`, `title?`, `projectPath?` | `{ sessionId, status }` | 委派任务到后台 session |
| 2 | `session_delegate_send` | `targetSessionId`, `message` | `{ delivered, targetStatus }` | 向委派 session 发送消息 |
| 3 | `session_delegate_status` | `sessionId` | `{ task }` | 查询任务状态 |
| 4 | `session_delegate_stop` | `sessionId` | `{ ok }` | 停止委派 session |
| 5 | `session_delegate_fork` | `sessionId`, `task`, `title?`, `projectPath?` | `{ sessionId, status }` | Fork 并委派新任务 |
| 6 | `session_delegate_remove` | `sessionId` | `{ ok }` | 删除任务（先停止再删除） |
| 7 | `session_delegate_clear_stopped` | _(无参数)_ | `{ removed }` | 清除所有已停止/已完成的任务 |

**参数详解**:

```typescript
// session_delegate
{
  task: string;          // 必填：任务描述
  title?: string;        // 可选：短标题（默认取 task 前 60 字符）
  projectPath?: string;  // 可选：项目目录（默认当前 cwd）
}

// session_delegate_send
{
  targetSessionId: string;  // 目标 session ID
  message: string;          // 消息内容
}

// session_delegate_fork
{
  sessionId: string;        // 源 session ID
  task: string;             // 新任务描述
  title?: string;           // 可选：标题
  projectPath?: string;     // 可选：项目目录
}
```

### 2.3 Channel 通信协议

Coordinator 使用 typed channel (`coordinator`) 进行跨 session 通信：

```
主 Session ←→ Channel (coordinator) ←→ 委派 Session
```

**Channel Methods (8 个)**:

| 方法 | 方向 | 说明 |
|------|------|------|
| `session_delegate` | 主 → 服务端 | 创建委派任务 |
| `session_delegate_send` | 主 → 服务端 | 发送消息 |
| `session_delegate_status` | 主 → 服务端 | 查询状态 |
| `session_delegate_list` | 主 → 服务端 | 列出所有任务 |
| `session_delegate_stop` | 主 → 服务端 | 停止任务 |
| `session_delegate_remove` | 主 → 服务端 | 删除任务 |
| `session_delegate_clear_stopped` | 主 → 服务端 | 清理任务 |
| `session_delegate_fork` | 主 → 服务端 | Fork 任务 |

**Channel Events (5 个)**:

| 事件 | 触发时机 |
|------|----------|
| `message_received` | 委派 session 发来消息 |
| `task_started` | 新任务启动 |
| `task_stopped` | 任务被停止 |
| `task_completed` | 任务完成 |
| `task_error` | 任务出错 |

### 2.4 任务状态机

```
                ┌─────┐
                │ idle │ ◄─── 创建/重新激活
                └──┬──┘
                   │ 收到消息
                   ▼
            ┌──────────┐
            │ streaming │ ◄─── 持续工作中
            └──┬───┬───┘
               │   │
     停止命令  │   │ 完成信号
               ▼   ▼
        ┌────────┐ ┌───────────┐
        │stopped │ │ completed │
        └───┬────┘ └─────┬─────┘
            │            │
            │  5分钟过期  │  5分钟过期
            ▼            ▼
         从上下文中移除（但仍在 store 中）
```

**状态定义**:
- `idle` — 已创建，等待中
- `streaming` — 正在处理
- `stopped` — 被手动停止（可通过 `delegate_send` 重新激活）
- `completed` — 检测到完成信号

**完成信号关键词**: `[completed]`, `[done]`, `task completed`（大小写不敏感）

### 2.5 上下文注入机制

Coordinator 通过 `context` 事件将活跃任务信息注入 LLM 系统提示词：

```
## Delegated Tasks

- **Fix auth bug** (id: `sess_abc123`) — STREAMING — 42s elapsed
  > Working on fixing the token refresh logic in auth.ts
- **Run tests** (id: `sess_def456`) — DONE — 15.3s
  > All 55 tests passed
```

**注入规则**:
- 只注入活跃任务 + 5 分钟内的已完成/已停止任务
- 每次上下文构建时过滤过期任务
- 结果预览最多 200 字符
- 显示上下文使用率百分比（如果可用）

### 2.6 实战流程

#### 场景一：委派单个任务

```
用户: "帮我分析一下 src/core/ 的架构"

LLM 调用工具:
→ session_delegate(
    task="分析 src/core/ 的模块架构，列出核心模块和依赖关系",
    title="架构分析"
  )
← Delegated task to session sess_abc123 (status: started, cwd: /project)

... 等待消息 ...

[Coordinator] Message from session sess_abc123:
分析完成。src/core/ 包含 42 个模块，按职责分为：
- Session 管理（agent-session.ts, session-manager.ts）
- 模型管理（model-registry.ts, model-resolver.ts）
- ...
```

#### 场景二：跨项目委派

```
用户: "在 study-web 项目里创建一个测试文件"

LLM 调用工具:
→ session_delegate(
    task="创建 hello.test.ts 测试文件",
    projectPath="/Users/xuyingzhou/Project/study-web"
  )
← Delegated task to session sess_xyz789 (status: started, cwd: /Users/xuyingzhou/Project/study-web)
```

#### 场景三：双向通信

```
# 主 session 发送追加指令
→ session_delegate_send(
    targetSessionId="sess_abc123",
    message="也检查一下测试覆盖率"
  )
← Message delivered to sess_abc123 (status: active)

# 委派 session 回复
[Coordinator] Message from session sess_abc123:
覆盖率检查完成。总体覆盖率 78%，核心模块覆盖率 92%。

# 查询状态
→ session_delegate_status(sessionId="sess_abc123")
← Task "架构分析" (sess_abc123): STREAMING

# 停止任务
→ session_delegate_stop(sessionId="sess_abc123")
← Session sess_abc123 stopped.
```

#### 场景四：Fork 任务

```
# 基于 session 历史创建分支任务
→ session_delegate_fork(
    sessionId="sess_abc123",
    task="基于之前的分析，生成架构文档",
    title="生成文档"
  )
← Forked session sess_abc123 → sess_def456 (status: started)
```

#### 场景五：清理

```
# 删除单个任务
→ session_delegate_remove(sessionId="sess_abc123")
← Task sess_abc123 removed.

# 批量清理已停止的任务
→ session_delegate_clear_stopped()
← Cleared 3 stopped/completed task(s).
```

---

## 3. Subagent-v2 扩展

### 3.1 核心概念

Subagent-v2 是子任务委派器，通过 RpcClient 启动独立 pi 进程（RPC 模式），运行指定的 Agent profile。与 Coordinator 的区别是：

- **Subagent-v2**: 选择特定 Agent profile（如 explore、plan、build），前台/后台执行，有超时控制
- **Coordinator**: 委派给后台 session，双向通信，适合长时间运行的任务

**源码位置**: `packages/coding-agent/extensions/subagent-v2/`
- `index.ts` (615 行) — 扩展入口、工具注册、执行逻辑
- 依赖 `../subagent-shared/` — 共享工具函数、类型、渲染

### 3.2 工具清单

| # | 工具名 | 参数 | 返回值 | 说明 |
|---|--------|------|--------|------|
| 1 | `subagent` | `agent`, `task`, `background?`, `timeout?`, `cwd?`, `agentScope?`, `confirmProjectAgents?` | 最终输出文本 + 详情 | 委派任务给子 Agent |
| 2 | `subagent_resume` | `sessionPath?`, `sessionId?`, `instruction?`, `background?`, `timeout?` | 最终输出文本 + 详情 | 恢复中断的子 Agent session |

**参数详解**:

```typescript
// subagent
{
  agent: string;                    // 必填：Agent 名称
  task: string;                     // 必填：任务指令
  background?: boolean;             // 可选：后台运行（默认 false）
  timeout?: number;                 // 可选：超时秒数（默认 300）
  cwd?: string;                     // 可选：工作目录
  agentScope?: "user" | "project" | "both";  // 可选：Agent 搜索范围（默认 "user"）
  confirmProjectAgents?: boolean;   // 可选：确认项目级 Agent（默认 true）
}

// subagent_resume
{
  sessionPath?: string;   // 保存的 session 文件路径
  sessionId?: string;     // 原始 session ID
  instruction?: string;   // 追加指令（默认 "Please continue"）
  background?: boolean;   // 后台运行
  timeout?: number;       // 超时秒数
}
```

### 3.3 Agent 发现机制

```
~/.pi/agent/agents/*.md    → user 级 Agent
.pi/agents/*.md            → project 级 Agent
```

**搜索范围 (`agentScope`)**:

| 值 | 搜索路径 |
|----|----------|
| `"user"` | `~/.pi/agent/agents/` |
| `"project"` | `.pi/agents/` |
| `"both"` | 两者都搜索 |

**安全机制**: 当 `agentScope` 为 `"project"` 或 `"both"` 时，如果发现 project 级 Agent，会弹出确认对话框（`confirmProjectAgents` 默认为 `true`）。

**典型 Agent 列表**:

```
~/.pi/agent/agents/
├── architect.md      # 架构设计 Agent
├── backend-dev.md    # 后端开发 Agent
├── developer.md      # 通用开发 Agent
├── devops.md         # DevOps Agent
├── frontend-dev.md   # 前端开发 Agent
├── pi-expert.md      # Pi 框架专家 Agent
└── plan.md           # 规划 Agent
```

### 3.4 执行模式

#### 前台模式（默认）

```
主 Session → subagent(agent="explore", task="分析代码结构")
  ├─ 启动 RpcClient → 子 pi 进程 (RPC 模式)
  ├─ 发送 prompt → 等待完成
  ├─ 实时流式更新（onUpdate）
  ├─ 支持中断（AbortSignal）
  └─ 返回最终输出
```

**特点**:
- 阻塞当前 LLM 调用，等待子 Agent 完成
- 实时流式显示子 Agent 的输出
- 用户可通过 Ctrl+C 中断
- 超时后自动优雅退出（30 秒 grace period）

#### 后台模式 (`background: true`)

```
主 Session → subagent(agent="explore", task="分析代码结构", background=true)
  ├─ 启动 RpcClient → 子 pi 进程
  ├─ 立即返回 "Started background task: bg-xxx"
  ├─ 子 Agent 独立运行
  └─ 完成后通过 followUp 通知主 Session
```

**特点**:
- 立即返回，不阻塞
- 完成后自动发送 `followUp` 消息到主 session
- 结果通过 `pi.appendEntry` 持久化
- 适合批量并行执行

### 3.5 超时与优雅退出

```
┌─────────────────── timeout ───────────────────┐
│                                                │
│  ┌─── 正常执行 ───┐  ┌─── Grace Period (30s) ──┐
│  │                │  │                          │
│  │  timeout - 30s │  │  steer: "请总结并结束"   │
│  │                │  │  等待 agent_end 或 30s   │
│  └────────────────┘  └──────────────────────────┘
```

- 默认超时: 300 秒（5 分钟）
- 超时前 30 秒发送 steer 消息催促总结
- Grace period 结束后强制停止
- `stopReason` 标记为 `"timeout"`, `exitCode` 设为 `1`

### 3.6 Session 持久化与恢复

**持久化路径**: `/tmp/pi-subagent-v2-sessions/subagent-v2-{timestamp}-{random}.json`

**自动持久化**:
- 每次执行（无论成功失败）都保存 session
- 错误输出中包含 session 路径，方便恢复

**恢复流程**:

```
# 首次执行（超时中断）
→ subagent(agent="build", task="重构模块")
← Agent timeout: ...
  Session saved: /tmp/pi-subagent-v2-sessions/subagent-v2-xxx.json
  To resume: use subagent_resume with sessionPath="..."

# 恢复执行
→ subagent_resume(
    sessionPath="/tmp/pi-subagent-v2-sessions/subagent-v2-xxx.json",
    instruction="继续之前的重构工作"
  )
← (从上次中断处继续)
```

### 3.7 实战流程

#### 场景一：前台执行探索任务

```
用户: "帮我分析一下这个项目的依赖关系"

LLM 调用工具:
→ subagent(
    agent="explore",
    task="分析 pi-mono monorepo 的包依赖关系",
    agentScope="user"
  )

... 实时流式输出 ...

← 分析完成。项目包含 6 个包：
  - ai → 被 agent, coding-agent 依赖
  - agent → 被 coding-agent 依赖
  - coding-agent → 依赖 ai, agent, tui
  - ...
```

#### 场景二：后台并行执行

```
用户: "同时检查前端和后端的代码质量"

LLM 调用工具:
→ subagent(
    agent="frontend-dev",
    task="检查前端代码质量",
    background=true
  )
← Started background task: bg-sess-aaa111

→ subagent(
    agent="backend-dev",
    task="检查后端代码质量",
    background=true
  )
← Started background task: bg-sess-bbb222

... 两个任务并行执行 ...

[followUp] 子任务完成：frontend-dev — 前端代码质量检查完成，发现 3 个问题...
[followUp] 子任务完成：backend-dev — 后端代码质量检查完成，发现 5 个问题...
```

#### 场景三：超时恢复

```
# 第一次执行（大任务超时）
→ subagent(agent="build", task="重构整个 auth 模块", timeout=120)
← Agent timeout: 重构了 60%，还有 2 个文件未完成
  Session saved: /tmp/pi-subagent-v2-sessions/subagent-v2-1716xxx.json

# 恢复执行
→ subagent_resume(
    sessionPath="/tmp/pi-subagent-v2-sessions/subagent-v2-1716xxx.json",
    instruction="继续完成剩余 2 个文件的重构",
    timeout=120
  )
← 重构完成。所有文件已更新，测试通过。
```

#### 场景四：使用项目级 Agent

```
# 项目 .pi/agents/ 下有自定义 Agent
→ subagent(
    agent="custom-reviewer",
    task="审查 PR #42",
    agentScope="both",
    confirmProjectAgents=true
  )

# 弹出确认框：
# "Run project-local agent?"
# Agent: custom-reviewer
# Source: /project/.pi/agents

← [用户确认后执行]
```

---

## 4. 两者对比与选择指南

| 维度 | Coordinator | Subagent-v2 |
|------|-------------|-------------|
| **定位** | 多会话协调器 | 子 Agent 执行器 |
| **通信方式** | 双向 channel | 单向（ RpcClient） |
| **Agent 选择** | 无（使用默认 Agent） | 可选 Agent profile |
| **前台/后台** | 始终后台 | 支持前台和后台 |
| **超时控制** | 无内置超时 | 有（默认 5 分钟） |
| **Session 恢复** | 支持（通过 `delegate_send` 重启） | 支持（`subagent_resume`） |
| **任务追踪** | 有（TaskStore + 上下文注入） | 无持久化追踪 |
| **跨项目** | 支持（`projectPath` 参数） | 支持（`cwd` 参数） |
| **适用场景** | 长时间运行、需要双向沟通 | 短期任务、需要特定 Agent 能力 |

**选择建议**:

- 需要**与子任务交互**（追问、追加指令） → **Coordinator**
- 需要**指定 Agent profile**（explore、plan 等） → **Subagent-v2**
- 需要**前台阻塞等待结果** → **Subagent-v2**
- 需要**任务状态持久化和上下文注入** → **Coordinator**
- 需要**超时自动退出** → **Subagent-v2**
- 需要**长时间后台运行+回调** → 两者都支持，但 Coordinator 更适合

---

## 5. 全局扩展部署规范

### 当前全局目录状态

```
~/.pi/agent/extensions/
├── ask-tools → repo/extensions/ask-tools
├── auto-memory → repo/extensions/auto-memory
├── auto-session-title → repo/extensions/auto-session-title
├── bash-ext → repo/extensions/bash-ext
├── compaction-manager → repo/extensions/compaction-manager
├── coordinator → repo/extensions/coordinator
├── file-snapshot → repo/extensions/file-snapshot
├── hooks-engine → repo/extensions/hooks-engine
├── lsp → repo/extensions/lsp/lsp
├── message-bridge → repo/extensions/message-bridge
├── output-guard → repo/extensions/output-guard
├── preview → repo/extensions/preview
├── rules-engine → repo/extensions/rules-engine
├── session-supervisor → repo/extensions/session-supervisor
├── subagent-v2 → repo/extensions/subagent-v2
├── subagent-shared → repo/extensions/subagent-shared  ⚠️ 非扩展，但被 subagent-v2 依赖
└── todo-ext → repo/extensions/todo-ext
```

### 重要注意事项

1. **`subagent-shared` 不是扩展**：它是 subagent-v2 的内部依赖模块，没有 `export default function` 工厂。但 subagent-v2 通过 `../subagent-shared/index.js` 相对路径引用它，所以必须在同级目录保留软链。pi 的加载器会尝试加载它并报错跳过，不会影响整体运行。

2. **使用 `-e` 显式指定时不需要全局软链**：
   ```bash
   ./pi-test.sh --no-extensions \
     -e ./packages/coding-agent/extensions/coordinator/index.ts \
     -e ./packages/coding-agent/extensions/subagent-v2/index.ts
   ```

3. **Repo 内 4 个未全局部署的扩展**（按需启用）：
   - `agent-permissions` — Agent 权限管理
   - `claude-hooks-compat` — Claude Hooks 兼容层
   - `file-time-guard` — 文件时间守卫
   - `subagent-ext` — spawn 变体子 Agent（与 subagent-v2 互补）

---

## 6. 故障排查

### Coordinator 问题

| 症状 | 原因 | 解决方案 |
|------|------|----------|
| 任务创建返回 `no sessionId` | 服务端 `session_delegate` 调用失败 | 检查 channel 连接 |
| `delegate_send` 返回 `delivered: false` | 目标 session 文件已删除 | 用 `delegate_remove` 清理 |
| 任务一直显示 `idle` | 子 session 未启动或已崩溃 | 用 `delegate_status` 查看详情 |
| 上下文注入过多旧任务 | `clearStopped` 未调用 | 手动调用 `session_delegate_clear_stopped` |

### Subagent-v2 问题

| 症状 | 原因 | 解决方案 |
|------|------|----------|
| `Unknown agent: "xxx"` | Agent 文件不存在 | 检查 `~/.pi/agent/agents/` 或 `.pi/agents/` |
| `Cannot find module '../subagent-shared/index.js'` | subagent-shared 软链缺失 | 恢复软链或用 `-e` 显式加载 |
| `Agent timeout` | 任务超过默认 300 秒 | 增大 `timeout` 参数，或用 `subagent_resume` |
| 后台任务无回调 | session 已过期 | 检查主 session 是否仍然活跃 |
| `Canceled: project-local agent not approved` | 用户拒绝项目级 Agent | 确认项目 Agent 可信后重试 |

### 加载问题

| 错误信息 | 原因 | 解决方案 |
|----------|------|----------|
| `Extension does not export a valid factory function` | 非扩展文件被当作扩展加载（如 subagent-shared） | 该模块是依赖，报错可忽略；或移除其全局软链（但会导致 subagent-v2 不可用） |
| `Cannot find module '../subagent-shared/index.js'` | subagent-v2 在全局目录下无法解析相对路径 | 确保 subagent-shared 软链存在于同级目录 |
