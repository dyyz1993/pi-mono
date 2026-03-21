---
paths: src/client/services/**/*.ts, src/admin/services/**/*.ts, src/cli/rpc/**/*.ts
---

# Client Service 开发规范

## 🎯 核心职责

`src/*/services/` 目录包含 API 客户端和实时通信客户端的配置。

## 📁 文件结构

```
src/
├── client/services/
│   └── apiClient.ts           # 前端 API 客户端（基础版）
│
├── admin/services/
│   ├── apiClient.ts           # 管理后台 API 客户端（完整功能）
│   ├── requestInterceptor.ts  # 自定义 fetch 实现
│   └── types.ts               # 扩展参数类型定义
│
└── cli/rpc/
    └── client.ts              # CLI RPC 客户端
```

## 🔧 API 客户端配置

### 创建类型安全的客户端

```typescript
// src/client/services/apiClient.ts
import { hc } from 'hono/client'
import type { AppType } from '@server/index'
import { WSClientImpl } from '@shared/core/ws-client'
import { SSEClientImpl } from '@shared/core/sse-client'

const baseUrl = import.meta.env.API_BASE_URL || window.location.origin

export const apiClient = hc<AppType>(baseUrl, {
  webSocket: url => new WSClientImpl(url),
  sse: url => new SSEClientImpl(url),
})
```

**关键点**:

- 使用 `hc<AppType>()` 创建类型安全的客户端
- 导入 `AppType` 从 `@server/index`
- 配置 WebSocket 和 SSE 客户端实现

**ESLint 规则**: `no-ambiguous-file-paths`

**路径**: `src/client/services/apiClient.ts`

## 🚀 扩展参数机制

### 概述

Hono 客户端支持通过 `extend` 参数传递自定义选项，用于控制请求行为。

### 数据流

```
用户调用
    ↓
$get(undefined, { extend: { loading: '加载中...' } })
    ↓
Hono 内部透传
    ↓
fetch(url, { extend: { loading: '加载中...' } })
    ↓
自定义 fetch 处理
```

### 定义扩展参数类型

```typescript
// src/admin/services/types.ts

/**
 * 管理后台请求扩展参数
 */
export interface AdminFetchExtendOptions {
  /** Loading 控制：true 显示默认 loading，string 显示自定义文字 */
  loading?: boolean | string
  /** 重试次数 */
  retry?: number
  /** 重试延迟 */
  retryDelay?: number
  /** 静默错误，不显示错误提示 */
  silentError?: boolean
  /** 超时时间 */
  timeout?: number
}
```

### 使用扩展参数

```typescript
// 管理后台 - 完整功能
apiClient.api.users.$get(undefined, {
  extend: {
    loading: '加载中...', // 自定义 loading 文字
    retry: 3, // 重试次数
    silentError: true, // 静默错误
    timeout: 5000, // 超时时间
  },
})

// CLI RPC - 简单功能
rpcClient.api.users.$get(undefined, {
  extend: {
    verbose: true, // 详细日志
    timeout: 10000, // 超时时间
  },
})
```

## 🔌 自定义 Fetch 实现

### 创建自定义 Fetch

```typescript
// src/admin/services/requestInterceptor.ts
import type { AdminFetchExtendOptions, InterceptorCallbacks } from './types'

export class RequestInterceptor {
  constructor(private callbacks: InterceptorCallbacks) {}

  async intercept(
    url: string,
    init: RequestInit & { extend?: AdminFetchExtendOptions }
  ): Promise<Response> {
    const extend = init.extend

    // 1. 触发请求开始回调
    this.callbacks.onRequest?.(extend)

    try {
      // 2. 添加认证 token
      const headers = new Headers(init.headers)
      const token = this.getStoredToken()
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      }

      // 3. 移除 extend 属性，避免传递给原生 fetch
      const { extend: _extend, ...restInit } = init

      // 4. 发送请求
      const response = await window.fetch(url, {
        ...restInit,
        headers,
      })

      // 5. 触发响应回调
      this.callbacks.onResponse?.(extend)
      return response
    } catch (error) {
      // 6. 触发错误回调
      this.callbacks.onError?.(extend)
      throw error
    }
  }

  private getStoredToken(): string | null {
    // 从 localStorage 获取 token
  }
}

export function createRequestInterceptor(callbacks: InterceptorCallbacks) {
  const interceptor = new RequestInterceptor(callbacks)
  return (url: string, init: RequestInit & { extend?: AdminFetchExtendOptions }) =>
    interceptor.intercept(url, init)
}
```

### 配置自定义 Fetch

