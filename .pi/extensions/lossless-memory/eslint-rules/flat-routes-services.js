/**
 * 禁止在 routes/ 和 services/ 目录下创建文件
 *
 * 规则：
 * 1. src/server/routes/ 和 src/server/services/ 目录不允许放置任何文件
 * 2. 所有路由和服务必须在 module-* 目录下
 *
 * 原因：
 * - 强制模块化组织，便于维护
 * - 每个功能模块独立管理路由、服务和测试
 * - 避免代码分散难以追踪
 *
 * 参考: .claude/rules/20-server-api.md
 */

export const flatRoutesServices = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止在 routes/services 目录下创建文件，必须在 module-* 目录下',
      recommended: true,
    },
    messages: {
      noFilesInRoutesServices: `禁止在 routes/services 目录下创建文件。

当前路径：{{filepath}}

routes/ 和 services/ 目录不允许放置任何文件。
所有路由和服务必须在 module-* 目录下。

📋 规则文档: .claude/rules/20-server-api.md

🚀 快速创建模块:
  npm run create:module <name>

示例：
❌ src/server/routes/user-routes.ts
❌ src/server/services/user-service.ts
✅ src/server/module-user/routes/user-routes.ts
✅ src/server/module-user/services/user-service.ts
`,
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || ''

    const isInRoutesDir = filename.includes('/server/routes/')
    const isInServicesDir = filename.includes('/server/services/')

    if (!isInRoutesDir && !isInServicesDir) return {}

    return {
      Program(node) {
        context.report({
          node,
          messageId: 'noFilesInRoutesServices',
          data: { filepath: filename },
        })
      },
    }
  },
}

export default flatRoutesServices
