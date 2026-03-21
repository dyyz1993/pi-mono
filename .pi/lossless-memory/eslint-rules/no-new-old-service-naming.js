/**
 * 禁止使用 "干new" 或 "干old" 的服务命名方式
 * 应该使用 V1, V2, V3 等版本号命名
 */

export const noNewOldServiceNaming = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止使用 "干new" 或 "干old" 的服务命名方式，应该使用 V1, V2, V3 等版本号',
      recommended: true,
    },
    messages: {
      noNewOldInFilename:
        '禁止在文件名中使用 "new" 或 "old" 来区分服务版本。请使用 V1, V2, V3 等版本号命名，如 permission-service-V1.ts',
      noNewOldInContent:
        '禁止在代码中使用 "干new" 或 "干old"。请使用 V1, V2, V3 等版本号来管理服务版本',
      noNewOldSuffix: '禁止使用 "-new" 或 "-old" 后缀。请使用 V1, V2, V3 等版本号命名',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    const basename = filename.split('/').pop() || ''

    // 检查文件名
    const invalidFilenamePatterns = [
      { pattern: /[-.]new[.-]/i, messageId: 'noNewOldInFilename' },
      { pattern: /[-.]old[.-]/i, messageId: 'noNewOldInFilename' },
      { pattern: /new[-.]/i, messageId: 'noNewOldSuffix' },
      { pattern: /old[-.]/i, messageId: 'noNewOldSuffix' },
    ]

    for (const { pattern, messageId } of invalidFilenamePatterns) {
      if (pattern.test(basename)) {
        // 排除合法的版本号命名（如 V1, V2, V3）
        const hasValidVersion = /V\d+/i.test(basename)
        if (!hasValidVersion) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId,
          })
          break
        }
      }
    }

    return {
      // 检查字符串字面量中的 "干new" 或 "干old"
      Literal(node) {
        if (typeof node.value === 'string') {
          const content = node.value
          if (content.includes('干new') || content.includes('干old')) {
            context.report({
              node,
              messageId: 'noNewOldInContent',
            })
          }
        }
      },

      // 检查注释中的 "干new" 或 "干old"
      Program(node) {
        const sourceCode = context.sourceCode || (context.getSourceCode && context.getSourceCode())
        if (!sourceCode) return

        const comments = sourceCode.getAllComments ? sourceCode.getAllComments() : []

        for (const comment of comments) {
          if (comment.value.includes('干new') || comment.value.includes('干old')) {
            context.report({
              node: comment,
              messageId: 'noNewOldInContent',
            })
          }
        }
      },

      // 检查标识符命名中的 new/old（排除合法的版本号命名）
      Identifier(node) {
        const name = node.name

        // 检查是否包含 new 或 old（不区分大小写）
        const hasNew = /new/i.test(name)
        const hasOld = /old/i.test(name)

        if (hasNew || hasOld) {
          // 检查是否有合法的版本号（V1, V2, V3 等）
          const hasValidVersion = /V\d+/i.test(name)

          // 如果包含 new/old 但没有合法的版本号，则报错
          if (!hasValidVersion) {
            // 排除一些常见的合法用法
            const allowedPatterns = [
              /^new[A-Z]/, // new 作为前缀且后面跟大写字母（如 newUser）
              /^renew/i, // renew 相关
            ]

            const isAllowed = allowedPatterns.some(pattern => pattern.test(name))

            if (
              !isAllowed &&
              (name.toLowerCase().includes('-new') ||
                name.toLowerCase().includes('-old') ||
                name.toLowerCase().includes('new-') ||
                name.toLowerCase().includes('old-') ||
                name.toLowerCase().includes('_new') ||
                name.toLowerCase().includes('_old'))
            ) {
              context.report({
                node,
                messageId: 'noNewOldSuffix',
              })
            }
          }
        }
      },
    }
  },
}
