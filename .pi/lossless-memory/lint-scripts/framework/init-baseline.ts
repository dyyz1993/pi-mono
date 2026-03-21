import * as fs from 'fs'
import * as path from 'path'
import { glob } from 'glob'
import {
  computeContentHash,
  extractCodeContent,
  extractBaselineInfo,
  generateHeaderComment,
  isFrameworkFile,
} from './hash-utils'

const FRAMEWORK_GLOBS = [
  'src/shared/core/**/*.ts',
  'src/server/core/**/*.ts',
  'src/server/entries/**/*.ts',
  'src/server/test-utils/**/*.ts',
  'src/server/index.ts',
  'src/client/services/**/*.ts',
  'eslint.config.js',
  'eslint-rules/**/*.js',
]

function initFile(filePath: string): {
  file: string
  baseline: string
  action: 'created' | 'skipped'
} {
  const content = fs.readFileSync(filePath, 'utf-8')
  const info = extractBaselineInfo(content)

  if (info.baseline) {
    return { file: filePath, baseline: info.baseline, action: 'skipped' }
  }

  const codeContent = extractCodeContent(content)
  const baseline = computeContentHash(codeContent)
  const header = generateHeaderComment(baseline)

  const newContent = header + '\n\n' + content
  fs.writeFileSync(filePath, newContent, 'utf-8')

  return { file: filePath, baseline, action: 'created' }
}

async function main() {
  console.log('🔧 初始化框架文件基准...\n')

  const allFiles: string[] = []

  for (const pattern of FRAMEWORK_GLOBS) {
    const files = await glob(pattern, { cwd: process.cwd() })
    allFiles.push(...files)
  }

  const frameworkFiles = allFiles.filter(f => isFrameworkFile(f))

  if (frameworkFiles.length === 0) {
    console.log('⚠️  未找到框架文件')
    return
  }

  console.log(`📁 找到 ${frameworkFiles.length} 个框架文件:\n`)

  const results: Array<{ file: string; baseline: string; action: 'created' | 'skipped' }> = []

  for (const file of frameworkFiles) {
    const result = initFile(file)
    results.push(result)

    const status = result.action === 'created' ? '✅ 已添加基准' : '⏭️  已存在基准'
    console.log(`  ${status} ${file}`)
    console.log(`     基准: ${result.baseline}\n`)
  }

  const created = results.filter(r => r.action === 'created').length
  const skipped = results.filter(r => r.action === 'skipped').length

  console.log('─'.repeat(50))
  console.log(`✨ 初始化完成！`)
  console.log(`   新增: ${created} 个文件`)
  console.log(`   跳过: ${skipped} 个文件`)
}

main().catch(console.error)
