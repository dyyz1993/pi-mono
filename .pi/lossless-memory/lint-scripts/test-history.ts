#!/usr/bin/env node

import {
  loadIndex,
  loadRunRecord,
  loadLatestRecord,
  type TestRunRecord,
  type TestCaseResult,
} from './test-tracker.js'
import { execSync } from 'child_process'

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 3) + '...'
}

function printList(): void {
  const index = loadIndex()

  if (!index || index.runs.length === 0) {
    console.log('📅 No test history found.')
    console.log('\n💡 Run some tests with tracking enabled to see history.')
    return
  }

  console.log(`📅 Test History (showing last ${Math.min(10, index.runs.length)} runs)\n`)

  console.log(' Commit  | Branch      | Tests  | Status  | Message                        | Time')
  console.log(
    '---------|-------------|--------|---------|--------------------------------|------------------'
  )

  const recentRuns = index.runs.slice(0, 10)

  for (const run of recentRuns) {
    const status = run.failed === 0 ? '✅ Pass' : `❌ ${run.failed} fail`
    const message = truncate(run.commitMessage, 30)
    const time = formatTimestamp(run.timestamp)

    console.log(
      ` ${run.shortSha} | ${run.branch.padEnd(11)} | ${String(run.passed).padStart(2)}/${String(run.total).padStart(2)} | ${status.padEnd(7)} | ${message.padEnd(30)} | ${time}`
    )
  }

  console.log(`\n📊 Total runs: ${index.totalRuns}`)
}

function printShow(sha?: string): void {
  let record: TestRunRecord | null

  if (sha) {
    record = loadRunRecord(sha)
    if (!record) {
      console.log(`❌ No test record found for commit: ${sha}`)
      return
    }
  } else {
    record = loadLatestRecord()
    if (!record) {
      console.log('❌ No test records found.')
      console.log('\n💡 Run some tests with tracking enabled first.')
      return
    }
  }

  console.log(`\n📋 Test Record: ${record.shortSha}`)
  console.log('='.repeat(60))
  console.log(`Commit:    ${record.commitSha}`)
  console.log(`Message:   ${record.commitMessage}`)
  console.log(`Author:    ${record.author}`)
  console.log(`Branch:    ${record.branch}`)
  console.log(`Time:      ${formatTimestamp(record.timestamp)}`)
  console.log(`Node:      ${record.environment.nodeVersion}`)
  console.log(`Platform:  ${record.environment.platform}`)
  console.log('')
  console.log(`Total:     ${record.totalTests}`)
  console.log(`Passed:    ${record.passed}`)
  console.log(`Failed:    ${record.failed}`)
  console.log(`Skipped:   ${record.skipped}`)
  console.log(`Duration:  ${(record.duration / 1000).toFixed(2)}s`)
  console.log('')

  const passedTests = record.testResults.filter(t => t.status === 'passed')
  const failedTests = record.testResults.filter(t => t.status === 'failed')
  const skippedTests = record.testResults.filter(t => t.status === 'skipped')

  if (failedTests.length > 0) {
    console.log('\n❌ Failed Tests:')
    for (const test of failedTests) {
      console.log(`  • ${test.name}`)
      console.log(`    File: ${test.file}`)
      if (test.error) {
        const errorLines = test.error.split('\n').slice(0, 3)
        for (const line of errorLines) {
          console.log(`    ${line}`)
        }
      }
    }
  }

  if (skippedTests.length > 0) {
    console.log('\n⏭️  Skipped Tests:')
    for (const test of skippedTests) {
      console.log(`  • ${test.name}`)
    }
  }

  if (passedTests.length > 0 && failedTests.length === 0) {
    console.log('\n✅ All tests passed!')
    console.log(`   ${passedTests.length} test(s) executed successfully.`)
  }
}

