# Context Compression 策略深度分析与优化建议

## 📊 当前压缩策略全景

### 一、双策略架构

系统支持两套独立的压缩策略，**互斥运行**：

#### **策略 A：Scoring 策略（新架构，默认未启用）**
基于智能评分的单层决策系统
```typescript
if (config.scoring?.enabled) {
  // 使用评分策略
} else {
  // 使用传统 L0→L1→L2→L3 流水线
}
```

#### **策略 B：Pipeline 策略（传统架构，默认启用）**
分层流水线处理：L0 → L1 → L2 → L3

---

## 🔍 策略 A：Scoring 详解

### 核心评分公式
```
Score = BaseScore(工具类型) 
      + SizeBonus(内容大小)
      + AgePenalty(时间衰减)
      + RepeatPenalty(重复惩罚)
      + ContentBonus(内容价值)
```

### 1️⃣ **工具基础分（BaseScore）**

| 工具类型 | 基础分 | 推理 |
|---------|-------|------|
| write/edit/create/delete | 100 | 写操作是关键状态变更 |
| read/cat/view | 70 | 读操作重要但可重新执行 |
| grep | 60 | 搜索结果中等价值 |
| git_diff | 60 | 差异信息重要 |
| git_log | 50 | 历史记录价值较低 |
| bash | 30 | Shell 输出通常低价值 |
| glob/find | 40 | 文件列表可重新生成 |
| git_status/git_branch | 20 | 状态信息易过期 |
| pwd/whoami | 10 | 极低价值 |

### 2️⃣ **大小奖励（SizeBonus）**

| 内容大小 | 奖励分 | 逻辑 |
|---------|-------|------|
| < 1KB | -10 | 小内容无需特殊处理 |
| 1-10KB | 0 | 中等内容不奖励不惩罚 |
| 10-50KB | +5 | 较大内容值得持久化 |
| 50-100KB | +10 | 大内容应该持久化 |
| > 100KB | +15 | 超大内容必须持久化 |

**⚠️ 问题**：这里的大小奖励逻辑**反直觉**！
- 大内容反而获得更高分数
- 理由是大内容更需要持久化保存，但这是否与"节省 token"目标冲突？

### 3️⃣ **年龄惩罚（AgePenalty）**

| 时间间隔 | 惩罚分 | 策略 |
|---------|-------|------|
| < 5分钟 | 0 | 新鲜内容保持完整价值 |
| 5-15分钟 | -5 | 开始衰减 |
| 15-30分钟 | -10 | 中等衰减 |
| 30-60分钟 | -20 | 显著衰减 |
| > 60分钟 | -30 | 严重衰减 |

### 4️⃣ **重复惩罚（RepeatPenalty）**

| 情况 | 惩罚分 | 场景 |
|------|-------|------|
| 无重复 | 0 | 正常情况 |
| 有重复读 | -40 | 同一路径有更新的读取结果 |

### 5️⃣ **内容奖励（ContentBonus）**

| 内容类型 | 奖励分 | 匹配规则 |
|---------|-------|---------|
| **关键内容** | +50 | 错误信息、冲突标记、敏感数据 |
| **重要内容** | +20 | 代码结构、测试、JSON |
| **低价值** | -30 | 构建输出、日志噪音、空内容 |
| **普通** | 0 | 默认情况 |

**关键内容模式**：
```typescript
// 错误类型
/Error:|TypeError:|ReferenceError:|SyntaxError:|RangeError:/m

// Git 冲突
/<<<<<<<\s*HEAD/m | />>>>>>>/m

// 安全敏感
/password|secret|token|api_key|AUTHORIZATION/i
```

**重要内容模式**：
```typescript
// 代码结构
/^(export|import|class|interface|function|const|let|var)\s+\w+/m

// 测试
/\bdescribe\(|it\(|test\(/ 

// JSON
/\{[\s\S]*"[\w]+"\s*:/ 
```

