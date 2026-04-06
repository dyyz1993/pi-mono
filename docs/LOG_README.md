# 日志系统文档中心

本目录包含项目日志架构的完整文档。项目中有两种日志实现方案，分别适用于不同场景。

---

## 📚 文档导航

### 🚀 [快速开始](./LOG_QUICK_REFERENCE.md)
**适合**: 想要快速上手的开发者

- 常用函数速查表
- 代码示例
- 环境配置
- 调试技巧
- 常见陷阱

**阅读时间**: 5 分钟

---

### 🏗️ [架构详解](./LOG_ARCHITECTURE.md)
**适合**: 需要深入了解日志系统的开发者

- 两种日志方案的详细设计
- 实现原理和源码分析
- 日志分类和格式规范
- 集成监控和分析
- 迁移指南
- 常见问题

**阅读时间**: 20 分钟

---

### 🎯 [方案选择指南](./LOG_DECISION_GUIDE.md)
**适合**: 正在决定使用哪种日志方案的开发者

- 决策树和决策矩阵
- 详细对比表
- 性能基准测试
- 集成复杂度分析
- 迁移路径
- 混合使用策略

**阅读时间**: 15 分钟

---

## 🗺️ 推荐阅读路径

### 路径 1: 快速入门 (新用户)
1. [快速开始](./LOG_QUICK_REFERENCE.md) - 5 分钟
2. 选择你的项目类型：
   - 终端应用 → 参考 "packages/mom" 章节
   - Web 服务 → 参考 ".pi/lossless-memory" 章节

### 路径 2: 深度理解 (架构师)
1. [架构详解](./LOG_ARCHITECTURE.md) - 理解设计理念
2. [方案选择指南](./LOG_DECISION_GUIDE.md) - 做出正确决策
3. [快速开始](./LOG_QUICK_REFERENCE.md) - 实践参考

### 路径 3: 迁移项目 (现有项目)
1. [方案选择指南](./LOG_DECISION_GUIDE.md) → "迁移路径" 章节
2. [架构详解](./LOG_ARCHITECTURE.md) → "迁移指南" 章节
3. [快速开始](./LOG_QUICK_REFERENCE.md) → "调试技巧" 章节

---

## 🔍 快速查找

### 我想了解...

| 主题 | 文档 | 章节 |
|------|------|------|
| 基本用法 | [快速开始](./LOG_QUICK_REFERENCE.md) | "快速开始" |
| 日志级别 | [快速开始](./LOG_QUICK_REFERENCE.md) | "日志级别对照表" |
| 彩色输出 | [架构详解](./LOG_ARCHITECTURE.md) | "1. packages/mom" |
| 结构化日志 | [架构详解](./LOG_ARCHITECTURE.md) | "2. .pi/lossless-memory" |
| 文件持久化 | [架构详解](./LOG_ARCHITECTURE.md) | "文件日志配置" |
| 性能优化 | [方案选择指南](./LOG_DECISION_GUIDE.md) | "性能对比" |
| 监控集成 | [架构详解](./LOG_ARCHITECTURE.md) | "集成监控和分析" |
| 从 console.log 迁移 | [方案选择指南](./LOG_DECISION_GUIDE.md) | "迁移路径" |
| Cloudflare Workers | [架构详解](./LOG_ARCHITECTURE.md) | "环境适配" |
| 错误处理 | [快速开始](./LOG_QUICK_REFERENCE.md) | "常见陷阱" |

---

## 📖 两种方案概览

### 方案 1: packages/mom (终端应用)

**文件**: `packages/mom/src/log.ts`

**特点**:
- 🎨 彩色终端输出 (chalk)
- 📊 上下文感知 (channelId, userName)
- 🔍 Slack 集成专用函数
- ⚡ 轻量级、无配置

**适合**:
- CLI 工具
- 终端应用
- 实时反馈场景
- 快速原型

**示例**:
```typescript
import { logUserMessage, logToolStart } from './log'

const ctx = { channelId: 'C123', userName: 'alice' }
logUserMessage(ctx, 'Hello world!')
logToolStart(ctx, 'read', 'Reading file', { path: '/src/index.ts' })
```

---

### 方案 2: .pi/lossless-memory (Web 服务)

**文件**: `.pi/lossless-memory/src/server/utils/logger.ts`

**特点**:
- 🏗️ 结构化 JSON 日志 (pino)
- 📁 文件持久化
- 🎚️ 6 个日志级别
- 🌐 环境自动适配
- 📦 模块化设计

**适合**:
- Web API
- 微服务
- 长期运行的服务
- 需要监控的生产环境

**示例**:
```typescript
import { logger } from './utils/logger'

const log = logger.api()
log.info({ userId: 123 }, 'User logged in')
log.error({ err: error }, 'Database connection failed')
```

---

## 🛠️ 代码位置

```
.
├── packages/
│   └── mom/
│       └── src/
│           ├── log.ts          # 彩色日志实现
│           └── store.ts        # 消息存储 (JSONL)
│
└── .pi/
    └── lossless-memory/
        └── src/
            └── server/
                └── utils/
                    └── logger.ts  # 结构化日志实现
```

---

## 📦 依赖关系

### packages/mom
```json
{
  "chalk": "^5.6.2"
}
```

### .pi/lossless-memory
```json
{
  "pino": "^9.7.0",
  "pino-pretty": "^13.0.0"
}
```

---

## 🌟 最佳实践速览

### ✅ DO
```typescript
// 使用结构化字段
log.info({ userId: 123, action: 'login' }, 'User logged in')

// 选择合适的日志级别
log.debug('Detailed debug info')  // 开发调试
log.info('Important event')       // 业务事件
log.error({ err }, 'Error occurred')  // 错误追踪

// 过滤敏感信息
log.info({ email, password: '[REDACTED]' }, 'Login attempt')
```

### ❌ DON'T
```typescript
// 字符串拼接
log.info(`User ${userId} logged in`)

// 记录敏感信息
log.info({ password: 'secret' }, 'Login')

// 日志级别不当
log.error('Button clicked')  // 应该用 debug

// 缺少上下文
log.error('Failed')  // 应该包含 error 对象
```

---

## 🔗 外部资源

- [Pino 官方文档](https://github.com/pinojs/pino) - 高性能 JSON 日志框架
- [Chalk 官方文档](https://github.com/chalk/chalk) - 终端字符串样式库
- [The Twelve-Factor App - Logs](https://12factor.net/logs) - 日志最佳实践
- [Node.js 日志指南](https://nodejs.org/en/docs/guides/simple-logging/) - Node.js 官方日志指南

---

## 💡 快速决策

**只需要一个答案？** 看这里：

```
你的应用是什么？
│
├─ 终端/CLI 工具 ──> packages/mom (chalk)
│
├─ Web API/服务 ──> .pi/lossless-memory (pino)
│
└─ 不确定 ──> [看这里](./LOG_DECISION_GUIDE.md)
```

---

## ❓ 还有问题？

1. 查看 [架构详解 - 常见问题](./LOG_ARCHITECTURE.md#6-常见问题)
2. 查看 [快速开始 - 常见陷阱](./LOG_QUICK_REFERENCE.md#常见陷阱)
3. 查看项目源码：
   - `packages/mom/src/log.ts`
   - `.pi/lossless-memory/src/server/utils/logger.ts`

---

**文档版本**: v1.0  
**最后更新**: 2025-01-15  
**维护者**: 项目团队
