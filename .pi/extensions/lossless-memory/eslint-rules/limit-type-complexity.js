/**
 * @fileoverview 限制会导致 TypeScript 类型推导复杂化的写法
 *
 * 此规则检测以下可能导致类型推导问题的模式：
 * 1. 单个变量声明中的链式调用 .route() 超过限制次数
 * 2. ReturnType<typeof hc<AppType>> 等复杂类型推导
 *
 * @author biomimic-app
 */

/**
 * @param {import('eslint').Rule.RuleContext} context
 */
function create(context) {
  const maxRouteChainLength = context.options[0]?.maxRouteChainLength ?? 5

  /**
   * 检查单个变量声明中的链式调用 .route() 数量
   * @param {import('eslint').Rule.Node} node
   */
  function checkRouteChain(node) {
    if (node.type !== 'CallExpression') return

    let routeCount = 0
    let currentNode = node

    while (currentNode && currentNode.type === 'CallExpression') {
      const callee = currentNode.callee

      if (
        callee.type === 'MemberExpression' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'route'
      ) {
        routeCount++
      }

      if (callee.type === 'MemberExpression') {
        currentNode = callee.object
      } else {
        break
      }
    }

    if (routeCount > maxRouteChainLength) {
      context.report({
        node,
        messageId: 'tooManyRouteChains',
        data: {
          count: routeCount,
          max: maxRouteChainLength,
        },
      })
    }
  }

  /**
   * 检查 ReturnType 的使用
   * @param {import('eslint').Rule.Node} node
   */
  function checkReturnType(node) {
    if (node.type !== 'TSTypeReference') return

    const typeName = node.typeName

    if (typeName.type === 'Identifier' && typeName.name === 'ReturnType') {
      if (node.typeArguments?.typeArguments?.length > 0) {
        const typeArg = node.typeArguments.typeArguments[0]

        if (typeArg.type === 'TSTypeQuery' && typeArg.exprName.type === 'Identifier') {
          const funcName = typeArg.exprName.name

          if (['createApp', 'hc'].includes(funcName)) {
            context.report({
              node,
              messageId: 'complexReturnType',
              data: {
                funcName,
              },
            })
          }
        }
      }
    }
  }

  return {
    VariableDeclarator(node) {
      if (node.init?.type === 'CallExpression') {
        checkRouteChain(node.init)
      }
    },
    TSTypeReference: checkReturnType,
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export const limitTypeComplexity = {
  meta: {
    type: 'suggestion',
    docs: {
      description: '限制会导致 TypeScript 类型推导复杂化的写法',
      recommended: true,
    },
    messages: {
      tooManyRouteChains:
        '链式调用 .route() {{count}} 次超过了建议的最大值 {{max}} 次。这会导致 TypeScript 类型推导复杂化，建议拆分为多个变量。',
      complexReturnType:
        'ReturnType<typeof {{funcName}}> 可能导致类型推导复杂化。如果遇到 "类型实例化过深" 错误，请考虑使用更简单的类型定义。',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxRouteChainLength: {
            type: 'integer',
            minimum: 1,
            default: 5,
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create,
}
