/**
 * 自定义 ESLint 规则：强制路由/RPC 测试使用类型安全的测试客户端
 *
 * 必须使用 createTestClient() 返回的客户端进行 API 测试
 * 禁止使用 fetch、app.fetch、app.request 等非类型安全方式
 */

export const requireTypeSafeTestClient = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require type-safe test client for route/RPC tests to preserve type inference',
      recommended: true,
    },
    messages: {
      forbiddenFetch:
        'Direct fetch() is not allowed in route tests. Use createTestClient() for type-safe API testing.\n' +
        'Example: const client = createTestClient()\n' +
        '         const res = await client.api.todos.$get()',
      forbiddenAppFetch:
        'Direct app.fetch() is not allowed in route tests. Use createTestClient() for type-safe API testing.\n' +
        'Example: const client = createTestClient()\n' +
        '         const res = await client.api.todos.$get()',
      forbiddenAppRequest:
        'Direct app.request() is not allowed in route tests. Use createTestClient() for type-safe API testing.\n' +
        'Example: const client = createTestClient()\n' +
        '         const res = await client.api.todos.$get()',
      forbiddenHonoClient:
        'Direct hono/client hc() is not allowed in route tests. Use createTestClient() from test-utils.\n' +
        'Example: const client = createTestClient()\n' +
        '         const res = await client.api.todos.$get()',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()

    const isMiddlewareTest =
      filename.includes('/middleware/__tests__') || filename.includes('/middleware/')

    const isRouteTestFile =
      !isMiddlewareTest &&
      (filename.includes('-rpc.test.') ||
        filename.includes('-route.test.') ||
        (filename.includes('__tests__') && filename.includes('.test.')))

    if (!isRouteTestFile) {
      return {}
    }

    return {
      CallExpression(node) {
        if (!node.callee) return

        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          context.report({
            node,
            messageId: 'forbiddenFetch',
          })
          return
        }

        if (node.callee.type === 'MemberExpression') {
          const property = node.callee.property
          const object = node.callee.object

          if (property && property.name === 'fetch' && object && object.name === 'app') {
            context.report({
              node,
              messageId: 'forbiddenAppFetch',
            })
            return
          }

          if (property && property.name === 'request' && object && object.name === 'app') {
            context.report({
              node,
              messageId: 'forbiddenAppRequest',
            })
            return
          }
        }

        if (node.callee.type === 'CallExpression') {
          if (
            node.callee.callee &&
            node.callee.callee.type === 'Identifier' &&
            node.callee.callee.name === 'hc'
          ) {
            context.report({
              node,
              messageId: 'forbiddenHonoClient',
            })
            return
          }
        }
      },
    }
  },
}

export default requireTypeSafeTestClient
