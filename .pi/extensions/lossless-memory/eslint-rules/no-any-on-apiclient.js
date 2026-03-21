/**
 * 自定义 ESLint 规则：禁止对 apiClient 使用 `as any` 类型断言
 *
 * apiClient 是类型安全的 API 客户端，使用 `as any` 会破坏类型安全。
 * 如果类型定义有问题，应该修复服务端路由定义而不是使用 `as any`。
 *
 * 常见原因：
 * 1. 服务端路由没有使用链式语法 (new OpenAPIHono().openapi(...))
 * 2. 服务端路由没有正确导出类型
 * 3. createRoute 定义在 new OpenAPIHono() 之后
 * 4. 路由没有在 app.ts 中正确注册
 *
 * 错误示例:
 *   (apiClient.api.admin as any).permissions.roles.$get()  // ❌ 禁止
 *   apiClient.api.admin.permissions.me.$get() as any       // ❌ 禁止
 *   const client = apiClient as any                         // ❌ 禁止
 *
 * 正确示例:
 *   apiClient.api.admin.permissions.roles.$get()           // ✅ 类型安全
 *   // 如果类型有问题，修复服务端路由定义
 */

export const noAnyOnApiclient = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow `as any` type assertion on apiClient - breaks type safety',
      recommended: true,
    },
    messages: {
      noAnyOnApiclient:
        '🚫 禁止对 apiClient 使用 `as any`！\n\n' +
        '这通常意味着服务端路由定义有问题。请检查以下内容：\n\n' +
        '1. 服务端路由是否使用链式语法？\n' +
        '   ✅ new OpenAPIHono().openapi(route1, handler1).openapi(route2, handler2)\n' +
        '   ❌ const app = new OpenAPIHono(); app.openapi(route1, handler1)\n\n' +
        '2. createRoute 是否定义在 new OpenAPIHono() 之前？\n' +
        '   ✅ const route = createRoute({...}); export const routes = new OpenAPIHono().openapi(route, ...)\n' +
        '   ❌ export const routes = new OpenAPIHono(); const route = createRoute({...})\n\n' +
        '3. 路由是否在 app.ts 中正确注册？\n' +
        '   ✅ .route(\'/api\', xxxRoutes)\n\n' +
        '4. 路由是否正确导出类型？\n' +
        '   ✅ export type XxxRoutesType = typeof xxxRoutes\n\n' +
        '📖 相关文档：\n' +
        '   - .claude/rules/10-api-type-inference.md - API 类型推导规范\n' +
        '   - .claude/rules/31-client-services.md - 客户端服务使用规范\n' +
        '   - eslint-rules/require-hono-chain-syntax.js - 链式语法规则',
      noAnyOnApiclientProperty:
        '🚫 禁止对 apiClient 属性使用 `as any`！\n\n' +
        '路由 "{{property}}" 没有正确的类型定义。请检查服务端路由文件：\n\n' +
        '1. 确保路由使用链式语法：\n' +
        '   export const xxxRoutes = new OpenAPIHono()\n' +
        '     .openapi(route1, handler1)\n' +
        '     .openapi(route2, handler2)\n\n' +
        '2. 确保 createRoute 定义在 new OpenAPIHono() 之前\n\n' +
        '3. 确保路由在 app.ts 中正确注册\n\n' +
        '📖 相关文档：\n' +
        '   - .claude/rules/10-api-type-inference.md\n' +
        '   - .claude/rules/31-client-services.md',
    },
    schema: [],
  },
  create(context) {
    function isApiClientReference(node) {
      if (!node) return false

      if (node.type === 'Identifier') {
        return node.name === 'apiClient'
      }

      if (node.type === 'MemberExpression') {
        const obj = node.object
        if (obj.type === 'Identifier' && obj.name === 'apiClient') {
          return true
        }
        if (obj.type === 'MemberExpression') {
          return isApiClientReference(obj)
        }
      }

      return false
    }

    function getApiClientProperty(node) {
      if (node.type === 'MemberExpression') {
        if (node.property && node.property.type === 'Identifier') {
          return node.property.name
        }
      }
      return null
    }

    function checkTSAsExpression(node) {
      if (node.type !== 'TSAsExpression') return false

      const typeAnnotation = node.typeAnnotation
      if (!typeAnnotation) return false

      if (typeAnnotation.type === 'TSAnyKeyword') {
        return true
      }

      if (typeAnnotation.type === 'TSTypeReference') {
        const typeName = typeAnnotation.typeName
        if (typeName && typeName.type === 'Identifier' && typeName.name === 'any') {
          return true
        }
      }

      return false
    }

    return {
      TSAsExpression(node) {
        if (!checkTSAsExpression(node)) return

        const expression = node.expression

        if (isApiClientReference(expression)) {
          const property = getApiClientProperty(expression)
          context.report({
            node,
            messageId: property ? 'noAnyOnApiclientProperty' : 'noAnyOnApiclient',
            data: property ? { property } : {},
          })
          return
        }

        if (expression.type === 'MemberExpression' && isApiClientReference(expression)) {
          const property = getApiClientProperty(expression)
          context.report({
            node,
            messageId: property ? 'noAnyOnApiclientProperty' : 'noAnyOnApiclient',
            data: property ? { property } : {},
          })
        }
      },

      CallExpression(node) {
        if (!node.callee) return

        let current = node.callee
        while (current) {
          if (current.type === 'TSAsExpression') {
            if (checkTSAsExpression(current) && isApiClientReference(current.expression)) {
              const property = getApiClientProperty(current.expression)
              context.report({
                node: current,
                messageId: property ? 'noAnyOnApiclientProperty' : 'noAnyOnApiclient',
                data: property ? { property } : {},
              })
              return
            }
          }

          if (current.type === 'MemberExpression') {
            current = current.object
          } else if (current.type === 'CallExpression') {
            current = current.callee
          } else {
            break
          }
        }
      },
    }
  },
}

export default noAnyOnApiclient
