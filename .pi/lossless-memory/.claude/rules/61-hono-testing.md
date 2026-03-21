---
paths: src/server/**/*.test.ts, src/server/**/__tests__/**/*.ts
---

# Hono 测试最佳实践

## 🎯 核心原则

测试必须使用**类型安全的 RPC 客户端**，确保端到端类型推导。

## 📁 测试文件结构

```
src/server/
├── module-todos/
│   └── __tests__/
│       └── todos-route-rpc.test.ts    # HTTP API 测试
├── module-chat/
│   └── __tests__/
│       └── chat-rpc.test.ts           # WebSocket 测试
├── module-notifications/
│   └── __tests__/
│       └── sse-rpc.test.ts            # SSE 测试
└── test-utils/
    ├── test-client.ts                 # 测试客户端工厂
    └── test-server.ts                 # 测试服务器（WebSocket 需要）
```

## 🔧 测试客户端

### createTestClient

```typescript
import { createTestClient } from '../../test-utils/test-client'

// 方式 1：不传 baseUrl - 用于 HTTP/SSE 测试
const client = createTestClient()
// 内部使用 app.fetch() 模拟请求，不需要启动服务器

// 方式 2：传入 baseUrl - 用于 WebSocket 测试
const client = createTestClient(`http://localhost:${port}`)
// 连接真实服务器，用于 WebSocket 测试
```

## 📋 测试类型对比

| 测试类型  | 是否需要启动服务器 | 使用方式                                           |
| --------- | ------------------ | -------------------------------------------------- |
| HTTP API  | ❌ 不需要          | `createTestClient()`                               |
| SSE       | ❌ 不需要          | `createTestClient()` + `$sse()`                    |
| WebSocket | ✅ 必须启动        | `createTestClient(baseUrl)` + `createTestServer()` |

## 🧪 HTTP API 测试

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'

describe('Todo API', () => {
  it('should return todos', async () => {
    const client = createTestClient()

    // ✅ 类型安全的 API 调用
    const res = await client.api.todos.$get()
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('should create todo', async () => {
    const client = createTestClient()

    const res = await client.api.todos.$post({
      json: { title: 'New Todo' },
    })
    expect(res.status).toBe(201)
  })
})
```

## 🔄 SSE 测试

```typescript
import { describe, it, expect } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'
import type { AppSSEProtocol } from '@shared/schemas'

describe('SSE Routes', () => {
  it('should receive events with type safety', async () => {
    const client = createTestClient()

    // ✅ 使用 $sse() 方法
    const conn = await client.api.notifications.stream.$sse()

    // 类型安全的事件监听
    conn.on('notification', notification => {
      // notification 类型自动推导
      expect(notification.id).toBeDefined()
    })

    conn.on('ping', ping => {
      expect(ping.timestamp).toBeDefined()
    })

    // 等待事件
    await new Promise(resolve => setTimeout(resolve, 1000))

    conn.abort()
  })
})
```

## 🔌 WebSocket 测试

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'
import { createTestServer } from '../../test-utils/test-server'
import { createApp } from '@server/app'

describe('WebSocket Routes', () => {
  let testServer: Awaited<ReturnType<typeof createTestServer>>
  let client: ReturnType<typeof createTestClient>

  beforeAll(async () => {
    // ⚠️ WebSocket 测试必须启动服务器
    const app = createApp()
    testServer = await createTestServer(app, ['/api/chat/ws'])
    client = createTestClient(`http://localhost:${testServer.port}`)
  }, 15000)

  afterAll(async () => {
    await testServer.close()
  })

  it('should handle RPC calls', async () => {
    // ✅ 使用 $ws() 方法
    const ws = client.api.chat.ws.$ws()

    // 等待连接
    await new Promise<void>(resolve => {
      ws.onStatusChange(status => {
        if (status === 'open') resolve()
      })
    })

    // 类型安全的 RPC 调用
    const result = await ws.call('echo', { message: 'hello' })
    expect(result.message).toBe('hello')

    ws.close()
  })
})
```

## 📝 测试命名规范

| 类型     | 约定            | 示例                      |
| -------- | --------------- | ------------------------- |
| 测试文件 | \*-rpc.test.ts  | `todos-route-rpc.test.ts` |
| 测试描述 | should + 动词   | `should return todos`     |
| 测试分组 | 模块名 + Routes | `Todo Routes`             |

## 🚫 Anti-Patterns

```typescript
// ❌ 不要直接使用 fetch
const res = await fetch('/api/todos')

// ✅ 应该使用类型安全的客户端
const res = await client.api.todos.$get()

// ❌ 不要手动解析响应
const data = JSON.parse(await res.text())

// ✅ 应该使用 json() 方法
const data = await res.json()

// ❌ WebSocket 测试不要忘记启动服务器
const client = createTestClient()
const ws = client.api.chat.ws.$ws() // 会失败！

// ✅ WebSocket 测试必须启动服务器
const testServer = await createTestServer(app, ['/api/chat/ws'])
const client = createTestClient(`http://localhost:${testServer.port}`)
const ws = client.api.chat.ws.$ws()
```

## 🎯 总结

测试的关键点：

1. ✅ 使用 `createTestClient()` 创建测试客户端
2. ✅ HTTP/SSE 测试不需要启动服务器
3. ✅ WebSocket 测试必须启动服务器
4. ✅ 使用 `$get()`, `$post()` 等类型安全方法
5. ✅ 使用 `$sse()` 测试 SSE
6. ✅ 使用 `$ws()` 测试 WebSocket
7. ✅ 遵循 ESLint 规则
