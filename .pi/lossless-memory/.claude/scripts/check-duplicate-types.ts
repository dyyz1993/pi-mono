#!/usr/bin/env node

import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

interface ToolInput {
  tool_name: string
  tool_input: {
    file_path?: string
    new_text?: string
  }
}

interface DuplicateInfo {
  name: string
  count: number
  locations: Array<{ file: string; line: number }>
}

function main() {
  try {
    const input: ToolInput = JSON.parse(fs.readFileSync(0, 'utf-8'))

    const filePath = input.tool_input?.file_path
    const newText = input.tool_input?.new_text

    if (!filePath || !newText) {
      process.exit(0)
    }

    if (!filePath.match(/\.(ts|tsx)$/)) {
      process.exit(0)
    }

    const typeNames = extractTypeNames(newText)

    if (typeNames.size === 0) {
      process.exit(0)
    }

    const projectRoot = findProjectRoot(filePath)
    const duplicates = findDuplicates(typeNames, projectRoot, filePath)

    if (duplicates.length > 0) {
      printWarning(duplicates)
    }

    process.exit(0)
  } catch {
    process.exit(0)
  }
}

function extractTypeNames(text: string): Set<string> {
  const typeNames = new Set<string>()

  const patterns = [
    /^(export\s+)?type\s+([A-Z][a-zA-Z0-9]*)/gm,
    /^(export\s+)?interface\s+([A-Z][a-zA-Z0-9]*)/gm,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      typeNames.add(match[2])
    }
  }

  return typeNames
}

function findProjectRoot(filePath: string): string {
  let current = path.dirname(filePath)

  while (current !== '/') {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current
    }
    current = path.dirname(current)
  }

  return path.dirname(filePath)
}

function findDuplicates(
  typeNames: Set<string>,
  projectRoot: string,
  currentFile: string
): DuplicateInfo[] {
  const duplicates: DuplicateInfo[] = []

  for (const typeName of typeNames) {
    const locations = searchTypeInProject(typeName, projectRoot, currentFile)

    if (locations.length > 0) {
      duplicates.push({
        name: typeName,
        count: locations.length,
        locations,
      })
    }
  }

  return duplicates
}

function searchTypeInProject(
  typeName: string,
  projectRoot: string,
  currentFile: string
): Array<{ file: string; line: number }> {
  const results: Array<{ file: string; line: number }> = []

  try {
    const pattern = `^(export\\s+)?(type|interface)\\s+${typeName}(\\s|<|{|=)`
    const srcPath = path.join(projectRoot, 'src')

    if (!fs.existsSync(srcPath)) {
      return results
    }

    const output = execSync(
      `grep -r --include="*.ts" --include="*.tsx" --exclude-dir="node_modules" --exclude-dir="dist" --exclude-dir="build" -n -E "${pattern}" "${srcPath}"`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    ).trim()

    if (!output) {
      return results
    }

    const lines = output.split('\n')

    for (const line of lines) {
      const match = line.match(/^(.+?):(\d+):/)
      if (match) {
        const file = match[1]
        const lineNum = parseInt(match[2], 10)

        if (!file.includes(path.basename(currentFile))) {
          const relativePath = path.relative(projectRoot, file)
          results.push({ file: relativePath, line: lineNum })
        }
      }
    }
  } catch {
    // grep returns non-zero exit code when no matches found
  }

  return results
}

function printWarning(duplicates: DuplicateInfo[]) {
  process.stdout.write('\n')
  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  process.stdout.write('⚠️  检测到重复类型定义！\n')
  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  process.stdout.write('\n')

  for (const dup of duplicates) {
    process.stdout.write(`🔍 类型名称: \x1b[1;33m${dup.name}\x1b[0m\n`)
    process.stdout.write(`   已存在 ${dup.count} 处定义，首次定义位置:\n`)
    const first = dup.locations[0]
    process.stdout.write(`   📁 ${first.file}:${first.line}\n`)
    process.stdout.write('\n')
  }

  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  process.stdout.write('💡 建议:\n')
  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  process.stdout.write('\n')
  process.stdout.write('1. 检查上述位置的类型定义是否可以复用\n')
  process.stdout.write('2. 如果需要不同结构，考虑使用 TypeScript 工具类型:\n')
  process.stdout.write('   • Pick<T, K>      - 选择部分字段\n')
  process.stdout.write('   • Omit<T, K>      - 排除部分字段\n')
  process.stdout.write('   • Partial<T>      - 所有字段可选\n')
  process.stdout.write('   • Required<T>     - 所有字段必需\n')
  process.stdout.write('\n')
  process.stdout.write('3. 从共享类型导入:\n')
  process.stdout.write(`   import type { ${duplicates[0].name} } from '@shared/types'\n`)
  process.stdout.write('\n')
  process.stdout.write('4. 查看 .claude/hookify.check-duplicate-types.local.md 了解更多\n')
  process.stdout.write('\n')
  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  process.stdout.write('\n')
}

main()
