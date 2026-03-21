---
paths: src/shared/core/sse-client.ts, src/shared/hooks/useSSE.ts, src/server/core/realtime-core.ts
---

# SSE 开发规范

## 🎯 核心价值

项目提供类型安全的 SSE (Server-Sent Events) 支持，通过协议定义实现端到端类型安全。

## 📁 相关文件

| 文件                               | 职责                     |
| ---------------------------------- | ------------------------ |
| `src/shared/core/sse-client.ts`    | SSE 客户端实现（框架层） |
| `src/shared/hooks/useSSE.ts`       | React Hook 封装          |
| `src/server/core/realtime-core.ts` | 服务端 SSE 处理          |

## 🚫 禁止直接使用 new EventSource()

### 禁止事项

```typescript
// ❌ 禁止 - 直接使用 new EventSource()
const sse = new EventSource('/api/notifications/sse')

// ❌ 禁止 - 直接使用浏览器 EventSource API
const sse = new EventSource(url)
sse.onmessage = (event) => { ... }
sse.onerror = (error) => { ... }
```

**ESLint 规则**: `no-direct-ws-sse`

**路径**: `src/**/*.ts`, `src/**/*.tsx`

### 正确使用方式

```typescript
// ✅ 正确 - 使用 apiClient
import { apiClient } from '@client/services/apiClient'
import type { SSEClient, AppSSEProtocol } from '@shared/schemas'

const sseClient: SSEClient<AppSSEProtocol> = await apiClient.api.notifications.sse.$sse()
```

## 🔌 协议定义

### 定义 SSE 协议

```typescript
// src/shared/modules/notifications/schemas.ts
import { z } from '@hono/zod-openapi'
import { NotificationSchema } from './schemas'

export const AppSSEProtocolSchema = z.object({
  events: z.object({
    notification: NotificationSchema,
    ping: z.object({ timestamp: z.number() }),
    connected: z.object({ timestamp: z.number() }),
  }),
})

export type AppSSEProtocol = z.infer<typeof AppSSEProtocolSchema>
```

## 🖥️ 服务端 SSE 路由

### 定义 SSE 路由

SSE 路由必须使用 `text/event-stream` content type，框架会自动扫描并注册。

```typescript
// src/server/module-notifications/routes/notification-routes.ts
import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { getRuntimeAdapter } from '@server/core/runtime'
import { AppSSEProtocolSchema } from '@shared/schemas'

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

export const notificationRoutes = new OpenAPIHono().openapi(streamRoute, async _c => {
  const adapter = getRuntimeAdapter()
  if ('handleSSERequest' in adapter && typeof adapter.handleSSERequest === 'function') {
    return (adapter as { handleSSERequest: () => Response | Promise<Response> }).handleSSERequest()
  }
  return new Response('SSE not supported', { status: 500 })
})
```

### 服务端广播消息

使用 `realtime.broadcast()` 向所有连接的客户端广播消息：

```typescript
// src/server/module-notifications/services/notification-service.ts
import { realtime } from '@server/core'

export async function createNotificationAndBroadcast(
  input: CreateNotificationInput
): Promise<AppNotification> {
  const notification = createNotification(input)

  // 广播通知到所有 SSE 客户端
  await realtime.broadcast('notification', notification)

  return notification
}
```

### 服务端 SSE 规则

1. **路由路径必须以 `/stream` 结尾** - 框架通过此命名约定识别 SSE 路由
2. **不要在 SSE 路由中使用 middleware** - middleware 会影响类型推断，应在 handler 中手动验证
3. **使用 `realtime.broadcast()` 广播** - 不要手动管理 SSE 客户端连接

```typescript
// ❌ 禁止 - 手动管理 SSE 客户端
const sseClients = new Map<string, { send: (data: string) => void }>()

// ❌ 禁止 - 在 SSE 路由中使用 middleware
const streamRoute = createRoute({
  method: 'get',
  path: '/notifications/stream',
  middleware: [authMiddleware()], // ❌ 这会破坏类型推断
  responses: { ... }
})

// ✅ 正确 - 在 handler 中手动验证
const streamRoute = createRoute({
  method: 'get',
  path: '/notifications/stream',
  responses: { ... }
})

export const routes = new OpenAPIHono()
  .openapi(streamRoute, async c => {
    const user = getAuthUser(c)
    if (!user) {
      return c.json({ success: false, error: 'Unauthorized' }, 401)
    }
    // ... SSE 处理
  })
```

## 🎣 React Hook 使用

### useSSE Hook

