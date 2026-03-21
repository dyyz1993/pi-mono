/**
 * 要求 z.file() 必须指定 type 和 format
 * 避免 Internal server error: Unknown zod object type 错误
 */

export const requireFileOpenapiProps = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'z.file() 必须指定 type 和 format，使用 .openapi({ type: "string", format: "binary" })',
      recommended: true,
    },
    messages: {
      requireFileOpenapiProps:
        '🚫 z.file() 必须指定 type 和 format！\n\n' +
        '缺少 openapi 配置会导致错误：\n' +
        '"Internal server error: Unknown zod object type, please specify `type` and other OpenAPI props using `schema.openapi`"\n\n' +
        '📖 正确示例：\n' +
        '   file: z.file().openapi({ type: "string", format: "binary" })\n\n' +
        '💡 修复建议：\n' +
        '   1. 在 z.file() 后添加 .openapi({ type: "string", format: "binary" })\n' +
        '   2. 如果用于文件上传，确保包含这两个属性',
      missingTypeOrFormat:
        '🚫 z.file().openapi() 必须包含 type 和 format 属性！\n\n' +
        '📖 正确示例：\n' +
        '   file: z.file().openapi({ type: "string", format: "binary" })\n\n' +
        '💡 修复建议：\n' +
        '   确保 openapi 配置对象中包含 type: "string" 和 format: "binary"',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || ''

    // 只对 schema 文件生效
    const isSchemaFile = filename.includes('/shared/modules/') && filename.includes('/schemas.ts')
    if (!isSchemaFile) {
      return {}
    }

    return {
      CallExpression(node) {
        // 检查是否是 z.file() 调用
        if (
          node.callee?.type !== 'MemberExpression' ||
          node.callee.object?.type !== 'Identifier' ||
          node.callee.object.name !== 'z' ||
          node.callee.property?.type !== 'Identifier' ||
          node.callee.property.name !== 'file'
        ) {
          return
        }

        // 检查是否有 .openapi() 链式调用
        let currentNode = node.parent
        let hasOpenapiCall = false
        let openapiConfigNode = null

        while (currentNode) {
          if (
            currentNode.type === 'CallExpression' &&
            currentNode.callee?.type === 'MemberExpression' &&
            currentNode.callee.property?.type === 'Identifier' &&
            currentNode.callee.property.name === 'openapi'
          ) {
            hasOpenapiCall = true
            openapiConfigNode = currentNode.arguments[0]
            break
          }
          currentNode = currentNode.parent
        }

        // 如果没有 openapi 调用，报错
        if (!hasOpenapiCall) {
          context.report({
            node,
            messageId: 'requireFileOpenapiProps',
          })
          return
        }

        // 检查 openapi 配置中是否有 type 和 format
        if (openapiConfigNode && openapiConfigNode.type === 'ObjectExpression') {
          const hasType = openapiConfigNode.properties.some(
            prop =>
              prop.type === 'Property' &&
              prop.key?.type === 'Identifier' &&
              prop.key.name === 'type'
          )
          const hasFormat = openapiConfigNode.properties.some(
            prop =>
              prop.type === 'Property' &&
              prop.key?.type === 'Identifier' &&
              prop.key.name === 'format'
          )

          if (!hasType || !hasFormat) {
            context.report({
              node: openapiConfigNode,
              messageId: 'missingTypeOrFormat',
            })
          }
        }
      },
    }
  },
}

export default requireFileOpenapiProps
