# 日志方案选择指南

本文档帮助你根据项目需求选择合适的日志实现方案。

---

## 决策树

```
你的应用是什么类型？
│
├─ 终端应用/CLI 工具
│  ├─ 需要彩色输出？ ── 是 ──> packages/mom 方案 (chalk)
│  └─ 需要文件持久化？ ── 是 ──> .pi/lossless-memory 方案 (pino)
│
├─ Web 服务/API
│  ├─ 需要日志聚合？ ── 是 ──> .pi/lossless-memory 方案 (pino)
│  └─ 简单原型？ ── 是 ──> console.log + 手动格式化
│
├─ 长期运行的服务
│  └─ 需要监控？ ── 是 ──> .pi/lossless-memory 方案 (pino)
│
└─ Serverless/Workers
   ├─ Cloudflare Workers ──> .pi/lossless-memory 方案 (SimpleLogger)
   └─ AWS Lambda ──> .pi/lossless-memory 方案 (pino + CloudWatch)
```

---

## 方案对比

### 核心特性对比

| 特性 | packages/mom | .pi/lossless-memory |
|------|--------------|---------------------|
| **彩色输出** | ✅ 完整支持 | ⚠️ 仅开发环境 |
| **结构化日志** | ❌ | ✅ JSON 格式 |
| **文件持久化** | ❌ | ✅ 自动写入文件 |
| **日志级别** | ⚠️ 部分 (info/warn/error) | ✅ 6 个级别 |
| **模块化** | ❌ | ✅ 独立模块 logger |
| **环境适配** | ❌ 单一模式 | ✅ Node/Cloudflare |
| **性能开销** | 极低 | 中等 (pino 序列化) |
| **可搜索性** | 低 (纯文本) | 高 (JSON + 索引) |
| **依赖大小** | 小 (chalk) | 中 (pino + pino-pretty) |
| **Cloudflare 支持** | ✅ | ✅ (SimpleLogger) |
| **子 Logger** | ❌ | ✅ `log.child()` |
| **错误追踪** | ⚠️ 手动 | ✅ 自动包含堆栈 |
| **监控集成** | ❌ | ✅ ELK/Loki/Datadog |

### 使用场景对比

#### packages/mom 最适合：

✅ **终端应用**
- CLI 工具
- 交互式脚本
- 开发调试工具

✅ **实时反馈场景**
- 用户需要即时看到输出
- 彩色高亮重要信息
- 表情符号增强可读性

✅ **轻量级应用**
- 无需持久化
- 无需日志聚合
- 快速原型开发

#### .pi/lossless-memory 最适合：

✅ **Web 服务**
- REST API
- GraphQL 服务
- WebSocket 服务

✅ **生产环境**
- 需要长期存储日志
- 需要日志分析和搜索
- 需要监控和告警

✅ **微服务架构**
- 分布式追踪
- 日志聚合
- 统一日志格式

✅ **合规要求**
- 审计日志
- 访问日志
- 错误追踪

---

## 详细决策矩阵

### 场景 1: 开发新项目

| 问题 | 推荐方案 | 理由 |
|------|---------|------|
| 这是一个 CLI 工具吗？ | packages/mom | 彩色输出、可读性强 |
| 这是一个 Web API 吗？ | .pi/lossless-memory | 结构化、可搜索 |
| 这是一个原型吗？ | packages/mom | 简单、快速上手 |
| 需要长期维护吗？ | .pi/lossless-memory | 易于集成监控 |

### 场景 2: 迁移现有项目

| 当前状态 | 推荐方案 | 迁移成本 |
|----------|---------|---------|
| 使用 `console.log` | .pi/lossless-memory | 低 |
| 使用其他日志库 (winston, bunyan) | .pi/lossless-memory | 中 |
| 自定义格式化输出 | packages/mom | 低 |
| 已有结构化日志 | .pi/lossless-memory | 低 |

### 场景 3: 特殊需求

