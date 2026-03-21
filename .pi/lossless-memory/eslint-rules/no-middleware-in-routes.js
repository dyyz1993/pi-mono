/**
 * @fileoverview 禁止在路由文件中使用中间件
 * @description 中间件只能在 app.ts 中应用，在路由文件中应用会导致类型推导丢失
 * @exception 路由定义中的 middleware 字段是允许的（针对单个路由的中间件）
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export const noMiddlewareInRoutes = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止在路由文件中使用中间件',
      category: 'Architecture',
      recommended: true,
      url: 'file:///.claude/rules/20-server-api.md#中间件应用位置重要',
    },
    messages: {
      noMiddlewareInRoutes:
        '🚫 禁止在路由文件中使用 .use() 应用中间件。\n\n' +
        '❌ 错误示例：\n' +
        '   export const adminRoutes = new OpenAPIHono()\n' +
        '     .use("*", captchaMiddleware())  // ❌ 会导致类型推导丢失\n' +
        '     .openapi(getStatsRoute, ...)\n\n' +
        '✅ 正确示例：\n\n' +
        '1️⃣ 全局中间件 - 在 app.ts 中应用：\n' +
        '   // src/server/app.ts\n' +
        '   export function createApp() {\n' +
        '     const app = new OpenAPIHono()\n' +
        '       .use("/api/admin/*", captchaMiddleware())  // ✅ 全局中间件\n' +
        '       .route("/api", adminRoutes)\n' +
        '     return app\n' +
        '   }\n\n' +
        '2️⃣ 路由级中间件 - 在路由定义中配置：\n' +
        '   // src/server/module-admin/routes/admin-routes.ts\n' +
        '   const getStatsRoute = createRoute({\n' +
        '     method: "get",\n' +
        '     path: "/admin/stats",\n' +
        '     middleware: [authMiddleware({ requiredRole: "admin" })],  // ✅ 路由级中间件\n' +
        '     responses: { ... }\n' +
        '   })\n\n' +
        '📖 详细说明请查看：.claude/rules/20-server-api.md#中间件应用位置重要',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()

    const isRouteFile =
      filename.includes('/routes/') &&
      filename.includes('-routes.ts') &&
      !filename.includes('app.ts')

    if (!isRouteFile) {
      return {}
    }

    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') {
          return
        }

        const property = node.callee.property
        if (property.type !== 'Identifier' || property.name !== 'use') {
          return
        }

        context.report({
          node,
          messageId: 'noMiddlewareInRoutes',
        })
      },
    }
  },
}
