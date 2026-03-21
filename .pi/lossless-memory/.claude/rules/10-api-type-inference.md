---
paths: src/**/*.ts, src/**/*.tsx
---

# API 类型推导规范

## 🎯 核心价值

本项目通过 **Hono RPC** 实现端到端类型安全，核心优势：

1. **零代码生成的类型共享** - 不需要 OpenAPI 代码生成工具
2. **自动类型推导** - 从服务端定义自动推导客户端类型
3. **重构友好** - 修改服务端类型，客户端自动报错
4. **开发体验极佳** - 完整的 IDE 自动补全和类型检查

## 🔗 链式语法（强制）

**必须使用链式语法定义路由**，确保 Hono RPC 类型推断正确。

```typescript
// ✅ 正确 - 链式语法
export const apiRoutes = new OpenAPIHono()
  .openapi(listRoute, async c => { ... })
  .openapi(createRoute, async c => { ... })
  .openapi(updateRoute, async c => { ... })

// ❌ 错误 - 非链式语法会导致类型推断丢失
const app = new OpenAPIHono();
app.openapi(listRoute, async c => { ... });
app.openapi(createRoute, async c => { ... });
```

**ESLint 规则**: `require-hono-chain-syntax`

**路径**: `src/server/module-*/routes/*.ts`

## 📦 Schema 定义规范

### 使用 Zod 定义 Schema

```typescript
// ✅ 正确 - 在 shared/modules 中定义
// src/shared/modules/{module}/schemas.ts
import { z } from '@hono/zod-openapi'

export const ItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200),
  status: z.enum(['active', 'inactive']),
})

export type Item = z.infer<typeof ItemSchema>
```

### 禁止内联 Schema

```typescript
// ❌ 错误 - 在路由文件中直接定义 Schema
const route = createRoute({
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ id: z.string() }), // ❌ 内联定义
        },
      },
    },
  },
})

// ✅ 正确 - 从 shared 导入
import { ItemSchema } from '@shared/schemas'

const route = createRoute({
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ItemSchema, // ✅ 使用导入的 Schema
        },
      },
    },
  },
})
```

**ESLint 规则**: `no-inline-schema`

**路径**: `src/server/module-*/routes/*.ts`

## 🛡 响应格式规范

### 使用响应辅助函数

```typescript
// ✅ 正确 - 使用辅助函数
import { successResponse, errorResponse } from '@server/utils/route-helpers'

const route = createRoute({
  responses: {
    200: successResponse(ItemSchema, '获取列表'),
    404: errorResponse('未找到'),
  },
})

// ❌ 错误 - 直接定义响应
const route = createRoute({
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(), // ❌ 应使用 z.literal(true)
            data: ItemSchema,
          }),
        },
      },
    },
  },
})
```

**ESLint 规则**: `require-response-helpers`

**路径**: `src/server/module-*/routes/*.ts`

## 🚫 禁止 z.boolean() 定义 success

```typescript
// ❌ 错误 - 使用 z.boolean()
const response = z.object({
  success: z.boolean(), // ❌ 类型推导不正确
  data: ItemSchema,
})

// ✅ 正确 - 使用 z.literal()
const response = z.object({
  success: z.literal(true), // ✅ 正确的类型推导
  data: ItemSchema,
})
```

**ESLint 规则**: `no-boolean-success`

**路径**: `src/server/module-*/routes/*.ts`

## 🔧 参数验证规范

### 使用 c.req.valid() 获取参数

```typescript
// ✅ 正确 - 使用 c.req.valid()
const route = createRoute({
  request: {
    body: { content: { 'application/json': { schema: CreateItemSchema } } },
    params: z.object({ id: z.string() }),
  },
})

export const apiRoutes = new OpenAPIHono().openapi(route, async c => {
  const body = c.req.valid('json') // ✅ 类型安全
  const { id } = c.req.valid('param') // ✅ 类型安全
  // ...
})

// ❌ 错误 - 使用原始方法
export const apiRoutes = new OpenAPIHono().openapi(route, async c => {
  const body = await c.req.json() // ❌ 无类型检查
  const id = c.req.param('id') // ❌ 无类型检查
  // ...
})
```

