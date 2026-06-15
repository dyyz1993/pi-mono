# Subtask 内核原语 + Skill Fork 模式 Spec

## Why

项目缺少通用的子任务执行原语。Skill fork、compaction（做梦）、隐藏式 agent 等功能都需要"在隔离上下文中执行一段任务"的能力。当前只有跨进程的 coordinator/subagent 扩展，缺少内存级、无依赖的内置方案。

## What Changes

- 新增 `runSubtask()` 内核原语（内存级，同进程，无 channel 依赖）
- Skill 工具支持 `context: fork` frontmatter 字段，自动调用 `runSubtask` 隔离执行
- Skill 接口新增 `context?: "inline" | "fork"` 字段
- 14 个 harness 集成测试覆盖所有字段和组合

## Impact

- Affected code: `src/core/subtask.ts`（新增）、`src/core/tools/skill.ts`、`src/core/skills.ts`、`src/core/agent-session.ts`、`src/core/index.ts`
- Affected tests: `test/suite/subtask.test.ts`（新增）、`test/suite/skill-tool.test.ts`（扩展）

---

## 所有字段清单

### SubtaskOptions（runSubtask 入参）

| # | 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|------|------|------|--------|------|
| 1 | `task` | `string` | 是 | - | 要执行的任务描述 |
| 2 | `agent` | `string` | 否 | - | 按 Agent.md 名称查找配置 |
| 3 | `agentConfig` | `AgentConfig` | 否 | - | 直接传入 agent 配置（与 agent 二选一） |
| 4 | `model` | `string` | 否 | 父会话模型 | 模型 ID 或 tier 关键字 |
| 5 | `maxTurns` | `number` | 否 | 无限制 | 最大 agent 轮数 |
| 6 | `tools` | `string[]` | 否 | 继承父会话 | 工具白名单 |
| 7 | `disallowedTools` | `string[]` | 否 | 无 | 工具黑名单 |
| 8 | `cwd` | `string` | 否 | 父会话 cwd | 工作目录 |
| 9 | `inheritTools` | `boolean` | 否 | `true` | 是否继承父会话工具 |
| 10 | `inheritHistory` | `boolean` | 否 | `false` | 是否继承父会话历史 |
| 11 | `inheritExtensions` | `boolean` | 否 | `true` | 是否继承父会话扩展 |

### SubtaskContext（父会话上下文）

| # | 字段 | 类型 | 必填 | 说明 |
|---|------|------|------|------|
| 1 | `modelRegistry` | `ModelRegistry` | 是 | 父会话的模型注册表 |
| 2 | `resourceLoader` | `ResourceLoader` | 是 | 父会话的资源加载器 |
| 3 | `model` | `Model<string>` | 是 | 父会话的当前模型 |
| 4 | `getApiKey` | `(provider) => string \| undefined` | 是 | API key 解析函数 |
| 5 | `cwd` | `string` | 是 | 父会话工作目录 |
| 6 | `messages` | `AgentMessage[]` | 否 | 父会话历史（inheritHistory 时用） |
| 7 | `systemPrompt` | `string` | 否 | 父会话 system prompt |

### SubtaskResult（返回值）

| # | 字段 | 类型 | 说明 |
|---|------|------|------|
| 1 | `text` | `string` | 最终结果文本 |
| 2 | `inputTokens` | `number` | 输入 token 消耗 |
| 3 | `outputTokens` | `number` | 输出 token 消耗 |
| 4 | `success` | `boolean` | 是否成功 |
| 5 | `error` | `string \| undefined` | 错误信息 |

### Skill Frontmatter 新增字段

| # | 字段 | 类型 | 默认值 | 说明 |
|---|------|------|--------|------|
| 1 | `context` | `"inline" \| "fork"` | `"inline"` | 执行模式：inline 注入主会话，fork 隔离子任务 |

### SkillToolOptions（skill 工具配置）

| # | 字段 | 类型 | 说明 |
|---|------|------|------|
| 1 | `getSkills` | `() => Skill[]` | 获取 skill 列表 |
| 2 | `subtaskContext` | `SubtaskContext \| undefined` | fork 模式需要的上下文 |

---

## 所有组合矩阵

### A. runSubtask 字段组合

