# 日志架构文档

本文档详细说明了项目中使用的日志架构、实现方式和最佳实践。

## 概览

项目中存在两种不同的日志实现方式，分别服务于不同的应用场景：

1. **packages/mom** - Slack 机器人服务
   - 使用自定义的 `chalk` 格式化控制台日志
   - 面向终端输出的彩色格式化日志
   
2. **.pi/lossless-memory** - 无损记忆系统
   - 使用 `pino` 结构化日志框架
   - 支持文件日志和多级别日志输出

---

## 1. packages/mom - Slack 机器人日志

### 架构设计

**文件位置**: `packages/mom/src/log.ts`

**设计理念**:
- 🎨 **终端优先**: 专注于控制台输出，使用彩色格式化提升可读性
- 📊 **上下文感知**: 所有日志函数接收 `LogContext` 参数，包含 channelId、userName、channelName
- 🔍 **Slack 集成**: 针对 Slack 事件（消息、工具调用、附件下载等）定制专用日志函数
- ⚡ **轻量级**: 无外部日志框架依赖，仅使用 `chalk` 库

### 日志分类

#### 1.1 用户消息日志
```typescript
logUserMessage(ctx: LogContext, text: string)
```
- **颜色**: 绿色 (chalk.green)
- **格式**: `[HH:MM:SS] [上下文] 消息文本`
- **用途**: 记录用户发送的消息

#### 1.2 工具执行日志
```typescript
logToolStart(ctx: LogContext, toolName: string, label: string, args: Record<string, unknown>)
logToolSuccess(ctx: LogContext, toolName: string, durationMs: number, result: string)
logToolError(ctx: LogContext, toolName: string, durationMs: number, error: string)
```
- **颜色**: 黄色 (chalk.yellow)
- **图标**: ↳ (开始)、✓ (成功)、✗ (失败)
- **功能**: 
  - 自动截断超过 1000 字符的结果
  - 记录执行时间
  - 智能格式化工具参数（跳过 label，合并 path+offset/limit）

#### 1.3 响应流日志
```typescript
logResponseStart(ctx: LogContext)
logThinking(ctx: LogContext, thinking: string)
logResponse(ctx: LogContext, text: string)
```
- **图标**: → (开始)、💭 (思考)、💬 (响应)
- **用途**: 追踪 AI 响应生成过程

#### 1.4 附件日志
```typescript
logDownloadStart(ctx: LogContext, filename: string, localPath: string)
logDownloadSuccess(ctx: LogContext, sizeKB: number)
logDownloadError(ctx: LogContext, filename: string, error: string)
```
- **图标**: ↓ (下载)、✓ (成功)、✗ (失败)
- **用途**: 追踪 Slack 文件附件下载过程

#### 1.5 系统日志
```typescript
logInfo(message: string)
logWarning(message: string, details?: string)
logAgentError(ctx: LogContext | "system", error: string)
```
- **颜色**: 蓝色 (info)、黄色 (warning)
- **上下文**: 支持 "system" 全局上下文

#### 1.6 使用量日志
```typescript
logUsageSummary(ctx: LogContext, usage, contextTokens?, contextWindow?)
```
- **功能**: 
  - 格式化 token 使用量（自动转换 k/M 单位）
  - 显示缓存读写统计
  - 计算并显示成本
  - 计算上下文窗口占用百分比

#### 1.7 启动/停止日志
```typescript
logStartup(workingDir: string, sandbox: string)
logConnected()
logDisconnected()
logStopRequest(ctx: LogContext)
```

#### 1.8 回填日志
```typescript
logBackfillStart(channelCount: number)
logBackfillChannel(channelName: string, messageCount: number)
logBackfillComplete(totalMessages: number, durationMs: number)
```

### 上下文格式化

```typescript
interface LogContext {
  channelId: string;
  userName?: string;
  channelName?: string;
}

// DM 格式: [DM:username]
// 频道格式: [#channel-name:username] 或 [C16HET4EQ:username] (无名称时)
```

### 消息存储

**文件位置**: `packages/mom/src/store.ts`

消息日志以 JSONL 格式存储到文件系统：
- **格式**: `log.jsonl` - 每行一个 JSON 对象
- **去重**: 基于 `channelId:ts` 键，60秒内自动去重
- **附件**: 后台异步下载，避免阻塞主流程

```typescript
interface LoggedMessage {
  date: string;        // ISO 8601 日期
  ts: string;          // Slack timestamp 或 epoch ms
  user: string;        // 用户 ID 或 "bot"
  userName?: string;
  displayName?: string;
  text: string;
  attachments: Attachment[];
  isBot: boolean;
}
```

### 依赖

```json
{
  "chalk": "^5.6.2"
}
```

---

## 2. .pi/lossless-memory - 无损记忆系统日志

### 架构设计

**文件位置**: `.pi/lossless-memory/src/server/utils/logger.ts`

