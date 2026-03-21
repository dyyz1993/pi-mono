export const requireResponseHelpers = {
  meta: {
    type: 'problem',
    docs: {
      description: 'HTTP 路由必须使用 successResponse/errorResponse 辅助函数定义响应',
      recommended: true,
    },
    messages: {
      requireSuccessResponse:
        'HTTP JSON 成功响应必须使用 successResponse() 辅助函数。\n' +
        '正确写法: 200: successResponse(schema, "description")\n' +
        '参考: src/server/utils/route-helpers.ts',
      requireErrorResponse:
        'HTTP JSON 错误响应必须使用 errorResponse() 辅助函数。\n' +
        '正确写法: 404: errorResponse("Not found")\n' +
        '参考: src/server/utils/route-helpers.ts',
      noDirectJsonContent:
        '禁止直接定义 application/json 响应内容。\n' +
        '使用 successResponse() 或 errorResponse() 辅助函数。\n' +
        '参考: src/server/utils/route-helpers.ts',
    },
    schema: [],
  },
  create(context) {
    const ALLOWED_CONTENT_TYPES = ['text/event-stream', 'application/octet-stream', 'websocket']
    const SUCCESS_CODES = [200, 201, 202, 204]
    const HELPER_FUNCTIONS = [
      'successResponse',
      'errorResponse',
      'listResponse',
      'deleteResponse',
      'standardResponses',
      'withNotFoundResponses',
      'createResponses',
    ]

    function isHelperCall(node) {
      if (node.type !== 'CallExpression') return false
      if (node.callee.type === 'Identifier') {
        return HELPER_FUNCTIONS.includes(node.callee.name)
      }
      if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
        return HELPER_FUNCTIONS.includes(node.callee.property.name)
      }
      return false
    }

    function isAllowedContentType(node) {
      if (node.type !== 'ObjectExpression') return false

      const contentProp = node.properties.find(p => p.key?.name === 'content')
      if (!contentProp?.value || contentProp.value.type !== 'ObjectExpression') return false

      const contentTypes = contentProp.value.properties
        .filter(p => p.key?.type === 'Literal' && typeof p.key.value === 'string')
        .map(p => p.key.value)

      return contentTypes.some(type => ALLOWED_CONTENT_TYPES.includes(type))
    }

    function hasApplicationJson(node) {
      if (node.type !== 'ObjectExpression') return false

      const contentProp = node.properties.find(p => p.key?.name === 'content')
      if (!contentProp?.value || contentProp.value.type !== 'ObjectExpression') return false

      return contentProp.value.properties.some(
        p => p.key?.type === 'Literal' && p.key.value === 'application/json'
      )
    }

    function getStatusCode(node) {
      if (node.type === 'Literal' && typeof node.value === 'number') {
        return node.value
      }
      if (node.type === 'Literal' && typeof node.value === 'string') {
        return parseInt(node.value, 10)
      }
      return null
    }

    function isSuccessCode(code) {
      return SUCCESS_CODES.includes(code)
    }

    function checkResponseProperty(prop) {
      const statusCode = getStatusCode(prop.key)
      const value = prop.value

      if (isHelperCall(value)) return

      if (isAllowedContentType(value)) return

      if (hasApplicationJson(value)) {
        context.report({
          node: value,
          messageId: 'noDirectJsonContent',
        })
        return
      }

      if (value.type === 'ObjectExpression') {
        const hasContent = value.properties.some(p => p.key?.name === 'content')
        if (!hasContent) {
          context.report({
            node: value,
            messageId:
              statusCode && isSuccessCode(statusCode)
                ? 'requireSuccessResponse'
                : 'requireErrorResponse',
          })
        }
      }
    }

    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'createRoute') return

        const arg = node.arguments[0]
        if (arg?.type !== 'ObjectExpression') return

        const responsesProp = arg.properties.find(p => p.key?.name === 'responses')
        if (!responsesProp || responsesProp.value?.type !== 'ObjectExpression') return

        responsesProp.value.properties.forEach(prop => {
          if (prop.type === 'Property') {
            checkResponseProperty(prop)
          }
        })
      },
    }
  },
}

export default requireResponseHelpers
