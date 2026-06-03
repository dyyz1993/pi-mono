# 扩展功能验证报告

> 验证日期：2026-05-18（重写版，修正前版多处失实）
> 验证范围：packages/coding-agent/extensions/ 下全部 21 个目录（20 个可加载扩展 + 1 个共享库）
> 项目版本：0.74.49

## 验证方法

1. **源码审查**：逐个阅读每个扩展的 index.ts 及其辅助模块，记录工具/命令/Channel/事件
2. **类型安全扫描**：检查 `any` 类型、`as any`、`as unknown as` 双重断言、旧式 API 使用
3. **内联代码检测**：比对 subagent-v2 与 subagent-shared 的代码重复
4. **测试统计**：使用 `rg` 统计各测试文件中 `it(` + `test(` 块数量
5. **问题分级**：🔴 严重 / 🟡 中等 / 🟢 低

---

## 总览

| 扩展名 | index.ts 行数 | 工具 | Channel | 事件钩子 | 命令 | 状态 |
|--------|-------------|------|---------|---------|------|------|
| agent-permissions | 264 | 0 | 0 | 1 (tool_call) | 0 | ✅ |
| ask-tools | 115 | 5 | 0 | 0 | 0 | ✅ |
| auto-memory | 1165 | 1 | 1 (memory) | 6 | 0 | 🟡 |
| auto-session-title | 85 | 0 | 0 | 1 (turn_end) | 0 | ✅ |
| bash-ext | 936 | 2 | 1 (bash) | 1 (session_start) | 0 | ✅ |
| claude-hooks-compat | 183 | 0 | 0 | 10 | 0 | 🟡 |
| compaction-manager | 195 | 0 | 0 | 6 | 1 (compact-force) | ✅ |
| coordinator | 370 | 7 | 1 (coordinator) | 2 | 0 | 🟡 |
| file-review | 108 | 0 | 1 (file-review) | 4 | 0 | 🟡 |
| file-snapshot | 189 | 0 | 1 (file-snapshot) | 4 | 0 | 🟡 |
| file-time-guard | 181 | 0 | 0 | 3 | 1 (file-time-status) | ✅ |
| hooks-engine | 333 | 0 | 0 | 6 (动态) | 0 | 🟡 |
| lsp | 334 | 2 | 1 (lsp) | 5 | 2 | 🟡 |
| message-bridge | 225 | 0 | 0 | 2 | 0 | 🔴 |
| output-guard | 485 | 1 | 0 | 2 | 0 | ✅ |
| preview | 301 | 1 | 0 | 0 | 0 | ✅ |
| rules-engine | 622 | 4 | 1 (rules-engine) | 9 | 1 (rules) | ✅ |
| session-supervisor | 764 | 1 | 1 (supervisor) | 3 | 0 | 🟡 |
| subagent-shared | 4 (barrel) | — | — | — | — | ✅ (库) |
| subagent-v2 | 1005 | 2 | 1 (subagent) | 0 | 0 | 🟡 |
| todo-ext | 478 | 1 | 1 (todo) | 3 | 1 (todos) | ✅ |

---

## 详细验证结果

### 1. agent-permissions ✅

**功能**：Agent 权限模式拦截（auto/plan/dontAsk/always-allow/always-deny）

| 功能点 | 验证结果 |
|--------|---------|
| 事件钩子 | `tool_call` — 合法 |
| 权限模式 | 6 种模式均有对应 Rule |
| 白名单/黑名单 | `allowedTools`/`disallowedTools` 支持通配符和括号模式 |
| 危险 Bash 拦截 | 6 个正则模式（rm -rf、git push --force、--no-verify、sudo、chmod 777、.env） |
| plan 模式 | 只允许 READ_TOOLS，block EDIT_TOOLS + bash |
| 导出 | `createPermissionHandler` 可用于测试 |

**代码质量问题**：
- 多处 `as` 类型断言访问 `event.input` 和 `event.variables`（line 216, 227, 238, 252），但无 `any`

**问题**：无严重问题

---

### 2. ask-tools ✅

**功能**：注册 5 个交互式 UI 工具

| 工具名 | 对应 ctx.ui 方法 | 验证 |
|--------|-----------------|------|
| ask-confirm | ctx.ui.confirm | ✅ |
| ask-select | ctx.ui.select（支持 multiple） | ✅ |
| ask-input | ctx.ui.input | ✅ |
| ask-editor | ctx.ui.editor | ✅ |
| ask-notify | ctx.ui.notify | ✅ |