**ESLint 规则**: `enforce-valid-method`

**路径**: `src/server/module-*/routes/*.ts`

### 参数验证方法映射

| Route Schema      | c.req.valid() 参数   |
| ----------------- | -------------------- |
| `request.body`    | `'json'` 或 `'body'` |
| `request.query`   | `'query'`            |
| `request.params`  | `'param'`            |
| `request.headers` | `'header'`           |
| `request.cookies` | `'cookie'`           |

## 📤 类型导出规范

### 导出 AppType

```typescript
// src/server/app.ts
import { OpenAPIHono } from '@hono/zod-openapi'

export function createApp() {
  const app = new OpenAPIHono().route('/api', apiRoutes)
  // ...

  return app
}

// ✅ 必须导出 AppType
export type AppType = ReturnType<typeof createApp>
```

**ESLint 规则**: 无（最佳实践）

## 🔄 客户端使用规范

### 创建类型安全的客户端

```typescript
// src/client/services/apiClient.ts
import { hc } from 'hono/client'
import type { AppType } from '@server/index'

export const apiClient = hc<AppType>(import.meta.env.API_BASE_URL || '')
```

### 类型安全的 API 调用

```typescript
// ✅ 类型安全的调用
const response = await apiClient.api.items.$get()
const result = await response.json()

if (result.success) {
  // result.data 类型自动推导
  console.log(result.data[0].name)
}

// ✅ POST 请求 - 自动验证请求体
const createResponse = await apiClient.api.items.$post({
  json: { name: 'New Item', status: 'active' },
})

// ✅ 带路径参数的请求
const itemResponse = await apiClient.api.items[':id'].$get({
  param: { id: '123' },
})
```

## 🖼️ 媒体类型推导

### Content-Type 到返回类型映射

本项目扩展了 Hono 的类型推导，支持以下媒体类型：

| Content-Type              | 客户端方法                | 返回类型                              |
| ------------------------- | ------------------------- | ------------------------------------- |
| `application/json`        | `$get()`, `$post()`, etc. | `Promise<ClientResponse<T>>`          |
| `text/plain`              | `$get()`                  | `Promise<ClientResponse<string>>`     |
| `text/event-stream`       | `$sse()`                  | `SSEClient<{ events: ... }>`          |
| `websocket`               | `$ws()`                   | `WSClient<{ rpc: ..., events: ... }>` |
| `image/*`                 | `$image()`                | `Promise<Blob>`                       |
| `image/svg+xml`           | `$svg()`                  | `Promise<string>`                     |
| `application/*` (非 json) | `$download()`             | `Promise<Blob>`                       |

### 图片类型示例

```typescript
// 服务端定义
const getAvatarRoute = createRoute({
  method: 'get',
  path: '/avatar/:id',
  responses: {
    200: {
      content: {
        'image/png': { schema: z.any().openapi({ type: 'string', format: 'binary' }) },
        'image/jpeg': { schema: z.any().openapi({ type: 'string', format: 'binary' }) },
      },
      description: 'User avatar',
    },
  },
})

// 客户端调用 - 自动推导为 Promise<Blob>
const blob = await apiClient.api.avatar[':id'].$image({ param: { id: '123' } })
const imageUrl = URL.createObjectURL(blob)
```

### SVG 类型示例

```typescript
// 服务端定义
const getIconRoute = createRoute({
  method: 'get',
  path: '/icon/:name',
  responses: {
    200: {
      content: {
        'image/svg+xml': { schema: z.string() },
      },
      description: 'SVG icon',
    },
  },
})

// 客户端调用 - 自动推导为 Promise<string>
const svgString = await apiClient.api.icon[':name'].$svg({ param: { name: 'home' } })
document.querySelector('#icon').innerHTML = svgString
```

