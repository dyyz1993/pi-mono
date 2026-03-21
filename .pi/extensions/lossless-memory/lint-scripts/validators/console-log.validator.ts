/**
 * Console.log 检测验证器
 *
 * 检测代码中遗留的 console.log/console.debug 语句
 * 这些语句不应该出现在生产代码中
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ConsoleLogConfig, ConsoleLogError } from './index.js'

function checkFileConsoleLog(
  filePath: string,
  rootPath: string,
  config: ConsoleLogConfig
): ConsoleLogError[] {
  const content = readFileSync(filePath, 'utf-8')
  const errors: ConsoleLogError[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // 跳过注释
    if (
      trimmedLine.startsWith('//') ||
      trimmedLine.startsWith('#') ||
      trimmedLine.startsWith('/*') ||
      trimmedLine.startsWith('*')
    ) {
      continue
    }

    if (config.pattern.test(trimmedLine)) {
      if (config.excludePattern && config.excludePattern.test(trimmedLine)) {
        continue
      }

      const relativePath = relative(rootPath, filePath)
      if (config.ignorePatterns?.some(pattern => pattern.test(relativePath))) {
        continue
      }

      errors.push({
        file: relativePath,
        line: i + 1,
        message: 'console.log detected (remove before committing)',
        content: trimmedLine.substring(0, 100) + (trimmedLine.length > 100 ? '...' : ''),
      })
    }
  }

  return errors
}

function scanDirectory(
  rootPath: string,
  targetDir: string,
  config: ConsoleLogConfig
): ConsoleLogError[] {
  const errors: ConsoleLogError[] = []
  const targetPath = join(rootPath, targetDir)

  if (!existsSync(targetPath)) {
    return errors
  }

  function scanDir(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!config.ignorePatterns?.some(pattern => pattern.test(entry.name))) {
          scanDir(fullPath)
        }
      } else if (entry.isFile()) {
        const hasMatchingExtension = config.fileExtensions.some(ext => entry.name.endsWith(ext))

        if (hasMatchingExtension) {
          const fileErrors = checkFileConsoleLog(fullPath, rootPath, config)
          errors.push(...fileErrors)
        }
      }
    }
  }

  scanDir(targetPath)
  return errors
}

export function validateConsoleLog(config: ConsoleLogConfig, rootPath: string): ConsoleLogError[] {
  const allErrors: ConsoleLogError[] = []

  for (const dir of config.checkDirs) {
    const errors = scanDirectory(rootPath, dir, config)
    allErrors.push(...errors)
  }

  return allErrors
}

export function formatConsoleLogErrors(errors: ConsoleLogError[]): string {
  if (errors.length === 0) return ''

  let output = `❌ Found ${errors.length} console.log statement(s):\n\n`

  for (const err of errors) {
    output += `  ${err.file}:${err.line}:\n`
    output += `    ${err.content}\n`
    output += `    → ${err.message}\n\n`
  }

  output += '📋 Code Quality Guidelines:\n'
  output += '  - Remove console.log before committing\n'
  output += '  - Use logger utility for production logging\n'
  output += '  - Test files can use console.log for debugging\n'

  return output
}
