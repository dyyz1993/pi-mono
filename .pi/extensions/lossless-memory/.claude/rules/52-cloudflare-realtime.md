---
paths: src/server/core/durable-objects/RealtimeDO.ts, src/server/entries/cloudflare.ts, wrangler.toml
---

# Cloudflare 实时通信架构规范

## 🎯 核心价值

Cloudflare Workers 和 Durable Objects 是**完全隔离的执行环境**，无法共享内存。本规范描述如何在 Cloudflare 环境下正确实现 SSE/WebSocket 实时通信。

## ⚠️ 核心问题：Worker 和 DO 的隔离

### 问题说明

Cloudflare Workers 和 Durable Objects 运行在**不同的隔离环境**中，即使代码中使用了"单例"模式，单例也只在**同一个隔离环境**内有效。

```
┌─────────────────────────────────────────────────────────────────┐
│                        Worker 环境 A                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         CloudflareRuntimeAdapter 实例 A                   │  │
│  │                   RealtimeCore A                          │  │
│  │         ┌──────────────────────────────┐                   │  │
│  │         │   sseClients: Map<string>   │  ← SSE 客户端连接  │  │
│  │         └──────────────────────────────┘                   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Durable Object 环境 B                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         CloudflareRuntimeAdapter 实例 B  ← 完全独立！      │  │
│  │                   RealtimeCore B                          │  │
│  │         ┌──────────────────────────────┐                   │  │
│  │         │   sseClients: Map<string>   │  ← 空的！         │  │
│  │         └──────────────────────────────┘                   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 错误架构

```typescript
// ❌ 错误 - SSE 连接在 Worker，broadcast 发送到 DO
// Worker 中：
const adapter = getCloudflareRuntimeAdapter()
adapter.handleSSERequest() // 客户端连接到 Worker 的 core

// DO 中：
this.core.broadcast(data, exclude, event) // 广播到 DO 的 core（空的！）
```

## ✅ 正确架构：所有连接路由到 Durable Object

### 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Worker 环境                               │
│                                                                   │
│  SSE 请求 ──────────────────────────────────────────────────────┐│
│                                                                   ││
│  broadcast 请求 ────────────────────────────────────────────────┼┤
│                                                                   ││
└──────────────────────────────────────────────────────────────────┼┤
                                                                     ││
                              ▼                                      ││
┌─────────────────────────────────────────────────────────────────┐│
│               Durable Object (RealtimeDurableObject)             ││
│  ┌───────────────────────────────────────────────────────────┐  ││
│  │         RealtimeCore (唯一实例)                           │  ││
│  │         ┌──────────────────────────────┐                  │  ││
│  │         │   sseClients: Map<string>   │ ← 所有 SSE 连接  │  ││
│  │         │   wsClients: Map<string>    │ ← 所有 WS 连接   │  ││
│  │         └──────────────────────────────┘                  │  ││
│  │                                                           │  ││
│  │  broadcast(data, exclude, event) {                        │  ││
│  │    for (client of sseClients) {                           │  ││
│  │      client.send(data)  ← 同一个环境，可以访问！          │  ││
│  │    }                                                      │  ││
│  │  }                                                        │  ││
│  └───────────────────────────────────────────────────────────┘  ││
└─────────────────────────────────────────────────────────────────┘│
```

## 📁 相关文件

| 文件                                            | 职责                      |
| ----------------------------------------------- | ------------------------- |
| `src/server/core/durable-objects/RealtimeDO.ts` | Durable Object 实现       |
| `src/server/entries/cloudflare.ts`              | Worker 入口，导出 DO 类   |
| `wrangler.toml`                                 | DO 绑定和迁移配置         |
| `src/server/core/index.ts`                      | realtime.broadcast() 实现 |
| `src/server/module-*/routes/*.ts`               | SSE 路由转发到 DO         |

## 🔧 配置规范

### wrangler.toml 配置

