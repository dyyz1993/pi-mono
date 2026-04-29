# LSP Extension 文档

> pi coding agent 的 LSP (Language Server Protocol) 扩展，为 agent 提供实时的代码诊断、格式化、跳转定义等 IDE 级能力。

---

## 目录

- [1. 概述](#1-概述)
- [2. 架构](#2-架构)
- [3. 配置](#3-配置)
- [4. 注册的工具](#4-注册的工具)
- [5. 注册的命令](#5-注册的命令)
- [6. Channel 事件](#6-channel-事件)
- [7. 诊断模式](#7-诊断模式)
- [8. 生命周期钩子](#8-生命周期钩子)
- [9. 文件追踪器](#9-文件追踪器)
- [10. 传输层](#10-传输层)
- [11. 源码索引](#11-源码索引)

---

## 1. 概述

LSP 扩展（`lspExtension`）作为 pi coding agent 的扩展插件运行，通过 LSP 协议与外部 Language Server 通信，提供以下能力：

| 能力 | 说明 |
|------|------|
| 诊断（Diagnostics） | 自动检测代码错误和警告 |
| 格式化（Formatting） | 编辑后自动格式化文件 |
| 跳转定义（Go to Definition） | 查找符号定义位置 |
| 查找引用（Find References） | 查找符号的所有引用 |
| 悬停信息（Hover） | 获取光标处的类型/文档信息 |
| 符号搜索（Symbols） | 工作区或文档级别的符号搜索 |
| 重命名（Rename） | 跨文件符号重命名 |

扩展在 `session_start` 时启动配置的 LSP 服务器，在 `session_shutdown` 时关闭。编辑文件时通过 `tool_result` 钩子拦截 `write`/`edit` 工具调用，自动执行格式化和诊断检查。

---

## 2. 架构

```
┌──────────────────────────────────────────────────────┐
│                    lspExtension                       │
│                    (index.ts)                         │
├──────────┬──────────┬───────────┬──────────┬─────────┤
│  config/ │ client/  │  tools/   │  hooks/  │ utils/  │
│ resolver │ registry │ lsp-tool  │ agent-end│lsp-     │
│          │ runtime  │           │ diag-    │helpers  │
│          │ file-    │           │ mode     │         │
│          │ tracker  │           │ write-   │         │
│          │          │           │ through  │         │
└──────────┴──────────┴───────────┴──────────┴─────────┘
       │         │          │          │
       ▼         ▼          ▼          ▼
  配置文件    LSP 服务器   Agent 工具  Agent 钩子
```

### 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| 入口 | `index.ts` | 组装所有子模块，注册事件钩子、工具、命令和 channel |
| 配置解析 | `config/resolver.ts` | 加载并合并用户/项目级 LSP 配置，解析服务器命令路径 |
| 运行时注册 | `client/registry.ts` | 管理多个 LSP 服务器实例的路由（按 fileType 分发） |
| LSP 客户端 | `client/runtime.ts` | JSON-RPC 通信、进程管理、诊断收集 |
| 文件追踪 | `client/file-tracker.ts` | LRU 文件追踪，管理 `textDocument/didOpen`/`didClose` |
| 工具路由 | `tools/lsp-tool.ts` | 注册 `lsp` 和 `lsp_health` 工具供 agent 调用 |
| Agent 结束钩子 | `hooks/agent-end.ts` | `agent_end` 模式下的诊断聚合 |
| 诊断模式 | `hooks/diagnostics-mode.ts` | 管理诊断模式状态和 touched files |
| 写入穿透钩子 | `hooks/writethrough.ts` | 拦截 write/edit 工具调用，执行格式化和诊断 |
| 辅助函数 | `utils/lsp-helpers.ts` | LSP 类型定义、range 解析、language ID 映射 |

---

## 3. 配置

### 3.1 配置文件位置

配置按以下优先级加载并合并（后者覆盖前者）：

1. `~/.pi/lsp.{json,yaml,yml}` — 用户全局配置
2. `~/.pi/agent/lsp.{json,yaml,yml}` — 用户 coding-agent 专属配置
3. `<project>/.pi/lsp.{json,yaml,yml}` — 项目级配置

### 3.2 配置格式

```json
{
  "serverCommand": ["typescript-language-server", "--stdio"],
  "serverCandidates": [
    ["typescript-language-server", "--stdio"],
    ["vscode-eslint-language-server", "--stdio"]
  ],
  "servers": {
    "typescript": {
      "command": ["typescript-language-server", "--stdio"],
      "fileTypes": [".ts", ".tsx"]
    },
    "eslint": {
      "command": ["vscode-eslint-language-server", "--stdio"],
      "fileTypes": [".ts", ".tsx", ".js", ".jsx"],
      "disabled": false
    }
  }
}
```

YAML 格式同样支持：

```yaml
servers:
  typescript:
    command: ["typescript-language-server", "--stdio"]
    fileTypes: [".ts", ".tsx"]
  eslint:
    server: vscode-eslint-language-server
    args: ["--stdio"]
    fileTypes: [".ts", ".tsx", ".js", ".jsx"]
```

### 3.3 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `serverCommand` | `string \| string[]` | 全局默认 LSP 服务器命令 |
| `serverCandidates` | `string[]` | 自动探测的候选服务器列表（按顺序尝试） |
| `servers` | `object \| array` | 具名服务器配置（支持对象或数组形式） |

#### Server 条目字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 服务器名称（对象形式时为 key） |
| `command` | `string \| string[]` | 启动命令 |
| `server` + `args` | `string` + `string[]` | 命令的替代写法（`server` + `args` 拼接） |
| `serverCommand` | `string \| string[]` | `command` 的别名 |
| `fileTypes` | `string[]` | 该服务器处理的文件类型（扩展名或文件名） |
| `disabled` | `boolean` | 是否禁用此服务器 |

### 3.4 命令解析

配置中的命令按以下路径搜索可执行文件：

1. Mason 目录（Neovim 包管理器）：`~/.local/share/nvim/mason/bin` 等
2. 系统 `PATH` 环境变量
3. `~/.local/bin/lspmux` — lspmux 代理工具

---

## 4. 注册的工具

### 4.1 `lsp` 工具

Agent 可通过 `lsp` 工具执行 LSP 操作。

**参数 Schema：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | `enum` | 是 | 操作类型 |
| `path` | `string` | 部分 | 文件路径（document 级操作必填） |
| `line` | `number` | 部分 | 零基行号（位置相关操作必填） |
| `character` | `number` | 部分 | 零基列号（位置相关操作必填） |
| `newName` | `string` | rename | 重命名的新符号名 |
| `query` | `string` | symbols | 工作区符号搜索查询 |
| `includeDeclaration` | `boolean` | references | 是否包含声明位置 |

**支持的操作：**

| Action | LSP Method | 说明 |
|--------|-----------|------|
| `status` | — | 返回注册表状态（服务器列表、生命周期状态） |
| `reload` | — | 重新加载所有 LSP 服务器 |
| `diagnostics` | `textDocument/publishDiagnostics` + `textDocument/diagnostic` | 获取文件诊断（push + pull 两种模式） |
| `hover` | `textDocument/hover` | 获取光标处的类型/文档信息 |
| `definition` | `textDocument/definition` | 跳转到符号定义 |
| `references` | `textDocument/references` | 查找符号的所有引用 |
| `symbols` | `workspace/symbol` / `textDocument/documentSymbol` | 工作区或文档符号搜索 |
| `rename` | `textDocument/rename` | 跨文件重命名符号 |

**使用示例：**

```json
{ "action": "diagnostics", "path": "src/index.ts" }
{ "action": "definition", "path": "src/index.ts", "line": 10, "character": 5 }
{ "action": "references", "path": "src/index.ts", "line": 10, "character": 5, "includeDeclaration": true }
{ "action": "symbols", "query": "MyClass" }
{ "action": "rename", "path": "src/index.ts", "line": 10, "character": 5, "newName": "NewClassName" }
{ "action": "status" }
{ "action": "reload" }
```

### 4.2 `lsp_health` 工具

`lsp_health` 是向后兼容的健康检查快捷方式，等同于 `{ action: "status" }`。不接受参数。

---

## 5. 注册的命令

### 5.1 `/lsp-status`

显示 LSP 扩展的健康信息，包括：
- 注册表状态（inactive / starting / ready / error）
- 配置的服务器数量和活跃服务器数量
- 当前诊断模式
- 打开的文件数量
- 每个服务器的详细状态（transport、command、state、reason）

### 5.2 `/lsp`

查看或切换诊断模式：

```
/lsp                  # 显示当前模式
/lsp agent_end        # 切换到 agent_end 模式
/lsp edit_write       # 切换到 edit_write 模式
/lsp disabled         # 禁用诊断
```

---

## 6. Channel 事件

扩展在 `session_start` 时注册名为 `"lsp"` 的 channel，向 UI 推送实时事件。

### 6.1 事件类型

所有事件都包含 `event` 和 `timestamp` 字段。

| 事件 | 触发时机 | 额外字段 |
|------|---------|---------|
| `startup_begin` | 会话启动，开始初始化 LSP 服务器 | `servers`, `totalServers` |
| `server_ready` | 单个 LSP 服务器启动成功 | `serverName`, `servers` |
| `server_error` | 单个 LSP 服务器启动失败 | `serverName`, `servers` |
| `startup_complete` | 所有 LSP 服务器启动完成 | `servers` |
| `status_changed` | 整体状态变化 | `servers` |
| `diagnostics_update` | 诊断结果更新（agent_end 模式） | `filePath`, `diagnostics` |
| `mode_changed` | 诊断模式切换 | `mode` |
| `error` | 发生错误 | `error` |

### 6.2 Channel 接入（UI 侧）

UI 可以通过 channel 向扩展发送消息：

```json
{ "action": "setMode", "mode": "edit_write" }
```

支持的模式值：`"agent_end"` | `"edit_write"` | `"disabled"`

---

## 7. 诊断模式

扩展支持三种诊断模式，控制何时触发诊断检查：

| 模式 | 行为 |
|------|------|
| `agent_end` | 默认模式。在 agent 完成一轮操作后，对 touched files 执行诊断聚合。编辑时仅执行格式化。 |
| `edit_write` | 每次写入/编辑文件时立即执行格式化 + 诊断，将结果附加到工具返回中。 |
| `disabled` | 完全禁用 LSP 诊断和格式化。 |

### 模式切换

- 通过 `/lsp <mode>` 命令
- 通过 channel 发送 `{ "action": "setMode", "mode": "..." }`
- 切换时会通过 `pi.appendEntry("lsp", ...)` 持久化到会话记录

### Touched Files

在 `agent_end` 模式下，扩展追踪所有被 write/edit 的文件路径。当 agent 完成一轮操作时，对这些文件统一执行诊断检查，并通过 `pi.sendMessage` 发送汇总消息（含 `triggerTurn: true`），让 agent 看到诊断结果并决定是否修复。

---

## 8. 生命周期钩子

### 8.1 `session_start`

1. 注册 `"lsp"` channel
2. 解析 LSP 配置
3. 推送 `startup_begin` 事件
4. 启动所有配置的 LSP 服务器（`runtime.start()`）
5. 为每个服务器推送 `server_ready` 或 `server_error` 事件
6. 推送 `status_changed` 和 `startup_complete` 事件
7. 通过 `pi.appendEntry` 持久化状态到会话记录
8. 通过 `ctx.ui.notify` 通知用户启动结果

### 8.2 `session_shutdown`

1. 清理空闲文件清理计时器
2. 关闭所有追踪的文件（发送 `textDocument/didClose`）
3. 停止所有 LSP 服务器进程
4. 清空 channel 引用

### 8.3 `agent_end`

1. 清理之前的空闲计时器
2. 设置 30 秒延迟的空闲清理计时器：
   - 关闭超过 60 秒未访问的文件
   - 清空所有文件追踪器

### 8.4 `tool_result`（WriteThrough 钩子）

拦截 `write` 和 `edit` 工具的结果：

1. 检查当前诊断模式是否启用
2. 检查 LSP 服务器是否就绪
3. 打开文件到 LSP 服务器（`textDocument/didOpen`）
4. **格式化**：请求 `textDocument/formatting`，应用编辑到文件
5. 根据 `edit_write` 模式：立即获取诊断并附加到工具返回中
6. 根据 `agent_end` 模式：仅标记文件为 touched，等待 `agent_end` 统一处理

---

## 9. 文件追踪器

`FileTracker` 管理打开的文件，维护 LRU（最近最少使用）缓存：

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `maxOpenFiles` | 30 | 最大同时打开的文件数 |

**行为：**
- 打开文件时，如超出上限则逐出最久未访问的文件（调用 `onClose` 回调）
- 重复打开同一文件会更新其访问时间并移到末尾
- `getIdleFiles(idleMs)` 返回超过指定时间未访问的文件
- `closeAll()` 关闭所有文件

---

## 10. 传输层

### 10.1 LSP 客户端运行时（`client/runtime.ts`）

LSP 客户端通过 JSON-RPC over stdio 与 Language Server 通信。

**启动流程：**

1. 根据 `buildLaunchPlans()` 决定传输方式
2. 启动子进程
3. 发送 `initialize` 请求（声明客户端能力）
4. 发送 `initialized` 通知
5. 状态变为 `ready`

**传输模式：**

| 模式 | 说明 |
|------|------|
| `lspmux-configured` | 用户显式配置使用 lspmux |
| `lspmux-auto` | 自动检测到 lspmux，优先使用 |
| `direct` | 直接启动 LSP 服务器（无 lspmux） |
| `direct-fallback` | lspmux 启动失败，回退到直接启动 |

**能力声明：**

客户端在 `initialize` 时声明的能力包括：
- `textDocument.publishDiagnostics` — 诊断推送
- `textDocument.synchronization` — 文件同步（didSave）
- `textDocument.hover` — 悬停信息
- `textDocument.definition` — 跳转定义（link support）
- `textDocument.references` — 查找引用
- `textDocument.documentSymbol` — 文档符号（层级支持）
- `textDocument.rename` — 重命名
- `textDocument.formatting` — 格式化
- `textDocument.diagnostic` — Pull 诊断
- `workspace.symbol` — 工作区符号
- `workspace.configuration` — 配置请求

**内部请求处理：**

运行时会自动响应服务器发起的请求：
- `eslint/confirmESLintExecution` → 返回 `4`
- `eslint/noLibrary` / `eslint/noConfig` / `eslint/probeFailed` / `eslint/openDoc` → 返回 `{}`
- `window/showMessageRequest` → 返回 `null`
- `workspace/configuration` → 返回默认 ESLint 配置
- `client/registerCapability` / `client/unregisterCapability` → 返回 `null`

**缓冲区限制：**

| 参数 | 值 |
|------|---|
| 输出缓冲区 | 8 MB |
| 单帧内容 | 4 MB |
| 默认请求超时 | 4 秒 |

### 10.2 多服务器注册表（`client/registry.ts`）

`LspRuntimeRegistry` 管理多个 LSP 服务器实例：

**路由策略：**
- 带路径的操作：根据文件扩展名/文件名匹配服务器的 `fileTypes`，无匹配时使用无 `fileTypes` 的服务器作为 fallback
- 不带路径的操作：选择第一个 ready 的服务器

**关键接口：**

| 方法 | 说明 |
|------|------|
| `start(config)` | 启动所有配置的服务器 |
| `stop()` | 停止所有服务器 |
| `reload(config)` | 重载所有服务器 |
| `request(method, params, options)` | 向匹配的服务器发送请求 |
| `requestAll(method, params, options)` | 向所有匹配的服务器发送请求 |
| `notify(method, params, options)` | 向匹配的服务器发送通知 |
| `getPublishedDiagnostics(filePath?)` | 获取推送诊断 |
| `getStatus()` | 获取整体状态 |
| `getStatusForPath(filePath)` | 获取文件对应服务器的状态 |

---

## 11. 源码索引

| 文件 | 说明 |
|------|------|
| `test/auto-memory/lsp/index.ts` | 扩展入口，组装子模块，注册事件/工具/命令 |
| `test/auto-memory/lsp/client/runtime.ts` | LSP JSON-RPC 客户端运行时（进程管理、通信、诊断收集） |
| `test/auto-memory/lsp/client/registry.ts` | 多服务器注册表（路由、生命周期管理） |
| `test/auto-memory/lsp/client/file-tracker.ts` | LRU 文件追踪器 |
| `test/auto-memory/lsp/config/resolver.ts` | 配置文件加载、合并和命令路径解析 |
| `test/auto-memory/lsp/tools/lsp-tool.ts` | `lsp` 和 `lsp_health` 工具定义 |
| `test/auto-memory/lsp/hooks/agent-end.ts` | Agent 结束时的诊断聚合钩子 |
| `test/auto-memory/lsp/hooks/diagnostics-mode.ts` | 诊断模式状态管理 |
| `test/auto-memory/lsp/hooks/writethrough.ts` | Write/Edit 穿透钩子（格式化 + 诊断） |
| `test/auto-memory/lsp/utils/lsp-helpers.ts` | 共享类型、range 解析、language ID 映射 |
| `test/auto-memory/lsp/lsp.test.ts` | 扩展测试套件 |
