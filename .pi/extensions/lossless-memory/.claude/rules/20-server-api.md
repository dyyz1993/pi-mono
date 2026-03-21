---
paths: src/server/**/*.ts
---

# Server API 开发规范

## 📁 目录结构

```
src/server/
├── core/                    # 框架层（不可修改）
│   ├── runtime.ts
│   ├── realtime-core.ts
│   └── realtime-scanner.ts
├── middleware/              # 中间件
│   ├── auth.ts
│   ├── cors.ts
│   ├── logger.ts
│   └── error-handler.ts
├── module-{feature}/       # 业务模块
│   ├── routes/
│   │   └── {feature}-routes.ts
│   ├── services/
│   │   └── {feature}-service.ts
│   └── __tests__/
└── utils/                   # 工具函数
    ├── route-helpers.ts
    ├── logger.ts
    └── auth.ts
```

## 🔧 中间件规范

### 中间件位置约束

中间件**必须**放在 `src/server/middleware/` 目录。

```typescript
// ✅ 正确 - 中间件放在 middleware 目录
// src/server/middleware/auth.ts
export function authMiddleware(options?: AuthMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    // 中间件逻辑
    await next()
  }
}

// ❌ 错误 - 中间件放在其他目录
// src/server/module-todos/middleware/auth.ts
export function authMiddleware() { ... }
```

**ESLint 规则**: `middleware-location`, `no-middleware-outside-dir`

**路径**: `src/server/middleware/**/*.ts`

### ⚠️ 中间件应用位置（重要）

**中间件只能在 `app.ts` 中应用，不能在路由文件中应用！**

```typescript
// ✅ 正确 - 在 app.ts 中应用中间件
// src/server/app.ts
export function createApp<T extends AppBindings = AppBindings>() {
  const app = new OpenAPIHono<{ Bindings: T }>()
    .use('*', errorHandlerMiddleware())
    .use('*', loggerMiddleware())
    .use('*', corsMiddleware())
    .use('/api/admin/*', captchaMiddleware({ ... }))
    .route('/api', apiRoutes)
    .route('/api', adminRoutes)

  return app
}

// ❌ 错误 - 在路由文件中应用中间件
// src/server/module-admin/routes/admin-routes.ts
export const adminRoutes = new OpenAPIHono()
  .use('*', captchaMiddleware())  // ❌ 会导致类型推导丢失
  .openapi(getStatsRoute, async c => { ... })  // ❌ 类型错误
```

**为什么不能在路由文件中应用中间件？**

| 操作                       | 返回类型      | 是否支持 .openapi() |
| -------------------------- | ------------- | ------------------- |
| `new OpenAPIHono()`        | `OpenAPIHono` | ✅ 支持             |
| `.use(middleware)`         | `Hono`        | ❌ 不支持           |
| `.openapi(route, handler)` | `OpenAPIHono` | ✅ 支持             |

**类型推导链**：

```
OpenAPIHono
  ↓ .use()
Hono (丢失 OpenAPI 类型)
  ↓ .openapi() ❌ 类型错误
```

### 中间件导出规范

```typescript
// src/server/middleware/index.ts
export { corsMiddleware, createCorsMiddleware, type CorsOptions } from './cors'
export { loggerMiddleware, createLoggerMiddleware, type LoggerOptions } from './logger'
export {
  authMiddleware,
  requireAdminMiddleware,
  requirePermissionsMiddleware,
  type AuthUser,
  type AuthMiddlewareOptions,
} from './auth'
export {
  captchaMiddleware,
  markCaptchaVerifiedMiddleware,
  clearCaptchaSessionMiddleware,
  type CaptchaConfig,
} from './captcha'
```

## 🛣️ 路由规范

### 路由位置约束

路由文件**必须**放在 `src/server/module-*/routes/` 目录。

```typescript
// ✅ 正确 - 路由放在模块目录
// src/server/module-todos/routes/todos-routes.ts
export const apiRoutes = new OpenAPIHono()
  .openapi(listRoute, async c => { ... })
  .openapi(createRoute, async c => { ... })

// ❌ 错误 - 路由放在其他目录
// src/server/routes/todos.ts
export const todoRoutes = new OpenAPIHono()...
```

**ESLint 规则**: `route-location`

**路径**: `src/server/module-*/routes/**/*.ts`

### 路由定义规范

```typescript
// ✅ 正确 - 使用链式语法
import { createRoute } from '@hono/zod-openapi'
import { ItemSchema, CreateItemSchema } from '@shared/schemas'
import { successResponse, errorResponse } from '@server/utils/route-helpers'

const listRoute = createRoute({
  method: 'get',
  path: '/items',
  responses: {
    200: successResponse(z.array(ItemSchema), '获取列表'),
  },
})

const createRoute = createRoute({
  method: 'post',
  path: '/items',
  request: {
    body: {
      content: {
        'application/json': { schema: CreateItemSchema },
      },
    },
  },
  responses: {
    201: successResponse(ItemSchema, '创建成功'),
    400: errorResponse('参数错误'),
  },
})

export const apiRoutes = new OpenAPIHono()
  .openapi(listRoute, async c => { ... })
  .openapi(createRoute, async c => { ... })
```

