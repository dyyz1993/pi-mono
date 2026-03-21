---
paths: src/shared/core/ws-client.ts, src/shared/hooks/useWebSocket.ts, src/server/core/realtime-core.ts
---

# WebSocket 开发规范

## 🎯 核心价值

项目提供类型安全的 WebSocket 支持，通过协议定义实现端到端类型安全。

## 📁 相关文件

| 文件                               | 职责                           |
| ---------------------------------- | ------------------------------ |
| `src/shared/core/ws-client.ts`     | WebSocket 客户端实现（框架层） |
| `src/shared/hooks/useWebSocket.ts` | React Hook 封装                |
| `src/server/core/realtime-core.ts` | 服务端 WebSocket 处理          |

## 🚫 禁止直接使用 new WebSocket()

### 禁止事项

```typescript
// ❌ 禁止 - 直接使用 new WebSocket()
const ws = new WebSocket('ws://localhost:3000/api/chat/ws')

// ❌ 禁止 - 直接使用浏览器 WebSocket API
const ws = new WebSocket(url)
ws.onmessage = (event) => { ... }
ws.send(JSON.stringify(data))
```

**ESLint 规则**: `no-direct-ws-sse`

**路径**: `src/**/*.ts`, `src/**/*.tsx`

### 正确使用方式

```typescript
// ✅ 正确 - 使用 apiClient
import { apiClient } from '@client/services/apiClient'
import type { WSClient, ChatProtocol } from '@shared/schemas'

const wsClient: WSClient<ChatProtocol> = apiClient.api.chat.ws.$ws()
```

## 🔌 协议定义

### 定义 WebSocket 协议

```typescript
// src/shared/modules/chat/index.ts
import { z } from '@hono/zod-openapi'

export const ChatProtocolSchema = z.object({
  rpc: z.object({
    echo: z.object({
      in: z.object({ message: z.string() }),
      out: z.object({ message: z.string(), timestamp: z.number() }),
    }),
    ping: z.object({
      in: z.object({}),
      out: z.object({ pong: z.boolean(), timestamp: z.number() }),
    }),
  }),
  events: z.object({
    notification: z.object({
      title: z.string(),
      body: z.string(),
      timestamp: z.number(),
    }),
    connected: z.object({
      timestamp: z.number(),
    }),
  }),
})

export type ChatProtocol = z.infer<typeof ChatProtocolSchema>
```

## 🎣 React Hook 使用

### useWebSocket Hook

```typescript
// src/shared/hooks/useWebSocket.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WSClient, WSProtocol, WSStatus } from '@shared/schemas'

interface UseWebSocketReturn<T extends WSProtocol> {
  status: WSStatus
  connect: () => void
  disconnect: () => void
  call: WSClient<T>['call']
  emit: WSClient<T>['emit']
  on: WSClient<T>['on']
  client: WSClient<T> | null
}

export function useWebSocket<T extends WSProtocol>(route: {
  $ws: () => WSClient<T>
}): UseWebSocketReturn<T> {
  const [status, setStatus] = useState<WSStatus>('closed')
  const clientRef = useRef<WSClient<T> | null>(null)

  const connect = useCallback(() => {
    if (clientRef.current) return

    const client = route.$ws()
    clientRef.current = client

    client.onStatusChange(setStatus)
  }, [route])

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.close()
      clientRef.current = null
      setStatus('closed')
    }
  }, [])

  // ... 其他实现
}
```

### 组件中使用

```typescript
import { useWebSocket } from '@client/hooks/useWebSocket'
import { apiClient } from '@client/services/apiClient'
import type { ChatProtocol } from '@shared/schemas'

export const ChatComponent: React.FC = () => {
  const { status, connect, disconnect, call, on } = useWebSocket<ChatProtocol>(
    apiClient.api.chat.ws
  )

  useEffect(() => {
    connect()

    const unsubscribe = on('notification', (payload) => {
      console.log('Notification:', payload)
    })

    return () => {
      unsubscribe()
      disconnect()
    }
  }, [connect, on, disconnect])

  const handleEcho = async () => {
    const result = await call('echo', { message: 'Hello' })
    console.log(result)
  }

  return (
    <div>
      <p>Status: {status}</p>
      <button onClick={handleEcho}>Echo</button>
    </div>
  )
}
```

## 🛡️ 保护核心接口

### 禁止修改框架层接口

```typescript
// ❌ 禁止 - 修改 WSClient 接口
interface WSClient {
  customMethod: () => void  // ❌ 禁止添加方法
}

// ✅ 正确 - 通过协议定义扩展
export const CustomProtocolSchema = z.object({
  rpc: z.object({
    customMethod: z.object({
      in: z.object({ ... }),
      out: z.object({ ... }),
    }),
  }),
})
```

**ESLint 规则**: `protect-ws-sse-interface`

**路径**: `src/**/*.ts`, `src/**/*.tsx`

## 🧪 测试 WebSocket

### Mock WebSocket 客户端

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createTestClient } from '@server/test-utils/test-client'

describe('WebSocket Tests', () => {
  it('should connect to WebSocket', async () => {
    const mockWS = vi.fn()
    const client = createTestClient(undefined, {
      webSocket: mockWS,
    })

    const wsClient = client.api.chat.ws.$ws()
    expect(mockWS).toHaveBeenCalled()
  })
})
```

## 🚫 Anti-Patterns

```typescript
// ❌ 不要直接使用 new WebSocket()
const ws = new WebSocket('ws://localhost:3000/api/chat/ws')

// ✅ 应该使用 apiClient
const wsClient = apiClient.api.chat.ws.$ws()

// ❌ 不要修改 WSClient 接口
interface WSClient {
  customMethod: () => void
}

// ✅ 应该通过协议定义扩展
export const CustomProtocolSchema = z.object({
  rpc: z.object({
    customMethod: z.object({ ... }),
  }),
})

// ❌ 不要在组件中直接管理 WebSocket 实例
const wsRef = useRef<WebSocket | null>(null)
wsRef.current = new WebSocket(url)

// ✅ 应该使用 useWebSocket Hook
const { status, connect, call } = useWebSocket(apiClient.api.chat.ws)
```

## 📚 相关文档

- [Client Service 规范](./31-client-services.md) - API 客户端使用规范
- [SSE 规范](./51-sse.md) - SSE 开发规范
- [Shared Types 规范](./40-shared-types.md) - 协议定义规范