**设计理念**:
- 🏗️ **结构化日志**: 使用 pino 框架，输出 JSON 格式日志
- 📁 **文件持久化**: 日志自动写入 `logs/{module}.log` 文件
- 🎚️ **日志级别**: 支持 trace/debug/info/warn/error/fatal 六个级别
- 🌐 **环境感知**: 支持 Node.js 和 Cloudflare Workers 环境
- 📦 **模块化**: 每个模块有独立的 logger 实例

### 日志级别

```typescript
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
```

**级别顺序**: trace < debug < info < warn < error < fatal

**默认级别**:
- 开发环境: `debug`
- 生产环境: `info`
- 测试环境: `debug`

### 创建 Logger

#### 2.1 模块化 Logger 工厂

```typescript
export const logger = {
  app: () => createModuleLoggerSync('app'),
  db: () => createModuleLoggerSync('db'),
  api: () => createModuleLoggerSync('api'),
  ws: () => createModuleLoggerSync('ws'),
  bootstrap: () => createModuleLoggerSync('bootstrap'),
  module: (name: string) => createModuleLoggerSync(name),
}
```

#### 2.2 使用示例

```typescript
import { logger } from '../utils/logger'

// 方式 1: 使用预定义模块
const log = logger.api()

// 方式 2: 自定义模块名
const log = logger.module('my-feature')

// 日志输出
log.info({ userId: 123, action: 'login' }, 'User logged in')
log.error({ err: error }, 'Failed to connect to database')
```

### 环境适配

#### Node.js 环境

- **开发模式**: 
  - 控制台彩色输出 (pino-pretty)
  - 文件日志 (logs/{module}.log)
  
- **生产模式**: 
  - 仅文件日志 (logs/{module}.log)
  
- **测试模式**: 
  - 控制台输出（无文件日志）

```typescript
// 开发环境输出示例
[2025-01-15 10:30:45.123] INFO: [api] User logged in {"userId":123,"action":"login"}

// 生产环境 JSON 格式
{"level":"info","time":"2025-01-15T10:30:45.123Z","module":"api","msg":"User logged in","userId":123,"action":"login"}
```

#### Cloudflare Workers 环境

- 仅控制台输出（使用简化的 SimpleLogger）
- 无文件日志支持
- 无 pino 依赖

```typescript
// Cloudflare 输出
[2025-01-15T10:30:45.123Z] INFO: [api] User logged in {"userId":123,"action":"login"}
```

### 文件日志配置

- **目录**: `logs/` (项目根目录)
- **命名**: `{module}.log`
- **格式**: JSON Lines (每行一个 JSON 对象)
- **自动创建**: 目录不存在时自动创建

### 日志轮转

**当前状态**: 未实现自动日志轮转

**建议**: 
- 使用外部工具（如 `logrotate`）进行日志轮转
- 或集成 `pino-roll` 插件

### 依赖

```json
{
  "pino": "^9.7.0",
  "pino-pretty": "^13.0.0"
}
```

---

## 3. 日志使用最佳实践

### 3.1 选择合适的日志系统

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 终端应用/CLI | packages/mom 方案 | 彩色输出、可读性强、无配置 |
| Web 服务/API | .pi/lossless-memory 方案 | 结构化、可搜索、支持日志级别 |
| 长期运行服务 | .pi/lossless-memory 方案 | 文件持久化、易于集成监控系统 |
| 快速原型开发 | packages/mom 方案 | 简单直接、无需配置 |

### 3.2 日志级别使用指南

```typescript
// ✅ 正确示例
log.trace({ data }, 'Entering function X with detailed data')  // 详细的执行追踪
log.debug({ userId, action }, 'User action recorded')           // 开发调试信息
log.info({ event }, 'Application started')                       // 重要业务事件
log.warn({ threshold }, 'Cache hit rate below threshold')       // 需要关注的警告
log.error({ err, context }, 'Failed to process payment')        // 错误但不影响主流程
log.fatal({ err }, 'Database connection lost, shutting down')    // 致命错误

// ❌ 错误示例
log.info('User clicked button')  // 应该用 trace/debug
log.error('Failed to parse JSON')  // 应该提供错误对象和上下文
```

### 3.3 结构化日志字段

```typescript
// ✅ 推荐：使用结构化字段
log.info({ 
  userId: 123, 
  action: 'purchase',
  amount: 99.99,
  currency: 'USD',
  duration: 234
}, 'Purchase completed')

// ❌ 不推荐：字符串拼接
log.info(`User 123 completed purchase of $99.99 USD in 234ms`)
```

### 3.4 敏感信息处理

```typescript
// ✅ 正确示例：过滤敏感字段
log.info({ 
  email: 'user@example.com',
  password: '[REDACTED]',
  token: '[REDACTED]'
}, 'User authentication attempt')

// ❌ 错误示例：记录明文密码
log.info({ email, password }, 'User authentication attempt')
```

### 3.5 错误日志最佳实践

