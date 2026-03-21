import * as fs from 'fs'
import { execSync } from 'child_process'
import {
  computeContentHash,
  computeFileHash,
  extractBaselineInfo,
  extractCodeContent,
  isFrameworkFile,
} from './hash-utils'

function getStagedFiles(): string[] {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      encoding: 'utf-8',
    })
    return output
      .split('\n')
      .filter(Boolean)
      .filter((f) => f.endsWith('.ts'))
  } catch {
    return []
  }
}

interface CheckResult {
  file: string
  status: 'ok' | 'missing-baseline' | 'modified-no-record' | 'missing-fields'
  baseline?: string
  current?: string
  missingFields?: string[]
}

function checkFile(filePath: string): CheckResult {
  const content = fs.readFileSync(filePath, 'utf-8')
  const info = extractBaselineInfo(content)

  if (!info.baseline) {
    return { file: filePath, status: 'missing-baseline' }
  }

  const currentHash = computeFileHash(filePath)

  if (currentHash === info.baseline) {
    return { file: filePath, status: 'ok', baseline: info.baseline }
  }

  if (!info.hasModify) {
    return {
      file: filePath,
      status: 'modified-no-record',
      baseline: info.baseline,
      current: currentHash || undefined,
    }
  }

  const missingFields: string[] = []
  if (!info.reason) missingFields.push('@reason')
  if (!info.impact) missingFields.push('@impact')

  if (missingFields.length > 0) {
    return {
      file: filePath,
      status: 'missing-fields',
      baseline: info.baseline,
      current: currentHash || undefined,
      missingFields,
    }
  }

  return { file: filePath, status: 'ok', baseline: info.baseline, current: currentHash || undefined }
}

function main(): void {
  const stagedFiles = getStagedFiles()
  const frameworkFiles = stagedFiles.filter(isFrameworkFile)

  if (frameworkFiles.length === 0) {
    console.log('✅ 没有框架文件被修改')
    process.exit(0)
  }

  console.log('')
  console.log('🔍 检查框架文件修改...\n')
  console.log(`发现 ${frameworkFiles.length} 个框架文件在暂存区:\n`)

  const results = frameworkFiles.map(checkFile)
  const errors: CheckResult[] = []

  for (const result of results) {
    const relativePath = result.file.replace(process.cwd() + '/', '')

    switch (result.status) {
      case 'ok':
        console.log(`  ✅ ${relativePath}`)
        break

      case 'missing-baseline':
        console.log(`  ❌ ${relativePath}`)
        console.log(`     缺少 @framework-baseline 声明`)
        console.log(`     请运行: npm run framework:init\n`)
        errors.push(result)
        break

      case 'modified-no-record':
        console.log(`  ❌ ${relativePath}`)
        console.log(`     文件已修改但未记录修改说明`)
        console.log(`     基准: ${result.baseline}`)
        console.log(`     当前: ${result.current}`)
        console.log(`     请添加注释:`)
        console.log(`     @framework-modify`)
        console.log(`     @reason [修改原因]`)
        console.log(`     @impact [影响范围]\n`)
        errors.push(result)
        break

      case 'missing-fields':
        console.log(`  ❌ ${relativePath}`)
        console.log(`     修改记录缺少必要字段: ${result.missingFields?.join(', ')}`)
        console.log(`     请补充完整注释\n`)
        errors.push(result)
        break
    }
  }

  console.log('─'.repeat(50))

  if (errors.length > 0) {
    console.log('')
    console.log('🚫 提交被阻止！')
    console.log('')
    console.log(`${errors.length} 个框架文件修改未正确记录。`)
    console.log('')
    console.log('框架文件修改需要添加说明注释，格式如下：')
    console.log('')
    console.log('/**')
    console.log(' * @framework-baseline [基准Hash]')
    console.log(' *')
    console.log(' * @framework-modify')
    console.log(' * @reason [必填] 修改原因')
    console.log(' * @impact [必填] 影响范围')
    console.log(' */')
    console.log('')
    process.exit(1)
  }

  console.log('')
  console.log('✅ 所有框架修改已正确记录，允许提交。')
  console.log('')
  process.exit(0)
}

main()
