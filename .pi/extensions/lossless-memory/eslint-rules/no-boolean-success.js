/**
 * 禁止在路由定义中使用 z.boolean() 定义 success 字段
 * 应该使用 z.literal(true) 或 z.literal(false) 以获得正确的类型推导
 */

export const noBooleanSuccess = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止使用 z.boolean() 定义 success 字段',
      recommended: true,
    },
    messages: {
      noBooleanSuccess:
        '禁止使用 z.boolean() 定义 success 字段。使用 z.literal(true) 或 z.literal(false) 以获得正确的类型推导。',
    },
  },
  create(context) {
    return {
      Property(node) {
        if (
          node.key.type === 'Identifier' &&
          node.key.name === 'success' &&
          node.value.type === 'CallExpression' &&
          node.value.callee.type === 'MemberExpression' &&
          node.value.callee.property.type === 'Identifier' &&
          node.value.callee.property.name === 'boolean' &&
          node.value.callee.object.type === 'Identifier' &&
          node.value.callee.object.name === 'z'
        ) {
          context.report({
            node,
            messageId: 'noBooleanSuccess',
          })
        }
      },
    }
  },
}