**代码质量问题**：
- `result as string[]`（line 67）和 `params.type as "info" | "warning" | "error"`（line 108）两处 `as` 断言

**问题**：无严重问题

---

### 3. auto-memory 🟡

**功能**：自动记忆管理（Prefetch + Extraction + Dream + Purification + Bookmark）

| 功能点 | 验证结果 |
|--------|---------|
| 工具：create_bookmark | ✅ 注册，参数 Schema 完整 |
| Channel：memory | ✅ 3 个 handle + 4 个 emit |
| 事件 | session_start / before_agent_start / context / tool_call / agent_end / session_shutdown — 全部合法 |
| Channel 实现 | ✅ 使用 `createTypedChannel<MemoryChannelContract>` |
| Skip 规则系统 | ✅ evaluateRules + addHistoryEntry + saveSkipWordStore |
| callLLM 重试 | ✅ 指数退避，429 rate limit 重试 |
| 辅助模块 | skip-rules.ts / prompts.ts / utils.ts / contract.ts — 全部存在 |

**🟡 问题**：
- `create_bookmark` 工具的 `execute` 返回硬编码 `"Not used in JSON mode"`（line ~586）。实际 Bookmark 创建通过 Channel `memory.userRemember` 触发。LLM 调用此工具无实际效果，description 可能误导。
- `MAX_RETRIES = 100`（line 918）— 极高的重试次数
- `countSessionsSince` 中 `_sinceMs` 参数未使用（line 824）
- 空 catch 块未记录错误（line 863）

---

### 4. auto-session-title ✅

**功能**：自动生成会话标题

| 功能点 | 验证结果 |
|--------|---------|
| 事件：turn_end | ✅ 仅 turnIndex === 0 触发 |
| 跳过条件 | ✅ 已有名称时跳过 |
| LLM 调用 | ✅ pi.callLLM()，maxTokens=30 |
| 标题清洗 | ✅ 去除 think 标签，截断 100 字符 |

**问题**：无。最简洁的扩展之一。

---

### 5. bash-ext ✅

**功能**：替代内置 bash 工具，增加 PID 管理和后台进程支持

| 功能点 | 验证结果 |
|--------|---------|
| 工具：bash + get_background_process | ✅ 参数 Schema 完整 |
| Channel：bash | ✅ 7 个 handle + 7 个 emit，使用 `createTypedChannel` |
| 后台模式 | ✅ backgroundAfter < timeout 才启用 |
| 进程生命周期 | ✅ start → output(流式) → end/error/terminated/background |
| 截断 | ✅ OutputCollector（50KB/2000 行） |

**代码质量问题**：
- `undefined as unknown as BashToolDetails` 双重断言（line 872, 932）
- 模块级全局可变状态（managed/history/deletedIds 在函数外声明，line 116-118）

**问题**：无严重问题

---

### 6. claude-hooks-compat 🟡

**功能**：Claude Code hooks.json 兼容层

| 功能点 | 验证结果 |
|--------|---------|
| 事件钩子 | 10 个，全部合法 |
| Hook 类型 | command / http / prompt — 3 种 |
| once 去重 | ✅ onceHandlers Set |
| 异步 hook | ✅ async + asyncRewake 支持 |
| 辅助模块 | config-loader / matcher / if-parser / stdin-builder / handler-runner — 全部存在 |

**🟡 问题**：
- `getCallLLM` 通过 `pi as unknown as Record<string, unknown>` 双重断言访问未公开 API（lines 173-182）— 绕过了 ExtensionAPI 的类型安全
- `process.env as Record<string, string>` 不安全断言（handler-runner.ts line 94）
- 多处 `(err as Error).message` 在 catch 中（handler-runner.ts lines 230, 292, 328）

---

### 7. compaction-manager ✅

**功能**：上下文压缩管理（Microcompact + ContextFold + SessionMemory + Reactive）

| 功能点 | 验证结果 |
|--------|---------|
| 配置加载 | ✅ .pi/compaction.json，fallback DEFAULT_CONFIG |
| 4 种策略 | ✅ microcompact / context-fold / session-memory / reactive |
| 命令：compact-force | ✅ ctx.compact() + 回调通知 |
| 辅助模块 | config / context-fold / microcompact / session-memory / reactive — 全部存在 |