```typescript
// src/admin/services/apiClient.ts
import { createRequestInterceptor } from './requestInterceptor'
import type { AdminFetchExtendOptions } from './types'
import { useLoadingStore } from '../stores/loadingStore'

function createCustomFetch() {
  const { startLoading, stopLoading } = useLoadingStore.getState()

  return createRequestInterceptor({
    onShowLogin: () => {
      localStorage.removeItem('admin-storage')
      window.location.href = '/admin/login'
    },
    onShowCaptcha: async config => {
      return showCaptcha({ type: config.type })
    },
    onRequest: (extend?: AdminFetchExtendOptions) => {
      if (extend?.loading !== false) {
        const text = typeof extend?.loading === 'string' ? extend.loading : undefined
        startLoading(text)
      }
    },
    onResponse: (extend?: AdminFetchExtendOptions) => {
      if (extend?.loading !== false) {
        stopLoading()
      }
    },
    onError: (extend?: AdminFetchExtendOptions) => {
      if (extend?.loading !== false) {
        stopLoading()
      }
    },
  })
}

export const apiClient = hc<AppType>(baseUrl, {
  fetch: createCustomFetch() as typeof fetch,
  webSocket: url => new WSClientImpl(url),
  sse: url => new SSEClientImpl(url, headers),
})
```

## 📋 不同客户端的扩展参数

| 客户端     | 扩展参数                                     | 说明                 |
| ---------- | -------------------------------------------- | -------------------- |
| 前端客户端 | 无                                           | 基础功能，不需要扩展 |
| 管理后台   | `loading`, `retry`, `silentError`, `timeout` | 完整功能             |
| CLI RPC    | `verbose`, `timeout`                         | 简单功能             |

## 🚫 禁止直接使用 fetch

### 禁止事项

```typescript
// ❌ 禁止 - 直接使用 fetch
const response = await fetch('/api/items')
const data = await response.json()

// ❌ 禁止 - 直接使用 new WebSocket()
const ws = new WebSocket('ws://localhost:3000/api/chat/ws')

// ❌ 禁止 - 直接使用 new EventSource()
const sse = new EventSource('/api/notifications/sse')
```

**ESLint 规则**: `no-direct-ws-sse`, `no-restricted-globals`

### 正确使用方式

```typescript
// ✅ 正确 - 使用 apiClient
import { apiClient } from '@client/services/apiClient'

// REST API 调用
const response = await apiClient.api.items.$get()
const result = await response.json()

if (result.success) {
  console.log(result.data)
}

// WebSocket 连接
const wsClient = apiClient.api.chat.ws.$ws()

// SSE 连接
const sseClient = await apiClient.api.notifications.sse.$sse()
```

## 🔌 WebSocket 客户端使用

### 获取 WebSocket 客户端

```typescript
import { apiClient } from '@client/services/apiClient'
import type { WSClient, ChatProtocol } from '@shared/schemas'

const wsClient: WSClient<ChatProtocol> = apiClient.api.chat.ws.$ws()

// 连接状态监听
wsClient.onStatusChange(status => {
  console.log('WebSocket status:', status)
})

// RPC 调用
const result = await wsClient.call('echo', { message: 'Hello' })

// 事件监听
wsClient.on('notification', payload => {
  console.log('Notification:', payload)
})

// 发送事件
wsClient.emit('broadcast', { message: 'Hello', timestamp: Date.now() })
```

**ESLint 规则**: `protect-ws-sse-interface`

**路径**: `src/client/**/*.ts`, `src/client/**/*.tsx`

## 📡 SSE 客户端使用

### 获取 SSE 客户端

```typescript
import { apiClient } from '@client/services/apiClient'
import type { SSEClient, AppSSEProtocol } from '@shared/schemas'

const sseClient: SSEClient<AppSSEProtocol> = await apiClient.api.notifications.sse.$sse()

// 连接状态监听
sseClient.onStatusChange(status => {
  console.log('SSE status:', status)
})

// 事件监听
sseClient.on('notification', payload => {
  console.log('Notification:', payload)
})

// 关闭连接
sseClient.abort()
```

**ESLint 规则**: `protect-ws-sse-interface`

**路径**: `src/client/**/*.ts`, `src/client/**/*.tsx`

## 🖼️ 媒体类型方法

### 图片获取 ($image)

用于获取 `image/*` 类型的资源，返回 `Promise<Blob>`。

```typescript
import { apiClient } from '@client/services/apiClient'

// 获取图片
const blob = await apiClient.api.admin.avatar[':id'].$image({
  param: { id: 'user-123' },
})

// 创建图片 URL
const imageUrl = URL.createObjectURL(blob)
document.querySelector('img').src = imageUrl

// 记得释放 URL
URL.revokeObjectURL(imageUrl)
```

**支持的 Content-Type**:

