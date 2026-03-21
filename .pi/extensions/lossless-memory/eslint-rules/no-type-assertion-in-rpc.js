/**
 * 自定义 ESLint 规则：禁止在 RPC 调用中使用类型断言
 *
 * Hono RPC 有完整的类型推导，如果需要使用 `as` 类型断言，
 * 说明类型定义有问题，应该修复类型定义而不是使用断言。
 *
 * 错误示例:
 *   apiClient.api.admin.register.$post({
 *     json: { ... } as RegisterRequest  // ❌ 禁止
 *   })
 *
 * 正确示例:
 *   apiClient.api.admin.register.$post({
 *     json: { ... }  // ✅ 类型自动推导
 *   })
 */

export const noTypeAssertionInRpc = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow type assertions in RPC calls - Hono RPC provides type inference',
      recommended: true,
    },
    messages: {
      noTypeAssertionInJson:
        'Type assertion (`as`) in RPC `json` parameter is not allowed. ' +
        'Hono RPC provides type inference - remove the `as` assertion. ' +
        'If types are incorrect, fix the schema/type definitions instead.',
      noTypeAssertionInParam:
        'Type assertion (`as`) in RPC `param` parameter is not allowed. ' +
        'Hono RPC provides type inference - remove the `as` assertion.',
      noTypeAssertionInQuery:
        'Type assertion (`as`) in RPC `query` parameter is not allowed. ' +
        'Hono RPC provides type inference - remove the `as` assertion.',
    },
    schema: [],
  },
  create(context) {
    function isRpcMethod(node) {
      if (!node || node.type !== 'MemberExpression') return false
      const property = node.property
      if (!property || property.type !== 'Identifier') return false
      const methodName = property.name
      return (
        methodName.startsWith('$get') ||
        methodName.startsWith('$post') ||
        methodName.startsWith('$put') ||
        methodName.startsWith('$delete') ||
        methodName.startsWith('$patch')
      )
    }

    function checkForTypeAssertion(node, paramName, messageId) {
      if (!node || node.type !== 'ObjectExpression') return

      for (const prop of node.properties) {
        if (
          prop.type === 'Property' &&
          prop.key &&
          prop.key.type === 'Identifier' &&
          prop.key.name === paramName
        ) {
          const value = prop.value
          if (value && value.type === 'TSAsExpression') {
            context.report({
              node: value,
              messageId,
            })
          }
        }
      }
    }

    return {
      CallExpression(node) {
        if (!node.callee) return

        if (!isRpcMethod(node.callee)) return

        const args = node.arguments
        if (!args || args.length === 0) return

        const firstArg = args[0]
        if (firstArg.type !== 'ObjectExpression') return

        checkForTypeAssertion(firstArg, 'json', 'noTypeAssertionInJson')
        checkForTypeAssertion(firstArg, 'param', 'noTypeAssertionInParam')
        checkForTypeAssertion(firstArg, 'query', 'noTypeAssertionInQuery')
      },
    }
  },
}

export default noTypeAssertionInRpc