**低价值模式**：
```typescript
// 构建成功
/Built in \d+(\.\d+)?s$/m | /Done\.?\s*$/m

// 日志噪音
/^\[DEBUG\]|^\[INFO\]|^\[TRACE\]|^\[VERBOSE\]/m

// 纯文件列表
/^[\w/.-]+\n[\w/.-]+\n[\w/.-]+$/m
```

### 6️⃣ **策略映射（归一化分数 → 策略）**

| 归一化分数 | 策略 | 行为 |
|-----------|------|------|
| 90-100 | `protected` | 完全保留，不做任何压缩 |
| 70-89 | `persist` | 持久化到磁盘，替换为轻量 stub |
| 50-69 | `summary` | 零成本摘要（结构化提取） |
| 30-49 | `persist_short` | 持久化但快速过期（30分钟） |
| 0-29 | `drop` | 直接清理，仅保留标记 |

### 示例计算

**案例 1：新鲜的小型错误输出**
```
工具: bash (base: 30)
内容: "Error: Cannot find module" (50 bytes, 关键内容 +50)
年龄: 2分钟 (age: 0)

总分 = 30 + (-10) + 0 + 0 + 50 = 70
策略: persist ✅
```

**案例 2：过期的重复大文件读取**
```
工具: read (base: 70)
内容: 120KB 源代码 (size: +15)
年龄: 45分钟 (age: -20)
重复读: 是 (repeat: -40)

总分 = 70 + 15 + (-20) + (-40) + 0 = 25
策略: drop ✅
```

**案例 3：写操作结果**
```
工具: write (base: 100)
直接策略: persist（不计算分数）
原因: 写操作完成，可重新读取
```

---

## 🔍 策略 B：Pipeline 详解

### L0 层：持久化层（Persistence）

**目标**：将大内容保存到磁盘，减少上下文体积

**触发条件**：
- 大小 > 50KB（默认阈值）
- 工具不在豁免列表（read/cat/view 豁免）

**处理流程**：
```
原始内容 → 写入磁盘 → 生成 stub (前 2KB + 元数据)
```

**Stub 格式**：
```
[TOOL output saved to disk]
Path: /tmp/pi-context-compression/bash-abc123.txt
Original size: 150.5KB
--- Preview (first 2KB) ---
[内容前 2KB]
... [truncated - use readPersistedFile() for full content]
```

**豁免工具**：
```typescript
PERSIST_EXEMPT_TOOLS = new Set(["read", "cat", "view", "open"]);
```
原因：避免 read → save → read 循环浪费

### L1 层：计数降级层（Lifecycle Count）

**目标**：保留最近 N 条结果，降级更早的结果

**规则**：
```typescript
keepRecent = 5  // 默认保留最近 5 条完整结果
```

**优先级分级**：
```typescript
enum ToolPriority {
  CRITICAL = "critical",     // 写操作：必须保留
  IMPORTANT = "important",   // 读操作：优先保留
  DISCARDABLE = "discardable" // 其他：可丢弃
}
```

**降级策略**：
```
完整内容 → [degraded] [toolName] (size: 15.2KB)
```

### L2 层：时间清理层（Lifecycle Time）

**目标**：清理过期的结果

**规则**：
```typescript
staleMinutes = 60  // 60 分钟未访问视为过期
```

**过期处理**：
```
完整内容 → [cleared] [toolName]
```

**例外情况**：
- CRITICAL 优先级的工具结果不受时间清理影响
- 时间戳无效（0/NaN/负数/未来时间）的结果被视为"新鲜"

### L3 层：零成本摘要层（Zero-cost Summary）

**目标**：无需 LLM 调用的结构化摘要

**特点**：
- 基于规则的模式提取
- 针对不同工具类型的定制化提取器
- 保留关键信息，丢弃冗余细节

**工具特定提取器**：

#### `read` 提取器
```
输入: 完整文件内容
输出:
  - 行数统计
  - 文件大小
  - 语言检测（shebang/import）
  - 前 N/2 行 + 后 N/2 行样本
```

#### `grep` 提取器
```
输入: grep 匹配结果
输出:
  - 匹配数统计
  - 涉及文件列表
  - 前 N 个匹配样本
```

