# 历史数据与实时事件：数据结构差异与 WebUI 展示指南

> 本文档描述历史数据与实时事件的结构差异、拼接方案、WebUI 事件展示优先级和源码索引。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

## 历史数据 vs 实时事件：核心结论

**历史数据和实时事件不能直接拼接**，需要一层转换：

| 维度 | 历史数据（.jsonl 文件） | 实时事件（RPC 推送） |
|------|------------------------|---------------------|
| **载体** | `SessionEntry[]`（树结构，每行一个 entry） | `AgentEvent` / `AgentSessionEvent` 流（扁平事件流） |
| **消息包裹** | `SessionMessageEntry` 包裹 `AgentMessage` | `message_end.message` 直接就是 `AgentMessage` |
| **额外数据** | compaction/deletion/label/branch_summary/model_change/thinking_level_change/custom 等 | tool_execution_start/update/end、agent_start/end、queue_update、compaction_start/end 等 |
| **读取方式** | `buildSessionContext()` 做树遍历+压缩+删除过滤 | 逐条事件流式到达 |

### `buildSessionContext()` 是给 LLM 用的，不是给 UI 用的

`buildSessionContext()` 会**丢弃**以下 UI 需要的数据：

| Entry 类型 | `buildSessionContext` 处理 | UI 是否需要 |
|-----------|--------------------------|------------|
| `message` | ✅ 保留为 `AgentMessage` | ✅ 核心：消息内容 |
| `custom_message` | ✅ 转为 `CustomMessage` | ✅ 扩展消息 |
| `branch_summary` | ✅ 转为 `BranchSummaryMessage` | ✅ 分支切换提示 |
| `custom`（扩展私有数据） | ❌ **完全跳过** | ✅ 扩展状态恢复（如 ArtifactIndex） |
| `label`（用户书签） | ❌ **不输出** | ✅ 会话树书签导航 |
| `session_info`（会话名称） | ❌ **不输出** | ✅ 会话标题显示 |
| `deletion`（删除记录） | 仅用于**过滤掉**被删消息 | ✅ 可能需要显示"已删除"标记 |
| `model_change` | 只保留**最终值**，丢掉历史变更 | ✅ 显示模型变更时间线 |
| `thinking_level_change` | 只保留**最终值**，丢掉历史变更 | ✅ 显示思考模式变更时间线 |
| `compaction` | 旧消息被**丢弃**，只保留摘要 | ✅ 展示压缩了多少 token |
| `compaction.details` | 不在消息中体现 | ✅ 高级用户查看压缩质量 |

### 正确的 UI 数据获取方式

```typescript
const sm = SessionManager.open("/path/to/session.jsonl");

// ❌ 错误：丢数据，这是给 LLM 用的
const ctx = sm.buildSessionContext();

// ✅ 正确：获取全部原始 entries
const entries = sm.getEntries();     // SessionEntry[] — 所有原始数据
const tree = sm.getTree();           // SessionTreeNode[] — 带分支的完整树
const header = sm.getHeader();       // SessionHeader — id/cwd/version
const name = sm.getSessionName();    // string | undefined

// 从 entries 中分别提取 UI 需要的信息：
entries.filter(e => e.type === "message")               // 所有消息
entries.filter(e => e.type === "model_change")          // 模型变更历史
entries.filter(e => e.type === "thinking_level_change") // 思考级别历史
entries.filter(e => e.type === "custom")                // 扩展私有数据
entries.filter(e => e.type === "label")                 // 书签标记
entries.filter(e => e.type === "session_info")          // 会话元数据
entries.filter(e => e.type === "compaction")            // 压缩记录
entries.filter(e => e.type === "deletion")              // 删除记录
```

### 消息类型一致性

虽然 entries 和事件的数据结构不同，但**消息内容本身类型一致**：

```
历史: SessionMessageEntry.message  →  AgentMessage（从 .jsonl 读取）
实时: message_end.message          →  AgentMessage（从事件流获取）
                                        ↑ 类型相同，可直接拼接
```

**持久化映射**（`_processAgentEvent` 中）：

