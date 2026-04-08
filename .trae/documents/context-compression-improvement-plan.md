# Context Compression — Tool Result Scoring System

## 核心思路

不同工具的结果价值差异巨大，需要一个评分系统来决定压缩策略：

```
┌──────────────────────────────────────────────────────────────┐
│                    Tool Result 评分体系                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Score = BaseScore(工具类型)                                  │
│        + SizeBonus(内容大小)                                  │
│        + AgePenalty(时间衰减)                                 │
│        + RepeatPenalty(重复读取惩罚)                           │
│        + ContentBonus(内容特征加分)                           │
│                                                              │
│  Score 决定策略:                                              │
│    90-100  → 完全保留 (protected)                             │
│    60-89   → 持久化到磁盘 (lossless)                          │
│    30-59   → 零成本摘要 (structured extract)                  │
│    0-29    → 直接清理 (drop)                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

***

## 工具分类与基础分

### 工具类型基分 (BaseScore)

| 工具类型            | 基分  | 理由                |
| --------------- | --- | ----------------- |
| **write**       | 100 | 写完即完成，下次自己会读，直接清理 |
| **edit**        | 100 | 同上                |
| **create**      | 100 | 同上                |
| **delete**      | 100 | 同上                |
| **read**        | 70  | 有价值，但下次可能重新读      |
| **cat**         | 70  | 同 read            |
| **view**        | 70  | 同 read            |
| **grep**        | 60  | 有搜索价值，但内容常重复      |
| **glob**        | 40  | 文件列表，低信息密度        |
| **find**        | 40  | 同上                |
| **bash**        | 30  | 视情况，内容差异大         |
| **git\_status** | 20  | 几乎无用              |
| **git\_branch** | 20  | 几乎无用              |
| **git\_log**    | 50  | 有价值但常重复           |
| **git\_diff**   | 60  | 有价值，变更信息          |

***

## 评分因素详解

### 1. BaseScore (工具类型基分)

```
TOOL_BASE_SCORE = {
  write: 100, edit: 100, create: 100, delete: 100,
  read: 70, cat: 70, view: 70,
  grep: 60, git_diff: 60,
  git_log: 50, bash: 30,
  glob: 40, find: 40,
  git_status: 20, git_branch: 20, pwd: 10, whoami: 10,
}
```

### 2. SizeBonus (内容大小调整)

```
if content.length < 1KB:     bonus = -10  (太小，无压缩价值)
if content.length < 10KB:     bonus = 0    (保持原样)
if content.length < 50KB:    bonus = +5   (有价值，值得保留)
if content.length < 100KB:    bonus = +10  (大结果，加分)
if content.length >= 100KB:   bonus = +15  (巨大，必须持久化)
```

### 3. AgePenalty (时间衰减)

```
age = now - message.timestamp

if age < 5min:     penalty = 0      (最近，保留)
if age < 15min:    penalty = -5
if age < 30min:    penalty = -10
if age < 60min:    penalty = -20
if age >= 60min:   penalty = -30    (超过1小时，显著降分)
```

### 4. RepeatPenalty (重复读取惩罚) — read/cat/view 特有

```
// 检测：是否有更近的相同路径读取结果

if tool in [read, cat, view]:
  samePath = 消息中是否有更新的同路径 read 结果
  if samePath:
    penalty = -40  // 重复读取，上一个直接清理
  else:
    penalty = 0
```

### 5. ContentBonus (内容特征加分)

```
CRITICAL (错误/异常/冲突): +50
  - Error:, TypeError:, ReferenceError:
  - <<<<<<< HEAD, >>>>>>>>
  - FAIL, failed with exit code
  - password, secret, token, api_key

IMPORTANT (有价值信息): +20
  - 函数签名/类定义
  - 测试用例
  - API 响应结构

LOW_VALUE (低价值可直接清理): -30
  - "Built in Xs"
  - "Done."
  - 纯文件路径列表 (ls)
  - [DEBUG], [INFO] 日志
  - 空结果
```

***

## 评分计算示例

### 示例 1: bash 构建成功

```
if content.length < 1KB:     bonus = -10  (太小，无压缩价值)
if content.length < 10KB:     bonus = 0    (保持原样)
if content.length < 50KB:    bonus = +5   (有价值，值得保留)
if content.length < 100KB:    bonus = +10  (大结果，加分)
if content.length >= 100KB:   bonus = +15  (巨大，必须持久化)
```

### 示例 2: read 源代码文件

```
工具: read
内容: 500行 TypeScript 代码，15KB
时间: 10分钟前
重复读取: 无