#### `bash` 提取器
```
输入: Shell 输出
输出:
  - 行数统计
  - 错误检测（error/failed）
  - 成功检测（success/done）
  - 前/后样本行
```

#### `git_diff` 提取器
```
输入: Git 差异输出
输出:
  - 文件变更统计
  - 增/删行数
  - 关键差异样本
```

**摘要格式**：
```
[summarized] grep: 150 matches across 12 file(s)
  { matches: 150, files: 12 }
  Files: src/index.ts, src/utils.ts, src/parser.ts, ...
  src/index.ts:42:export function parse
  src/utils.ts:15:export function format
  ... (+145 more matches)
```

---

## 🎯 意图分类器（Intent Classifier）

**目标**：根据对话意图动态调整压缩配置

### 分类类别
```typescript
enum IntentCategory {
  BUG = "bug",              // 调试场景
  REQUIREMENT = "requirement",  // 需求分析
  EXPLORATION = "exploration",  // 代码探索
  CHITCHAT = "chitchat"     // 日常对话
}
```

### 意图感知的配置调整

#### BUG 意图（保守策略）
```typescript
// 保留更多信息用于调试
keepRecent: base * 2        // 5 → 10
staleMinutes: base * 2      // 60 → 120
maxLines: base * 2          // 20 → 40
truncateLine: base * 2      // 120 → 240
```

#### CHITCHAT 意图（略保守）
```typescript
// 保持对话连贯性
keepRecent: max(5, base)    // 至少 5 条
staleMinutes: base * 1.5    // 60 → 90
maxLines: base * 1.5        // 20 → 30
```

#### REQUIREMENT/EXPLORATION 意图
```typescript
// 使用默认配置
无调整
```

---

## ⚠️ 当前策略的问题与优化空间

### 1️⃣ **大小奖励逻辑反直觉**

**问题**：
```typescript
// 当前实现
if (size < 1024) return -10;      // 小内容惩罚
if (size > 100KB) return +15;     // 大内容奖励
```

这导致：
- 100KB 的文件读取获得 +15 奖励
- 500B 的文件读取获得 -10 惩罚
- **与大内容应该优先压缩的目标冲突**

**优化方案 A：反转奖励逻辑**
```typescript
function calculateSizeBonus(content: string): number {
  const size = Buffer.byteLength(content, "utf-8");
  if (size < 1024) return 5;        // 小内容容易保留完整
  if (size < 10 * 1024) return 0;   // 中性
  if (size < 50 * 1024) return -5;  // 开始惩罚
  if (size < 100 * 1024) return -10;
  return -15;  // 超大内容强烈建议压缩
}
```

**优化方案 B：分离"保留价值"和"压缩必要性"**
```typescript
// 保留价值评分
function calculateValueScore(size: number): number {
  // 小内容有价值但不需要特殊处理
  // 大内容有价值但需要持久化
  return 0; // 中性
}

// 压缩必要性评分
function calculateCompressionNeed(size: number): number {
  if (size > 50KB) return 10; // 大内容必须压缩
  return 0;
}
```

### 2️⃣ **时间衰减过于简单**

**问题**：
- 线性衰减不考虑实际使用频率
- 无法识别"最近使用但创建时间早"的结果

**优化方案：LRU + 时间混合衰减**
```typescript
interface EnhancedToolResult {
  timestamp: number;      // 创建时间
  lastAccessTime: number; // 最后访问时间
  accessCount: number;    // 访问次数
}

function calculateAgePenalty(entry: EnhancedToolResult): number {
  const now = Date.now();
  const ageMs = now - entry.timestamp;
  const idleMs = now - entry.lastAccessTime;
  
  // 时间衰减
  const agePenalty = calculateLinearPenalty(ageMs);
  
  // 空闲惩罚
  const idlePenalty = calculateLinearPenalty(idleMs) * 1.5;
  
  // 访问奖励
  const accessBonus = Math.min(entry.accessCount * 2, 20);
  
  return agePenalty + idlePenalty - accessBonus;
}
```

### 3️⃣ **重复检测不准确**