**ESLint 规则**: `require-hono-chain-syntax`, `no-inline-schema`, `require-response-helpers`

## 🏢 Service 层规范

### Service 职责

Service 层负责业务逻辑实现，不包含路由定义。

```typescript
// ✅ 正确 - Service 只包含业务逻辑
// src/server/module-todos/services/todo-service.ts
import type { Item, CreateItemInput } from '@shared/schemas'
import { getDb } from '../../db'

export async function listItems(): Promise<Item[]> {
  const db = await getDb()
  const rows = await db.select().from(items)
  return rows
}

export async function createItem(input: CreateItemInput): Promise<Item> {
  const db = await getDb()
  const result = await db.insert(items).values(input).returning()
  return result[0]
}
```

### 禁止工具函数

Service 文件应专注于业务逻辑，不应包含工具函数。

```typescript
// ❌ 错误 - Service 中定义工具函数
export async function createItem(input: CreateItemInput) {
  const normalizedTitle = normalizeText(input.title) // ❌ 工具函数
  // ...
}

function normalizeText(text: string) {
  // ❌ 应移至 utils/
  return text.trim().toLowerCase()
}

// ✅ 正确 - 工具函数放在 utils/
import { normalizeText } from '@server/utils/text'

export async function createItem(input: CreateItemInput) {
  const normalizedTitle = normalizeText(input.title) // ✅
  // ...
}
```

**ESLint 规则**: `no-util-functions-in-service`

**路径**: `src/server/module-*/services/**/*.ts`

## 🏗️ 架构边界规范

### 层级边界约束

项目分为**框架层**和**业务层**，边界必须清晰。

| 层级   | 目录                                                             | 职责                     |
| ------ | ---------------------------------------------------------------- | ------------------------ |
| 框架层 | `src/shared/core/`<br>`src/server/core/`                         | 通用基础设施，不感知业务 |
| 业务层 | `src/shared/modules/`<br>`src/server/module-*/`<br>`src/client/` | 业务逻辑实现             |

### 禁止事项

```typescript
// ❌ 禁止：业务层直接修改框架层
// src/server/module-todos/services/todo-service.ts
import { runtime } from '@server/core/runtime'

runtime.registerRPC('customMethod', handler) // ❌ 禁止修改框架层

// ✅ 正确：通过框架提供的扩展点
import { createRPCHandler } from '@server/core/runtime'

export const customHandler = createRPCHandler('customMethod', handler)
```

**ESLint 规则**: `layer-boundary`

**路径**: `src/server/**/*.ts`

## 🛡️ 框架保护

框架层文件带有 `@framework-baseline` 注释：

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

**框架层文件**:

- `src/server/core/**/*.ts`
- `src/server/entries/**/*.ts`
- `src/server/test-utils/**/*.ts`
- `src/shared/core/**/*.ts`

**ESLint 规则**: `framework-protect`

## 📤 导出规范

### 模块导出

```typescript
// src/server/module-todos/index.ts
export { apiRoutes } from './routes/todos-routes'
export { listTodos, createTodo } from './services/todo-service'
```

### 全局导出

```typescript
// src/server/index.ts
export { createApp, type AppType } from './app'
export { apiRoutes } from './module-todos/routes/todos-routes'
```

## 🚫 Anti-Patterns

```typescript
// ❌ 不要在 Service 中定义路由
export const apiRoutes = new OpenAPIHono()...

// ❌ 不要在路由中直接实现业务逻辑
.openapi(createRoute, async c => {
  const db = await getDb()  // ❌ 应在 Service 中
  const result = await db.insert(items).values(data)
  return c.json({ success: true, data: result[0] })
})

// ✅ 正确 - 调用 Service
.openapi(createRoute, async c => {
  const data = c.req.valid('json')
  const item = await createItem(data)  // ✅ 调用 Service
  return c.json({ success: true, data: item })
})

// ❌ 不要在路由文件中应用中间件
export const adminRoutes = new OpenAPIHono()
  .use('*', captchaMiddleware())  // ❌ 会导致类型错误
  .openapi(getStatsRoute, async c => { ... })

// ✅ 正确 - 在 app.ts 中应用中间件
// src/server/app.ts
.use('/api/admin/*', captchaMiddleware())
.route('/api', adminRoutes)

// ❌ 不要使用 any 类型
export async function createItem(input: any) { ... }

// ✅ 正确 - 使用类型
export async function createItem(input: CreateItemInput): Promise<Item> { ... }
```

## 📚 相关文档

- [API 类型推导规范](./10-api-type-inference.md) - Hono RPC 类型推导
- [Server 入口规范](./21-server-entrypoint.md) - 应用创建规范
- [Testing 规范](./60-testing-standards.md) - 测试编写规范
