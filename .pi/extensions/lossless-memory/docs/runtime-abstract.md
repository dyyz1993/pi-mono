# 统一运行时抽象层

## 设计目标

让业务代码**完全不需要关心底层是 Node.js 还是 Cloudflare Workers**，实现真正的平台无关开发。

## 核心概念

### Runtime Adapter

统一的运行时适配器接口，提供：

- **WebSocket 管理**：注册路径、处理连接、广播消息
- **RPC 注册**：注册远程调用方法
- **事件处理**：注册事件监听器
- **平台检测**：自动检测当前运行环境

## 使用示例

### 1. 业务模块开发

```typescript
// src/server/module-chat/services/chat-service.ts
import { runtime } from '@server/core/runtime'

// 模块加载时自动注册，无需 init 函数
runtime.registerRPC('echo', (params: unknown) => {
  const { message } = params as { message: string }
  return { message, timestamp: Date.now() }
})

runtime.registerRPC('ping', () => {
  return { pong: true, timestamp: Date.now() }
})

runtime.registerEvent('broadcast', (payload: unknown, clientId: string) => {
  runtime.broadcast('broadcast', payload, [clientId])
})

// 其他业务函数...
export function getConnectedClientsCount(): number {
  return runtime.adapter.getWSConnections().size
}
```

### 2. 路由定义（WebSocket/SSE 路径自动注册）

```typescript
// src/server/module-chat/routes/chat-routes.ts
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import '../services/chat-service' // 导入 service，触发自动注册

const wsRoute = createRoute({
  method: 'get',
  path: '/chat/ws',
  responses: {
    200: {
      content: {
        websocket: { schema: AppWSProtocolSchema }, // realtime-scanner 自动识别
      },
    },
  },
})

export const chatRoutes = new OpenAPIHono().openapi(wsRoute, async _c => {
  // WebSocket 处理逻辑
})
```

### 3. Node.js 入口

```typescript
// src/server/entries/node.ts
import { setRuntimeAdapter, getNodeRuntimeAdapter } from '@server/core/runtime'
import { createApp } from '../app'

// 初始化运行时适配器
const runtimeAdapter = getNodeRuntimeAdapter()
setRuntimeAdapter(runtimeAdapter)

// 创建应用（app import routes → routes import services → 自动注册）
const app = createApp()

// WebSocket 升级处理（自动匹配注册的路径）
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '', `http://localhost`)

  if (runtimeAdapter.hasWSPath(url.pathname)) {
    const wssInstance = new WebSocketServer({ noServer: true })
    wssInstance.handleUpgrade(req, socket, head, ws => {
      runtimeAdapter.handleConnection(ws)
    })
  }
})
```

### 4. Cloudflare Workers 入口

```typescript
// src/server/entries/cloudflare.ts
import { setRuntimeAdapter, getCloudflareRuntimeAdapter } from '@server/core/runtime'
import { createApp } from '../app'

// 初始化运行时适配器
const runtimeAdapter = getCloudflareRuntimeAdapter()
setRuntimeAdapter(runtimeAdapter)

// 创建应用（自动注册）
const app = createApp<CloudflareBindings>()

export default {
  async fetch(request: Request, env: CloudflareBindings, ctx: ExecutionContext) {
    // WebSocket 请求处理
    if (request.headers.get('Upgrade') === 'websocket') {
      return runtimeAdapter.handleWebSocketRequest(request)
    }
    // 其他请求...
  },
}
```

## 自动注册机制

### WebSocket/SSE 路径自动发现

`realtime-scanner.ts` 会扫描 OpenAPI 文档，自动发现并注册 WebSocket/SSE 路径：

```typescript
// 在 app.ts 中调用
autoRegisterRealtime(app)
```

扫描规则：

- `content: { websocket: {...} }` → 自动调用 `runtime.handleWS(path)`
- `content: { 'text/event-stream': {...} }` → 自动调用 `runtime.handleSSE(path)`

### RPC/事件自动注册

在 service 文件顶层直接调用注册函数，模块加载时自动执行：

```typescript
// chat-service.ts
import { runtime } from '@server/core/runtime'

// 顶层直接执行，无需 init 函数
runtime.registerRPC('echo', handler)
runtime.registerEvent('broadcast', handler)
```

## API 参考

### `runtime.registerRPC(method: string, handler)`

注册 RPC 方法。

```typescript
runtime.registerRPC('echo', (params: unknown, clientId: string) => {
  return { result: 'ok' }
})
```

### `runtime.registerEvent(type: string, handler)`

注册事件处理器。

```typescript
runtime.registerEvent('broadcast', (payload: unknown, clientId: string) => {
  runtime.broadcast('broadcast', payload, [clientId])
})
```

### `runtime.broadcast(event: string, data: unknown, exclude?: string[])`

广播消息给所有客户端。

```typescript
runtime.broadcast('notification', { title: 'New message', body: 'Hello!' })
runtime.broadcast('chat', { message: 'Hi' }, [senderId]) // 排除发送者
```

### `runtime.platform`

获取当前平台信息。

```typescript
if (runtime.platform.isCloudflare) {
  // Cloudflare 特定逻辑
}

if (runtime.platform.isNode) {
  // Node.js 特定逻辑
}
```

## 优势

### ✅ 零配置开发

- 模块加载时自动注册
- 无需 init 函数
- 无需手动调用

### ✅ 统一的开发体验

- 业务代码完全平台无关
- 一次编写，到处运行
- 无需关心底层实现细节

### ✅ 自动路径管理

- OpenAPI 文档驱动
- 入口文件无需硬编码
- 支持动态添加新路径

### ✅ 类型安全

- 完整的 TypeScript 支持
- 编译时类型检查
- IDE 自动补全

## 最佳实践

1. **在 service 顶层直接注册**

   ```typescript
   // ✅ 推荐
   import { runtime } from '@server/core/runtime'

   runtime.registerRPC('myMethod', handler)

   export function myBusinessFunction() { ... }
   ```

2. **避免在业务代码中使用平台判断**

   ```typescript
   // ❌ 不推荐
   if (runtime.platform.isCloudflare) {
     // ...
   }

   // ✅ 推荐：使用统一 API
   runtime.broadcast('event', data)
   ```

3. **路由文件导入 service**

   ```typescript
   // routes/chat-routes.ts
   import '../services/chat-service' // 触发自动注册
   ```
