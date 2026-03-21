import * as fs from 'fs'
import * as path from 'path'
import { glob } from 'glob'
import {
  computeContentHash,
  extractCodeContent,
  extractBaselineInfo,
  isFrameworkFile,
  updateFileBaseline,
} from './hash-utils'

const FRAMEWORK_GLOBS = [
  'src/shared/core/**/*.ts',
  'src/server/core/**/*.ts',
  'src/server/entries/**/*.ts',
  'src/server/test-utils/**/*.ts',
  'src/server/index.ts',
  'src/client/services/**/*.ts',
]

const HISTORY_FILE = 'FRAMEWORK_HISTORY.md'

interface ChangeRecord {
  file: string
  oldBaseline: string
  newBaseline: string
  reason: string | null
  impact: string | null
  approvedBy: string | null
}

function appendToHistory(records: ChangeRecord[]): void {
  const timestamp = new Date().toISOString().split('T')[0]

  let historyContent = ''

  if (fs.existsSync(HISTORY_FILE)) {
    historyContent = fs.readFileSync(HISTORY_FILE, 'utf-8')
  } else {
    historyContent = `# 框架文件修改历史

本文件记录所有框架层代码的修改历史。

框架层路径：
- \`src/shared/core/\`
- \`src/server/core/\`
- \`src/server/entries/\`
- \`src/server/test-utils/\`
- \`src/server/index.ts\`
- \`src/client/services/\`

---

| 日期 | 文件 | 基准变更 | 修改原因 | 影响范围 | 审批人 |
|------|------|----------|----------|----------|--------|
`
  }

  const newRows = records
    .filter((r) => r.reason)
    .map((r) => {
      const relativePath = r.file.replace(process.cwd() + '/', '')
      return `| ${timestamp} | ${relativePath} | ${r.oldBaseline} → ${r.newBaseline} | ${r.reason || '-'} | ${r.impact || '-'} | ${r.approvedBy || '-'} |`
    })
    .join('\n')

  if (newRows) {
    historyContent = historyContent.trimEnd() + '\n' + newRows + '\n'
    fs.writeFileSync(HISTORY_FILE, historyContent, 'utf-8')
  }
}

async function main() {
  console.log('🔄 更新框架文件基准...\n')

  const allFiles: string[] = []

  for (const pattern of FRAMEWORK_GLOBS) {
    const files = await glob(pattern, { cwd: process.cwd() })
    allFiles.push(...files)
  }

  const frameworkFiles = allFiles.filter((f) => isFrameworkFile(f))

  if (frameworkFiles.length === 0) {
    console.log('⚠️  未找到框架文件')
    return
  }

  const changes: ChangeRecord[] = []
  let updatedCount = 0
  let unchangedCount = 0

  for (const file of frameworkFiles) {
    const content = fs.readFileSync(file, 'utf-8')
    const info = extractBaselineInfo(content)

    if (!info.baseline) {
      console.log(`⏭️  跳过 ${file} (无基准)`)
      continue
    }

    const codeContent = extractCodeContent(content)
    const newBaseline = computeContentHash(codeContent)

    if (newBaseline === info.baseline) {
      unchangedCount++
      continue
    }

    if (!info.hasModify) {
      console.log(`⚠️  ${file} 已修改但未记录修改说明，跳过更新`)
      console.log(`   请先添加 @framework-modify 和 @reason/@impact 注释\n`)
      continue
    }

    updateFileBaseline(file, newBaseline)
    updatedCount++

    changes.push({
      file,
      oldBaseline: info.baseline,
      newBaseline,
      reason: info.reason,
      impact: info.impact,
      approvedBy: info.approvedBy,
    })

    console.log(`✅ ${file}`)
    console.log(`   ${info.baseline} → ${newBaseline}`)
    if (info.reason) {
      console.log(`   原因: ${info.reason}`)
    }
    console.log()
  }

  if (changes.length > 0) {
    appendToHistory(changes)
    console.log(`📝 已更新 ${HISTORY_FILE}`)
  }

  console.log('─'.repeat(50))
  console.log(`✨ 更新完成！`)
  console.log(`   已更新: ${updatedCount} 个文件`)
  console.log(`   未变化: ${unchangedCount} 个文件`)
}

main().catch(console.error)
