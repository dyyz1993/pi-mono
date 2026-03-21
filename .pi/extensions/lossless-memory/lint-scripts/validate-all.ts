#!/usr/bin/env tsx
/**
 * 统一验证入口
 *
 * 运行所有验证器
 * 可以选择性运行特定验证器
 */

import { cwd } from 'node:process'
import { validateTodos, formatTodoErrors } from './validators/todos.validator.js'
import { validateSensitive, formatSensitiveErrors } from './validators/sensitive.validator.js'
import { validateImports, formatImportErrors } from './validators/imports.validator.js'
import { validateServerRPC, formatServerRPCErrors } from './validators/server-rpc.validator.js'
import { validateClientRPC, formatClientRPCErrors } from './validators/client-rpc.validator.js'
import {
  validateDirectoryStructure,
  formatDirectoryErrors,
} from './validators/directory-structure.validator.js'
import { validateModuleTests, formatModuleTestErrors } from './validators/module-tests.validator.js'
import {
  validateTestQuality,
  formatTestQualityErrors,
} from './validators/test-quality.validator.js'
import { validateClientTests, formatClientTestErrors } from './validators/client-tests.validator.js'
import { validateMdRefs, formatMdRefErrors } from './validators/md-refs.validator.js'
import {
  validateAPICoverage,
  formatAPICoverageErrors,
} from './validators/api-coverage.validator.js'
import { validateConsoleLog, formatConsoleLogErrors } from './validators/console-log.validator.js'
import projectConfig from './config/project.config.js'

interface ValidatorResult {
  name: string
  passed: boolean
  errors: number
}