- `image/png`
- `image/jpeg`
- `image/gif`
- `image/webp`
- 其他 `image/*` 类型

### SVG 获取 ($svg)

用于获取 `image/svg+xml` 类型的资源，返回 `Promise<string>`。

```typescript
import { apiClient } from '@client/services/apiClient'

// 获取 SVG 图标
const svgString = await apiClient.api.admin.icon[':name'].$svg({
  param: { name: 'home' },
})

// 直接插入 DOM
document.querySelector('#icon-container').innerHTML = svgString
```

**支持的 Content-Type**:

- `image/svg+xml`

### 文件下载 ($download)

用于下载文件（Excel, PDF, ZIP 等），返回 `Promise<Blob>`。

```typescript
import { apiClient } from '@client/services/apiClient'

// 下载文件
const blob = await apiClient.api.admin.todos.export.$download()

// 触发浏览器下载
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'todos.csv'
a.click()
URL.revokeObjectURL(url)
```

**支持的 Content-Type**:

- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (Excel)
- `application/vnd.ms-excel` (Excel 97-2003)
- `application/pdf`
- `application/zip`
- `text/csv`
- 其他 `application/*` 类型

### 服务端定义示例

```typescript
// src/server/module-admin/routes/admin-routes.ts
import { createRoute } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'

// 图片路由
const getAvatarRoute = createRoute({
  method: 'get',
  path: '/admin/avatar/:id',
  responses: {
    200: {
      content: {
        'image/png': { schema: z.any().openapi({ type: 'string', format: 'binary' }) },
        'image/jpeg': { schema: z.any().openapi({ type: 'string', format: 'binary' }) },
      },
      description: 'User avatar image',
    },
  },
})

// SVG 路由
const getIconRoute = createRoute({
  method: 'get',
  path: '/admin/icon/:name',
  responses: {
    200: {
      content: {
        'image/svg+xml': { schema: z.string() },
      },
      description: 'SVG icon',
    },
  },
})

// 文件下载路由
const exportTodosRoute = createRoute({
  method: 'get',
  path: '/admin/todos/export',
  responses: {
    200: {
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: z.any().openapi({ type: 'string', format: 'binary' }),
        },
        'text/csv': { schema: z.string() },
      },
      description: 'Export todos as Excel or CSV',
    },
  },
})
```

**注意**: 对于二进制类型，使用 `z.any().openapi({ type: 'string', format: 'binary' })` 而不是 `z.instanceof(Blob)`。

## 📤 文件上传 (form)

### 客户端上传文件

使用 `form` 属性上传文件，Hono RPC 客户端会自动处理 `multipart/form-data`。

```typescript
import { apiClient } from '@client/services/apiClient'

// 上传单个文件
const response = await apiClient.api.todos[':id'].attachments.$post({
  param: { id: '123' },
  form: { file },
})

const result = await response.json()
if (result.success) {
  console.log('File uploaded:', result.data)
}
```

### 服务端定义

```typescript
// src/server/module-todos/routes/todos-routes.ts
import { createRoute, z } from '@hono/zod-openapi'

const UploadFileSchema = z.object({
  file: z.any().openapi({ type: 'string', format: 'binary' }),
})

const uploadAttachmentRoute = createRoute({
  method: 'post',
  path: '/todos/{id}/attachments',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'multipart/form-data': {
          schema: UploadFileSchema,
        },
      },
    },
  },
  responses: {
    201: successResponse(AttachmentSchema, 'File uploaded'),
    400: errorResponse('Invalid file'),
  },
})
  // Handler 中获取文件
  .openapi(uploadAttachmentRoute, async c => {
    const { id } = c.req.valid('param')
    const body = await c.req.valid('form')
    const file = body['file']

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, error: 'No file uploaded' }, 400)
    }

    // 处理文件...
    const attachment = await uploadAttachment(parseInt(id), file)
    return c.json({ success: true, data: attachment }, 201)
  })
```

### 前端组件示例

```tsx
import { useRef } from 'react'
import { useTodoStore } from '../stores/todoStore'

function FileUploadButton({ todoId }: { todoId: number }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadAttachment = useTodoStore(state => state.uploadAttachment)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await uploadAttachment(todoId, file)
      e.target.value = '' // 重置 input
    }
  }

  return (
    <label className="cursor-pointer">
      <Upload className="w-4 h-4" />
      Upload
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.pdf,.txt"
        onChange={handleFileChange}
        className="hidden"
      />
    </label>
  )
}
```

### 文件上传限制

服务端应验证文件大小和类型：

```typescript
// 服务端验证
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

if (file.size > MAX_FILE_SIZE) {
  return c.json({ success: false, error: 'File too large' }, 400)
}

if (!ALLOWED_TYPES.includes(file.type)) {
  return c.json({ success: false, error: 'File type not allowed' }, 400)
}
```

