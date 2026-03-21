/**
 * 模块测试文件验证器
 *
 * 检查每个模块是否有必需的测试文件：
 * 1. 检查 __tests__/ 目录是否存在
 * 2. 检查是否有 service 测试文件
 * 3. 检查是否有 route 测试文件
 */

import { readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ModuleTestsConfig, ModuleTestError, RequiredTestFile } from './index.js'
import { minimatch } from 'minimatch'

function findModules(rootPath: string, config: ModuleTestsConfig): string[] {
  const modules: string[] = []

  function scanDir(dir: string) {
    if (!existsSync(dir)) return

    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (minimatch(entry.name, config.modulePattern)) {
          modules.push(fullPath)
        } else if (!config.ignoreDirs.includes(entry.name)) {
          scanDir(fullPath)
        }
      }
    }
  }

  for (const checkDir of config.checkDirs) {
    scanDir(join(rootPath, checkDir))
  }

  return modules
}

function checkRequiredTestFiles(
  modulePath: string,
  config: ModuleTestsConfig
): { missing: string[]; found: string[] } {
  const testsDir = join(modulePath, config.testsDir)
  const missing: string[] = []
  const found: string[] = []

  if (!existsSync(testsDir)) {
    missing.push(`${config.testsDir}/ directory`)
    return { missing, found }
  }

  const testFiles = readdirSync(testsDir).filter(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))

  for (const required of config.requiredTestFiles) {
    const hasMatch = testFiles.some(file => minimatch(file, required.pattern))
    if (hasMatch) {
      found.push(required.description)
    } else {
      missing.push(required.description)
    }
  }

  return { missing, found }
}

export function validateModuleTests(
  config: ModuleTestsConfig,
  rootPath: string
): ModuleTestError[] {
  const errors: ModuleTestError[] = []
  const modules = findModules(rootPath, config)

  for (const modulePath of modules) {
    const moduleName = relative(rootPath, modulePath)
    const { missing } = checkRequiredTestFiles(modulePath, config)

    if (missing.length > 0) {
      errors.push({
        module: moduleName,
        missingTests: missing,
        suggestion: `在 ${moduleName}/${config.testsDir}/ 目录下添加缺失的测试文件`,
      })
    }
  }

  return errors
}

export function formatModuleTestErrors(errors: ModuleTestError[]): string {
  if (errors.length === 0) return ''

  let output = `❌ Found ${errors.length} module(s) with missing test files:\n\n`

  for (const err of errors) {
    output += `  📁 ${err.module}\n`
    output += `     Missing: ${err.missingTests.join(', ')}\n`
    output += `     Suggestion: ${err.suggestion}\n\n`
  }

  output += '📋 Required Test Files per Module:\n\n'
  output += '  src/server/module-{feature}/\n'
  output += '    └── __tests__/\n'
  output += '        ├── *-service.test.ts    # Service layer tests\n'
  output += '        └── *-route*.test.ts     # Route/API tests\n\n'
  output += '  📖 Each module must have both service and route tests.\n'

  return output
}
