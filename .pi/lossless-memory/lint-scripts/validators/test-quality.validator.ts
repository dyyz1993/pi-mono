/**
 * 测试质量验证器
 *
 * 检查测试文件的质量：
 * 1. 每个测试用例的断言数量（避免断言太少）
 * 2. 错误场景覆盖（必须有错误断言）
 * 3. 边界情况覆盖
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { TestQualityConfig, TestQualityError, TestQualityWarning } from './index.js'
import { minimatch } from 'minimatch'

interface TestCase {
  name: string
  suite: string
  startLine: number
  endLine: number
  assertions: string[]
  hasErrorAssertion: boolean
  hasEdgeCaseAssertion: boolean
}

interface ParsedTestFile {
  file: string
  testCases: TestCase[]
  totalAssertions: number
  errorAssertions: number
  edgeCaseAssertions: number
}

function parseTestFile(filePath: string, config: TestQualityConfig): ParsedTestFile {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const testCases: TestCase[] = []
  let currentSuite = ''
  let currentTest: TestCase | null = null
  let braceDepth = 0
  let testStartLine = 0

  const errorPatterns = config.errorAssertionPatterns.map(p => new RegExp(p, 'i'))
  const edgeCasePatterns = config.edgeCasePatterns.map(p => new RegExp(p, 'i'))

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    const suiteMatch = line.match(/describe\s*\(\s*['"`]([^'"`]+)['"`]/)
    if (suiteMatch) {
      currentSuite = suiteMatch[1]
    }

    // Support both single-line and multi-line test definitions
    // Single-line: it('name', () => { })
    // Multi-line: it(\n  'name',\n  () => { }
    let testMatch = line.match(/(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/)

    // If no match and line ends with '(', check next line for test name
    if (!testMatch && /(?:it|test)\s*\(\s*$/.test(line)) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nextLine = lines[j].trim()
        const multiLineMatch = nextLine.match(/^['"`]([^'"`]+)['"`]/)
        if (multiLineMatch) {
          testMatch = multiLineMatch
          break
        }
      }
    }

    if (testMatch) {
      if (currentTest) {
        testCases.push(currentTest)
      }
      currentTest = {
        name: testMatch[1],
        suite: currentSuite,
        startLine: lineNum,
        endLine: lineNum,
        assertions: [],
        hasErrorAssertion: false,
        hasEdgeCaseAssertion: false,
      }
      testStartLine = lineNum
      braceDepth = 0
    }

    if (currentTest) {
      const expectMatches = line.match(/expect\s*\(/g)
      if (expectMatches) {
        for (const match of expectMatches) {
          currentTest.assertions.push(line.trim())

          const lineLower = line.toLowerCase()
          if (errorPatterns.some(p => p.test(line))) {
            currentTest.hasErrorAssertion = true
          }
          if (edgeCasePatterns.some(p => p.test(line))) {
            currentTest.hasEdgeCaseAssertion = true
          }
        }
      }

      braceDepth += (line.match(/{/g) || []).length
      braceDepth -= (line.match(/}/g) || []).length

      if (braceDepth <= 0 && line.includes('})') && lineNum > testStartLine) {
        currentTest.endLine = lineNum
        testCases.push(currentTest)
        currentTest = null
      }
    }
  }

  if (currentTest) {
    testCases.push(currentTest)
  }

  const totalAssertions = testCases.reduce((sum, t) => sum + t.assertions.length, 0)
  const errorAssertions = testCases.filter(t => t.hasErrorAssertion).length
  const edgeCaseAssertions = testCases.filter(t => t.hasEdgeCaseAssertion).length

  return {
    file: filePath,
    testCases,
    totalAssertions,
    errorAssertions,
    edgeCaseAssertions,
  }
}

function findTestFiles(rootPath: string, config: TestQualityConfig): string[] {
  const testFiles: string[] = []

  function scanDir(dir: string) {
    if (!existsSync(dir)) return

    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!config.ignoreDirs.includes(entry.name)) {
          scanDir(fullPath)
        }
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))
      ) {
        testFiles.push(fullPath)
      }
    }
  }

  for (const checkDir of config.checkDirs) {
    scanDir(join(rootPath, checkDir))
  }

  return testFiles
}

export function validateTestQuality(
  config: TestQualityConfig,
  rootPath: string
): { errors: TestQualityError[]; warnings: TestQualityWarning[] } {
  const errors: TestQualityError[] = []
  const warnings: TestQualityWarning[] = []
  const testFiles = findTestFiles(rootPath, config)

  for (const filePath of testFiles) {
    const parsed = parseTestFile(filePath, config)
    const relativePath = relative(rootPath, filePath)

    for (const testCase of parsed.testCases) {
      if (testCase.assertions.length < config.minAssertionsPerTest) {
        warnings.push({
          file: relativePath,
          testSuite: testCase.suite,
          testName: testCase.name,
          assertionCount: testCase.assertions.length,
          suggestion: `增加断言数量，当前只有 ${testCase.assertions.length} 个，建议至少 ${config.minAssertionsPerTest} 个`,
        })
      }
    }

    if (config.requireErrorAssertions && parsed.errorAssertions === 0) {
      errors.push({
        file: relativePath,
        testSuite: '',
        testName: '',
        issue: '缺少错误场景测试',
        suggestion: '添加错误场景测试，如：无效参数、边界值、异常情况等',
      })
    }

    if (config.requireEdgeCaseAssertions && parsed.edgeCaseAssertions === 0) {
      warnings.push({
        file: relativePath,
        testSuite: '',
        testName: '',
        assertionCount: 0,
        suggestion: '考虑添加边界情况测试，如：空值、最大值、最小值等',
      })
    }
  }

  return { errors, warnings }
}

export function formatTestQualityErrors(
  errors: TestQualityError[],
  warnings: TestQualityWarning[]
): string {
  const totalIssues = errors.length + warnings.length
  if (totalIssues === 0) return ''

  let output = `❌ Found ${totalIssues} test quality issue(s):\n\n`

  if (errors.length > 0) {
    output += `🚨 Errors (${errors.length}):\n\n`
    for (const err of errors) {
      output += `  📄 ${err.file}\n`
      if (err.testSuite || err.testName) {
        output += `     Test: ${err.testSuite}${err.testName ? ' > ' + err.testName : ''}\n`
      }
      output += `     Issue: ${err.issue}\n`
      output += `     Suggestion: ${err.suggestion}\n\n`
    }
  }

  if (warnings.length > 0) {
    output += `⚠️  Warnings (${warnings.length}):\n\n`
    for (const warn of warnings) {
      output += `  📄 ${warn.file}\n`
      if (warn.testSuite || warn.testName) {
        output += `     Test: ${warn.testSuite}${warn.testName ? ' > ' + warn.testName : ''}\n`
      }
      if (warn.assertionCount > 0) {
        output += `     Assertions: ${warn.assertionCount}\n`
      }
      output += `     Suggestion: ${warn.suggestion}\n\n`
    }
  }

  output += '📋 Test Quality Guidelines:\n\n'
  output += '  1. 每个测试用例至少要有 2-3 个断言\n'
  output += '  2. 必须包含错误场景测试（无效参数、异常情况）\n'
  output += '  3. 建议包含边界情况测试（空值、极值）\n\n'
  output += '  错误断言示例:\n'
  output += '    expect(res.status).toBe(400)   // 无效参数\n'
  output += '    expect(res.status).toBe(404)   // 资源不存在\n'
  output += '    expect(res.status).toBe(500)   // 服务器错误\n'
  output += '    expect(result).toBeNull()      // 空值处理\n\n'

  return output
}
