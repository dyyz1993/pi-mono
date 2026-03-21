/**
 * ESLint 规则：确保所有 API 路由都有认证中间件
 *
 * 这个规则检查所有 createRoute 调用，确保：
 * 1. 每个路由都有 middleware 配置（除非是公开路由）
 * 2. middleware 中包含 authMiddleware
 * 3. 公开路由被明确标记
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure all API routes have authentication middleware',
      category: 'Security',
      recommended: true,
    },
    messages: {
      missingMiddleware:
        'Route "{{method}} {{path}}" is missing middleware configuration. Add middleware: [authMiddleware()]',
      missingAuth:
        'Route "{{method}} {{path}}" middleware does not include authMiddleware. Add authMiddleware() to middleware array',
      publicRouteWithAuth:
        'Public route "{{method}} {{path}}" should not have authentication middleware',
      missingSecurity:
        'Route "{{method}} {{path}}" is missing security configuration. Add security: [{ Bearer: [] }]',
    },
    schema: [
      {
        type: 'object',
        properties: {
          publicRoutes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                method: { type: 'string' },
              },
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const publicRoutes = context.options[0]?.publicRoutes || []

    function isPublicRoute(path, method) {
      return publicRoutes.some(
        route => route.path === path && route.method.toUpperCase() === method.toUpperCase()
      )
    }

    function checkCreateRoute(node) {
      // 检查是否是 createRoute 调用
      if (node.callee.name !== 'createRoute') {
        return
      }

      // 获取路由配置对象
      const configArg = node.arguments[0]
      if (!configArg || configArg.type !== 'ObjectExpression') {
        return
      }

      // 提取路由信息
      let method = null
      let path = null
      let hasMiddleware = false
      let hasAuthMiddleware = false
      let hasSecurity = false

      configArg.properties.forEach(prop => {
        if (prop.key?.name === 'method') {
          method = prop.value.value
        }
        if (prop.key?.name === 'path') {
          path = prop.value.value
        }
        if (prop.key?.name === 'middleware') {
          hasMiddleware = true
          // 检查 middleware 数组中是否包含 authMiddleware
          if (prop.value?.type === 'ArrayExpression') {
            prop.value.elements.forEach(element => {
              if (element?.type === 'CallExpression' && element.callee?.name === 'authMiddleware') {
                hasAuthMiddleware = true
              }
            })
          }
        }
        if (prop.key?.name === 'security') {
          hasSecurity = true
        }
      })

      // 如果没有找到 method 或 path，跳过检查
      if (!method || !path) {
        return
      }

      const isPublic = isPublicRoute(path, method)

      // 检查公开路由
      if (isPublic) {
        if (hasMiddleware && hasAuthMiddleware) {
          context.report({
            node,
            messageId: 'publicRouteWithAuth',
            data: {
              method,
              path,
            },
          })
        }
        return
      }

      // 检查非公开路由
      if (!hasMiddleware) {
        context.report({
          node,
          messageId: 'missingMiddleware',
          data: {
            method,
            path,
          },
        })
      } else if (!hasAuthMiddleware) {
        context.report({
          node,
          messageId: 'missingAuth',
          data: {
            method,
            path,
          },
        })
      }

      // 检查 security 配置
      if (!hasSecurity) {
        context.report({
          node,
          messageId: 'missingSecurity',
          data: {
            method,
            path,
          },
        })
      }
    }

    return {
      CallExpression: checkCreateRoute,
    }
  },
}