### 文件下载示例

```typescript
// 服务端定义
const exportRoute = createRoute({
  method: 'get',
  path: '/export',
  responses: {
    200: {
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: z.any().openapi({ type: 'string', format: 'binary' }),
        },
        'text/csv': { schema: z.string() },
      },
      description: 'Export data',
    },
  },
})

// 客户端调用 - 自动推导为 Promise<Blob>
const blob = await apiClient.api.export.$download()
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'data.xlsx'
a.click()
URL.revokeObjectURL(url)
```

**注意**: 对于二进制类型，使用 `z.any().openapi({ type: 'string', format: 'binary' })` 而不是 `z.instanceof(Blob)`。

## 🔧 类型推导机制

### 核心原理

本项目通过 patch 扩展了 `@hono/zod-openapi` 和 `hono` 的类型定义，实现媒体类型的自动推导。

### 修改的文件

#### 1. `@hono/zod-openapi` - ReturnJsonOrTextOrResponse 类型

**文件**: `node_modules/@hono/zod-openapi/dist/index.d.ts`

**原始类型**:

```typescript
type ReturnJsonOrTextOrResponse<ContentType, Content, Status> = ContentType extends string
  ? ContentType extends `application/${infer Start}json${infer _End}`
    ? TypedResponse<JSONParsed<Content>, Status, 'json'>
    : ContentType extends `text/plain${infer _Rest}`
      ? TypedResponse<Content, Status, 'text'>
      : ContentType extends `text/event-stream`
        ? TypedResponse<Content, Status, 'sse'>
        : ContentType extends `websocket`
          ? TypedResponse<Content, Status, 'ws'>
          : Response // 其他类型返回通用 Response
  : never
```

**扩展后类型**:

```typescript
type ReturnJsonOrTextOrResponse<ContentType, Content, Status> = ContentType extends string
  ? ContentType extends `application/${infer Start}json${infer _End}`
    ? TypedResponse<JSONParsed<Content>, Status, 'json'>
    : ContentType extends `text/plain${infer _Rest}`
      ? TypedResponse<Content, Status, 'text'>
      : ContentType extends `text/event-stream`
        ? TypedResponse<Content, Status, 'sse'>
        : ContentType extends `websocket`
          ? TypedResponse<Content, Status, 'ws'>
          : ContentType extends `image/svg+xml${infer _Rest}`
            ? TypedResponse<Content, Status, 'svg'> // 新增
            : ContentType extends `image/${infer _Type}`
              ? TypedResponse<Content, Status, 'image'> // 新增
              : ContentType extends `multipart/form-data${infer _Rest}`
                ? TypedResponse<Content, Status, 'form'> // 新增
                : ContentType extends `application/${infer _Rest}`
                  ? TypedResponse<Content, Status, 'file'> // 新增
                  : Response
  : never
```

#### 2. `hono` - KnownResponseFormat 类型

**文件**: `node_modules/hono/dist/types/types.d.ts`

```typescript
// 原始
export type KnownResponseFormat = 'json' | 'text' | 'redirect' | 'ws' | 'sse'

// 扩展后
export type KnownResponseFormat =
  | 'json'
  | 'text'
  | 'redirect'
  | 'ws'
  | 'sse'
  | 'image'
  | 'svg'
  | 'file'
  | 'form'
```

#### 3. `hono` - ClientRequest 类型

**文件**: `node_modules/hono/dist/types/client/types.d.ts`

添加客户端方法类型：

