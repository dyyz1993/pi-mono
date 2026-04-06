# 日志系统快速参考

## 快速开始

### packages/mom (终端应用)

```typescript
import { logUserMessage, logToolStart, logInfo } from './log'

// 上下文
const ctx = { channelId: 'C123', userName: 'alice', channelName: 'general' }

// 基本用法
logUserMessage(ctx, 'Hello world!')
logToolStart(ctx, 'read', 'Reading file', { path: '/src/index.ts' })
logInfo('Server started on port 3000')
```

### .pi/lossless-memory (Web 服务)

```typescript
import { logger } from './utils/logger'

const log = logger.api()  // 或 logger.module('my-feature')

// 基本用法
log.info({ userId: 123 }, 'User logged in')
log.error({ err: error }, 'Database connection failed')
```

---

## 日志级别对照表

| 级别 | 用途 | packages/mom | pino |
|------|------|--------------|------|
| trace | 详细执行追踪 | ❌ 不支持 | ✅ |
| debug | 开发调试信息 | ❌ 不支持 | ✅ |
| info | 重要业务事件 | ✅ (绿色) | ✅ |
| warn | 需要关注的警告 | ✅ (黄色) | ✅ |
| error | 错误（不影响主流程） | ✅ (红色) | ✅ |
| fatal | 致命错误 | ❌ 不支持 | ✅ |

---

## 常用函数速查

### packages/mom

| 函数 | 颜色 | 用途 |
|------|------|------|
| `logUserMessage()` | 绿色 | 用户消息 |
| `logToolStart()` | 黄色 | 工具开始执行 |
| `logToolSuccess()` | 黄色 + ✓ | 工具执行成功 |
| `logToolError()` | 黄色 + ✗ | 工具执行失败 |
| `logResponseStart()` | 黄色 + → | 开始流式响应 |
| `logThinking()` | 黄色 + 💭 | AI 思考过程 |
| `logResponse()` | 黄色 + 💬 | AI 响应文本 |
| `logDownloadStart()` | 黄色 + ↓ | 开始下载附件 |
| `logDownloadSuccess()` | 黄色 + ✓ | 下载成功 |
| `logDownloadError()` | 黄色 + ✗ | 下载失败 |
| `logInfo()` | 蓝色 | 系统信息 |
| `logWarning()` | 黄色 | 警告 |
| `logAgentError()` | 红色 | Agent 错误 |
| `logUsageSummary()` | - | Token 使用量 |
| `logStartup()` | - | 启动信息 |
| `logConnected()` | - | WebSocket 连接 |
| `logDisconnected()` | - | WebSocket 断开 |

### .pi/lossless-memory

```typescript
// 模块化 Logger
logger.app()        // 应用日志
logger.db()         // 数据库日志
logger.api()        // API 日志
logger.ws()         // WebSocket 日志
logger.bootstrap()  // 启动日志
logger.module(name) // 自定义模块

// 日志方法
log.trace({ data }, 'message')
log.debug({ data }, 'message')
log.info({ data }, 'message')
log.warn({ data }, 'message')
log.error({ data }, 'message')
log.fatal({ data }, 'message')
log.child({ extra: 'context' })  // 子 Logger
```

---

## 环境配置

### packages/mom
无需配置，直接使用。

### .pi/lossless-memory

```bash
# 环境变量
NODE_ENV=development  # 日志级别: debug, 输出到控制台+文件
NODE_ENV=production   # 日志级别: info, 仅输出到文件
NODE_ENV=test         # 日志级别: debug, 仅输出到控制台

# 日志文件位置
logs/
├── app.log
├── db.log
├── api.log
├── ws.log
└── bootstrap.log
```

---

## 结构化日志示例

### 推荐格式

```typescript
// ✅ 好的结构化日志
log.info({
  userId: 123,
  action: 'purchase',
  productId: 456,
  amount: 99.99,
  currency: 'USD',
  duration: 234
}, 'Purchase completed successfully')

// 输出 JSON (pino)
{
  "level": 30,
  "time": "2025-01-15T10:30:45.123Z",
  "module": "api",
  "msg": "Purchase completed successfully",
  "userId": 123,
  "action": "purchase",
  "productId": 456,
  "amount": 99.99,
  "currency": "USD",
  "duration": 234
}
```

