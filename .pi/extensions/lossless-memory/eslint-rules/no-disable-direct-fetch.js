/**
 * 禁止禁用 no-direct-fetch 规则
 * 确保所有前端代码都使用 apiClient 而不是直接使用 fetch
 */

export const noDisableDirectFetch = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止禁用 no-direct-fetch 规则',
      recommended: true,
    },
    messages: {
      noDisableDirectFetch:
        '🚫 禁止禁用 no-direct-fetch 规则！\n\n' +
        '直接使用 fetch 会失去类型安全，必须使用 apiClient 进行 API 调用。\n\n' +
        '📖 相关文档：\n' +
        '   - .trae/rules/31-client-services.md - 客户端服务规范\n' +
        '   - .trae/rules/10-api-type-inference.md - API 类型推导规范\n\n' +
        '💡 修复建议：\n' +
        '   1. 移除本文件的 eslint-disable 注释\n' +
        '   2. 使用 apiClient 替换 fetch 调用\n' +
        '   3. 参考文档中的示例代码',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()

    // 只对前端文件生效
    const isClientFile = filename.includes('/client/') || filename.includes('/admin/')

    if (!isClientFile) {
      return {}
    }

    return {
      Program(node) {
        for (const comment of node.comments || []) {
          const commentText = comment.value.trim()
          if (commentText.includes('eslint-disable') && commentText.includes('no-direct-fetch')) {
            context.report({
              loc: comment.loc,
              messageId: 'noDisableDirectFetch',
            })
          }
        }
      },
    }
  },
}

export default noDisableDirectFetch