**代码质量问题**：
- 模块级可变状态 `compactMetrics`（line 30）
- Non-null assertion `percent!.toFixed(0)`（lines 144, 153）

**问题**：无严重问题

---

### 8. coordinator 🟡

**功能**：会话委托/分叉/管理

| 功能点 | 验证结果 |
|--------|---------|
| 工具（7 个） | session_delegate / session_delegate_send / session_delegate_status / session_delegate_fork / session_delegate_stop / session_delegate_remove / session_delegate_clear_stopped — 全部唯一 |
| Channel：coordinator | ✅ 8 个 handle + 2 个 emit，使用 `createTypedChannel` |
| 事件 | session_start / context — 合法 |

**🟡 问题**：
- **15+ 处 `as` 类型断言**：所有 `client.call()` 返回值都通过 `as` 强制转型（lines 50, 54, 62, 72, 82, 91, 96, 109, 119），说明 typed channel 的类型安全在 RPC 调用层被完全绕过
- handler.ts 中所有 handle 的 `params` 参数都是 `unknown`，需要手动 `as` 断言（lines 136, 169, 184, 211, 222, 240）
- `null as number | null` 断言（lines 99-100, 103）

---

### 9. file-review 🟡

**功能**：Turn 级别的文件变更追踪

| 功能点 | 验证结果 |
|--------|---------|
| Channel：file-review | ✅ 5 个 handle（live/history/summary/fileHistory/clear），使用 `createTypedChannel` |
| 事件 | session_start / turn_start / tool_result / turn_end — 全部合法 |

**🟡 问题**：
- **跨层引用**：`import type { LiveChange } from "../../src/core/file-store/file-snapshot-manager.ts"`（index.ts line 3）— 扩展直接依赖宿主包的内部源文件，属于分层违规
- contract.ts 与 index.ts 中的导入路径扩展名不一致（`.js` vs `.ts`）

---

### 10. file-snapshot 🟡

**功能**：文件快照/回滚管理

| 功能点 | 验证结果 |
|--------|---------|
| Channel：file-snapshot | ✅ 9 个 handle（list/rollback/unrevert/get/restoreByHash/gc/prune/stats/enforceLimit），使用 `createTypedChannel` |
| 事件 | session_start / turn_end / session_tree / session_shutdown — 全部合法 |
| GC 配置 | ✅ 100MB 限制，30 天过期 |

**🟡 问题**：
- **5 处 inline import**（违反 AGENTS.md 规则）：
  ```typescript
  const git = (mgr as Record<string, unknown>).git as import("../../src/core/file-store/internal-git.js").InternalGit;
  ```
  出现在 lines 102, 110, 119, 127, 173。应使用顶层 import。
- `(mgr as Record<string, unknown>).git` 访问私有属性，fileSnapshotManager 的 `.git` 未在公开类型定义中暴露
- contract.ts 也有跨层引用 `../../src/core/file-store/internal-git.js` 和 `../../src/core/file-store/file-snapshot-manager.js`

---

### 11. file-time-guard ✅

**功能**：文件时间戳检查，防止读写过期文件

| 功能点 | 验证结果 |
|--------|---------|
| 事件 | session_start / session_shutdown / tool_call — 合法 |
| 命令：file-time-status | ✅ |
| 检查逻辑 | ✅ read 时记录 mtime/ctime/size，write/edit 时比对 |
| 模式：block/warn | ✅ |
| 忽略模式 | ✅ minimatch glob 匹配 |

**代码质量问题**：
- 模块级全局状态（fileRecords/fileConfigs，line 14-15）
- `event.input as { path: string }` 断言（line 74, 94）
- 中文字符串混入（用户提示消息和 description 中）

**问题**：无严重问题

---

### 12. hooks-engine 🟡

**功能**：AgentConfig.hooks 执行引擎

| 功能点 | 验证结果 |
|--------|---------|
| EVENT_MAP | 6 个事件映射，全部合法 |
| Hook 类型 | command / http / prompt — 3 种 |
| command hook | ✅ exit code 0=allow, 2=block, 3=ask；5s 默认超时 |
| http hook | ✅ POST JSON，403/4xx=block，60s 默认超时 |
| prompt hook | ✅ 注入 followUp 消息 |
| 导出函数 | parseHooks / matchesCondition / executeCommand / parseStdout / isHookGroup / groupMatches |

