/**
 * Markdown 引用路径验证器
 *
 * 检查项目中所有 md 文件的引用路径是否正确
 */

import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import type { MdRefsConfig, MdRefError } from './index.js'

const MD_FILE_PATTERN = /\.md$/
const MD_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g

const GLOB_CHARS = ['*', '?', '[', '{']
const PLACEHOLDER_PATTERN = /\{[a-zA-Z_]+\}/
const EXCLUDED_PROTOCOLS = ['http://', 'https://', 'mailto:']

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

function findAllMdFiles(rootPath: string, config: MdRefsConfig): string[] {
  const results: string[] = []

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!config.ignoreDirs.includes(entry.name)) {
          scanDir(fullPath)
        }
      } else if (entry.isFile() && MD_FILE_PATTERN.test(entry.name)) {
        results.push(fullPath)
      }
    }
  }

  for (const checkDir of config.checkDirs) {
    const targetPath = path.join(rootPath, checkDir)
    if (fs.existsSync(targetPath)) {
      scanDir(targetPath)
    }
  }

  return results
}

function checkGlobPattern(baseDir: string, pattern: string): boolean {
  try {
    const fullPattern = path.isAbsolute(pattern) ? pattern : path.join(baseDir, pattern)
    const matchedFiles = glob.sync(fullPattern, {
      cwd: baseDir,
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

export function validateMdRefs(config: MdRefsConfig, rootPath: string): MdRefError[] {
  const errors: MdRefError[] = []
  const mdFiles = findAllMdFiles(rootPath, config)

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const fileDir = path.dirname(filePath)
    const relativePath = path.relative(rootPath, filePath)

    lines.forEach((line, index) => {
      const lineNum = index + 1

      MD_LINK_PATTERN.lastIndex = 0
      let match
      while ((match = MD_LINK_PATTERN.exec(line)) !== null) {
        const refPath = match[2]

        if (shouldExclude(refPath)) continue
        if (isPlaceholder(refPath)) continue

        const resolvedPath = refPath.startsWith('/')
          ? path.join(rootPath, refPath.slice(1))
          : path.resolve(fileDir, refPath)

        const resolvedRelative = path.relative(rootPath, resolvedPath)

        if (isGlobPattern(refPath)) {
          const exists = checkGlobPattern(refPath.startsWith('/') ? rootPath : fileDir, refPath)
          if (!exists) {
            errors.push({
              file: relativePath,
              line: lineNum,
              ref: refPath,
              resolvedPath: resolvedRelative,
              isGlob: true,
            })
          }
        } else {
          const exists = checkFileExists(fileDir, refPath)
          if (!exists) {
            errors.push({
              file: relativePath,
              line: lineNum,
              ref: refPath,
              resolvedPath: resolvedRelative,
              isGlob: false,
            })
          }
        }
      }
    })
  }

  return errors
}

export function formatMdRefErrors(errors: MdRefError[]): string {
  if (errors.length === 0) return ''

  let output = `❌ Found ${errors.length} broken reference(s):\n\n`

  const grouped = new Map<string, MdRefError[]>()
  for (const err of errors) {
    const key = err.file
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(err)
  }

  for (const [file, refs] of Array.from(grouped.entries())) {
    output += `  📄 ${file}\n`
    for (const r of refs) {
      if (r.isGlob) {
        output += `     L${r.line}: ${r.ref} (NO MATCHES)\n`
      } else {
        output += `     L${r.line}: ${r.ref} -> ${r.resolvedPath} (NOT FOUND)\n`
      }
    }
  }

  output += '\n📋 Guidelines:\n'
  output += '  - Ensure all file references exist\n'
  output += '  - Use relative paths from the markdown file location\n'
  output += '  - For absolute paths, start with / (project root)\n'

  return output
}
