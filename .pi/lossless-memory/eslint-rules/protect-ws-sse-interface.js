/**
 * 自定义 ESLint 规则：保护 WS/SSE 客户端的核心接口
 * 禁止随意添加新的公共方法
 */

export const protectWsSseInterface = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Protect WS/SSE client public interface from unauthorized modifications',
      recommended: true,
    },
    messages: {
      forbiddenMethodAddition:
        'Adding new public methods to WSClientImpl/SSEClientImpl is not allowed.\n' +
        'The interface is defined in src/types/global.d.ts and should not be extended.\n' +
        'If you need new functionality, consider:\n' +
        '  1. Adding a private method (prefix with # or private)\n' +
        '  2. Creating a separate utility function\n' +
        '  3. Updating the global.d.ts interface first',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()

    const protectedMethods = {
      WSClientImpl: ['status', 'call', 'emit', 'on', 'onStatusChange', 'close', 'getSocket'],
      SSEClientImpl: ['status', 'on', 'onStatusChange', 'onError', 'abort'],
    }

    if (!filename.endsWith('wsClient.ts') && !filename.endsWith('sseClient.ts')) {
      return {}
    }

    return {
      MethodDefinition(node) {
        const classBody = node.parent
        const classDecl = classBody?.parent
        const className = classDecl?.id?.name

        if (!className || !protectedMethods[className]) return

        if (
          node.kind === 'method' &&
          node.accessibility !== 'private' &&
          !node.key.name.startsWith('#')
        ) {
          const methodName = node.key.name
          if (!protectedMethods[className].includes(methodName)) {
            context.report({
              node,
              messageId: 'forbiddenMethodAddition',
            })
          }
        }
      },
    }
  },
}

export default protectWsSseInterface
