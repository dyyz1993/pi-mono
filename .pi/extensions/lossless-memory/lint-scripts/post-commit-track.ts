#!/usr/bin/env node

import {
  trackTests,
  getGitInfo,
  ensureDirectories,
  saveTestRecord,
  createTestRecord,
  runTestsWithJson,
} from './test-tracker.js'

async function postCommitTrack(): Promise<void> {
  if (process.env.SKIP_TEST_TRACK === 'true') {
    console.log('⏭️  Test tracking skipped (SKIP_TEST_TRACK=true)')
    process.exit(0)
  }

  const gitInfo = getGitInfo()

  const branch = gitInfo.branch
  if (branch === 'main' || branch === 'master' || branch === 'develop') {
    console.log('📝 Tracking test results for this commit...')
  } else {
    console.log(`📝 Tracking test results for branch: ${branch}...`)
  }

  console.log(`🔍 Commit: ${gitInfo.shortSha} - ${gitInfo.commitMessage}`)

  console.log('🧪 Running tests...')
  const report = runTestsWithJson()

  if (!report) {
    console.error('❌ Failed to get test results')
    console.log('\n💡 This might happen if:')
    console.log('   - Tests are not configured properly')
    console.log('   - No test files exist')
    console.log('   - Test runner encountered an error')
    process.exit(0)
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
        const firstLine = test.error.split('\n')[0]
        console.log(`    ${firstLine.substring(0, 80)}${firstLine.length > 80 ? '...' : ''}`)
      }
    }
    console.log('\n💡 Run `npm run test:history:show` to see full details')
  }
}

postCommitTrack().catch(error => {
  console.error('❌ Post-commit tracking failed:', error)
  process.exit(0)
})
