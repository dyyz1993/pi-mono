---
paths: src/cli/**/*
---

# CLI 模块规范

## 📋 原则

**CLI 是服务端的 RPC 客户端，通过命令行方式调用服务端 API。**

## 📂 目录结构

```
src/cli/
├── modules/                    # 业务模块（约定：一个模块一个目录）
│   ├── todo/
│   │   └── index.ts           # todo list/get/create/update/delete
│   ├── notification/
│   │   └── index.ts           # notification list/create/mark-read/delete
│   ├── config/
│   │   └── index.ts           # 配置管理
│   └── index.ts               # 模块注册入口
├── utils/
│   ├── api.ts                 # baseUrl 管理 + getClient
│   ├── logger.ts              # 日志模块（支持 verbose）
│   ├── auto-command.ts        # 自动命令生成器
│   └── index.ts
├── rpc/
│   ├── client.ts              # hc RPC 客户端
│   └── index.ts
└── index.ts                   # CLI 入口
```

## ✅ 命令结构

### 嵌套命令格式

```bash
biomimic --help                    # 查看所有模块
biomimic todo --help               # 查看 todo 模块命令
biomimic todo create --help        # 查看 create 命令详情
biomimic todo create --title "x"   # 执行命令
```

### 模块注册

```typescript
// src/cli/modules/todo/index.ts
import { Command } from 'commander'
import { registerAutoCommand, type RouteConfig } from '../../utils/auto-command'
import { z } from '@hono/zod-openapi'

const todoRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/todos',
    command: 'list',
    description: 'List all todos',
  },
  {
    method: 'post',
    path: '/todos',
    command: 'create',
    description: 'Create a new todo',
    body: z.object({
      title: z.string().min(1),
      description: z.string().optional(),
    }),
  },
]

export function registerTodoCommands(program: Command) {
  const todo = program.command('todo').description('Todo management commands')
  for (const route of todoRoutes) {
    registerAutoCommand(todo, route)
  }
}
```

## 🔧 RPC 客户端

### 使用 hc 客户端

```typescript
// src/cli/rpc/client.ts
import { hc } from 'hono/client'
import type { AppType } from '@server/index'
import { WSClientImpl } from '@shared/core/ws-client'
import { SSEClientImpl } from '@shared/core/sse-client'

export function createRPCClient(baseUrl: string) {
  return hc<AppType>(baseUrl, {
    webSocket: url => new WSClientImpl(url),
    sse: url => new SSEClientImpl(url),
  })
}
```

### 调用 API

```typescript
// ✅ 正确：直接使用 hc 客户端
const client = getClient()
const res = await client.api.todos.$get()
const data = await res.json()

// ❌ 错误：不要使用 fetch
const res = await fetch('http://localhost:3000/api/todos')
```

## 📝 自动命令生成

### RouteConfig 定义

```typescript
type RouteConfig = {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch'
  path: string
  command: string
  description: string
  params?: ZodObject<Record<string, ZodType>> // 路径参数 -> arguments
  body?: ZodType // 请求体 -> options
  query?: ZodObject<Record<string, ZodType>> // 查询参数 -> options
}
```

### 自动生成效果

```bash
$ biomimic todo create --help
Usage: biomimic todo create [options]

Create a new todo

Options:
  --title <value>        string (required)
  --description <value>  string
  -h, --help             display help for command
```

## 📊 日志规范

```typescript
import { getLogger } from '../utils/logger'

const logger = getLogger()

logger.info('普通信息') // 总是显示
logger.debug('调试信息') // 需要 --verbose
logger.warn('警告信息') // 总是显示
logger.error('错误信息') // 总是显示
logger.success('操作成功') // 带 ✓ 前缀
```

### 开启详细日志

```bash
# 通过 --verbose
biomimic --verbose todo list

# 通过环境变量
BIOMIMIC_VERBOSE=true biomimic todo list
```

## ⚙️ 配置管理

### 配置文件路径

```
~/.biomimic/config.json
```

### 配置结构

```json
{
  "baseUrl": "http://localhost:3000",
  "stats": {
    "totalCalls": 10,
    "lastCallAt": "2024-01-01T00:00:00Z",
    "commands": {
      "todo:list": 5,
      "notification:create": 3
    }
  }
}
```

### 配置命令

```bash
biomimic config get              # 查看配置
biomimic config url              # 查看当前 URL
biomimic config url http://...   # 设置 URL
biomimic config status           # 检查服务状态
biomimic config path             # 查看配置文件路径
```

## 🚫 禁止事项

| 禁止             | 原因         | 替代方案         |
| ---------------- | ------------ | ---------------- |
| 使用 fetch       | 不走类型安全 | 使用 hc 客户端   |
| 直接导入 Service | 绕过 RPC     | 通过 API 调用    |
| 硬编码 URL       | 不可配置     | 使用 config 模块 |
| 使用 console.log | 无法控制     | 使用 logger      |

## 📝 新增模块步骤

1. 在 `src/cli/modules/` 下创建目录
2. 定义 `RouteConfig[]` 数组
3. 实现 `registerXxxCommands(program: Command)` 函数
4. 在 `modules/index.ts` 中注册

## 🎯 最佳实践

### 命令命名

```typescript
// ✅ 正确：动词作为子命令
todo list, todo create, todo update, todo delete

// ❌ 错误：名词作为子命令
todo list-todo, create-todo
```

### 参数设计

```typescript
// ✅ 正确：必填参数用 argument
.argument('<id>', 'Todo ID')

// ✅ 正确：可选参数用 option
.option('--title <value>', 'Todo title')

// ✅ 正确：必填选项用 requiredOption
.requiredOption('--title <value>', 'Todo title')
```

### 错误处理

```typescript
// ✅ 正确：使用 logger 并退出
if (!id) {
  logger.error('Error: --id is required')
  process.exit(1)
}

// ❌ 错误：抛出异常
if (!id) {
  throw new Error('--id is required')
}
```

## 🔗 相关文档

- [20-server-api.md](./20-server-api.md) - 服务端 API 规范
- [40-shared-types.md](./40-shared-types.md) - 共享类型规范
- [10-api-type-inference.md](./10-api-type-inference.md) - API 类型推断
