#!/usr/bin/env node

import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')
const HISTORY_DIR = join(PROJECT_ROOT, '.test-history')
const RUNS_DIR = join(HISTORY_DIR, 'runs')

export interface TestCaseResult {
  name: string
  file: string
  status: 'passed' | 'failed' | 'skipped'
  duration: number
  error?: string
}

export interface TestRunRecord {
  timestamp: string
  commitSha: string
  shortSha: string
  commitMessage: string
  author: string
  branch: string
  totalTests: number
  passed: number
  failed: number
  skipped: number
  duration: number
  testResults: TestCaseResult[]
  environment: {
    nodeVersion: string
    platform: string
  }
}

export interface TestHistoryIndex {
  lastUpdated: string
  totalRuns: number
  runs: Array<{
    timestamp: string
    commitSha: string
    shortSha: string
    commitMessage: string
    branch: string
    passed: number
    failed: number
    total: number
  }>
}

export interface VitestTestResult {
  name: string
  moduleName?: string
  status: 'passed' | 'failed' | 'skipped' | 'todo'
  duration: number
  errors?: Array<{ message: string }>
}

export interface VitestSuiteResult {
  name: string
  file?: string
  tests: VitestTestResult[]
  suites?: VitestSuiteResult[]
}

export interface VitestJsonReport {
  testResults: Array<{
    name: string
    assertionResults: Array<{
      ancestorTitles: string[]
      fullName: string
      status: 'passed' | 'failed' | 'skipped' | 'todo'
      duration: number
      failureMessages: string[]
    }>
    status: 'passed' | 'failed' | 'skipped'
  }>
  success: boolean
  numTotalTests: number
  numPassedTests: number
  numFailedTests: number
  numPendingTests: number
  startTime: number
}

export function getGitInfo(): {
  commitSha: string
  shortSha: string
  commitMessage: string
  author: string
  branch: string
} {
  try {
    const commitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
    const shortSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    const commitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim()
    const author = execSync('git log -1 --pretty=%an', { encoding: 'utf-8' }).trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()

    return { commitSha, shortSha, commitMessage, author, branch }
  } catch (error) {
    console.error('Failed to get git info:', error)
    return {
      commitSha: 'unknown',
      shortSha: 'unknown',
      commitMessage: 'unknown',
      author: 'unknown',
      branch: 'unknown',
    }
  }
}

export function ensureDirectories(): void {
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true })
  }
  if (!existsSync(RUNS_DIR)) {
    mkdirSync(RUNS_DIR, { recursive: true })
  }
}

export function runTestsWithJson(): VitestJsonReport | null {
  try {
    const output = execSync('npx vitest run --reporter=json --reporter=default', {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const lines = output.split('\n')
    let jsonOutput = ''

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.testResults) {
          jsonOutput = line
          break
        }
      } catch {
        continue
      }
    }

    if (jsonOutput) {
      return JSON.parse(jsonOutput)
    }

    return null
  } catch (error) {
    const err = error as { stdout?: string }
    if (err.stdout) {
      const lines = err.stdout.split('\n')
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.testResults) {
            return parsed
          }
        } catch {
          continue
        }
      }
    }
    return null
  }
}

export function parseTestResults(report: VitestJsonReport): TestCaseResult[] {
  const results: TestCaseResult[] = []

  for (const testFile of report.testResults) {
    for (const assertion of testFile.assertionResults) {
      results.push({
        name: assertion.fullName,
        file: testFile.name,
        status: assertion.status === 'todo' ? 'skipped' : assertion.status,
        duration: assertion.duration || 0,
        error:
          assertion.failureMessages && assertion.failureMessages.length > 0
            ? assertion.failureMessages.join('\n')
            : undefined,
      })
    }
  }

  return results
}