**问题**：
```typescript
// 当前仅检测完全相同的路径
const currentPath = extractPathFromReadTool(currentMsg);
if (otherPath === currentPath) {
  result.set(currentIndex, true);
}
```

无法识别：
- 参数变化但结果相同的调用
- 同一文件的多次读取（路径格式不同）
- 相关文件（如 test.ts 和 test.spec.ts）

**优化方案：语义相似度检测**
```typescript
// 1. 标准化路径
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

// 2. 内容哈希
function hashContent(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

// 3. 相似度检测
function detectDuplicateResults(messages: AgentMessage[]): Map<number, boolean> {
  const contentHashes = new Map<string, number[]>();
  const pathResults = new Map<string, number[]>();
  
  // 建立索引
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!isToolResult(msg)) continue;
    
    const path = extractPath(msg);
    const hash = hashContent(extractContent(msg));
    
    contentHashes.set(hash, [...(contentHashes.get(hash) || []), i]);
    if (path) pathResults.set(normalizePath(path), [...(pathResults.get(path) || []), i]);
  }
  
  // 标记重复
  const duplicates = new Map<number, boolean>();
  for (const indices of contentHashes.values()) {
    if (indices.length > 1) {
      // 保留最新的，标记其他为重复
      indices.slice(0, -1).forEach(i => duplicates.set(i, true));
    }
  }
  
  return duplicates;
}
```

### 4️⃣ **内容分类过于粗糙**

**问题**：
- 仅基于正则匹配
- 无语义理解
- 无法识别代码块的重要性

**优化方案：分层内容分析**
```typescript
interface ContentAnalysis {
  hasErrors: boolean;
  hasSecrets: boolean;
  hasCodeBlocks: boolean;
  hasTestResults: boolean;
  codeLanguages: string[];
  structuralComplexity: number; // 0-100
}

function analyzeContent(content: string): ContentAnalysis {
  return {
    hasErrors: /Error:|Exception:|Failed/.test(content),
    hasSecrets: /password|token|api_key/i.test(content),
    hasCodeBlocks: /```[\s\S]*?```/.test(content),
    hasTestResults: /\d+ passed|\d+ failed/.test(content),
    codeLanguages: detectLanguages(content),
    structuralComplexity: calculateComplexity(content),
  };
}

function calculateContentBonus(analysis: ContentAnalysis): number {
  let bonus = 0;
  
  if (analysis.hasErrors) bonus += 50;
  if (analysis.hasSecrets) bonus += 60;
  if (analysis.hasCodeBlocks) bonus += 15;
  if (analysis.hasTestResults) bonus += 25;
  
  // 高复杂度内容更值得保留
  bonus += Math.floor(analysis.structuralComplexity / 10);
  
  return bonus;
}
```

### 5️⃣ **策略选择缺乏上下文感知**

**问题**：
- 当前策略完全基于单条结果评分
- 不考虑对话上下文和任务类型

**优化方案：上下文感知策略**
```typescript
interface ConversationContext {
  taskType: 'debug' | 'develop' | 'explore' | 'refactor';
  recentTools: string[];
  conversationDepth: number;
  userIntent: IntentCategory;
}

function adjustStrategy(
  baseScore: number,
  context: ConversationContext
): CompressionStrategy {
  // 调试场景：保留更多错误信息
  if (context.taskType === 'debug') {
    if (baseScore >= 50) return 'protected';
  }
  
  // 深度对话：更激进压缩
  if (context.conversationDepth > 50) {
    baseScore -= 20;
  }
  
  // 工具依赖链：保留相关工具结果
  if (context.recentTools.includes('write') && context.recentTools.includes('read')) {
    // 写后读，可能需要完整上下文
    baseScore += 15;
  }
  
  return getStrategy(baseScore);
}
```

### 6️⃣ **Pipeline 层级缺乏协调**

**问题**：
- L0 → L1 → L2 → L3 各层独立决策
- 可能出现冲突（如 L0 持久化后 L2 又清理）
- 缺乏全局优化