| AgentMessage.role | 持久化为 | 方法 |
|---|---|---|
| `"user"` | `SessionMessageEntry` (type:"message") | `appendMessage()` |
| `"assistant"` | `SessionMessageEntry` (type:"message") | `appendMessage()` |
| `"toolResult"` | `SessionMessageEntry` (type:"message") | `appendMessage()` |
| `"bashExecution"` | `SessionMessageEntry` (type:"message") | `appendMessage()` |
| `"custom"` | `CustomMessageEntry` (type:"custom_message") | `appendCustomMessageEntry()` |
| `"compactionSummary"` | `CompactionEntry` (type:"compaction") | `appendCompaction()` |
| `"branchSummary"` | `BranchSummaryEntry` (type:"branch_summary") | `branchWithSummary()` |

### Server API 设计建议

```
# 方案A：返回原始 entries，前端自行处理
GET /api/sessions/:id
→ {
    header: SessionHeader,
    entries: SessionEntry[],      // 全部原始数据，不丢
    tree: SessionTreeNode[],      // 带分支的树
    sessionName: string | undefined
  }

# 方案B：分层返回
GET /api/sessions/:id/messages
→ AgentMessage[]                // 给消息渲染用（buildSessionContext）

GET /api/sessions/:id/full
→ SessionEntry[]                // 给 UI 用（全部原始数据：model_change/label/custom 等）
```

### 拼接实时数据的方案

```
1. 加载历史: getEntries() → 自行处理为 UI 可用结构
   消息部分: 过滤 type="message" 的 entry → 取 .message → 得到 AgentMessage[]

2. 设置 Agent 初始状态: new Agent({ initialState: { messages: historyMessages } })

3. 实时运行:
   - message_update 事件 → 渲染流式部分（StreamingMessageContainer）
   - message_end 事件   → 新 AgentMessage 自动进入 state.messages
   - model_change 等事件 → 推送给前端更新状态栏

4. 前端 MessageList 只看 AgentMessage[]
   不区分消息来自历史还是实时
```

### 实时事件中缺失的信息

实时 RPC 事件流 **没有推送** 这些 entry 级别的信息，Server 需要额外处理：

| 数据 | 如何获取 |
|------|---------|
| `model_change` | 通过 `get_state` 命令轮询，或对比前后 state 差异 |
| `thinking_level_change` | 同上 |
| `custom`（扩展数据） | 扩展通过 channel 协议或 `appendEntry` 自行管理 |
| `label` / `session_info` | 需要单独的 RPC 命令（`set_session_name` 已有） |
| `deletion` | 无 RPC 命令，仅 TUI 操作 |

---

## WebUI 事件展示优先级

### 第一梯队：必须展示（直接影响用户理解和操作）

| 事件/数据 | 展示形式 | 完整 payload | 理由 |
|-----------|---------|-------------|------|
| **`message_start`** | 开始渲染消息气泡 | `{ type: "message_start"; message: AgentMessage }` | 消息渲染起点 |
| **`message_update`** | 流式更新文本/工具调用 | `{ type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }` | 实时流式输出 |
| **`message_end`** | 消息完成，加入稳定列表 | `{ type: "message_end"; message: AgentMessage }` | 消息渲染终点，触发持久化 |
| **`tool_execution_start`** | 工具执行指示器 | `{ type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }` | 用户需要知道 agent 在干什么 |
| **`tool_execution_update`** | 工具执行中间进度 | `{ type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }` | 长时间工具调用时给反馈 |
| **`tool_execution_end`** | 工具执行结果 | `{ type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }` | 用户审查 agent 操作 |
| **`compaction_start`** | 状态提示 "上下文压缩中..." | `{ type: "compaction_start"; reason: "manual" \| "threshold" \| "overflow" }` | 避免用户困惑为什么停顿 |
| **`compaction_end`** | 状态提示 "节省了 XX tokens" | `{ type: "compaction_end"; reason: string; result: CompactionResult \| undefined; aborted: boolean; willRetry: boolean; errorMessage?: string }` | 压缩结果通知 |
| **`auto_retry_start`** | 警告 "服务过载，第 2/3 次重试" | `{ type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }` | 用户需要知道为什么停了 |
| **`auto_retry_end`** (failure) | 错误提示 | `{ type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }` | 用户需要知道出错了 |

### 第二梯队：应该展示（提升体验和透明度）

