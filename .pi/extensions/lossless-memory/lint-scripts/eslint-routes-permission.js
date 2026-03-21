/**
 * ESLint 规则：确保所有 API 路由都有权限配置
 *
 * 这个规则检查所有 createRoute 调用，确保：
 * 1. 每个路由都有 security 配置（除非是公开路由）
 * 2. 每个路由都有 middleware 配置（除非是公开路由）
 * 3. middleware 中包含 authMiddleware 或 permissionMiddleware
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure all API routes have permission configuration',
      category: 'Security',
      recommended: true,
    },
    messages: {
      missingSecurity:
        'Route "{{method}} {{path}}" is missing security configuration. Add security: [{ Bearer: [] }]',
      missingMiddleware:
        'Route "{{method}} {{path}}" is missing middleware configuration. Add middleware: [authMiddleware()]',
      missingAuth:
        'Route "{{method}} {{path}}" middleware does not include authMiddleware or permissionMiddleware',
      publicRouteWithoutFlag:
        'Public route "{{method}} {{path}}" should be explicitly marked with isPublic: true in route config',
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

    return {
      CallExpression(node) {
        if (node.callee.name !== 'createRoute') {
          return
        }

        const routeConfig = {}
        let hasSecurity = false
        let hasMiddleware = false
        let hasAuthMiddleware = false

        node.arguments[0]?.properties?.forEach(prop => {
          if (prop.key?.name === 'method') {
            routeConfig.method = prop.value.value
          }
          if (prop.key?.name === 'path') {
            routeConfig.path = prop.value.value
          }
          if (prop.key?.name === 'security') {
            hasSecurity = true
          }
          if (prop.key?.name === 'middleware') {
            hasMiddleware = true
            if (prop.value?.elements?.length > 0) {
              prop.value.elements.forEach(element => {
                if (
                  element.callee?.name === 'authMiddleware' ||
                  element.callee?.name === 'permissionMiddleware'
                ) {
                  hasAuthMiddleware = true
                }
              })
            }
          }
        })

        if (!routeConfig.method || !routeConfig.path) {
          return
        }

        const isPublic = isPublicRoute(routeConfig.path, routeConfig.method)

        if (isPublic) {
          if (hasSecurity || hasMiddleware) {
            context.report({
              node,
              messageId: 'publicRouteWithoutFlag',
              data: {
                method: routeConfig.method,
                path: routeConfig.path,
              },
            })
          }
          return
        }

        if (!hasSecurity) {
          context.report({
            node,
            messageId: 'missingSecurity',
            data: {
              method: routeConfig.method,
              path: routeConfig.path,
            },
          })
        }

        if (!hasMiddleware) {
          context.report({
            node,
            messageId: 'missingMiddleware',
            data: {
              method: routeConfig.method,
              path: routeConfig.path,
            },
          })
        }

        if (hasMiddleware && !hasAuthMiddleware) {
          context.report({
            node,
            messageId: 'missingAuth',
            data: {
              method: routeConfig.method,
              path: routeConfig.path,
            },
          })
        }
      },
    }
  },
}
