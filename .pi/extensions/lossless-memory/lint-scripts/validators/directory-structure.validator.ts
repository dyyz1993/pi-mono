/**
 * 目录结构验证器（增强版）
 *
 * 检查文件是否放在正确的目录中：
 * 1. 路由文件必须在 routes/ 目录
 * 2. 服务文件必须在 services/ 目录
 * 3. 测试文件必须在 __tests__/ 或 e2e/ 或 integration/ 目录
 * 4. 禁止在根目录随意放置文件
 * 5. 禁止在特定位置放置特定类型的文件
 */

import { readdirSync, existsSync } from 'node:fs'
import { join, relative, dirname, basename } from 'node:path'
import type { DirectoryStructureConfig, DirectoryError, ForbiddenError } from './index.js'
import { minimatch } from 'minimatch'

function validateFileLocation(
  filePath: string,
  rootPath: string,
  config: DirectoryStructureConfig
): { directoryErrors: DirectoryError[]; forbiddenErrors: ForbiddenError[] } {
  const directoryErrors: DirectoryError[] = []
  const forbiddenErrors: ForbiddenError[] = []
  const relativePath = relative(rootPath, filePath)
  const fileName = basename(filePath)
  const fileDir = dirname(relativePath)

  // 跳过测试目录
  if (
    relativePath.includes('e2e/') ||
    relativePath.includes('integration/') ||
    relativePath.includes('__tests__/') ||
    relativePath.includes('lint-scripts/')
  ) {
    return { directoryErrors, forbiddenErrors }
  }

  // 检查必需的目录规则
  for (const rule of config.rules) {
    if (minimatch(fileName, rule.pattern)) {
      const expectedDir = rule.requiredDir
      const isInCorrectDir = fileDir.includes(expectedDir) || fileDir.endsWith(expectedDir)

      if (!isInCorrectDir) {
        const actualDir = fileDir === '.' ? 'root' : fileDir.split('/').pop() || 'root'
        directoryErrors.push({
          file: relativePath,
          expectedDir: expectedDir,
          actualDir: actualDir,
        })
      }
    }
  }

  // 检查禁止的位置规则
  if (config.forbiddenLocations) {
    for (const forbidden of config.forbiddenLocations) {
      if (minimatch(fileName, forbidden.pattern)) {
        const isInForbiddenDir = forbidden.forbiddenDirs.some(
          forbiddenDir => fileDir === forbiddenDir || fileDir.startsWith(forbiddenDir + '/')
        )

        if (isInForbiddenDir) {
          forbiddenErrors.push({
            file: relativePath,
            message: forbidden.message,
            suggestion: forbidden.suggestion,
          })
        }
      }
    }
  }

  // 检查根目录文件
  if (config.allowedRootFiles && fileDir === '.') {
    const isAllowed = config.allowedRootFiles.some(allowedPattern =>
      minimatch(fileName, allowedPattern)
    )

    if (!isAllowed && (fileName.endsWith('.ts') || fileName.endsWith('.tsx'))) {
      // 允许配置文件
      const configFiles = ['*.config.ts', '*.config.js', '*.setup.ts', 'vite-env.d.ts']
      const isConfigFile = configFiles.some(pattern => minimatch(fileName, pattern))

      if (!isConfigFile) {
        forbiddenErrors.push({
          file: relativePath,
          message: `Source file '${fileName}' should not be in root directory`,
          suggestion: `Move to appropriate directory under src/ or scripts/`,
        })
      }
    }
  }

  return { directoryErrors, forbiddenErrors }
}

function scanDirectory(
  rootPath: string,
  config: DirectoryStructureConfig
): { directoryErrors: DirectoryError[]; forbiddenErrors: ForbiddenError[] } {
  const directoryErrors: DirectoryError[] = []
  const forbiddenErrors: ForbiddenError[] = []

  function scanDir(dir: string) {
    if (!existsSync(dir)) return

    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!config.ignoreDirs.includes(entry.name)) {
          scanDir(fullPath)
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const errors = validateFileLocation(fullPath, rootPath, config)
        directoryErrors.push(...errors.directoryErrors)
        forbiddenErrors.push(...errors.forbiddenErrors)
      }
    }
  }

  scanDir(rootPath)
  return { directoryErrors, forbiddenErrors }
}

export function validateDirectoryStructure(
  config: DirectoryStructureConfig,
  rootPath: string
): { directoryErrors: DirectoryError[]; forbiddenErrors: ForbiddenError[] } {
  return scanDirectory(rootPath, config)
}

export function formatDirectoryErrors(
  directoryErrors: DirectoryError[],
  forbiddenErrors: ForbiddenError[]
): string {
  const totalErrors = directoryErrors.length + forbiddenErrors.length
  if (totalErrors === 0) return ''

  let output = `❌ Found ${totalErrors} directory structure error(s):\n\n`

  // 格式化目录错误
  if (directoryErrors.length > 0) {
    output += `📁 Wrong Directory Location (${directoryErrors.length}):\n\n`
    for (const err of directoryErrors) {
      output += `  ${err.file}\n`
      output += `    Expected: ${err.expectedDir}/\n`
      output += `    Actual: ${err.actualDir}/\n\n`
    }
  }

  // 格式化禁止位置错误
  if (forbiddenErrors.length > 0) {
    output += `🚫 Forbidden Location (${forbiddenErrors.length}):\n\n`
    for (const err of forbiddenErrors) {
      output += `  ${err.file}\n`
      output += `    ${err.message}\n`
      output += `    Suggestion: ${err.suggestion}\n\n`
    }
  }

  output += '📋 Directory Structure Guidelines:\n\n'
  output += '  src/server/module-{feature}/\n'
  output += '    ├── routes/          # Route files (*routes*.ts)\n'
  output += '    ├── services/        # Service files (*service*.ts)\n'
  output += '    └── __tests__/       # Test files (*.test.ts)\n\n'
  output += '  src/client/\n'
  output += '    ├── services/        # Client services\n'
  output += '    ├── stores/          # State management\n'
  output += '    ├── hooks/           # React hooks\n'
  output += '    └── components/      # UI components\n\n'
  output += '  scripts/              # Build and utility scripts\n'
  output += '  e2e/                  # E2E tests\n'
  output += '  docs/                 # Documentation\n\n'
  output += '  📖 See: .claude/rules/project-rules.md\n'

  return output
}