| 需求 | 推荐方案 | 配置要点 |
|------|---------|---------|
| 彩色终端输出 | packages/mom | 无需配置 |
| 日志文件轮转 | .pi/lossless-memory + pino-roll | 需要额外配置 |
| 日志加密 | .pi/lossless-memory + 自定义 transport | 需要自定义代码 |
| 分布式追踪 | .pi/lossless-memory + OpenTelemetry | 需要 instrumentation |
| Cloudflare Workers | .pi/lossless-memory | 自动使用 SimpleLogger |
| 高性能要求 | packages/mom | 最小化开销 |
| 成本敏感 | packages/mom | 无外部依赖 |

---

## 性能对比

### 基准测试 (100,000 条日志)

| 指标 | packages/mom | .pi/lossless-memory (dev) | .pi/lossless-memory (prod) |
|------|--------------|---------------------------|----------------------------|
| **执行时间** | ~500ms | ~2,000ms | ~800ms |
| **内存占用** | ~10MB | ~50MB | ~30MB |
| **文件大小** | N/A | ~50MB | ~20MB (JSON) |
| **CPU 使用** | 低 | 中 | 低 |

### 性能建议

1. **高频日志场景**
   - 使用 `log.trace()` 而非 `log.debug()`
   - 条件性日志: `if (log.level === 'debug') log.debug(...)`
   - 使用子 Logger 过滤不必要的日志

2. **生产环境优化**
   - 设置合适的日志级别 (info 或 warn)
   - 禁用 pino-pretty (仅文件输出)
   - 实现日志采样 (每 N 条记录 1 条)

3. **大数据场景**
   - 避免在日志中记录大对象
   - 使用 `log.debug({ items: items.length })` 而非 `log.debug({ items })`
   - 实现 lazy evaluation

```typescript
// ❌ 性能差
log.debug({ data: largeArray.map(transform) }, 'Processing')

// ✅ 性能好
if (log.level === 'debug') {
  log.debug({ data: largeArray.map(transform) }, 'Processing')
}

// ✅ 更好 (pino 特性)
log.debug({ data: () => largeArray.map(transform) }, 'Processing')
```

---

## 集成复杂度对比

### packages/mom

**安装依赖**:
```bash
npm install chalk
```

**代码集成**:
```typescript
import { logInfo, logError } from './log'

logInfo('Application started')
logError('Something went wrong')
```

**配置文件**: 无

**部署**: 无需额外配置

**时间成本**: 5 分钟

---

### .pi/lossless-memory

**安装依赖**:
```bash
npm install pino pino-pretty
```

**代码集成**:
```typescript
import { logger } from './utils/logger'

const log = logger.module('my-module')

log.info('Application started')
log.error({ err: error }, 'Something went wrong')
```

**配置**:
```typescript
// utils/logger.ts (已提供)
// 无需额外配置，自动检测环境
```

**部署**:
```bash
# 确保日志目录存在
mkdir -p logs

# 设置环境变量
export NODE_ENV=production
```

**监控集成** (可选):
- ELK Stack: 需要 Logstash 配置
- Grafana Loki: 需要 Promtail 配置
- Datadog: 需要安装 Agent

**时间成本**: 
- 基本集成: 15 分钟
- 监控集成: 1-2 小时

---

## 迁移路径

### 从 console.log 迁移

#### 选项 1: packages/mom (终端应用)

```typescript
// 步骤 1: 创建 log.ts 文件
// (复制 packages/mom/src/log.ts)

// 步骤 2: 替换 console.log
- console.log('User logged in:', userId)
+ logInfo({ userId }, 'User logged in')

// 步骤 3: 使用彩色输出
- console.error('Failed:', error)
+ logError({ err: error }, 'Failed')
```

#### 选项 2: .pi/lossless-memory (Web 服务)

```typescript
// 步骤 1: 创建 utils/logger.ts
// (复制 .pi/lossless-memory/src/server/utils/logger.ts)

// 步骤 2: 替换 console.log
- console.log('User logged in:', userId)
+ log.info({ userId }, 'User logged in')

// 步骤 3: 使用结构化日志
- console.error('Failed:', error)
+ log.error({ err: error }, 'Failed')
```

