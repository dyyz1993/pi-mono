---
paths: src/server/app.ts
---

# Server App Factory 规范

## 🎯 Primary Purpose

`src/server/app.ts` 是服务端应用的**工厂函数**，负责创建和配置 Hono 应用实例。

**重要**: 此文件使用 `createApp()` 函数创建应用，而不是直接导出 `app` 实例。

## 🔗 链式语法（强制）

**必须使用链式语法**创建应用实例，确保 Hono RPC 类型推断正确。

```typescript
// ✅ 正确 - 链式语法
export function createApp<T extends AppBindings = AppBindings>() {
  const app = new OpenAPIHono<{ Bindings: T }>()
    .use('*', errorHandlerMiddleware())
    .use('*', loggerMiddleware())
    .use('*', corsMiddleware())
    .route('/api', apiRoutes)
    .route('/api', notificationRoutes)
    .get('/health', async c => { ... })

  return app
}

// ❌ 错误 - 非链式语法会导致类型推断丢失
const app = new OpenAPIHono();
app.use('*', errorHandlerMiddleware());
app.route('/api', apiRoutes);
```

**为什么必须使用链式语法？**

| 方式     | 类型推断 | Hono RPC 支持 | IDE 补全 |
| -------- | -------- | ------------- | -------- |
| 链式语法 | ✅ 完整  | ✅ 支持       | ✅ 完整  |
| 非链式   | ❌ 丢失  | ❌ 不支持     | ❌ 部分  |

## 📁 文件职责

### createApp 函数职责

1. **创建应用实例** - 使用 `OpenAPIHono`
2. **配置全局中间件** - 错误处理、日志、CORS 等
3. **挂载业务路由** - 通过 `.route()` 挂载模块路由
4. **定义全局路由** - 健康检查、测试辅助路由
5. **自动注册实时通信** - WebSocket/SSE 自动扫描

### 禁止事项

```typescript
// ❌ 禁止定义业务路由
.post('/api/todos', async c => {  // ❌ 应在 module-todos/routes/
  // 业务逻辑
})

// ❌ 禁止直接调用 Service
import { createTodo } from './module-todos/services/todo-service';
const todo = await createTodo(data);  // ❌ 应通过路由调用

// ❌ 禁止实现工具函数
function formatDate(date: Date) {  // ❌ 应在 utils/
  return date.toISOString();
}
```

## ✅ 允许的路由定义

### 全局路由（允许）

```typescript
export function createApp<T extends AppBindings = AppBindings>() {
  const app = new OpenAPIHono<{ Bindings: T }>()
    // ... 中间件和业务路由
    // ✅ 允许 - 健康检查路由
    .get('/health', async c => {
      try {
        const { getDb } = await import('./db')
        await getDb()
        return c.json({ status: 'ok', db: 'connected' })
      } catch {
        return c.json({ status: 'ok', db: 'not configured' })
      }
    })

    // ✅ 允许 - 测试辅助路由（仅测试环境）
    .post('/api/__test__/cleanup', async c => {
      const { cleanupTestDatabase } = await import('./db/test-setup')
      await cleanupTestDatabase()
      return c.json({ success: true })
    })

  return app
}
```

### 业务路由（禁止）

```typescript
// ❌ 禁止 - 业务路由应在 module-*/routes/ 中定义
.post('/api/todos', async c => {
  const data = await c.req.json()
  // 业务逻辑
})
```

## 🏗 标准结构

```typescript
// 1. Imports
import { OpenAPIHono } from '@hono/zod-openapi'
import { apiRoutes } from './module-todos/routes/todos-routes'
import { notificationRoutes } from './module-notifications/routes/notification-routes'
import type { AppBindings, CreateAppOptions } from './types/bindings'
import { autoRegisterRealtime } from './core/realtime-scanner'
import { corsMiddleware, loggerMiddleware, errorHandlerMiddleware } from './middleware'

// 2. 导出类型
export { type AppBindings, type CreateAppOptions } from './types/bindings'

// 3. createApp 函数
export function createApp<T extends AppBindings = AppBindings>(_options: CreateAppOptions = {}) {
  const app = new OpenAPIHono<{ Bindings: T }>()
    // 3.1 全局中间件
    .use('*', errorHandlerMiddleware())
    .use('*', loggerMiddleware())
    .use('*', corsMiddleware())

    // 3.2 业务路由挂载
    .route('/api', apiRoutes)
    .route('/api', notificationRoutes)

    // 3.3 全局路由
    .get('/health', async c => { ... })

  // 3.4 自动注册实时通信
  autoRegisterRealtime(app)

  return app
}

// 4. 导出类型
export type AppType = ReturnType<typeof createApp>

// 5. 导出路由模块（供其他模块使用）
export { apiRoutes, notificationRoutes }
```

## 🔄 与其他文件的关系

### 入口文件层级

```
src/server/
├── index.ts              # 导出模块，设置 runtime adapter
│   └── 导出 createApp, AppType 等
│
├── app.ts                # 创建应用实例（本文件）
│   └── createApp() 函数
│
└── entries/
    ├── node.ts           # Node.js 启动服务器
    │   └── startServer() 函数
    │
    └── cloudflare.ts     # Cloudflare Workers 入口
        └── export default app
```

### 调用流程

```
1. entries/node.ts
   ↓ 调用 createApp()
2. app.ts
   ↓ 创建应用实例
3. 返回 OpenAPIHono 实例
   ↓ 导出 AppType
4. 客户端使用 AppType 进行类型安全调用
```

## 🧪 测试辅助路由

测试辅助路由**必须**使用 `/api/__test__/` 前缀：

```typescript
// ✅ 正确 - 测试路由前缀
.post('/api/__test__/cleanup', async c => { ... })
.post('/api/__test__/seed', async c => { ... })
.get('/api/__test__/status', async c => { ... })

// ❌ 错误 - 没有前缀
.post('/api/test/cleanup', async c => { ... })  // ❌ 缺少 __test__ 前缀
```

## 📝 类型导出

**必须导出以下类型**：

```typescript
// 1. AppType - 供客户端 Hono RPC 使用
export type AppType = ReturnType<typeof createApp>

// 2. AppBindings - 供环境变量类型
export type AppBindings = { ... }

// 3. CreateAppOptions - 供创建应用时的选项
export type CreateAppOptions = { ... }
```

## 🔒 框架保护

此文件属于**框架层代码**，修改需要特殊审批：

```typescript
/**
 * @framework-baseline [hash]
 *
 * 如需修改，请添加以下说明：
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */
```

## 🚫 Anti-Patterns

```typescript
// ❌ 不要使用非链式语法
const app = new OpenAPIHono();
app.use('*', cors());
app.route('/api', apiRoutes);

// ❌ 不要定义业务路由
.post('/api/users', async c => { ... })

// ❌ 不要直接调用 Service
import { createUser } from './module-users/services/user-service';
const user = await createUser(data);

// ❌ 不要忘记导出 AppType
export default app  // ❌ 缺少 AppType 导出

// ✅ 正确
export type AppType = ReturnType<typeof createApp>
export default app
```

## 📚 相关文档

- [Server API 规范](./20-server-api.md) - 路由定义规范
- [API 类型推导规范](./10-api-type-inference.md) - Hono RPC 类型推导
- [架构规范](./00-project-config.md) - 模块化架构