```typescript
// 图片类型 - 返回 Promise<Blob>
& (S['$get'] extends {
    outputFormat: infer F;
    output: infer O;
} ? 'image' extends F ? S['$get'] extends {
    input: infer I;
} ? {
    $image: (args?: I) => Promise<Blob>;
} : {} : {} : {})

// SVG 类型 - 返回 Promise<string>
& (S['$get'] extends {
    outputFormat: infer F;
    output: infer O;
} ? 'svg' extends F ? S['$get'] extends {
    input: infer I;
} ? {
    $svg: (args?: I) => Promise<string>;
} : {} : {} : {})

// 文件下载 - 返回 Promise<Blob>
& (S['$get'] extends {
    outputFormat: infer F;
    output: infer O;
} ? 'file' extends F ? S['$get'] extends {
    input: infer I;
} ? {
    $download: (args?: I) => Promise<Blob>;
} : {} : {} : {})
```

#### 4. `hono` - 运行时实现

**文件**: `node_modules/hono/dist/client/client.js`

添加运行时方法实现：

```javascript
// 图片/SVG 处理
if (method === 'image' || method === 'svg') {
  const req2 = new ClientRequestImpl(url, 'get', {
    buildSearchParams: buildSearchParamsOption,
  })
  options ??= {}
  const args = deepMerge(options, opts.args?.[1] || {})
  return req2.fetch(opts.args?.[0], args).then(res => {
    if (method === 'svg') {
      return res.text() // SVG 返回文本
    }
    return res.blob() // 图片返回 Blob
  })
}

// 文件下载处理
if (method === 'download') {
  const req2 = new ClientRequestImpl(url, 'get', {
    buildSearchParams: buildSearchParamsOption,
  })
  options ??= {}
  const args = deepMerge(options, opts.args?.[1] || {})
  return req2.fetch(opts.args?.[0], args).then(res => res.blob())
}
```

### 类型推导流程

```
1. 服务端定义路由
   └─ createRoute() 定义 responses.content

2. OpenAPI Schema 生成
   └─ Content-Type 被记录到 schema

3. 客户端类型推导
   └─ ReturnJsonOrTextOrResponse<ContentType, Content, Status>
       ├─ 'image/png' → TypedResponse<Blob, 200, "image">
       ├─ 'image/svg+xml' → TypedResponse<string, 200, "svg">
       └─ 'application/vnd.*' → TypedResponse<Blob, 200, "file">

4. 客户端方法生成
   └─ ClientRequest 根据 outputFormat 添加方法
       ├─ 'image' → $image(): Promise<Blob>
       ├─ 'svg' → $svg(): Promise<string>
       └─ 'file' → $download(): Promise<Blob>

5. 运行时调用
   └─ client.js 处理实际请求
       ├─ $image() → fetch().then(r => r.blob())
       ├─ $svg() → fetch().then(r => r.text())
       └─ $download() → fetch().then(r => r.blob())
```

### Patch 文件位置

```
template/patches/
├── @hono+zod-openapi+1.2.2.patch  # 类型推导扩展
└── hono+4.12.7.patch              # 客户端方法和运行时实现
```

### 相关文档

- [Client Services 规范](./31-client-services.md) - 客户端方法使用
- [WebSocket 规范](./50-websocket.md) - WebSocket 类型推导
- [SSE 规范](./51-sse.md) - SSE 类型推导

## 🚫 Anti-Patterns

```typescript
// ❌ 不要使用 any
const result: any = await response.json()

// ✅ 应该使用类型守卫
const result = await response.json()
if (result.success) {
  // result.data 类型安全
}

// ❌ 不要重复定义类型
interface ClientItem {
  id: number
  name: string
}

// ✅ 应该复用共享类型
import type { Item } from '@shared/schemas'

// ❌ 不要硬编码 URL
fetch('/api/items/' + id)

// ✅ 应该使用类型安全的客户端
apiClient.api.items[':id'].$get({ param: { id } })
```

## 📚 相关文档

- [Server API 规范](./20-server-api.md) - 服务端路由定义
- [Shared Types 规范](./40-shared-types.md) - Schema 定义规范
- [Testing 规范](./60-testing-standards.md) - 测试编写规范
