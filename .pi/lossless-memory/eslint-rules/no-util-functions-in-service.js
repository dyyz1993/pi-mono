/**
 * 自定义 ESLint 规则：禁止在业务文件中定义工具函数
 *
 * 工具函数应该放在 utils 目录中，而不是业务文件中
 * 适用文件：
 * - services/*-service.ts
 * - routes/*-routes.ts
 * - handlers/*.ts
 * - stores/*.ts
 */

export const noUtilFunctionsInService = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow utility functions in business files. Move them to utils directory.',
      recommended: true,
    },
    messages: {
      utilFunctionInBusiness:
        'Utility function "{{functionName}}" should be moved to utils directory.\n' +
        'Business files should focus on domain logic, not utility functions.\n' +
        'Create a new file in src/server/utils/ or add to an existing utility file.\n' +
        'Example: src/server/utils/date.ts, src/server/utils/format.ts, src/server/utils/validate.ts',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()

    const isBusinessFile =
      (filename.includes('/services/') && filename.endsWith('-service.ts')) ||
      (filename.includes('/routes/') && filename.endsWith('-routes.ts')) ||
      (filename.includes('/handlers/') && filename.endsWith('.ts')) ||
      (filename.includes('/stores/') && filename.endsWith('-store.ts'))

    if (!isBusinessFile) {
      return {}
    }

    const utilFunctionPatterns = [
      /^to[A-Z]/,
      /^format[A-Z]/,
      /^parse[A-Z]/,
      /^convert[A-Z]/,
      /^generate[A-Z]/,
      /^validate[A-Z]/,
      /^sanitize[A-Z]/,
      /^transform[A-Z]/,
      /^normalize[A-Z]/,
      /^encode[A-Z]/,
      /^decode[A-Z]/,
      /^serialize[A-Z]/,
      /^deserialize[A-Z]/,
      /^camelCase$/,
      /^snakeCase$/,
      /^kebabCase$/,
      /^capitalize$/,
      /^truncate$/,
      /^debounce$/,
      /^throttle$/,
      /^deepClone$/,
      /^deepEqual$/,
      /^isObject$/,
      /^isArray$/,
      /^isString$/,
      /^isNumber$/,
      /^isBoolean$/,
      /^isNull$/,
      /^isUndefined$/,
      /^isEmpty$/,
      /^toISOString$/,
      /^fromISOString$/,
      /^formatDate$/,
      /^parseDate$/,
      /^getTimestamp$/,
      /^slugify$/,
      /^escapeHtml$/,
      /^unescapeHtml$/,
      /^trim$/,
      /^clamp$/,
      /^range$/,
      /^unique$/,
      /^flatten$/,
      /^groupBy$/,
      /^sortBy$/,
      /^filterBy$/,
      /^findBy$/,
      /^pick$/,
      /^omit$/,
      /^merge$/,
      /^clone$/,
      /^isEqual$/,
      /^hashPassword$/,
      /^verifyPassword$/,
      /^generateToken$/,
      /^verifyToken$/,
      /^encrypt$/,
      /^decrypt$/,
    ]

    return {
      FunctionDeclaration(node) {
        if (!node.id || !node.id.name) return

        const functionName = node.id.name

        const isUtilFunction = utilFunctionPatterns.some(pattern => pattern.test(functionName))

        if (isUtilFunction) {
          context.report({
            node,
            messageId: 'utilFunctionInBusiness',
            data: {
              functionName,
            },
          })
        }
      },
    }
  },
}

export default noUtilFunctionsInService