**优化方案：统一决策引擎**
```typescript
interface CompressionDecision {
  strategy: 'keep' | 'persist' | 'summary' | 'clear';
  reason: string;
  appliedLayers: string[];
  estimatedSavings: number;
}

function makeCompressionDecision(
  entry: ToolResultEntry,
  context: CompressionContext
): CompressionDecision {
  const decisions: Array<{ layer: string; action: string; savings: number }> = [];
  
  // L0: 大内容必须持久化
  if (entry.contentSize > config.persistenceThreshold) {
    decisions.push({ layer: 'L0', action: 'persist', savings: entry.contentSize - 2048 });
  }
  
  // L1: 计数限制
  if (context.recentCount > config.keepRecent) {
    if (entry.priority !== 'critical') {
      decisions.push({ layer: 'L1', action: 'degrade', savings: entry.contentSize * 0.8 });
    }
  }
  
  // L2: 时间过期
  if (Date.now() - entry.timestamp > config.staleMinutes * 60000) {
    if (entry.priority !== 'critical' && !entry.hasErrors) {
      decisions.push({ layer: 'L2', action: 'clear', savings: entry.contentSize });
    }
  }
  
  // 选择最优决策（最大节省 + 最小损失）
  const optimal = decisions.sort((a, b) => b.savings - a.savings)[0];
  
  return {
    strategy: optimal.action,
    reason: `${optimal.layer}: ${optimal.action}`,
    appliedLayers: [optimal.layer],
    estimatedSavings: optimal.savings,
  };
}
```

### 7️⃣ **缺乏压缩效果反馈循环**

**问题**：
- 压缩决策一次性执行
- 无后续效果评估
- 无法学习优化策略

**优化方案：自适应压缩系统**
```typescript
interface CompressionMetrics {
  decisionId: string;
  strategy: string;
  originalSize: number;
  compressedSize: number;
  wasAccessedAgain: boolean;  // 压缩后是否再次被引用
  timeToNextAccess: number;    // 下次访问时间间隔
  userSatisfaction: number;    // 用户满意度（通过反馈）
}

class AdaptiveCompressor {
  private metrics: CompressionMetrics[] = [];
  
  learn() {
    // 分析历史数据
    const strategyPerformance = this.analyzeStrategies();
    
    // 调整阈值
    if (strategyPerformance.get('persist').wasAccessedAgain < 0.1) {
      // persist 策略很少被再次访问，可以更激进
      SCORE_THRESHOLDS.PERSIST += 5;
    }
    
    if (strategyPerformance.get('drop').wasAccessedAgain > 0.3) {
      // drop 策略经常被再次需要，应该更保守
      SCORE_THRESHOLDS.DROP += 5;
    }
  }
  
  analyzeStrategies(): Map<string, { wasAccessedAgain: number }> {
    // 实现策略效果分析
  }
}
```

### 8️⃣ **摘要质量不可控**

**问题**：
- L3 零成本摘要完全基于规则
- 可能丢失关键上下文
- 无法理解代码语义

**优化方案 A：规则 + LLM 混合摘要**
```typescript
async function hybridSummary(
  toolName: string,
  content: string,
  config: SummaryConfig
): Promise<StructuredNote> {
  // 1. 规则提取（快速、零成本）
  const ruleBased = summarizeToolResult(toolName, content, config);
  
  // 2. 判断是否需要 LLM 增强
  if (shouldUseLLM(toolName, content)) {
    // 3. LLM 精炼（高质量但有成本）
    const refined = await llmRefine(ruleBased, content);
    return refined;
  }
  
  return ruleBased;
}

function shouldUseLLM(toolName: string, content: string): boolean {
  // 复杂代码结构
  if (content.includes('class ') && content.includes('function ')) {
    return true;
  }
  
  // 测试结果
  if (content.includes('PASS') || content.includes('FAIL')) {
    return true;
  }
  
  // 错误堆栈
  if (content.includes('Error at')) {
    return true;
  }
  
  return false;
}
```