### 常见字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `userId` | string/number | 用户标识 |
| `requestId` | string | 请求追踪 ID |
| `duration` | number | 执行时间 (ms) |
| `statusCode` | number | HTTP 状态码 |
| `method` | string | HTTP 方法 |
| `path` | string | 请求路径 |
| `err` | Error | 错误对象 |
| `err.stack` | string | 错误堆栈 |

---

## 调试技巧

### 查看日志文件
```bash
# 实时查看日志
tail -f logs/api.log

# 搜索特定错误
grep '"level":50' logs/api.log  # error 级别

# 按模块查看
cat logs/db.log | jq 'select(.msg | contains("Query"))'

# 统计错误数量
grep -c '"level":50' logs/api.log
```

### 性能分析
```bash
# 查找慢请求 (duration > 1000ms)
cat logs/api.log | jq 'select(.duration > 1000)'

# 统计平均响应时间
cat logs/api.log | jq -r '.duration' | awk '{sum+=$1; count++} END {print "avg:", sum/count, "ms"}'
```

---

## 常见陷阱

### ❌ 错误用法

```typescript
// 1. 字符串拼接（难以搜索）
log.info(`User ${userId} logged in`)

// 2. 记录敏感信息
log.info({ password: 'secret123' }, 'User login')

// 3. 日志级别不当
log.error('User clicked button')  // 应该用 debug/trace

// 4. 缺少上下文
log.error('Database error')  // 应该包含 error 对象和相关字段

// 5. 高频日志无采样
log.debug({ largeData }, 'Processing')  // 可能导致性能问题
```

### ✅ 正确用法

```typescript
// 1. 结构化字段
log.info({ userId }, 'User logged in')

// 2. 过滤敏感信息
log.info({ email, password: '[REDACTED]' }, 'User login attempt')

// 3. 合适的级别
log.debug({ userId }, 'Button clicked')

// 4. 完整的上下文
log.error({ err: error, db: 'users', operation: 'insert' }, 'Database operation failed')

// 5. 条件性日志
if (log.level === 'debug') {
  log.debug({ largeData: expensiveCompute() }, 'Processing')
}
```

---

## 监控集成

### ELK Stack

```yaml
# logstash.conf
input {
  file {
    path => "/var/log/app/*.log"
    codec => "json"
  }
}

filter {
  date {
    match => [ "time", "ISO8601" ]
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "app-logs-%{+YYYY.MM.dd}"
  }
}
```

### Grafana Loki

```yaml
# loki-config.yml
scrape_configs:
  - job_name: app
    static_configs:
      - targets:
          - localhost
        labels:
          job: app
          __path__: /var/log/app/*.log
```

### Datadog

```bash
# 安装 Datadog Agent
DD_API_KEY=xxx bash -c "$(curl -L https://s3.amazonaws.com/dd-agent/scripts/install_script.sh)"

# 配置日志收集
# /etc/datadog-agent/conf.d/app.d/conf.yaml
logs:
  - type: file
    path: /var/log/app/*.log
    service: my-app
    source: nodejs
```

---

## 故障排查清单

- [ ] 检查 `NODE_ENV` 环境变量
- [ ] 确认日志级别设置
- [ ] 验证 `logs/` 目录权限
- [ ] 检查磁盘空间
- [ ] 确认日志文件大小限制
- [ ] 验证日志格式是否为 JSON
- [ ] 检查日志聚合工具配置
- [ ] 确认时区设置正确
- [ ] 验证敏感信息过滤规则
- [ ] 检查日志轮转配置

---

**快速链接**:
- [详细架构文档](./LOG_ARCHITECTURE.md)
- [Pino 文档](https://github.com/pinojs/pino)
- [日志最佳实践](https://12factor.net/logs)
