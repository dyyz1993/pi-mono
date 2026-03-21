/**
 * ESLint 规则：框架层和业务层边界约束
 *
 * 规则：
 * 1. 业务层代码不能直接修改框架层代码
 * 2. 业务层代码导入框架层代码时需要添加注释说明原因
 * 3. 框架层内部文件不能被业务层直接导入
 */

export const layerBoundary = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce boundary between framework layer and business layer',
      recommended: true,
    },
    messages: {
      modifyFrameworkCode:
        '禁止在业务层代码中修改框架层代码。框架层代码位于 shared/core/ 和 server/core/，是通用基础设施，不应被业务逻辑修改。\n' +
        '如果需要扩展功能，请：\n' +
        '1. 在业务层创建新的实现\n' +
        '2. 或者在框架层添加扩展点（需要框架维护者审批）',
      importFrameworkInternal:
        '禁止直接导入框架层内部文件。请使用公开的导出入口：\n' +
        '- @shared/core (框架层导出)\n' +
        '- @shared/schemas (统一导出)',
      missingFrameworkImportComment:
        '业务层导入框架层代码时，请添加注释说明原因。\n' +
        '示例：// @framework-import 用于 WebSocket 连接管理',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowFrameworkModification: {
            type: 'boolean',
            default: false,
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    const options = context.options[0] || {}

    const frameworkLayerPaths = ['/shared/core/', '/server/core/']

    const businessLayerPaths = ['/shared/modules/', '/server/module-', '/client/']

    const frameworkInternalFiles = [
      '/shared/core/ws-client.ts',
      '/shared/core/sse-client.ts',
      '/shared/core/api-schemas.ts',
      '/shared/core/protocol-types.ts',
      '/server/core/runtime.ts',
      '/server/core/runtime-node.ts',
      '/server/core/runtime-cloudflare.ts',
      '/server/core/realtime-core.ts',
    ]

    const isFrameworkFile = frameworkLayerPaths.some(p => filename.includes(p))
    const isBusinessFile = businessLayerPaths.some(p => filename.includes(p))

    function hasCommentAbove(node, commentTag) {
      const comments = context.sourceCode.getAllComments()
      const nodeLine = node.loc?.start.line
      if (!nodeLine) return false

      for (const comment of comments) {
        if (comment.loc && comment.loc.end.line === nodeLine - 1) {
          if (comment.value?.includes(commentTag)) {
            return true
          }
        }
      }
      return false
    }

    return {
      ImportDeclaration(node) {
        if (!isBusinessFile) return

        const source = node.source
        if (!source || source.type !== 'Literal') return

        const importPath = source.value
        if (typeof importPath !== 'string') return

        const normalizedImport = importPath
          .replace('@shared', '/shared')
          .replace('@server', '/server')

        for (const internalPath of frameworkInternalFiles) {
          if (normalizedImport.includes(internalPath.replace('.ts', ''))) {
            context.report({
              node,
              messageId: 'importFrameworkInternal',
            })
            return
          }
        }

        const isImportingFramework = frameworkLayerPaths.some(p => normalizedImport.includes(p))
        if (isImportingFramework) {
          if (!hasCommentAbove(node, '@framework-import')) {
            context.report({
              node,
              messageId: 'missingFrameworkImportComment',
            })
          }
        }
      },

      CallExpression(node) {
        if (!isBusinessFile) return
        if (options.allowFrameworkModification) return

        if (node.callee.type === 'MemberExpression') {
          const obj = node.callee.object
          if (obj.type === 'Identifier' && obj.name === 'runtime') {
            if (node.callee.property.type === 'Identifier') {
              const method = node.callee.property.name
              const dangerousMethods = ['registerRPC', 'registerEvent', 'broadcast']

              if (dangerousMethods.includes(method)) {
                if (!hasCommentAbove(node, '@framework-allow-modification')) {
                  context.report({
                    node,
                    messageId: 'modifyFrameworkCode',
                  })
                }
              }
            }
          }
        }
      },

      AssignmentExpression(node) {
        if (!isBusinessFile) return
        if (options.allowFrameworkModification) return

        if (node.left.type === 'MemberExpression') {
          const obj = node.left.object
          if (obj.type === 'Identifier' && obj.name === 'runtime') {
            if (!hasCommentAbove(node, '@framework-allow-modification')) {
              context.report({
                node,
                messageId: 'modifyFrameworkCode',
              })
            }
          }
        }
      },
    }
  },
}

export default layerBoundary
