/**
 * ESLint 规则：强制在 OpenAPI 路由中使用正确的 c.req.valid() 方法
 *
 * 根据 route definition 中的 request schema 自动推导应该使用的 valid 方法：
 * - request.body (application/json) -> c.req.valid('json') 或 c.req.valid('body')
 * - request.body (multipart/form-data) -> c.req.parseBody() 或 c.req.valid('form')
 * - request.query -> c.req.valid('query')
 * - request.params -> c.req.valid('param')
 * - request.headers -> c.req.valid('header')
 * - request.cookies -> c.req.valid('cookie')
 *
 * 同时禁止使用原始方法：c.req.json(), c.req.query(), c.req.param(), c.req.header()
 */

export const enforceValidMethod = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '强制在 OpenAPI 路由 handler 中使用 c.req.valid() 获取校验后的参数，禁止使用原始方法',
      recommended: true,
    },
    messages: {
      useValidMethod:
        "路由定义了 {{schemaType}}，请使用 c.req.valid('{{validMethod}}') 获取校验后的参数。\n" +
        '原始方法 c.req.{{originalMethod}}() 不会进行 Zod 校验，也无法获得类型推断。',
      missingValidCall:
        "路由定义了 {{schemaType}}，但 handler 中未调用 c.req.valid('{{validMethod}}')。",
      forbiddenRawMethod:
        '在 OpenAPI 路由中禁止使用 c.req.{{method}}()。\n' +
        '请根据路由定义使用对应的 c.req.valid() 方法：\n' +
        "  - body (json) -> c.req.valid('json') 或 c.req.valid('body')\n" +
        "  - body (form) -> c.req.parseBody() 或 c.req.valid('form')\n" +
        "  - query -> c.req.valid('query')\n" +
        "  - params -> c.req.valid('param')\n" +
        "  - headers -> c.req.valid('header')\n" +
        "  - cookies -> c.req.valid('cookie')",
      unusedSchema:
        "路由定义了 {{schemaType}}，但 handler 中未使用 c.req.valid('{{validMethod}}') 获取数据。",
      useParseBodyForMultipart:
        "路由定义了 multipart/form-data body，请使用 c.req.valid('form') 或 c.req.parseBody() 获取表单数据。",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || ''
    const isRouteFile =
      /module-.*\/routes\/.*\.ts$/.test(filename) && !filename.includes('__tests__')
    if (!isRouteFile) return {}

    const routeDefinitions = new Map()
    const VALID_METHOD_MAP = {
      body: ['json', 'body'],
      query: ['query'],
      params: ['param'],
      headers: ['header'],
      cookies: ['cookie'],
      form: ['form'],
    }

    const SCHEMA_TYPE_NAMES = {
      body: 'request.body',
      query: 'request.query',
      params: 'request.params',
      headers: 'request.headers',
      cookies: 'request.cookies',
    }

    function extractRequestSchemas(routeNode) {
      const schemas = new Set()
      const bodyContentTypes = new Set()

      if (!routeNode || routeNode.type !== 'ObjectExpression') return { schemas, bodyContentTypes }

      const requestProp = routeNode.properties.find(
        p => p.key?.type === 'Identifier' && p.key.name === 'request'
      )

      if (!requestProp || requestProp.value?.type !== 'ObjectExpression')
        return { schemas, bodyContentTypes }

      for (const prop of requestProp.value.properties) {
        if (prop.key?.type === 'Identifier') {
          const key = prop.key.name
          if (['body', 'query', 'params', 'headers', 'cookies'].includes(key)) {
            schemas.add(key)
          }
          if (key === 'body' && prop.value?.type === 'ObjectExpression') {
            const contentProp = prop.value.properties.find(
              p => p.key?.type === 'Identifier' && p.key.name === 'content'
            )
            if (contentProp?.value?.type === 'ObjectExpression') {
              for (const contentKey of contentProp.value.properties) {
                if (
                  contentKey.key?.type === 'Literal' &&
                  typeof contentKey.key.value === 'string'
                ) {
                  bodyContentTypes.add(contentKey.key.value)
                }
              }
            }
          }
        }
      }

      return { schemas, bodyContentTypes }
    }

    function checkOpenapiHandler(node, routeArg, handlerArg) {
      let schemas = new Set()
      let bodyContentTypes = new Set()

      if (routeArg.type === 'Identifier') {
        const routeInfo = routeDefinitions.get(routeArg.name)
        if (routeInfo) {
          schemas = routeInfo.schemas
          bodyContentTypes = routeInfo.bodyContentTypes
        }
      } else if (routeArg.type === 'ObjectExpression') {
        const extracted = extractRequestSchemas(routeArg)
        schemas = extracted.schemas
        bodyContentTypes = extracted.bodyContentTypes
      }

      if (schemas.size === 0) return

      const handlerText = context.sourceCode.getText(handlerArg)
      const usedValidMethods = new Set()
      const validMethodRegex = /c\.req\.valid\s*\(\s*['"](\w+)['"]\s*\)/g
      let match
      while ((match = validMethodRegex.exec(handlerText)) !== null) {
        usedValidMethods.add(match[1])
      }

      const hasParseBody = /c\.req\.parseBody\s*\(/.test(handlerText)

      const rawMethodRegex = /c\.req\.(json|query|param|header|cookie)\s*\(/g
      const rawMethodsUsed = new Set()
      while ((match = rawMethodRegex.exec(handlerText)) !== null) {
        rawMethodsUsed.add(match[1])
      }

      if (rawMethodsUsed.size > 0) {
        for (const method of rawMethodsUsed) {
          context.report({
            node: handlerArg,
            messageId: 'forbiddenRawMethod',
            data: { method },
          })
        }
        return
      }

      const isMultipartFormData = Array.from(bodyContentTypes).some(type =>
        type.startsWith('multipart/form-data')
      )

      for (const schema of schemas) {
        if (schema === 'body' && isMultipartFormData) {
          if (!hasParseBody && !usedValidMethods.has('form')) {
            context.report({
              node: handlerArg,
              messageId: 'useParseBodyForMultipart',
            })
          }
        } else {
          const validMethods = VALID_METHOD_MAP[schema] || []
          const isUsed = validMethods.some(m => usedValidMethods.has(m))

          if (!isUsed) {
            context.report({
              node: handlerArg,
              messageId: 'unusedSchema',
              data: {
                schemaType: SCHEMA_TYPE_NAMES[schema],
                validMethod: validMethods[0],
              },
            })
          }
        }
      }
    }

    return {
      CallExpression(node) {
        if (
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'createRoute' &&
          node.arguments.length > 0 &&
          node.parent?.type === 'VariableDeclarator'
        ) {
          const routeName = node.parent.id?.name
          if (routeName) {
            const extracted = extractRequestSchemas(node.arguments[0])
            if (extracted.schemas.size > 0) {
              routeDefinitions.set(routeName, extracted)
            }
          }
        }

        if (
          node.callee?.type === 'MemberExpression' &&
          node.callee.property?.name === 'openapi' &&
          node.arguments.length >= 2
        ) {
          checkOpenapiHandler(node, node.arguments[0], node.arguments[1])
        }
      },
    }
  },
}

export default enforceValidMethod