```typescript
try {
  await riskyOperation()
} catch (error) {
  // ✅ 推荐：包含错误对象和上下文
  log.error({ 
    err: error,
    operation: 'riskyOperation',
    userId: context.userId,
    timestamp: Date.now()
  }, 'Operation failed')
  
  // ❌ 不推荐：仅记录消息
  // log.error('Operation failed')
}
```

### 3.6 性能考虑

```typescript
// ✅ 推荐：条件性日志（避免不必要的对象创建）
if (log.level === 'debug') {
  log.debug({ largeObject: expensiveToCompute() }, 'Debug info')
}

// 或使用 pino 的惰性计算
log.debug({ lazy: () => expensiveToCompute() }, 'Debug info')
```

---

## 4. 集成监控和分析

### 4.1 日志聚合工具

推荐工具：
- **ELK Stack** (Elasticsearch + Logstash + Kibana)
- **Grafana Loki**
- **Datadog**
- **Sentry** (错误追踪)

### 4.2 日志格式标准化

使用 pino 的 JSON 格式天然支持日志聚合：

```json
{
  "level": 30,
  "time": "2025-01-15T10:30:45.123Z",
  "module": "api",
  "msg": "Request processed",
  "requestId": "abc-123",
  "method": "GET",
  "path": "/api/users",
  "duration": 45,
  "statusCode": 200
}
```

### 4.3 关键指标

建议追踪的指标：
- 错误率 (error/fatal 级别日志)
- 响应时间 (duration 字段)
- 请求量 (按 module/msg 分组)
- 缓存命中率
- 数据库查询时间

---

## 5. 迁移指南

### 5.1 从 console.log 迁移到 pino

```typescript
// ❌ 之前
console.log('User logged in:', userId)
console.error('Failed:', error)

// ✅ 之后
import { logger } from './utils/logger'
const log = logger.module('my-module')

log.info({ userId }, 'User logged in')
log.error({ err: error }, 'Failed')
```

### 5.2 从 packages/mom 迁移到 pino

如果你需要在 packages/mom 中使用结构化日志：

```typescript
// 1. 安装依赖
// npm install pino pino-pretty

// 2. 替换 log.ts
import { logger } from '@mariozechner/pi-logger'

const log = logger.module('mom')

// 3. 使用
log.info({ channelId, userName, text }, 'User message received')
log.info({ toolName, duration: durationMs }, 'Tool execution completed')
```

---

## 6. 常见问题

### Q1: 为什么项目中有两种日志实现？

**A**: 两个包有不同的设计目标：
- **packages/mom**: 终端应用，需要即时可视化反馈，彩色输出提升用户体验
- **.pi/lossless-memory**: Web 服务，需要结构化日志进行监控和分析

### Q2: 如何设置日志级别？

**A**: 
- packages/mom: 无日志级别控制，所有日志都输出
- .pi/lossless-memory: 通过环境变量 `NODE_ENV` 自动设置，或通过代码传入

```typescript
// 方式 1: 环境变量
NODE_ENV=production npm start  // 级别: info

// 方式 2: 代码
const log = logger.module('my-module', 'debug')
```

### Q3: 日志文件在哪里？

**A**: 
- packages/mom: 无文件日志，仅控制台输出
- .pi/lossless-memory: `logs/{module}.log`

### Q4: 如何在 Cloudflare Workers 中使用日志？

**A**: .pi/lossless-memory 的日志系统自动适配 Cloudflare 环境：
```typescript
// 无需特殊配置，自动检测环境
const log = logger.api()
log.info({ msg: 'Hello from Workers' }, 'Request received')
```

### Q5: 如何调试日志不输出的问题？

**A**: 
1. 检查日志级别设置
2. 确认 `logs/` 目录权限
3. 检查 `NODE_ENV` 环境变量
4. 使用 `log.level` 属性查看当前级别

```typescript
console.log('Current log level:', log.level)
```

---

## 7. 未来改进计划

### 7.1 短期改进 (v1.0)
- [ ] 为 .pi/lossless-memory 添加日志轮转功能
- [ ] 实现统一的日志格式规范
- [ ] 添加日志采样机制（高流量场景）

### 7.2 中期改进 (v2.0)
- [ ] 集成 OpenTelemetry 分布式追踪
- [ ] 实现日志聚合和分析仪表板
- [ ] 添加日志告警规则

### 7.3 长期改进 (v3.0)
- [ ] 统一两个日志系统，提供可插拔的日志后端
- [ ] 支持日志加密和压缩
- [ ] 实现 AI 驱动的日志异常检测

---

## 8. 参考资料

- [Pino 官方文档](https://github.com/pinojs/pino)
- [Pino Pretty 文档](https://github.com/pinojs/pino-pretty)
- [Chalk 文档](https://github.com/chalk/chalk)
- [Node.js 日志最佳实践](https://nodejs.org/en/docs/guides/simple-logging/)
- [The Twelve-Factor App - Logs](https://12factor.net/logs)

---

**文档版本**: v1.0  
**最后更新**: 2025-01-15  
**维护者**: 项目团队