Score = Base(read: 70) + Size(+10) + Age(-5) + Repeat(0) + Content(+20)
      = 70 + 10 - 5 + 0 + 20
      = 95

结论: PROTECTED (完全保留)
```

### 示例 3: grep 搜索结果

```
工具: grep
内容: "50 matches across 10 files"
大小: 2KB
时间: 30分钟前

Score = Base(grep: 60) + Size(-10) + Age(-10) + Content(0)
      = 60 - 10 - 10
      = 40

结论: SUMMARY (零成本摘要)
```

### 示例 4: write 写代码

```
工具: write
内容: 新写的组件代码，8KB
时间: 5分钟前

Score = Base(write: 100) + Size(+5) + Age(0) + Content(0)
      = 100 + 5 + 0
      = 105 → 归一化到 100

结论: PROTECTED (但写完后可直接清理，因为下次会自己读)
```

### 示例 5: bash 错误堆栈

```
工具: bash
内容: "Error: Cannot find module 'lodash'\n  at resolve (/app/main.js:12:5)\n  ..."
大小: 5KB
时间: 刚发生
重复读取: 无

Score = Base(bash: 30) + Size(0) + Age(0) + Content(+50 CRITICAL)
      = 30 + 0 + 0 + 50
      = 80

结论: PERSIST (错误信息需保留，且持久化)
```

***

## 压缩策略映射

```
Score 范围          策略              说明
─────────────────────────────────────────────────────────────
90-100 (归一化后)   PROTECTED        完全保留，不压缩
70-89               PERSIST          持久化到磁盘，stub 引用
50-69               SUMMARY          零成本结构化摘要
30-49               PERSIST_SHORT    持久化，但可快速过期
0-29                DROP             直接清理，替换为 [toolName: dropped]

特殊情况:
- write/edit       → 写完即 DROP (下次会重新读)
- 错误信息         → 强制 PERSIST (不受分数影响)
- 重复读取         → 前一个结果直接 DROP
```

***

## 生命周期演进策略

同一个工具结果，在不同生命周期阶段分数会变化：

```
刚产生时 (age=0):
  └── 保留价值最高，按正常评分

5分钟后 (age=5min):
  └── AgePenalty 开始生效

30分钟后 (age=30min):
  └── 如果没有持久化，降分明显

60分钟后 (age=60min):
  └── 大部分结果都会被 DROP
  └── 只有 CRITICAL 内容还在 PERSIST

超过 60分钟 + 已持久化:
  └── 可选择清理持久化文件
```

***

## 实现数据结构

### 新增配置

```typescript
// 工具基分配置
export const TOOL_BASE_SCORE: Record<string, number> = {
  write: 100, edit: 100, create: 100, delete: 100,
  read: 70, cat: 70, view: 70,
  grep: 60, git_diff: 60, git_log: 50,
  bash: 30,
  glob: 40, find: 40,
  git_status: 20, git_branch: 20, pwd: 10, whoami: 10,
};

// 策略阈值
export const SCORE_THRESHOLDS = {
  PROTECTED: 90,
  PERSIST: 70,
  SUMMARY: 50,
  PERSIST_SHORT: 30,
  DROP: 0,
};

// 生命周期衰减配置
export const LIFECYCLE_DECAY = {
  freshMinutes: 5,      // 无衰减
  shortMinutes: 15,     // -5
  mediumMinutes: 30,    // -10
  longMinutes: 60,       // -20
  staleMinutes: 60,     // -30
};
```

### 评分函数签名

```typescript
export interface ToolResultScore {
  total: number;                    // 原始总分
  normalized: number;                // 归一化到 0-100
  strategy: "protected" | "persist" | "summary" | "persist_short" | "drop";
  breakdown: {
    base: number;
    size: number;
    age: number;
    repeat: number;
    content: number;
  };
  reason: string;                    // 决策理由
}