### 注意事项

| 事项             | 说明                                                         |
| ---------------- | ------------------------------------------------------------ |
| 使用 `form` 属性 | 不要使用 `body` 属性，Hono 会自动处理 FormData               |
| 类型定义         | 使用 `z.any().openapi({ type: 'string', format: 'binary' })` |
| 服务端获取       | 使用 `c.req.valid('form')` 获取文件                          |
| 禁止直接 fetch   | 必须使用 apiClient RPC 方式                                  |

## 🌊 流式响应处理

对于大数据量的导出场景，可以使用流式响应来减少内存占用。

### 服务端实现

```typescript
import { createRoute } from '@hono/zod-openapi'

const exportStreamRoute = createRoute({
  method: 'get',
  path: '/admin/todos/export/stream',
  responses: {
    200: {
      content: {
        'text/csv': { schema: z.string() },
      },
      description: 'Stream export todos as CSV',
    },
  },
})
  // Handler
  .openapi(exportStreamRoute, async _c => {
    const todos = await adminService.getAllTodos()

    const stream = new ReadableStream({
      async start(controller) {
        // 发送 CSV 头
        controller.enqueue('id,title,completed,created_at\n')

        // 逐行发送数据
        for (const todo of todos) {
          const line = `${todo.id},"${todo.title}",${todo.completed},${todo.createdAt}\n`
          controller.enqueue(line)

          // 模拟慢速导出（可选）
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="todos.csv"',
      },
    })
  })
```

### 客户端处理

```typescript
import { apiClient } from '@client/services/apiClient'

// 获取流式响应
const response = await apiClient.api.admin.todos.export.stream.$get()

// 使用 ReadableStream 读取数据
const reader = response.body?.getReader()
if (!reader) {
  throw new Error('No response body')
}

const decoder = new TextDecoder()
let csvContent = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  // 处理每个数据块
  csvContent += decoder.decode(value)
  console.log('Received chunk:', value.length, 'bytes')
}

// 创建下载
const blob = new Blob([csvContent], { type: 'text/csv' })
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'todos.csv'
a.click()
URL.revokeObjectURL(url)
```

### 实时进度显示

```typescript
const reader = response.body?.getReader()
const contentLength = parseInt(response.headers.get('Content-Length') || '0')
let receivedLength = 0

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  receivedLength += value.length
  const progress = contentLength > 0 ? Math.round((receivedLength / contentLength) * 100) : 0

  console.log(`Progress: ${progress}%`)
}
```

### 使用场景

| 场景           | 推荐方式      |
| -------------- | ------------- |
| 小文件 (< 1MB) | `$download()` |
| 大文件 (> 1MB) | 流式响应      |
| 实时进度显示   | 流式响应      |
| 大数据量导出   | 流式响应      |

**注意**: 流式响应使用 `$get()` 方法，返回 `ClientResponse`，其 `body` 属性是 `ReadableStream | null`。

## 🛡️ 框架保护

`apiClient.ts` 是框架层文件，带有 `@framework-baseline` 注释：

```typescript
/**
 * @framework-baseline ab16e97716a7556e
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */
```

**ESLint 规则**: `framework-protect`

## 📤 导出规范

```typescript
// ✅ 正确 - 导出 apiClient
export const apiClient = hc<AppType>(baseUrl, { ... })

// ❌ 错误 - 导出多个客户端实例
export const apiClient1 = hc<AppType>(url1)
export const apiClient2 = hc<AppType>(url2)
```

## 🚫 Anti-Patterns

```typescript
// ❌ 不要直接使用 fetch
const response = await fetch('/api/items')

// ✅ 应该使用 apiClient
const response = await apiClient.api.items.$get()

// ❌ 不要直接使用 new WebSocket()
const ws = new WebSocket('ws://localhost:3000/api/chat/ws')

// ✅ 应该使用 apiClient
const wsClient = apiClient.api.chat.ws.$ws()

// ❌ 不要直接使用 new EventSource()
const sse = new EventSource('/api/notifications/sse')

// ✅ 应该使用 apiClient
const sseClient = await apiClient.api.notifications.sse.$sse()

// ❌ 不要在组件中创建客户端实例
const client = hc<AppType>(baseUrl)

// ✅ 应该使用统一的 apiClient
import { apiClient } from '@client/services/apiClient'
```

## 📚 相关文档

- [API 类型推导规范](./10-api-type-inference.md) - Hono RPC 类型推导
- [WebSocket 规范](./50-websocket.md) - WebSocket 开发规范
- [SSE 规范](./51-sse.md) - SSE 开发规范
- [Client 组件规范](./30-client-components.md) - 组件开发规范
