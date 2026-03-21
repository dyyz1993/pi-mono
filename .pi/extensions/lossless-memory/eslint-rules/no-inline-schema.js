export const noInlineSchema = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '禁止在路由文件中直接定义复杂的 Zod schema，应放在 shared/modules/{module}/schemas.ts',
      recommended: true,
    },
    messages: {
      noInlineResponseSchema: `禁止在 responses 中直接定义 Zod schema。

Schema 应定义在: src/shared/modules/{module}/schemas.ts
然后通过 import 使用。

示例：
// ❌ 错误：在 routes 文件中直接定义
responses: {
  200: {
    content: {
      'application/json': {
        schema: z.object({ id: z.string(), name: z.string() })
      }
    }
  }
}

// ✅ 正确：在 schemas.ts 中定义
// src/shared/modules/todos/schemas.ts
export const TodoSchema = z.object({
  id: z.string(),
  name: z.string(),
})

// routes/todos-routes.ts
import { TodoSchema } from '@shared/schemas'
responses: {
  200: {
    content: {
      'application/json': { schema: TodoSchema }
    }
  }
}
`,
      noInlineVariableSchema: `禁止在路由文件中定义复杂的 Zod schema 变量。

Schema 应定义在: src/shared/modules/{module}/schemas.ts
然后通过 import 使用。

示例：
// ❌ 错误
const MySchema = z.object({ id: z.string(), name: z.string() })

// ✅ 正确
import { MySchema } from '@shared/schemas'
`,
      noInlineRequestSchema: `禁止在 request 中直接定义复杂的 Zod schema。

Schema 应定义在: src/shared/modules/{module}/schemas.ts
然后通过 import 使用。

示例：
// ❌ 错误
request: {
  body: {
    content: { 'application/json': { schema: z.object({ ... }) } }
  }
}

// ✅ 正确
import { CreateTodoSchema } from '@shared/schemas'
request: {
  body: {
    content: { 'application/json': { schema: CreateTodoSchema } }
  }
}
`,
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || ''

    const isRouteFile =
      /module-.*\/routes\/.*\.ts$/.test(filename) && !filename.includes('__tests__')
    if (!isRouteFile) return {}

    const COMPLEX_SCHEMA_METHODS = [
      'object',
      'array',
      'enum',
      'union',
      'intersection',
      'record',
      'map',
      'tuple',
    ]

    const ALLOWED_INLINE_SCHEMAS = ['string', 'number', 'boolean', 'coerce']

    function isZodSchemaCall(node) {
      if (node.type !== 'CallExpression') return false
      const { callee } = node

      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'z' &&
        callee.property.type === 'Identifier'
      ) {
        return COMPLEX_SCHEMA_METHODS.includes(callee.property.name)
      }

      return false
    }

    function isInResponses(node) {
      let current = node.parent
      while (current) {
        if (
          current.type === 'Property' &&
          current.key?.type === 'Identifier' &&
          current.key.name === 'responses'
        ) {
          return true
        }
        current = current.parent
      }
      return false
    }

    function isInRequestBody(node) {
      let current = node.parent
      while (current) {
        if (
          current.type === 'Property' &&
          current.key?.type === 'Identifier' &&
          current.key.name === 'body'
        ) {
          return true
        }
        current = current.parent
      }
      return false
    }

    function isTopLevelVariable(node) {
      if (node.parent?.type !== 'VariableDeclarator') return false
      if (node.parent.parent?.type !== 'VariableDeclaration') return false
      return true
    }

    function isSimpleWrapper(node) {
      if (node.callee?.property?.name === 'array') {
        const arg = node.arguments[0]
        if (arg?.type === 'Identifier') {
          return true
        }
      }
      if (node.callee?.property?.name === 'optional') {
        const callee = node.callee?.object
        if (callee?.type === 'Identifier') {
          return true
        }
      }
      return false
    }

    function isInParamsOrQuery(node) {
      let current = node.parent
      while (current) {
        if (
          current.type === 'Property' &&
          current.key?.type === 'Identifier' &&
          (current.key.name === 'params' || current.key.name === 'query')
        ) {
          return true
        }
        current = current.parent
      }
      return false
    }

    return {
      CallExpression(node) {
        if (!isZodSchemaCall(node)) return

        if (isSimpleWrapper(node)) return

        if (isInResponses(node)) {
          context.report({
            node,
            messageId: 'noInlineResponseSchema',
          })
          return
        }

        if (isInRequestBody(node)) {
          context.report({
            node,
            messageId: 'noInlineRequestSchema',
          })
          return
        }

        if (isTopLevelVariable(node)) {
          context.report({
            node,
            messageId: 'noInlineVariableSchema',
          })
        }
      },
    }
  },
}

export default noInlineSchema