**🟡 问题**：
- **6 处 `as any`**（lines 87, 88, 96, 97, 161, 162）— 访问 `event.sessionId` 和 `event.cwd`，这些属性在事件类型中未声明但运行时存在
- HTTP hook 网络错误时静默返回 `{ ok: true }`（lines 180-182），安全风险 — 应 deny 或至少 warn

---

### 13. lsp 🟡

**功能**：LSP 服务器集成

**目录结构**：`extensions/lsp/lsp/`（嵌套两层，与其他扩展的扁平结构不一致）

| 功能点 | 验证结果 |
|--------|---------|
| 工具 | lsp + lsp_health — ✅ |
| 命令 | lsp-status + lsp — ✅ |
| Channel：lsp | ✅ 3 个 handle + 8 个 emit |
| 事件 | session_start / session_shutdown / agent_end + 子模块中 tool_result / agent_end — 合法 |
| 辅助模块 | client/ (registry, runtime, file-tracker, smart-file-tracker) + config/ + hooks/ + tools/ + utils/ + monitoring/ — 共 16 个 .ts 文件 |

**🟡 问题**：
- **目录嵌套**：`extensions/lsp/lsp/index.ts`，外层仅包含内层子目录
- **5 处 `any` 类型参数**：`pi.on("session_start", async (_event: any, ctx: any) =>`（index.ts line 105）、`pi.on("tool_result", async (event: any, ctx: any) =>`（writethrough.ts line 53）— 导入了正确类型却未使用
- runtime.ts 中 `as unknown as LspSubprocess` 和 `as unknown as ReadableStream<Uint8Array>` 双重断言（lines 585, 814）

---

### 14. message-bridge 🔴

**功能**：UI 交互转发到 Message Bridge 服务

| 功能点 | 验证结果 |
|--------|---------|
| 事件：ui | ✅ 拦截 confirm/select/input/editor/notify，转发到 Bridge |
| 事件：agent_end | ✅ 推送 assistant 回复，拉取用户回复注入回 Agent |
| stale 处理 | ✅ 所有 ctx.respondUI 调用都有 stale catch |

**🔴 问题**：
- **零类型导入**：整个文件没有 `import type { ExtensionAPI, ExtensionContext, ... }`，所有参数都是 `any`
  - `pi: any`（line 137）
  - `event: any`（lines 140, 205）
  - `ctx: any`（line 140）
  - `m: any`（lines 209, 211）
  - 共 7 处 `any`
- 5 处重复的 stale catch 模式应抽取为辅助函数
- 硬编码内部域名 `https://message-bridge.docker.19930810.xyz:8443`（line 30）

---

### 15. output-guard ✅

**功能**：全局输出截断兜底 + 工具限额优化 + PDF 提取

| 功能点 | 验证结果 |
|--------|---------|
| 事件：tool_result | ✅ 截断非自管理工具的输出（50KB/2000 行） |
| 事件：tool_call | ✅ find/ls 限额优化 |
| 工具：pdf_read | ✅ 参数 path/maxPages |
| 截断保存 | ✅ 全文保存到 disk |
| pdf_parse 降级 | ✅ 未安装时返回安装提示 |

**代码质量问题**：
- `await import("pdf-parse")` 动态导入（line 366）— 违反 AGENTS.md 的 "NEVER use inline imports" 规则，但作为可选依赖的懒加载是合理的
- `event.input as { limit?: number }` 断言（lines 303, 313）

**问题**：无严重问题

---

### 16. preview ✅

**功能**：预览资源（图片/URL/HTML/PDF/视频/音频/Markdown）

| 功能点 | 验证结果 |
|--------|---------|
| 工具：preview | ✅ 参数 source/title |
| 资源检测 | ✅ 17 种文件扩展名 + URL 检测 |
| 本地地址可达性 | ✅ TCP 端口检测 |
| 文件验证 | ✅ 存在性 + 目录检测 |
| 错误处理 | ✅ not_found / is_directory / unreachable |

**问题**：无

---

### 17. rules-engine ✅

**功能**：Agent 规则生命周期管理

