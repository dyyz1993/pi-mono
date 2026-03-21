/**
 * API 覆盖率验证器
 *
 * 检查：
 * 1. 每个 createRoute 定义的 API 是否有对应的测试
 * 2. 每个服务层导出的函数是否有对应的测试
 *
 * 路由 -> 测试映射：
 * - getAllRolesRoute -> test("get all roles")
 * - getPermissionsRoute -> test("get all permissions")
 * - getUserPermissionsRoute -> test("get user permissions")
 *
 * 服务函数 -> 测试映射：
 * - getAllRoles() -> test("get all roles")
 * - getAllPermissions() -> test("get all permissions")
 * - getUserPermissions() -> test("get user permissions")
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ModuleTestsConfig, ModuleTestError } from './index.js'
import { minimatch } from 'minimatch'

interface Route {
  name: string
  path: string
  method: string
  line: number
}

interface ServiceFunction {
  name: string
  line: number
}

interface TestCase {
  name: string
  file: string
  line: number
}

interface CoverageResult {
  module: string
  uncoveredRoutes: Route[]
  uncoveredFunctions: ServiceFunction[]
}

// 解析路由文件，提取所有 createRoute 定义
function parseRoutes(filePath: string): Route[] {
  const content = readFileSync(filePath, 'utf-8')
  const routes: Route[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 匹配 const xxxRoute = createRoute({
    const routeMatch = line.match(/const\s+(\w+Route)\s*=\s*createRoute/)
    if (routeMatch) {
      const routeName = routeMatch[1]
      let method = ''
      let path = ''

      // 向下查找 method 和 path
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        const methodMatch = lines[j].match(/method:\s*['"](\w+)['"]/)
        if (methodMatch) {
          method = methodMatch[1]
        }

        const pathMatch = lines[j].match(/path:\s*['"]([^'"]+)['"]/)
        if (pathMatch) {
          path = pathMatch[1]
        }

        if (method && path) {
          break
        }
      }

      if (routeName && path) {
        routes.push({ name: routeName, path, method: method || 'get', line: i + 1 })
      }
    }
  }

  return routes
}

// 解析服务文件，提取所有导出的函数
function parseServiceFunctions(filePath: string): ServiceFunction[] {
  const content = readFileSync(filePath, 'utf-8')
  const functions: ServiceFunction[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 匹配 export function xxx() 或 export const xxx = 
    const funcMatch = line.match(/export\s+(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\()/)
    if (funcMatch) {
      const funcName = funcMatch[1] || funcMatch[2]

      if (funcName) {
        // 排除类型导出和测试辅助函数
        if (!funcName.startsWith('type') && !funcName.includes('Test') && !funcName.includes('Mock')) {
          functions.push({ name: funcName, line: i + 1 })
        }
      }
    }
  }

  return functions
}

// 解析测试文件，提取所有测试用例名称
function parseTestCases(filePath: string): TestCase[] {
  const content = readFileSync(filePath, 'utf-8')
  const tests: TestCase[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 匹配 it('xxx', ...) 或 test('xxx', ...) 或 describe('xxx', ...)
    const testMatch = line.match(/(?:it|test|describe)\s*\(\s*['"]([^'"]+)['"]/)
    if (testMatch) {
      const testName = testMatch[1].toLowerCase()

      tests.push({
        name: testName,
        file: filePath,
        line: i + 1,
      })
    }
  }

  return tests
}

// 检查路由是否有对应的测试
function isRouteCovered(route: Route, testCases: TestCase[]): boolean {
  const routeKeywords = [
    route.name.replace('Route', '').toLowerCase(),
    route.path.replace(/\/:id|\/:[^/]+/g, '').toLowerCase(),
    route.method.toLowerCase(),
  ]

  for (const test of testCases) {
    const testName = test.name

    // 检查测试名称是否包含路由关键词
    for (const keyword of routeKeywords) {
      // 移除特殊字符进行比较
      const cleanKeyword = keyword.replace(/[^a-z0-9]/g, '')
      const cleanTestName = testName.replace(/[^a-z0-9]/g, '')

      if (cleanTestName.includes(cleanKeyword) && cleanKeyword.length > 2) {
        return true
      }
    }
  }

  return false
}

// 检查服务函数是否有对应的测试
function isFunctionCovered(func: ServiceFunction, testCases: TestCase[]): boolean {
  const funcKeywords = [
    func.name.toLowerCase(),
    // 移除常见前缀/后缀
    func.name.replace(/^(get|create|update|delete|find|fetch)/i, '').toLowerCase(),
  ]

  for (const test of testCases) {
    const testName = test.name

    for (const keyword of funcKeywords) {
      const cleanKeyword = keyword.replace(/[^a-z0-9]/g, '')
      const cleanTestName = testName.replace(/[^a-z0-9]/g, '')

      if (cleanTestName.includes(cleanKeyword) && cleanKeyword.length > 2) {
        return true
      }
    }
  }

  return false
}

// 查找模块的测试文件
function findTestFiles(modulePath: string, testsDir: string): string[] {
  const testFiles: string[] = []
  const fullTestsDir = join(modulePath, testsDir)

  if (!existsSync(fullTestsDir)) {
    return testFiles
  }

  const entries = readdirSync(fullTestsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))) {
      testFiles.push(join(fullTestsDir, entry.name))
    }
  }

  return testFiles
}

// 检查模块的 API 覆盖率
function checkModuleCoverage(modulePath: string, testsDir: string): CoverageResult {
  const moduleName = relative(process.cwd(), modulePath)
  const uncoveredRoutes: Route[] = []
  const uncoveredFunctions: ServiceFunction[] = []

  // 查找路由文件
  const routesDir = join(modulePath, 'routes')
  let routes: Route[] = []

  if (existsSync(routesDir)) {
    const routeFiles = readdirSync(routesDir).filter(f => f.endsWith('.ts'))

    for (const routeFile of routeFiles) {
      const filePath = join(routesDir, routeFile)
      routes = routes.concat(parseRoutes(filePath))
    }
  }

  // 查找服务文件
  const servicesDir = join(modulePath, 'services')
  let functions: ServiceFunction[] = []

  if (existsSync(servicesDir)) {
    const serviceFiles = readdirSync(servicesDir).filter(f => f.endsWith('-service.ts') || f.endsWith('.ts'))

    for (const serviceFile of serviceFiles) {
      const filePath = join(servicesDir, serviceFile)
      functions = functions.concat(parseServiceFunctions(filePath))
    }
  }

  // 收集所有测试用例
  const testFiles = findTestFiles(modulePath, testsDir)
  const allTestCases: TestCase[] = []

  for (const testFile of testFiles) {
    allTestCases.push(...parseTestCases(testFile))
  }

  // 检查路由覆盖率
  for (const route of routes) {
    if (!isRouteCovered(route, allTestCases)) {
      uncoveredRoutes.push(route)
    }
  }

  // 检查函数覆盖率
  for (const func of functions) {
    if (!isFunctionCovered(func, allTestCases)) {
      uncoveredFunctions.push(func)
    }
  }

  return {
    module: moduleName,
    uncoveredRoutes,
    uncoveredFunctions,
  }
}

export function validateAPICoverage(config: ModuleTestsConfig, rootPath: string): ModuleTestError[] {
  const errors: ModuleTestError[] = []
  const modules: string[] = []

  // 查找所有模块
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

  // 检查每个模块的覆盖率
  for (const modulePath of modules) {
    const coverage = checkModuleCoverage(modulePath, config.testsDir)

    const missing: string[] = []

    if (coverage.uncoveredRoutes.length > 0) {
      missing.push(
        `${coverage.uncoveredRoutes.length} uncovered route(s): ${coverage.uncoveredRoutes.map(r => r.name).join(', ')}`
      )
    }

    if (coverage.uncoveredFunctions.length > 0) {
      missing.push(
        `${coverage.uncoveredFunctions.length} uncovered function(s): ${coverage.uncoveredFunctions.map(f => f.name).join(', ')}`
      )
    }

    if (missing.length > 0) {
      errors.push({
        module: coverage.module,
        missingTests: missing,
        suggestion: `添加缺失的测试用例覆盖以下路由和函数`,
      })
    }
  }

  return errors
}

export function formatAPICoverageErrors(errors: ModuleTestError[]): string {
  if (errors.length === 0) return ''

  let output = `❌ Found API coverage issues:\n\n`

  for (const err of errors) {
    output += `  📁 ${err.module}\n`

    for (const issue of err.missingTests) {
      output += `     ${issue}\n`
    }

    output += `     Suggestion: ${err.suggestion}\n\n`
  }

  output += `📋 How to fix:\n\n`
  output += `  1. 确保每个 createRoute 都有对应的测试用例\n`
  output += `  2. 确保每个导出的服务函数都有对应的测试用例\n`
  output += `  3. 测试名称应该包含被测对象的关键词\n\n`
  output += `  示例:\n`
  output += `    // 路由: getAllRolesRoute (path: /permissions/roles)\n`
  output += `    it('should get all roles')      // ✅ 匹配\n`
  output += `    it('get roles')                 // ✅ 匹配\n`
  output += `    it('fetch roles')               // ✅ 匹配\n\n`

  return output
}