| # | 组合 | 描述 | 测试方式 |
|---|------|------|---------|
| A1 | `task` only | 最小调用 | harness |
| A2 | `task` + `agentConfig` | 直接传入 agent 配置 | harness |
| A3 | `task` + `agent` (不存在) | agent 查找失败，仍然运行 | harness |
| A4 | `task` + `agent` (存在) | 从 Agent.md 加载配置 | harness + 真实文件 |
| A5 | `task` + `model` (有效 ID) | 指定模型 | harness |
| A6 | `task` + `model` (tier) | tier 关键字解析 | harness |
| A7 | `task` + `model` (无效) | 模型不存在，回退父模型 | harness |
| A8 | `task` + `maxTurns: 1` | 单轮限制 | harness |
| A9 | `task` + `maxTurns: N` | 多轮限制 | harness |
| A10 | `task` + `tools: ["read"]` | 白名单限制 | harness |
| A11 | `task` + `disallowedTools: ["write"]` | 黑名单限制 | harness |
| A12 | `task` + `tools` + `disallowedTools` | 白名单 + 黑名单叠加 | harness |
| A13 | `task` + `inheritHistory: false` | 不继承历史（默认） | harness |
| A14 | `task` + `inheritHistory: true` | 继承父会话历史 | harness |
| A15 | `task` + `cwd` 覆盖 | 指定工作目录 | harness |
| A16 | `task` + `inheritExtensions: false` | 不继承扩展 | harness |
| A17 | 错误场景：session 创建失败 | 异常处理 | harness |

### B. Skill 工具字段组合

| # | 组合 | 描述 | 测试方式 |
|---|------|------|---------|
| B1 | inline skill（默认） | 内容注入主会话 XML | harness |
| B2 | inline skill + `args` | 带参数的 inline | harness |
| B3 | inline skill（大小写不敏感） | 名称匹配忽略大小写 | harness |
| B4 | fork skill（`context: fork`） | 隔离子任务执行 | harness |
| B5 | fork skill + `args` | 带参数的 fork | harness |
| B6 | fork skill（无 subtaskContext） | 降级到 inline | harness |
| B7 | skill 不存在 | 返回错误 + 可用列表 | harness |
| B8 | skill 文件读取失败 | 异常处理 | harness |
| B9 | inline vs fork 结果对比 | 验证输出格式差异 | harness |

### C. 集成级组合（runSubtask + Skill + Agent.md）

| # | 组合 | 描述 | 测试方式 |
|---|------|------|---------|
| C1 | fork skill + agentConfig | skill fork 指定 agent | harness |
| C2 | fork skill + model 覆盖 | fork 子任务用不同模型 | harness |
| C3 | fork skill + tools 限制 | fork 子任务限制工具 | harness |
| C4 | fork skill + hooks | fork 子任务触发钩子 | harness |
| C5 | fork skill + 继承历史 | fork 子任务继承父会话上下文 | harness |
| C6 | fork skill + Agent.md 文件 | 从磁盘加载 agent 定义 | 真实文件 |

### D. 真实 LLM 验证

| # | 场景 | 描述 | 测试方式 |
|---|------|------|---------|
| D1 | inline skill 端到端 | 模型加载 skill 并执行 | 真实 LLM |
| D2 | fork skill 端到端 | 模型触发 fork 并返回结果 | 真实 LLM |
| D3 | fork skill + agent 指定 | 模型指定 agent 执行 | 真实 LLM |

---

## 测试优先级

### P0（核心，必须通过）
- A1, A2, A3, A13, A17 — runSubtask 基本功能
- B1, B4, B7, B9 — skill 工具核心路径

### P1（重要）
- A5, A8, A10, A11, A14, A15 — runSubtask 参数覆盖
- B2, B3, B5, B6, B8 — skill 工具参数和边界

### P2（增强）
- A4, A6, A7, A9, A12, A16 — runSubtask 高级组合
- C1-C6 — 集成级组合
- D1-D3 — 真实 LLM 端到端

---

## 当前测试覆盖状态

| 文件 | 测试数 | 覆盖的组合 |
|------|--------|-----------|
| `subtask.test.ts` | 10 | A1, A2, A3, A5, A8, A10, A11, A13, A14, A17 |
| `skill-tool.test.ts` | 8 | B1, B4, B6, B7, B9 |
| **总计** | **18** | **15/29 (52%)** |

### 缺失的测试

| 优先级 | 缺失组合 | 说明 |
|--------|---------|------|
| P1 | A6 (model tier) | tier 关键字解析为模型 ID |
| P1 | A7 (model 无效) | 无效模型回退到父模型 |
| P1 | A9 (maxTurns 多轮) | 多轮限制验证 |
| P1 | A12 (tools + disallowedTools) | 白名单和黑名单叠加 |
| P1 | A15 (cwd 覆盖) | 指定工作目录 |
| P1 | B2 (inline + args) | inline skill 带参数 |
| P1 | B3 (大小写不敏感) | skill 名称忽略大小写 |
| P1 | B5 (fork + args) | fork skill 带参数 |
| P1 | B8 (文件读取失败) | 异常处理 |
| P2 | A4 (agent 文件) | 从磁盘加载 agent |
| P2 | A16 (不继承扩展) | 扩展隔离 |
| P2 | C1-C6 (集成组合) | 多模块联动 |
| P2 | D1-D3 (真实 LLM) | 端到端验证 |