| 功能点 | 验证结果 |
|--------|---------|
| 工具（4 个） | rules_list / rules_match / rules_reload / rules_show — 全部唯一 |
| Channel：rules-engine | ✅ 1 个 handle + 4 个 emit，使用 `createTypedChannel` |
| 命令：rules | ✅ list/reload/check/active 子命令 |
| 事件 | 9 个，全部合法 |
| 注入去重 | ✅ injectedRuleFiles + injectionByToolCallId 双索引 |
| 导出 | 9 个函数 + 14 个类型 |

**代码质量问题**：
- `rebuildMatchHistory` 中 messages 类型为 `unknown[]`（line 57），导致 ~12 处 `as Record<string, unknown>` 断言

**问题**：无严重问题

---

### 18. session-supervisor 🟡

**功能**：会话监督器（Guard 循环 + 自动续行）

| 功能点 | 验证结果 |
|--------|---------|
| 工具：supervisor_complete | ✅ summary 参数，Guard 检查通过才批准 |
| Channel：supervisor | ✅ 8 个 handle + 4 个 emit，使用 `createTypedChannel` |
| Flag（3 个） | disable-supervisor / supervisor-max-continues / supervisor-model |
| Guard 类型 | todo / specs / ci / keyword / custom |
| 事件 | session_start / agent_end / session_shutdown — 合法 |
| 辅助模块 | config / checker / scheduler / prompts / types — 全部存在 |

**🟡 问题**：
- `supervisor_complete` 工具使用原始 JSON schema 而非 typebox（lines 159-168），与其他工具不一致
- 硬编码 `/tmp/supervisor-debug.log`（index.ts line 32, config.ts line 8）
- `extractLastAssistantText` 中 `msg.content as Array<{ type: string; text?: string }>` 断言（lines 754-755）

---

### 19. subagent-shared ✅ (库模块)

**功能**：共享类型和工具函数

| 模块 | 内容 |
|------|------|
| contract.ts | SUBAGENT_CHANNEL_NAME / SubagentChannelContract / SubagentEventPayload |
| types.ts | DisplayItem / SingleResult / UsageStats |
| utils.ts | formatTokens / formatUsageStats / getFinalOutput / writePromptToTempFile / cleanupTempFiles 等 |
| render.ts | formatToolCall / renderSingleResult / aggregateUsage / renderDisplayItems |

**验证**：无默认导出（作为库被 subagent-ext 正确导入）。无 `any`、无旧式 API。

**问题**：无

---

### 20. subagent-v2 🟡

**功能**：子智能体（RPC mode，使用 RpcClient）

| 功能点 | 验证结果 |
|--------|---------|
| 工具 | subagent + subagent_resume — ✅ |
| Channel：subagent | ✅ 2 个 emit，使用 `createTypedChannel` |
| 后台模式 | ✅ background=true 异步执行 |
| 超时 + 宽限 | ✅ runWithTimeout + handleGracePeriod（30s steer） |
| 压缩感知 | ✅ 注入 compression-awareness 系统提示 |
| 父 Todo 传递 | ✅ PI_SUBAGENT + PI_PARENT_TODOS 环境变量 |

**🟡 问题**：
- **~309 行代码从 subagent-shared 内联而非 import**（index.ts lines 22-338）：
  - contract.ts 内容 → lines 22-47（~26 行）
  - types.ts 内容 → lines 50-83（~34 行）
  - utils.ts 内容 → lines 87-191（~105 行）
  - render.ts 内容 → lines 195-338（~144 行）
  - 修复 bug 时需同步维护两份代码，且有 4 行 `// ── Inlined from subagent-shared/...` 注释标明来源
- 中文字符串混入（lines 651, 881）：`子任务中断` / `子任务完成`
- contract.ts 虽有从 subagent-shared 的 re-export，但 index.ts 完全忽略它

---

### 21. todo-ext ✅

**功能**：LLM 管理的 Todo 列表

| 功能点 | 验证结果 |
|--------|---------|
| 工具：todo | ✅ 5 个 action（list/add/toggle/remove/clear） |
| Channel：todo | ✅ 7 个 emit，使用 `createTypedChannel` |
| 命令：todos | ✅ 显示所有 todo |
| 事件 | session_start / session_tree / context — 合法 |
| 持久化 | ✅ pi.appendEntry("todo", ...) |
| 子 Agent 模式 | ✅ PI_SUBAGENT=true 时注入只读父 todo |

**代码质量问题**：
- 2 处 `as any`（lines 101, 451）：`(_event as any).messages` — context 事件的 messages 属性未在类型中声明

