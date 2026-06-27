# Session-Supervisor Forensic 日志系统

> 用于事后还原 Gold 检查决策链，诊断"明明没结束但提前结束"的问题。

## 背景

`session-supervisor` extension 的 Gold 检查（`goldResult`）在每次 Agent 结束后自动判断"任务是否完成"。当前实现依赖默认 keyword guard + small model 检查，但**缺少决策过程的痕迹记录**，导致用户反馈"明明没结束但提前结束"时，无法事后还原案发现场。

目前已有的 `triggerLog` 只记录了**结果**（verdict、confidence），但缺少**输入**：
- Agent 最后一轮说了什么？
- Small model 收到了什么消息、返回了什么 raw 响应？
- 每个 guard 返回了什么 remaining items？
- Scheduler 是否耗尽了？停滞检测是否误触发？

## 记录类型

在每个关键决策点记录结构化 JSONL 到 `<sessionDataDir>/forensic/forensic.jsonl`，覆盖以下记录类型：

| 记录类型 | 记录内容 |
|---------|---------|
| `session_start` | enabled、guard 数量、smallModel、maxContinue |
| `agent_end_triggered` | 每次 agent 结束时的状态和配置 |
| `agent_end_skipped` | 为什么跳过了检查 |
| `guard_check_start / guard_check_end` | 每个 guard 的输入输出、耗时、remaining items |
| `model_check_start / model_check_parsed / model_check_error` | **小模型收到了什么、返回了什么** |
| `gold_result_emitted` | 每次 goldResult 的完整内容（verdict/reason/evidence） |
| `stagnation_detected` | 停滞检测时的 guard 签名 |
| `continue_scheduled / scheduler_exhausted` | 调度信息 |
| `supervisor_complete_called / goal_set / goal_status_changed` | 其他关键事件 |

## 方案

### 新增文件

1. **`extensions/session-supervisor/forensic.ts`** — 日志写入 + 读取 API
2. **`extensions/session-supervisor/forensic-reader.ts`** — 诊断工具 CLI

### 修改文件

| 文件 | 改动 |
|------|------|
| `extensions/session-supervisor/index.ts` | 在关键决策点插入 `appendForensic()` 调用 |
| `extensions/session-supervisor/checker.ts` | 模型检查前后记录输入/输出 |

### 用法

```bash
# 1. 列出最近有 forensic 数据的 session
npx tsx dist/extensions/session-supervisor/forensic-reader.ts --sessions

# 2. 查看最新的一个
npx tsx dist/extensions/session-supervisor/forensic-reader.ts --last

# 3. 按 session ID 查
npx tsx dist/extensions/session-supervisor/forensic-reader.ts <sessionId>

# 4. 直接指向 session data 目录
npx tsx dist/extensions/session-supervisor/forensic-reader.ts --session-data-dir /path/to/data
```

### 输出示例

```
============================================================
  SUPERVISOR FORENSIC REPORT
============================================================

📅 Session started: enabled=true, guards=1, smallModel=fast
🎯 Goal set: 修复 bug

🛡  Guard Checks:
   ✅ incomplete-keywords(keyword) completed=true conf=1...

🧠 Model Checks (1):
   ❌ INCOMPLETE conf=0.7, reasoning=320ch

🥇 Gold Results (2):
   🔄 incomplete conf=0.9 reason: Model detected incomplete tasks...
   ✅ complete conf=0.95 reason: All guards and model check passed.

⏩ Continue Schedule (1):
   🔄 count=1/5 delay=30000ms shouldPause=false
```

### 讨论点

1. 是否应该默认开启此日志（少量 IO 开销，但极大提升可调试性）？
2. `model_check_raw_input` 记录完整消息内容，可能包含文件内容，是否需要截断或开关？
3. 日志文件是否需要日志轮转或最大大小限制？
