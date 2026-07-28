# PI Agent 系统架构文档

> 基于 `@dyyz1993/pi-coding-agent` v0.78.1
> 源码路径: `/Users/xuyingzhou/Project/temporary/pi-momo-fork`

---

## 目录

1. [架构总览](#1-架构总览)
2. [CLI 参数全景](#2-cli-参数全景)
3. [生命周期与扩展钩子](#3-生命周期与扩展钩子)
4. [会话系统](#4-会话系统)
5. [RPC 协议](#5-rpc-协议)
6. [RpcClient](#6-rpcclient)
7. [Channel 系统](#7-channel-系统)
8. [Bus 通信层](#8-bus-通信层)
9. [存储目录](#9-存储目录)
10. [模型配置](#10-模型配置)
11. [HTML 导出](#11-html-导出)
12. [Agent 系统](#12-agent-系统)
13. [Tier 系统](#13-tier-系统)

---

## 1. 架构总览

### 1.1 分层图

```
┌──────────────────────────────────────────────────────────────────┐
│  CLI Layer                                                       │
│  pi [options] [@files...] [messages...]                          │
│  pi install/remove/update/list/config                             │
│  pi --mode rpc                                                   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│  Main Layer (main.ts)                                            │
│  parseArgs → createAgentSessionRuntime → dispatch(appMode)       │
│    ├── interactive → InteractiveMode                             │
│    ├── print/json  → runPrintMode                                │
│    └── rpc         → runRpcMode                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│  AgentSession (agent-session.ts)                                 │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐      │
│  │ Agent        │  │ SessionMgr   │  │ ExtensionRunner    │      │
│  │ (agent-loop) │  │ (JSONL 存储)  │  │ (事件总线 + 钩子)  │      │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬──────────┘      │
│         │                │                      │                │
│         ▼                ▼                      ▼                │
│  ┌──────────────┐  ┌──────────┐  ┌─────────────────────────┐    │
│  │ ModelRegistry │  │ Channel  │  │ ToolRegistry            │    │
│  │ (模型 + 认证)  │  │  Manager │  │ (内置 + 扩展 + MCP)    │    │
│  └──────────────┘  └────┬─────┘  └─────────────────────────┘    │
│                          │                                       │
│                     ┌────▼─────┐                                │
│                     │   Bus    │  ← 新增通信层                   │
│                     │  socket  │                                 │
│                     └──────────┘                                 │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 核心依赖链

```
用户输入
  │
  ├── CLI 解析 (args.ts)
  │     └── --model → resolveCliModel() → ModelRegistry
  │     └── --agent → discoverAgents()  → AgentConfig
  │     └── --bus   → BusTransport
  │
  ├── AgentSession.prompt()
  │     ├── before_agent_start 事件
  │     ├── agent.prompt()
  │     │     └── runLoop()
  │     │           ├── transformContext() → context 事件
  │     │           ├── streamSimple(model, context)
  │     │           │     └── ApiRegistry.get(model.api)
  │     │           │           └── provider.stream() / providers/anthropic.ts 等
  │     │           └── executeToolCalls()
  │     │                 ├── tool_call 事件 (可 block)
  │     │                 ├── tool.execute()
  │     │                 └── tool_result 事件 (可修改结果)
  │     └── _runPostAgentLoop()
  │           ├── _prepareRetry()
  │           ├── _checkCompaction()
  │           └── auto_continue
  │
  ├── BusTransport (如果有 --bus)
  │     ├── outputFn → socket.write(JSONL)
  │     └── socket → ChannelManager.handleInbound()
  │
  └── 输出
        ├── stdout (JSONL for RPC)
        ├── TUI (interactive)
        └── socket (bus)
```

---

## 2. CLI 参数全景

### 2.1 子命令

| 命令 | 说明 |
|------|------|
| `pi [options] [@files...] [messages...]` | 默认：交互模式 / print 模式 |
| `pi install <source> [-l]` | 安装扩展源 |
| `pi remove <source> [-l]` | 移除扩展源 |
| `pi update [source\|self\|pi]` | 更新 pi 和已安装扩展 |
| `pi list` | 列出已安装扩展 |
| `pi config` | 打开 TUI 管理包资源 |

### 2.2 核心参数（41 个）

**会话管理（8 个）：**

| 参数 | 简写 | 说明 |
|------|------|------|
| `--continue` | `-c` | 继续之前的会话 |
| `--resume` | `-r` | 选择要恢复的会话 |
| `--session <path\|id>` | | 使用指定的会话文件或部分 UUID |
| `--session-id <id>` | | 使用精确的项目 session ID |
| `--fork <path\|id>` | | 从现有会话分叉出新会话 |
| `--session-dir <dir>` | | 自定义会话存储目录 |
| `--no-session` | | 不保存会话（临时） |
| `--name` | `-n` | 设置会话显示名称 |

**模型与 Provider（7 个）：**

| 参数 | 简写 | 说明 |
|------|------|------|
| `--provider <name>` | | Provider 名称（默认 `google`） |
| `--model <pattern>` | | 模型 ID，支持 `provider/id` 和 `:thinking` |
| `--api-key <key>` | | API 密钥 |
| `--models <patterns>` | | Ctrl+P 循环模型列表 |
| `--thinking <level>` | | off/minimal/low/medium/high/xhigh |
| `--list-models [search]` | | 列出可用模型 |
| `--system-prompt <text>` | | 自定义系统提示词 |

**工具控制（5 个）：**

| 参数 | 简写 | 说明 |
|------|------|------|
| `--no-tools` | `-nt` | 禁用所有工具 |
| `--no-builtin-tools` | `-nbt` | 禁用内置工具 |
| `--tools <names>` | `-t` | 工具允许列表 |
| `--exclude-tools <names>` | `-xt` | 工具拒绝列表 |
| `--max-turns <n>` | | 最大对话轮数 |

**扩展与技能（9 个）：**

| 参数 | 简写 | 说明 |
|------|------|------|
| `--extension <path>` | `-e` | 加载扩展 |
| `--no-extensions` | `-ne` | 禁用扩展 |
| `--skill <path>` | | 加载技能 |
| `--no-skills` | `-ns` | 禁用技能 |
| `--prompt-template <path>` | | 加载提示模板 |
| `--no-prompt-templates` | `-np` | 禁用模板 |
| `--theme <path>` | | 加载主题 |
| `--no-themes` | | 禁用主题 |
| `--no-context-files` | `-nc` | 禁用 AGENTS.md |

**执行模式（4 个）：**

| 参数 | 简写 | 说明 |
|------|------|------|
| `--print` | `-p` | 非交互模式 |
| `--mode <mode>` | | text/json/rpc |
| `--output-schema <json\|file>` | | JSON Schema 验证输出 |
| `--export <file>` | | 导出会话为 HTML |

**Bus 通信层（3 个，新增）：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--bus` | false | 启用 bus 模式 |
| `--bus-channel` | `"default"` | 注册的 channel 名称 |
| `--bus-socket` | `~/.pi/agent/bus.sock` | socket 文件路径 |

也支持环境变量：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `PI_BUS` | `0` | 启用 bus 模式 |
| `PI_BUS_CHANNEL` | `"default"` | channel 名称 |
| `PI_BUS_SOCKET` | `~/.pi/agent/bus.sock` | socket 路径 |

优先级：`CLI 参数 > 环境变量 > 默认值`

**安全与信任（3 个）：**

| 参数 | 简写 | 说明 |
|------|------|------|
| `--approve` | `-a` | 信任项目本地文件 |
| `--no-approve` | `-na` | 忽略项目本地文件 |
| `--offline` | | 禁用网络操作 |

**Agent（1 个）：**

| 参数 | 说明 |
|------|------|
| `--agent <name\|path>` | 使用命名 Agent（角色模板） |

**调试与信息（4 个）：**

| 参数 | 简写 | 说明 |
|------|------|------|
| `--verbose` | | 强制详细启动 |
| `--help` | `-h` | 帮助 |
| `--version` | `-v` | 版本 |
| `--append-system-prompt <text>` | | 追加到系统提示 |

### 2.3 扩展注册的标志

| 扩展 | 参数 | 类型 | 默认值 |
|------|------|------|--------|
| session-supervisor | `--disable-supervisor` | boolean | false |
| | `--supervisor-max-continues` | string | "5" |
| | `--supervisor-model` | string | "fast" |
| file-time-guard | `--file-time-check-mode` | string | "block" |
| | `--disable-file-time-check` | boolean | false |

### 2.4 四种运行模式

| 模式 | 触发 | 输出 |
|------|------|------|
| **interactive** | stdin + stdout 都是 TTY | TUI 渲染 |
| **print** | `-p` 或 stdin/stdout 非 TTY | 纯文本 |
| **json** | `--mode json` | JSON |
| **rpc** | `--mode rpc` | JSONL over stdin/stdout |

---

## 3. 生命周期与扩展钩子

### 3.1 完整生命周期

```
用户输入 → prompt()
  │
  ├── input 事件 (可拦截/转换)
  │
  ├── before_agent_start 事件 (可注入消息/修改 system prompt)
  │
  ├── agent_start 事件
  │
  ├── WHILE (还有 turn):
  │   ├── turn_start 事件
  │   │
  │   ├── context 事件 (可修改 messages)
  │   │
  │   ├── before_provider_request 事件
  │   ├── streamAssistantResponse() ← LLM 调用
  │   │     ├── message_start / message_update / message_end
  │   │     └── after_provider_response 事件
  │   │
  │   ├── [如果有 tool calls]:
  │   │   ├── tool_execution_start 事件
  │   │   ├── tool_call 事件 (可 block/修改参数 / beforeToolCall)
  │   │   ├── [执行工具]
  │   │   │     └── tool_execution_update
  │   │   ├── tool_result 事件 (可修改结果 / afterToolCall)
  │   │   └── tool_execution_end 事件
  │   │
  │   └── turn_end 事件
  │
  ├── agent_end 事件
  │
  ├── [后处理，最多 10 次]:
  │   ├── _prepareRetry → auto_retry_start/end
  │   ├── _checkCompaction → session_before_compact / session_compact
  │   └── [有排队消息] → auto_continue → agent.continue()
  │
  └── 结束
```

### 3.2 所有事件（29 个）

**Session 生命周期（8 个）：**

| 事件名 | 触发时机 | 可返回 |
|--------|---------|--------|
| `project_trust` | 项目信任评估 | `ProjectTrustEventResult` |
| `resources_discover` | 启动/重载 | `ResourcesDiscoverResult` |
| `session_start` | 会话启动 | — |
| `session_before_switch` | 切换会话前 | `{ cancel? }` |
| `session_before_fork` | 分叉前 | `{ cancel?, skipConversationRestore? }` |
| `session_before_compact` | 压缩前 | `{ cancel?, compaction? }` |
| `session_compact` | 压缩后 | — |
| `session_before_tree` | 树导航前 | `{ cancel?, summary?, customInstructions? }` |
| `session_tree` | 树导航后 | — |
| `session_shutdown` | 会话销毁 | — |
| `entries_invalidated` | 条目失效 | — |

**Agent 循环（9 个）：**

| 事件名 | 触发时机 | 可返回 |
|--------|---------|--------|
| `before_agent_start` | Agent 启动前 | `{ message?, systemPrompt? }` |
| `agent_start` | Agent 循环开始 | — |
| `agent_end` | Agent 循环结束 | — |
| `context` | LLM 调用前 | `{ messages? }` |
| `before_provider_request` | Provider 请求前 | — |
| `after_provider_response` | Provider 响应后 | — |
| `turn_start` | 每轮开始 | — |
| `turn_end` | 每轮结束 | — |
| `message_start` | 消息开始 | — |
| `message_update` | 流式更新中 | — |
| `message_end` | 消息完成 | `{ message? }` |

**工具执行（6 个）：**

| 事件名 | 触发时机 | 可返回 |
|--------|---------|--------|
| `tool_execution_start` | 工具开始 | — |
| `tool_execution_update` | 流式中 | — |
| `tool_execution_end` | 工具结束 | — |
| `tool_call` | 工具调用前 | `{ block?, reason? }` |
| `tool_result` | 工具调用后 | `{ content?, details?, isError? }` |
| `permission_request` | 权限检查 | `{ decision, message?, updatedInput? }` |

**模型/用户/UI（5 个）：**

| 事件名 | 触发时机 | 可返回 |
|--------|---------|--------|
| `model_select` | 模型切换 | — |
| `thinking_level_select` | 思考级别切换 | — |
| `user_bash` | 用户 `!` 命令 | `{ operations?, result? }` |
| `input` | 用户输入 | `{ action: "continue"\|"transform"\|"handled" }` |
| `ui` | 远程 UI 交互 | `UIEventResult` |

### 3.3 ExtensionAPI 完整接口

```typescript
interface ExtensionAPI {
  // === 事件订阅（29 个重载）===
  on(event, handler): void;

  // === 注册功能 ===
  registerTool(tool): void;
  registerCommand(name, opts): void;
  registerShortcut(keyId, opts): void;
  registerFlag(name, opts): void;
  registerMessageRenderer(type, renderer): void;
  registerChannel(name): Channel;

  // === 操作方法 ===
  sendMessage(msg, opts?): void;
  sendUserMessage(content, opts?): void;
  appendEntry(type, data?, opts?): void;
  deleteEntries(ids): void;
  summarizeEntries(ids, summary): void;
  setSessionName(name): void;
  getSessionName(): string | undefined;
  setLabel(entryId, label): void;
  setName(name): void;
  exec(command, args, opts?): Promise<ExecResult>;
  getActiveTools(): string[];
  getAllTools(): ToolInfo[];
  setActiveTools(names): void;
  setToolOperationsProvider(p): void;
  getToolOperationsProvider(): ToolOperationsProvider | undefined;
  getCommands(): SlashCommandInfo[];
  getFlag(name): boolean | string | undefined;
  setModel(model): Promise<boolean>;
  getThinkingLevel(): ThinkingLevel;

  // === 属性 ===
  readonly extensionName: string;
  readonly permissions: ExtensionPermissionRegistrationService;
}
```

---

## 4. 会话系统

### 4.1 JSONL 文件格式

文件扩展名 `.jsonl`，每行一个 JSON 对象，仅以 LF `\n` 分割。

```json
{"type":"session","version":3,"id":"uuidv7","timestamp":"...","cwd":"..."}
{"type":"message","id":"a1b2c3d4","parentId":null,"timestamp":"...","message":{...}}
{"type":"model_change","id":"b2c3d4e5","parentId":"a1b2c3d4","timestamp":"...","provider":"anthropic","modelId":"claude-sonnet-4"}
{"type":"thinking_level_change","id":"c3d4e5f6","parentId":"b2c3d4e5","timestamp":"...","thinkingLevel":"high"}
{"type":"agent_change","id":"d4e5f6a7","parentId":"c3d4e5f6","timestamp":"...","agentName":"build","agentConfig":{...}}
{"type":"compaction","id":"e5f6a7b8","parentId":"d4e5f6a7","timestamp":"...","summary":"...","firstKeptEntryId":"...","tokensBefore":150000}
{"type":"branch_summary","id":"f6a7b8c9","parentId":"e5f6a7b8","timestamp":"...","fromId":"...","summary":"..."}
{"type":"custom","id":"a7b8c9d0","parentId":"f6a7b8c9","timestamp":"...","customType":"ext-name","data":{...}}
{"type":"custom_message","id":"b8c9d0e1","parentId":"a7b8c9d0","timestamp":"...","customType":"ext-name","content":"...","display":true}
{"type":"label","id":"c9d0e1f2","parentId":"b8c9d0e1","timestamp":"...","targetId":"...","label":"important"}
{"type":"session_info","id":"d0e1f2a3","parentId":"c9d0e1f2","timestamp":"...","name":"My Session"}
{"type":"deletion","id":"e1f2a3b4","parentId":"d0e1f2a3","timestamp":"...","targetIds":["...", "..."]}
{"type":"segment_summary","id":"f2a3b4c5","parentId":"e1f2a3b4","timestamp":"...","targetIds":["..."],"summary":"..."}
{"type":"leaf_pointer","id":"a3b4c5d6","parentId":"f2a3b4c5","timestamp":"...","leafId":"..."}
{"type":"tier_models_change","id":"b4c5d6e7","parentId":"a3b4c5d6","timestamp":"...","tierModels":{"fast":"...","pro":"...","max":"..."}}
```

15 种条目类型的汇总：

| type | 核心字段 | 参与 LLM 上下文 |
|------|---------|---------------|
| `session` | version, id, cwd | ❌ 文件头 |
| `message` | message | ✅ |
| `model_change` | provider, modelId | ✅ |
| `thinking_level_change` | thinkingLevel | ✅ |
| `agent_change` | agentName, agentConfig | ✅ |
| `tier_models_change` | tierModels | ❌ |
| `compaction` | summary, firstKeptEntryId, tokensBefore | ❌ 标记 |
| `branch_summary` | fromId, summary | ❌ 标记 |
| `custom` | customType, data | ❌ |
| `custom_message` | customType, content, display | ✅ |
| `label` | targetId, label | ❌ |
| `session_info` | name | ❌ |
| `deletion` | targetIds | ❌ 标记 |
| `segment_summary` | targetIds, summary | ❌ 标记 |
| `leaf_pointer` | leafId | ❌ |

### 4.2 AgentMessage 类型

AgentMessage 是 pi-ai Message 的扩展，通过 TypeScript 声明合并追加了 4 种自定义消息类型：

```typescript
type AgentMessage =
  | UserMessage          // pi-ai 标准
  | AssistantMessage     // pi-ai 标准（含 usage, stopReason, thinking 等）
  | ToolResultMessage    // pi-ai 标准
  | BashExecutionMessage // 用户 ! 命令
  | CustomMessage<T>     // 扩展注入
  | BranchSummaryMessage // 分支摘要
  | CompactionSummaryMessage; // 压缩摘要
```

### 4.3 会话上下文重建算法

```
SessionManager.buildSessionContext()

1. 从根出发沿 parentId 链走到当前 leafId
2. 收集路径上的所有 entry
3. 过滤被 deletion/segment_summary/compaction/branch_summary 标记的 entry
4. 剩余 entry 按序：
   - message → 直接追加
   - custom_message → 转为 user 消息
   - model_change / thinking_level_change / agent_change → 影响配置
5. 返回 { messages, thinkingLevel, model }
```

---

## 5. RPC 协议

### 5.1 传输层

```
传输: stdin/stdout
编码: UTF-8
帧协议: JSONL（每行一个 JSON 对象，仅以 LF \n 分割）
序列化: JSON.stringify(value) + "\n"
```

### 5.2 请求格式

```json
{"id":"req_1","type":"prompt","message":"分析代码"}
{"id":"req_2","type":"get_state"}
{"id":"req_3","type":"set_model","provider":"anthropic","modelId":"claude-sonnet-4"}
```

### 5.3 响应格式

```json
// 成功
{"id":"req_1","type":"response","command":"prompt","success":true}

// 成功 + 数据
{"id":"req_2","type":"response","command":"get_state","success":true,"data":{...}}

// 失败
{"id":"req_3","type":"response","command":"set_model","success":false,"error":"Model not found"}
```

### 5.4 事件流（stdout 额外推送）

```json
{"type":"event","event":{"type":"agent_start"}}
{"type":"event","event":{"type":"turn_start","turnIndex":0}}
{"type":"event","event":{"type":"message_start","message":{...}}}
{"type":"event","event":{"type":"message_update","message":{...},"assistantMessageEvent":{...}}}
{"type":"event","event":{"type":"turn_end","turnIndex":0,"message":{...},"toolResults":[...]}}
{"type":"event","event":{"type":"agent_end","messages":[...]}}
{"type":"event","event":{"type":"model_select","model":{...},"previousModel":{...}}}
{"type":"event","event":{"type":"session_compact","compactionEntry":{...}}}
```

### 5.5 UI 交互

```json
// Agent 请求用户交互
{"type":"extension_ui_request","id":"ui-xxx","method":"confirm","title":"确认","message":"是否允许？"}

// 客户端响应
{"type":"extension_ui_response","id":"ui-xxx","confirmed":true}
```

支持的方法：`askUserQuestion`, `confirm`, `select`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`

### 5.6 全部 58 个命令

按类别分：

| 类别 | 命令数 | 命令 |
|------|--------|------|
| Prompting | 5 | prompt, steer, follow_up, continue, abort |
| 状态 | 1 | get_state |
| 模型 | 5 | set_model, cycle_model, get_available_models, get_tier_models, set_tier_models |
| 思考 | 2 | set_thinking_level, cycle_thinking_level |
| 队列 | 2 | set_steering_mode, set_follow_up_mode |
| 压缩 | 2 | compact, set_auto_compaction |
| 重试 | 2 | set_auto_retry, abort_retry |
| Bash | 2 | bash, abort_bash |
| 会话 | 14 | get_session_stats, export_html, switch_session, fork, copy_fork, navigate_tree, rollback_preview, delete_entries, summarize_entries, clone, get_fork_messages, get_last_assistant_text, set_session_name, new_session |
| 消息 | 8 | get_messages, get_full_messages, get_tree, get_tree_with_leaf, get_modified_files, get_file_diff, get_batch_diffs, get_file_history |
| 资源 | 4 | get_commands, get_skills, get_extensions, get_tools |
| 设置 | 2 | get_settings, set_settings |
| 其他 | 11 | get_context_usage, get_system_prompt, get_active_tools, set_active_tools, get_queue, clear_queue, get_flags, get_flag_values, set_flag, reload, set_cwd |
| Agent | 8 | get_agents_files, get_agents, switch_agent, get_current_agent, get_latest_agent_change, get_agent_detail, get_all_tools, set_permission_mode |
| MCP | 3 | get_mcp_servers, mcp_toggle_server, mcp_restart_server |
| 远程工具 | 3 | register_remote_tool, unregister_remote_tool, remote_tool_result |

---

## 6. RpcClient

### 6.1 设计

RpcClient 是一个**扁平的单层设计**。它 spawn 子进程 `pi --mode rpc`，通过 JSONL stdin/stdout 通信。**不包含嵌套的 Session/Agent 子对象**，所有操作都在 client 这一个实例上。

```
RpcClient
  ├── childProcess: ChildProcess
  │     ├── stdin  → JSONL 命令
  │     └── stdout → JSONL 响应 + 事件
  ├── pendingRequests: Map<id, Promise>
  ├── eventListeners: RpcEventListener[]
  └── channelHandlers: Map<name, Set<fn>>
```

### 6.2 方法分类（共 ~68 个）

| 分类 | 数量 | 方法 |
|------|------|------|
| 生命周期 | 2 | start(), stop() |
| 订阅/监听 | 3 | onEvent(), onRemoteToolCall(), channel() |
| 辅助 | 5 | waitForIdle(), collectEvents(), promptAndWait(), respondUI(), sendRemoteToolResult() |
| 调试 | 3 | getStderr(), getStdout(), getProcessSnapshot() |
| 命令 | ~55 | 所有 async 的 get\*/set\*/方法 |

---

## 7. Channel 系统

### 7.1 ChannelManager

```typescript
class ChannelManager {
  register(name: string): Channel;
  registerOrReplace(name: string): Channel;
  registerOrReuse(name: string): Channel;
  unregister(name: string): void;
  handleInbound(msg: ChannelDataMessage): void;  // 收到外部消息时调用
}

interface Channel {
  name: string;
  send(data: unknown): void;                          // 发送（无响应）
  onReceive(handler): () => void;                     // 订阅（返回取消函数）
  invoke(data, timeoutMs?): Promise<unknown>;          // 发送 + 等响应
  call(method, params, timeoutMs?): Promise<unknown>;  // 具名 invoke
}
```

### 7.2 注册的 Channel

所有扩展使用的 channel：

```
coordinator    ← Coordinator 扩展（委派任务、状态查询）
subagent       ← SubAgent 扩展（同步子任务）
bash           ← Bash 扩展
todo           ← Todo 扩展
lsp            ← LSP 扩展
learning       ← Learning 扩展
rules-engine   ← Rules 扩展
supervisor     ← Session Supervisor（旧 goal 扩展，将被 goal-vendor 替代）
goal           ← Goal Vendor（misunders2d/pi-goal 移植，合同制 + 机器验证）
remote-ssh     ← Remote SSH 扩展
```

### 7.3 当前通信模式（RPC）

```
ChannelManager outputFn → stdout JSONL
  → 外部进程管理器读取、路由
  → 目标进程 stdin
  → ChannelManager.handleInbound()
```

### 7.4 Bus 模式（新增）

```
ChannelManager outputFn → socket write
  → Bus 广播给所有连接的实例
  → 各实例的 ChannelManager.handleInbound()
  → 按 channel name 匹配，不匹配的丢弃
```

---

## 8. Bus 通信层

### 8.1 设计目标

去掉 Coordinator 扩展对外部进程管理器（`pi-agent-chat`）的依赖，将进程间通信内化到 pi 自身。

### 8.2 核心设计

```
每个机器上全局一个 Unix socket（默认 ~/.pi/agent/bus.sock）

所有加 --bus 的 pi 实例都连接到同一个 socket

消息按 channel name 广播 + 过滤

谁注册了这个 channel，谁处理。没注册的忽略。
```

### 8.3 自动协商

```
pi --bus
  │
  ├── 检查 bus.sock 是否存在
  │   ├── 不存在 → 自己创建 socket，成为 server
  │   └── 存在 → 连接，注册自己
  │
  └── 正常干活
```

**0 配置、0 额外命令。** 谁先到谁是 server，最后一个退出时清理 socket。

### 8.4 注册协议

```json
// 实例 → Bus（连接时发送）
{"type":"register","pid":12346,"channel":"default","sessionId":"01J...","status":"idle","model":"claude-sonnet-4","tokensUsed":15234,"agentName":"build","cwd":"/workspace/project","parentSessionId":"01J..."}

// 实例 → Bus（状态变化时）
{"type":"update","pid":12346,"status":"streaming","tokensUsed":16200}

// 实例 → Bus（退出时）
{"type":"unregister","pid":12346}
```

### 8.5 Bus 注册表

```typescript
class AgentBus {
  private peers: Map<number, PeerInfo>;   // pid → 实例信息
  private server: UnixSocket | null;      // 如果自己是 server

  listen(path: string): void;              // 创建 server
  connect(path: string): void;             // 连接已有 server

  // 对扩展暴露的方法
  spawn(options): Promise<SpawnResult>;            // spawn 子进程（自动带 --bus）
  spawnAndWait(options): Promise<SyncResult>;      // spawn + 等结果
  sessionSend(sessionId, msg, mode): void;          // 向指定实例发消息
  sessionStop(sessionId): void;                     // 停止指定实例
  list(filter?): PeerInfo[];                        // 列出在线实例

  // ChannelManager 对接
  output(msg: ChannelDataMessage): void;   // → socket write
  handleInbound(msg: ChannelDataMessage): void;  // ← socket read
}
```

### 8.6 与 Coordinator 集成

```typescript
// 当前：server-proxy.ts → 调外部
pm.delegate(task, projectPath, agent)
  → client.call("session_delegate", {...})
  → 外部进程 spawn 子进程

// 改成：bus 直接 spawn
bus.spawn({ args: ["--bus", "-p", task], cwd: projectPath })
  → child_process.spawn("node", ["dist/cli.js", "--bus", "-p", task], { cwd })
  → 子进程自动连上当前 socket
  → 父进程通过 channel 监控子进程状态
```

### 8.7 Coordinator 到 Bus 的替换对照

| ProcessManagerApi 方法 | Bus 实现 |
|-----------------------|---------|
| `delegate()` | `bus.spawn()` |
| `delegate_send()` | `bus.sessionSend()` |
| `delegate_status()` | `bus.list().find(sessionId)` |
| `delegate_list()` | `bus.list()` |
| `delegate_stop()` | `bus.sessionStop()` |
| `delegate_remove()` | `bus.sessionStop()` + `store.remove()` |
| `delegate_clear_stopped()` | 遍历清理 |
| `delegate_sync()` | `bus.spawnAndWait()` |

### 8.8 架构对比

```
当前（依赖外部管理器）：
  pi A → channel.send()
    → stdout JSONL
    → 外部 pi-agent-chat
    → 找到目标 pid → stdin
    → pi B 收到

有 Bus 后：
  pi A → channel.send()
    → socket write
    → Bus 广播
    → pi B 收到（channel 匹配）
    → pi C 忽略（channel 不匹配）
```

### 8.9 与 SubAgent 的集成

SubAgent 扩展**代码不改**。它调的是：

```typescript
coordinatorClient.call("session_delegate_sync", { task, agent, ... })
```

这条调用走的是 `Channel.call()`——底层 outputFn 从写 stdout 换成写 socket，对 SubAgent 完全透明。

---

## 9. 存储目录

### 9.1 全局目录 `~/.pi/agent/`

```
~/.pi/agent/
├── settings.json              ← 用户设置
├── auth.json                  ← API Key（权限 600）
├── models.json                ← 自定义模型
├── sessions/                  ← 会话 JSONL
│   └── --<hash>--/
│       ├── session.jsonl
│       ├── data/<sessionId>/<extName>/
│       │   └── coordinator-tasks.json  ← TaskStore
│       └── ...
├── extensions-data/           ← 扩展全局数据
├── project-data/              ← 扩展项目数据
├── cwd-data/                  ← 扩展 cwd 数据
├── projects/                  ← 项目用户状态
├── cache/
├── extensions/
├── skills/
├── prompts/
├── themes/
├── tools/
├── bin/
├── bus.sock                   ← Bus socket（新增）
└── pi-debug.log
```

### 9.2 系统临时目录 `os.tmpdir()`

```
/tmp/
├── pi-bash-<uuid>.log             ← Bash 输出溢出
├── pi-input-<uuid>.txt            ← 大输入溢出
├── pi-tool-results/<slug>/        ← 工具结果预算溢出
└── pi-clipboard-<uuid>.<ext>      ← 剪贴板图片
```

### 9.3 项目级目录 `<project>/.pi/`

```
<project>/.pi/
├── settings.json
├── extensions/
├── skills/
├── prompts/
├── rules/
├── rules-config.json
└── memory/
```

### 9.4 Worktree 目录

```
~/.pi/worktrees/<repoName>-<safeBranch>/
  └── git worktree
```

---

## 10. 模型配置

### 10.1 数据来源

```
源 A: models.dev API (https://models.dev/api.json)
源 B: OpenRouter API (https://openrouter.ai/api/v1/models)
源 C: Vercel AI Gateway (https://ai-gateway.vercel.sh/v1/models)
硬编码补充: scripts/generate-models.ts 中注入
```

生成脚本：`/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/ai/scripts/generate-models.ts`

生成产物：`/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/ai/src/models.generated.ts`

### 10.2 34 个 Provider，共 1039 个模型

| # | Provider | 模型数 | API 协议 |
|---|----------|--------|---------|
| 1 | openrouter | 255 | openai-completions |
| 2 | vercel-ai-gateway | 187 | anthropic-messages |
| 3 | amazon-bedrock | 105 | bedrock-converse-stream |
| 4 | opencode | 49 | 混合（4 种协议） |
| 5 | huggingface | 48 | openai-completions |
| 6 | openai | 42 | openai-responses |
| 7 | azure-openai-responses | 42 | azure-openai-responses |
| 8 | cloudflare-ai-gateway | 38 | 混合（3 种） |
| 9 | mistral | 30 | mistral-conversations |
| 10 | anthropic | 24 | anthropic-messages |
| 11 | github-copilot | 23 | 混合（3 种） |
| 12 | together | 20 | openai-completions |
| 13 | nvidia | 19 | openai-completions |
| 14 | fireworks | 16 | anthropic-messages |
| 15 | google | 16 | google-generative-ai |
| 16 | google-vertex | 13 | google-vertex |
| 17 | cloudflare-workers-ai | 13 | openai-completions |
| 18+ | ...其余 17 个 | 共 128 | 各种协议 |

### 10.3 单个模型结构

```typescript
{
  id: "claude-sonnet-4-20250514",
  name: "Claude Sonnet 4",
  api: "anthropic-messages",          // → 路由到哪个 Provider 实现
  provider: "anthropic",              // → 找哪个环境变量的 API key
  baseUrl: "https://api.anthropic.com/v1/",
  reasoning: true,
  thinkingLevelMap: { off: null, minimal: "minimal", ... },
  input: ["text", "image"],
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  contextWindow: 200000,
  maxTokens: 8192,
}
```

### 10.4 模型选择优先级

```
1. CLI: --provider + --model
2. CLI: --models 列表的第一个
3. settings.json: defaultProvider + defaultModel
4. 第一个有认证配置的 Provider 的默认模型
5. 任意可用 Provider 的第一个模型
```

### 10.5 认证检查

`getAvailable()` 只返回有认证的模型，检查顺序：

```
1. auth-storage 中保存的 API key
2. providerRequestConfigs 中的内联 apiKey
3. models.json 中配置的 apiKey
4. 环境变量 (ANTHROPIC_API_KEY 等)
5. OAuth 已认证
6. AWS/Google ADC 凭证
```

---

## 11. HTML 导出

### 11.1 模板文件

```
/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/export-html/
├── index.ts              ← 主逻辑 (exportFromFile / exportSessionToHtml)
├── template.html         ← HTML 骨架
├── template.css          ← 样式表 (1067 行)
├── template.js           ← 客户端渲染引擎 (1865 行)
├── tool-renderer.ts      ← 自定义工具 TUI→HTML 预渲染
├── ansi-to-html.ts       ← ANSI 转义码转 HTML
└── vendor/
    ├── marked.min.js     ← Markdown 渲染
    └── highlight.min.js  ← 代码高亮
```

### 11.2 输出结构

自包含单文件 HTML，所有 CSS/JS/数据内嵌：

```
output.html
├── <style> template.css + 主题变量
├── <aside id="sidebar">     ← 会话树（搜索 + 5 种过滤 + 树导航）
├── <main>
│   ├── <header>              ← 统计信息
│   │   ├── Date, Models, Messages, Tool Calls, Tokens, Cost
│   │   ├── System Prompt（可折叠）
│   │   └── Available Tools
│   └── <div id="messages">  ← 消息列表
├── <script> Base64 编码的 SessionData JSON
├── <script> marked.min.js + highlight.min.js + template.js
```

### 11.3 功能特性

- 树导航：会话树侧栏，点击跳转
- 5 种过滤：Default / No-tools / User / Labeled / All
- 搜索：实时过滤
- 键盘快捷键：`T` 切换 thinking，`O` 折叠工具输出
- 深色/浅色主题自适应
- 支持 custom 工具渲染
- 图片点击放大
- 下载原始 JSONL
- 分享链接（URL 含 leafId + targetId）
- 移动端适配
- 拖拽侧栏宽度

---

## 12. Agent 系统

### 12.1 `--agent` 参数

加载预定义的 Agent 配置（角色模板）。支持两种方式：

```bash
# 按名称自动发现
pi --agent read-only "Review this"

# 按文件路径加载
pi --agent ./agents/reviewer.md "Review this"
```

### 12.2 Agent 发现优先级

```
1. --agent 显式传参 > 2. 项目级 .pi/agents/*.md > 3. 全局 ~/.pi/agent/agents/*.md > 4. 内置 agent
```

### 12.3 内置 Agent（4 个）

| Agent | 描述 | tools | tier |
|-------|------|-------|------|
| `build` | 完整开发能力 | 无限制 | pro |
| `explore` | 只读探索 | read,grep,find,ls,bash（禁 edit,write） | fast |
| `plan` | 计划模式 | read,grep,find,ls（禁 edit,write,bash） | max |
| `ask` | 提问模式 | ask-user-question | max |

### 12.4 Agent 文件格式 (.md)

```markdown
---
name: read-only
description: Read-only code reviewer
tools: [read, grep, find, ls]
disallowedTools: [bash, edit, write]
permissionMode: normal
model: "openai/gpt-4o-mini"
tier: fast
thinkingLevel: high
maxTurns: 10
color: blue
memory: project
isolation: worktree
avatar: "🧑‍💻"
variables:
  targetDir: "src/"
paths:
  read: ["/workspace/src"]
  write: []
  bash: []
hooks:
  before_tool_call:
    - type: command
      command: "npm run lint"
      async: true
  before_agent_start:
    - type: prompt
      prompt: "请先列出所有需要修改的文件"
      once: true
---

这里是 system prompt 内容（markdown body）。
```

### 12.5 AgentConfig 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 名称 |
| `description` | string | ✅ | 描述 |
| `systemPrompt` | string | ✅ | body，覆写默认 system prompt |
| `tools` | string[] | ❌ | 工具 allowlist |
| `disallowedTools` | string[] | ❌ | 工具 denylist |
| `model` | string | ❌ | 默认模型 |
| `permissionMode` | string | ❌ | 权限模式 |
| `maxTurns` | number | ❌ | 最大轮数 |
| `tier` | fast/pro/max | ❌ | 层级标签 |
| `thinkingLevel` | string | ❌ | 思考级别 |
| `color` | string | ❌ | UI 颜色 |
| `avatar` | emoji/image | ❌ | 头像 |
| `variables` | Record<string, string> | ❌ | body 中 {{key}} 引用 |
| `paths` | PathConfig | ❌ | 路径权限 |
| `hooks` | AgentHooks | ❌ | 事件钩子（command/prompt/http） |
| `isolation` | worktree/remote | ❌ | 隔离模式 |

### 12.6 Hooks

三种类型：

| type | 触发方式 | 示例 |
|------|---------|------|
| `command` | 执行 Shell 命令 | `npm run lint` |
| `prompt` | 向 LLM 注入提示 | `"请先列出需要修改的文件"` |
| `http` | 发送 HTTP 请求 | `POST https://api.example.com/agent/start` |

支持挂载的事件点：所有 29 个扩展事件均可。

---

## 13. Tier 系统

### 13.1 默认别名

```typescript
// packages/coding-agent/src/core/defaults.ts
const DEFAULT_TIER_ALIASES = {
  fast: "openai-codex/gpt-5.5-codex-mini",
  pro:  "openai-codex/gpt-5.5",
  max:  "anthropic/claude-opus-4-8",
};
```

### 13.2 使用方式

```bash
# 直接在 CLI 中当模型用
pi --model fast "列出文件"
pi --model pro "分析代码"
pi --model max:high "解决复杂问题"
```

### 13.3 自动推断

当 tier 指向的模型不可用时，自动从可用模型中重新选择：

- **fast**：按关键词得分（flash +5, mini +4, fast +4, lite +3, air +2, reasoning -1）
- **max**：按公式 `(reasoning ? 10M : 0) + contextWindow + maxTokens`
- **pro**：当前正在使用的模型 → 非 fast 非 max 的任一模型 → fast

### 13.4 自定义

```json
// settings.json
{ "tierModels": { "fast": "deepseek/deepseek-v4-flash", "pro": "...", "max": "..." } }
```

---

## 附录：关键源码路径

| 组件 | 路径 |
|------|------|
| CLI 参数解析 | `packages/coding-agent/src/cli/args.ts` |
| 主入口 | `packages/coding-agent/src/main.ts` |
| AgentSession | `packages/coding-agent/src/core/agent-session.ts` |
| Agent Loop | `packages/agent/src/agent-loop.ts` |
| 扩展系统 | `packages/coding-agent/src/core/extensions/types.ts` |
| 扩展 Runner | `packages/coding-agent/src/core/extensions/runner.ts` |
| Session Manager | `packages/coding-agent/src/core/session-manager.ts` |
| 模型注册表 | `packages/coding-agent/src/core/model-registry.ts` |
| 模型解析 | `packages/coding-agent/src/core/model-resolver.ts` |
| 认证存储 | `packages/coding-agent/src/core/auth-storage.ts` |
| 设置管理 | `packages/coding-agent/src/core/settings-manager.ts` |
| 权限系统 | `packages/coding-agent/src/core/permissions/runtime.ts` |
| 存储路径 | `packages/coding-agent/src/core/storage.ts` |
| 路径配置 | `packages/coding-agent/src/config.ts` |
| RPC 模式 | `packages/coding-agent/src/modes/rpc/rpc-mode.ts` |
| RPC 类型 | `packages/coding-agent/src/modes/rpc/rpc-types.ts` |
| RPC 客户端 | `packages/coding-agent/src/modes/rpc/rpc-client.ts` |
| JSONL 序列化 | `packages/coding-agent/src/modes/rpc/jsonl.ts` |
| Channel 管理器 | `packages/coding-agent/src/core/extensions/channel-manager.ts` |
| Channel 类型 | `packages/coding-agent/src/core/extensions/channel-types.ts` |
| Channel 注册表 | `packages/coding-agent/src/core/extensions/channel-registry.ts` |
| Coordinator 扩展 | `packages/coding-agent/extensions/coordinator/` |
| Handler | `packages/coding-agent/extensions/coordinator/handler.ts` |
| Types | `packages/coding-agent/extensions/coordinator/types.ts` |
| Server Proxy | `packages/coding-agent/extensions/coordinator/server-proxy.ts` |
| Worktree 隔离 | `packages/coding-agent/extensions/coordinator/worktree-isolation.ts` |
| SubAgent 扩展 | `packages/coding-agent/extensions/subagent-v2/index.ts` |
| pi-ai 核心 | `packages/ai/src/types.ts` |
| pi-ai Provider 注册 | `packages/ai/src/api-registry.ts` |
| pi-ai 流式入口 | `packages/ai/src/stream.ts` |
| pi-ai 模型注册表 | `packages/ai/src/models.ts` |
| pi-ai 模型数据 | `packages/ai/src/models.generated.ts` |
| pi-ai Provider 示例 | `packages/ai/src/providers/anthropic.ts` |
| HTML 导出 | `packages/coding-agent/src/core/export-html/index.ts` |
| 模板 HTML | `packages/coding-agent/src/core/export-html/template.html` |
| 模板 CSS | `packages/coding-agent/src/core/export-html/template.css` |
| 模板 JS | `packages/coding-agent/src/core/export-html/template.js` |
| Agent 类型 | `packages/coding-agent/src/core/agent-types.ts` |
| Tier 别名 | `packages/coding-agent/src/core/defaults.ts` |
| Tier 推断 | `packages/coding-agent/src/core/tier-models.ts` |
| 模型生成脚本 | `packages/ai/scripts/generate-models.ts` |