**问题**：无严重问题

---

## 全局问题汇总

### 🔴 严重（1 个）

| # | 扩展 | 问题 |
|---|------|------|
| 1 | **message-bridge** | 零类型导入，7 处 `any` 类型参数（`pi: any`、`event: any`、`ctx: any`、`m: any`）。违反编码规范中禁止 `any` 的规则。整个扩展缺乏类型安全保护。 |

### 🟡 中等（8 个）

| # | 扩展 | 问题 |
|---|------|------|
| 1 | **auto-memory** | `create_bookmark` 工具 execute 返回 "Not used in JSON mode"，LLM 调用无实际效果 |
| 2 | **claude-hooks-compat** | 通过 `pi as unknown as Record<string, unknown>` 双重断言访问未公开 API（getCallLLM），绕过类型安全 |
| 3 | **coordinator** | 15+ 处 `as` 类型断言绕过 typed channel 的类型安全，所有 `client.call()` 返回值和 `params` 参数都是 `unknown` |
| 4 | **file-review / file-snapshot** | 跨层引用 `../../src/core/file-store/...`，扩展直接依赖宿主包内部源文件 |
| 5 | **hooks-engine** | 6 处 `as any` 访问未在事件类型中声明的属性（sessionId, cwd）；HTTP hook 网络错误时静默放行 |
| 6 | **lsp** | 目录嵌套两层 + 5 处 `any` 类型参数（导入了正确类型却未使用） |
| 7 | **session-supervisor** | 工具使用原始 JSON schema 而非 typebox；硬编码 `/tmp/supervisor-debug.log` |
| 8 | **subagent-v2** | ~309 行代码从 subagent-shared 内联而非 import，维护时需同步修改两处 |

### 🟢 低（4 个）

| # | 扩展 | 问题 |
|---|------|------|
| 1 | **bash-ext / compaction-manager / file-time-guard** | 模块级全局可变状态（函数外声明 Map/Set/对象） |
| 2 | **file-time-guard / subagent-v2** | 中文字符串混入用户消息和 description |
| 3 | **file-snapshot** | 5 处 inline import `as import("../../src/...").InternalGit`（违反 AGENTS.md 规则） |
| 4 | **todo-ext** | 2 处 `as any` 访问 `_event.messages` |

---

## 工具名冲突分析

| 工具名 | 注册扩展 | 冲突情况 |
|--------|---------|---------|
无工具名冲突。所有工具名唯一。

> 注：原报告声称 `subagent` 存在多扩展注册同名工具的冲突，但 `extensions/subagent/` 目录已被删除（commit `b5671f99`），`extensions/subagent-ext/` 也已删除，仅 subagent-v2 注册 `subagent` 工具。

---

## Channel 方法完整性

| Channel 名 | 扩展 | 实现方式 | handle 数 | emit 数 |
|------------|------|---------|----------|--------|
| bash | bash-ext | createTypedChannel | 7 | 7+ |
| coordinator | coordinator | createTypedChannel | 8 | 2 |
| file-review | file-review | createTypedChannel | 5 | 0 |
| file-snapshot | file-snapshot | createTypedChannel | 9 | 0 |
| lsp | lsp | createTypedChannel | 3 | 8 |
| memory | auto-memory | createTypedChannel | 3 | 4 |
| rules-engine | rules-engine | createTypedChannel | 1 | 4 |
| subagent | subagent-v2 | createTypedChannel | 0 | 2 |
| supervisor | session-supervisor | createTypedChannel | 8 | 4 |
| todo | todo-ext | createTypedChannel | 0 | 7 |

**所有 Channel 均使用 `createTypedChannel`**。无旧式 `onReceive` 用法。

---

## SystemPrompt 注入位置汇总

| 扩展 | 注入方式 | 注入位置 | 内容 |
|------|---------|---------|------|
| auto-memory | before_agent_start | systemPrompt 末尾拼接 | MEMORY_SYSTEM_PROMPT |
| auto-memory | context | user message 追加 | [Memory context] prefetch 结果 |
| rules-engine | before_agent_start | customMessage | 无条件规则的 systemReminder |
| rules-engine | tool_result | tool 输出追加 | 条件规则的 toolReminder |
| compaction-manager | context | 返回修改后的 messages | microcompact + strip thinking |
| todo-ext | context | user message 追加 | [Todo list] |
| coordinator | context | user message 追加 | active tasks prompt |
| session-supervisor | agent_end 后续 | followUp 消息 | 续行提示 |
| message-bridge | agent_end 后续 | user message 注入 | Bridge 拉取的用户回复 |
| subagent-v2 | 进程参数 | --append-system-prompt | compression-awareness |