async function runAllValidators(): Promise<ValidatorResult[]> {
  const rootPath = cwd()
  const results: ValidatorResult[] = []

  // 1. TODO 验证
  console.log('🔍 [1/12] Checking TODO/FIXME comments...')
  const todoErrors = validateTodos(projectConfig.todos, rootPath)
  results.push({
    name: 'TODO/FIXME',
    passed: todoErrors.length === 0,
    errors: todoErrors.length,
  })
  if (todoErrors.length > 0) {
    console.error(formatTodoErrors(todoErrors))
  } else {
    console.log('  ✅ No unassigned TODOs found\n')
  }

  // 2. 敏感信息验证
  console.log('🔍 [2/12] Checking for sensitive data...')
  const sensitiveErrors = await validateSensitive(projectConfig.sensitive, rootPath)
  results.push({
    name: 'Sensitive Data',
    passed: sensitiveErrors.length === 0,
    errors: sensitiveErrors.length,
  })
  if (sensitiveErrors.length > 0) {
    console.error(formatSensitiveErrors(sensitiveErrors))
  } else {
    console.log('  ✅ No sensitive data found\n')
  }

  // 3. 导入路径验证
  console.log('🔍 [3/12] Checking import paths...')
  const importErrors = validateImports(projectConfig.imports, rootPath)
  results.push({
    name: 'Import Paths',
    passed: importErrors.length === 0,
    errors: importErrors.length,
  })
  if (importErrors.length > 0) {
    console.error(formatImportErrors(importErrors))
  } else {
    console.log('  ✅ All imports are valid\n')
  }

  // 4. 服务端 RPC 验证
  console.log('🔍 [4/12] Checking server RPC patterns...')
  const serverRPCErrors = validateServerRPC(projectConfig.serverRPC, rootPath)
  results.push({
    name: 'Server RPC',
    passed: serverRPCErrors.length === 0,
    errors: serverRPCErrors.length,
  })
  if (serverRPCErrors.length > 0) {
    console.error(formatServerRPCErrors(serverRPCErrors))
  } else {
    console.log('  ✅ Server RPC patterns are valid\n')
  }

  // 5. 客户端 RPC 验证
  console.log('🔍 [5/12] Checking client RPC usage...')
  const clientRPCErrors = validateClientRPC(projectConfig.clientRPC, rootPath)
  results.push({
    name: 'Client RPC',
    passed: clientRPCErrors.length === 0,
    errors: clientRPCErrors.length,
  })
  if (clientRPCErrors.length > 0) {
    console.error(formatClientRPCErrors(clientRPCErrors))
  } else {
    console.log('  ✅ Client RPC usage is valid\n')
  }

  // 6. 目录结构验证
  console.log('🔍 [6/12] Checking directory structure...')
  const { directoryErrors, forbiddenErrors } = validateDirectoryStructure(
    projectConfig.directory,
    rootPath
  )
  const totalDirectoryErrors = directoryErrors.length + forbiddenErrors.length
  results.push({
    name: 'Directory Structure',
    passed: totalDirectoryErrors === 0,
    errors: totalDirectoryErrors,
  })
  if (totalDirectoryErrors > 0) {
    console.error(formatDirectoryErrors(directoryErrors, forbiddenErrors))
  } else {
    console.log('  ✅ Directory structure is valid\n')
  }

  // 7. 模块测试文件验证
  console.log('🔍 [7/12] Checking module test files...')
  const moduleTestErrors = validateModuleTests(projectConfig.moduleTests, rootPath)
  results.push({
    name: 'Module Tests',
    passed: moduleTestErrors.length === 0,
    errors: moduleTestErrors.length,
  })
  if (moduleTestErrors.length > 0) {
    console.error(formatModuleTestErrors(moduleTestErrors))
  } else {
    console.log('  ✅ All modules have required test files\n')
  }

  // 8. 测试质量验证
  console.log('🔍 [8/12] Checking test quality...')
  const { errors: testQualityErrors, warnings: testQualityWarnings } = validateTestQuality(
    projectConfig.testQuality,
    rootPath
  )
  const totalTestQualityIssues = testQualityErrors.length + testQualityWarnings.length
  results.push({
    name: 'Test Quality',
    passed: testQualityErrors.length === 0,
    errors: testQualityErrors.length,
  })
  if (totalTestQualityIssues > 0) {
    console.error(formatTestQualityErrors(testQualityErrors, testQualityWarnings))
  } else {
    console.log('  ✅ Test quality is good\n')
  }

  // 9. Client 测试覆盖验证
  console.log('🔍 [9/12] Checking client test coverage...')
  const clientTestErrors = validateClientTests(projectConfig.clientTests, rootPath)
  results.push({
    name: 'Client Tests',
    passed: clientTestErrors.length === 0,
    errors: clientTestErrors.length,
  })
  if (clientTestErrors.length > 0) {
    console.error(formatClientTestErrors(clientTestErrors))
  } else {
    console.log('  ✅ All client files have tests\n')
  }

  // 10. API 覆盖率验证
  console.log('🔍 [10/12] Checking API coverage...')
  const apiCoverageErrors = validateAPICoverage(projectConfig.moduleTests, rootPath)
  results.push({
    name: 'API Coverage',
    passed: apiCoverageErrors.length === 0,
    errors: apiCoverageErrors.length,
  })
  if (apiCoverageErrors.length > 0) {
    console.error(formatAPICoverageErrors(apiCoverageErrors))
  } else {
    console.log('  ✅ All APIs are covered by tests\n')
  }

  // 11. Markdown 引用路径验证
  console.log('🔍 [11/12] Checking markdown references...')
  const mdRefErrors = validateMdRefs(projectConfig.mdRefs, rootPath)
  results.push({
    name: 'Markdown References',
    passed: mdRefErrors.length === 0,
    errors: mdRefErrors.length,
  })
  if (mdRefErrors.length > 0) {
    console.error(formatMdRefErrors(mdRefErrors))
  } else {
    console.log('  ✅ All markdown references are valid\n')
  }

  // 12. Console.log 验证
  console.log('🔍 [12/12] Checking for console.log statements...')
  const consoleLogErrors = validateConsoleLog(projectConfig.consoleLog, rootPath)
  results.push({
    name: 'Console.log',
    passed: consoleLogErrors.length === 0,
    errors: consoleLogErrors.length,
  })
  if (consoleLogErrors.length > 0) {
    console.error(formatConsoleLogErrors(consoleLogErrors))
  } else {
    console.log('  ✅ No console.log statements found\n')
  }

  return results
}

async function main() {
  console.log('🚀 Running all validators...\n')

  const results = await runAllValidators()

  // 汇总结果
  const failed = results.filter(r => !r.passed)
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0)

  console.log('\n' + '='.repeat(50))
  console.log('📊 Validation Summary:')
  console.log('='.repeat(50))

  for (const result of results) {
    const status = result.passed ? '✅' : '❌'
    console.log(`  ${status} ${result.name}: ${result.errors} error(s)`)
  }

  console.log('='.repeat(50))

  if (failed.length > 0) {
    console.error(`\n❌ Validation failed with ${totalErrors} total error(s)`)
    process.exit(1)
  }

  console.log('\n✅ All validations passed!')
}

main()
