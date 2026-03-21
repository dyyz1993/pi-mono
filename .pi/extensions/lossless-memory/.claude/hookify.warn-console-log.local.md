---
name: warn-console-log
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: src/.*\.(ts|tsx)$
  - field: new_text
    operator: regex_match
    pattern: console\.log\(
---

⚠️ **检测到 console.log**

项目规则禁止在生产代码中使用 console.log。

**请使用项目提供的 logger 工具：**

```typescript
// ❌ 避免
console.log('User created:', userId)

// ✅ 推荐 - 服务端使用
import { logger } from '@server/utils/logger'

const log = logger.api() // 或 logger.db(), logger.ws(), logger.app()
log.info({ userId }, 'User created successfully')

// ✅ 推荐 - 不同模块使用不同的 logger
const dbLog = logger.db()
dbLog.debug({ query, params }, 'Executing database query')

const wsLog = logger.ws()
wsLog.info({ clientId, message }, 'WebSocket message received')

// ✅ 推荐 - 自定义模块
const customLog = logger.module('my-module')
customLog.warn({ error }, 'Operation failed')
```

**Logger API：**

```typescript
// 可用的 logger 实例
logger.app() // 应用级别日志
logger.db() // 数据库日志
logger.api() // API 日志
logger.ws() // WebSocket 日志
logger.bootstrap() // 启动日志
logger.module(name) // 自定义模块日志

// 日志级别（按严重程度）
log.trace({ data }, 'message') // 最详细
log.debug({ data }, 'message') // 调试信息
log.info({ data }, 'message') // 一般信息
log.warn({ data }, 'message') // 警告
log.error({ data }, 'message') // 错误
log.fatal({ data }, 'message') // 致命错误
```

**参数说明：**

- 第一个参数：对象，包含要记录的结构化数据
- 第二个参数：字符串，描述性消息

**优势：**

- 结构化日志，便于搜索和分析
- 自动添加时间戳和模块标识
- 支持日志文件输出（生产环境）
- 支持日志级别过滤
- 支持 Cloudflare Workers 环境