```typescript
// src/shared/hooks/useSSE.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SSEClient, SSEProtocol } from '@shared/schemas'

type SSEStatus = 'connecting' | 'open' | 'closed'

interface UseSSEReturn<T extends SSEProtocol> {
  status: SSEStatus
  connect: () => Promise<void>
  disconnect: () => void
  client: SSEClient<T> | null
}

export function useSSE<T extends SSEProtocol>(route: () => Promise<SSEClient<T>>): UseSSEReturn<T> {
  const [status, setStatus] = useState<SSEStatus>('closed')
  const clientRef = useRef<SSEClient<T> | null>(null)

  const connect = useCallback(async () => {
    if (clientRef.current) return

    setStatus('connecting')

    try {
      const client = await route()
      clientRef.current = client

      client.onStatusChange(newStatus => {
        setStatus(newStatus)
      })

      setStatus(client.status)
    } catch (error) {
      console.error('Failed to connect SSE:', error)
      setStatus('closed')
    }
  }, [route])

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.abort()
      clientRef.current = null
      setStatus('closed')
    }
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return { status, connect, disconnect, client: clientRef.current }
}
```

### 组件中使用

```typescript
import { useSSE } from '@client/hooks/useSSE'
import { apiClient } from '@client/services/apiClient'
import type { AppSSEProtocol } from '@shared/schemas'

export const NotificationComponent: React.FC = () => {
  const { status, connect, disconnect, client } = useSSE<AppSSEProtocol>(
    () => apiClient.api.notifications.sse.$sse()
  )

  const [notifications, setNotifications] = useState<Notification[]>([])

  useEffect(() => {
    connect()

    if (client) {
      client.on('notification', (payload) => {
        setNotifications((prev) => [...prev, payload])
      })
    }

    return () => {
      disconnect()
    }
  }, [connect, disconnect, client])

  return (
    <div>
      <p>Status: {status}</p>
      <ul>
        {notifications.map((n, i) => (
          <li key={i}>{n.title}</li>
        ))}
      </ul>
    </div>
  )
}
```

## 🛡️ 保护核心接口

### 禁止修改框架层接口

```typescript
// ❌ 禁止 - 修改 SSEClient 接口
interface SSEClient {
  customMethod: () => void  // ❌ 禁止添加方法
}

// ✅ 正确 - 通过协议定义扩展
export const CustomSSEProtocolSchema = z.object({
  events: z.object({
    customEvent: z.object({ ... }),
  }),
})
```

**ESLint 规则**: `protect-ws-sse-interface`

**路径**: `src/**/*.ts`, `src/**/*.tsx`

## 🧪 测试 SSE

### Mock SSE 客户端

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createTestClient } from '@server/test-utils/test-client'
import type { SSEClient } from '@shared/schemas'

describe('SSE Tests', () => {
  it('should connect to SSE', async () => {
    const mockSSE = vi.fn()
    const client = createTestClient(undefined, {
      sse: mockSSE as (url: string | URL) => SSEClient,
    })

    const sseClient = await client.api.notifications.sse.$sse()
    expect(mockSSE).toHaveBeenCalled()
  })
})
```

## 🚫 Anti-Patterns

### 客户端

```typescript
// ❌ 不要直接使用 new EventSource()
const sse = new EventSource('/api/notifications/sse')

// ✅ 应该使用 apiClient
const sseClient = apiClient.api.notifications.stream.$sse()

// ❌ 不要修改 SSEClient 接口
interface SSEClient {
  customMethod: () => void
}

// ✅ 应该通过协议定义扩展
export const CustomSSEProtocolSchema = z.object({
  events: z.object({
    customEvent: z.object({ ... }),
  }),
})

// ❌ 不要在组件中直接管理 EventSource 实例
const sseRef = useRef<EventSource | null>(null)
sseRef.current = new EventSource(url)

// ✅ 应该使用 useSSE Hook
const { status, connect, client } = useSSE(() => apiClient.api.notifications.stream.$sse())
```

### 服务端

```typescript
// ❌ 不要手动管理 SSE 客户端连接
const sseClients = new Map<string, { send: (data: string) => void }>()
sseClients.set(clientId, { send })

// ✅ 应该使用 realtime.broadcast()
import { realtime } from '@server/core'
await realtime.broadcast('notification', notification)

// ❌ 不要在 SSE 路由中使用 middleware
const streamRoute = createRoute({
  method: 'get',
  path: '/notifications/stream',
  middleware: [authMiddleware()], // ❌ 破坏类型推断
  responses: { ... }
})

// ✅ 应该在 handler 中手动验证
const streamRoute = createRoute({
  method: 'get',
  path: '/notifications/stream',
  responses: { ... }
})

export const routes = new OpenAPIHono()
  .openapi(streamRoute, async c => {
    const user = getAuthUser(c)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    // ...
  })
```

## 📚 相关文档

- [Client Service 规范](./31-client-services.md) - API 客户端使用规范
- [WebSocket 规范](./50-websocket.md) - WebSocket 开发规范
- [Shared Types 规范](./40-shared-types.md) - 协议定义规范