export function scoreToolResult(
  toolName: string,
  content: string,
  timestamp: number,
  context: {
    hasNewerSamePath?: boolean;      // 重复读取检测
    currentTime?: number;
  }
): ToolResultScore;
```

### 评分执行流程

```typescript
function scoreToolResult(toolName, content, timestamp, context): ToolResultScore {
  const now = context.currentTime ?? Date.now();
  const age = now - timestamp;

  // 1. 特殊工具立即返回
  if (toolName === "write" || toolName === "edit" || toolName === "create" || toolName === "delete") {
    return {
      total: 100, normalized: 100, strategy: "persist",
      breakdown: { base: 100, size: 0, age: 0, repeat: 0, content: 0 },
      reason: "write/edit completed, can be re-read if needed"
    };
  }

  // 2. 错误信息强制持久化
  if (containsCriticalContent(content)) {
    return {
      total: 100, normalized: 100, strategy: "persist",
      breakdown: { base: 30, size: 0, age: 0, repeat: 0, content: 70 },
      reason: "critical error content must persist"
    };
  }

  // 3. 计算各项分
  const base = TOOL_BASE_SCORE[toolName] ?? 30;
  const size = calculateSizeBonus(content);
  const age = calculateAgePenalty(age);
  const repeat = context.hasNewerSamePath ? -40 : 0;
  const contentBonus = calculateContentBonus(content);

  const total = base + size + age + repeat + contentBonus;
  const normalized = Math.max(0, Math.min(100, total));
  const strategy = getStrategy(normalized);

  return { total, normalized, strategy, breakdown: { base, size, age, repeat, content: contentBonus }, reason: ... };
}
```

***

## 集成到现有 Pipeline

### 修改 `compressContext()` 调用方式

```typescript
// 旧逻辑: 批量处理，同等对待所有 toolResult
for (const msg of currentMessages) {
  if (msg.role === "toolResult") {
    // 应用统一的 L0/L1/L2/L3 流程
  }
}

// 新逻辑: 逐个评分，决定策略
for (const msg of currentMessages) {
  if (msg.role !== "toolResult") {
    nextMessages.push(msg);
    continue;
  }

  const toolName = msg.toolName ?? "unknown";
  const content = extractToolContent(msg);
  const timestamp = msg.timestamp ?? Date.now();

  const score = scoreToolResult(toolName, content, timestamp, {
    hasNewerSamePath: checkRepeatRead(toolName, content, msgIndex, messages),
    currentTime: Date.now(),
  });

  switch (score.strategy) {
    case "protected":
      nextMessages.push(msg);  // 保持原样
      break;
    case "persist":
      // 持久化到磁盘
      const persisted = await persistIfNeeded({ toolName, content, timestamp }, config);
      nextMessages.push(replaceWithStub(persisted));
      break;
    case "summary":
      // 零成本摘要
      const note = summarizeToolResult(toolName, content, config);
      nextMessages.push(replaceWithSummary(note));
      break;
    case "drop":
      nextMessages.push(replaceWithDropped(toolName));
      break;
  }
}
```

***

## 文件变更清单

| 文件                                                                  | 操作                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/coding-agent/src/core/context-compression/types.ts`       | 新增 `ToolResultScore`, `SCORE_THRESHOLDS`, `TOOL_BASE_SCORE`, `LIFECYCLE_DECAY` |
| `packages/coding-agent/src/core/context-compression/scoring.ts`     | **新增** — 评分系统核心实现                                                              |
| `packages/coding-agent/src/core/context-compression/index.ts`       | 修改 `compressContext()` 集成评分逻辑                                                  |
| `packages/coding-agent/src/core/context-compression/persistence.ts` | 修改 — 支持 `persist_short` 快速过期                                                   |
| `.pi/extensions/context-compression.ts`                             | 适配新评分结果的通知                                                                     |

***

## 测试用例设计

```typescript
describe("Tool Result Scoring", () => {
  it("write should always be persist", () => {
    const score = scoreToolResult("write", "console.log('hi')", Date.now(), {});
    expect(score.strategy).toBe("persist");
  });

  it("error in bash should force persist", () => {
    const score = scoreToolResult("bash", "Error: module not found", Date.now(), {});
    expect(score.strategy).toBe("persist");
  });

  it("old ls should be dropped", () => {
    const oldTime = Date.now() - 2 * 60 * 60 * 1000; // 2小时前
    const score = scoreToolResult("ls", "file1.js\nfile2.ts\n...", oldTime, {});
    expect(score.strategy).toBe("drop");
  });

  it("duplicate read should penalize older result", () => {
    const older = Date.now() - 5 * 60 * 1000;
    const newer = Date.now();
    const olderScore = scoreToolResult("read", "content", older, { hasNewerSamePath: true });
    expect(olderScore.strategy).toBe("drop");
  });
});
```

