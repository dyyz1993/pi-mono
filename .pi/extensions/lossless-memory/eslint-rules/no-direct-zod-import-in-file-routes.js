/**
 * 禁止在 file-routes.ts 中直接从 'zod' 导入 z
 * 必须使用 '@hono/zod-openapi' 提供的 z
 */

export const noDirectZodImportInFileRoutes = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止在 file-routes.ts 中直接从 zod 导入 z，必须使用 @hono/zod-openapi',
      recommended: true,
    },
    messages: {
      noDirectZodImport:
        '禁止在此文件中直接从 "zod" 导入 z。请使用 "import { z } from \'@hono/zod-openapi\'"',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()

    // 只检查 file-routes.ts 文件
    if (!filename.endsWith('file-routes.ts')) {
      return {}
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value

        // 检查是否从 'zod' 导入
        if (source === 'zod') {
          // 检查是否导入了 z
          const hasZImport = node.specifiers.some(
            specifier =>
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier' &&
              specifier.imported.name === 'z'
          )

          if (hasZImport) {
            context.report({
              node,
              messageId: 'noDirectZodImport',
            })
          }
        }
      },
    }
  },
}
