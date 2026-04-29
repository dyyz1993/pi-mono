# Bash Channel Extension

> Bash 工具的 channel 扩展，替代内置 bash 工具，支持 PID 追踪、后台运行、用户取消、实时输出流和按需订阅。

**源码**: `packages/coding-agent/test/auto-memory/bash.ts`
**测试**: `packages/coding-agent/test/auto-memory/bash.test.ts` (31 tests)

---

## 架构概述

该扩展通过 `pi.registerChannel("bash")` 注册双向 channel，替代内置 bash 工具。

```
Frontend (pi-agent-chat)              Server (RPC)                    Extension (bash.ts)
     │                                    │                                │
     │  bash.command {action:"kill"}      │                                │
     │──────────────────────────────────→│  channel_data {name:"bash"}    │
     │                                    │───────────────────────────────→│
     │                                    │                     kill + resolve(details)
     │                                    │  channel_data {type:"terminated"}
     │                                    │←───────────────────────────────│
     │  bash.event {type:"terminated"}    │                                │
     │←──────────────────────────────────│                                │
     │                                    │  tool_execution_end(result)    │
     │                                    │←───────────────────────────────│
     │  agent.event {tool_execution_end}  │                                │
     │←──────────────────────────────────│                                │
```

---

## 模块级状态

```ts
const managed = new Map<string, ManagedBash>();  // 当前活跃进程 (running + background)
const history: BashProcess[] = [];               // 已退出的后台进程历史
const deletedIds = new Set<string>();             // 被用户删除的 toolCallId
```

- `list` 命令只返回后台进程：`managed` 中 `backgrounded=true` 的 + `history`（排除 `deletedIds`）
- 前台进程完成后从 `managed` 删除，不进入 `history`
- 后台进程退出后 push 到 `history`，从 `managed` 删除
- `remove` 命令同时从 `managed` 和 `history` 中移除，并加入 `deletedIds`

---

## 生命周期

```
session_start
  ├── registerChannel("bash")
  ├── managed.clear() + history.length = 0 + deletedIds.clear()
  ├── emit("list", [])              // 初始空列表
  └── onReceive handler 注册

tool execute (每次 LLM 调用 bash)
  ├── spawn child process
  ├── managed.set(toolCallId)
  ├── emit("start", {...})
  ├── handleData: emit("output", ...) + onUpdate (前台模式)
  ├── handleData: logStream.write (后台模式, 不 emit)
  └── waitForChildProcess
       ├── 前台正常完成 → emit("end") + persistEntry + managed.delete
       ├── 前台超时/错误 → emit("error") + persistEntry + managed.delete
       ├── 前台 abort → emit("terminated") + persistEntry + managed.delete
       ├── 后台退出(resolved) → emit("end"/"error") + persistEntry + history.push + managed.delete + sendMessage
       └── 后台崩溃(resolved) → emit("error") + persistEntry + history.push + managed.delete + sendMessage

用户操作 (via channel onReceive)
  ├── list → 返回后台活跃进程 + history (排除 deletedIds)
  ├── kill → killProcessTree + resolve(details.terminated)
  ├── background → resolve(details.background) + 切文件写入模式
  ├── remove → deletedIds.add + managed.delete + history.splice
  ├── subscribe_output → 恢复后台进程的 output 事件
  └── unsubscribe_output → 停止后台进程的 output 事件

后台进程退出 (waitForChildProcess resolved 分支)
  ├── 正常退出 → history.push + sendMessage("bash_background_exit", {exitCode, logPath})
  └── 异常退出 → history.push + sendMessage("bash_background_exit", {display:"warning"})
```

---

## Channel 事件 (Extension → Frontend)

所有事件通过 `channel.send()` 发出，经 RPC 的 `channel_data` 转发到前端。

### BashChannelEvent

```ts
interface BashChannelEvent {
  type: "start" | "output" | "end" | "error" | "terminated" | "background" | "list";
  processes?: BashProcess[];   // 所有进程的当前状态
  toolCallId?: string;
  pid?: number;
  data?: string;               // output 内容或错误信息
  timestamp: number;
}
```

### BashProcess

```ts
interface BashProcess {
  toolCallId: string;
  command: string;
  cwd: string;
  pid?: number;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  output: string;              // 前台模式的累积输出
  status: "running" | "done" | "error" | "terminated" | "background";
  error?: string;
  logPath?: string;            // 后台模式的日志文件路径
}
```

### 事件类型说明

