# Pi Rules Engine v2 — 技术文档

> 给 UI 集成方的对接文档。本插件在 pi coding agent 内部运行，通过 `rules-engine` Channel 与外部 UI 面板双向通信。

---

## 1. 架构总览

```
                          pi coding agent 进程
                    ┌─────────────────────────────────────┐
                    │                                     │
  .claude/rules/ ──┤  ┌─────────────────────────────┐    │
  .opencode/rules/ │  │     rules-engine 插件        │    │
  .pi/rules/     ──┤  │                             │    │
  ~/.claude/rules/ │  │  ┌─────┐ ┌───────┐ ┌─────┐ │    │
                    │  │  │types│ │matcher│ │cache│ │    │        外部 UI 面板
                    │  │  └─────┘ └───────┘ └─────┘ │    │        (Web / IDE / TUI)
                    │  │  ┌──────┐ ┌────────┐        │    │
                    │  │  │config│ │injector│        │    │
                    │  │  └──────┘ └────────┘        │    │
                    │  │  ┌──────┐ ┌──────┐          │    │
                    │  │  │loader│ │index │          │    │
                    │  │  └──────┘ │(入口)│          │    │
                    │  │           └──┬───┘          │    │
                    │  └──────────────┼──────────────┘    │
                    │                 │                    │
                    │          Channel "rules-engine"      │
                    │          (JSONL 双向 RPC)            │
                    └─────────────────┬────────────────────┘
                                      │
                              stdin/stdout JSONL
                                      │
                            ┌─────────┴──────────┐
                            │    RPC Client       │
                            │  (Web UI / IDE)     │
                            └────────────────────┘
```

## 2. 源码文件清单

```
packages/coding-agent/src/rules-engine/     # 源码 (714 行)
├── types.ts      (56行)  类型定义
├── matcher.ts    (43行)  glob 匹配引擎
├── loader.ts    (163行)  frontmatter 解析 + 文件扫描
├── config.ts     (67行)  多源配置加载
├── cache.ts      (38行)  TTL 缓存 + 去重
├── injector.ts   (67行)  system prompt / tool context / compact 注入
└── index.ts     (280行)  插件入口 (事件钩子 + 工具 + 命令)

packages/coding-agent/test/rules-engine/    # 测试 (1333 行, 96 个用例)
├── matcher.test.ts    (135行, 25 tests)
├── loader.test.ts     (256行, 30 tests)
├── config.test.ts     (148行, 12 tests)
├── injector.test.ts   (176行, 12 tests)
├── cache.test.ts      (132行,  7 tests)
└── lifecycle.test.ts  (486行, 10 tests)  ← 集成测试
```

## 3. 完整生命周期

### 3.1 时间线

```
  时间    事件名                 触发时机                  做了什么                        回收/清理
  ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  T1     session_start          会话启动/加载时             扫描4级目录                      设置 status bar
                                                           解析所有 .md 文件 frontmatter
                                                           分类: 无条件 vs 条件
                                                           写入缓存 (30s TTL)
                                                           Channel → 面板: 推送规则清单

  T2     before_agent_start     每轮 LLM 调用前            取缓存中无条件规则               无 (每轮重建)
                                                           拼接到 systemPrompt 末尾
                                                           Channel → 面板: prompt 长度

  T3     agent_start            Agent 循环开始             (观察记录)                       无

  T4     turn_start             每个 turn 开始             (观察记录)                       无

  T5     tool_call              read/grep/glob 后          提取目标文件路径                  无 (临时注入)
         (read/grep/glob)                                 glob 匹配条件规则
                                                           追加到 assistantMessage.content
                                                           严重级别 UI 通知
                                                           Channel → 面板: 匹配信息

  T6     turn_end               每个 turn 结束             (观察记录)                       无

  T7     agent_end              Agent 循环结束             Channel → 面板: 完成事件          无

  T8     session_compact        上下文压缩后               重新注入无条件规则                更新 status bar
                                                           Channel → 面板: 恢复通知

  T9     session_shutdown       会话关闭时                 清除 status bar                  清除 status bar
                                                           Channel → 面板: shutdown 事件
```

### 3.2 事件顺序图 (一次完整的 prompt 流程)

```
用户输入 prompt
    │
    ▼
input 事件
    │
    ▼
before_agent_start  ◄─── T2: 注入无条件规则到 systemPrompt
    │
    ▼
agent_start  ◄─── T3
    │
    ▼
context → before_provider_request → after_provider_response
    │
    ▼
turn_start  ◄─── T4
    │
    ▼
message_start → message_update* → message_end
    │  (如果 LLM 返回 tool_use)
    ▼
tool_call  ◄─── T5: read/grep/glob 时注入条件规则
    │
    ▼
tool_execution_start → tool_execution_update* → tool_execution_end
    │
    ▼
tool_result
    │
    ▼
turn_end  ◄─── T6
    │  (如果 stopReason === "tool_use", 回到 context)
    ▼
agent_end  ◄─── T7
```

## 4. Channel 通信协议

Channel 名称: `"rules-engine"`