**优化方案 B：分层摘要**
```typescript
interface LayeredSummary {
  layer1: string;  // 极简：单行标题
  layer2: string;  // 简要：标题 + 关键元数据
  layer3: string;  // 标准：标题 + 元数据 + 样本
  layer4: string;  // 详细：标准 + 结构化分析
}

function generateLayeredSummary(content: string): LayeredSummary {
  return {
    layer1: generateHeadline(content),
    layer2: generateBriefSummary(content),
    layer3: generateStandardSummary(content),
    layer4: generateDetailedSummary(content),
  };
}

// 根据上下文长度选择合适的摘要层
function selectSummaryLayer(
  summary: LayeredSummary,
  contextTokens: number
): string {
  if (contextTokens > 100000) return summary.layer1;
  if (contextTokens > 50000) return summary.layer2;
  if (contextTokens > 20000) return summary.layer3;
  return summary.layer4;
}
```

### 9️⃣ **缺乏用户可配置性**

**问题**：
- 用户无法自定义压缩策略
- 无法针对特定场景调整
- 缺乏压缩预览功能

**优化方案：策略配置 DSL**
```json
{
  "compression": {
    "profiles": {
      "aggressive": {
        "description": "激进压缩，最大化节省 token",
        "thresholds": {
          "protected": 95,
          "persist": 75,
          "summary": 50,
          "drop": 25
        },
        "keepRecent": 3,
        "staleMinutes": 30
      },
      "conservative": {
        "description": "保守压缩，保留完整上下文",
        "thresholds": {
          "protected": 85,
          "persist": 65,
          "summary": 40,
          "drop": 15
        },
        "keepRecent": 10,
        "staleMinutes": 120
      },
      "debug": {
        "description": "调试模式，保留所有错误和堆栈",
        "contentBonus": {
          "errorPatterns": 100,
          "stackTraces": 90
        },
        "neverDrop": ["error", "exception", "stacktrace"]
      }
    },
    "activeProfile": "conservative",
    "customRules": [
      {
        "match": { "toolName": "git_log", "size": ">50KB" },
        "action": "summary",
        "reason": "Git 历史通常不需要完整保留"
      },
      {
        "match": { "content": "test.*failed", "priority": "critical" },
        "action": "protected",
        "reason": "测试失败需要完整上下文"
      }
    ]
  }
}
```

### 🔟 **性能和可观测性不足**

**问题**：
- 无压缩决策的可视化
- 难以调试压缩问题
- 缺乏性能指标

**优化方案：压缩仪表板**
```typescript
interface CompressionDashboard {
  // 实时统计
  stats: {
    totalCompressions: number;
    totalTokensSaved: number;
    averageCompressionRatio: number;
    byStrategy: Map<string, { count: number; saved: number }>;
  };
  
  // 决策追踪
  recentDecisions: Array<{
    timestamp: number;
    toolName: string;
    strategy: string;
    score: number;
    breakdown: ScoreBreakdown;
    preview: string;
  }>;
  
  // 问题诊断
  issues: Array<{
    type: 'over_compression' | 'under_compression' | 'wrong_strategy';
    details: string;
    suggestion: string;
  }>;
}

// 可视化命令
// /compression-stats     显示统计
// /compression-decisions 显示最近决策
// /compression-preview   预览压缩效果
// /compression-undo      撤销最近压缩
```

---

## 🚀 推荐优化路线图

### Phase 1: 快速修复（1-2 周）
1. **修复大小奖励逻辑**（反转或分离）
2. **增强重复检测**（标准化路径 + 内容哈希）
3. **改进内容分类**（添加更多模式和权重）
4. **添加压缩预览**（用户可预览决策）

### Phase 2: 架构改进（2-4 周）
5. **实现 LRU + 时间混合衰减**
6. **统一 Pipeline 决策引擎**（消除层级冲突）
7. **上下文感知策略选择**
8. **添加压缩指标收集**

### Phase 3: 高级特性（1-2 月）
9. **自适应压缩系统**（基于历史数据学习）
10. **分层摘要机制**（动态选择摘要深度）
11. **策略配置 DSL**（用户自定义规则）
12. **压缩仪表板**（可视化 + 诊断）