```toml
# Durable Object 绑定
[[durable_objects.bindings]]
name = "REALTIME_DO"
class_name = "RealtimeDurableObject"

# 迁移配置（首次部署）
[[migrations]]
tag = "v1"
new_sqlite_classes = ["RealtimeDurableObject"]

# 迁移配置（重命名时）
[[migrations]]
tag = "v2"
renamed_classes = [{ from = "OldClassName", to = "RealtimeDurableObject" }]
```

### 绑定类型定义

```typescript
// src/server/types/bindings.ts
export interface AppBindings {
  DB?: D1Database
  ASSETS?: { fetch: (request: Request) => Promise<Response> }
  REALTIME_DO?: DurableObjectNamespace // DO 绑定
  ENVIRONMENT?: string
}

// src/server/entries/cloudflare.ts
export interface CloudflareBindings extends AppBindings {
  DB: D1Database
  REALTIME_DO: DurableObjectNamespace // Cloudflare 环境必须
}
```

## 📤 SSE 路由转发规范

### 业务路由转发到 DO

SSE 路由必须将请求转发到 Durable Object：

```typescript
// src/server/module-notifications/routes/notification-routes.ts
import type { AppSSEProtocol } from '@shared/schemas'

const streamRoute = createRoute({
  method: 'get',
  path: '/notifications/stream',
  tags: ['notifications'],
  responses: {
    200: {
      content: {
        'text/event-stream': { schema: AppSSEProtocolSchema },
      },
      description: 'SSE stream for notifications',
    },
  },
})

export const notificationRoutes = new OpenAPIHono().openapi(streamRoute, async c => {
  // Cloudflare 环境：转发到 Durable Object
  const env = c.env as { REALTIME_DO?: DurableObjectNamespace } | undefined
  if (env?.REALTIME_DO) {
    const id = env.REALTIME_DO.idFromName('global')
    const stub = env.REALTIME_DO.get(id)
    const doRequest = new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
    })
    return stub.fetch(doRequest)
  }

  // Node 环境回退
  const adapter = getRuntimeAdapter()
  if ('handleSSERequest' in adapter) {
    return adapter.handleSSERequest()
  }
  return c.json({ success: false, error: 'SSE not supported' }, 500)
})
```

### 关键点

1. **检查 `REALTIME_DO` 绑定** - 判断是否在 Cloudflare 环境
2. **使用 `idFromName('global')`** - 所有请求使用同一个 DO 实例
3. **转发原始请求** - 保留所有 headers（包括 `Accept: text/event-stream`）

## 📨 Broadcast 规范

### realtime.broadcast() 实现

```typescript
// src/server/core/index.ts
import { isCloudflare } from '../utils/env'

let _env: { REALTIME_DO?: DurableObjectNamespace } | null = null

export function setRealtimeEnv(env: { REALTIME_DO?: DurableObjectNamespace }): void {
  _env = env
}

function createRealtimeService(): RealtimeService {
  // Cloudflare 环境：发送到 DO
  if (isCloudflare && _env?.REALTIME_DO) {
    return {
      async broadcast(event: string, data: unknown): Promise<void> {
        const id = _env!.REALTIME_DO!.idFromName('global')
        const stub = _env!.REALTIME_DO!.get(id)
        await stub.fetch(
          new Request('https://internal/broadcast', {
            method: 'POST',
            body: JSON.stringify({ event, data }),
          })
        )
      },
    }
  }

  // Node 环境：直接调用 adapter
  return {
    async broadcast(event: string, data: unknown): Promise<void> {
      const { getRuntimeAdapter } = await import('./runtime')
      getRuntimeAdapter().broadcast(event, data)
    },
  }
}
```

### 业务层使用

```typescript
// src/server/module-notifications/services/notification-service.ts
import { realtime } from '@server/core'

export async function createNotificationAndBroadcast(
  input: CreateNotificationInput
): Promise<AppNotification> {
  const notification = createNotification(input)

  // 广播到所有 SSE 客户端
  // Cloudflare: 发送到 DO
  // Node: 直接调用 adapter
  await realtime.broadcast('notification', notification)

  return notification
}
```

## 🏗 RealtimeDurableObject 实现

### 基本结构