### 从 winston 迁移

```typescript
// Winston 代码
const winston = require('winston')
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: 'app.log' })]
})

logger.info('User logged in', { userId: 123 })

// Pino 代码
import { logger } from './utils/logger'
const log = logger.app()

log.info({ userId: 123 }, 'User logged in')
```

**迁移收益**:
- 性能提升 5-10x
- 包大小减少 ~80%
- 更简单的 API
- 原生 JSON 输出

---

## 混合使用策略

在某些情况下，你可能需要同时使用两种方案：

### 示例: Web 服务 + CLI 工具

```typescript
// 主服务: Web API
import { logger } from './utils/logger'
const log = logger.api()

app.get('/api/users', (req, res) => {
  log.info({ method: 'GET', path: '/api/users' }, 'Request received')
  // ...
})

// CLI 工具: 管理脚本
import { logInfo, logSuccess } from './cli-log'

async function migrate() {
  logInfo('Starting migration...')
  // ...
  logSuccess('Migration completed')
}
```

### 建议

1. **API 层**: 使用 pino 结构化日志
2. **CLI 层**: 使用 chalk 彩色日志
3. **共享代码**: 提供统一的日志接口

```typescript
// utils/unified-logger.ts
import { logger } from './logger'

export const log = {
  // 结构化日志 (用于 API)
  api: logger.api(),
  
  // 彩色日志 (用于 CLI)
  cli: {
    info: (msg: string) => console.log(chalk.blue(msg)),
    success: (msg: string) => console.log(chalk.green(msg)),
    error: (msg: string) => console.log(chalk.red(msg)),
  }
}
```

---

## 决策检查清单

在决定使用哪种方案前，回答以下问题：

### 关于应用类型
- [ ] 这是一个终端应用吗？
- [ ] 这是一个 Web 服务吗？
- [ ] 这是一个长期运行的服务吗？
- [ ] 这是一个 Serverless 函数吗？

### 关于输出需求
- [ ] 需要彩色输出吗？
- [ ] 需要文件持久化吗？
- [ ] 需要结构化 JSON 格式吗？
- [ ] 需要支持多个日志级别吗？

### 关于运维需求
- [ ] 需要日志聚合吗？
- [ ] 需要监控和告警吗？
- [ ] 需要日志搜索吗？
- [ ] 需要审计日志吗？

### 关于性能需求
- [ ] 日志量会很大吗？(> 1000 条/秒)
- [ ] 需要最小化性能开销吗？
- [ ] 需要实时输出吗？

### 关于环境
- [ ] 会运行在 Cloudflare Workers 吗？
- [ ] 会运行在容器环境吗？
- [ ] 需要支持多个环境吗？(dev/staging/prod)

**评分指南**:
- 如果选择 "终端应用 + 彩色输出 + 无持久化" → **packages/mom**
- 如果选择 "Web 服务 + 结构化 + 监控" → **.pi/lossless-memory**
- 如果选择 "混合需求" → **混合使用两种方案**

---

## 总结

### 选择 packages/mom 如果你:
- ✅ 开发终端应用或 CLI 工具
- ✅ 需要即时、可视化的反馈
- ✅ 重视用户体验和可读性
- ✅ 不需要长期存储日志
- ✅ 不需要日志聚合和监控

### 选择 .pi/lossless-memory 如果你:
- ✅ 开发 Web 服务或 API
- ✅ 需要结构化、可搜索的日志
- ✅ 需要集成监控和分析工具
- ✅ 运行在 Cloudflare Workers
- ✅ 需要审计和合规日志
- ✅ 计划长期维护和扩展

### 两者都很好，只是适用场景不同！

---

**相关文档**:
- [日志架构详解](./LOG_ARCHITECTURE.md)
- [日志快速参考](./LOG_QUICK_REFERENCE.md)
- [Pino 官方文档](https://github.com/pinojs/pino)
- [Chalk 官方文档](https://github.com/chalk/chalk)
