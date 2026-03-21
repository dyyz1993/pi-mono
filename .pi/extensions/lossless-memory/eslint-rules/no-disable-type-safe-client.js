/**
 * 禁止在测试文件中禁用 require-type-safe-test-client 规则
 * 确保所有路由/RPC测试都使用类型安全的测试客户端
 */

export const noDisableTypeSafeClient = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止禁用 require-type-safe-test-client 规则',
      recommended: true,
    },
    messages: {
      noDisableTypeSafeClient:
        '禁止禁用 require-type-safe-test-client 规则。路由测试必须使用类型安全的测试客户端 (createTestClient)。',
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
      Program(node) {
        for (const comment of node.comments || []) {
          const commentText = comment.value.trim()
          if (
            commentText.includes('eslint-disable') &&
            commentText.includes('require-type-safe-test-client')
          ) {
            context.report({
              loc: comment.loc,
              messageId: 'noDisableTypeSafeClient',
            })
          }
        }
      },
    }
  },
}

export default noDisableTypeSafeClient