| 事件/数据 | 展示形式 | 获取方式 | 理由 |
|-----------|---------|---------|------|
| **`model_change`** (历史 entry) | 时间线标记 "切换到 Claude Sonnet 4.5" | 历史entries中 `type: "model_change"`；实时通过 `get_state` 前后对比 | 用户需知道哪段对话用的什么模型 |
| **`thinking_level_change`** (历史 entry) | 状态栏思考模式指示器 | 历史entries中 `type: "thinking_level_change"`；实时通过 `get_state` 前后对比 | 用户需看到并控制思考深度 |
| **`queue_update`** | 排队消息数 "2 条排队消息" | 实时事件 `{ type: "queue_update"; steering: string[]; followUp: string[] }` | steer/followUp 排队状态 |
| **`agent_start`** | UI 状态切换：idle → thinking | 实时事件 `{ type: "agent_start" }` | 驱动 UI 状态机（动画、按钮禁用） |
| **`agent_end`** | UI 状态切换：thinking → idle | 实时事件 `{ type: "agent_end"; messages: AgentMessage[] }` | 恢复可操作状态 |
| **`bashExecution`** 消息 | 终端风格代码块 + 输出 | 消息中 `role: "bashExecution"`：`{ command, output, exitCode, cancelled, truncated, fullOutputPath }` | bash 是最常用工具，需突出展示 |

### 第三梯队：可选展示（高级用户/调试）

| 事件/数据 | 展示形式 | 获取方式 | 理由 |
|-----------|---------|---------|------|
| **`compaction`** entry 的 `details` | 折叠 "读取了 5 个文件，修改了 3 个" | 历史entry `{ type: "compaction"; details?: { readFiles: string[]; modifiedFiles: string[] } }` | 高级用户关心压缩质量 |
| **`label`** entry | 会话树中的标记点 | 历史entry `{ type: "label"; targetId: string; label: string \| undefined }` | TUI 中打了书签，WebUI 应显示 |
| **`session_info`** entry | 会话标题编辑 | 历史entry `{ type: "session_info"; name?: string }`；实时 RPC `set_session_name` | 会话管理 |
| **`custom`** entry | 扩展自行决定渲染 | 历史entry `{ type: "custom"; customType: string; data?: T }` | ArtifactIndex、扩展状态等 |
| **`deletion`** entry | 已删除消息灰色显示或隐藏 | 历史entry `{ type: "deletion"; targetIds: string[] }` | 用户可能想看到/恢复已删除内容 |
| **`branch_summary`** entry | 分支切换提示 | 历史entry `{ type: "branch_summary"; fromId: string; summary: string }` | 多分支导航时需要上下文 |

### 不需要展示的

| 事件/数据 | 理由 |
|-----------|------|
| **`turn_start/end`** | 内部概念，用户不关心"turn" |
| **`segment_summary`** | 内部压缩机制，对用户透明 |
| **`session`** header | 元数据，不需要展示 |
| **`custom_message`** (display=false) | 扩展标记不展示的消息 |

### 完整事件流 → UI 渲染映射

```
实时事件流（WebSocket 推送）                    UI 组件
──────────────────────────────                 ────────────────

agent_start                                 → 状态栏: idle → thinking
                                               输入框: disabled

message_start (user)                        → MessageList: 添加用户消息气泡
message_end (user)                          → MessageList: 用户消息稳定

message_start (assistant)                   → StreamingContainer: 开始
message_update (assistant)                  → StreamingContainer: 流式文本/工具调用
  └─ content.type="text"                    →   文本逐字渲染
  └─ content.type="thinking"                →   思维链折叠展示
  └─ content.type="toolCall"                →   工具调用卡片（等待执行）

tool_execution_start                        → 工具卡片: "正在执行 bash..."
tool_execution_update                       → 工具卡片: 部分输出
tool_execution_end                          → 工具卡片: 完整结果 + 错误状态

message_update (assistant, 继续流式)         → StreamingContainer: 工具结果后的继续输出
message_end (assistant)                     → MessageList: 助手消息稳定
                                               StreamingContainer: 清空

turn_end                                    → (内部，不展示)
turn_start (下一轮)                          → (内部，不展示)
  └─ 重复 message_start/update/end 循环

compaction_start                            → 状态提示: "上下文压缩中..."
compaction_end                              → 状态提示: "节省了 73000 tokens"

auto_retry_start                            → 警告提示: "服务过载，重试中 (2/3)..."
auto_retry_end                              → 成功: 静默; 失败: 错误提示

queue_update                                → 排队指示器: "2 条排队消息"

agent_end                                   → 状态栏: thinking → idle
                                               输入框: enabled
```

### 历史数据加载 → UI 渲染映射