| type | 触发时机 | 关键字段 |
|------|----------|----------|
| `list` | session_start / 收到 list 命令 | `processes`（仅后台进程） |
| `start` | 工具开始执行 | `toolCallId`, `pid`, `data`(command) |
| `output` | 子进程输出数据（前台模式或已订阅的后台进程） | `toolCallId`, `data`(output text) |
| `end` | 前台/后台进程正常完成 | `toolCallId`, `data`(output) |
| `error` | 前台/后台进程非零退出 / 超时 | `toolCallId`, `data`(error) |
| `terminated` | 用户取消（kill）或 abort | `toolCallId`, `pid` |
| `background` | 用户切后台 | `toolCallId`, `pid`, `data`(最近输出) |

---

## Channel 命令 (Frontend → Extension)

前端通过 `apiClient.call("bash.command", ...)` 发送命令。

### 命令列表

| action | 说明 | 参数 |
|--------|------|------|
| `list` | 获取后台进程列表（活跃 + 历史，排除已删除） | 无 |
| `kill` | 用户取消，杀进程并 resolve tool | `toolCallId` |
| `background` | 切后台运行，resolve tool，进程继续 | `toolCallId` |
| `remove` | 从列表删除（活跃 + 历史），加入 deletedIds | `toolCallId` |
| `subscribe_output` | 订阅后台进程的实时输出 | `toolCallId` |
| `unsubscribe_output` | 取消订阅后台进程的实时输出 | `toolCallId` |

---

## Tool Result 数据格式

**所有场景都是 resolve（不 reject），LLM 和前端始终能拿到 content + details。**

### terminated.reason 一览

| reason | 场景 | content 文本 |
|--------|------|-------------|
| `user_cancel` | 用户点击取消按钮 | `[User cancelled after 3s, PID: 12345]` |
| `timeout` | 命令超时 | `[Timed out after 30s, PID: 12345]` |
| `signal` | AbortSignal 中断（agent abort） | `[Aborted after 2s, PID: 12345]` |
| `error` | 非零退出码 | `[Command failed with exit code 1 after 5s, PID: 12345]` |

---

### 1. 正常完成 (exit code 0)

```ts
{
  content: [{ type: "text", text: "输出内容..." }],
  details: {
    truncation?: TruncationResult;
    fullOutputPath?: string;
  }
}
// details.terminated 不存在，表示正常完成
```

### 2. 用户取消 (kill)

```ts
{
  content: [{
    type: "text",
    text: "已有输出...\n\n[User cancelled after 3s, PID: 12345]"
  }],
  details: {
    terminated: {
      reason: "user_cancel",
      pid: 12345,
      command: "npm run dev",
      startedAt: 1714000000000,
      endedAt: 1714000030000,
      durationMs: 30000,
      logPath: undefined
    }
  }
}
```

### 3. 超时 (timeout)

```ts
{
  content: [{
    type: "text",
    text: "已有输出...\n\n[Timed out after 30s, PID: 12345]"
  }],
  details: {
    terminated: {
      reason: "timeout",
      pid: 12345,
      command: "npm run dev",
      startedAt: 1714000000000,
      endedAt: 1714000030000,
      durationMs: 30000,
      timeoutSecs: 30,
      logPath: undefined
    }
  }
}
```

### 4. 异常中断 (abort signal)

```ts
{
  content: [{
    type: "text",
    text: "已有输出...\n\n[Aborted after 2s, PID: 12345]"
  }],
  details: {
    terminated: {
      reason: "signal",
      pid: 12345,
      command: "npm run dev",
      startedAt: 1714000000000,
      endedAt: 1714000002000,
      durationMs: 2000,
      logPath: undefined
    }
  }
}
```

### 5. 非零退出码 (exit code ≠ 0)

```ts
{
  content: [{
    type: "text",
    text: "已有输出...\n\n[Command failed with exit code 1 after 5s, PID: 12345]"
  }],
  details: {
    terminated: {
      reason: "error",
      pid: 12345,
      command: "npm run dev",
      startedAt: 1714000000000,
      endedAt: 1714000005000,
      durationMs: 5000,
      exitCode: 1,
      logPath: undefined
    }
  }
}
```

### 6. 后台运行 (background)

```ts
{
  content: [{
    type: "text",
    text: "已有输出...\n\n[Moved to background after 5s, PID: 12345. Log: /tmp/pi-bash-abc.log. Use the Shell panel in the sidebar to monitor or kill the process.]"
  }],
  details: {
    background: {
      pid: 12345,
      command: "npm run dev",
      startedAt: 1714000000000,
      durationMs: 5000,
      logPath: "/tmp/pi-bash-abc.log",  // 后台一定有日志文件
      detached: false
    }
  }
}
```

