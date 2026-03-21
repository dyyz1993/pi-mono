/**
 * 禁止直接使用 fetch/axios/ajax 等 HTTP 请求方式，强制使用 apiClient
 *
 * 原因：
 * 1. apiClient 提供完整的类型推导
 * 2. 统一处理 WebSocket 和 SSE 连接
 * 3. 便于添加请求拦截器（认证、日志等）
 * 4. 保证 API 调用的一致性和可维护性
 *
 * 参考: .claude/rules/31-client-services.md
 *
 * 后端路由编写参考: .claude/rules/20-server-api.md
 */

export const noDirectFetch = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止直接使用 fetch/axios/ajax 等 HTTP 请求，应使用 apiClient',
      recommended: true,
    },
    messages: {
      noDirectFetch:
        '禁止直接使用 HTTP 请求方式。请使用 apiClient 进行类型安全的 API 调用。\n\n' +
        '参考文档:\n' +
        '  - 前端: .claude/rules/31-client-services.md\n' +
        '  - 后端: .claude/rules/20-server-api.md\n\n' +
        '// ❌ 错误\n' +
        "fetch('/api/items')\n" +
        "window.fetch('/api/items')\n" +
        "axios.get('/api/items')\n" +
        "$.ajax({ url: '/api/items' })\n" +
        'new XMLHttpRequest()\n\n' +
        '// ✅ 正确 - 前端调用\n' +
        "import { apiClient } from '@client/services/apiClient'\n" +
        'const response = await apiClient.api.items.$get()\n\n' +
        '// ✅ 正确 - 后端路由 (参考 20-server-api.md)\n' +
        "import { createRoute } from 'hono-openapi'\n" +
        'const listRoute = createRoute({\n' +
        "  method: 'get',\n" +
        "  path: '/items',\n" +
        '  responses: { 200: successResponse(ItemListSchema) },\n' +
        '})',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    const isTestFile = filename.includes('.test.') || filename.includes('/__tests__/')
    const isServerFile = filename.includes('/server/')
    const isInterceptorFile =
      filename.includes('requestInterceptor') || filename.includes('apiClient')
    const isCaptchaFile = filename.includes('CaptchaModal') || filename.includes('captcha')

    if (isTestFile || isServerFile || isInterceptorFile || isCaptchaFile) {
      return {}
    }

    return {
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          context.report({
            node,
            messageId: 'noDirectFetch',
          })
        }

        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'window' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'fetch'
        ) {
          context.report({
            node,
            messageId: 'noDirectFetch',
          })
        }

        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'axios' &&
          node.callee.property.type === 'Identifier'
        ) {
          context.report({
            node,
            messageId: 'noDirectFetch',
          })
        }

        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === '$' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'ajax'
        ) {
          context.report({
            node,
            messageId: 'noDirectFetch',
          })
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'XMLHttpRequest') {
          context.report({
            node,
            messageId: 'noDirectFetch',
          })
        }
      },
    }
  },
}

export default noDirectFetch