export function createTestRecord(
  report: VitestJsonReport,
  gitInfo: ReturnType<typeof getGitInfo>
): TestRunRecord {
  const testResults = parseTestResults(report)

  return {
    timestamp: new Date().toISOString(),
    commitSha: gitInfo.commitSha,
    shortSha: gitInfo.shortSha,
    commitMessage: gitInfo.commitMessage,
    author: gitInfo.author,
    branch: gitInfo.branch,
    totalTests: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests,
    duration: Date.now() - report.startTime,
    testResults,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
    },
  }
}

export function saveTestRecord(record: TestRunRecord): void {
  ensureDirectories()

  const runFile = join(RUNS_DIR, `${record.shortSha}.json`)
  writeFileSync(runFile, JSON.stringify(record, null, 2), 'utf-8')

  const latestFile = join(HISTORY_DIR, 'latest.json')
  writeFileSync(latestFile, JSON.stringify(record, null, 2), 'utf-8')

  updateIndex(record)

  console.log(`📊 Results saved to .test-history/runs/${record.shortSha}.json`)
}

export function updateIndex(record: TestRunRecord): void {
  const indexFile = join(HISTORY_DIR, 'index.json')
  let index: TestHistoryIndex

  if (existsSync(indexFile)) {
    try {
      index = JSON.parse(readFileSync(indexFile, 'utf-8'))
    } catch {
      index = { lastUpdated: '', totalRuns: 0, runs: [] }
    }
  } else {
    index = { lastUpdated: '', totalRuns: 0, runs: [] }
  }

  const existingIndex = index.runs.findIndex(r => r.commitSha === record.commitSha)
  const runEntry = {
    timestamp: record.timestamp,
    commitSha: record.commitSha,
    shortSha: record.shortSha,
    commitMessage: record.commitMessage,
    branch: record.branch,
    passed: record.passed,
    failed: record.failed,
    total: record.totalTests,
  }

  if (existingIndex >= 0) {
    index.runs[existingIndex] = runEntry
  } else {
    index.runs.unshift(runEntry)
  }

  index.lastUpdated = new Date().toISOString()
  index.totalRuns = index.runs.length

  writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf-8')
}

export function loadIndex(): TestHistoryIndex | null {
  const indexFile = join(HISTORY_DIR, 'index.json')
  if (!existsSync(indexFile)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(indexFile, 'utf-8'))
  } catch {
    return null
  }
}

export function loadRunRecord(shortSha: string): TestRunRecord | null {
  const runFile = join(RUNS_DIR, `${shortSha}.json`)
  if (!existsSync(runFile)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(runFile, 'utf-8'))
  } catch {
    return null
  }
}

export function loadLatestRecord(): TestRunRecord | null {
  const latestFile = join(HISTORY_DIR, 'latest.json')
  if (!existsSync(latestFile)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(latestFile, 'utf-8'))
  } catch {
    return null
  }
}

export function trackTests(): void {
  if (process.env.SKIP_TEST_TRACK === 'true') {
    console.log('⏭️  Test tracking skipped (SKIP_TEST_TRACK=true)')
    process.exit(0)
  }

  console.log('📝 Tracking test results for this commit...')

  const gitInfo = getGitInfo()
  console.log(`🔍 Commit: ${gitInfo.shortSha} - ${gitInfo.commitMessage}`)

  console.log('🧪 Running tests...')
  const report = runTestsWithJson()

  if (!report) {
    console.error('❌ Failed to get test results')
    process.exit(1)
  }

  const record = createTestRecord(report, gitInfo)
  saveTestRecord(record)

  const status = record.failed === 0 ? '✅' : '❌'
  console.log(
    `\n${status} Tests: ${record.passed}/${record.totalTests} passed, ${record.failed} failed`
  )
  console.log(`⏱️  Duration: ${(record.duration / 1000).toFixed(2)}s`)

  if (record.failed > 0) {
    console.log('\n❌ Failed tests:')
    for (const test of record.testResults.filter(t => t.status === 'failed')) {
      console.log(`  - ${test.name}`)
      if (test.error) {
        console.log(`    ${test.error.split('\n')[0]}`)
      }
    }
  }
}

if (process.argv[1] === __filename) {
  trackTests()
}