传输格式: JSONL, 每条消息结构:

```json
{ "type": "channel_data", "name": "rules-engine", "data": { ... } }
```

### 4.1 插件 → 面板 (推送)

| 消息类型 | 时机 | data 结构 |
|---------|------|-----------|
| `session_start` | T1: 会话启动时 | 见下方 |
| `before_agent_start` | T2: 每轮 LLM 调用前 | 见下方 |
| `agent_end` | T7: Agent 循环结束 | `{ type: "agent_end" }` |
| `session_shutdown` | T9: 会话关闭 | `{ type: "session_shutdown" }` |

#### session_start 消息体 (面板最核心的数据源)

```json
{
  "type": "session_start",
  "totalRules": 5,
  "unconditional": 3,
  "conditional": 2,
  "rules": [
    {
      "name": "global-coding-standard",
      "title": "Global Coding Standard",
      "scope": "user",
      "source": "~/.claude/rules",
      "isUnconditional": true,
      "severity": "medium",
      "paths": []
    },
    {
      "name": "ts-strict",
      "title": "TypeScript Strict Mode",
      "scope": "project",
      "source": ".claude/rules",
      "isUnconditional": false,
      "severity": "high",
      "paths": ["src/**/*.ts", "src/**/*.tsx"]
    }
  ]
}
```

#### before_agent_start 消息体

```json
{
  "type": "before_agent_start",
  "systemPromptLength": 4523
}
```

### 4.2 面板 → 插件 (拉取/命令)

面板通过 `channel.call()` 发送 RPC 命令, 插件通过 `ServerChannel.handle()` 接收。

当前支持的方法:

| 方法 | params 结构 | 说明 |
|------|------------|------|
| `rules.getSnapshot` | `{ cwd?: string }` | 获取规则快照 (包含规则列表、匹配历史、生命周期日志) |

> **扩展点**: UI 集成方可以定义更多 RPC 方法, 只需在插件的 `channel.handle("method", fn)` 中注册。

### 4.3 使用示例 (RPC Client 端)

```javascript
const client = new RpcClient();

// 获取 channel
const rulesChannel = client.channel("rules-engine");

// 监听推送事件 (服务端通过 ServerChannel.emit() 主动推送)
rulesChannel.onReceive((data) => {
  if (data.type === "snapshot") {
    updateRulesPanel(data.rules);
    updateStats(data.totalRules, data.unconditional, data.conditional);
  }
  if (data.type === "injected") {
    showInjectedRules(data.injectedRuleNames);
  }
});

// RPC 调用 (自动注入 __call 路由字段)
const snapshot = await rulesChannel.call("rules.getSnapshot", { cwd: "/path/to/project" });
```

## 5. 数据模型

### 5.1 ParsedRule (单条规则)

```typescript
interface ParsedRule {
  name: string;              // 文件名去掉 .md (唯一标识)
  filePath: string;          // 磁盘绝对路径
  title: string;             // Markdown 首行 # 标题
  content: string;           // Markdown body (规则正文)
  scope: "user" | "pi" | "project" | "managed";  // 来源级别
  source: string;            // 目录路径标签 (展示用)
  frontmatter: RuleFrontmatter;
  isUnconditional: boolean;  // true = 始终注入 system prompt
}
```

### 5.2 RuleFrontmatter (元数据)

```typescript
interface RuleFrontmatter {
  paths?: string[];          // glob 模式列表 (空=无条件)
  description?: string;
  severity?: "critical" | "high" | "medium" | "low" | "hint";
  allowedTools?: string[];
  whenToUse?: string;
  // ... 其他可选字段
}
```

### 5.3 Scope 含义

| scope | 含义 | 默认扫描路径 |
|-------|------|-------------|
| `managed` | 运维管控 | `/etc/claude-code/.claude/rules` |
| `user` | 用户全局 | `~/.claude/rules/`, `~/.config/opencode/rules/` |
| `pi` | 项目 pi 配置 | `<project>/.pi/rules/` |
| `project` | 项目团队共享 | `<project>/.claude/rules/`, `<project>/.opencode/rules/`, `<project>/.trae/rules/` |

### 5.4 Severity 含义

| severity | 图标 | 面板建议展示 | 行为 |
|----------|------|-------------|------|
| `critical` | 🔴 | 红色高亮, 不可折叠 | 操作匹配文件前强制 warning 通知 |
| `high` | 🟠 | 橙色标记 | 操作匹配文件前 info 通知 |
| `medium` | 🟡 | 默认展示 | 静默注入 |
| `low` | 🔵 | 灰色/折叠 | 仅标注 |
| `hint` | 💡 | 折叠 | 仅标注 |

## 6. 配置系统

### 6.1 配置文件 (按优先级, 找到即停)

1. `<project>/.rules-config.json`
2. `<project>/.pi/rules-config.json`
3. `<project>/.claude/rules-config.json`
4. `<project>/.opencode/rules-config.json`

### 6.2 配置格式

