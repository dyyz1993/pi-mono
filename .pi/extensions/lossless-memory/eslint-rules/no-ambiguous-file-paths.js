/**
 * 自定义 ESLint 规则：禁止有歧义的文件路径命名
 *
 * 禁止以下模式：
 * - core/core.ts
 * - index/index.ts
 * - service/service.ts
 * - xxx/xxx.ts (目录名与文件名相同)
 * - xxx/xxx/index.ts (嵌套重复)
 */

export const noAmbiguousFilePaths = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow ambiguous file path naming like core/core.ts or index/index.ts',
      recommended: true,
    },
    messages: {
      ambiguousFileName:
        'Ambiguous file path: "{{path}}". File name "{{fileName}}" is the same as parent directory "{{dirName}}".\n' +
        'This creates confusion when importing. Consider renaming to something more descriptive.\n' +
        'Examples:\n' +
        '  ❌ core/core.ts → ✅ core/realtime-core.ts or core/ws-core.ts\n' +
        '  ❌ service/service.ts → ✅ service/user-service.ts\n' +
        '  ❌ index/index.ts → ✅ index/main.ts or just index.ts in parent',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()

    const pathParts = filename.split(/[/\\]/)
    if (pathParts.length < 2) return {}

    const fileName = pathParts[pathParts.length - 1]
    const fileNameWithoutExt = fileName.replace(/\.ts$/, '').replace(/\.tsx$/, '').replace(/\.js$/, '')

    const parentDir = pathParts[pathParts.length - 2]

    if (fileNameWithoutExt === parentDir) {
      context.report({
        loc: { line: 1, column: 0 },
        messageId: 'ambiguousFileName',
        data: {
          path: filename,
          fileName: fileNameWithoutExt,
          dirName: parentDir,
        },
      })
    }

    return {}
  },
}

export default noAmbiguousFilePaths
