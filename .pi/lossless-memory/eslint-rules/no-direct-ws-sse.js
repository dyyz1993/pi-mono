/**
 * 自定义 ESLint 规则：禁止直接使用原生 WebSocket 和 EventSource
 * 强制使用类型安全的 $ws() 和 $sse() 方法
 */

export const noDirectWsSse = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct WebSocket/EventSource usage, use $ws()/$sse() instead',
      recommended: true,
    },
    messages: {
      forbiddenWebSocket:
        'Direct new WebSocket() is not allowed. Use apiClient.xxx.$ws() for type-safe WebSocket connection.\n' +
        'Example: const ws = apiClient.api.chat.ws.$ws()',
      forbiddenEventSource:
        'Direct new EventSource() is not allowed. Use apiClient.xxx.$sse() for type-safe SSE connection.\n' +
        'Example: const sse = await apiClient.api.notifications.stream.$sse()',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()

    const allowedFiles = ['wsClient.ts', 'sseClient.ts', 'ws-client.ts', 'sse-client.ts']

    if (allowedFiles.some(f => filename.endsWith(f))) {
      return {}
    }

    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier') {
          if (node.callee.name === 'WebSocket') {
            context.report({
              node,
              messageId: 'forbiddenWebSocket',
            })
          }
          if (node.callee.name === 'EventSource') {
            context.report({
              node,
              messageId: 'forbiddenEventSource',
            })
          }
        }
      },
    }
  },
}

export default noDirectWsSse