```typescript
// src/server/core/durable-objects/RealtimeDO.ts
import { createRealtimeCore, type RealtimeCore } from '../realtime-core'

export class RealtimeDurableObject {
  private core: RealtimeCore

  constructor(_state: DurableObjectState) {
    this.core = createRealtimeCore()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // WebSocket 升级
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketRequest(request)
    }

    // SSE 连接
    if (request.headers.get('Accept')?.includes('text/event-stream')) {
      return this.handleSSERequest()
    }

    // 内部 API
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return this.handleBroadcast(request)
    }

    if (url.pathname === '/send' && request.method === 'POST') {
      return this.handleSend(request)
    }

    if (url.pathname === '/size') {
      return Response.json({
        wsClients: this.core.wsClients.size,
        sseClients: this.core.sseClients.size,
      })
    }

    return new Response('Not Found', { status: 404 })
  }
}
```

### DO 内部 API 说明

| 路径         | 方法 | 说明                 |
| ------------ | ---- | -------------------- |
| `/broadcast` | POST | 广播消息到所有客户端 |
| `/send`      | POST | 发送消息到特定客户端 |
| `/size`      | GET  | 查询当前连接数       |

**注意**：这些是 DO 内部 API，由 `realtime.broadcast()` 调用，**业务代码不应直接调用**。

## 🚫 禁止事项

### 禁止在 Worker 中处理 SSE 连接

```typescript
// ❌ 禁止 - Worker 中直接处理 SSE
export const routes = new OpenAPIHono().openapi(streamRoute, async c => {
  const adapter = getCloudflareRuntimeAdapter()
  return adapter.handleSSERequest() // ❌ 客户端在 Worker 的 core
})

// ✅ 正确 - 转发到 DO
export const routes = new OpenAPIHono().openapi(streamRoute, async c => {
  const env = c.env as { REALTIME_DO?: DurableObjectNamespace }
  if (env?.REALTIME_DO) {
    const stub = env.REALTIME_DO.get(env.REALTIME_DO.idFromName('global'))
    return stub.fetch(c.req.raw)
  }
  // Node 回退...
})
```

### 禁止在 DO 中调用 getCloudflareRuntimeAdapter()

```typescript
// ❌ 禁止 - DO 中调用会创建新的 adapter 实例
export class RealtimeDurableObject {
  async fetch(request: Request) {
    const adapter = getCloudflareRuntimeAdapter() // ❌ 新实例！
    adapter.handleSSERequest()
  }
}

// ✅ 正确 - DO 使用自己的 core
export class RealtimeDurableObject {
  private core: RealtimeCore // ✅ DO 自己的 core

  constructor(_state: DurableObjectState) {
    this.core = createRealtimeCore() // ✅ 在 DO 环境中创建
  }

  async handleSSERequest() {
    // 注册到 this.core.sseClients
  }
}
```

### 禁止硬编码业务路径

```typescript
// ❌ 禁止 - DO 中硬编码业务路径
if (url.pathname === '/api/notifications/stream') { ... }

// ✅ 正确 - 通过请求头判断
if (request.headers.get('Accept')?.includes('text/event-stream')) { ... }
```

## 📋 迁移检查清单

### 首次部署

- [ ] 配置 `wrangler.toml` 中的 `durable_objects.bindings`
- [ ] 配置 `migrations` 中的 `new_sqlite_classes`
- [ ] 在 `CloudflareBindings` 中添加 `REALTIME_DO` 类型
- [ ] SSE 路由添加 DO 转发逻辑
- [ ] 调用 `setRealtimeEnv(env)` 设置环境

### DO 类重命名

- [ ] 更新 `wrangler.toml` 中的 `class_name`
- [ ] 添加 `renamed_classes` 迁移
- [ ] 更新所有导出和引用

## 📚 相关文档

- [SSE 规范](./51-sse.md) - SSE 使用规范
- [WebSocket 规范](./50-websocket.md) - WebSocket 使用规范
- [Server Entrypoint](./21-server-entrypoint.md) - 服务端入口规范