### Phase 4: 智能化（长期）
13. **LLM 增强摘要**（混合方案）
14. **语义相似度检测**（向量嵌入）
15. **预测性压缩**（预测未来需要的上下文）
16. **跨会话学习**（持久化压缩策略）

---

## 📊 预期收益分析

| 优化项 | Token 节省 | 上下文质量 | 可维护性 | 用户体验 |
|--------|-----------|-----------|---------|---------|
| 大小奖励修复 | +5-10% | ↑ | ↑ | ↑ |
| 增强重复检测 | +3-5% | ↑ | - | ↑ |
| LRU 衰减 | +5-8% | ↑↑ | - | ↑ |
| 上下文感知 | +8-15% | ↑↑↑ | ↑ | ↑↑ |
| 自适应系统 | +10-20% | ↑↑↑ | ↑↑ | ↑↑↑ |
| 分层摘要 | +15-25% | ↑↑ | ↑ | ↑↑ |

**总体预期**：
- Token 节省：30-50% 提升
- 上下文质量：显著提升（减少关键信息丢失）
- 用户满意度：减少压缩相关问题

---

## 💡 额外建议

### 1. A/B 测试框架
```typescript
interface CompressionExperiment {
  id: string;
  name: string;
  variant: 'control' | 'treatment';
  config: CompressionPipelineConfig;
  metrics: {
    tokensSaved: number;
    userComplaints: number;
    contextRelevance: number;
  };
}

// 随机分配用户到不同策略
function assignExperiment(userId: string): CompressionExperiment {
  const hash = hashCode(userId + EXPERIMENT_SALT);
  return hash % 2 === 0 ? CONTROL : TREATMENT;
}
```

### 2. 压缩质量评分
```typescript
function scoreCompressionQuality(
  original: AgentMessage[],
  compressed: AgentMessage[],
  context: ConversationContext
): number {
  // 1. 信息保留度
  const informationRetention = calculateInformationRetention(original, compressed);
  
  // 2. Token 节省率
  const tokenSavings = (original.length - compressed.length) / original.length;
  
  // 3. 上下文相关性
  const relevance = calculateContextRelevance(compressed, context);
  
  // 综合评分
  return 0.4 * informationRetention + 0.3 * tokenSavings + 0.3 * relevance;
}
```

### 3. 渐进式压缩
```typescript
async function progressiveCompress(
  messages: AgentMessage[],
  targetTokens: number
): Promise<AgentMessage[]> {
  let current = messages;
  let iteration = 0;
  
  while (estimateTokens(current) > targetTokens && iteration < 5) {
    const strategy = getProgressiveStrategy(iteration);
    current = await compressWithStrategy(current, strategy);
    iteration++;
  }
  
  return current;
}

function getProgressiveStrategy(iteration: number): CompressionStrategy {
  // 迭代 1: 轻度压缩（仅 drop）
  // 迭代 2: 中度压缩（drop + summary）
  // 迭代 3: 重度压缩（drop + summary + persist）
  // 迭代 4: 极度压缩（最大化压缩）
  const strategies = ['drop', 'summary', 'persist', 'aggressive'];
  return strategies[iteration] || strategies[3];
}
```

---

## 🎓 总结

当前压缩策略是一个**设计良好的多层系统**，但存在以下核心问题：

### 主要优势 ✅
1. **分层架构清晰**：L0-L3 各司其职
2. **零成本摘要**：无需 LLM 调用
3. **意图感知**：根据对话类型调整策略
4. **工具特定处理**：针对不同工具定制摘要

### 主要缺陷 ❌
1. **评分逻辑矛盾**：大小奖励与目标冲突
2. **缺乏协调**：Pipeline 层级各自为政
3. **上下文盲区**：决策缺乏全局视角
4. **无反馈循环**：无法学习优化

### 优先级建议
1. **立即修复**：大小奖励逻辑（影响所有压缩决策）
2. **短期改进**：重复检测 + 内容分类
3. **中期重构**：统一决策引擎 + 自适应系统
4. **长期演进**：LLM 增强 + 语义理解

通过系统性优化，预期可将 Token 节省率提升 **30-50%**，同时显著改善上下文质量和用户体验。
