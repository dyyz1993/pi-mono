/**
 * 检查项目中所有 md 文件的引用路径是否正确
 *
 * 运行: npm run check:refs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { glob } from 'glob'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const templateDir = path.resolve(__dirname, '..')

const MD_FILE_PATTERN = /\.md$/
const MD_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g

const GLOB_CHARS = ['*', '?', '[', '{']
const PLACEHOLDER_PATTERN = /\{[a-zA-Z_]+\}/
const EXCLUDED_PROTOCOLS = ['http://', 'https://', 'mailto:']

interface CheckResult {
  file: string
  line: number
  ref: string
  resolvedPath: string
  exists: boolean
  isGlob: boolean
}

function isGlobPattern(p: string): boolean {
  return GLOB_CHARS.some(char => p.includes(char))
}

function isPlaceholder(p: string): boolean {
  return PLACEHOLDER_PATTERN.test(p)
}

function shouldExclude(refPath: string): boolean {
  if (refPath.startsWith('#')) return true
  if (EXCLUDED_PROTOCOLS.some(proto => refPath.startsWith(proto))) return true
  return false
}

function findAllMdFiles(dir: string): string[] {
  const results: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git', '.pi'].includes(entry.name)) {
        results.push(...findAllMdFiles(fullPath))
      }
    } else if (entry.isFile() && MD_FILE_PATTERN.test(entry.name)) {
      results.push(fullPath)
    }
  }

  return results
}

function checkGlobPattern(baseDir: string, pattern: string): boolean {
  try {
    const fullPattern = path.isAbsolute(pattern) ? pattern : path.join(baseDir, pattern)
    const matchedFiles = glob.sync(fullPattern, {
      cwd: templateDir,
      nodir: true,
    })
    return matchedFiles.length > 0
  } catch {
    return false
  }
}

function checkFileExists(baseDir: string, refPath: string): boolean {
  const fullPath = path.isAbsolute(refPath) ? refPath : path.join(baseDir, refPath)
  return fs.existsSync(fullPath)
}

function checkReferences(): CheckResult[] {
  const results: CheckResult[] = []
  const mdFiles = findAllMdFiles(templateDir)

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const fileDir = path.dirname(filePath)
    const relativePath = path.relative(templateDir, filePath)

    lines.forEach((line, index) => {
      const lineNum = index + 1

      MD_LINK_PATTERN.lastIndex = 0
      let match
      while ((match = MD_LINK_PATTERN.exec(line)) !== null) {
        const linkText = match[1]
        const refPath = match[2]

        if (shouldExclude(refPath)) continue
        if (isPlaceholder(refPath)) continue

        const resolvedPath = refPath.startsWith('/')
          ? path.join(templateDir, refPath.slice(1))
          : path.resolve(fileDir, refPath)

        const resolvedRelative = path.relative(templateDir, resolvedPath)

        if (isGlobPattern(refPath)) {
          const exists = checkGlobPattern(refPath.startsWith('/') ? templateDir : fileDir, refPath)
          results.push({
            file: relativePath,
            line: lineNum,
            ref: refPath,
            resolvedPath: resolvedRelative,
            exists,
            isGlob: true,
          })
        } else {
          const exists = checkFileExists(fileDir, refPath)
          results.push({
            file: relativePath,
            line: lineNum,
            ref: refPath,
            resolvedPath: resolvedRelative,
            exists,
            isGlob: false,
          })
        }
      }
    })
  }

  return results
}

function main(): void {
  const results = checkReferences()
  const broken = results.filter(r => !r.exists)

  if (broken.length > 0) {
    console.log(`\n❌ Broken references (${broken.length}):\n`)
    const grouped = new Map<string, CheckResult[]>()
    for (const r of broken) {
      const key = `${r.file}`
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(r)
    }
    for (const [file, refs] of Array.from(grouped.entries())) {
      console.log(`  📄 ${file}`)
      for (const r of refs) {
        if (r.isGlob) {
          console.log(`     L${r.line}: ${r.ref} (NO MATCHES)`)
        } else {
          console.log(`     L${r.line}: ${r.ref} -> ${r.resolvedPath} (NOT FOUND)`)
        }
      }
    }
    console.log()
    process.exit(1)
  }
}

main()