function compareRecords(sha1: string, sha2: string): void {
  const record1 = loadRunRecord(sha1)
  const record2 = loadRunRecord(sha2)

  if (!record1) {
    console.log(`❌ No test record found for commit: ${sha1}`)
    return
  }

  if (!record2) {
    console.log(`❌ No test record found for commit: ${sha2}`)
    return
  }

  console.log('\n📊 Comparing test results:')
  console.log('='.repeat(60))
  console.log(
    `  From: ${record1.shortSha} "${truncate(record1.commitMessage, 30)}" (${formatTimestamp(record1.timestamp)})`
  )
  console.log(
    `  To:   ${record2.shortSha} "${truncate(record2.commitMessage, 30)}" (${formatTimestamp(record2.timestamp)})`
  )
  console.log('')

  console.log('📈 Summary:')
  console.log(`  Tests:  ${record1.totalTests} → ${record2.totalTests}`)
  console.log(`  Passed: ${record1.passed} → ${record2.passed}`)
  console.log(`  Failed: ${record1.failed} → ${record2.failed}`)
  console.log('')

  const tests1 = new Map<string, TestCaseResult>()
  const tests2 = new Map<string, TestCaseResult>()

  for (const test of record1.testResults) {
    tests1.set(test.name, test)
  }

  for (const test of record2.testResults) {
    tests2.set(test.name, test)
  }

  const fixedTests: TestCaseResult[] = []
  const newFailures: TestCaseResult[] = []
  const newTests: TestCaseResult[] = []
  const removedTests: string[] = []

  for (const [name, test] of tests2) {
    const prevTest = tests1.get(name)
    if (!prevTest) {
      newTests.push(test)
    } else if (prevTest.status === 'failed' && test.status === 'passed') {
      fixedTests.push(test)
    } else if (prevTest.status === 'passed' && test.status === 'failed') {
      newFailures.push(test)
    }
  }

  for (const name of tests1.keys()) {
    if (!tests2.has(name)) {
      removedTests.push(name)
    }
  }

  if (fixedTests.length > 0) {
    console.log('✅ Fixed tests (now passing):')
    for (const test of fixedTests) {
      console.log(`  • ${test.name}`)
    }
    console.log('')
  }

  if (newFailures.length > 0) {
    console.log('❌ New failures:')
    for (const test of newFailures) {
      console.log(`  • ${test.name}`)
      if (test.error) {
        const errorLines = test.error.split('\n').slice(0, 2)
        for (const line of errorLines) {
          console.log(`    ${line}`)
        }
      }
    }
    console.log('')
  }

  if (newTests.length > 0) {
    console.log('🆕 New tests:')
    for (const test of newTests) {
      const status = test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️'
      console.log(`  ${status} ${test.name}`)
    }
    console.log('')
  }

  if (removedTests.length > 0) {
    console.log('🗑️  Removed tests:')
    for (const name of removedTests) {
      console.log(`  • ${name}`)
    }
    console.log('')
  }

  if (
    fixedTests.length === 0 &&
    newFailures.length === 0 &&
    newTests.length === 0 &&
    removedTests.length === 0
  ) {
    console.log('ℹ️  No significant changes detected between these commits.')
  }
}

function showFailedHistory(): void {
  const index = loadIndex()

  if (!index || index.runs.length === 0) {
    console.log('📅 No test history found.')
    return
  }

  console.log('❌ Failed Tests History\n')

  const failedByTest = new Map<
    string,
    Array<{ sha: string; message: string; time: string; error?: string }>
  >()

  for (const run of index.runs) {
    if (run.failed > 0) {
      const record = loadRunRecord(run.shortSha)
      if (record) {
        for (const test of record.testResults.filter(t => t.status === 'failed')) {
          const history = failedByTest.get(test.name) || []
          history.push({
            sha: run.shortSha,
            message: run.commitMessage,
            time: formatTimestamp(run.timestamp),
            error: test.error?.split('\n')[0],
          })
          failedByTest.set(test.name, history)
        }
      }
    }
  }

  if (failedByTest.size === 0) {
    console.log('✅ No failed tests found in history!')
    return
  }

  for (const [testName, history] of failedByTest) {
    console.log(`\n📝 ${testName}`)
    console.log(`   Failed ${history.length} time(s)`)
    console.log('   Commits:')
    for (const h of history) {
      console.log(`   • ${h.sha} - ${truncate(h.message, 40)} (${h.time})`)
      if (h.error) {
        console.log(`     Error: ${truncate(h.error, 60)}`)
      }
    }
  }
}

function getCurrentCommitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

function printUsage(): void {
  console.log(`
📖 Test History Commands

Usage:
  test-history <command> [arguments]

Commands:
  list              List all test history records (default)
  show [sha]        Show test details for a commit (default: latest)
  compare <sha1> <sha2>   Compare test results between two commits
  failed            Show all tests that have failed in history
  help              Show this help message

Examples:
  test-history list
  test-history show
  test-history show abc1234
  test-history compare abc1234 def5678
  test-history failed
`)
}

function main(): void {
  const args = process.argv.slice(2)
  const command = args[0] || 'list'

  switch (command) {
    case 'list':
    case 'ls':
      printList()
      break

    case 'show':
      printShow(args[1])
      break

    case 'compare':
    case 'diff':
      if (!args[1] || !args[2]) {
        console.log('❌ Usage: test-history compare <sha1> <sha2>')
        console.log('\n💡 Example: test-history compare abc1234 def5678')
        process.exit(1)
      }
      compareRecords(args[1], args[2])
      break

    case 'failed':
      showFailedHistory()
      break

    case 'help':
    case '--help':
    case '-h':
      printUsage()
      break

    default:
      console.log(`❌ Unknown command: ${command}`)
      printUsage()
      process.exit(1)
  }
}

main()
