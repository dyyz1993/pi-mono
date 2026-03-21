/**
 * 路由文件位置规则
 *
 * 约束路由文件的位置：
 * 1. 路由文件必须放在 src/server/module-{module}/routes/ 目录下
 * 2. 禁止在 src/routes/ 或其他非模块目录下创建路由文件
 */

export const routeLocation = {
  meta: {
    type: 'problem',
    docs: {
      description: '路由文件必须放在模块目录下',
      recommended: true,
    },
    messages: {
      routeOutsideModule: `路由文件必须放在模块目录下。

当前文件位置：{{filename}}
建议位置：src/server/module-{module}/routes/{name}-routes.ts

示例目录结构：
src/
  server/
    module-todos/
      routes/
        todos-routes.ts    <- Todo 路由
      services/
        todo-service.ts
    module-notifications/
      routes/
        notification-routes.ts    <- Notification 路由
      services/
        notification-service.ts

好处：
1. 模块化组织，便于维护
2. 路由与服务层就近放置
3. 统一的代码结构
`,
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || ''

    const isRouteFile = filename.endsWith('-routes.ts') || filename.endsWith('-route.ts')

    if (!isRouteFile) return {}

    const isInModuleRoutes =
      /module-.*\/routes\/.*\.ts$/.test(filename) && !filename.includes('__tests__')

    if (isInModuleRoutes) return {}

    return {
      Program(node) {
        context.report({
          node,
          messageId: 'routeOutsideModule',
          data: { filename },
        })
      },
    }
  },
}

export default routeLocation
