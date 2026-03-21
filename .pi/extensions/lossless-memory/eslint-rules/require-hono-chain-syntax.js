/**
 * 自定义 ESLint 规则：
 * 1. 禁止使用普通 Hono，必须使用 OpenAPIHono
 * 2. 强制 OpenAPIHono 使用链式语法
 * 3. 禁止 createRoute 在 new OpenAPIHono 之后出现
 *
 * 原因：
 * - OpenAPIHono 支持 RPC 类型推断
 * - 非链式写法会导致 Hono RPC 类型推断丢失
 * - createRoute 必须在 OpenAPIHono 实例化之前定义，保证代码结构清晰
 */

export const requireHonoChainSyntax = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require OpenAPIHono chain syntax and forbid createRoute after OpenAPIHono instantiation',
      recommended: true,
    },
    messages: {
      useOpenAPIHono: 'Use OpenAPIHono instead of Hono for RPC type inference',
      nonChainSyntax:
        'OpenAPIHono must use chain syntax. Non-chain syntax breaks RPC type inference. ' +
        'Example: new OpenAPIHono().openapi(route1, handler1).openapi(route2, handler2)',
      standaloneOpenapiCall:
        'Standalone .openapi() calls are forbidden. Use chain syntax instead. ' +
        'Example: new OpenAPIHono().openapi(route1, handler1).openapi(route2, handler2)',
      createRouteAfterOpenAPIHono:
        'createRoute must be defined BEFORE new OpenAPIHono(). ' +
        'All route definitions should come before the OpenAPIHono instantiation. ' +
        'This ensures better code organization and type inference.',
    },
    schema: [],
  },
  create(context) {
    const openAPIHonoVariables = new Set()
    const createRouteCallNodes = []
    let openAPIHonoNode = null

    return {
      NewExpression(node) {
        if (
          node.callee &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'OpenAPIHono'
        ) {
          openAPIHonoNode = node

          const hasNextCall =
            node.parent &&
            node.parent.type === 'MemberExpression' &&
            node.parent.property &&
            node.parent.property.type === 'Identifier' &&
            (node.parent.property.name === 'openapi' ||
              node.parent.property.name === 'use' ||
              node.parent.property.name === 'route' ||
              node.parent.property.name === 'get' ||
              node.parent.property.name === 'post' ||
              node.parent.property.name === 'put' ||
              node.parent.property.name === 'delete')

          if (!hasNextCall) {
            openAPIHonoVariables.add(node.id?.name || 'unknown')
            context.report({
              node,
              messageId: 'nonChainSyntax',
            })
          }
        }

        if (node.callee && node.callee.type === 'Identifier' && node.callee.name === 'Hono') {
          context.report({
            node,
            messageId: 'useOpenAPIHono',
          })
        }
      },
      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'createRoute'
        ) {
          createRouteCallNodes.push(node)
        }

        if (
          node.callee &&
          node.callee.type === 'MemberExpression' &&
          node.callee.object &&
          node.callee.object.type === 'Identifier' &&
          openAPIHonoVariables.has(node.callee.object.name) &&
          node.callee.property &&
          node.callee.property.name === 'openapi'
        ) {
          context.report({
            node,
            messageId: 'standaloneOpenapiCall',
          })
        }
      },
      'Program:exit'() {
        if (openAPIHonoNode) {
          for (const createRouteNode of createRouteCallNodes) {
            if (createRouteNode.loc && openAPIHonoNode.loc) {
              if (
                createRouteNode.loc.start.line > openAPIHonoNode.loc.start.line ||
                (createRouteNode.loc.start.line === openAPIHonoNode.loc.start.line &&
                  createRouteNode.loc.start.column > openAPIHonoNode.loc.start.column)
              ) {
                context.report({
                  node: createRouteNode,
                  messageId: 'createRouteAfterOpenAPIHono',
                })
              }
            }
          }
        }
      },
    }
  },
}

export default requireHonoChainSyntax
