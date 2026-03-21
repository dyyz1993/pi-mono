/**
 * 约束中间件的位置和写法
 * 1. 中间件必须放在 src/server/middleware/ 目录下
 * 2. 中间件文件必须导出命名函数，函数名以 Middleware 结尾
 * 3. 辅助函数（如 getAuthUser）不以 Middleware 结尾是允许的
 * 4. 私有方法（以 _ 开头）不以 Middleware 结尾是允许的
 */

const HELPER_FUNCTIONS = ['getAuthUser', 'requireAuth', 'hasPermission']

function isPrivateMethod(name) {
  return name.startsWith('_')
}

export const middlewareLocation = {
  meta: {
    type: 'problem',
    docs: {
      description: '约束中间件的位置和写法',
      recommended: true,
    },
    messages: {
      wrongLocation: '中间件必须放在 src/server/middleware/ 目录下，当前文件: {{filename}}',
      missingExport: '中间件文件必须导出以 Middleware 结尾的命名函数',
      invalidName: '中间件函数名必须以 Middleware 结尾，当前名称: {{name}}',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    const isMiddlewareFile = filename.includes('/middleware/') && filename.endsWith('.ts')
    const isTestFile = filename.includes('/__tests__/')

    return {
      ExportNamedDeclaration(node) {
        if (!isMiddlewareFile || isTestFile) return

        if (node.declaration?.type === 'FunctionDeclaration') {
          const name = node.declaration.id?.name
          if (
            name &&
            !name.endsWith('Middleware') &&
            !HELPER_FUNCTIONS.includes(name) &&
            !isPrivateMethod(name)
          ) {
            context.report({
              node: node.declaration,
              messageId: 'invalidName',
              data: { name },
            })
          }
        }

        if (node.declaration?.type === 'VariableDeclaration') {
          for (const decl of node.declaration.declarations) {
            if (decl.id.type === 'Identifier') {
              const name = decl.id.name
              if (
                !name.endsWith('Middleware') &&
                !HELPER_FUNCTIONS.includes(name) &&
                !isPrivateMethod(name)
              ) {
                context.report({
                  node: decl,
                  messageId: 'invalidName',
                  data: { name },
                })
              }
            }
          }
        }
      },

      Program(node) {
        if (!isMiddlewareFile || isTestFile) return

        const hasMiddlewareExport = node.body.some(statement => {
          if (statement.type === 'ExportNamedDeclaration') {
            if (statement.declaration?.type === 'FunctionDeclaration') {
              const name = statement.declaration.id?.name
              return (
                name?.endsWith('Middleware') ||
                HELPER_FUNCTIONS.includes(name) ||
                isPrivateMethod(name)
              )
            }
            if (statement.declaration?.type === 'VariableDeclaration') {
              return statement.declaration.declarations.some(decl => {
                if (decl.id.type === 'Identifier') {
                  const name = decl.id.name
                  return (
                    name.endsWith('Middleware') ||
                    HELPER_FUNCTIONS.includes(name) ||
                    isPrivateMethod(name)
                  )
                }
                return false
              })
            }
          }
          return false
        })

        if (!hasMiddlewareExport) {
          context.report({
            node,
            messageId: 'missingExport',
          })
        }
      },
    }
  },
}

/**
 * 禁止在非 middleware 目录下定义中间件
 */
export const noMiddlewareOutsideDir = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止在非 middleware 目录下定义中间件',
      recommended: true,
    },
    messages: {
      noMiddlewareOutsideDir: '中间件定义必须放在 src/server/middleware/ 目录下',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    const isMiddlewareFile = filename.includes('/middleware/')
    const isTestFile = filename.includes('/__tests__/')

    return {
      VariableDeclaration(node) {
        if (isMiddlewareFile || isTestFile) return

        for (const decl of node.declarations) {
          if (decl.id.type === 'Identifier' && decl.id.name.endsWith('Middleware')) {
            context.report({
              node,
              messageId: 'noMiddlewareOutsideDir',
            })
          }
        }
      },
      FunctionDeclaration(node) {
        if (isMiddlewareFile || isTestFile) return

        if (node.id?.name?.endsWith('Middleware')) {
          context.report({
            node,
            messageId: 'noMiddlewareOutsideDir',
          })
        }
      },
    }
  },
}