---

## 功能测试结果

### 测试执行摘要

> 统计日期：2026-05-18
> 统计方法：`rg` 扫描所有 `it(` + `test(` 块
> 统计范围：packages/coding-agent/extensions/ 和 packages/coding-agent/test/

| 扩展 | 测试文件数 | 测试用例数 | 备注 |
|------|-----------|-----------|------|
| agent-permissions | 1 | 20 | |
| ask-tools | 3 | 21 | harness + e2e + rpc-e2e |
| auto-memory | 18 | 358 | 含 7 个 rpc e2e 测试文件 |
| auto-session-title | 1 | 10 | |
| bash-ext | 1 | 43 | |
| claude-hooks-compat | 3 | 71 | unit + e2e + rpc |
| compaction-manager | 6 | 86 | |
| coordinator | 6 | 124 | 含 handler 单元测试 + e2e + channel + lifecycle |
| file-review | 1 | 9 | |
| file-snapshot | 9 | 146 | 含 core manager/query/internal-git 测试 |
| file-time-guard | 0 | 0 | 无测试 |
| hooks-engine | 1 | 93 | |
| lsp | 6 | 109 | 含 clangd e2e |
| message-bridge | 1 | 11 | |
| output-guard | 2 | 21 | unit + extension test |
| preview | 1 | 26 | |
| rules-engine | 10 | 161 | |
| session-supervisor | 2 | 10 | |
| subagent-v2 | 1 | 10 | extract-parent-todos |
| todo-ext | 2 | 52 | unit + subagent mode |
| core extensions | 4 | 43 | channel/server-channel/wrapper |
| suite (agent-session/rollback/mcp) | 23 | 189 | 非特定扩展的核心测试 |
| suite/regressions | 23 | 77 | 回归测试 |

**扩展相关测试总计**：128 个文件，1,733 个测试用例。

### 无测试的扩展（1 个）

**file-time-guard** — 功能正常（TypeScript 编译通过 + 源码审查无严重问题），但缺少单元测试。

> 注：原报告列出 7 个无测试扩展，实际 file-review（9 个测试）、file-snapshot（146 个测试）、session-supervisor（10 个测试）、subagent-v2（10 个测试）均有测试覆盖。lsp 有 109 个测试。

---

## 结论

### 总体状态：✅ 可用，有 1 个严重 + 8 个中等问题需关注

**正面**：
- 21 个扩展目录全部通过 TypeScript 编译
- 所有事件名、API 调用均与 ExtensionAPI 接口匹配
- 所有本地模块引用均存在
- **所有 Channel 均使用 `createTypedChannel` 类型安全 API**，无旧式 `onReceive`
- 1,733 个测试用例覆盖 20/21 个扩展（仅 file-time-guard 无测试）

**需改进**：
- **1 个严重问题**：message-bridge 完全缺乏类型安全（零类型导入 + 7 处 any）
- **8 个中等问题**：bookmark 工具无效、跨层引用、类型断言绕过安全、内联代码、as any
- **4 个低等问题**：全局可变状态、中文混入、inline import、少量 as any

### 与前版报告的差异说明

| 前版声明 | 实际情况 |
|---------|---------|
| 24 个扩展目录 | 实际 21 个（`extensions/subagent/` 和 `extensions/subagent-ext/` 均已删除） |
| file-review/file-snapshot 使用旧式 `onReceive` | **错误**。两者均使用 `createTypedChannel` |
| file-snapshot 多处 `as any` | **错误**。使用 `as Record<string, unknown>`，无 `as any` |
| 测试总数 948/950 | **严重偏低**。实际 1,733 个测试用例 |
| auto-memory 修复 15 处源码文本损坏 | **无证据**。git 历史和源码中未找到相关改动 |
| 7 个扩展缺少测试 | **错误**。仅 file-time-guard 无测试 |
| hooks-engine "修复断言期望" | 实际是修改超时行为（allow→deny），非修复断言 |
| coordinator "修复硬编码时间戳" | 实际是 stopped task 清理逻辑修复，非时间戳问题 |
