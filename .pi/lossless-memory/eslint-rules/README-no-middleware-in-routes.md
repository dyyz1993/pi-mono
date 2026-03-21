# ESLint 规则：禁止在路由文件中使用中间件

## 📋 规则说明

**规则名称**: `no-middleware-in-routes`  
**类型**: Problem  
**严重程度**: Error

## 🎯 目的

防止在路由文件中使用 `.use()` 方法应用中间件，因为这会导致 TypeScript 类型推导丢失。

## 📚 背景

在 Hono + OpenAPI 项目中，中间件的应用位置会影响类型推导：

```typescript
// 类型推导链
OpenAPIHono
  ↓ .use()
Hono (丢失 OpenAPI 类型)
  ↓ .openapi() ❌ 类型错误
```

## ✅ 正确用法

### 1️⃣ 全局中间件 - 在 `app.ts` 中应用

适用于所有路由或一组路由：

```typescript
// src/server/app.ts
export function createApp() {
  const app = new OpenAPIHono()
    .use('*', errorHandlerMiddleware())
    .use('/api/admin/*', captchaMiddleware()) // ✅ 全局中间件
    .route('/api', adminRoutes)
  return app
}
```

### 2️⃣ 路由级中间件 - 在路由定义中配置

适用于单个路由：

```typescript
// src/server/module-admin/routes/admin-routes.ts
const getStatsRoute = createRoute({
  method: 'get',
  path: '/admin/stats',
  middleware: [authMiddleware({ requiredRole: 'admin' })], // ✅ 路由级中间件
  responses: {
    200: successResponse(SystemStatsSchema, '获取统计数据'),
    401: errorResponse('未授权'),
  },
})

export const adminRoutes = new OpenAPIHono().openapi(getStatsRoute, async c => {
  // 路由处理逻辑
})
```

## ❌ 错误用法

在路由文件中使用 `.use()` 方法：

```typescript
// src/server/module-admin/routes/admin-routes.ts
export const adminRoutes = new OpenAPIHono()
  .use('*', captchaMiddleware())  // ❌ 会导致类型推导丢失
  .openapi(getStatsRoute, async c => { ... })  // ❌ 类型错误
```

## 🔍 检测范围

规则会检测以下文件：

- 文件路径包含 `/routes/`
- 文件名以 `-routes.ts` 结尾
- 不是 `app.ts` 文件

**例外情况**：

- ✅ 路由定义中的 `middleware: [...]` 字段是允许的
- ❌ 在路由实例上调用 `.use()` 方法是禁止的

## 📖 错误提示

当检测到违规时，ESLint 会显示以下错误：

```
🚫 禁止在路由文件中使用 .use() 应用中间件。

❌ 错误示例：
   export const adminRoutes = new OpenAPIHono()
     .use("*", captchaMiddleware())  // ❌ 会导致类型推导丢失
     .openapi(getStatsRoute, ...)

✅ 正确示例：

1️⃣ 全局中间件 - 在 app.ts 中应用：
   // src/server/app.ts
   export function createApp() {
     const app = new OpenAPIHono()
       .use("/api/admin/*", captchaMiddleware())  // ✅ 全局中间件
       .route("/api", adminRoutes)
     return app
   }

2️⃣ 路由级中间件 - 在路由定义中配置：
   // src/server/module-admin/routes/admin-routes.ts
   const getStatsRoute = createRoute({
     method: "get",
     path: "/admin/stats",
     middleware: [authMiddleware({ requiredRole: "admin" })],  // ✅ 路由级中间件
     responses: { ... }
   })

📖 详细说明请查看：.claude/rules/20-server-api.md#中间件应用位置重要
```

## 📊 中间件应用位置对比

| 中间件类型       | 应用位置 | 作用范围           | 示例                                        |
| ---------------- | -------- | ------------------ | ------------------------------------------- |
| **全局中间件**   | `app.ts` | 所有路由或一组路由 | `.use('/api/admin/*', captchaMiddleware())` |
| **路由级中间件** | 路由定义 | 单个路由           | `middleware: [authMiddleware()]`            |

## 🔧 配置

规则已在 `eslint.config.js` 中配置：

```javascript
{
  files: ['src/server/**/*.ts'],
  rules: {
    'local-rules/no-middleware-in-routes': 'error',
  },
}
```

## 📝 相关文档

- [Server API 规范](../.claude/rules/00-project-config.md)
- [API 类型推导规范](../.claude/rules/10-api-type-inference.md)

## 🧪 测试

规则已通过以下测试：

- ✅ 在 `app.ts` 中使用 `.use()` - 不报错
- ✅ 在路由文件中使用 `.openapi()` - 不报错
- ✅ 在路由定义中使用 `middleware: [...]` - 不报错
- ❌ 在路由文件中使用 `.use()` - 报错