### 4. 后台进程正常退出 — sendMessage 通知

```ts
{
  customType: "bash_background_exit",
  content: "Background process \"npm run dev\" (PID: 12345) exited with code 0 after 5m30s. Log: /tmp/pi-bash-abc.log",
  details: {
    pid: 12345,
    command: "npm run dev",
    exitCode: 0,
    startedAt: 1714000000000,
    endedAt: 1714000330000,
    durationMs: 330000,
    logPath: "/tmp/pi-bash-abc.log"
  },
  display: "info"     // code 0 → "info", 非 0 → "warning"
}
```

### 5. 后台进程异常退出 — sendMessage 通知

```ts
{
  customType: "bash_background_exit",
  content: "Background process \"npm run dev\" (PID: 12345) crashed: Error: spawn ENOMEM. Log: /tmp/pi-bash-abc.log",
  details: {
    pid: 12345,
    command: "npm run dev",
    exitCode: null,
    startedAt: 1714000000000,
    endedAt: 1714000330000,
    durationMs: 330000,
    logPath: "/tmp/pi-bash-abc.log"
  },
  display: "warning"
}
```

---

## 前台 vs 后台 输出模式

### 前台 (status: "running")
- `proc.output` 持续累积（内存）
- 每次 data 都 emit `output` channel event
- `onUpdate` 回调驱动 tool_execution_update 事件
- 超过 `DEFAULT_MAX_BYTES` 时创建截断临时文件

### 后台 (status: "background")
- **立即创建日志文件** `getTempFilePath()` → `/tmp/pi-bash-{hex}.log`
- 将已有 `proc.output` 写入日志文件
- **停止 `proc.output` 累积** — 避免内存爆炸
- **停止 emit `output` 事件** — 默认不推送，避免 channel 压力
- 后续输出只写 `logStream`
- 用户可通过 `subscribe_output` 按需恢复 output 事件推送
- 进程退出时关闭 `logStream`，发 `sendMessage` 通知

### 设计理由
| 场景 | 前台 | 后台 |
|------|------|------|
| `npm run dev` 跑 10 小时 | 不会 — agent 等结果 | 内存稳定、channel 不炸、日志全在文件 |
| `tail -f` / `ping` | 不会 — agent 等结果 | 只写文件，不推送 |
| 普通命令 `ls` `git` | 几秒完成 | 不需要后台 |

---

## BashToolDetails 类型

```ts
interface BashToolDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
  background?: {
    pid?: number;
    command: string;
    startedAt: number;
    durationMs: number;
    logPath?: string;
    detached: boolean;
  };
  terminated?: {
    reason: "user_cancel" | "signal" | "unknown";
    pid?: number;
    command: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    logPath?: string;
  };
}
```

---

## 测试覆盖

| 测试组 | 用例数 | 覆盖内容 |
|--------|--------|----------|
| registration | 3 | channel 注册、空列表 emit、工具注册 |
| channel commands | 4 | list、kill event、background resolve、unknown action |
| tool execution | 3 | start event、end event、output events |
| appendEntry persistence | 2 | 完成进程持久化、后台进程持久化 |
| abort signal | 1 | signal abort reject |
| kill action format | 2 | details.terminated 字段、content 格式 |
| background action format | 3 | details.background 字段、content 含 logPath 和引导、日志文件创建 |
| background exit notification | 2 | sendMessage 格式、logPath 在 content 和 details 中 |
| background output mode | 2 | 停止 output event、subscribe_output 恢复 |
| history and remove | 6 | list 只返回后台进程、后台活跃在 list、后台退出进 history、remove 从活跃删除、remove 从历史删除、session_start 清空 |

**总计**: 31 个测试，全部通过

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `test/auto-memory/bash.ts` | 扩展实现 |
| `test/auto-memory/bash.test.ts` | 单元测试 |
| `src/core/tools/bash.ts` | BashToolDetails 类型定义 |
| `src/core/tools/truncate.ts` | 输出截断逻辑 |
| `src/utils/shell.ts` | shell 配置、进程树杀、环境变量 |
| `src/utils/child-process.ts` | waitForChildProcess |
| `src/core/extensions/channel-types.ts` | Channel 类型定义 |
| `src/core/extensions/channel-manager.ts` | Channel 管理器 |
