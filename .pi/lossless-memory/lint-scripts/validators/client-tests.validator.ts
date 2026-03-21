/**
 * Client 测试覆盖验证器
 *
 * 检查 client 端文件是否有对应的测试文件：
 * 1. components/*.tsx -> components/__tests__/*.test.tsx
 * 2. pages/*.tsx -> pages/__tests__/*.test.tsx
 * 3. stores/*.ts -> stores/__tests__/*.test.ts
 * 4. hooks/*.ts -> hooks/__tests__/*.test.ts
 */

import { readdirSync, existsSync } from 'node:fs'
import { join, relative, dirname, basename } from 'node:path'
import type { ClientTestsConfig, ClientTestError, ClientTestRule } from './index.js'
import { minimatch } from 'minimatch'

interface SourceFile {
  path: string
  relativePath: string
  dir: string
  name: string
}

function findSourceFiles(rootPath: string, config: ClientTestsConfig): Map<string, SourceFile[]> {
  const filesByRule = new Map<string, SourceFile[]>()

  for (const rule of config.rules) {
    filesByRule.set(rule.dir, [])
  }

  function scanDir(dir: string) {
    if (!existsSync(dir)) return

    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!config.ignoreDirs.includes(entry.name)) {
          scanDir(fullPath)
        }
      } else if (entry.isFile()) {
        const relativePath = relative(rootPath, fullPath)
        const fileDir = dirname(relativePath)
        const fileName = basename(entry.name)

        if (config.ignoreFiles.some(pattern => minimatch(relativePath, pattern))) {
          continue
        }

        for (const rule of config.rules) {
          if (fileDir === rule.dir && minimatch(fileName, rule.filePattern)) {
            const files = filesByRule.get(rule.dir) || []
            files.push({
              path: fullPath,
              relativePath,
              dir: rule.dir,
              name: fileName,
            })
            filesByRule.set(rule.dir, files)
          }
        }
      }
    }
  }

  for (const checkDir of config.checkDirs) {
    scanDir(join(rootPath, checkDir))
  }

  return filesByRule
}

function checkTestExists(sourceFile: SourceFile, rule: ClientTestRule, rootPath: string): boolean {
  const testsDir = join(rootPath, rule.dir, '__tests__')
  if (!existsSync(testsDir)) {
    return false
  }

  const testFiles = readdirSync(testsDir)
  const baseName = sourceFile.name.replace(/\.(tsx?|jsx?)$/, '')

  return testFiles.some(file => {
    const testBaseName = file.replace(/\.test\.(tsx?|jsx?)$/, '')
    return (
      testBaseName === baseName || minimatch(file, rule.testPattern.replace('{name}', baseName))
    )
  })
}

export function validateClientTests(
  config: ClientTestsConfig,
  rootPath: string
): ClientTestError[] {
  const errors: ClientTestError[] = []
  const filesByRule = findSourceFiles(rootPath, config)

  for (const rule of config.rules) {
    const files = filesByRule.get(rule.dir) || []

    for (const file of files) {
      const hasTest = checkTestExists(file, rule, rootPath)

      if (!hasTest) {
        const baseName = file.name.replace(/\.(tsx?|jsx?)$/, '')
        errors.push({
          file: file.relativePath,
          expectedTest: `${rule.dir}/__tests__/${baseName}.test.tsx`,
          suggestion: `为 ${file.relativePath} 添加测试文件: ${rule.dir}/__tests__/${baseName}.test.tsx`,
        })
      }
    }
  }

  return errors
}

export function formatClientTestErrors(errors: ClientTestError[]): string {
  if (errors.length === 0) return ''

  let output = `❌ Found ${errors.length} client file(s) without tests:\n\n`

  for (const err of errors) {
    output += `  📄 ${err.file}\n`
    output += `     Expected test: ${err.expectedTest}\n`
    output += `     Suggestion: ${err.suggestion}\n\n`
  }

  output += '📋 测试文件位置: src/client/{components,pages}/__tests__/*.test.tsx\n\n'

  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
  output += '📚 测试规范文档\n'
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
  output += '  📖 测试规范: .trae/rules/60-testing-standards.md\n'
  output += '  📖 组件规范: .trae/rules/30-client-components.md\n\n'

  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
  output += '🎯 测试价值 & 快速上手\n'
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'
  output += '  💡 为什么测试？防止回归 | 文档作用 | 重构信心\n\n'
  output += '  📝 示例:\n'
  output += "     import { render, screen } from '@testing-library/react'\n"
  output += "     import { Button } from '../Button'\n"
  output += '     \n'
  output += "     describe('Button', () => {\n"
  output += "       it('renders label', () => {\n"
  output += '         render(<Button label="Click" onClick={() => {}} />)\n'
  output += "         expect(screen.getByText('Click')).toBeInTheDocument()\n"
  output += '       })\n'
  output += '     })\n\n'

  output += '  💡 提示: 测试用户行为而非实现细节 | Mock 外部依赖\n\n'

  return output
}
