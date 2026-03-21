/**
 * 约束E2E测试文件的位置和命名
 * 1. E2E测试文件必须放在 tests/e2e/ 目录下
 * 2. E2E测试文件必须以 .spec.ts 结尾
 * 3. E2E测试文件必须使用 Playwright 的测试API
 */

export const e2eTestLocation = {
  meta: {
    type: 'problem',
    docs: {
      description: '约束E2E测试文件的位置和命名',
      recommended: true,
    },
    messages: {
      wrongLocation: 'E2E测试文件必须放在 tests/e2e/ 目录下，当前文件: {{filename}}',
      wrongExtension: 'E2E测试文件必须以 .spec.ts 结尾，当前文件: {{filename}}',
      missingTestApi: 'E2E测试文件必须使用 Playwright 的测试API (test/describe)',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    const isE2ETestFile = filename.includes('/tests/e2e/') || filename.includes('tests/e2e')
    const hasSpecExtension = filename.endsWith('.spec.ts')
    const isSpecialFile =
      filename.endsWith('playwright.config.ts') ||
      filename.endsWith('global-setup.ts') ||
      filename.endsWith('global-teardown.ts')

    return {
      Program(node) {
        if (isSpecialFile) return

        // 检查文件是否在正确的目录下
        if (!isE2ETestFile && hasSpecExtension) {
          context.report({
            node,
            messageId: 'wrongLocation',
            data: { filename },
          })
        }

        // 检查文件扩展名
        if (isE2ETestFile && !hasSpecExtension) {
          context.report({
            node,
            messageId: 'wrongExtension',
            data: { filename },
          })
        }

        // 检查是否使用了Playwright的测试API
        if (isE2ETestFile && !hasSpecExtension) {
          const hasTestApi = node.body.some(statement => {
            if (statement.type === 'ImportDeclaration') {
              return statement.source.value === '@playwright/test'
            }
            if (
              statement.type === 'ExpressionStatement' &&
              statement.expression.type === 'CallExpression'
            ) {
              const callee = statement.expression.callee
              return (
                callee.type === 'Identifier' &&
                (callee.name === 'test' || callee.name === 'describe')
              )
            }
            return false
          })

          if (!hasTestApi) {
            context.report({
              node,
              messageId: 'missingTestApi',
            })
          }
        }
      },
    }
  },
}

/**
 * 禁止在非 e2e 目录下使用 Playwright 测试API进行E2E测试
 */
export const noE2ETestOutsideDir = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止在非 e2e 目录下使用 Playwright 测试API进行E2E测试',
      recommended: true,
    },
    messages: {
      noE2ETestOutsideDir: 'E2E测试必须放在 tests/e2e/ 目录下',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    const isE2ETestFile = filename.includes('/tests/e2e/') || filename.includes('tests/e2e')
    const isSpecialFile =
      filename.endsWith('playwright.config.ts') ||
      filename.endsWith('global-setup.ts') ||
      filename.endsWith('global-teardown.ts')

    return {
      ImportDeclaration(node) {
        if (isE2ETestFile || isSpecialFile) return

        if (node.source.value === '@playwright/test') {
          context.report({
            node,
            messageId: 'noE2ETestOutsideDir',
          })
        }
      },
      CallExpression(node) {
        if (isE2ETestFile || isSpecialFile) return

        if (
          node.callee.type === 'Identifier' &&
          (node.callee.name === 'test' || node.callee.name === 'describe')
        ) {
          // 检查是否在测试文件中
          if (
            filename.endsWith('.test.ts') ||
            filename.endsWith('.test.tsx') ||
            filename.endsWith('.spec.ts')
          ) {
            // 检查是否导入了 Playwright
            let currentNode = node.parent
            while (currentNode.type !== 'Program') {
              if (
                currentNode.type === 'ImportDeclaration' &&
                currentNode.source.value === '@playwright/test'
              ) {
                context.report({
                  node,
                  messageId: 'noE2ETestOutsideDir',
                })
                break
              }
              currentNode = currentNode.parent
            }
          }
        }
      },
    }
  },
}