```json
{
  "cacheTTL": 30000,
  "notifyOnLoad": true,
  "notifyOnMatch": true,
  "dirs": {
    "user": ["~/.claude/rules"],
    "pi": [".pi/rules"],
    "project": [".claude/rules", ".opencode/rules"],
    "managed": []
  }
}
```

### 6.3 规则文件格式

```markdown
---
paths: "src/**/*.{ts,tsx}"
severity: high
description: TypeScript strict mode enforcement
---

# TypeScript Strict Mode

Always use strict TypeScript configuration.
No `any` types unless absolutely necessary.
```

## 7. 缓存策略

| 策略 | 值 | 说明 |
|------|---|------|
| TTL | 30 秒 (可配置) | 过期后下次调用自动刷新 |
| 去重 | 按 `filePath` | 同一文件不重复加载 |
| 手动刷新 | `/rules reload` 或 `rules_reload` 工具 | 立即清缓存重读磁盘 |

## 8. 已注册的 LLM 工具

| 工具名 | 参数 | 说明 |
|--------|------|------|
| `rules_list` | 无 | 列出所有规则 (按 scope 分组, 含 severity) |
| `rules_match` | `filePath: string` | 检查路径匹配哪些条件规则 |
| `rules_reload` | 无 | 清缓存重读磁盘 |
| `rules_show` | `name: string` | 查看规则完整内容 |

## 9. 已注册的命令

```
/rules              → 等同 /rules list
/rules list         → 列出已加载规则摘要
/rules reload       → 重载规则
/rules check <path> → 检查路径匹配
/rules active       → 当前活跃规则概览
```

## 10. UI 集成建议

以下是 UI 面板方需要考虑的展示维度:

### 10.1 面板布局建议

```
┌─ Rules Engine ──────────────────────────────────────┐
│                                                      │
│  [Stats Bar]  Total: 5 | Unconditional: 3 | Cond: 2 │
│                                                      │
│  ┌─ Unconditional Rules ──────────────────────────┐  │
│  │ 🟡 Global Coding Standard     (user)           │  │
│  │ 🔴 Never Push Secrets        (project)         │  │
│  │ 🟡 Commit Conventions         (project)         │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌─ Conditional Rules ────────────────────────────┐  │
│  │ 🟠 TypeScript Strict   src/**/*.ts  (project)  │  │
│  │ 🟡 Test Standards     test/**/*.ts  (project)  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌─ Activity Log ─────────────────────────────────┐  │
│  │ 10:23:01 session_start: loaded 5 rules         │  │
│  │ 10:23:05 before_agent_start: prompt 4523 chars │  │
│  │ 10:23:08 tool_call(read): matched ts-strict    │  │
│  │ 10:23:12 agent_end                             │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  [🔄 Reload]  [🔍 Check Path...]                    │
└──────────────────────────────────────────────────────┘
```

### 10.2 关键交互点

| 用户操作 | Channel 消息 | 面板响应 |
|---------|-------------|---------|
| 打开项目 | 收到 `session_start` | 展示规则清单 + 统计 |
| Agent 开始回答 | 收到 `before_agent_start` | 显示 prompt 注入状态 |
| Agent 读文件 | 收到 tool_call 匹配通知 | 高亮匹配的条件规则 |
| Agent 完成 | 收到 `agent_end` | 标记空闲 |
| 上下文压缩 | 收到 compact 通知 | 显示"规则已恢复" |
| 关闭会话 | 收到 `session_shutdown` | 清空面板 |
| 点击 Reload | 发送 `{action:"reload"}` | 刷新规则列表 |
| 输入路径检查 | 发送 `{action:"check", path:...}` | 展示匹配结果 |

### 10.3 实时状态推送 (面板可订阅)

插件在每个生命周期节点通过 Channel 推送事件。面板可维护一个状态机:

```
IDLE ──session_start──→ LOADING ──rules_loaded──→ READY
READY ──before_agent_start──→ ACTIVE
ACTIVE ──tool_call──→ MATCHING (高亮匹配规则)
MATCHING ──turn_end──→ ACTIVE
ACTIVE ──agent_end──→ IDLE
任意 ──session_shutdown──→ DISPOSED
```

## 11. 测试验证

全部 96 个测试用例通过, 覆盖:

| 层级 | 测试 | 覆盖内容 |
|------|------|---------|
| 单元 | 86 个 | glob 匹配、frontmatter 解析、规则加载、配置发现、缓存 TTL、注入格式、幂等性 |
| 集成 | 10 个 | session_start 加载 → systemPrompt 注入 → 生命周期事件顺序 → Channel 双向通信 → shutdown 清理 |

运行命令:
```bash
cd packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/rules-engine/
```

## 12. 文件位置

| 文件 | 路径 |
|------|------|
| 插件源码 | `packages/coding-agent/src/rules-engine/` |
| 单元测试 | `packages/coding-agent/test/rules-engine/` |
| Channel 类型 | `packages/coding-agent/src/core/extensions/channel-types.ts` |
| Channel 管理器 | `packages/coding-agent/src/core/extensions/channel-manager.ts` |
| Channel 集成测试 | `packages/coding-agent/test/suite/agent-session-channel.test.ts` |
