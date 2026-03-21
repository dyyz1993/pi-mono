/**
 * ESLint 规则：模块边界约束
 *
 * 规则：
 * 1. client、cli、admin 三个模块之间不能存在直接引用关系
 * 2. 模块间共享代码必须通过 shared 目录
 * 3. 违规引用将报错并提示使用 shared 中转
 */

export const moduleBoundary = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce boundary between client, cli and admin modules',
      recommended: true,
    },
    messages: {
      directCrossModuleImport:
        '禁止直接在 {{fromModule}} 中引用 {{toModule}}。\n' +
        '模块间共享代码必须通过 @shared 中转。\n' +
        '解决方案：\n' +
        '1. 将共享的类型/代码放入 @shared 目录\n' +
        '2. 在 {{fromModule}} 和 {{toModule}} 中都从 @shared 导入',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()

    const modulePaths = {
      client: '/client/',
      cli: '/cli/',
      admin: '/admin/',
    }

    const moduleNames = {
      client: 'client',
      cli: 'cli',
      admin: 'admin',
    }

    function getCurrentModule(filePath) {
      for (const [moduleName, path] of Object.entries(modulePaths)) {
        if (filePath.includes(path)) {
          return moduleName
        }
      }
      return null
    }

    function getTargetModule(importPath) {
      let bestMatch = null
      let bestIndex = -1
      for (const [moduleName, path] of Object.entries(modulePaths)) {
        const idx = importPath.indexOf(path)
        if (idx !== -1 && idx > bestIndex) {
          bestIndex = idx
          bestMatch = moduleName
        }
      }
      return bestMatch
    }

    function resolveRelativePath(basePath, relativePath) {
      const normalizedBase = basePath.replace(/[^/]+$/, '')
      const parts = normalizedBase.split('/')
      const relativeParts = relativePath.split('/')

      for (const part of relativeParts) {
        if (part === '..') {
          parts.pop()
        } else if (part !== '.') {
          parts.push(part)
        }
      }
      return parts.join('/')
    }

    const currentModule = getCurrentModule(filename)
    if (!currentModule) return {}

    const otherModules = Object.keys(modulePaths).filter(m => m !== currentModule)

    return {
      ImportDeclaration(node) {
        const source = node.source
        if (!source || source.type !== 'Literal') return

        const importPath = source.value
        if (typeof importPath !== 'string') return

        if (importPath.startsWith('@shared')) {
          return
        }

        if (importPath.endsWith('.css')) {
          return
        }

        let resolvedPath = importPath
        if (importPath.startsWith('.')) {
          resolvedPath = resolveRelativePath(filename, importPath)
        }

        const targetModule = getTargetModule(resolvedPath)
        if (targetModule && otherModules.includes(targetModule)) {
          context.report({
            node,
            messageId: 'directCrossModuleImport',
            data: {
              fromModule: moduleNames[currentModule],
              toModule: moduleNames[targetModule],
            },
          })
        }
      },
    }
  },
}

export default moduleBoundary