```
getEntries() 返回 SessionEntry[]             UI 组件
────────────────────────────                 ────────────────

type: "message" (role: "user")             → 用户消息气泡
type: "message" (role: "assistant")        → 助手消息气泡 + 工具调用卡片
type: "message" (role: "toolResult")       → 工具结果（内联到对应助手消息）
type: "message" (role: "bashExecution")    → 终端风格代码块
type: "message" (role: "custom")           → 扩展自定义渲染
type: "custom_message"                     → 扩展自定义渲染

type: "model_change"                       → 时间线标记: "切换到 GPT-4o"
type: "thinking_level_change"              → 时间线标记: "思考模式: high"
type: "compaction"                         → 时间线标记: "上下文压缩 (节省 73K tokens)"
type: "label"                              → 会话树书签图标
type: "session_info"                       → 会话标题
type: "custom"                             → 扩展状态恢复（不可见）
type: "deletion"                           → 标记对应消息为已删除（灰色/隐藏）
type: "branch_summary"                     → 分支切换提示
type: "segment_summary"                    → 消息段摘要（替换被摘要的原始消息）

SessionHeader                              → 会话 ID / 项目路径 / 创建时间
```

---

## 源码文件索引

### RPC 协议层

| 文件 | 说明 |
|------|------|
| `packages/coding-agent/src/modes/rpc/rpc-types.ts` | RPC 命令/响应/事件类型定义 |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` | RPC 模式主逻辑（命令处理、扩展 UI 代理） |
| `packages/coding-agent/src/modes/rpc/rpc-client.ts` | RPC 客户端（TypeScript API 封装） |
| `packages/coding-agent/src/modes/rpc/jsonl.ts` | JSONL 序列化/反序列化工具 |

### Agent 核心

| 文件 | 说明 |
|------|------|
| `packages/agent/src/types.ts` | AgentEvent, AgentState, AgentTool, ThinkingLevel 等核心类型 |
| `packages/agent/src/agent.ts` | Agent 类（事件系统、steer/followUp 队列、prompt/abort） |
| `packages/agent/src/agent-loop.ts` | 底层 agent loop（LLM 调用循环） |

### AgentSession（coding-agent 层）

| 文件 | 说明 |
|------|------|
| `packages/coding-agent/src/core/agent-session.ts` | AgentSession 类（会话持久化、模型管理、压缩、重试） |
| `packages/coding-agent/src/core/agent-session-runtime.ts` | AgentSessionRuntime（模式无关的运行时宿主） |
| `packages/coding-agent/src/core/session-manager.ts` | SessionManager（JSONL 会话文件管理、list/listAll/open/create） |
| `packages/coding-agent/src/core/messages.ts` | 自定义消息类型（BashExecutionMessage, CustomMessage 等） |
| `packages/coding-agent/src/core/bash-executor.ts` | Bash 执行器（BashResult 类型） |
| `packages/coding-agent/src/core/compaction/compaction.ts` | 上下文压缩逻辑（CompactionResult 类型） |
| `packages/coding-agent/src/core/extensions/index.ts` | 扩展系统类型导出 |
| `packages/coding-agent/src/core/extensions/channel-types.ts` | Channel 数据消息类型 |

### 配置与路径

| 文件 | 说明 |
|------|------|
| `packages/coding-agent/src/config.ts` | 配置路径（getAgentDir, getSessionsDir, findCanonicalGitRoot） |
| `packages/coding-agent/src/core/model-registry.ts` | 模型注册表（API key 解析、模型发现） |
| `packages/coding-agent/src/core/settings-manager.ts` | 设置管理器（默认模型、重试设置等） |

### AI Provider 层

| 文件 | 说明 |
|------|------|
| `packages/ai/src/types.ts` | Message, Model, Usage, AssistantMessage 等基础类型 |
| `packages/ai/src/providers/` | 各 LLM provider 实现 |

### Web UI 层

| 文件 | 说明 |
|------|------|
| `packages/web-ui/src/ChatPanel.ts` | 聊天面板（Artifacts 集成） |
| `packages/web-ui/src/components/AgentInterface.ts` | Agent 交互界面（消息列表、输入、状态） |
| `packages/web-ui/src/components/MessageEditor.ts` | 消息编辑器 |
| `packages/web-ui/src/components/MessageList.ts` | 消息列表 |
| `packages/web-ui/src/components/StreamingMessageContainer.ts` | 流式消息容器 |
| `packages/web-ui/src/storage/` | 存储层（IndexedDB, settings, sessions） |
| `packages/web-ui/example/src/main.ts` | WebUI 示例应用（完整集成示例） |
